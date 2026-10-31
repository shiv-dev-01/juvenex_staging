'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ProductsTab from '@/components/admin/ProductsTab'
import { useAuth } from '@/lib/auth-context'
import { canManagePricing } from '@/lib/juvenex/pricing-access'

/**
 * Hidden product portal. Nothing in the storefront links here.
 * Open /admin/products only after signing in at /login.
 */

export default function ProductsPortalPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated, logout } = useAuth()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login?next=/admin/products')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] grid place-items-center">
        <p className="text-sm text-[#6B7567]">Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated || !user) return null

  if (!canManagePricing(user)) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] grid place-items-center px-4">
        <div className="bg-white border border-[#E5EAE3] rounded-2xl shadow-sm p-8 text-center max-w-md w-full">
          <h1 className="text-xl font-semibold text-[#2D352C] mb-2">Access denied</h1>
          <p className="text-sm text-[#6B7567] mb-6">This account cannot open the product dashboard.</p>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
          >
            Go home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2D352C]">
      <header className="border-b border-[#E5EAE3] bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#8B9B83]">Admin</p>
            <p className="text-sm font-medium">Product dashboard</p>
            <p className="mt-1 text-xs text-[#6B7567]">
              <Link href="/admin/pricing" className="underline">
                Pricing
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-[#6B7567]">
            <span>{user.email}</span>
            <button
              type="button"
              onClick={() => {
                logout()
                router.replace('/login')
              }}
              className="px-3 py-1.5 rounded-lg border border-[#E5EAE3] text-[#2D352C] hover:bg-[#F5F8F3]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-8">
        <ProductsTab />
      </main>
    </div>
  )
}
