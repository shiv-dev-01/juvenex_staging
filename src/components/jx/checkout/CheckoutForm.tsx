'use client'

/**
 * The /store/checkout form and its submission orchestration.
 *
 * MONEY MODEL — READ THIS FIRST
 * Card data is collected by Stripe's PaymentElement, inside Stripe's iframe;
 * it never enters this component, this origin, or our servers. The bag is paid
 * for by ONE PaymentIntent covering the whole cart:
 *
 *   1. `/api/juvenex/orders/create-intent` prices the bag server-side (the
 *      client never names an amount) and returns a client secret for an intent
 *      created with capture_method: 'manual'.
 *   2. `stripe.confirmPayment` AUTHORIZES that intent — the money is held, not
 *      taken. Status becomes `requires_capture`.
 *   3. `/api/juvenex/orders/finalize` calls the vendor once per line, all N
 *      calls carrying the same intent id as `payment_token`, then captures on
 *      full success or cancels the hold on any failure.
 *
 * So the multi-line loop still exists — it just runs on the server, where it
 * can be atomic with the money. The customer is either charged with a complete
 * set of orders, or not charged at all.
 *
 * WHY ONE INTENT AND NOT ONE PER LINE
 * A PaymentElement is bound to a single client secret for its lifetime.
 * Per-line intents would mean re-mounting it — and re-typing the card — for
 * every item in the bag.
 *
 * STATE LIVES IN THE OUTER COMPONENT
 * `<Elements>` re-mounts whenever the client secret changes (a coupon edit
 * re-prices the bag). Everything the customer has typed is therefore held here,
 * in `CheckoutForm`, and passed down — a re-mount must never clear the address
 * they already filled in.
 *
 * A `submittingRef` guard (not just the `disabled` prop) stops a double-click
 * or double-Enter from firing a second pass before React re-renders the
 * disabled button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { useAuth } from '@/lib/auth-context'
import { useJxStore, type BagLine } from '@/components/jx/JxStore'
import { finalizeOrderLineSchema } from '@/lib/juvenex/schemas'
import { formatUsd } from '@/lib/jx/catalog'
import { LockIcon, SpinnerIcon } from '@/components/jx/icons'
import { BagLineRow } from './BagLineRow'
import { CartCouponControl } from './CartCouponControl'
import { CommerceProgress } from './CommerceProgress'
import { DummyCardCheckout, useDummyCardCheckout } from './DummyCardCheckout'
import { FormField } from './FormField'
import { GoogleAddressAutocomplete } from './GoogleAddressAutocomplete'
import { OrderResultsPanel } from './OrderResultsPanel'
import {
  CHECKOUT_SUCCESS_KEY,
  EMPTY_FIELDS,
  type CheckoutFields,
  type CouponState,
  type LineResult,
  type StoredCheckoutSuccess,
} from './types'

/**
 * Stripe.js is loaded once per page, lazily, and only when a publishable key
 * exists. `loadStripe` injects a <script> as a side effect, so calling it at
 * module scope unconditionally would fetch Stripe on every route that pulls
 * this file into a shared chunk.
 */
let stripePromise: Promise<Stripe | null> | null = null
function getStripePromise(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!key || key.includes('placeholder') || key.includes('your_stripe')) return null
  if (!stripePromise) stripePromise = loadStripe(key)
  return stripePromise
}

const FIELD_LABELS: Record<keyof CheckoutFields, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  address: 'Address',
  address2: 'Address line 2',
  cityName: 'City',
  stateName: 'State',
  zipCode: 'ZIP / postal code',
  billingSameAsShipping: 'Billing address',
  billingAddress: 'Billing address',
  billingCityName: 'Billing city',
  billingStateName: 'Billing state',
  billingZipCode: 'Billing ZIP',
}

