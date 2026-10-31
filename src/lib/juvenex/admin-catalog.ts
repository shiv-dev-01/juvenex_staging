/**
 * Storefront product ids / slugs used by the Juvenex admin pricing dashboard.
 * Mirrors PrimeVida's `adminCatalog.ts`, but sourced from the Juvenex
 * storefront catalog instead of PrimeVida's panel SKU map.
 * Live prices come from the fulfilment panel (site 614).
 */
import { STOREFRONT_PRODUCTS } from '@/lib/jx/storefront-catalog'

export type StorefrontContext = {
  slugs: string[]
  name: string
  sku: string
  planLabel: string
}

export type AdminPriceRow = {
  productId: string
  stickyProductId: string
  name: string
  sku: string
  category: string
  currentPrice: string
  slugs: string[]
  planLabel: string
}

export function storefrontContextByProductId(): Map<string, StorefrontContext> {
  const map = new Map<string, StorefrontContext>()

  const add = (id: string | undefined, slug: string, name: string, sku: string, planLabel: string) => {
    if (!id) return
    const key = String(id)
    const existing = map.get(key)
    if (existing) {
      if (!existing.slugs.includes(slug)) existing.slugs.push(slug)
      return
    }
    map.set(key, { slugs: [slug], name, sku, planLabel })
  }

  for (const product of STOREFRONT_PRODUCTS) {
    for (const plan of product.plans ?? []) {
      add(plan.productId, product.slug, product.name, plan.sku, plan.label)
    }
    for (const med of product.medications ?? []) {
      for (const plan of med.plans ?? []) {
        add(plan.productId, product.slug, med.name || product.name, plan.sku, plan.label)
      }
      if (med.productId) {
        add(med.productId, product.slug, med.name || product.name, med.sku ?? '', '')
      }
    }
  }

  return map
}
