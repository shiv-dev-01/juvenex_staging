import VipTelehealthExperience from '@/components/telehealth/VipTelehealthExperience'
import { hiddenProductIds } from '@/lib/juvenex/product-visibility'
import { getPanelPriceIndex } from '@/lib/jx/panel-storefront.server'

/**
 * VIP telehealth entry — native Juvenex product → intake → review → checkout.
 * No PrescribeRx embeds. Prices come from the site 614 panel.
 */
export default async function TelehealthPage() {
  const prices = await getPanelPriceIndex()
  const hidden = hiddenProductIds()
  return <VipTelehealthExperience prices={prices} hiddenIds={[...hidden]} />
}