/** zod path (upstream schema key) -> our field key, so schema errors land on the right input. */
const SCHEMA_TO_FIELD: Record<string, keyof CheckoutFields> = {
  first_name: 'firstName',
  last_name: 'lastName',
  phone: 'phone',
  address: 'address',
  address2: 'address2',
  city_name: 'cityName',
  state_name: 'stateName',
  zip_code: 'zipCode',
  billingSameAsShipping: 'billingSameAsShipping',
  billing_address: 'billingAddress',
  billing_city_name: 'billingCityName',
  billing_state_name: 'billingStateName',
  billing_zip_code: 'billingZipCode',
}

type FieldErrors = Partial<Record<keyof CheckoutFields, string>>

interface IntentState {
  clientSecret: string
  intentId: string
  breakdown: { subtotal_cents: number; discount_cents: number; total_cents: number }
}

/** Builds one line of the finalize payload. Carries no price — the server prices the bag. */
function buildLinePayload(
  line: BagLine,
  fields: CheckoutFields,
  email: string,
  origin: string
): Record<string, unknown> {
  const billingNo = fields.billingSameAsShipping === 'NO'
  return {
    email,
    first_name: fields.firstName.trim(),
    last_name: fields.lastName.trim(),
    phone: fields.phone.trim(),
    address: fields.address.trim(),
    address2: fields.address2.trim() || undefined,
    city_name: fields.cityName.trim(),
    state_name: fields.stateName.trim(),
    zip_code: fields.zipCode.trim(),
    start_url: `${origin}/store/${line.id}`,
    billingSameAsShipping: fields.billingSameAsShipping,
    billing_address: billingNo ? fields.billingAddress.trim() : undefined,
    billing_city_name: billingNo ? fields.billingCityName.trim() : undefined,
    billing_state_name: billingNo ? fields.billingStateName.trim() : undefined,
    billing_zip_code: billingNo ? fields.billingZipCode.trim() : undefined,
    product_id: line.id,
  }
}

/**
 * Mirrors the server schema client-side by literally running it, so the rules
 * can never drift from what the API route enforces. Validated against the
 * first bag line — the shared shipping/billing fields are identical across
 * every line's payload.
 */
function validateFields(
  fields: CheckoutFields,
  email: string,
  origin: string,
  firstLine: BagLine
): FieldErrors {
  const payload = buildLinePayload(firstLine, fields, email, origin)
  const result = finalizeOrderLineSchema.safeParse(payload)
  const errors: FieldErrors = {}
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = SCHEMA_TO_FIELD[String(issue.path[0])]
      if (key && !errors[key]) errors[key] = issue.message
    }
  }
  const phoneDigits = fields.phone.replace(/\D/g, '')
  if (phoneDigits.length > 0 && phoneDigits.length !== 10) {
    errors.phone = 'Enter a 10-digit phone number'
  }
  if (fields.zipCode.replace(/\D/g, '').length > 6) {
    errors.zipCode = 'ZIP can be at most 6 digits'
  }
  if (fields.billingSameAsShipping === 'NO' && fields.billingZipCode.replace(/\D/g, '').length > 6) {
    errors.billingZipCode = 'ZIP can be at most 6 digits'
  }
  return errors
}

