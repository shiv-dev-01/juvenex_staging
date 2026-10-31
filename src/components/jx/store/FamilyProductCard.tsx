'use client'

import Link from 'next/link'
import { formatUsd } from '@/lib/jx/catalog'
import { JxVial } from '@/components/jx/JxVial'
import type { ShopProduct } from '@/lib/jx/panel-storefront'

/** Catalogue card for one shop treatment. */
export function FamilyProductCard({ product }: { product: ShopProduct }) {
  return (
    <article
      className="jx-card"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="jx-card-art">
        <JxVial
          accent={accentForCategory(product.category)}
          label={undefined}
          height={168}
        />
      </div>
      <div
        style={{
          padding: '15px 15px 17px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          flex: 1,
        }}
      >
        <h3 className="jx-display" style={{ fontSize: 19, margin: 0, lineHeight: 1.15 }}>
          <Link
            href={`/store/p/${product.slug}`}
            // Dev: prefetch compiles every PDP at once and stalls the server.
            // Prod: pages are force-static — click navigation stays fast.
            prefetch={process.env.NODE_ENV === 'production'}
            style={{ color: 'var(--jx-ink)', textDecoration: 'none' }}
          >
            <span
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, zIndex: 1 }}
            />
            {product.name}
          </Link>
        </h3>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--jx-muted)', lineHeight: 1.4 }}>
          {product.tagline}
        </p>
        <p style={{ margin: '2px 0 0', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--jx-muted)' }}>From</span>
          <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--jx-ink)' }}>
            {formatUsd(product.startingPrice)}
          </span>
        </p>
        <span
          className="jx-btn jx-btn-primary"
          style={{
            marginTop: 'auto',
            position: 'relative',
            zIndex: 2,
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          View options
        </span>
      </div>
    </article>
  )
}

function accentForCategory(category: string): string {
  switch (category) {
    case 'weight-loss':
      return '#8FA888'
    case 'hrt':
      return '#6B8F71'
    case 'longevity':
      return '#7A9E8E'
    case 'sexual-wellness':
      return '#9A8B7A'
    case 'hair-skin':
      return '#8B9A8F'
    default:
      return '#8FA888'
  }
}
