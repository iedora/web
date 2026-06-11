import 'server-only'
import { apiJson, MENU_URL } from '@iedora/api-client'

/**
 * Typed client for the Go menu service — the menu product's ONLY data
 * surface. DTOs mirror the Go structs (services/internal/menu); one
 * function per endpoint, all server-side via the Bearer-attaching
 * `apiJson` (which refreshes once on 401).
 */

// --- DTOs (mirror services/internal/menu/domain.go etc.) ---

export type LocalizedText = Record<string, string>
export type Theme = Record<string, unknown>

export type Variant = {
  label: string
  labelI18n?: LocalizedText
  priceCents: number
}

export type Restaurant = {
  id: string
  tenantId: string
  name: string
  slug: string
  description?: string
  descriptionI18n?: LocalizedText
  logoUrl?: string
  bannerUrl?: string
  theme?: Theme
  defaultLanguage: string
  supportedLanguages: string[]
  onboardingCompletedAt?: string
  updatedAt: string
}

export type ItemNode = {
  id: string
  categoryId: string
  name: string
  nameI18n?: LocalizedText
  description?: string
  descriptionI18n?: LocalizedText
  priceCents: number
  currency: string
  imageUrl?: string
  position: number
  available: boolean
  tags: string[]
  variants: Variant[]
}

export type CategoryNode = {
  id: string
  menuId: string
  name: string
  nameI18n?: LocalizedText
  description?: string
  descriptionI18n?: LocalizedText
  position: number
  items: ItemNode[]
}

export type MenuNode = {
  id: string
  name: string
  nameI18n?: LocalizedText
  description?: string
  descriptionI18n?: LocalizedText
  position: number
  active: boolean
  categories: CategoryNode[]
}

export type RestaurantSummary = {
  id: string
  name: string
  slug: string
  updatedAt: string
  menuCount: number
  dishCount: number
}

export type MenuSummary = {
  id: string
  name: string
  active: boolean
  position: number
  updatedAt: string
  categoryCount: number
  dishCount: number
}

export type PlanLimits = {
  code: string
  restaurants: number // -1 = unlimited
  monthlyViews: number
  aiGenerationsWeek: number
}

export type DailyPoint = { day: string; count: number }

export type Analytics = {
  range: string
  totalScans: number
  todayScans: number
  dailyBreakdown: DailyPoint[]
  menus: { total: number; active: number }
  dishes: { total: number; lastAddedAt: string | null }
  languages: string[]
}

// Public (unauthenticated) read model.
export type PublicVariant = { label: string; priceCents: number }
export type PublicItem = {
  id: string
  name: string
  description?: string
  priceCents: number
  currency: string
  imageUrl?: string
  tags: string[]
  variants: PublicVariant[]
}
export type PublicCategory = {
  id: string
  name: string
  description?: string
  items: PublicItem[]
}
export type PublicMenu = {
  id: string
  name: string
  description?: string
  categories: PublicCategory[]
}
export type PublicMenuPayload = {
  restaurant: {
    name: string
    slug: string
    description?: string
    logoUrl?: string
    bannerUrl?: string
    theme?: Theme
  }
  menus: PublicMenu[]
  defaultLanguage: string
  supportedLanguages: string[]
  currentLanguage: string
}

// Staff surface.
export type StaffRestaurantRow = {
  id: string
  tenantId: string
  name: string
  slug: string
  menuCount: number
  dishCount: number
  views30d: number
  updatedAt: string
}
export type StaffOverview = {
  restaurants: number
  activeMenus: number
  items: number
  viewsToday: number
  views30d: number
  qrBound: number
  qrUnbound: number
  topByViews: StaffRestaurantRow[]
}
export type QRCode = {
  code: string
  restaurantId?: string
  restaurantName?: string
  restaurantSlug?: string
  label?: string
  boundAt?: string
  createdAt: string
}
export type RestaurantRef = {
  id: string
  tenantId: string
  name: string
  slug: string
}

export type PresignedUpload = {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresInSeconds: number
  maxBytes: number
}
export type UploadTarget =
  | 'restaurant-logo'
  | 'restaurant-banner'
  | 'item-photo'
  | 'menu-import-photo'

// Write payloads (mirror service_builder.go / service.go).
export type TextFields = {
  name: string
  nameI18n?: LocalizedText
  description?: string
  descriptionI18n?: LocalizedText
}
export type MenuUpdate = TextFields & { active: boolean }
export type CategoryUpdate = TextFields
export type ItemWrite = TextFields & {
  priceCents: number
  currency?: string
  available?: boolean
  tags?: string[]
  variants?: Variant[]
}
export type IdentityPatch = {
  name?: string
  description?: string
  descriptionI18n?: LocalizedText
  theme?: Theme
  defaultLanguage?: string
  supportedLanguages?: string[]
}

// --- tenant-level ---

export function listRestaurants() {
  return apiJson<{ restaurants: RestaurantSummary[] }>('/api/restaurants')
}

export function createRestaurant(name: string, defaultLanguage: string) {
  return apiJson<Restaurant>('/api/restaurants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, defaultLanguage }),
  })
}

export function getPlan() {
  return apiJson<PlanLimits>('/api/plan')
}

export function getAnalytics(range: string) {
  return apiJson<Analytics>(`/api/analytics?range=${encodeURIComponent(range)}`)
}

export function getMonthlyViews() {
  return apiJson<{ count: number }>('/api/views/month')
}

// --- restaurant-scoped ---

const r = (slug: string) => `/api/restaurants/${encodeURIComponent(slug)}`

export function getRestaurant(slug: string) {
  return apiJson<{ restaurant: Restaurant; menus: MenuSummary[] }>(r(slug))
}

