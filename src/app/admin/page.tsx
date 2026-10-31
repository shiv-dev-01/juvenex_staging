'use client'

import { useEffect, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import type { AdminTabId } from '@/components/admin/AdminSidebar'
import OverviewTab from '@/components/admin/OverviewTab'
import OrdersTab from '@/components/admin/OrdersTab'
import OrderFulfillmentTab from '@/components/admin/OrderFulfillmentTab'
import OrganizationsTab from '@/components/admin/OrganizationsTab'
import UsersTab from '@/components/admin/UsersTab'
import BlogsTab from '@/components/admin/BlogsTab'
import ReportsTab from '@/components/admin/ReportsTab'
import AffiliatesTab from '@/components/admin/AffiliatesTab'
import CouponsTab from '@/components/admin/CouponsTab'
import PricingTab from '@/components/admin/PricingTab'
import SettingsTab from '@/components/admin/SettingsTab'
import UserPicker from '@/components/admin/UserPicker'
import MessageThread from '@/components/admin/MessageThread'
import { useAuth } from '@/lib/auth-context'
import { organizationApi, type Organization } from '@/lib/api'
import type { AdminUserListItem } from '@/lib/messaging'

// SECURITY NOTE: Auth + role gating live in <AdminShell>. The role check
// there is a UX guard only — every admin API route re-verifies
// `profile.role === 'super_admin'` server-side, so a user who bypasses the
// client guard cannot perform privileged actions.

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTabId>('overview')

  return (
    <AdminShell activeTab={tab} onTabChange={setTab}>
      {tab === 'overview' && <OverviewTab onNavigate={(t) => setTab(t)} />}
      {tab === 'organizations' && <OrganizationsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'blogs' && <BlogsTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'fulfillment' && <OrderFulfillmentTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'reports' && <ReportsTab />}
      {/* NOTE: the 'affiliates' nav item + AdminTabId union member live in
          AdminSidebar.tsx (owned elsewhere). The cast keeps this file
          compile-clean until that union gains 'affiliates'. */}
      {tab === ('affiliates' as AdminTabId) && <AffiliatesTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'messages' && <MessagesTabLegacy />}
      {tab === 'settings' && <SettingsTab />}
    </AdminShell>
  )
}

// ---------------------------------------------------------------------------
// Legacy Organizations tab — preserves the existing functionality until a
// dedicated OrganizationsTab component lands. Restyled to match the new
// shell palette.
// ---------------------------------------------------------------------------

interface NewOrgState {
  name: string
  type: string
  address: string
  phone: string
  email: string
}

const EMPTY_ORG: NewOrgState = {
  name: '',
  type: 'pharmacy',
  address: '',
  phone: '',
  email: '',
}

