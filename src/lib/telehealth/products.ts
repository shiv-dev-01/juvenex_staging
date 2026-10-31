/**
 * VIP telehealth product catalog — native Juvenex storefront only.
 * Single source of truth: STOREFRONT_* (WLMD productIds). No PrescribeRx.
 */

import {
  STOREFRONT_CATEGORIES,
  STOREFRONT_PRODUCTS,
  type StorefrontCategoryKey,
  type StorefrontPlan,
  type StorefrontProduct,
} from '@/lib/jx/storefront-catalog'
import { omitHiddenPlans, withPanelPrices, type PanelPriceIndex } from '@/lib/jx/panel-storefront'
import { peptideForProduct } from '@/lib/marketplace-access'

/** Patient-facing category labels (simple, not clinical jargon). */
export const VIP_CATEGORY_COPY: Record<
  StorefrontCategoryKey,
  { title: string; blurb: string }
> = {
  'weight-loss': {
    title: 'Weight Management',
    blurb: 'GLP-1 and related options for weight goals.',
  },
  hrt: {
    title: 'Hormone Support',
    blurb: 'Hormone and peptide options for balance and recovery.',
  },
  longevity: {
    title: 'Longevity',
    blurb: 'Supportive options for long-term wellness.',
  },
  'sexual-wellness': {
    title: 'Sexual Wellness',
    blurb: 'Options related to sexual health and wellness.',
  },
  'hair-skin': {
    title: 'Hair & Skin',
    blurb: 'Hair and skin wellness products.',
  },
  other: {
    title: 'Lifestyle',
    blurb: 'Other wellness products available to members.',
  },
}

export interface VipProductPlan {
  label: string
  sku: string
  months: number
  productId: string
  price: number
  dosage: string
}

export interface VipProduct {
  slug: string
  name: string
  category: StorefrontCategoryKey
  tagline: string
  startingPrice: number
  plans: VipProductPlan[]
}

function plansFromProduct(product: StorefrontProduct): VipProductPlan[] {
  if (product.plans?.length) {
    return product.plans.map((p: StorefrontPlan) => ({
      label: p.label,
      sku: p.sku,
      months: p.months,
      productId: p.productId,
      price: p.price,
      dosage: p.dosage ?? '',
    }))
  }
  if (product.medications?.length) {
    const out: VipProductPlan[] = []
    for (const med of product.medications) {
      if (med.plans?.length) {
        for (const p of med.plans) {
          out.push({
            label: `${med.name} · ${p.label}`,
            sku: p.sku,
            months: p.months,
            productId: p.productId,
            price: p.price,
            dosage: p.dosage ?? '',
          })
        }
      } else if (med.productId && typeof med.price === 'number') {
        out.push({
          label: med.name,
          sku: med.sku ?? med.productId,
          months: med.months ?? 1,
          productId: med.productId,
          price: med.price,
          dosage: med.dosage ?? '',
        })
      }
    }
    return out
  }
  return []
}

function toVipProduct(product: StorefrontProduct): VipProduct | null {
  const plans = plansFromProduct(product)
  if (plans.length === 0) return null
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    tagline: product.tagline,
    startingPrice: product.startingPrice,
    plans,
  }
}

/** All VIP telehealth products from the native storefront catalog. */
export function listVipProducts(
  prices?: PanelPriceIndex,
  hidden?: ReadonlySet<string>
): VipProduct[] {
  return STOREFRONT_PRODUCTS.flatMap((product) => {
    const priced = prices ? withPanelPrices(product, prices) : product
    const visible = hidden ? omitHiddenPlans(priced, hidden) : priced
    if (!visible) return []
    const vip = toVipProduct(visible)
    return vip ? [vip] : []
  })
}

export function listVipCategories(hidden?: ReadonlySet<string>): Array<{
  key: StorefrontCategoryKey
  title: string
  blurb: string
  productCount: number
}> {
  const products = listVipProducts(undefined, hidden)
  return STOREFRONT_CATEGORIES.map((cat) => {
    const copy = VIP_CATEGORY_COPY[cat.key]
    return {
      key: cat.key,
      title: copy.title,
      blurb: copy.blurb,
      productCount: products.filter((p) => p.category === cat.key).length,
    }
  }).filter((c) => c.productCount > 0)
}

export function getVipProduct(
  slug: string,
  prices?: PanelPriceIndex,
  hidden?: ReadonlySet<string>
): VipProduct | null {
  return listVipProducts(prices, hidden).find((p) => p.slug === slug) ?? null
}

export function listVipProductsByCategory(
  category: StorefrontCategoryKey,
  prices?: PanelPriceIndex,
  hidden?: ReadonlySet<string>
): VipProduct[] {
  return listVipProducts(prices, hidden).filter((p) => p.category === category)
}

/**
 * Filter products by membership peptide entitlement.
 * Unlimited tier (allowed === null) sees everything.
 */
export function filterVipProductsForEntitlement(
  products: VipProduct[],
  allowedSlugs: ReadonlySet<string> | null
): VipProduct[] {
  if (allowedSlugs === null) return products
  return products.filter((p) => {
    const peptide = peptideForProduct({ name: p.name })
    if (!peptide) return true // fail-open for catalog items without peptide map
    return allowedSlugs.has(peptide.slug)
  })
}

export function formatVipPrice(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}
