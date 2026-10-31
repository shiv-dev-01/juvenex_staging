import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Product dashboard',
  robots: { index: false, follow: false },
}

export default function ProductsPortalLayout({ children }: { children: React.ReactNode }) {
  return children
}
