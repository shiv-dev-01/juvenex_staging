/**
 * Questionnaire / checkout → n8n webhook (WhiteLabelMD).
 *
 * Posts the exact payload shape expected by:
 *   https://n8n.whitelabelmd.com/webhook/f7e33dc8-c81c-4879-b36b-eafe07e02c65
 *
 * GHL / n8n site_id = 453 (JUVENEX_CHECKOUT_SITE_ID).
 * Product pricing uses site 614 and does not read this constant.
 *
 * Behavior:
 * - Persist answers + tracking in sessionStorage.
 * - Fire once per trigger key (page / field / submit) so Strict Mode and
 *   re-renders do not duplicate; submit may force a final send.
 * - Failures are logged and never block checkout.
 */

const WEBHOOK_URL =
  'https://n8n.whitelabelmd.com/webhook/f7e33dc8-c81c-4879-b36b-eafe07e02c65'

/** Must match JUVENEX_CHECKOUT_SITE_ID in .env */
export const SITE_ID = '453'

const TRACKING_STORAGE_KEY = 'jx_questionnaire_tracking_v1'
const QUESTIONNAIRE_STORAGE_KEY = 'jx_questionnaire_data_v1'
const WEBHOOK_FIRED_KEYS = 'jx_questionnaire_webhook_fired_v1'

const CODE_TO_STATE_NAME: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
}

export type TrackingParams = {
  source_url: string
  click_id: string
  utm_source: string
  utm_medium: string
  utm_term: string
  utm_campaign: string
  utm_content: string
  fbclid: string
  google_click_id: string
  msclkid: string
}

export type QuestionnaireData = {
  state: string
  firstName: string
  lastName: string
  email: string
  emailConsent: boolean
  phone: string
  smsConsent: string
  dobMonth: string
  dobDay: string
  dobYear: string
  gender: string
  heightFeet: string
  heightInches: string
  weight: string
  goalWeight: string
  currentlyTakesMedication: string
  selectedMedicationType: string
  selectedDosage: string
  selectedFinalMedication: string
  edPriorTreatments: string
  edProblemDuration: string
  address?: string
  address2?: string
  city?: string
  zip?: string
}

export type QuestionnaireWebhookPayload = {
  site_id: string
  state: string
  first_name: string
  last_name: string
  email: string
  email_consent: string
  phone: string
  sms_consent: string
  dob: string
  gender: string
  bmi: number | null
  weight_current: number | null
  weight_goal: number | null
  taking_weight_loss_meds: string
  weight_loss_medications_currently_taking: string
  medication_trying_to_get: string
  source_url: string
  click_id: string
  utm_source: string
  utm_medium: string
  utm_term: string
  utm_campaign: string
  utm_content: string
  fbclid: string
  google_click_id: string
  msclkid: string
  medication_dose: string
  ed_prior_treatments: string
  ed_problem_duration: string
}

const EMPTY_TRACKING: TrackingParams = {
  source_url: '',
  click_id: '',
  utm_source: '',
  utm_medium: '',
  utm_term: '',
  utm_campaign: '',
  utm_content: '',
  fbclid: '',
  google_click_id: '',
  msclkid: '',
}

const EMPTY_QUESTIONNAIRE: QuestionnaireData = {
  state: '',
  firstName: '',
  lastName: '',
  email: '',
  emailConsent: true,
  phone: '',
  smsConsent: '',
  dobMonth: '',
  dobDay: '',
  dobYear: '',
  gender: '',
  heightFeet: '',
  heightInches: '',
  weight: '',
  goalWeight: '',
  currentlyTakesMedication: '',
  selectedMedicationType: '',
  selectedDosage: '',
  selectedFinalMedication: '',
  edPriorTreatments: '',
  edProblemDuration: '',
}

/** In-flight guards so Strict Mode double-effects don't double-POST. */
const inFlight = new Set<string>()

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error('[questionnaireWebhook] Failed to persist session data:', error)
  }
}

