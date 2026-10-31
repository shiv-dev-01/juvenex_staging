'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { formatUsd } from '@/lib/jx/catalog'
import { getStorefrontProductContent } from '@/lib/jx/storefront-product-content'
import { useJxStore } from '@/components/jx/JxStore'
import { JxVial } from '@/components/jx/JxVial'
import { CheckIcon } from '@/components/jx/icons'
import type { ShopProduct } from '@/lib/jx/panel-storefront'
import type { StorefrontMedication, StorefrontPlan } from '@/lib/jx/storefront-catalog'
import { FamilyProductContent } from './FamilyProductContent'
import { useAuthGatedAdd } from './useAuthGatedAdd'
import {
  captureTrackingParams,
  fireQuestionnaireWebhook,
} from '@/lib/jx/questionnaireWebhook'

export function FamilyDetailClient({ product }: { product: ShopProduct }) {
  const { has, hydrated } = useJxStore()
  const { addOrSignIn, authLoading } = useAuthGatedAdd()
  const content = useMemo(() => getStorefrontProductContent(product.slug), [product.slug])

  const initialMed =
    product.pricingType === 'medications' ? product.medications?.[0] ?? null : null
  const [medIndex, setMedIndex] = useState(0)
  const activeMed: StorefrontMedication | null =
    product.pricingType === 'medications'
      ? product.medications?.[medIndex] ?? initialMed
      : null

  const plans: StorefrontPlan[] = useMemo(() => {
    if (product.pricingType === 'single') return product.plans ?? []
    return activeMed?.plans ?? []
  }, [product, activeMed])

  const [planIndex, setPlanIndex] = useState(0)
  const activePlan = plans[Math.min(planIndex, Math.max(0, plans.length - 1))] ?? null

  // Plans page open → fire webhook immediately (once per product).
  useEffect(() => {
    captureTrackingParams()
    void fireQuestionnaireWebhook(`page:store-plans:${product.slug}`)
  }, [product.slug])

  // Persist selected plan/dose into questionnaire payload and notify webhook.
  useEffect(() => {
    if (!activePlan) return
    const doseLabel = activePlan.dosage || activePlan.label || ''
    const medLabel = activeMed?.name || product.name || ''
    void fireQuestionnaireWebhook(`field:plan:${product.slug}:${activePlan.productId}`, {
      selectedFinalMedication: medLabel,
      selectedDosage: doseLabel,
    })
  }, [activePlan, activeMed, product.name, product.slug])

  const onSelectMed = (index: number) => {
    setMedIndex(index)
    setPlanIndex(0)
  }

  if (!activePlan) {
    return (
      <p style={{ color: 'var(--jx-muted)' }}>
        No checkout-mapped options are available for this product.
      </p>
    )
  }

  const inBag = hydrated && has(activePlan.productId)

  return (
    <div
      style={{
        display: 'grid',
        gap: 28,
        gridTemplateColumns: 'minmax(0, 1fr)',
      }}
    >
      <div className="jx-card" style={{ padding: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 160px' }}>
          <JxVial accent="#8FA888" height={168} />
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <p className="jx-eyebrow" style={{ margin: '0 0 8px' }}>
            {product.tagline}
          </p>
          <h1 className="jx-display" style={{ margin: '0 0 10px', fontSize: 32 }}>
            {product.name}
          </h1>
          <p style={{ margin: 0, color: 'var(--jx-body)', lineHeight: 1.55, fontSize: 15 }}>
            Choose a supply length
            {product.pricingType === 'medications' ? ' and formulation' : ''}. Each option maps to
            a specific Juvenex SKU for checkout.
          </p>
        </div>
      </div>

      {product.pricingType === 'medications' && (product.medications?.length ?? 0) > 1 ? (
        <section aria-labelledby="jx-med-h">
          <h2 id="jx-med-h" className="jx-eyebrow" style={{ marginBottom: 12 }}>
            Variation
          </h2>
          <VariationSelect
            label="Variation"
            value={String(medIndex)}
            onChange={(value) => onSelectMed(Number(value))}
          >
            {product.medications?.map((med, index) => (
              <option key={`${med.name}-${index}`} value={index}>
                {med.name}
              </option>
            ))}
          </VariationSelect>
        </section>
      ) : null}

      {plans.length > 1 ? (
        <section aria-labelledby="jx-plan-h">
          <h2 id="jx-plan-h" className="jx-eyebrow" style={{ marginBottom: 12 }}>
            Select plan
          </h2>
          <VariationSelect
            label="Plan"
            value={String(Math.min(planIndex, plans.length - 1))}
            onChange={(value) => setPlanIndex(Number(value))}
          >
            {plans.map((plan, index) => (
              <option key={plan.productId} value={index}>
                {[plan.label, plan.dosage, formatUsd(plan.price)].filter(Boolean).join(' · ')}
              </option>
            ))}
          </VariationSelect>
        </section>
      ) : null}

      <div className="jx-card" style={{ padding: 18 }}>
        <dl
          style={{
            display: 'grid',
            gap: 8,
            margin: '0 0 16px',
            fontSize: 13.5,
            color: 'var(--jx-body)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <dt style={{ color: 'var(--jx-muted)' }}>SKU</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{activePlan.sku}</dd>
          </div>
          {activePlan.dosage ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: 'var(--jx-muted)' }}>Dosage</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{activePlan.dosage}</dd>
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <dt style={{ color: 'var(--jx-muted)' }}>Total</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{formatUsd(activePlan.price)}</dd>
          </div>
        </dl>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            className={`jx-btn ${inBag ? 'jx-btn-ghost' : 'jx-btn-primary'}`}
            disabled={!hydrated || authLoading || inBag}
            onClick={() => {
              if (inBag) return
              addOrSignIn({
                id: activePlan.productId,
                title: product.name,
                subtitle: [activeMed?.name, activePlan.label, activePlan.dosage]
                  .filter(Boolean)
                  .join(' · '),
                price: activePlan.price,
                rawName: `${product.name} (${activePlan.sku})`,
              })
            }}
          >
            {inBag ? (
              <>
                <CheckIcon /> In bag
              </>
            ) : (
              'Add to bag'
            )}
          </button>
          {inBag ? (
            <Link href="/store/cart" className="jx-btn jx-btn-primary">
              Go to bag
            </Link>
          ) : null}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--jx-muted)' }}>
          Sign in is required to add items. After adding, you&rsquo;ll review your bag, then check
          out.
        </p>
      </div>

      {content ? <FamilyProductContent content={content} /> : null}
    </div>
  )
}

function VariationSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label style={{ display: 'block' }}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: '100%',
          appearance: 'none',
          WebkitAppearance: 'none',
          borderRadius: 999,
          border: '2px solid var(--jx-line, #E5EAE3)',
          backgroundColor: '#fff',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%232D352C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 18px center',
          color: 'var(--jx-ink)',
          fontWeight: 600,
          fontSize: 15,
          padding: '14px 46px 14px 18px',
          cursor: 'pointer',
          transition: 'border-color .2s ease, box-shadow .2s ease',
        }}
        onFocus={(event) => {
          event.currentTarget.style.borderColor = 'var(--jx-brand, #6B8F71)'
          event.currentTarget.style.boxShadow = '0 0 0 4px rgba(107, 143, 113, 0.15)'
        }}
        onBlur={(event) => {
          event.currentTarget.style.borderColor = 'var(--jx-line, #E5EAE3)'
          event.currentTarget.style.boxShadow = 'none'
        }}
      >
        {children}
      </select>
    </label>
  )
}
