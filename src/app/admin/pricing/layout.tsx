import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing dashboard',
  robots: { index: false, follow: false },
}

export default function PricingPortalLayout({ children }: { children: React.ReactNode }) {
  return children
}
