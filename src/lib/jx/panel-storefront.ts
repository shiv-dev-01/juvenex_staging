/**
 * Maps WhiteLabelMD panel category/product payloads into the shop card shape.
 * Pure: no network, no secrets. The server loader lives in panel-storefront.server.ts.
 *
 * Endpoints:
 *   GET /juvenex/api/get-products-category
 *   GET /juvenex/api/get-product-by-category?category_name=
 */

import type { StorefrontProduct } from './storefront-catalog'

export type ShopCategory = {
  key: string
  label: string
  navLabel: string
}

/** Storefront product whose category is a live panel slug, not the static union. */
export type ShopProduct = Omit<StorefrontProduct, 'category'> & {
  category: string
}

export type PanelProductParse =
  | { kind: 'products'; rows: unknown[] }
  | { kind: 'missing-method' }
  | { kind: 'unrecognized' }

const CHECKOUT_ORIGIN = 'https://checkout.juvenex.app'

export function categoryKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseCategoryNames(payload: unknown): string[] | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { category_data?: unknown }).category_data
  if (!Array.isArray(data)) return null
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of data) {
    const name = categoryLabel(entry)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.length ? names : null
}

export function parseProductPayload(_status: number, text: string, payload: unknown): PanelProductParse {
  const message =
    payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message ?? '')
      : text
  if (/does not exist/i.test(message) || /BadMethodCallException/i.test(message)) {
    return { kind: 'missing-method' }
  }
  if (!payload || typeof payload !== 'object') return { kind: 'unrecognized' }
  const record = payload as Record<string, unknown>
  for (const key of ['product', 'products', 'product_data', 'data', 'category_products']) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    if (value.length === 0) return { kind: 'products', rows: [] }
    if (value.every((row) => row && typeof row === 'object')) {
      return { kind: 'products', rows: value }
    }
  }
  return { kind: 'unrecognized' }
}

export function mapPanelCatalog(input: {
  categoryNames: string[]
  productsByCategory: Record<string, unknown[]>
}): { categories: ShopCategory[]; products: ShopProduct[] } {
  const names: string[] = []
  const seenNames = new Set<string>()
  for (const name of input.categoryNames) {
    const label = name.trim()
    if (!label || seenNames.has(label)) continue
    seenNames.add(label)
    names.push(label)
  }
  for (const name of Object.keys(input.productsByCategory)) {
    const label = name.trim()
    if (!label || seenNames.has(label)) continue
    seenNames.add(label)
    names.push(label)
  }

  const categories: ShopCategory[] = names.map((label) => ({
    key: categoryKey(label),
    label,
    navLabel: label,
  }))

  const products: ShopProduct[] = []
  const seenIds = new Set<string>()
  for (const label of names) {
    const key = categoryKey(label)
    const rows = input.productsByCategory[label] ?? []
    const mapped = rows
      .map((row) => toShopProduct(row, label, key))
      .filter((product): product is ShopProduct => product !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const product of mapped) {
      const id = product.plans?.[0]?.productId
      if (!id || seenIds.has(id)) continue
      seenIds.add(id)
      products.push(product)
    }
  }

  return { categories, products }
}

