/**
 * Creates the single authorization that covers a whole bag.
 *
 * ONE INTENT PER CART, NOT PER LINE
 * Upstream takes one product per `Create_Order_Offline` call, so a bag of N
 * items becomes N vendor calls — but they all reference the SAME payment. A
 * PaymentElement is bound to one client secret for its lifetime, so a
 * per-line intent would force the customer to re-enter their card for every
 * item. One intent for the cart total, authorized once, is what makes a
 * single card entry possible. `/finalize` then hands the same `pi_` id to
 * every vendor call as `payment_token`.
 *
 * THE CLIENT NEVER NAMES A PRICE
 * The body carries product ids and coupon codes, never amounts. Every price
 * comes from the site 614 panel price (the admin dashboard), then
 * `Get_Product_Details` when that product is not on the panel. Discounts come
 * from `Check_Coupons`,
 * both server-side, so tampering with the request can change what is being
 * bought but never what it costs.
 */
import type { NextRequest } from 'next/server'
import { juvenexClient } from '@/lib/juvenex/client'
import { panelPriceFor } from '@/lib/jx/panel-storefront'
import { getPanelPriceIndex } from '@/lib/jx/panel-storefront.server'
import { createIntentSchema } from '@/lib/juvenex/schemas'
import { parseBody, requireUser, upstreamError } from '@/lib/juvenex/route-utils'
import {
  discountToCents,
  getStripeClient,
  paymentNotConfigured,
} from '@/lib/juvenex/stripe'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

/** Stripe rejects anything under 50 cents. */
const STRIPE_MIN_CENTS = 50

export async function POST(request: NextRequest) {
  // Cheaper than the order limiter: this runs again on every coupon change.
  const auth = await requireUser(20, 'create-intent')
  if ('response' in auth) return auth.response

  const parsed = await parseBody(request, createIntentSchema)
  if ('response' in parsed) return parsed.response

  const stripe = getStripeClient()
  if (!stripe) return paymentNotConfigured()

  const { lines, coupons = [] } = parsed.data

  try {
    // Authoritative prices, one lookup per line. Site 614 wins so an admin
    // update is what the customer is charged.
    const panelPrices = await getPanelPriceIndex()
    const priced: Array<{ productId: number; cents: number }> = []
    for (const line of lines) {
      const details = await juvenexClient.getProductDetails(String(line.product_id))
      const panelPrice = panelPriceFor(
        panelPrices,
        String(line.product_id),
        details?.product_data?.product_sku
      )
      const rawPrice = panelPrice ?? details?.product_data?.product_price
      const price = Number(rawPrice)
      if (!rawPrice || !Number.isFinite(price) || price <= 0) {
        return Response.json(
          {
            error: 'product_unavailable',
            message: `Product ${line.product_id} is no longer available.`,
            product_id: line.product_id,
          },
          { status: 400 }
        )
      }
      priced.push({ productId: line.product_id, cents: Math.round(price * 100) })
    }

    const subtotalCents = priced.reduce((sum, p) => sum + p.cents, 0)

    // Discounts, validated upstream one code at a time. A code the vendor
    // rejects is simply not applied — it is not an error, because the customer
    // may still want to buy at full price.
    let discountCents = 0
    const appliedCoupons: Array<{ product_id: number; code: string; discount_cents: number }> = []
    for (const coupon of coupons) {
      const target = priced.find((p) => p.productId === coupon.product_id)
      if (!target) continue

      const result = await juvenexClient.checkCoupon({
        promo_code: coupon.code,
        product_id: String(coupon.product_id),
      })
      const amount = result?.data?.discount_amount
      if (!amount) continue

      const cents = discountToCents(amount, target.cents)
      // The vendor accepted the code but we could not read its value. Refuse
      // rather than quietly charging full price — see discountToCents.
      if (cents === null) {
        logger.error('create-intent: unparseable discount_amount from upstream', {
          userId: auth.user.id,
          code: coupon.code,
          discountAmount: amount,
        })
        return Response.json(
          {
            error: 'coupon_unreadable',
            message:
              'That promo code could not be applied automatically. Remove it to continue, or contact support.',
          },
          { status: 400 }
        )
      }
      discountCents += cents
      appliedCoupons.push({
        product_id: coupon.product_id,
        code: result.data?.code ?? coupon.code,
        discount_cents: cents,
      })
    }

    const totalCents = Math.max(0, subtotalCents - discountCents)

    // A fully comped bag cannot go through a card processor at all. 100% promo
    // codes exist (JUVENEXFREE / TEAMCOMP), so this is reachable in practice
    // and needs its own zero-dollar path before those codes work in the store.
    if (totalCents < STRIPE_MIN_CENTS) {
      return Response.json(
        {
          error: 'amount_below_minimum',
          message:
            totalCents === 0
              ? 'This bag totals $0.00 after discounts, which cannot be processed as a card payment. Contact support to complete a fully comped order.'
              : `Card payments must be at least $${(STRIPE_MIN_CENTS / 100).toFixed(2)}.`,
          total_cents: totalCents,
        },
        { status: 400 }
      )
    }

    const intent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      // Authorize now, capture only once every vendor order exists.
      capture_method: 'manual',
      automatic_payment_methods: { enabled: true },
      metadata: {
        juvenex_user_id: auth.user.id,
        juvenex_email: auth.user.email,
        product_ids_csv: priced.map((p) => p.productId).join(','),
        coupons_csv: appliedCoupons.map((c) => c.code).join(','),
        line_count: String(priced.length),
      },
    })

    return Response.json({
      clientSecret: intent.client_secret,
      intentId: intent.id,
      breakdown: {
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        total_cents: totalCents,
      },
      appliedCoupons,
    })
  } catch (error: unknown) {
    // Anything from the vendor keeps its upstream status; a Stripe fault is a
    // 502 rather than a 500 because the failure is not ours.
    if (error instanceof Error && error.name?.startsWith('Stripe')) {
      logger.error('create-intent: stripe rejected intent creation', {
        userId: auth.user.id,
        error: error.message,
      })
      return Response.json(
        { error: 'payment_setup_failed', message: 'Could not start payment. No card was charged.' },
        { status: 502 }
      )
    }
    return upstreamError(error)
  }
}
