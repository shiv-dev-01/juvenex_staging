import VipTelehealthExperience from '@/components/telehealth/VipTelehealthExperience'
import { getPanelPriceIndex, getVisibleProductIds } from '@/lib/jx/panel-storefront.server'
import { STOREFRONT_PRODUCTS } from '@/lib/jx/storefront-catalog'

/**
 * VIP telehealth entry — native Juvenex product → intake → review → checkout.
 * No PrescribeRx embeds. Prices come from the site 614 panel.
 */
export default async function TelehealthPage() {
  const [prices, visible] = await Promise.all([getPanelPriceIndex(), getVisibleProductIds()])
  const hidden = new Set<string>()
  if (visible) {
    for (const product of STOREFRONT_PRODUCTS) {
      for (const plan of product.plans ?? []) {
        if (!visible.has(plan.productId)) hidden.add(plan.productId)
      }
      for (const med of product.medications ?? []) {
        if (med.productId && !visible.has(med.productId)) hidden.add(med.productId)
        for (const plan of med.plans ?? []) {
          if (!visible.has(plan.productId)) hidden.add(plan.productId)
        }
      }
    }
  }
  return <VipTelehealthExperience prices={prices} hiddenIds={[...hidden]} />
}
