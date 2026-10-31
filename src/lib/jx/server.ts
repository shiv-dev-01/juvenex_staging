import 'server-only'

import { unstable_cache } from 'next/cache'
import { juvenexClient, JuvenexApiError, type JuvenexProduct } from '@/lib/juvenex/client'
import { normalizeProduct, normalizeProducts, dedupeVariants, type JxProduct } from './catalog'
import { panelPriceFor, productIsActive } from './panel-storefront'
import { getPanelPriceIndex, getVisibleProductIds } from './panel-storefront.server'

/**
 * Server-side catalogue access for the storefront pages.
 *
 * The partner API is slow-ish (~1s) and rate-limited, and the catalogue changes
 * rarely, so the product list is cached for 5 minutes and shared across every
 * request and route. Failures degrade to an empty catalogue rather than a 500 —
 * a storefront that renders its chrome and an honest "temporarily unavailable"
 * beats a blank error page.
 */

const CATALOG_TAG = 'juvenex-catalog'
const CATALOG_TTL_SECONDS = 300

export interface CatalogResult {
  products: JxProduct[]
  /** Distinct products after collapsing duplicate molecule/dose/supply rows. */
  unique: JxProduct[]
  /** Set when the upstream call failed; pages surface this instead of an empty grid. */
  error: string | null
}

const loadRawProducts = unstable_cache(
  async (): Promise<{ rows: JuvenexProduct[]; error: string | null }> => {
    try {
      const response = await juvenexClient.getProducts()
      if (response.status !== 1 || !Array.isArray(response.product)) {
        return { rows: [], error: response.message || 'Catalogue is unavailable' }
      }
      return { rows: response.product, error: null }
    } catch (error) {
      const message =
        error instanceof JuvenexApiError ? error.message : 'Unable to reach the catalogue'
      // Logged, not thrown: the page renders a retryable empty state.
      console.error('[jx] catalogue fetch failed:', message)
      return { rows: [], error: message }
    }
  },
  ['jx-catalog-v2'],
  { revalidate: CATALOG_TTL_SECONDS, tags: [CATALOG_TAG] }
)

async function withSitePrices(products: JxProduct[]): Promise<JxProduct[]> {
  const prices = await getPanelPriceIndex()
  if (!Object.keys(prices.byId).length) return products
  return products.map((product) => {
    const next = panelPriceFor(prices, product.id, product.sku)
    if (next == null || next === product.price) return product
    return {
      ...product,
      price: next,
      pricePerMonth: product.supplyMonths > 0 ? next / product.supplyMonths : next,
    }
  })
}

export async function getCatalog(): Promise<CatalogResult> {
  const [{ rows, error }, visibleIds] = await Promise.all([loadRawProducts(), getVisibleProductIds()])
  const visible = rows.filter((row) => {
    const id = String(row.product_id)
    if (visibleIds) return visibleIds.has(id)
    return productIsActive(row)
  })
  const products = await withSitePrices(normalizeProducts(visible))
  return { products, unique: dedupeVariants(products), error }
}

export interface ProductDetailResult {
  product: JxProduct | null
  /** Related products the partner returns, normalised. May be empty. */
  related: JxProduct[]
  error: string | null
}

/**
 * Full detail for one product.
 *
 * `Get_Product_Details` is the only source of `product_description` and the
 * accepted payment brands, but it omits some fields the list endpoint has, so
 * the two are merged with the list row as the base.
 */
export async function getProductDetail(productId: string): Promise<ProductDetailResult> {
  const visibleIds = await getVisibleProductIds()
  if (visibleIds && !visibleIds.has(productId)) {
    return { product: null, related: [], error: null }
  }
  const { rows, error: listError } = await loadRawProducts()
  if (!listError && rows.length > 0) {
    const raw = rows.find((row) => String(row.product_id) === productId)
    if (!raw || !productIsActive(raw)) {
      return { product: null, related: [], error: null }
    }
  }

  const { products } = await getCatalog()
  const listRow = products.find((p) => p.id === productId) ?? null

  try {
    const response = await juvenexClient.getProductDetails(productId)
    if (response.status !== 1 || !response.product_data) {
      return {
        product: listRow,
        related: [],
        error: listRow ? null : response.message || 'Product not found',
      }
    }

    const detail = normalizeProduct(response.product_data)
    const merged: JxProduct = listRow
      ? {
          ...listRow,
          description: detail.description || listRow.description,
          images: detail.images.length ? detail.images : listRow.images,
          sku: detail.sku || listRow.sku,
        }
      : detail

    const relatedRaw = (response as { related_products?: unknown }).related_products
    const related = Array.isArray(relatedRaw)
      ? normalizeProducts(relatedRaw as JuvenexProduct[]).filter((p) => p.id !== productId)
      : []

    return { product: merged, related, error: null }
  } catch (error) {
    const message =
      error instanceof JuvenexApiError ? error.message : 'Unable to reach the catalogue'
    console.error(`[jx] product ${productId} fetch failed:`, message)
    // The list row still has name, price and dose — enough to render the page.
    return { product: listRow, related: [], error: listRow ? null : message }
  }
}
