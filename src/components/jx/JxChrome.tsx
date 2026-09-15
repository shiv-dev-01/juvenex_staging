'use client'

/**
 * Fixed site chrome from the design: utility bar, header (logo + search +
 * account/favourites/bag) and the category nav.
 *
 * The design is desktop-first with three stacked bars totalling 158px. On
 * narrow screens the utility bar folds away and the header compacts, giving the
 * 110px offset that `--jx-chrome-h` declares — pages rely on that variable for
 * their top spacing, so keep the two in step.
 */

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { useJxStore } from './JxStore'
import {
  BagIcon,
  CloseIcon,
  HeartIcon,
  MenuIcon,
  SearchIcon,
  TruckIcon,
  UserIcon,
} from './icons'

const UTILITY_LINKS = [
  { label: 'For Clinics & Providers', href: '/white-label' },
  { label: 'About Us', href: '/landing' },
  { label: 'Messages / Care', href: '/messages' },
]

const NAV_LINKS = [
  { label: 'Shop All', href: '/store' },
  { label: 'Semaglutide', href: '/store/p/semaglutide' },
  { label: 'Tirzepatide', href: '/store/p/tirzepatide' },
  { label: 'Programs', href: '/store?kind=program' },
  { label: 'Health Programs', href: '/#membership' },
  { label: 'Telehealth', href: '/telehealth' },
  { label: 'Resources', href: '/learn' },
]

export function JxChrome() {
  const { count, hydrated } = useJxStore()
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchId = useId()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Escape closes; focus returns to the trigger. Body scroll locks while open.
  useEffect(() => {
    if (!menuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    drawerRef.current?.querySelector<HTMLElement>('a,button')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Keep the header search box in sync when landing on /store?q=…
  useEffect(() => {
    if (!pathname?.startsWith('/store')) return
    try {
      const q = new URLSearchParams(window.location.search).get('q') ?? ''
      setQuery(q)
    } catch {
      /* ignore */
    }
  }, [pathname])

  // Intake embed is fullscreen — hide site chrome so it cannot cover the form.
  if (pathname?.startsWith('/store/intake')) {
    return null
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    const q = query.trim()
    router.push(q ? `/store?q=${encodeURIComponent(q)}` : '/store')
  }

  // Render 0 until the bag has hydrated so SSR and client markup match.
  const bagCount = hydrated ? count : 0

  return (
    <>
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          paddingTop: 'env(safe-area-inset-top)',
          background: 'var(--jx-surface)',
        }}
      >
        {/* utility bar — desktop only */}
        <div className="jx-utility">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, letterSpacing: '.03em' }}>
            <TruckIcon size={14} strokeWidth={1.8} />
            Free shipping on orders $99+
          </span>
          <nav aria-label="Utility" style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            {UTILITY_LINKS.map((link) => (
              <Link key={link.label} href={link.href} className="jx-utility-link">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* header */}
        <div className="jx-header">
          <button
            ref={menuButtonRef}
            type="button"
            className="jx-iconbtn jx-only-mobile"
            aria-expanded={menuOpen}
            aria-controls="jx-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
            <span className="jx-sr">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>

          <Link href="/" className="jx-wordmark">
            <Image
              src="/juvenex-logo.jpg"
              alt=""
              width={36}
              height={36}
              priority
              style={{ borderRadius: 10, objectFit: 'cover', display: 'block' }}
            />
            <span className="jx-display" style={{ fontSize: 23, letterSpacing: '.14em' }}>
              JUVENEX
            </span>
          </Link>

          <form className="jx-search" role="search" onSubmit={submitSearch}>
            <label htmlFor={searchId} className="jx-sr">
              Search products
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search peptides, doses, protocols..."
              autoComplete="off"
            />
            <button type="submit" className="jx-search-go">
              <SearchIcon size={16} />
              <span className="jx-sr">Search</span>
            </button>
          </form>

          <div className="jx-header-actions">
            <Link href="/store/account/orders" className="jx-action jx-hide-sm">
              <UserIcon size={17} />
              <span>Member portal</span>
            </Link>
            <Link href="/store" className="jx-action jx-hide-sm">
              <HeartIcon size={17} />
              <span>Shop</span>
            </Link>
            <Link href="/store/cart" className="jx-action">
              <BagIcon size={17} />
              <span className="jx-hide-sm">Bag</span>
              <span className="jx-badge" aria-hidden="true">
                {bagCount}
              </span>
              <span className="jx-sr">
                {bagCount === 1 ? 'Bag, 1 item' : `Bag, ${bagCount} items`}
              </span>
            </Link>
          </div>
        </div>

        {/* category nav */}
        <nav aria-label="Categories" className="jx-nav">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className="jx-nav-link">
              {link.label}
            </Link>
          ))}
          <Link href="/register" className="jx-nav-cta">
            Get started
          </Link>
        </nav>
      </header>

      {/* mobile drawer */}
      {menuOpen ? (
        <div
          className="jx-drawer-scrim"
          onClick={() => setMenuOpen(false)}
          role="presentation"
        >
          <div
            id="jx-mobile-menu"
            ref={drawerRef}
            className="jx-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            onClick={(event) => {
              event.stopPropagation()
              // Close on tap-through so a navigation never leaves the drawer
              // stuck open. Delegating beats a pathname effect: it fires only
              // on a real activation, including same-route links.
              if ((event.target as HTMLElement).closest('a')) setMenuOpen(false)
            }}
          >
            {NAV_LINKS.map((link) => (
              <Link key={link.label} href={link.href} className="jx-drawer-link">
                {link.label}
              </Link>
            ))}
            <hr className="jx-drawer-rule" />
            <Link href="/store/account/orders" className="jx-drawer-link">
              My orders
            </Link>
            {UTILITY_LINKS.map((link) => (
              <Link key={link.label} href={link.href} className="jx-drawer-link jx-drawer-link-sm">
                {link.label}
              </Link>
            ))}
            <Link href="/register" className="jx-btn jx-btn-primary" style={{ marginTop: 14 }}>
              Get started
            </Link>
          </div>
        </div>
      ) : null}

      {/* spacer matching the fixed chrome */}
      <div
        aria-hidden="true"
        style={{ height: 'calc(var(--jx-chrome-h) + env(safe-area-inset-top))' }}
      />
    </>
  )
}
