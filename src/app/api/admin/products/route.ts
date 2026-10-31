import { type NextRequest } from 'next/server'
import { z } from 'zod'

import { hiddenProductIds, rememberProductActive } from '@/lib/juvenex/product-visibility'
import { canManagePricing } from '@/lib/juvenex/pricing-access'
import { logger } from '@/lib/logger'
import { rateLimit } from '@/lib/rate-limit'
import { getPricedStorefront } from '@/lib/jx/panel-storefront.server'
import { STOREFRONT_CATEGORIES, STOREFRONT_PRODUCTS } from '@/lib/jx/storefront-catalog'
import { getAuthUser } from '@/lib/supabase/server'

const STATUS_URL = 'https://panel.whitelabelmd.com/juvenex/api/product-status-update'

const bodySchema = z.object({
  productId: z.string().trim().min(1).max(32),
})

type CatalogRow = {
  productId: string
  name: string
  sku: string
  category: string
  planLabel: string
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
      response: Response.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    }
  }
  return { ok: true as const, user }
}

function addRow(map: Map<string, CatalogRow>, row: CatalogRow) {
  if (!row.productId || map.has(row.productId)) return
  map.set(row.productId, row)
}

export async function GET() {
  const auth = await requirePricingAdmin()
  if (!auth.ok) return auth.response

  const catalog = await getPricedStorefront()
  const labelByKey = new Map(catalog.categories.map((category) => [category.key, category.label]))
  const staticLabel = new Map(STOREFRONT_CATEGORIES.map((category) => [category.key, category.label]))
  const rows = new Map<string, CatalogRow>()

  for (const product of catalog.products) {
    const category = labelByKey.get(product.category) || product.category || 'Uncategorized'
    for (const plan of product.plans ?? []) {
      addRow(rows, {
        productId: plan.productId,
        name: product.name,
        sku: plan.sku,
        category,
        planLabel: plan.label,
      })
    }
  }

  for (const product of STOREFRONT_PRODUCTS) {
    const category = staticLabel.get(product.category) || product.category
    for (const plan of product.plans ?? []) {
      addRow(rows, {
        productId: plan.productId,
        name: product.name,
        sku: plan.sku,
        category,
        planLabel: plan.label,
      })
    }
    for (const med of product.medications ?? []) {
      for (const plan of med.plans ?? []) {
        addRow(rows, {
          productId: plan.productId,
          name: med.name || product.name,
          sku: plan.sku,
          category,
          planLabel: plan.label,
        })
      }
    }
  }

  const hidden = hiddenProductIds()
  const products = [...rows.values()]
    .map((row) => ({ ...row, active: !hidden.has(row.productId) }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  return Response.json({ success: true, data: { products } })
}

export async function POST(request: NextRequest) {
  const auth = await requirePricingAdmin()
  if (!auth.ok) return auth.response

  const rl = rateLimit(`admin-product-status:${auth.user.id}`, 40, 60_000)
  if (!rl.success) {
    return Response.json({ success: false, error: 'Too many requests' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }

  const apiKey = process.env.JUVENEX_API_KEY?.trim()
  try {
    const upstream = await fetch(STATUS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(apiKey ? { 'api-key': apiKey } : {}),
      },
      body: JSON.stringify({ product_id: parsed.data.productId }),
      cache: 'no-store',
    })
    const json = (await upstream.json().catch(() => ({}))) as {
      status?: number
      message?: string
      product_status?: number | string
      product_status_text?: string
    }
    if (!upstream.ok || json.status !== 1) {
      return Response.json(
        { success: false, error: json.message || 'The product status could not be changed' },
        { status: 502 }
      )
    }
    const text = `${json.product_status_text || ''} ${json.message || ''}`
    const active = /deactivat|inactive/i.test(text)
      ? false
      : json.product_status != null
        ? Number(json.product_status) === 1
        : true
    rememberProductActive(parsed.data.productId, active)
    return Response.json({
      success: true,
      data: {
        productId: parsed.data.productId,
        active,
        message: json.message || (active ? 'Product activated successfully.' : 'Product deactivated successfully.'),
      },
    })
  } catch (error: unknown) {
    logger.error('admin product status failed', {
      message: error instanceof Error ? error.message : 'unknown',
    })
    return Response.json({ success: false, error: 'Unable to reach the product service' }, { status: 502 })
  }
}
