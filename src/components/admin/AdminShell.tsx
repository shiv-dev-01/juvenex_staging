'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { canManagePricing } from '@/lib/juvenex/pricing-access'
import AdminSidebar, { type AdminTabId } from './AdminSidebar'
import AdminTopBar from './AdminTopBar'

interface AdminShellProps {
  activeTab: AdminTabId
  onTabChange: (tab: AdminTabId) => void
  children: ReactNode
}

/**
 * Loading state shown while the auth context resolves the current user.
 * Kept minimal because it is the first paint on every admin route hit.
 */
function ShellLoading() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] grid place-items-center">
      <div className="flex items-center gap-3 text-[#6B7567]">
        <span className="w-4 h-4 rounded-full border-2 border-[#E5EAE3] border-t-[var(--accent)] animate-spin" />
        <span className="text-sm">Loading admin console…</span>
      </div>
    </div>
  )
}

/**
 * Shown when an authenticated user lacks the super_admin role. Real
 * authorization is enforced server-side on every admin API route — this
 * is purely a UX guard.
 */
function AccessDenied({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="min-h-screen bg-[#FAF9F6] grid place-items-center px-4">
      <div className="bg-white border border-[#E5EAE3] rounded-2xl shadow-sm p-8 text-center max-w-md w-full">
        <div className="w-12 h-12 rounded-full bg-[#FEE2E2] grid place-items-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-[#DC2626]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-[#2D352C] mb-2">
          Access denied
        </h1>
        <p className="text-sm text-[#6B7567] mb-6">
          You do not have permission to view the Juvenex admin console.
        </p>
        <button
          type="button"
          onClick={onGoHome}
          className="px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent)] transition-colors"
        >
          Go home
        </button>
      </div>
    </div>
  )
}

export default function AdminShell({
  activeTab,
  onTabChange,
  children,
}: AdminShellProps) {
  const router = useRouter()
  const { user, isLoading, isAuthenticated, logout } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (!isLoading && isAuthenticated && user && user.role !== 'super_admin' && canManagePricing(user)) {
      router.replace('/admin/pricing')
    }
  }, [isLoading, isAuthenticated, user, router])

  if (isLoading) return <ShellLoading />
  if (!isAuthenticated || !user) return null
  if (user.role !== 'super_admin') {
    if (canManagePricing(user)) return <ShellLoading />
    return <AccessDenied onGoHome={() => router.push('/dashboard')} />
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2D352C]">
      <AdminSidebar
        activeTab={activeTab}
        onTabChange={(t) => {
          onTabChange(t)
          setMobileNavOpen(false)
        }}
        userName={user.name}
        userEmail={user.email}
        onLogout={logout}
      />

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-[#2D352C]/40"
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-white border-r border-[#E5EAE3] shadow-xl flex">
            <div className="flex-1 flex flex-col">
              <AdminSidebar
                activeTab={activeTab}
                onTabChange={(t) => {
                  onTabChange(t)
                  setMobileNavOpen(false)
                }}
                userName={user.name}
                userEmail={user.email}
                onLogout={logout}
                variant="drawer"
              />
            </div>
          </div>
        </div>
      )}

      <div className="md:pl-64 flex flex-col min-h-screen">
        <AdminTopBar
          activeTab={activeTab}
          onMenuClick={() => setMobileNavOpen(true)}
          onTabChange={onTabChange}
          userName={user.name}
          userEmail={user.email}
        />
        <main id="main-content" className="flex-1 px-4 md:px-6 py-6 pb-16">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  )
}
