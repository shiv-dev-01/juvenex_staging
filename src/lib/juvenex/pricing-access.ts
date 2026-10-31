/**
 * Who may open the hidden pricing portal and call /api/admin/pricing.
 *
 * The portal is not linked from the site. A person signs in through the
 * normal /login page first; only these accounts (plus super_admin) then
 * get the dashboard at /admin/pricing.
 *
 * Override the list with JUVENEX_PRICING_ADMIN_EMAILS (comma-separated).
 * The password is never stored here — it is the account's normal sign-in password.
 */

const DEFAULT_PRICING_ADMIN_EMAILS = ['juvenex.demo.login@mailinator.com']

export function pricingAdminEmails(): string[] {
  const raw = process.env.JUVENEX_PRICING_ADMIN_EMAILS?.trim()
  if (!raw) return DEFAULT_PRICING_ADMIN_EMAILS
  const parsed = raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length ? parsed : DEFAULT_PRICING_ADMIN_EMAILS
}

export function canManagePricing(user: {
  email?: string | null
  role?: string | null
}): boolean {
  if (user.role === 'super_admin') return true
  const email = user.email?.trim().toLowerCase() ?? ''
  return email.length > 0 && pricingAdminEmails().includes(email)
}