function categoryLabel(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim()
  if (!entry || typeof entry !== 'object') return ''
  const record = entry as Record<string, unknown>
  const name = record.category_name ?? record.name ?? record.product_category_name
  return typeof name === 'string' ? name.trim() : ''
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** `product_status` 1 is on the site. 0, or an inactive label, is hidden. A missing field stays visible. */
export function productIsActive(record: Record<string, unknown>): boolean {
  const label = text(record.product_status_text)
  if (/deactivat|inactive/i.test(label)) return false
  if (record.product_status == null || record.product_status === '') return true
  const status = Number(record.product_status)
  return Number.isFinite(status) ? status === 1 : true
}

export function activeProductIds(rows: unknown[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const id = text(record.product_id ?? record.id ?? record.uniq_id)
    if (!id || seen.has(id) || !productIsActive(record)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function inactiveProductIds(rows: unknown[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const id = text(record.product_id ?? record.id ?? record.uniq_id)
    if (!id || seen.has(id) || productIsActive(record)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function money(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const amount = Number(value.replace(/[$,]/g, '').trim())
  return Number.isFinite(amount) ? amount : null
}

function supplyFromName(name: string): { label: string; months: number } {
  const match = name.match(/(\d{1,2})\s*-?\s*months?\b/i)
  if (!match) return { label: 'Supply', months: 1 }
  const months = Number(match[1])
  if (!Number.isFinite(months) || months <= 0) return { label: 'Supply', months: 1 }
  return { label: months === 1 ? '1 month' : `${months} months`, months }
}

function productSlug(name: string, id: string): string {
  const base = categoryKey(name) || 'product'
  return `${base}-${id}`
}

function taglineFor(name: string, description: string, category: string): string {
  const clean = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean || clean.toLowerCase() === name.toLowerCase()) return category
  return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}…` : clean
}

export type PanelPriceIndex = {
  /** Panel uniq id → price and SKU. A price applies only when the SKU matches. */
  byId: Record<string, { price: number; sku: string }>
}

export function panelPriceFor(
  index: PanelPriceIndex,
  productId: string,
  sku?: string
): number | null {
  const row = index.byId[productId]
  const key = sku?.trim().toLowerCase()
  if (!row || !key || !row.sku || row.sku !== key) return null
  if (!Number.isFinite(row.price) || row.price <= 0) return null
  return row.price
}

type PriceablePlan = { productId: string; sku: string; price: number }
type PriceableMedication = {
  productId?: string
  sku?: string
  price?: number
  plans?: PriceablePlan[]
}
type PriceableProduct = {
  startingPrice: number
  plans?: PriceablePlan[]
  medications?: PriceableMedication[]
}

/** Replace plan prices with the site 614 panel prices. Unmatched plans stay as they are. */
export function withPanelPrices<T extends PriceableProduct>(product: T, index: PanelPriceIndex): T {
  const nextPrice = (productId: string, sku: string | undefined, current: number) =>
    panelPriceFor(index, productId, sku) ?? current

  const plans = product.plans?.map((plan) => ({
    ...plan,
    price: nextPrice(plan.productId, plan.sku, plan.price),
  }))
  const medications = product.medications?.map((med) => {
    const medPlans = med.plans?.map((plan) => ({
      ...plan,
      price: nextPrice(plan.productId, plan.sku, plan.price),
    }))
    const price =
      med.productId != null
        ? nextPrice(med.productId, med.sku, med.price ?? 0)
        : med.price
    return {
      ...med,
      ...(medPlans ? { plans: medPlans } : {}),
      ...(med.productId != null && price != null ? { price } : {}),
    }
  })

  const amounts: number[] = []
  for (const plan of plans ?? []) amounts.push(plan.price)
  for (const med of medications ?? []) {
    if (med.plans?.length) {
      for (const plan of med.plans) amounts.push(plan.price)
    } else if (typeof med.price === 'number') {
      amounts.push(med.price)
    }
  }

  return {
    ...product,
    ...(plans ? { plans } : {}),
    ...(medications ? { medications } : {}),
    startingPrice: amounts.length ? Math.min(...amounts) : product.startingPrice,
  }
}

/** Drop plans the admin has turned off. Returns null when nothing remains to sell. */
export function omitHiddenPlans<T extends PriceableProduct>(
  product: T,
  hidden: ReadonlySet<string>
): T | null {
  if (hidden.size === 0) return product

  const plans = product.plans?.filter((plan) => !hidden.has(plan.productId))
  const medications = product.medications?.flatMap((med) => {
    const medPlans = med.plans?.filter((plan) => !hidden.has(plan.productId))
    const selfHidden = med.productId ? hidden.has(med.productId) : false
    if (medPlans) {
      if (medPlans.length === 0 && (selfHidden || med.productId == null)) return []
      return [{ ...med, plans: medPlans }]
    }
    if (selfHidden) return []
    return [med]
  })

  const hasPlans = (plans?.length ?? 0) > 0
  const hasMeds = (medications?.length ?? 0) > 0
  if (product.plans && !product.medications && !hasPlans) return null
  if (product.medications && !hasMeds && !hasPlans) return null
  if (!hasPlans && !hasMeds) return null

  const amounts: number[] = []
  for (const plan of plans ?? []) amounts.push(plan.price)
  for (const med of medications ?? []) {
    if (med.plans?.length) {
      for (const plan of med.plans) amounts.push(plan.price)
    } else if (typeof med.price === 'number') {
      amounts.push(med.price)
    }
  }

  return {
    ...product,
    ...(plans ? { plans } : {}),
    ...(medications ? { medications } : {}),
    startingPrice: amounts.length ? Math.min(...amounts) : product.startingPrice,
  }
}

function toShopProduct(row: unknown, categoryLabelName: string, category: string): ShopProduct | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const id = text(record.product_id ?? record.id ?? record.uniq_id)
  const name = text(record.product_name ?? record.name)
  const price = money(record.product_price ?? record.price)
  if (!id || !name || price === null) return null
  const sku = text(record.product_sku ?? record.sku) || id
  const supply = supplyFromName(name)
  return {
    slug: productSlug(name, id),
    name,
    category,
    tagline: taglineFor(name, text(record.product_description ?? record.description), categoryLabelName),
    pricingType: 'single',
    plans: [
      {
        label: supply.label,
        sku,
        months: supply.months,
        productId: id,
        checkoutUrl: `${CHECKOUT_ORIGIN}/?id=${encodeURIComponent(id)}`,
        price,
        dosage: '',
      },
    ],
    startingPrice: price,
  }
}
