import type { Metadata } from 'next'
import { StoreBrowser } from '@/components/jx/store/StoreBrowser'
import { getLiveStorefront } from '@/lib/jx/panel-storefront.server'

/**
 * /store — categories and treatments come from the WhiteLabelMD panel.
 * Chip filtering stays client-side so a click does not refetch the page.
 * Cached for five minutes in getLiveStorefront. If the panel is down, that
 * loader returns the generated catalog so this page still renders.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shop treatments',
  description:
    'Browse Juvenex treatments by category. Every option maps to a Juvenex checkout SKU.',
}

export default async function StorePage() {
  const catalog = await getLiveStorefront()
  return (
    <StoreBrowser
      products={catalog.products}
      categories={catalog.categories}
      initialCategory={null}
    />
  )
}
