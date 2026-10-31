import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FamilyDetailClient } from '@/components/jx/store/FamilyDetailClient'
import { omitHiddenPlans, withPanelPrices } from '@/lib/jx/panel-storefront'
import { findLiveProduct, getPanelPriceIndex, getVisibleProductIds } from '@/lib/jx/panel-storefront.server'
import { getStorefrontProduct } from '@/lib/jx/storefront-catalog'

/**
 * Product page. Live panel products resolve first. The generated catalog is
 * the fallback so existing links (/store/p/semaglutide, /store/p/tirzepatide)
 * keep their supply plans and checkout ids when the panel uses a different slug.
 */

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

async function resolveProduct(slug: string) {
  const live = await findLiveProduct(slug)
  if (live) return live
  if (live === null) return undefined
  const fallback = getStorefrontProduct(slug)
  if (!fallback) return undefined
  const [pricedIndex, visible] = await Promise.all([getPanelPriceIndex(), getVisibleProductIds()])
  const priced = withPanelPrices(fallback, pricedIndex)
  if (!visible) return priced
  const hidden = new Set<string>()
  for (const plan of priced.plans ?? []) {
    if (!visible.has(plan.productId)) hidden.add(plan.productId)
  }
  for (const med of priced.medications ?? []) {
    if (med.productId && !visible.has(med.productId)) hidden.add(med.productId)
    for (const plan of med.plans ?? []) {
      if (!visible.has(plan.productId)) hidden.add(plan.productId)
    }
  }
  return omitHiddenPlans(priced, hidden) ?? undefined
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = await resolveProduct(slug)
  if (!product) return { title: 'Product not found' }
  return {
    title: `${product.name} — Shop`,
    description: product.tagline,
  }
}

export default async function FamilyProductPage({ params }: PageProps) {
  const { slug } = await params
  const product = await resolveProduct(slug)
  if (!product) notFound()

  return (
    <div className="jx-shell" style={{ paddingBlock: '22px 64px' }}>
      <nav aria-label="Breadcrumb" style={{ marginBottom: 18 }}>
        <ol
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            fontSize: 12.5,
            color: 'var(--jx-muted)',
          }}
        >
          <li>
            <Link href="/" prefetch={process.env.NODE_ENV === 'production'} style={{ color: 'var(--jx-muted)' }}>
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/store" prefetch={process.env.NODE_ENV === 'production'} style={{ color: 'var(--jx-muted)' }}>
              Shop
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" style={{ color: 'var(--jx-ink)' }}>
            {product.name}
          </li>
        </ol>
      </nav>

      <FamilyDetailClient product={product} />
    </div>
  )
}
