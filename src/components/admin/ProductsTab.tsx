'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type ProductRow = {
  productId: string
  name: string
  sku: string
  category: string
  planLabel: string
  active: boolean
}

type ListResponse = {
  success: boolean
  data?: { products: ProductRow[] }
  error?: string
}

type UpdateResponse = {
  success: boolean
  data?: { productId: string; active: boolean; message: string }
  error?: string
}

function authHeaders(): Record<string, string> {
  const t = typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') : null
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  }
}

export default function ProductsTab() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<'all' | 'active' | 'hidden'>('all')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2800)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/products', { headers: authHeaders() })
      const json = (await res.json()) as ListResponse
      if (!res.ok || !json.success || !json.data) {
        setError(json.error || 'Could not load products')
        return
      }
      setRows(json.data.products)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(productId: string) {
    setPendingId(productId)
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ productId }),
      })
      const json = (await res.json()) as UpdateResponse
      if (!res.ok || !json.success || !json.data) {
        showToast(json.error || 'Could not change that product')
        return
      }
      setRows((prev) =>
        prev.map((row) => (row.productId === json.data!.productId ? { ...row, active: json.data!.active } : row))
      )
      showToast(json.data.message)
    } catch {
      showToast('Network error')
    } finally {
      setPendingId(null)
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
        if (status === 'active' && !row.active) return false
        if (status === 'hidden' && row.active) return false
        if (!q) return true
        return (
          row.name.toLowerCase().includes(q) ||
          row.sku.toLowerCase().includes(q) ||
          row.productId.includes(q) ||
          row.category.toLowerCase().includes(q)
        )
      }),
    [rows, q, category, status]
  )

  const groups = useMemo(() => {
    const map = new Map<string, ProductRow[]>()
    for (const row of visible) {
      const key = row.category || 'Uncategorized'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visible])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#2D352C]">Products</h1>
        <p className="text-sm text-[#6B7567] mt-1">
          Turn a product off to hide it from the website. Turn it back on to show it again.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-[#FEE2E2] border border-red-200 text-[#7F1D1D] text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by name, SKU, or product ID"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full max-w-sm px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg"
        >
          <option value="all">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | 'active' | 'hidden')}
          aria-label="Status"
          className="px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg"
        >
          <option value="all">Active and hidden</option>
          <option value="active">Active</option>
          <option value="hidden">Hidden</option>
        </select>
        {!loading && <p className="text-xs text-[#8B9B83]">{visible.length} shown</p>}
      </div>

      {loading ? (
        <p className="text-sm text-[#6B7567]">Loading products…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-[#8B9B83]">No products match those filters.</p>
      ) : (
        groups.map(([name, items]) => (
          <section key={name} className="bg-white border border-[#E5EAE3] rounded-2xl shadow-sm overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-[#2D352C] bg-[#F5F8F3] border-b border-[#E5EAE3]">
              {name}
              <span className="ml-2 font-normal text-[#8B9B83]">{items.length}</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-[#8B9B83]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product ID</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const busy = pendingId === row.productId
                    return (
                      <tr key={row.productId} className="border-t border-[#E5EAE3]">
                        <td className="px-4 py-3 font-mono text-xs text-[#6B7567]">{row.productId}</td>
                        <td className="px-4 py-3">
                          <div>{row.name}</div>
                          {row.planLabel ? <div className="text-xs text-[#8B9B83] mt-0.5">{row.planLabel}</div> : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#6B7567]">{row.sku || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={row.active ? 'text-[#2F6B3A]' : 'text-[#7F1D1D]'}>
                            {row.active ? 'Active' : 'Hidden'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void toggle(row.productId)}
                            disabled={busy}
                            className="px-3 py-1.5 rounded-lg border border-[#E5EAE3] text-sm font-medium hover:bg-[#F5F8F3] disabled:opacity-50"
                          >
                            {busy ? 'Saving…' : row.active ? 'Hide' : 'Show'}
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