function readFiredKeys(): Set<string> {
  try {
    const raw = sessionStorage.getItem(WEBHOOK_FIRED_KEYS)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function markFired(key: string): void {
  try {
    const keys = readFiredKeys()
    keys.add(key)
    sessionStorage.setItem(WEBHOOK_FIRED_KEYS, JSON.stringify([...keys]))
  } catch {
    /* ignore */
  }
}

export function isWebhookTriggerFired(triggerKey: string): boolean {
  if (typeof window === 'undefined') return false
  return readFiredKeys().has(triggerKey) || inFlight.has(triggerKey)
}

function pad2(value: string): string {
  return value.padStart(2, '0')
}

function formatDob(month: string, day: string, year: string): string {
  if (!month || !day || !year) return ''
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** Accept YYYY-MM-DD and split into month/day/year parts. */
export function splitIsoDob(iso: string): { dobMonth: string; dobDay: string; dobYear: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return { dobMonth: '', dobDay: '', dobYear: '' }
  return { dobYear: m[1], dobMonth: String(Number(m[2])), dobDay: String(Number(m[3])) }
}

function capitalizeGender(gender: string): string {
  if (!gender) return ''
  const g = gender.toLowerCase()
  if (g === 'male' || g === 'm') return 'Male'
  if (g === 'female' || g === 'f') return 'Female'
  return gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase()
}

function parseNumberOrNull(value: string): number | null {
  if (value === '' || value == null) return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function calculateBmi(
  weightLbs: string,
  heightFeet: string,
  heightInches: string
): number | null {
  const weight = parseFloat(weightLbs)
  const feet = parseFloat(heightFeet)
  const inches = parseFloat(heightInches)
  if (!Number.isFinite(weight) || !Number.isFinite(feet) || !Number.isFinite(inches)) {
    return null
  }
  const totalInches = feet * 12 + inches
  if (totalInches <= 0) return null
  return Math.round((weight / (totalInches * totalInches)) * 703 * 100) / 100
}

/** Prefer full state name in the webhook payload (e.g. "Idaho"). */
export function formatStateForWebhook(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  if (CODE_TO_STATE_NAME[upper]) return CODE_TO_STATE_NAME[upper]
  return trimmed
}

export function captureTrackingParams(
  search: string = typeof window !== 'undefined' ? window.location.search : ''
): TrackingParams {
  if (typeof window === 'undefined') return { ...EMPTY_TRACKING }
  const existing = readJson<TrackingParams>(TRACKING_STORAGE_KEY) ?? { ...EMPTY_TRACKING }
  const params = new URLSearchParams(search)

  const next: TrackingParams = {
    click_id: existing.click_id || params.get('click_id') || '',
    utm_source: existing.utm_source || params.get('utm_source') || '',
    utm_medium: existing.utm_medium || params.get('utm_medium') || '',
    utm_term: existing.utm_term || params.get('utm_term') || '',
    utm_campaign: existing.utm_campaign || params.get('utm_campaign') || '',
    utm_content: existing.utm_content || params.get('utm_content') || '',
    fbclid: existing.fbclid || params.get('fbclid') || '',
    google_click_id:
      existing.google_click_id ||
      params.get('google_click_id') ||
      params.get('gclid') ||
      '',
    msclkid: existing.msclkid || params.get('msclkid') || '',
    source_url: existing.source_url || window.location.href,
  }

  writeJson(TRACKING_STORAGE_KEY, next)
  return next
}

export function getTrackingParams(): TrackingParams {
  if (typeof window === 'undefined') return { ...EMPTY_TRACKING }
  return readJson<TrackingParams>(TRACKING_STORAGE_KEY) ?? captureTrackingParams()
}

export function saveQuestionnaireData(data: QuestionnaireData): void {
  if (typeof window === 'undefined') return
  writeJson(QUESTIONNAIRE_STORAGE_KEY, data)
}

export function patchQuestionnaireData(partial: Partial<QuestionnaireData>): QuestionnaireData {
  if (typeof window === 'undefined') return { ...EMPTY_QUESTIONNAIRE, ...partial }
  const current = getQuestionnaireData() ?? { ...EMPTY_QUESTIONNAIRE }
  const merged = { ...current, ...partial }
  writeJson(QUESTIONNAIRE_STORAGE_KEY, merged)
  return merged
}

export function getQuestionnaireData(): QuestionnaireData | null {
  if (typeof window === 'undefined') return null
  return readJson<QuestionnaireData>(QUESTIONNAIRE_STORAGE_KEY)
}

export function buildQuestionnairePayload(
  data?: Partial<QuestionnaireData> & Partial<TrackingParams>
): QuestionnaireWebhookPayload {
  const stored = getQuestionnaireData() ?? EMPTY_QUESTIONNAIRE
  const merged: QuestionnaireData = {
    ...stored,
    ...(data || {}),
    emailConsent:
      data && 'emailConsent' in data ? Boolean(data.emailConsent) : stored.emailConsent,
  }

  if (typeof window !== 'undefined') {
    captureTrackingParams(window.location.search)
  }
  const tracking = getTrackingParams()
  const trackingOverride = data || {}

  const selectedMed =
    merged.selectedFinalMedication || merged.selectedMedicationType || ''
  const currentlyTaking = merged.currentlyTakesMedication === 'yes'

  return {
    site_id: SITE_ID,
    state: formatStateForWebhook(merged.state || ''),
    first_name: merged.firstName || '',
    last_name: merged.lastName || '',
    email: merged.email || '',
    email_consent: merged.emailConsent ? 'yes' : 'no',
    phone: merged.phone || '',
    sms_consent:
      merged.smsConsent === 'yes' ? 'yes' : merged.smsConsent === 'no' ? 'no' : '',
    dob: formatDob(merged.dobMonth, merged.dobDay, merged.dobYear),
    gender: capitalizeGender(merged.gender),
    bmi: calculateBmi(merged.weight, merged.heightFeet, merged.heightInches),
    weight_current: parseNumberOrNull(merged.weight),
    weight_goal: parseNumberOrNull(merged.goalWeight),
    taking_weight_loss_meds:
      merged.currentlyTakesMedication === 'yes'
        ? 'yes'
        : merged.currentlyTakesMedication === 'no'
          ? 'no'
          : '',
    weight_loss_medications_currently_taking: currentlyTaking
      ? merged.selectedMedicationType || ''
      : '',
    medication_trying_to_get: selectedMed,
    source_url:
      (trackingOverride.source_url as string | undefined) || tracking.source_url || '',
    click_id: (trackingOverride.click_id as string | undefined) || tracking.click_id || '',
    utm_source:
      (trackingOverride.utm_source as string | undefined) || tracking.utm_source || '',
    utm_medium:
      (trackingOverride.utm_medium as string | undefined) || tracking.utm_medium || '',
    utm_term: (trackingOverride.utm_term as string | undefined) || tracking.utm_term || '',
    utm_campaign:
      (trackingOverride.utm_campaign as string | undefined) || tracking.utm_campaign || '',
    utm_content:
      (trackingOverride.utm_content as string | undefined) || tracking.utm_content || '',
    fbclid: (trackingOverride.fbclid as string | undefined) || tracking.fbclid || '',
    google_click_id:
      (trackingOverride.google_click_id as string | undefined) ||
      tracking.google_click_id ||
      '',
    msclkid: (trackingOverride.msclkid as string | undefined) || tracking.msclkid || '',
    medication_dose: merged.selectedDosage || '',
    ed_prior_treatments: merged.edPriorTreatments || '',
    ed_problem_duration: merged.edProblemDuration || '',
  }
}

export async function sendQuestionnaireWebhook(
  data?: Partial<QuestionnaireData> & Partial<TrackingParams>
): Promise<void> {
  const payload = buildQuestionnairePayload(data)
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    console.error('Questionnaire webhook failed:', error)
  }
}

export type FireWebhookOptions = {
  /** When true, always POST even if this trigger already fired. */
  force?: boolean
}

/**
 * Persist optional patch, then POST once for `triggerKey`.
 * Use distinct keys: `page:cart`, `field:firstName`, `submit:checkout`, etc.
 */
export async function fireQuestionnaireWebhook(
  triggerKey: string,
  patch?: Partial<QuestionnaireData>,
  options?: FireWebhookOptions
): Promise<void> {
  if (typeof window === 'undefined') return
  if (!triggerKey) return

  if (patch && Object.keys(patch).length > 0) {
    patchQuestionnaireData(patch)
  }

  const force = options?.force === true
  if (!force) {
    if (inFlight.has(triggerKey) || readFiredKeys().has(triggerKey)) return
    inFlight.add(triggerKey)
    markFired(triggerKey)
  } else {
    inFlight.add(triggerKey)
  }

  try {
    await sendQuestionnaireWebhook()
  } catch (error) {
    console.error('Questionnaire webhook failed:', error)
  } finally {
    inFlight.delete(triggerKey)
  }
}

/**
 * Persist a field change and fire once when the field first has a non-empty value.
 * Call from onChange/setField — safe to call on every keystroke.
 */
export function trackQuestionnaireField(
  fieldKey: string,
  value: string,
  patch: Partial<QuestionnaireData>
): void {
  if (typeof window === 'undefined') return
  patchQuestionnaireData(patch)
  if (!String(value ?? '').trim()) return
  void fireQuestionnaireWebhook(`field:${fieldKey}`, patch)
}

/** Map checkout shipping fields → questionnaire patch keys. */
export function checkoutFieldsToPatch(
  fields: {
    firstName?: string
    lastName?: string
    phone?: string
    stateName?: string
    address?: string
    address2?: string
    cityName?: string
    zipCode?: string
  },
  email?: string
): Partial<QuestionnaireData> {
  const patch: Partial<QuestionnaireData> = {}
  if (fields.firstName != null) patch.firstName = fields.firstName
  if (fields.lastName != null) patch.lastName = fields.lastName
  if (fields.phone != null) patch.phone = fields.phone
  if (fields.stateName != null) patch.state = fields.stateName
  if (fields.address != null) patch.address = fields.address
  if (fields.address2 != null) patch.address2 = fields.address2
  if (fields.cityName != null) patch.city = fields.cityName
  if (fields.zipCode != null) patch.zip = fields.zipCode
  if (email != null) patch.email = email
  return patch
}

/** Split a full name into first / last for shipping forms that use a single name field. */
export function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}
