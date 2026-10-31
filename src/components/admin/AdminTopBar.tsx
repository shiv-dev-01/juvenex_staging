'use client'

import { useState, type FormEvent } from 'react'
import type { AdminTabId } from './AdminSidebar'

interface AdminTopBarProps {
  activeTab: AdminTabId
  onMenuClick: () => void
  onTabChange: (tab: AdminTabId) => void
  userName: string
  userEmail: string
}

const TAB_LABEL: Record<AdminTabId, string> = {
  overview: 'Overview',
  organizations: 'Organizations',
  users: 'Users',
  blogs: 'Blogs',
  orders: 'Orders',
  fulfillment: 'Fulfillment',
  pricing: 'Pricing',
  reports: 'Reports',
  affiliates: 'Affiliates',
  coupons: 'Coupons',
  messages: 'Messages',
  settings: 'Settings',
}

function initials(name: string, email: string): string {
  const src = (name || email || '?').trim()
  return src.charAt(0).toUpperCase() || '?'
}

export default function AdminTopBar({
  activeTab,
  onMenuClick,
  onTabChange,
  userName,
  userEmail,
}: AdminTopBarProps) {
  const [query, setQuery] = useState('')

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    const q = query.trim().toLowerCase()
    if (!q) return
    if (q.includes('blog') || q.includes('article') || q.includes('learn')) {
      onTabChange('blogs')
    } else if (q.includes('user') || q.includes('patient') || q.includes('member')) {
      onTabChange('users')
    } else if (q.includes('org') || q.includes('white') || q.includes('label')) {
      onTabChange('organizations')
    } else if (q.includes('order') || q.includes('purchase') || q.includes('payment')) {
      onTabChange('orders')
    } else if (q.includes('fulfill') || q.includes('ship')) {
      onTabChange('fulfillment')
    } else if (q.includes('price') || q.includes('pricing') || q.includes('sku')) {
      onTabChange('pricing')
    } else if (q.includes('report') || q.includes('moderation')) {
      onTabChange('reports')
    } else if (q.includes('message') || q.includes('chat')) {
      onTabChange('messages')
    } else {
      onTabChange('overview')
    }
  }

  return (
    <header
      className="sticky top-0 z-20 h-16 bg-white border-b border-[#E5EAE3] flex items-center px-4 md:px-6 gap-3"
      role="banner"
    >
      {/* Mobile menu toggle */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="md:hidden p-2 rounded-lg text-[#2D352C] hover:bg-[#F5F8F3]"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-[#8B9B83]">Admin</span>
        <svg
          className="w-3.5 h-3.5 text-[#8B9B83] flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium text-[#2D352C] truncate">
          {TAB_LABEL[activeTab]}
        </span>
      </div>

      {/* Search (center-ish on wider screens) */}
      <form onSubmit={handleSearch} className="hidden lg:flex flex-1 max-w-md mx-auto">
        <label className="relative block w-full">
          <span className="sr-only">Search</span>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B9B83]">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
              />
            </svg>
          </span>
          <input
            type="search"
            placeholder="Search orders, reports, users..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full pl-9 pr-14 py-2 text-sm rounded-lg bg-[#FAF9F6] border border-[#E5EAE3] text-[#2D352C] placeholder:text-[#8B9B83] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)]"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-[#E5EAE3] bg-white text-[10px] font-mono text-[#6B7567]">
            {'⌘K'}
          </kbd>
        </label>
      </form>

      <div className="flex-1 lg:flex-none" />

      {/* Right icons */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onTabChange('messages')}
          aria-label="Notifications"
          className="p-2 rounded-lg text-[#2D352C] hover:bg-[#F5F8F3] relative"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.4-1.4A2 2 0 0118 14.17V11a6 6 0 10-12 0v3.17a2 2 0 01-.6 1.43L4 17h5m6 0a3 3 0 11-6 0"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onTabChange('settings')}
          aria-label="Help"
          className="p-2 rounded-lg text-[#2D352C] hover:bg-[#F5F8F3]"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        <div className="ml-2 w-8 h-8 rounded-full bg-[#F5F8F3] text-[var(--accent-strong)] grid place-items-center text-sm font-semibold border border-[#E5EAE3]">
          {initials(userName, userEmail)}
        </div>
      </div>
    </header>
  )
}
