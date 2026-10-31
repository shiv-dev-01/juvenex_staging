import 'server-only'

/**
 * Server-only WhiteLabelMD panel pricing client for Juvenex products (site 614).
 * GHL leads stay on site 453 (JUVENEX_CHECKOUT_SITE_ID).
 *
 * Same wlmdbackend endpoints PrimeVida uses:
 *   POST /get_products
 *   POST /get_product_prices
 *   POST /update_product_price
 *
 * The auth token never leaves this module.
 */

const DEFAULT_BASE = 'https://panel.whitelabelmd.com/wlmdbackend/api'
const DEFAULT_TIMEOUT_MS = 15_000

/** Site id for the fulfilment product catalog and price updates. */
export function juvenexSiteId(): string {
  const raw = process.env.JUVENEX_PANEL_SITE_ID?.trim()
  return raw && raw.length > 0 ? raw : '614'
}

function panelBase(): string {
  return (process.env.WLMD_PANEL_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, '')
}

function panelAuthToken(): string {
  const token = process.env.WLMD_PANEL_AUTH_TOKEN?.trim()
  if (!token) {
    throw new PanelPricingError('Panel pricing API is not configured', 503)
  }
  return token
}

function headers(): HeadersInit {
  return {
    authtoken: panelAuthToken(),
    Accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  }
}

export class PanelPricingError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number = 502,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'PanelPricingError'
  }
}

export type PanelProduct = {
  uniq_id: string
  sticky_product_id: string
  product_price: string
  product_name: string
  product_sku: string
}

async function panelPost(path: string, body: URLSearchParams): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${panelBase()}/${path}`, {
      method: 'POST',
      headers: headers(),
      body,
      cache: 'no-store',
      signal: controller.signal,
    })
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new PanelPricingError(
        `Provider returned an unexpected response (${res.status})`,
        502
      )
    }
    if (!res.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
          ? json.message
          : `Panel request failed (${res.status})`
      throw new PanelPricingError(message, 502)
    }
    return json
  } catch (error: unknown) {
    if (error instanceof PanelPricingError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PanelPricingError('Panel request timed out', 504, error)
    }
    throw new PanelPricingError('Unable to reach the fulfilment panel', 502, error)
  } finally {
    clearTimeout(timeout)
  }
}

/** Panel catalog: panel product id (uniq_id) -> name, sku, sticky product id. */
export async function fetchPanelCatalog(): Promise<Map<string, PanelProduct>> {
  const json = (await panelPost(
    'get_products',
    new URLSearchParams({ site_id: juvenexSiteId() })
  )) as { status?: number; message?: string; products?: PanelProduct[] }

  if (json.status !== 1 || !Array.isArray(json.products)) {
    throw new PanelPricingError(json.message || 'Panel catalog unavailable')
  }

  return new Map(
    json.products.map((p) => [
      String(p.uniq_id),
      {
        uniq_id: String(p.uniq_id),
        sticky_product_id: String(p.sticky_product_id ?? ''),
        product_price: String(p.product_price ?? ''),
        product_name: String(p.product_name ?? ''),
        product_sku: String(p.product_sku ?? ''),
      },
    ])
  )
}

/** Current prices in dollars, keyed by panel product id (uniq_id). */
export async function fetchPanelPrices(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const json = (await panelPost(
    'get_product_prices',
    new URLSearchParams({ site_id: juvenexSiteId(), product_id: ids.join(',') })
  )) as {
    status?: number
    message?: string
    data?: { product_id: string; product_price: string }[]
  }

  if (json.status !== 1) {
    throw new PanelPricingError(json.message || 'Could not fetch prices')
  }

  const out: Record<string, string> = {}
  for (const row of json.data ?? []) {
    out[String(row.product_id)] = String(row.product_price)
  }
  return out
}

/** Updates the price on the provider. `stickyProductId` is required by the panel. */
export async function updatePanelPrice(stickyProductId: string, price: string) {
  const json = (await panelPost(
    'update_product_price',
    new URLSearchParams({
      site_id: juvenexSiteId(),
      product_id: stickyProductId,
      price,
    })
  )) as { status?: number; message?: string; product_price?: string }

  if (json.status !== 1) {
    throw new PanelPricingError(json.message || 'Update failed')
  }

  return {
    price: String(json.product_price ?? price),
    message: json.message ?? 'Updated',
  }
}