function OrganizationsTabLegacy() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [showAddOrg, setShowAddOrg] = useState(false)
  const [newOrg, setNewOrg] = useState<NewOrgState>(EMPTY_ORG)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const result = await organizationApi.getOrganizations()
      if (cancelled) return
      if (result.data?.organizations) setOrganizations(result.data.organizations)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleAddOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrg),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setOrganizations((prev) => [
          ...prev,
          data.data.organization || data.data,
        ])
        setNewOrg(EMPTY_ORG)
        setShowAddOrg(false)
      } else {
        setError(data.error ?? 'Failed to create organization')
      }
    } catch {
      setError('Network error creating organization')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#2D352C]">
            Organizations
          </h1>
          <p className="text-sm text-[#6B7567] mt-1">
            White-label clinics, pharmacies, and wellness partners.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddOrg((v) => !v)}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent)] transition-colors"
        >
          + Add organization
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-[#FEE2E2] border border-red-200 text-[#7F1D1D] text-sm rounded-xl px-4 py-3"
        >
          {error}
        </div>
      )}

      {showAddOrg && (
        <form
          onSubmit={handleAddOrg}
          className="bg-white border border-[#E5EAE3] rounded-2xl p-6 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Name"
              required
              value={newOrg.name}
              onChange={(v) => setNewOrg({ ...newOrg, name: v })}
            />
            <SelectField
              label="Type"
              value={newOrg.type}
              onChange={(v) => setNewOrg({ ...newOrg, type: v })}
              options={[
                { value: 'pharmacy', label: 'Pharmacy' },
                { value: 'clinic', label: 'Clinic' },
                { value: 'wellness_center', label: 'Wellness center' },
                { value: 'enterprise', label: 'Enterprise' },
              ]}
            />
            <Field
              label="Address"
              value={newOrg.address}
              onChange={(v) => setNewOrg({ ...newOrg, address: v })}
            />
            <Field
              label="Phone"
              value={newOrg.phone}
              onChange={(v) => setNewOrg({ ...newOrg, phone: v })}
            />
            <Field
              label="Email"
              type="email"
              value={newOrg.email}
              onChange={(v) => setNewOrg({ ...newOrg, email: v })}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddOrg(false)
                setNewOrg(EMPTY_ORG)
              }}
              className="px-4 py-2 rounded-lg border border-[#E5EAE3] text-sm text-[#2D352C] hover:bg-[#F5F8F3]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-[#E5EAE3] rounded-2xl shadow-sm divide-y divide-[#E5EAE3]">
        {organizations.length === 0 ? (
          <p className="text-sm text-[#6B7567] p-6">
            No organizations yet.
          </p>
        ) : (
          organizations.map((org) => (
            <OrgRow key={org.id} org={org} />
          ))
        )}
      </div>
    </div>
  )
}

function OrgRow({ org }: { org: Organization }) {
  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-full bg-[#F5F8F3] text-[var(--accent-strong)] grid place-items-center font-semibold border border-[#E5EAE3]">
          {org.type?.charAt(0).toUpperCase() ?? '?'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#2D352C] truncate">
            {org.name}
          </p>
          <p className="text-xs text-[#8B9B83] capitalize">
            {org.type?.replace('_', ' ')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-6 text-xs text-[#6B7567] flex-shrink-0">
        <Stat label="Patients" value={org.patientCount ?? 0} />
        <Stat label="Admins" value={org.adminCount ?? 0} />
        {org.inviteCode && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-[#8B9B83]">
              Invite code
            </p>
            <p className="font-mono text-[var(--accent-strong)]">{org.inviteCode}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-base font-semibold text-[#2D352C] tabular-nums">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-[#8B9B83]">
        {label}
      </p>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  type?: string
}

function Field({ label, value, onChange, required, type = 'text' }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#6B7567] mb-1">
        {label}
        {required && <span className="text-[#DC2626] ml-0.5">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg text-[#2D352C] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)]"
      />
    </label>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#6B7567] mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-white border border-[#E5EAE3] rounded-lg text-[#2D352C] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Legacy Messages tab — preserves the existing UserPicker + MessageThread
// pairing inside the new shell until a dedicated MessagesTab lands.
// ---------------------------------------------------------------------------

function MessagesTabLegacy() {
  const { user } = useAuth()
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(
    null
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[#2D352C]">Messages</h1>
        <p className="text-sm text-[#6B7567] mt-1">
          Direct conversations with patients and providers.
        </p>
      </div>
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-0 bg-white border border-[#E5EAE3] rounded-2xl shadow-sm overflow-hidden"
        style={{ height: 'calc(100vh - 220px)' }}
      >
        <aside className="md:col-span-1 border-r border-[#E5EAE3] min-h-0">
          <UserPicker
            selectedUserId={selectedUser?.id ?? null}
            onSelect={(u) => setSelectedUser(u)}
          />
        </aside>
        <section className="md:col-span-2 min-h-0">
          {selectedUser && user ? (
            <MessageThread
              threadUser={selectedUser}
              adminUserId={user.id}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <p className="text-sm text-[#6B7567] text-center">
                Select a user to start or continue a conversation.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