export function updateIdentity(slug: string, patch: IdentityPatch) {
  return apiJson<Restaurant>(r(slug), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteRestaurant(slug: string) {
  return apiJson<void>(r(slug), { method: 'DELETE' })
}

export function renameSlug(slug: string, next: string) {
  return apiJson<void>(`${r(slug)}/slug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: next }),
  })
}

export function completeOnboarding(slug: string) {
  return apiJson<void>(`${r(slug)}/complete-onboarding`, { method: 'POST' })
}

export function seedSampleMenu(slug: string) {
  return apiJson<{ menuId: string }>(`${r(slug)}/seed`, { method: 'POST' })
}

export function getMenuTree(slug: string) {
  return apiJson<{
    menus: MenuNode[]
    defaultLanguage: string
    supportedLanguages: string[]
  }>(`${r(slug)}/tree`)
}

// --- builder ---

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function createMenu(slug: string, name: string) {
  return apiJson<{ id: string }>(`${r(slug)}/menus`, { method: 'POST', ...json({ name }) })
}

export function updateMenu(slug: string, menuId: string, update: MenuUpdate) {
  return apiJson<void>(`${r(slug)}/menus/${menuId}`, { method: 'PATCH', ...json(update) })
}

export function deleteMenu(slug: string, menuId: string) {
  return apiJson<void>(`${r(slug)}/menus/${menuId}`, { method: 'DELETE' })
}

export function reorderCategories(slug: string, menuId: string, orderedIds: string[]) {
  return apiJson<void>(`${r(slug)}/menus/${menuId}/category-order`, {
    method: 'PUT',
    ...json({ orderedIds }),
  })
}

export function createCategory(slug: string, menuId: string, name: string) {
  return apiJson<{ id: string }>(`${r(slug)}/menus/${menuId}/categories`, {
    method: 'POST',
    ...json({ name }),
  })
}

export function updateCategory(slug: string, categoryId: string, update: CategoryUpdate) {
  return apiJson<void>(`${r(slug)}/categories/${categoryId}`, { method: 'PATCH', ...json(update) })
}

export function deleteCategory(slug: string, categoryId: string) {
  return apiJson<void>(`${r(slug)}/categories/${categoryId}`, { method: 'DELETE' })
}

export function reorderItems(slug: string, categoryId: string, orderedIds: string[]) {
  return apiJson<void>(`${r(slug)}/categories/${categoryId}/item-order`, {
    method: 'PUT',
    ...json({ orderedIds }),
  })
}

export function createItem(slug: string, categoryId: string, item: ItemWrite) {
  return apiJson<{ id: string }>(`${r(slug)}/categories/${categoryId}/items`, {
    method: 'POST',
    ...json(item),
  })
}

export function updateItem(slug: string, itemId: string, item: ItemWrite) {
  return apiJson<void>(`${r(slug)}/items/${itemId}`, { method: 'PATCH', ...json(item) })
}

export function deleteItem(slug: string, itemId: string) {
  return apiJson<void>(`${r(slug)}/items/${itemId}`, { method: 'DELETE' })
}

// --- uploads (presign → browser PUT → commit) ---

export function presignUpload(
  slug: string,
  target: UploadTarget,
  contentType: string,
  itemId?: string,
) {
  return apiJson<PresignedUpload>(`${r(slug)}/uploads/presign`, {
    method: 'POST',
    ...json({ target, contentType, itemId }),
  })
}

export function commitUpload(slug: string, target: UploadTarget, key: string, itemId?: string) {
  return apiJson<{ url: string }>(`${r(slug)}/uploads/commit`, {
    method: 'POST',
    ...json({ target, key, itemId }),
  })
}

export function clearUpload(slug: string, target: UploadTarget, itemId?: string) {
  return apiJson<void>(`${r(slug)}/uploads/clear`, { method: 'POST', ...json({ target, itemId }) })
}

// --- public (unauthenticated; SSR of the guest menu page) ---

export function getPublicMenu(slug: string, lang?: string, acceptLanguage?: string) {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  return apiJson<PublicMenuPayload>(
    `${MENU_URL}/public/r/${encodeURIComponent(slug)}${qs}`,
    acceptLanguage ? { headers: { 'Accept-Language': acceptLanguage } } : {},
  )
}

export function resolveQRCode(code: string) {
  return apiJson<{ slug: string }>(`${MENU_URL}/public/qr/${encodeURIComponent(code)}`)
}

// --- staff (cross-tenant; requires the staff role) ---

export function staffOverview() {
  return apiJson<StaffOverview>('/api/staff/overview')
}

export function staffDirectory(q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  return apiJson<{ restaurants: StaffRestaurantRow[] }>(`/api/staff/directory${qs}`)
}

export function listQRCodes() {
  return apiJson<{ codes: QRCode[] }>('/api/staff/qr-codes')
}

export function createQRCodes(input: {
  code?: string
  count?: number
  restaurantId?: string
  label?: string
}) {
  return apiJson<{ inserted: number }>('/api/staff/qr-codes', { method: 'POST', ...json(input) })
}

export function bindQRCode(code: string, restaurantId: string) {
  return apiJson<void>(`/api/staff/qr-codes/${encodeURIComponent(code)}/bind`, {
    method: 'POST',
    ...json({ restaurantId }),
  })
}

export function unbindQRCode(code: string) {
  return apiJson<void>(`/api/staff/qr-codes/${encodeURIComponent(code)}/unbind`, {
    method: 'POST',
  })
}

export function labelQRCode(code: string, label: string) {
  return apiJson<void>(`/api/staff/qr-codes/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    ...json({ label }),
  })
}

export function deleteQRCode(code: string) {
  return apiJson<void>(`/api/staff/qr-codes/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export function listRestaurantRefs() {
  return apiJson<{ restaurants: RestaurantRef[] }>('/api/staff/restaurants')
}
