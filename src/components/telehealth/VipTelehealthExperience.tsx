'use client'

/**
 * Native Juvenex VIP telehealth experience (no PrescribeRx).
 *
 * Flow: Category → Products → Details → Review → Store checkout
 * → WLMD order → pending-forms / order history. Auth required; same catalog
 * flow for free and paid members. Static intake UI is temporarily hidden
 * (clinical intake is post-checkout).
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BrandLogo, { useBrand } from '@/components/BrandLogo'
import BottomNav from '@/components/BottomNav'
import { JxVial } from '@/components/jx/JxVial'
import { useAuth } from '@/lib/auth-context'
import { getStorefrontProductContent } from '@/lib/jx/storefront-product-content'
import type { StorefrontCategoryKey } from '@/lib/jx/storefront-catalog'
import {
  formatVipPrice,
  getVipProduct,
  listVipCategories,
  listVipProductsByCategory,
  type VipProductPlan,
} from '@/lib/telehealth/products'
import {
  clearVipSession,
  readVipSession,
  setStoreBagForVipCheckout,
  writeVipCheckoutPrefill,
  writeVipSession,
  type VipFlowStep,
  type VipTelehealthSession,
} from '@/lib/telehealth/session'

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6]">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-strong)] border-t-transparent"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  )
}

function StepPill({ step }: { step: VipFlowStep }) {
  // Static intake is temporarily hidden — clinical intake is post-checkout (pending-forms).
  const order: VipFlowStep[] = ['categories', 'products', 'details', 'review']
  const labels = ['Goal', 'Product', 'Plan', 'Review']
  const idx = step === 'intake' ? order.indexOf('review') : order.indexOf(step)
  return (
    <ol className="mb-5 flex flex-wrap gap-1.5" aria-label="Progress">
      {labels.map((label, i) => (
        <li
          key={label}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
            i <= idx
              ? 'bg-[var(--accent-strong)] text-white'
              : 'bg-[#EEF1ED] text-[#6B7567]'
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
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

export default function VipTelehealthExperience() {
  const router = useRouter()
  const brand = useBrand()
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()

  const [session, setSession] = useState<VipTelehealthSession | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?next=/telehealth')
    }
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    const id = window.setTimeout(() => {
      const s = readVipSession()
      // Static intake step is hidden — migrate any in-progress intake session forward.
      if (s.step === 'intake') {
        const next = {
          ...s,
          step: (s.plan ? 'review' : 'details') as VipTelehealthSession['step'],
        }
        writeVipSession(next)
        setSession(next)
        return
      }
      setSession(s)
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  const persist = (next: VipTelehealthSession) => {
    setSession(next)
    writeVipSession(next)
  }

  // Category-scoped catalog (same storefront source as Shop). No PrescribeRx.
  const categories = useMemo(() => listVipCategories(), [])
  const productsInCategory = useMemo(() => {
    if (!session?.category) return []
    return listVipProductsByCategory(session.category)
  }, [session?.category])

  const selectedProduct = session?.productSlug
    ? getVipProduct(session.productSlug)
    : null
  const productContent = selectedProduct
    ? getStorefrontProductContent(selectedProduct.slug)
    : null

  if (authLoading || !isAuthenticated || !session) {
    return <Spinner />
  }

  // Authenticated users (including free-tier) get the same VIP catalog flow as
  // paid members. Checkout / member pricing still follow existing store rules.
  const goCategories = () =>
    persist({
      ...session,
      step: 'categories',
      category: null,
      productSlug: null,
      plan: null,
    })

  const pickCategory = (key: StorefrontCategoryKey) =>
    persist({
      ...session,
      step: 'products',
      category: key,
      productSlug: null,
      plan: null,
    })

  const pickProduct = (slug: string) => {
    const product = getVipProduct(slug)
    persist({
      ...session,
      step: 'details',
      productSlug: slug,
      plan: product?.plans[0] ?? null,
    })
  }

  const pickPlan = (plan: VipProductPlan) =>
    persist({ ...session, plan, step: 'details' })

  const continueToReview = () => {
    if (!session.plan || !selectedProduct) return
    persist({ ...session, step: 'review' })
  }

  const continueToCheckout = () => {
    if (!session.plan || !selectedProduct) return
    setSubmitting(true)
    setCheckoutError(null)
    try {
      const [first, ...rest] = (user?.name || '').trim().split(/\s+/).filter(Boolean)
      writeVipCheckoutPrefill({
        firstName: first || '',
        lastName: rest.join(' '),
        phone: user?.phone || '',
        email: user?.email || '',
      })
      // Fulfillment / clinical timeline uses WLMD order APIs after checkout
      // (pending-forms, get-order, get-order-history on /store/account/orders).

      setStoreBagForVipCheckout({
        id: session.plan.productId,
        title: selectedProduct.name,
        subtitle: `${session.plan.label}${session.plan.dosage ? ` · ${session.plan.dosage}` : ''}`,
        price: session.plan.price,
        rawName: selectedProduct.name,
      })

      writeVipSession({ ...session, step: 'review' })
      // Biomax-clean path: bag first, then checkout from the cart page.
      router.push('/store/cart')
    } catch {
      setCheckoutError('Could not start checkout. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-24 text-[#2D352C]">
      <header className="sticky top-0 z-40 border-b border-[#E5EAE3] bg-white/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <BrandLogo size={40} className="rounded-xl bg-white object-contain p-1 shadow-sm" />
            <div>
              <h1 className="text-lg font-bold">{brand.name} VIP</h1>
              <p className="text-xs text-[var(--text-muted)]">Telehealth products</p>
            </div>
          </Link>
          {session.step === 'categories' ? (
            <button
              type="button"
              className="text-sm font-medium text-[#6B7567]"
              onClick={() => {
                clearVipSession()
                setSession(readVipSession())
              }}
            >
              Reset
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      </header>

      <main
        className={`mx-auto px-4 py-5 ${
          session.step === 'products' ? 'max-w-6xl' : 'max-w-lg'
        }`}
      >
        <StepPill step={session.step} />

        {session.step !== 'categories' ? (
          <button
            type="button"
            className="mb-4 text-sm font-semibold text-[var(--accent-strong)]"
            onClick={() => {
              if (session.step === 'products') goCategories()
              else if (session.step === 'details' || session.step === 'intake')
                persist({ ...session, step: 'products', plan: null, productSlug: null })
              else if (session.step === 'review')
                persist({ ...session, step: 'details' })
            }}
          >
            ← Back
          </button>
        ) : null}

        {session.step === 'categories' && (
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">
              What are you looking for?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#4A5347]">
              Choose one goal. We&apos;ll show matching VIP telehealth products
              next — one clear step at a time.
            </p>
            <ul className="mt-6 space-y-3" role="list">
              {categories.map((cat) => (
                <li key={cat.key}>
                  <button
                    type="button"
                    onClick={() => pickCategory(cat.key)}
                    className="flex w-full items-start justify-between rounded-2xl border border-[#E5EAE3] bg-white p-4 text-left shadow-sm transition hover:border-[var(--accent-strong)]"
                  >
                    <span>
                      <span className="block text-base font-bold">{cat.title}</span>
                      <span className="mt-1 block text-sm text-[#6B7567]">
                        {cat.blurb}
                      </span>
                    </span>
                    <span className="ml-3 shrink-0 rounded-full bg-[#EEF1ED] px-2 py-1 text-xs font-bold text-[#4A5347]">
                      {cat.productCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {session.step === 'products' && (
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">
              Choose a product
            </h2>
            <p className="mt-2 text-sm text-[#4A5347]">
              Select one option from this category. You can change your mind
              before checkout.
            </p>
            <p className="mt-3 text-sm font-bold text-[#6B7567]">
              {productsInCategory.length} treatments
            </p>
            <ul
              className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
              role="list"
            >
              {productsInCategory.map((p) => {
                const accent = accentForCategory(p.category)
                return (
                  <li key={p.slug}>
                    <button
                      type="button"
                      onClick={() => pickProduct(p.slug)}
                      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[#E5EAE3] bg-white text-left shadow-sm transition hover:border-[var(--accent-strong)]"
                    >
                      <div
                        className="flex items-center justify-center px-2 pt-3"
                        style={{
                          background:
                            'radial-gradient(ellipse at 50% 20%, #F3F7F1 0%, #FAF9F6 70%)',
                          minHeight: 120,
                        }}
                        aria-hidden="true"
                      >
                        <JxVial accent={accent} height={112} />
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-3">
                        <span className="text-sm font-bold leading-tight sm:text-[15px]">
                          {p.name}
                        </span>
                        <span className="line-clamp-2 text-[11px] leading-snug text-[#6B7567] sm:text-xs">
                          {p.tagline}
                        </span>
                        <span className="mt-1 flex items-baseline gap-1">
                          <span className="text-[11px] text-[#6B7567]">From</span>
                          <span className="text-sm font-semibold">
                            {formatVipPrice(p.startingPrice)}
                          </span>
                        </span>
                        <span className="mt-auto inline-flex min-h-9 items-center justify-center rounded-full bg-[#1F2A1C] px-2 text-xs font-bold text-white sm:text-sm">
                          View options
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {session.step === 'details' && selectedProduct && session.plan && (
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">
              {selectedProduct.name}
            </h2>
            <p className="mt-2 text-sm text-[#4A5347]">
              {productContent?.description || selectedProduct.tagline}
            </p>
            {productContent?.bullets && productContent.bullets.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#4A5347]">
                {productContent.bullets.slice(0, 5).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-5 rounded-2xl border border-[#E5EAE3] bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-[#8B9B83]">
                Choose a plan
              </p>
              <ul className="mt-3 space-y-2">
                {selectedProduct.plans.map((plan) => {
                  const active = plan.productId === session.plan?.productId
                  return (
                    <li key={plan.productId}>
                      <button
                        type="button"
                        onClick={() => pickPlan(plan)}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm ${
                          active
                            ? 'border-[var(--accent-strong)] bg-[#F3F7F1]'
                            : 'border-[#E5EAE3] bg-white'
                        }`}
                      >
                        <span>
                          <span className="font-bold">{plan.label}</span>
                          {plan.dosage ? (
                            <span className="mt-0.5 block text-xs text-[#6B7567]">
                              {plan.dosage}
                            </span>
                          ) : null}
                        </span>
                        <span className="font-bold text-[var(--accent-strong)]">
                          {formatVipPrice(plan.price)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="mt-4 rounded-2xl bg-[#F2EFE7] p-4 text-sm leading-6 text-[#4A5347]">
              <p className="font-bold text-[#2D352C]">Eligibility / next step</p>
              <p className="mt-1">
                Selected: <strong>{selectedProduct.name}</strong> (
                {formatVipPrice(session.plan.price)}). Review your selection,
                then checkout. Clinical intake (if required) happens after
                payment. A licensed provider reviews eligibility before any
                prescription is fulfilled.
              </p>
            </div>

            <button
              type="button"
              onClick={continueToReview}
              className="mt-6 flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--accent-strong)] text-sm font-bold text-white shadow-sm"
            >
              Continue to review
            </button>
          </section>
        )}

        {session.step === 'review' && selectedProduct && session.plan && (
            <section>
              <h2 className="text-2xl font-semibold tracking-tight">Review</h2>
              <p className="mt-2 text-sm text-[#4A5347]">
                Confirm your product, then continue to your bag and checkout. Clinical intake
                happens after payment when required.
              </p>

              <div className="mt-5 space-y-3">
                <div className="rounded-2xl border border-[#E5EAE3] bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#8B9B83]">
                    Product
                  </p>
                  <p className="mt-1 font-bold">{selectedProduct.name}</p>
                  <p className="text-sm text-[#6B7567]">
                    {session.plan.label}
                    {session.plan.dosage ? ` · ${session.plan.dosage}` : ''}
                  </p>
                  <p className="mt-2 text-lg font-bold text-[var(--accent-strong)]">
                    {formatVipPrice(session.plan.price)}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold text-[var(--accent-strong)] underline"
                    onClick={() => persist({ ...session, step: 'details' })}
                  >
                    Edit product
                  </button>
                </div>
              </div>

              {checkoutError ? (
                <p className="mt-3 text-sm text-red-600">{checkoutError}</p>
              ) : null}

              <button
                type="button"
                disabled={submitting}
                onClick={() => continueToCheckout()}
                className="mt-6 flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--accent-strong)] text-sm font-bold text-white shadow-sm disabled:opacity-60"
              >
                {submitting ? 'Preparing bag…' : 'Continue to bag'}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-[var(--text-muted)]">
                Checkout uses the existing Juvenex store payment flow. After
                payment you&apos;ll complete clinical intake (if required) and
                track approval and shipping from your orders.
              </p>
            </section>
          )}
      </main>

      <BottomNav />
    </div>
  )
}
