'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AdminPriceRow } from '@/lib/juvenex/admin-catalog'
import { planExcelSync, type ExcelSyncPlan } from '@/lib/juvenex/excel-price-sync'

const PRICE_RE = /^\d+(\.\d{1,2})?$/

type ListResponse = {
  success: boolean
  data?: { siteId: string; products: AdminPriceRow[] }
  error?: string
}

type UpdateResponse = {
  success: boolean
  data?: { productId: string; price: string; message: string }
  error?: string
}

type BulkResponse = {
  success: boolean
  data?: { results: { productId: string; ok: boolean; price?: string; error?: string }[] }
  error?: string
}

function authHeaders(): Record<string, string> {
  const t = typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') : null
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  }
}

export default function PricingTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<AdminPriceRow[]>([])
  const [siteId, setSiteId] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('all')
  const [placement, setPlacement] = useState<'all' | 'site' | 'catalog'>('all')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [report, setReport] = useState<ExcelSyncPlan | null>(null)
  const [failed, setFailed] = useState<{ name: string; error: string }[]>([])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2800)
  }

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/pricing', { headers: authHeaders() })
      const json = (await res.json()) as ListResponse
      if (!res.ok || !json.success || !json.data) {
        setError(json.error || 'Could not load prices')
        return
      }
      setSiteId(json.data.siteId)
      setRows(json.data.products)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(productId: string) {
    const price = (drafts[productId] ?? '').trim()
    if (!PRICE_RE.test(price) || Number(price) <= 0) {
      showToast('Enter a valid price greater than 0 (up to two decimals)')
      return
    }
    setPendingId(productId)
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ productId, price }),
      })
      const json = (await res.json()) as UpdateResponse
      if (!res.ok || !json.success || !json.data) {
        showToast(json.error || 'Could not update the price')
        return
      }
      setRows((prev) =>
        prev.map((r) => (r.productId === json.data!.productId ? { ...r, currentPrice: json.data!.price } : r))
      )
      setDrafts((d) => ({ ...d, [productId]: '' }))
      showToast(`Price updated to $${json.data.price}`)
    } catch {
      showToast('Network error')
    } finally {
      setPendingId(null)
    }
  }

  async function onSyncFile(file: File) {
    setSyncing(true)
    setReport(null)
    setFailed([])
    try {
      const { readSheet } = await import('read-excel-file/browser')
      const table = await readSheet(file)
      const plan = planExcelSync(table as unknown[][], rows)
      setReport(plan)
      if (plan.changes.length === 0) {
        showToast('No prices needed changing.')
        return
      }
      const ok = window.confirm(`Update ${plan.changes.length} prices from this file?`)
      if (!ok) return
      const res = await fetch('/api/admin/pricing', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          updates: plan.changes.map((change) => ({
            productId: change.productId,
            price: change.newPrice,
          })),
        }),
      })
      const json = (await res.json()) as BulkResponse
      if (!res.ok || !json.success || !json.data) {
        showToast(json.error || 'The price file could not be applied')
        return
      }
      const byId = new Map(plan.changes.map((change) => [change.productId, change]))
      const applied = new Map<string, string>()
      const problems: { name: string; error: string }[] = []
      for (const result of json.data.results) {
        const change = byId.get(result.productId)
        if (result.ok && result.price) applied.set(result.productId, result.price)
        else problems.push({ name: change?.name || result.productId, error: result.error || 'Update failed' })
      }
      setFailed(problems)
      setRows((prev) =>
        prev.map((row) => (applied.has(row.productId) ? { ...row, currentPrice: applied.get(row.productId)! } : row))
      )
      showToast(`Sync finished: ${applied.size} updated, ${problems.length} failed.`)
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'The spreadsheet could not be read')
    } finally {
      setSyncing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const categories = useMemo(() => {
    const names = [...new Set(rows.map((row) => row.category || 'Uncategorized'))]
    names.sort((a, b) => a.localeCompare(b))
    return names
  }, [rows])

  const q = filter.trim().toLowerCase()
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (category !== 'all' && row.category !== category) return false
        if (placement === 'site' && row.slugs.length === 0) return false
        if (placement === 'catalog' && row.slugs.length > 0) return false
        if (!q) return true
        return (
          row.name.toLowerCase().includes(q) ||
          row.sku.toLowerCase().includes(q) ||
          row.productId.includes(q) ||
          row.category.toLowerCase().includes(q) ||
          row.planLabel.toLowerCase().includes(q) ||
          row.slugs.some((slug) => slug.includes(q))
        )
      }),
    [rows, q, category, placement]
  )

  const groups = useMemo(() => {
    const map = new Map<string, AdminPriceRow[]>()
    for (const row of visible) {
      const key = row.category || 'Uncategorized'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visible])

  const storefrontCount = rows.filter((row) => row.slugs.length > 0).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#2D352C]">Pricing</h1>
          <p className="text-sm text-[#6B7567] mt-1">
            Live prices from the Juvenex fulfilment panel
            {siteId ? ` (site ${siteId})` : ''}. Updates apply immediately to checkout.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onSyncFile(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={syncing || loading || rows.length === 0}
            className="px-4 py-2 rounded-lg border border-[#E5EAE3] text-sm text-[#2D352C] hover:bg-[#F5F8F3] disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync prices from Excel'}
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing || loading}
            className="px-4 py-2 rounded-lg border border-[#E5EAE3] text-sm text-[#2D352C] hover:bg-[#F5F8F3] disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-[#FEE2E2] border border-red-200 text-[#7F1D1D] text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {report && (
        <div className="bg-white border border-[#E5EAE3] rounded-2xl px-4 py-3 text-sm text-[#2D352C]">
          <p>
            {report.changes.length} ready to change · {report.unchanged} already matched · {report.skipped.length}{' '}
            skipped
          </p>
          {failed.length > 0 && (
            <ul className="mt-2 text-[#7F1D1D]">
              {failed.map((item) => (
                <li key={`${item.name}-${item.error}`}>
                  {item.name}: {item.error}
                </li>
              ))}
            </ul>
          )}
          {report.skipped.length > 0 && (
            <details className="mt-2 text-[#6B7567]">
              <summary className="cursor-pointer">Skipped rows</summary>
              <ul className="mt-1">
                {report.skipped.map((item) => (
                  <li key={`${item.row}-${item.reason}`}>
                    Row {item.row}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by name, SKU, product ID, or category"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full max-w-sm px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg text-[#2D352C] placeholder:text-[#8B9B83] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg text-[#2D352C]"
        >
          <option value="all">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={placement}
          onChange={(e) => setPlacement(e.target.value as 'all' | 'site' | 'catalog')}
          aria-label="Where the product appears"
          className="px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg text-[#2D352C]"
        >
          <option value="all">All products</option>
          <option value="site">On the website</option>
          <option value="catalog">Catalog only</option>
        </select>
        {!loading && (
          <p className="text-xs text-[#8B9B83]">
            {visible.length} shown · {storefrontCount} on the website · {rows.length} in catalog
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[#6B7567]">Loading prices…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-[#8B9B83]">{error ? 'Prices could not be loaded.' : 'No products match those filters.'}</p>
      ) : (
        groups.map(([name, items]) => (
          <section key={name} className="bg-white border border-[#E5EAE3] rounded-2xl shadow-sm overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-[#2D352C] bg-[#F5F8F3] border-b border-[#E5EAE3]">
              {name}
              <span className="ml-2 font-normal text-[#8B9B83]">{items.length}</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-[#8B9B83]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product ID</th>
                    <th className="px-4 py-3 font-medium">Product name</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Website</th>
                    <th className="px-4 py-3 font-medium">Current price</th>
                    <th className="px-4 py-3 font-medium">New price</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const busy = pendingId === row.productId
                    return (
                      <tr key={row.productId} className="border-t border-[#E5EAE3]">
                        <td className="px-4 py-3 font-mono text-xs text-[#6B7567]">{row.productId}</td>
                        <td className="px-4 py-3 text-[#2D352C]">
                          <div>{row.name}</div>
                          {row.planLabel ? <div className="text-xs text-[#8B9B83] mt-0.5">{row.planLabel}</div> : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#6B7567]">{row.sku || '—'}</td>
                        <td className="px-4 py-3 text-xs text-[#6B7567]">
                          {row.slugs.length > 0 ? row.slugs.join(', ') : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#2D352C]">
                          {row.currentPrice ? `$${row.currentPrice}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label={`New price for ${row.name}`}
                            value={drafts[row.productId] ?? ''}
                            onChange={(e) => setDrafts((d) => ({ ...d, [row.productId]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void submit(row.productId)
                            }}
                            disabled={busy}
                            className="h-9 w-28 px-3 text-sm bg-white border border-[#E5EAE3] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void submit(row.productId)}
                            disabled={busy || !(drafts[row.productId] ?? '').trim()}
                            className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                          >
                            {busy ? 'Updating…' : 'Update'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#2D352C] text-white text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
