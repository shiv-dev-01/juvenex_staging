import { revalidateTag } from 'next/cache'
import { type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  storefrontContextByProductId,
  type AdminPriceRow,
} from '@/lib/juvenex/admin-catalog'
import {
  fetchPanelCatalog,
  fetchPanelPrices,
  juvenexSiteId,
  PanelPricingError,
  updatePanelPrice,
} from '@/lib/juvenex/panel-pricing'
import { juvenexClient } from '@/lib/juvenex/client'
import { canManagePricing } from '@/lib/juvenex/pricing-access'
import { logger } from '@/lib/logger'
import { rateLimit } from '@/lib/rate-limit'
import { getAuthUser } from '@/lib/supabase/server'

// GET   /api/admin/pricing  → live Juvenex (site 614) product prices
// PATCH /api/admin/pricing  → update one product price on the fulfilment panel
// Auth: signed-in pricing admin (or super_admin). Panel token stays server-side.

const PRICE_RE = /^\d+(\.\d{1,2})?$/

const updateSchema = z.object({
  productId: z.string().trim().min(1).max(32),
  price: z.string().trim().min(1).max(16),
})

const bulkSchema = z.object({
  updates: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(32),
        price: z.string().trim().min(1).max(16),
      })
    )
    .min(1)
    .max(200),
})

async function categoryBySku(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const response = await juvenexClient.getProducts()
    for (const row of response.product ?? []) {
      const sku = String(row.product_sku ?? '').trim().toLowerCase()
      const category = String(row.product_category_name ?? '').trim()
      if (sku && category && !map.has(sku)) map.set(sku, category)
    }
  } catch {
    return map
  }
  return map
}

async function requirePricingAdmin() {
  const user = await getAuthUser()
  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (!canManagePricing(user)) {
    return {
      ok: false as const,
      response: Response.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      ),
    }
  }
  return { ok: true as const, user }
}

function panelError(error: unknown) {
  if (error instanceof PanelPricingError) {
    return Response.json({ success: false, error: error.message }, { status: error.httpStatus })
  }
  logger.error('admin pricing: unexpected error', {
    message: error instanceof Error ? error.message : 'unknown',
  })
  return Response.json({ success: false, error: 'Internal server error' }, { status: 500 })
}

export async function GET() {
  try {
    const auth = await requirePricingAdmin()
    if (!auth.ok) return auth.response

    const rl = rateLimit(`admin-pricing:${auth.user.id}`, 30, 60_000)
    if (!rl.success) {
      return Response.json({ success: false, error: 'Too many requests' }, { status: 429 })
    }

    const storefront = storefrontContextByProductId()
    const [catalog, categories] = await Promise.all([fetchPanelCatalog(), categoryBySku()])
    const ids = [...catalog.keys()]
    const prices = await fetchPanelPrices(ids)

    const products: AdminPriceRow[] = ids
      .map((id) => {
        const p = catalog.get(id)
        const ctx = storefront.get(id)
        const sku = p?.product_sku || ctx?.sku || ''
        return {
          productId: id,
          stickyProductId: p?.sticky_product_id ?? '',
          name: p?.product_name || ctx?.name || `Product ${id}`,
          sku,
          category: categories.get(sku.trim().toLowerCase()) || 'Uncategorized',
          currentPrice: prices[id] ?? p?.product_price ?? '',
          slugs: ctx?.slugs ?? [],
          planLabel: ctx?.planLabel ?? '',
        }
      })
      .sort((a, b) => {
        const aLive = a.slugs.length > 0 ? 0 : 1
        const bLive = b.slugs.length > 0 ? 0 : 1
        if (aLive !== bLive) return aLive - bLive
        return Number(a.productId) - Number(b.productId)
      })

    return Response.json({
      success: true,
      data: { siteId: juvenexSiteId(), products },
    })
  } catch (error: unknown) {
    return panelError(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requirePricingAdmin()
    if (!auth.ok) return auth.response

    const rl = rateLimit(`admin-pricing-update:${auth.user.id}`, 20, 60_000)
    if (!rl.success) {
      return Response.json({ success: false, error: 'Too many requests' }, { status: 429 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json(
        { success: false, error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const price = parsed.data.price.trim()
    if (!PRICE_RE.test(price) || Number(price) <= 0) {
      return Response.json(
        { success: false, error: 'Enter a valid price greater than 0 with up to two decimals' },
        { status: 400 }
      )
    }

    const catalog = await fetchPanelCatalog()
    const product = catalog.get(String(parsed.data.productId))
    if (!product?.sticky_product_id) {
      return Response.json(
        { success: false, error: 'Product not found in the Juvenex panel catalog' },
        { status: 404 }
      )
    }

    const result = await updatePanelPrice(product.sticky_product_id, price)
    revalidateTag('jx-panel-prices', { expire: 0 })
    const fresh = await fetchPanelPrices([String(parsed.data.productId)])

    return Response.json({
      success: true,
      data: {
        productId: String(parsed.data.productId),
        price: fresh[String(parsed.data.productId)] ?? result.price,
        message: result.message,
      },
    })
  } catch (error: unknown) {
    return panelError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePricingAdmin()
    if (!auth.ok) return auth.response

    const rl = rateLimit(`admin-pricing-bulk:${auth.user.id}`, 6, 60_000)
    if (!rl.success) {
      return Response.json({ success: false, error: 'Too many requests' }, { status: 429 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ success: false, error: 'Invalid request' }, { status: 400 })
    }

    const catalog = await fetchPanelCatalog()
    const results: { productId: string; ok: boolean; price?: string; error?: string }[] = []
    for (const update of parsed.data.updates) {
      const price = update.price.trim()
      if (!PRICE_RE.test(price) || Number(price) <= 0) {
        results.push({ productId: update.productId, ok: false, error: 'Invalid price' })
        continue
      }
      const product = catalog.get(update.productId)
      if (!product?.sticky_product_id) {
        results.push({ productId: update.productId, ok: false, error: 'Product not found' })
        continue
      }
      try {
        const result = await updatePanelPrice(product.sticky_product_id, price)
        results.push({ productId: update.productId, ok: true, price: result.price })
      } catch (error: unknown) {
        const message = error instanceof PanelPricingError ? error.message : 'Update failed'
        results.push({ productId: update.productId, ok: false, error: message })
      }
    }

    revalidateTag('jx-panel-prices', { expire: 0 })
    return Response.json({ success: true, data: { results } })
  } catch (error: unknown) {
    return panelError(error)
  }
}
