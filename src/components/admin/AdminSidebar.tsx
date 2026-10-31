'use client'

import type { ReactNode } from 'react'

export type AdminTabId =
  | 'overview'
  | 'organizations'
  | 'users'
  | 'blogs'
  | 'orders'
  | 'fulfillment'
  | 'pricing'
  | 'reports'
  | 'affiliates'
  | 'coupons'
  | 'messages'
  | 'settings'

interface AdminNavItem {
  id: AdminTabId
  label: string
  icon: ReactNode
  disabled?: boolean
}

interface AdminSidebarProps {
  activeTab: AdminTabId
  onTabChange: (tab: AdminTabId) => void
  userName: string
  userEmail: string
  onLogout: () => void
  /**
   * 'desktop' renders a fixed left rail visible only at md+.
   * 'drawer' renders a full-height panel meant to be wrapped by the
   * mobile drawer in AdminShell.
   */
  variant?: 'desktop' | 'drawer'
}

// Heroicons-style 24x24 outline paths, rendered inline to avoid a new dep.
const icon = (path: string): ReactNode => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    strokeWidth={1.75}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
)

const NAV_ITEMS: ReadonlyArray<AdminNavItem> = [
  {
    id: 'overview',
    label: 'Overview',
    icon: icon('M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'),
  },
  {
    id: 'organizations',
    label: 'Organizations',
    icon: icon('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0v-4a1 1 0 00-1-1h-3a1 1 0 00-1 1v4M5 21H3m2 0v-4a1 1 0 011-1h3a1 1 0 011 1v4'),
  },
  {
    id: 'users',
    label: 'Users',
    icon: icon('M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z'),
  },
  {
    id: 'blogs',
    label: 'Blogs',
    icon: icon('M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5S19.832 5.477 21 6.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253'),
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: icon('M16 11V7a4 4 0 00-8 0v4M5 9h14l-1 12H6L5 9z'),
  },
  {
    id: 'fulfillment',
    label: 'Fulfillment',
    // Truck/package outline — stylistically matches the other 24x24 paths.
    icon: icon('M3 7h11v8H3V7zm11 3h4l3 3v2h-7v-5zM6.5 17a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm10 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z'),
  },
  {
    id: 'pricing',
    label: 'Pricing',
    icon: icon('M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z'),
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: icon('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'),
  },
  {
    id: 'affiliates',
    label: 'Affiliates',
    icon: icon('M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-3-3'),
  },
  {
    id: 'coupons',
    label: 'Coupons',
    // Tag / ticket outline.
    icon: icon('M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z'),
  },
  {
    id: 'messages',
    label: 'Messages',
    icon: icon('M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.87 9.87 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: icon('M10.325 4.317a1 1 0 011.35 0l.716.644a1 1 0 00.886.245l.948-.22a1 1 0 011.184.684l.295.92a1 1 0 00.648.648l.92.295a1 1 0 01.684 1.184l-.22.948a1 1 0 00.245.886l.644.716a1 1 0 010 1.35l-.644.716a1 1 0 00-.245.886l.22.948a1 1 0 01-.684 1.184l-.92.295a1 1 0 00-.648.648l-.295.92a1 1 0 01-1.184.684l-.948-.22a1 1 0 00-.886.245l-.716.644a1 1 0 01-1.35 0l-.716-.644a1 1 0 00-.886-.245l-.948.22a1 1 0 01-1.184-.684l-.295-.92a1 1 0 00-.648-.648l-.92-.295a1 1 0 01-.684-1.184l.22-.948a1 1 0 00-.245-.886l-.644-.716a1 1 0 010-1.35l.644-.716a1 1 0 00.245-.886l-.22-.948a1 1 0 01.684-1.184l.92-.295a1 1 0 00.648-.648l.295-.92a1 1 0 011.184-.684l.948.22a1 1 0 00.886-.245l.716-.644zM15 12a3 3 0 11-6 0 3 3 0 016 0z'),
  },
]

function avatarLetter(name: string, email: string): string {
  const src = (name || email || '?').trim()
  return src.charAt(0).toUpperCase() || '?'
}

export default function AdminSidebar({
  activeTab,
  onTabChange,
  userName,
  userEmail,
  onLogout,
  variant = 'desktop',
}: AdminSidebarProps) {
  const containerClass =
    variant === 'desktop'
      ? 'hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:left-0 bg-white border-r border-[#E5EAE3] z-30'
      : 'flex w-full flex-col bg-white border-r border-[#E5EAE3]'
  return (
    <aside className={containerClass} aria-label="Admin navigation">
      {/* Brand */}
      <div className="flex items-center gap-2.5 h-16 px-5 border-b border-[#E5EAE3]">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent)] text-white grid place-items-center font-bold">
          J
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-[#2D352C]">Juvenex</span>
          <span className="text-[11px] text-[#8B9B83]">Admin console</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id
          const base =
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors'
          const state = item.disabled
            ? 'text-[#8B9B83] cursor-not-allowed opacity-60'
            : isActive
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[#2D352C] hover:bg-[#F5F8F3]'
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.disabled) return
                onTabChange(item.id)
              }}
              aria-current={isActive ? 'page' : undefined}
              disabled={item.disabled}
              className={`${base} ${state}`}
            >
              <span className={isActive ? 'text-white' : 'text-[#6B7567]'}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.disabled && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-[#8B9B83]">
                  Soon
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer: user + logout */}
      <div className="border-t border-[#E5EAE3] p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-9 h-9 rounded-full bg-[#F5F8F3] text-[var(--accent-strong)] grid place-items-center text-sm font-semibold border border-[#E5EAE3]">
            {avatarLetter(userName, userEmail)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#2D352C] truncate">
              {userName || 'Admin'}
            </p>
            <p className="text-xs text-[#8B9B83] truncate">{userEmail}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 w-full text-left px-3 py-2 rounded-lg text-sm text-[#2D352C] hover:bg-[#F5F8F3] transition-colors flex items-center gap-2"
        >
          <svg
            className="w-4 h-4 text-[#6B7567]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Log out
        </button>
      </div>
    </aside>
  )
}