function authHeaders(): Record<string, string> {
  const token = typeof window === 'undefined' ? null : window.localStorage.getItem('auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/* ------------------------------------------------------------ outer shell -- */

export function CheckoutForm() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const { lines, subtotal, remove, hydrated } = useJxStore()

  const [fields, setFields] = useState<CheckoutFields>(EMPTY_FIELDS)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [coupons, setCoupons] = useState<Record<string, CouponState>>({})
  const [results, setResults] = useState<LineResult[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [intent, setIntent] = useState<IntentState | null>(null)
  const [intentError, setIntentError] = useState<string | null>(null)
  const [intentLoading, setIntentLoading] = useState(false)

  const prefilledRef = useRef(false)
  const useDummyCard = useDummyCardCheckout()
  // Stripe path stays in this file but is gated off while dummy card is active.
  const stripe = useDummyCard ? null : getStripePromise()

  // Prefill from VIP telehealth intake when present, else signed-in profile.
  // Never overwrite fields the customer has already typed.
  useEffect(() => {
    if (prefilledRef.current) return
    prefilledRef.current = true
    type VipCheckoutPrefill = {
      firstName?: string
      lastName?: string
      phone?: string
    }
    let vipPrefill: VipCheckoutPrefill | null = null
    try {
      const raw = sessionStorage.getItem('jx.telehealth.checkoutPrefill.v1')
      if (raw) vipPrefill = JSON.parse(raw) as VipCheckoutPrefill
    } catch {
      /* ignore */
    }
    const [first, ...rest] = (user?.name || '').trim().split(/\s+/).filter(Boolean)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill; not derivable during render.
    setFields((f) => ({
      ...f,
      firstName: f.firstName || vipPrefill?.firstName || first || '',
      lastName: f.lastName || vipPrefill?.lastName || rest.join(' '),
      phone: f.phone || (vipPrefill?.phone || user?.phone || '').replace(/\D/g, '').slice(0, 10),
    }))
  }, [user])

  // The set of applied coupons, as a stable string, so the effect below re-runs
  // when a code is applied or removed but not on every keystroke in the input.
  const appliedCouponKey = useMemo(
    () =>
      Object.entries(coupons)
        .filter(([, c]) => c.status === 'applied' && c.appliedCode)
        .map(([productId, c]) => `${productId}:${c.appliedCode}`)
        .sort()
        .join('|'),
    [coupons]
  )
  const lineKey = useMemo(() => lines.map((l) => l.id).join('|'), [lines])

  /**
   * Re-price the bag whenever its contents or coupons change.
   *
   * Each call creates a NEW intent, which changes the client secret and
   * therefore re-mounts the PaymentElement. That is why this is keyed on the
   * APPLIED coupon set rather than the raw input: a re-mount clears any card
   * details already entered, so it must happen as rarely as possible.
   *
   * Skipped entirely while dummy-card checkout is active (no Stripe intent).
   */
  useEffect(() => {
    if (useDummyCard || !isAuthenticated || lines.length === 0 || !stripe) return
    let cancelled = false

    // eslint-disable-next-line react-hooks/set-state-in-effect -- server round-trip; the amount is not derivable during render.
    setIntentLoading(true)
    setIntentError(null)

    const couponPayload = Object.entries(coupons)
      .filter(([, c]) => c.status === 'applied' && c.appliedCode)
      .map(([productId, c]) => ({ product_id: Number(productId), code: c.appliedCode as string }))

    void (async () => {
      try {
        const res = await fetch('/api/juvenex/orders/create-intent', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            lines: lines.map((l) => ({ product_id: Number(l.id) })),
            coupons: couponPayload,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !json.clientSecret) {
          setIntent(null)
          setIntentError(
            json.message ||
              json.error ||
              'Payment could not be set up right now. No card has been charged.'
          )
          return
        }
        setIntent({
          clientSecret: json.clientSecret,
          intentId: json.intentId,
          breakdown: json.breakdown,
        })
      } catch {
        if (!cancelled) {
          setIntent(null)
          setIntentError('Could not reach the payment system. No card has been charged.')
        }
      } finally {
        if (!cancelled) setIntentLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // `coupons` is intentionally absent: appliedCouponKey is its stable projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDummyCard, isAuthenticated, lineKey, appliedCouponKey, stripe, lines.length])

  function setField<K extends keyof CheckoutFields>(key: K, value: CheckoutFields[K]) {
    setFields((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }

  // ---- gates -------------------------------------------------------------

  if (!hydrated || authLoading) {
    return (
      <div className="jx-shell" style={{ paddingBlock: 60 }}>
        <div className="jx-skeleton" style={{ height: 220, borderRadius: 'var(--jx-r-md)' }} />
      </div>
    )
  }

  if (lines.length === 0) {
    return (
      <div className="jx-shell" style={{ paddingBlock: 60, textAlign: 'center' }}>
        {/* Every reachable state of this route needs its own h1 — an empty bag
            is a page a visitor can land on directly, not just a transient. */}
        <h1 className="jx-display" style={{ fontSize: 24, marginBottom: 10 }}>
          Checkout
        </h1>
        <p style={{ color: 'var(--jx-muted)', marginBottom: 18 }}>
          Your bag is empty, so there&rsquo;s nothing to check out yet.
        </p>
        <Link href="/store" className="jx-btn jx-btn-primary">
          Browse the store
        </Link>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="jx-shell" style={{ paddingBlock: 60, maxWidth: 440, marginInline: 'auto', textAlign: 'center' }}>
        <h1 className="jx-display" style={{ fontSize: 24, marginBottom: 10 }}>
          Sign in to check out
        </h1>
        <p style={{ color: 'var(--jx-muted)', marginBottom: 22, fontSize: 14 }}>
          Orders are placed under your Juvenex account so a licensed provider can review them. Sign
          in and we&rsquo;ll bring you right back here with your bag intact.
        </p>
        <Link href="/login?next=/store/checkout" className="jx-btn jx-btn-primary" style={{ width: '100%' }}>
          Sign in to continue
        </Link>
        <p style={{ marginTop: 14, fontSize: 13 }}>
          New here?{' '}
          <Link href="/register?next=/store/checkout" style={{ color: 'var(--jx-brand)', fontWeight: 600 }}>
            Create an account
          </Link>
        </p>
      </div>
    )
  }

  const summary = (
    <>
      <CommerceProgress current="checkout" />
      <h1 className="jx-display" style={{ fontSize: 32, margin: 0 }}>
        Checkout
      </h1>

      <div
        className="jx-card"
        role="note"
        style={{ padding: 16, fontSize: 13.5, color: 'var(--jx-body)', display: 'flex', gap: 10 }}
      >
        <LockIcon size={18} />
        <span>
          {useDummyCard
            ? 'Enter your card details below to place each item as its own order for prescription review. Use a test/dummy card while Stripe is disabled on this environment.'
            : 'Your card is entered securely with Stripe and charged once for the whole bag. Each item is still placed as its own order for prescription review — if any of them can\u2019t be placed, the payment is released and you are not charged at all.'}
        </span>
      </div>

      <section aria-labelledby="jx-order-summary-h">
        <h2 id="jx-order-summary-h" className="jx-eyebrow" style={{ marginBottom: 12 }}>
          Order summary &middot; {lines.length} {lines.length === 1 ? 'item' : 'items'}
        </h2>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lines.map((line) => (
            <BagLineRow key={line.id} line={line} />
          ))}
        </ul>

        {/* Single cart promo (IdunRX-style check_coupons_v3). Per-line CouponControl is hidden. */}
        <div style={{ marginTop: 12 }}>
          <CartCouponControl
            productIds={lines.map((l) => l.id)}
            email={user?.email ?? ''}
            coupons={coupons}
            onChange={setCoupons}
            disabled={submitting}
          />
        </div>

        {/* Totals: Stripe path uses server intent breakdown; dummy path uses bag + coupon. */}
        <div style={{ marginTop: 14, fontSize: 15, textAlign: 'right' }}>
          {intent && !useDummyCard ? (
            <>
              <p style={{ margin: 0, color: 'var(--jx-muted)' }}>
                Subtotal: {formatUsd(intent.breakdown.subtotal_cents / 100)}
              </p>
              {intent.breakdown.discount_cents > 0 ? (
                <p style={{ margin: '4px 0 0', color: 'var(--jx-brand)' }}>
                  Discount: &minus;{formatUsd(intent.breakdown.discount_cents / 100)}
                </p>
              ) : null}
              <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
                Total: {formatUsd(intent.breakdown.total_cents / 100)}
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--jx-muted)' }}>
              Subtotal before any coupons: {formatUsd(subtotal)}
            </p>
          )}
        </div>
      </section>

      {results && results.length > 0 ? (
        <section aria-labelledby="jx-results-h">
          <h2 id="jx-results-h" className="jx-eyebrow" style={{ marginBottom: 12 }}>
            Order results
          </h2>
          <OrderResultsPanel results={results} />
        </section>
      ) : null}
    </>
  )

  const shell = (children: React.ReactNode) => (
    <div className="jx-shell jx-checkout" style={{ paddingBlock: 40, display: 'grid', gap: 32, gridTemplateColumns: 'minmax(0,1fr)', maxWidth: 720, width: '100%', marginInline: 'auto', boxSizing: 'border-box' }}>
      {summary}
      {children}
    </div>
  )

  // IdunRX-style dummy card → Create_Order (Stripe path kept below, gated off).
  if (useDummyCard) {
    return shell(
      <DummyCardCheckout
        fields={fields}
        setFields={setFields}
        errors={errors}
        setErrors={setErrors}
        coupons={coupons}
        email={user?.email ?? ''}
        lines={lines}
        subtotal={subtotal}
        submitting={submitting}
        setSubmitting={setSubmitting}
        submitError={submitError}
        setSubmitError={setSubmitError}
        setResults={setResults}
        remove={remove}
      />
    )
  }

  // No publishable key in this environment — the form would be a dead end, so
  // say so plainly instead of rendering inputs that cannot submit.
  if (!stripe) {
    return shell(
      <div className="jx-card" role="alert" style={{ padding: 20, borderColor: '#b3261e' }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#b3261e' }}>
          Payment not yet configured — contact support
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--jx-muted)' }}>
          Checkout is temporarily unavailable on this environment. Your bag has been saved and
          nothing has been charged.
        </p>
      </div>
    )
  }

  if (intentError) {
    return shell(
      <div className="jx-card" role="alert" style={{ padding: 20, borderColor: '#b3261e' }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#b3261e' }}>{intentError}</p>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--jx-muted)' }}>
          Your bag has been saved. Try again in a moment, or contact support if this persists.
        </p>
      </div>
    )
  }

  if (!intent || intentLoading) {
    return shell(
      <div aria-live="polite" aria-busy="true">
        <div className="jx-skeleton" style={{ height: 260, borderRadius: 'var(--jx-r-md)' }} />
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--jx-muted)' }}>
          Preparing secure payment&hellip;
        </p>
      </div>
    )
  }

  return shell(
    // Keyed on the client secret so a re-priced bag mounts a fresh Elements
    // tree rather than trying to retarget the existing one.
    <Elements
      key={intent.clientSecret}
      stripe={stripe}
      options={{ clientSecret: intent.clientSecret, appearance: { theme: 'stripe' } }}
    >
      <CheckoutPaymentForm
        intent={intent}
        fields={fields}
        errors={errors}
        setField={setField}
        setErrors={setErrors}
        submitting={submitting}
        setSubmitting={setSubmitting}
        submitError={submitError}
        setSubmitError={setSubmitError}
        setResults={setResults}
        lines={lines}
        remove={remove}
        email={user?.email ?? ''}
      />
    </Elements>
  )
}

/* ----------------------------------------------------------- inner form -- */

interface PaymentFormProps {
  intent: IntentState
  fields: CheckoutFields
  errors: FieldErrors
  setField: <K extends keyof CheckoutFields>(key: K, value: CheckoutFields[K]) => void
  setErrors: (errors: FieldErrors) => void
  submitting: boolean
  setSubmitting: (value: boolean) => void
  submitError: string | null
  setSubmitError: (value: string | null) => void
  setResults: (results: LineResult[] | null) => void
  lines: BagLine[]
  remove: (id: string) => void
  email: string
}

function CheckoutPaymentForm({
  intent,
  fields,
  errors,
  setField,
  setErrors,
  submitting,
  setSubmitting,
  submitError,
  setSubmitError,
  setResults,
  lines,
  remove,
  email,
}: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()
  const submittingRef = useRef(false)
  const summaryRef = useRef<HTMLDivElement | null>(null)

  const errorList = useMemo(
    () =>
      (Object.entries(errors) as Array<[keyof CheckoutFields, string | undefined]>).filter(
        ([, v]) => !!v
      ) as Array<[keyof CheckoutFields, string]>,
    [errors]
  )

  const fail = useCallback(
    (message: string) => {
      setSubmitError(message)
      submittingRef.current = false
      setSubmitting(false)
      requestAnimationFrame(() => summaryRef.current?.focus())
    },
    [setSubmitError, setSubmitting]
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current || !stripe || !elements) return

    const snapshot = lines
    if (!snapshot.length) return

    const fieldErrors = validateFields(fields, email, window.location.origin, snapshot[0])
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      setSubmitError('Fix the highlighted fields before placing your order.')
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    setResults(null)

    // 1. AUTHORIZE. The intent was created with manual capture, so a success
    //    here holds the money at `requires_capture` — nothing is taken yet.
    const confirmed = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/store/checkout/success` },
      // Keeps the customer on this page unless the card mandates a redirect
      // (3-D Secure), so the vendor loop below can run in the same session.
      redirect: 'if_required',
    })

    if (confirmed.error) {
      fail(
        confirmed.error.message ||
          'Your card could not be authorized. Nothing has been charged.'
      )
      return
    }

    const paymentIntent = confirmed.paymentIntent
    if (!paymentIntent || paymentIntent.status !== 'requires_capture') {
      fail(
        'Payment was not authorized, so no orders were placed and nothing was charged. Please try again.'
      )
      return
    }

    // 2. PLACE THE ORDERS. The server runs the per-line loop and owns the
    //    capture/cancel decision — see the finalize route.
    let finalize: {
      success?: boolean
      orderIds?: string[]
      completedOrderIds?: string[]
      failedAtLine?: number
      failedProductId?: number
      error?: string
      message?: string
    }
    try {
      const res = await fetch('/api/juvenex/orders/finalize', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          intent_id: paymentIntent.id,
          lines: snapshot.map((line) =>
            buildLinePayload(line, fields, email, window.location.origin)
          ),
        }),
      })
      finalize = await res.json().catch(() => ({}))
    } catch {
      fail(
        'We could not confirm your orders. Your card authorization will be released automatically — please contact support before re-ordering.'
      )
      return
    }

    if (!finalize.success) {
      // Nothing was captured, so the whole bag stays put and can be retried.
      const failedIndex = finalize.failedAtLine ?? -1
      setResults(
        snapshot.map((line, i) => ({
          line,
          status: i === failedIndex ? 'error' : 'skipped',
          message:
            i === failedIndex
              ? finalize.error || 'This item could not be ordered.'
              : 'Not placed — your card was not charged.',
        }))
      )
      const orphaned = finalize.completedOrderIds ?? []
      fail(
        [
          finalize.message || 'Your order could not be completed and your card was not charged.',
          orphaned.length > 0
            ? `Reference${orphaned.length === 1 ? '' : 's'} for support: ${orphaned.join(', ')}.`
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      )
      return
    }

    // 3. CAPTURED. Clear the bag before navigating so a crash below can never
    //    leave a paid-for line sitting in the cart.
    const orderIds = finalize.orderIds ?? []
    for (const line of snapshot) remove(line.id)

    const stored: StoredCheckoutSuccess = {
      completedAt: Date.now(),
      lines: snapshot.map((line, i) => ({
        id: line.id,
        title: line.title,
        subtitle: line.subtitle,
        price: line.price,
        orderId: orderIds[i] ?? '',
      })),
    }
    try {
      sessionStorage.setItem(CHECKOUT_SUCCESS_KEY, JSON.stringify(stored))
    } catch {
      // Private mode / quota exceeded — the success page falls back to a generic confirmation.
    }

    // Confirmation email — ONE request for the whole bag, deliberately NOT
    // awaited. The customer is already paid up and about to see the success
    // page; making them wait on an SMTP round-trip would add latency for no
    // benefit, and a delivery failure is not something they can act on (the
    // orders are visible in the dashboard either way).
    if (orderIds.length > 0) {
      void fetch('/api/juvenex/orders/confirm', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ order_ids: orderIds }),
      }).catch(() => {})
    }

    router.push('/store/checkout/success')
    // Keep submittingRef locked through navigation; nothing left to re-enable.
  }

  const billingIsDifferent = fields.billingSameAsShipping === 'NO'

  return (
    <form onSubmit={handleSubmit} aria-busy={submitting} noValidate>
      {submitError ? (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className="jx-card"
          style={{ padding: 16, marginBottom: 24, borderColor: '#b3261e' }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: '#b3261e' }}>{submitError}</p>
          {errorList.length > 0 ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#b3261e' }}>
              {errorList.map(([key, message]) => (
                <li key={key}>
                  {FIELD_LABELS[key]}: {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="jx-shipping-h" style={{ marginBottom: 28 }}>
        <h2 id="jx-shipping-h" className="jx-eyebrow" style={{ marginBottom: 14 }}>
          Shipping
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          <label htmlFor="jx-checkout-email" style={{ fontSize: 13, fontWeight: 600 }}>
            Email
          </label>
          <input
            id="jx-checkout-email"
            className="jx-input"
            value={email}
            readOnly
            disabled
            tabIndex={-1}
            autoComplete="email"
            aria-readonly="true"
            aria-describedby="jx-email-hint"
            style={{
              background: 'var(--jx-bg-soft)',
              color: 'var(--jx-muted)',
              cursor: 'not-allowed',
              opacity: 1,
            }}
          />
          <p id="jx-email-hint" style={{ margin: 0, fontSize: 12, color: 'var(--jx-muted)' }}>
            Confirmed from your signed-in account — this email cannot be changed here.
          </p>
        </div>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <FormField
            label="First name"
            value={fields.firstName}
            onChange={(v) => setField('firstName', v)}
            error={errors.firstName}
            autoComplete="given-name"
            required
          />
          <FormField
            label="Last name"
            value={fields.lastName}
            onChange={(v) => setField('lastName', v)}
            error={errors.lastName}
            autoComplete="family-name"
            required
          />
          <FormField
            label="Phone"
            value={fields.phone}
            onChange={(v) => setField('phone', v.replace(/\D/g, '').slice(0, 10))}
            error={errors.phone}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            hint="10-digit US phone number"
            required
          />
        </div>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginTop: 14 }}>
          <GoogleAddressAutocomplete
            label="Address"
            value={fields.address}
            onChange={(v) => setField('address', v)}
            onPlace={(parts) => {
              if (parts.address) setField('address', parts.address)
              if (parts.city) setField('cityName', parts.city)
              if (parts.state) setField('stateName', parts.state)
              if (parts.zip) setField('zipCode', parts.zip.replace(/\D/g, '').slice(0, 6))
            }}
            error={errors.address}
            autoComplete="address-line1"
            required
            disabled={submitting}
          />
          <FormField
            label="Address line 2"
            value={fields.address2}
            onChange={(v) => setField('address2', v)}
            error={errors.address2}
            autoComplete="address-line2"
          />
        </div>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', marginTop: 14 }}>
          <FormField
            label="City"
            value={fields.cityName}
            onChange={(v) => setField('cityName', v)}
            error={errors.cityName}
            autoComplete="address-level2"
            required
          />
          <FormField
            label="State"
            value={fields.stateName}
            onChange={(v) => setField('stateName', v)}
            error={errors.stateName}
            autoComplete="address-level1"
            placeholder="e.g. CA"
            required
          />
          <FormField
            label="ZIP / postal code"
            value={fields.zipCode}
            onChange={(v) => setField('zipCode', v.replace(/\D/g, '').slice(0, 6))}
            error={errors.zipCode}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={6}
            hint="Max 6 digits"
            required
          />
        </div>
      </section>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 28px' }}>
        <legend className="jx-eyebrow" style={{ marginBottom: 14, padding: 0 }}>
          Billing address
        </legend>
        <div role="radiogroup" aria-label="Billing address" style={{ display: 'flex', gap: 18, marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
            <input
              type="radio"
              name="billingSameAsShipping"
              checked={fields.billingSameAsShipping === 'YES'}
              onChange={() => setField('billingSameAsShipping', 'YES')}
            />
            Same as shipping
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
            <input
              type="radio"
              name="billingSameAsShipping"
              checked={fields.billingSameAsShipping === 'NO'}
              onChange={() => setField('billingSameAsShipping', 'NO')}
            />
            Use a different billing address
          </label>
        </div>

        {billingIsDifferent ? (
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))' }}>
            <GoogleAddressAutocomplete
              label="Billing address"
              value={fields.billingAddress}
              onChange={(v) => setField('billingAddress', v)}
              onPlace={(parts) => {
                if (parts.address) setField('billingAddress', parts.address)
                if (parts.city) setField('billingCityName', parts.city)
                if (parts.state) setField('billingStateName', parts.state)
                if (parts.zip) setField('billingZipCode', parts.zip.replace(/\D/g, '').slice(0, 6))
              }}
              error={errors.billingAddress}
              autoComplete="billing address-line1"
              required
              disabled={submitting}
            />
            <FormField
              label="Billing city"
              value={fields.billingCityName}
              onChange={(v) => setField('billingCityName', v)}
              error={errors.billingCityName}
              autoComplete="billing address-level2"
              required
            />
            <FormField
              label="Billing state"
              value={fields.billingStateName}
              onChange={(v) => setField('billingStateName', v)}
              error={errors.billingStateName}
              autoComplete="billing address-level1"
              required
            />
            <FormField
              label="Billing ZIP"
              value={fields.billingZipCode}
              onChange={(v) => setField('billingZipCode', v.replace(/\D/g, '').slice(0, 6))}
              error={errors.billingZipCode}
              autoComplete="billing postal-code"
              inputMode="numeric"
              maxLength={6}
              required
            />
          </div>
        ) : null}
      </fieldset>

      <section aria-labelledby="jx-payment-h" style={{ marginBottom: 28 }}>
        <h2 id="jx-payment-h" className="jx-eyebrow" style={{ marginBottom: 14 }}>
          Payment
        </h2>
        {/* Card details are entered inside Stripe's iframe. Nothing typed here
            reaches this component, this origin, or our servers. */}
        <PaymentElement options={{ layout: 'tabs' }} />
      </section>

      <p style={{ fontSize: 12.5, color: 'var(--jx-muted)', marginBottom: 16 }}>
        You&rsquo;ll be charged once, for {formatUsd(intent.breakdown.total_cents / 100)} total.
        Each of your {lines.length} item{lines.length === 1 ? '' : 's'} is placed as its own order
        for prescription review — if any of them can&rsquo;t be placed, the payment is released
        and you are not charged.
      </p>

      <button
        type="submit"
        className="jx-btn jx-btn-primary"
        disabled={submitting || !stripe || !elements}
        style={{ width: '100%' }}
      >
        {submitting ? (
          <>
            <SpinnerIcon size={16} /> Placing your order&hellip;
          </>
        ) : (
          'Place order'
        )}
      </button>
    </form>
  )
}
