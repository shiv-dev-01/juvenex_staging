'use client'

/**
 * IdunRX-style dummy card checkout (Create_Order with card_no / CVV).
 * Stripe PaymentElement path stays in CheckoutForm but is gated off while
 * NEXT_PUBLIC_JX_USE_DUMMY_CARD=true (or Stripe keys are missing).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useJxStore, type BagLine } from '@/components/jx/JxStore'
import { formatUsd } from '@/lib/jx/catalog'
import { coerceUsStateCode, US_STATE_OPTIONS } from '@/lib/jx/us-state'
import { SpinnerIcon } from '@/components/jx/icons'
import { FormField } from './FormField'
import { GoogleAddressAutocomplete } from './GoogleAddressAutocomplete'
import {
  CHECKOUT_SUCCESS_KEY,
  type CheckoutFields,
  type CouponState,
  type LineResult,
  type StoredCheckoutSuccess,
} from './types'

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

interface DummyCardFields {
  cardNo: string
  exMonth: string
  exYear: string
  cvv: string
  cardHolderName: string
}

const EMPTY_CARD: DummyCardFields = {
  cardNo: '',
  exMonth: '',
  exYear: '',
  cvv: '',
  cardHolderName: '',
}

function authHeaders(): Record<string, string> {
  const token = typeof window === 'undefined' ? null : window.localStorage.getItem('auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

function formatCardDisplay(value: string) {
  return digitsOnly(value)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ')
}

function inferCardType(pan: string): string {
  if (pan.startsWith('4')) return 'visa'
  if (pan.startsWith('5') || pan.startsWith('2')) return 'mastercard'
  if (pan.startsWith('3')) return 'american express'
  if (pan.startsWith('6')) return 'discover'
  return 'visa'
}

/** Same URL IdunRX uses (brand path swapped) — browser → WLMD, no Next proxy. */
const CREATE_ORDER_TEST_URL =
  process.env.NEXT_PUBLIC_JUVENEX_CREATE_ORDER_TEST_URL ||
  'https://panel.whitelabelmd.com/juvenex/api/createOrder_test'

function pickOrderId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const o = entry as Record<string, unknown>
  for (const key of ['order_id', 'orderId', 'orderid', 'id']) {
    const v = o[key]
    if (v != null && String(v).trim()) return String(v)
  }
  return null
}

function extractOrderIds(data: unknown): string[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.map(pickOrderId).filter((id): id is string => !!id)
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  const ids: string[] = []
  if (Array.isArray(obj.orders)) {
    for (const entry of obj.orders) {
      const id = pickOrderId(entry)
      if (id) ids.push(id)
    }
  }
  if (Array.isArray(obj.order_ids)) {
    for (const id of obj.order_ids) {
      if (id != null && String(id).trim()) ids.push(String(id))
    }
  }
  const single = pickOrderId(obj)
  if (single && !ids.includes(single)) ids.unshift(single)
  return ids
}

function upstreamStatus(data: unknown): number | null {
  if (Array.isArray(data)) {
    if (!data.length) return null
    const allOk = data.every(
      (e) => e && typeof e === 'object' && (e as { status?: number }).status === 1
    )
    if (allOk) return 1
    const declined = data.find(
      (e) => e && typeof e === 'object' && (e as { status?: number }).status === 5
    ) as { status?: number } | undefined
    return declined?.status ?? 0
  }
  if (data && typeof data === 'object' && typeof (data as { status?: unknown }).status === 'number') {
    return (data as { status: number }).status
  }
  return null
}

function upstreamMessage(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry && typeof entry === 'object' && typeof (entry as { message?: string }).message === 'string') {
        return (entry as { message: string }).message
      }
    }
    return undefined
  }
  if (data && typeof data === 'object' && typeof (data as { message?: string }).message === 'string') {
    return (data as { message: string }).message
  }
  return undefined
}

