'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FamilyProductCard } from '@/components/jx/store/FamilyProductCard'
import type {
  StorefrontCategory,
  StorefrontCategoryKey,
  StorefrontProduct,
} from '@/lib/jx/storefront-catalog'
import s from '@/components/jx/store/store.module.css'

/**
 * Client-side store browser so category chips filter instantly without an RSC
 * round-trip. Honors ?q= from header search against product name/slug/tagline.
 */

interface StoreBrowserProps {
  products: StorefrontProduct[]
  categories: StorefrontCategory[]
  initialCategory: StorefrontCategoryKey | null
}

function productMatchesQuery(product: StorefrontProduct, q: string): boolean {
  if (!q) return true
  const medNames =
    product.pricingType === 'medications'
      ? (product.medications ?? []).map((m) => m.name).join(' ')
      : ''
  const haystack = [product.name, product.slug, product.tagline, product.category, medNames]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

export function StoreBrowser(props: StoreBrowserProps) {
  return (
    <Suspense fallback={<StoreBrowserFallback />}>
      <StoreBrowserInner {...props} />
    </Suspense>
  )
}

function StoreBrowserFallback() {
  return (
    <div className="jx-shell" style={{ paddingBlock: '26px 64px' }}>
      <div className="jx-skeleton" style={{ height: 160, borderRadius: 'var(--jx-r-md)' }} />
    </div>
  )
}

function StoreBrowserInner({ products, categories, initialCategory }: StoreBrowserProps) {
  const searchParams = useSearchParams()
  const searchQ = (searchParams.get('q') ?? '').trim()
  const rawCategory = searchParams.get('category')
  const urlCategory =
    rawCategory && categories.some((c) => c.key === rawCategory)
      ? (rawCategory as StorefrontCategoryKey)
      : null

  const [category, setCategory] = useState<StorefrontCategoryKey | null>(
    urlCategory ?? initialCategory
  )

  // Header search uses router.push — sync category when URL changes.
  useEffect(() => {
    if (searchParams.has('category')) {
      setCategory(urlCategory)
    } else if (searchParams.has('q')) {
      setCategory(null)
    }
  }, [searchParams, urlCategory])

  const selectCategory = useCallback(
    (key: StorefrontCategoryKey | null) => {
      setCategory(key)
      const params = new URLSearchParams()
      if (key) params.set('category', key)
      if (searchQ) params.set('q', searchQ)
      const qs = params.toString()
      window.history.replaceState(window.history.state, '', qs ? `/store?${qs}` : '/store')
    },
    [searchQ]
  )

  const visible = useMemo(() => {
    return products.filter((p) => {
      if (category && p.category !== category) return false
      return productMatchesQuery(p, searchQ)
    })
  }, [products, category, searchQ])

  const activeLabel = categories.find((c) => c.key === category)?.label ?? 'All treatments'

  return (
    <div className="jx-shell" style={{ paddingBlock: '26px 64px' }}>
      <nav aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
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
            <Link href="/" style={{ color: 'var(--jx-muted)' }}>
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" style={{ color: 'var(--jx-ink)' }}>
            Shop
          </li>
        </ol>
      </nav>

      <header style={{ maxWidth: 720, marginBottom: 24 }}>
        <p className="jx-eyebrow" style={{ margin: '0 0 10px' }}>
          Prescription treatments
        </p>
        <h1
          className="jx-display"
          style={{ fontSize: 'clamp(32px, 5vw, 52px)', lineHeight: 1.03, margin: 0 }}
        >
          {activeLabel}
        </h1>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.6, color: 'var(--jx-body)' }}>
          Browse by category, choose a supply option, and add to your bag. Checkout uses the
          existing Juvenex payment flow.
        </p>
        {searchQ ? (
          <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--jx-muted)' }}>
            Showing results for &ldquo;{searchQ}&rdquo;
          </p>
        ) : null}
      </header>

      <nav aria-label="Product categories" className={s.chips} style={{ marginBottom: 22 }}>
        <CategoryChip
          label="All"
          active={category === null}
          onClick={() => selectCategory(null)}
        />
        {categories.map((c) => (
          <CategoryChip
            key={c.key}
            label={c.navLabel}
            active={category === c.key}
            onClick={() => selectCategory(c.key)}
          />
        ))}
      </nav>

      <section className={s.results} aria-labelledby="jx-results-heading">
        <p
          id="jx-results-heading"
          style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--jx-muted)' }}
        >
          <strong style={{ color: 'var(--jx-ink)', fontWeight: 600 }}>
            {visible.length} {visible.length === 1 ? 'treatment' : 'treatments'}
          </strong>
        </p>
        {visible.length ? (
          <div className={s.grid}>
            {visible.map((product) => (
              <FamilyProductCard key={product.slug} product={product} />
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--jx-muted)' }}>
            {searchQ
              ? `No treatments match “${searchQ}”. Try another search or browse all.`
              : 'No treatments in this category yet.'}
          </p>
        )}
      </section>
    </div>
  )
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={s.chip}
      aria-pressed={active}
      onClick={onClick}
      style={
        active
          ? {
              background: 'var(--jx-brand)',
              color: '#fff',
              borderColor: 'var(--jx-brand)',
              cursor: 'pointer',
            }
          : { cursor: 'pointer' }
      }
    >
      {label}
    </button>
  )
}
