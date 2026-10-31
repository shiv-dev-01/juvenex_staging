import 'server-only'

import { unstable_cache } from 'next/cache'
import { juvenexClient } from '@/lib/juvenex/client'
import { STOREFRONT_CATEGORIES, STOREFRONT_PRODUCTS } from './storefront-catalog'
import { fetchPanelCatalog, fetchPanelPrices } from '@/lib/juvenex/panel-pricing'
import { hiddenProductIds } from '@/lib/juvenex/product-visibility'
import {
  mapPanelCatalog,
  omitHiddenPlans,
  parseCategoryNames,
  parseProductPayload,
  withPanelPrices,
  type PanelPriceIndex,
  type ShopCategory,
  type ShopProduct,
} from './panel-storefront'

/**
 * Live shop catalog.
 *
 * Categories always come from
 *   GET https://panel.whitelabelmd.com/juvenex/api/get-products-category
 * Products come from
 *   GET https://panel.whitelabelmd.com/juvenex/api/get-product-by-category?category_name=
 *
 * That product route is registered, but the panel controller method is missing
 * today (HTTP 500, BadMethodCallException). When that happens we group the
 * existing v1 Get_Products rows by product_category_name — the same catalog
 * the category endpoint lists — so the shop stays dynamic. If both calls fail,
 * the page falls back to the generated storefront catalog and checkout links
 * such as /store/p/semaglutide keep working.
 */

const CATEGORY_URL = 'https://panel.whitelabelmd.com/juvenex/api/get-products-category'
const PRODUCT_URL = 'https://panel.whitelabelmd.com/juvenex/api/get-product-by-category'
const TIMEOUT_MS = 15_000

export type LiveStorefront = {
  categories: ShopCategory[]
  products: ShopProduct[]
  source: 'category-api' | 'product-list' | 'static'
}

async function panelGet(url: string): Promise<{ status: number; text: string; payload: unknown }> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  return { status: response.status, text, payload }
}

async function fetchCategoryNames(): Promise<string[] | null> {
  const { payload } = await panelGet(CATEGORY_URL)
  return parseCategoryNames(payload)
}

async function fetchCategoryProducts(categoryName: string) {
  const url = `${PRODUCT_URL}?category_name=${encodeURIComponent(categoryName)}`
  const { status, text, payload } = await panelGet(url)
  return parseProductPayload(status, text, payload)
}

async function productsFromList(preferredNames: string[]): Promise<LiveStorefront | null> {
  const response = await juvenexClient.getProducts()
  if (response.status !== 1 || !Array.isArray(response.product)) return null

  const productsByCategory: Record<string, unknown[]> = {}
  for (const row of response.product) {
    const name = String(row.product_category_name ?? '').trim() || 'Other'
    if (!productsByCategory[name]) productsByCategory[name] = []
    productsByCategory[name].push(row)
  }

  const categoryNames = preferredNames.length ? preferredNames : Object.keys(productsByCategory)
  const mapped = mapPanelCatalog({ categoryNames, productsByCategory })
  if (!mapped.products.length) return null
  return { ...mapped, source: 'product-list' }
}

async function loadLiveStorefront(): Promise<LiveStorefront> {
  try {
    const categoryNames = (await fetchCategoryNames()) ?? []
    if (categoryNames.length) {
      const probe = await fetchCategoryProducts(categoryNames[0])
      if (probe.kind === 'products') {
        const productsByCategory: Record<string, unknown[]> = {
          [categoryNames[0]]: probe.rows,
        }
        const rest = await Promise.all(
          categoryNames.slice(1).map(async (name) => {
            const result = await fetchCategoryProducts(name)
            return [name, result.kind === 'products' ? result.rows : []] as const
          })
        )
        for (const [name, rows] of rest) productsByCategory[name] = rows
        const mapped = mapPanelCatalog({ categoryNames, productsByCategory })
        if (mapped.products.length) return { ...mapped, source: 'category-api' }
      } else if (probe.kind === 'missing-method') {
        console.warn(
          '[jx] get-product-by-category is not implemented on the panel; grouping Get_Products by category'
        )
      }
    }

    const fromList = await productsFromList(categoryNames)
    if (fromList) return fromList
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error('[jx] live storefront failed:', message)
  }

  return {
    categories: STOREFRONT_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      navLabel: category.navLabel,
    })),
    products: STOREFRONT_PRODUCTS,
    source: 'static',
  }
}

const getCachedLiveStorefront = unstable_cache(loadLiveStorefront, ['jx-live-storefront-v1'], {
  revalidate: 300,
})

const EMPTY_PRICE_INDEX: PanelPriceIndex = { byId: {} }

async function loadPanelPriceIndex(): Promise<PanelPriceIndex> {
  try {
    const catalog = await fetchPanelCatalog()
    const ids = [...catalog.keys()]
    let live: Record<string, string> = {}
    try {
      live = await fetchPanelPrices(ids)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error('[jx] site 614 price refresh failed:', message)
    }

    const byId: PanelPriceIndex['byId'] = {}
    for (const [id, product] of catalog) {
      const raw = live[id] || product.product_price
      const amount = Number(String(raw).replace(/[$,]/g, '').trim())
      const sku = product.product_sku.trim().toLowerCase()
      if (!sku || !Number.isFinite(amount) || amount <= 0) continue
      byId[id] = { price: amount, sku }
    }
    return { byId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error('[jx] site 614 price index failed:', message)
    return EMPTY_PRICE_INDEX
  }
}

/** Site 614 prices. Refreshed immediately after an admin price update. */
export const getPanelPriceIndex = unstable_cache(loadPanelPriceIndex, ['jx-panel-price-index-v2'], {
  revalidate: 30,
  tags: ['jx-panel-prices'],
})

/** Priced catalog, including products an admin has turned off. */
export async function getPricedStorefront(): Promise<LiveStorefront> {
  const catalog = await getCachedLiveStorefront()
  const prices = await getPanelPriceIndex()
  return {
    ...catalog,
    products: catalog.products.map((product) => withPanelPrices(product, prices)),
  }
}

export async function getLiveStorefront(): Promise<LiveStorefront> {
  const catalog = await getPricedStorefront()
  const hidden = hiddenProductIds()
  if (hidden.size === 0) return catalog
  return {
    ...catalog,
    products: catalog.products.flatMap((product) => {
      const visible = omitHiddenPlans(product, hidden)
      return visible ? [visible] : []
    }),
  }
}

/** `null` when the product exists but an admin has turned it off. */
export async function findLiveProduct(slug: string): Promise<ShopProduct | null | undefined> {
  const catalog = await getPricedStorefront()
  const product = catalog.products.find((item) => item.slug === slug)
  if (!product) return undefined
  return omitHiddenPlans(product, hiddenProductIds())
}