export function DummyCardCheckout({
  fields,
  setFields,
  errors,
  setErrors,
  coupons,
  email,
  lines,
  subtotal,
  submitting,
  setSubmitting,
  submitError,
  setSubmitError,
  setResults,
  remove,
}: {
  fields: CheckoutFields
  setFields: React.Dispatch<React.SetStateAction<CheckoutFields>>
  errors: Partial<Record<keyof CheckoutFields, string>>
  setErrors: React.Dispatch<React.SetStateAction<Partial<Record<keyof CheckoutFields, string>>>>
  coupons: Record<string, CouponState>
  email: string
  lines: BagLine[]
  subtotal: number
  submitting: boolean
  setSubmitting: (v: boolean) => void
  submitError: string | null
  setSubmitError: (v: string | null) => void
  setResults: (v: LineResult[] | null) => void
  remove: (id: string) => void
}) {
  const router = useRouter()
  const submittingRef = useRef(false)
  const alertRef = useRef<HTMLDivElement | null>(null)
  const [card, setCard] = useState<DummyCardFields>(EMPTY_CARD)
  const [cardErrors, setCardErrors] = useState<Partial<Record<keyof DummyCardFields, string>>>({})

  const appliedPromo =
    Object.values(coupons).find((c) => c.status === 'applied' && c.appliedCode)?.appliedCode ?? null

  const discountTotal = useMemo(() => {
    let sum = 0
    for (const c of Object.values(coupons)) {
      if (c.status === 'applied' && c.discountAmount) {
        const n = Number.parseFloat(String(c.discountAmount).replace(/[^0-9.]/g, ''))
        if (Number.isFinite(n)) sum += n
      }
    }
    return sum
  }, [coupons])

  const displayTotal = Math.max(0, subtotal - discountTotal)

  function setField<K extends keyof CheckoutFields>(key: K, value: CheckoutFields[K]) {
    setFields((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }

  const fail = useCallback(
    (message: string) => {
      setSubmitError(message)
      submittingRef.current = false
      setSubmitting(false)
      requestAnimationFrame(() => alertRef.current?.focus())
    },
    [setSubmitError, setSubmitting]
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current || !lines.length) return

    const nextErrors: Partial<Record<keyof CheckoutFields, string>> = {}
    if (!fields.firstName.trim()) nextErrors.firstName = 'Required'
    if (!fields.lastName.trim()) nextErrors.lastName = 'Required'
    if (fields.phone.replace(/\D/g, '').length !== 10) nextErrors.phone = 'Enter a 10-digit phone number'
    if (!fields.address.trim()) nextErrors.address = 'Required'
    if (!fields.cityName.trim()) nextErrors.cityName = 'Required'
    if (!fields.stateName.trim()) nextErrors.stateName = 'Required'
    if (!fields.zipCode.trim()) nextErrors.zipCode = 'Required'
    else if (fields.zipCode.replace(/\D/g, '').length > 6) nextErrors.zipCode = 'ZIP can be at most 6 digits'
    if (fields.billingSameAsShipping === 'NO') {
      if (!fields.billingAddress.trim()) nextErrors.billingAddress = 'Required'
      if (!fields.billingCityName.trim()) nextErrors.billingCityName = 'Required'
      if (!fields.billingStateName.trim()) nextErrors.billingStateName = 'Required'
      if (!fields.billingZipCode.trim()) nextErrors.billingZipCode = 'Required'
    }

    const nextCardErrors: Partial<Record<keyof DummyCardFields, string>> = {}
    const pan = digitsOnly(card.cardNo)
    if (pan.length < 12 || pan.length > 19) nextCardErrors.cardNo = 'Enter a valid card number'
    if (!/^(0[1-9]|1[0-2])$/.test(card.exMonth.trim())) nextCardErrors.exMonth = 'MM'
    if (!/^\d{2,4}$/.test(card.exYear.trim())) nextCardErrors.exYear = 'YY'
    if (!/^\d{3,4}$/.test(digitsOnly(card.cvv))) nextCardErrors.cvv = 'Invalid CVV'
    if (!card.cardHolderName.trim()) nextCardErrors.cardHolderName = 'Required'

    setErrors(nextErrors)
    setCardErrors(nextCardErrors)
    if (Object.keys(nextErrors).length || Object.keys(nextCardErrors).length) {
      fail('Fix the highlighted fields before placing your order.')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    setResults(null)

    const origin = window.location.origin
    const billingNo = fields.billingSameAsShipping === 'NO'
    const promo = appliedPromo || ''

    // IdunRX pattern: multipart FormData straight to WLMD createOrder_test (no Next proxy).
    const form = new FormData()
    form.append('billingSameAsShipping', billingNo ? 'NO' : 'YES')
    form.append('email', email)
    form.append('first_name', fields.firstName.trim())
    form.append('last_name', fields.lastName.trim())
    form.append('phone', fields.phone.trim())
    form.append('address', fields.address.trim())
    if (fields.address2.trim()) form.append('address2', fields.address2.trim())
    form.append('city_name', fields.cityName.trim())
    form.append('state_name', coerceUsStateCode(fields.stateName))
    form.append('zip_code', fields.zipCode.trim())
    form.append('card_type', inferCardType(pan))
    form.append('card_no', pan)
    form.append('ex_month', card.exMonth.trim())
    form.append('ex_year', card.exYear.trim().slice(-2))
    form.append('cvv_no', digitsOnly(card.cvv))
    form.append('card_holder_name', card.cardHolderName.trim())
    form.append('start_url', `${origin}/store/checkout`)
    form.append('promo_codes', promo)
    form.append('campaign_id', '')
    form.append('contact_details_id', '')

    if (billingNo) {
      form.append('billingAddress', fields.billingAddress.trim())
      form.append('billingCity', fields.billingCityName.trim())
      form.append('billingState', coerceUsStateCode(fields.billingStateName))
      form.append('billingZip', fields.billingZipCode.trim())
      form.append('billingCountry', 'US')
    }

    for (const line of lines) {
      const price = String(line.price)
      form.append('product_id[]', String(line.id))
      form.append('product_price[]', price)
      form.append('original_price[]', price)
      form.append('gateway_id[]', '1')
      form.append('billing_model_id[]', '3')
      form.append('promoCodes[]', '0')
    }

    try {
      const res = await fetch(CREATE_ORDER_TEST_URL, {
        method: 'POST',
        body: form,
        // Do not set Content-Type — browser sets multipart boundary (same as IdunRX axios).
      })

      const text = await res.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        fail(
          `Order API returned a non-JSON response (HTTP ${res.status}). Check createOrder_test URL.`
        )
        return
      }

      const orderIds = extractOrderIds(data)
      const status = upstreamStatus(data)
      const message = upstreamMessage(data)

      if (res.ok && status === 1 && orderIds.length > 0) {
        const lineResults: LineResult[] = lines.map((line, i) => ({
          line,
          status: 'success' as const,
          orderId: orderIds[Math.min(i, orderIds.length - 1)],
          message: 'Order placed',
        }))
        setResults(lineResults)

        // Persist locally + confirmation email (no card data).
        const recordBody = {
          email,
          first_name: fields.firstName.trim(),
          last_name: fields.lastName.trim(),
          phone: fields.phone.trim(),
          address: fields.address.trim(),
          address2: fields.address2.trim() || undefined,
          city_name: fields.cityName.trim(),
          state_name: coerceUsStateCode(fields.stateName),
          zip_code: fields.zipCode.trim(),
          billingSameAsShipping: fields.billingSameAsShipping,
          billing_address: billingNo ? fields.billingAddress.trim() : undefined,
          billing_city_name: billingNo ? fields.billingCityName.trim() : undefined,
          billing_state_name: billingNo ? coerceUsStateCode(fields.billingStateName) : undefined,
          billing_zip_code: billingNo ? fields.billingZipCode.trim() : undefined,
          order_ids: orderIds,
          products: lines.map((line) => ({
            product_id: Number(line.id),
            product_price: line.price,
          })),
        }
        void fetch('/api/juvenex/orders/record', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(recordBody),
        })
          .then(() =>
            fetch('/api/juvenex/orders/confirm', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ order_ids: orderIds }),
            })
          )
          .catch(() => {})

        for (const line of lines) remove(line.id)

        const stored: StoredCheckoutSuccess = {
          completedAt: Date.now(),
          lines: lines.map((line, i) => ({
            id: line.id,
            title: line.title,
            subtitle: line.subtitle,
            price: line.price,
            orderId: orderIds[Math.min(i, orderIds.length - 1)] ?? '',
          })),
        }
        try {
          sessionStorage.setItem(CHECKOUT_SUCCESS_KEY, JSON.stringify(stored))
        } catch {
          // ignore
        }

        router.push('/store/checkout/success')
        return
      }

      if (status === 5) {
        setResults(
          lines.map((line) => ({
            line,
            status: 'declined' as const,
            message: message || 'Card declined',
          }))
        )
        fail(message || 'Your card was declined. No further items were charged.')
        return
      }

      setResults(
        lines.map((line) => ({
          line,
          status: 'error' as const,
          message: message || 'Order failed',
        }))
      )
      fail(message || `Order could not be placed (HTTP ${res.status}).`)
    } catch {
      setResults(lines.map((line) => ({ line, status: 'error' as const, message: 'Network error' })))
      fail('Network error while placing your order. Please try again.')
    }
  }

  const billingIsDifferent = fields.billingSameAsShipping === 'NO'
  const errorList = (
    Object.entries(errors) as Array<[keyof CheckoutFields, string | undefined]>
  ).filter(([, v]) => !!v) as Array<[keyof CheckoutFields, string]>

  return (
    <form onSubmit={handleSubmit} aria-busy={submitting} noValidate>
      {submitError ? (
        <div
          ref={alertRef}
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
          <label htmlFor="jx-checkout-email-dummy" style={{ fontSize: 13, fontWeight: 600 }}>
            Email
          </label>
          <input
            id="jx-checkout-email-dummy"
            className="jx-input"
            value={email}
            readOnly
            disabled
            tabIndex={-1}
            autoComplete="email"
            aria-readonly="true"
            aria-describedby="jx-email-hint-dummy"
            style={{
              background: 'var(--jx-bg-soft)',
              color: 'var(--jx-muted)',
              cursor: 'not-allowed',
              opacity: 1,
            }}
          />
          <p id="jx-email-hint-dummy" style={{ margin: 0, fontSize: 12, color: 'var(--jx-muted)' }}>
            Confirmed from your signed-in account — this email cannot be changed here.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
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
        <div
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            marginTop: 14,
          }}
        >
          <GoogleAddressAutocomplete
            label="Address"
            value={fields.address}
            onChange={(v) => setField('address', v)}
            onPlace={(parts) => {
              setFields((f) => ({
                ...f,
                address: parts.address || f.address,
                cityName: parts.city || f.cityName,
                stateName: parts.state || f.stateName,
                zipCode: (parts.zip || f.zipCode).replace(/\D/g, '').slice(0, 6),
              }))
              setErrors((e) => ({
                ...e,
                address: undefined,
                cityName: undefined,
                stateName: undefined,
                zipCode: undefined,
              }))
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
        <div
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
            marginTop: 14,
          }}
        >
          <FormField
            label="City"
            value={fields.cityName}
            onChange={(v) => setField('cityName', v)}
            error={errors.cityName}
            autoComplete="address-level2"
            required
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="jx-checkout-state" style={{ fontSize: 13, fontWeight: 600 }}>
              State <span aria-hidden="true" style={{ color: '#b3261e' }}>*</span>
            </label>
            <select
              id="jx-checkout-state"
              className="jx-input"
              value={coerceUsStateCode(fields.stateName || 'CA')}
              onChange={(e) => setField('stateName', e.target.value)}
              required
              autoComplete="address-level1"
            >
              {US_STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <FormField
            label="ZIP"
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

      <fieldset style={{ border: 0, margin: '0 0 28px', padding: 0 }}>
        <legend className="jx-eyebrow" style={{ marginBottom: 14 }}>
          Billing
        </legend>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={fields.billingSameAsShipping === 'YES'}
            onChange={(e) => setField('billingSameAsShipping', e.target.checked ? 'YES' : 'NO')}
          />
          Same as shipping
        </label>
        {billingIsDifferent ? (
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              marginTop: 14,
            }}
          >
            <GoogleAddressAutocomplete
              label="Billing address"
              value={fields.billingAddress}
              onChange={(v) => setField('billingAddress', v)}
              onPlace={(parts) => {
                setFields((f) => ({
                  ...f,
                  billingAddress: parts.address || f.billingAddress,
                  billingCityName: parts.city || f.billingCityName,
                  billingStateName: parts.state || f.billingStateName,
                  billingZipCode: (parts.zip || f.billingZipCode).replace(/\D/g, '').slice(0, 6),
                }))
                setErrors((e) => ({
                  ...e,
                  billingAddress: undefined,
                  billingCityName: undefined,
                  billingStateName: undefined,
                  billingZipCode: undefined,
                }))
              }}
              error={errors.billingAddress}
              required
              disabled={submitting}
            />
            <FormField
              label="Billing city"
              value={fields.billingCityName}
              onChange={(v) => setField('billingCityName', v)}
              error={errors.billingCityName}
              required
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="jx-checkout-billing-state" style={{ fontSize: 13, fontWeight: 600 }}>
                Billing state <span aria-hidden="true" style={{ color: '#b3261e' }}>*</span>
              </label>
              <select
                id="jx-checkout-billing-state"
                className="jx-input"
                value={coerceUsStateCode(fields.billingStateName || 'CA')}
                onChange={(e) => setField('billingStateName', e.target.value)}
                required
              >
                {US_STATE_OPTIONS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <FormField
              label="Billing ZIP"
              value={fields.billingZipCode}
              onChange={(v) => setField('billingZipCode', v.replace(/\D/g, '').slice(0, 6))}
              error={errors.billingZipCode}
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
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--jx-muted)' }}>
          Test / dummy card mode (IdunRX-style). Use a Stripe test PAN such as 4242 4242 4242 4242.
        </p>
        <div style={{ display: 'grid', gap: 14 }}>
          <FormField
            label="Name on card"
            value={card.cardHolderName}
            onChange={(v) => setCard((c) => ({ ...c, cardHolderName: v }))}
            error={cardErrors.cardHolderName}
            autoComplete="cc-name"
            required
          />
          <FormField
            label="Card number"
            value={formatCardDisplay(card.cardNo)}
            onChange={(v) => setCard((c) => ({ ...c, cardNo: digitsOnly(v).slice(0, 19) }))}
            error={cardErrors.cardNo}
            inputMode="numeric"
            autoComplete="cc-number"
            required
          />
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            }}
          >
            <FormField
              label="Exp month"
              value={card.exMonth}
              onChange={(v) => setCard((c) => ({ ...c, exMonth: digitsOnly(v).slice(0, 2) }))}
              error={cardErrors.exMonth}
              placeholder="MM"
              inputMode="numeric"
              autoComplete="cc-exp-month"
              required
            />
            <FormField
              label="Exp year"
              value={card.exYear}
              onChange={(v) => setCard((c) => ({ ...c, exYear: digitsOnly(v).slice(0, 4) }))}
              error={cardErrors.exYear}
              placeholder="YY"
              inputMode="numeric"
              autoComplete="cc-exp-year"
              required
            />
            <FormField
              label="CVV"
              value={card.cvv}
              onChange={(v) => setCard((c) => ({ ...c, cvv: digitsOnly(v).slice(0, 4) }))}
              error={cardErrors.cvv}
              inputMode="numeric"
              autoComplete="cc-csc"
              required
            />
          </div>
        </div>
      </section>

      <p style={{ fontSize: 12.5, color: 'var(--jx-muted)', marginBottom: 16 }}>
        You&rsquo;ll be charged for {formatUsd(displayTotal)} total
        {discountTotal > 0 ? ` (discount ${formatUsd(discountTotal)})` : ''}. Each item is placed as
        its own Juvenex order.
      </p>

      <button
        type="submit"
        className="jx-btn jx-btn-primary"
        disabled={submitting}
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

/** True when Stripe should stay hidden and dummy Create_Order card flow is used. */
export function useDummyCardCheckout(): boolean {
  if (typeof process === 'undefined') return true
  const flag = process.env.NEXT_PUBLIC_JX_USE_DUMMY_CARD
  if (flag === 'false') return false
  if (flag === 'true') return true
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  return !key || key.includes('placeholder') || key.includes('your_stripe')
}
