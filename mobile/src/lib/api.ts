import AsyncStorage from '@react-native-async-storage/async-storage'
import { File } from 'expo-file-system'
import { fetch as expoFetch } from 'expo/fetch'
import { Platform } from 'react-native'
import { API_BASE_URL } from './api-config'
import type {
  ComplaintCategory,
  Customer,
  JobStatus,
  ProductItem,
  ServiceItem,
  StockCategory,
  StockProduct,
  Supplier,
  Vehicle,
} from './types'
import { COMPLAINT_CATEGORY_ORDER } from './types'

function normalizeComplaintCategory(raw?: string | null): ComplaintCategory {
  const c = (raw ?? 'diger').trim().toLowerCase()
  return (COMPLAINT_CATEGORY_ORDER as string[]).includes(c)
    ? (c as ComplaintCategory)
    : 'diger'
}

const TOKEN_KEY = 'otoservis_token'
const USER_KEY = 'otoservis_user'
const USER_ID_KEY = 'otoservis_user_id'
const USER_ROLE_KEY = 'otoservis_user_role'
const TENANT_CODE_KEY = 'otoservis_tenant_code'
const SHOP_NAME_KEY = 'otoservis_shop_name'
const REMEMBER_KEY = 'otoservis_remember'
const REMEMBER_PHONE_KEY = 'otoservis_remember_phone'
const REMEMBER_PASSWORD_KEY = 'otoservis_remember_password'

export type ShopLicense = {
  licenseType: string
  licenseExpiresAt?: string | null
  licenseStatus: 'active' | 'warning' | 'expired'
  daysRemaining?: number | null
}

export type PlanFeatures = {
  stock: boolean
  suppliers: boolean
  staffPerformance: boolean
  aiRuhsat: boolean
  aiInvoice: boolean
  apiAccess: boolean
}

export type PlanEntitlements = {
  planCode: string
  planLabel: string
  monthlyPrice: number
  maxUsers: number | null
  maxVehiclesPerMonth: number | null
  features: PlanFeatures
}

export class PlanLimitError extends Error {
  code = 'PLAN_LIMIT'
  constructor(message?: string) {
    super(message || 'Paket limitine ulaşıldı.')
    this.name = 'PlanLimitError'
  }
}

export class PlanFeatureError extends Error {
  code = 'PLAN_FEATURE'
  feature?: string
  constructor(message?: string, feature?: string) {
    super(message || 'Bu özellik paketinizde yok.')
    this.name = 'PlanFeatureError'
    this.feature = feature
  }
}

export type AuthResult =
  | { ok: true; name: string; license?: ShopLicense | null }
  | { ok: false; error: string; licenseExpired?: boolean }

export type PlateConflictInfo = {
  vehicleId: string
  customerId: string
  customerName: string
  brand: string
  model: string
}

export class PlateConflictError extends Error {
  conflict: PlateConflictInfo
  /** Devret akışında bu araca atanacak müşteri — çağıran taraf doldurur. */
  resolvedCustomerId?: string

  constructor(conflict: PlateConflictInfo) {
    super(`Bu plaka zaten ${conflict.customerName} adlı müşteriye kayıtlı.`)
    this.name = 'PlateConflictError'
    this.conflict = conflict
  }
}

export class PhoneConflictError extends Error {
  constructor(message?: string) {
    super(message || 'Bu telefon numarasıyla kayıtlı bir müşteri zaten var.')
    this.name = 'PhoneConflictError'
  }
}

export class WorkOrderCompletedError extends Error {
  constructor(message?: string) {
    super(message || 'Bu iş tamamlanmış.')
    this.name = 'WorkOrderCompletedError'
  }
}

export class WorkOrderReopenBlockedError extends Error {
  constructor(message?: string) {
    super(
      message ||
        'Bu iş farklı bir günde tamamlandı, durumu geri alamazsınız. Yeni bir servis kaydı açabilirsiniz.',
    )
    this.name = 'WorkOrderReopenBlockedError'
  }
}

export class SessionReplacedError extends Error {
  constructor(message?: string) {
    super(message || 'Hesabınıza başka bir cihazdan giriş yapıldı. Lütfen tekrar giriş yapın.')
    this.name = 'SessionReplacedError'
  }
}

export class ShopLicenseExpiredError extends Error {
  constructor(message?: string) {
    super(
      message ||
        'Servis lisans süreniz dolmuştur. Yenileme için lütfen iletişime geçin.',
    )
    this.name = 'ShopLicenseExpiredError'
  }
}

type SessionInvalidatedHandler = () => void
let onSessionInvalidated: SessionInvalidatedHandler | null = null
let onLicenseExpired: SessionInvalidatedHandler | null = null
let cachedLicense: ShopLicense | null = null
let cachedEntitlements: PlanEntitlements | null = null

/** Başka cihazdan giriş algılandığında uygulama oturumu kapatmak için kaydolur. */
export function setSessionInvalidatedHandler(handler: SessionInvalidatedHandler | null) {
  onSessionInvalidated = handler
}

export function setLicenseExpiredHandler(handler: SessionInvalidatedHandler | null) {
  onLicenseExpired = handler
}

export function getCachedLicense(): ShopLicense | null {
  return cachedLicense
}

export function getCachedEntitlements(): PlanEntitlements | null {
  return cachedEntitlements
}

function mapEntitlements(raw: any): PlanEntitlements | null {
  if (!raw) return null
  const f = raw.features ?? raw.Features ?? {}
  return {
    planCode: String(raw.planCode ?? raw.PlanCode ?? ''),
    planLabel: String(raw.planLabel ?? raw.PlanLabel ?? ''),
    monthlyPrice: Number(raw.monthlyPrice ?? raw.MonthlyPrice ?? 0),
    maxUsers:
      raw.maxUsers != null || raw.MaxUsers != null
        ? Number(raw.maxUsers ?? raw.MaxUsers)
        : null,
    maxVehiclesPerMonth:
      raw.maxVehiclesPerMonth != null || raw.MaxVehiclesPerMonth != null
        ? Number(raw.maxVehiclesPerMonth ?? raw.MaxVehiclesPerMonth)
        : null,
    features: {
      stock: !!(f.stock ?? f.Stock),
      suppliers: !!(f.suppliers ?? f.Suppliers),
      staffPerformance: !!(f.staffPerformance ?? f.StaffPerformance),
      aiRuhsat: !!(f.aiRuhsat ?? f.AiRuhsat),
      aiInvoice: !!(f.aiInvoice ?? f.AiInvoice),
      apiAccess: !!(f.apiAccess ?? f.ApiAccess),
    },
  }
}

function mapLicense(raw: any): ShopLicense | null {
  if (!raw) return null
  const status = String(raw.licenseStatus ?? raw.LicenseStatus ?? 'active')
  return {
    licenseType: String(raw.licenseType ?? raw.LicenseType ?? 'unlimited'),
    licenseExpiresAt: raw.licenseExpiresAt ?? raw.LicenseExpiresAt ?? null,
    licenseStatus:
      status === 'warning' || status === 'expired' ? status : 'active',
    daysRemaining:
      raw.daysRemaining != null
        ? Number(raw.daysRemaining)
        : raw.DaysRemaining != null
          ? Number(raw.DaysRemaining)
          : null,
  }
}

export type CustomerVehicleSummary = {
  id: string
  plate: string
  brand: string
  model: string
  status: JobStatus
}

export type CurrentUser = { id: string; name: string; role: string }

export type StaffMember = { id: string; fullName: string; role: string }

export type ServiceCatalogItem = {
  id: string
  code?: string
  name: string
  category: string
  defaultPrice: number
}

let token: string | null = null

async function loadToken() {
  if (!token) token = await AsyncStorage.getItem(TOKEN_KEY)
  return token
}

export async function getStoredUser(): Promise<string | null> {
  return AsyncStorage.getItem(USER_KEY)
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const [name, id, role] = await Promise.all([
    AsyncStorage.getItem(USER_KEY),
    AsyncStorage.getItem(USER_ID_KEY),
    AsyncStorage.getItem(USER_ROLE_KEY),
  ])
  if (!name || !id) return null
  return { id, name, role: role ?? 'personel' }
}

export async function clearSession() {
  token = null
  cachedLicense = null
  cachedEntitlements = null
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, USER_ID_KEY, USER_ROLE_KEY, SHOP_NAME_KEY])
}

export async function getStoredTenantCode(): Promise<string | null> {
  return AsyncStorage.getItem(TENANT_CODE_KEY)
}

export type RememberedLogin = {
  identifier: string
  password: string
  /** @deprecated eski kayıtlar için */
  tenantCode?: string
  /** @deprecated eski kayıtlar için — identifier ile aynı */
  phone?: string
}

/** "Beni hatırla" ile saklanan giriş bilgileri (çıkışta silinmez). */
export async function getRememberedLogin(): Promise<RememberedLogin | null> {
  const flag = await AsyncStorage.getItem(REMEMBER_KEY)
  if (flag !== '1') return null
  const [loginId, password, tenantCode] = await Promise.all([
    AsyncStorage.getItem(REMEMBER_PHONE_KEY),
    AsyncStorage.getItem(REMEMBER_PASSWORD_KEY),
    AsyncStorage.getItem(TENANT_CODE_KEY),
  ])
  if (!loginId?.trim() || !password) return null
  return {
    identifier: loginId.trim(),
    password,
    phone: loginId.trim(),
    tenantCode: tenantCode ?? undefined,
  }
}

export async function saveRememberedLogin(data: RememberedLogin): Promise<void> {
  const id = (data.identifier || data.phone || '').trim()
  await AsyncStorage.multiSet([
    [REMEMBER_KEY, '1'],
    [REMEMBER_PHONE_KEY, id],
    [REMEMBER_PASSWORD_KEY, data.password],
  ])
}

export async function clearRememberedLogin(): Promise<void> {
  await AsyncStorage.multiRemove([REMEMBER_KEY, REMEMBER_PHONE_KEY, REMEMBER_PASSWORD_KEY])
}

export async function lookupTenant(code: string): Promise<{ shopName: string; city?: string } | null> {
  try {
    const q = encodeURIComponent(code.trim())
    return await api<{ shopName: string; city?: string }>(
      `/api/auth/lookup-tenant?code=${q}`,
      {},
      false,
    )
  } catch {
    return null
  }
}

async function api<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (auth) {
    const t = await loadToken()
    if (t) headers.Authorization = `Bearer ${t}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'Load failed' || msg === 'Failed to fetch' || e instanceof TypeError) {
      throw new Error('Sunucuya ulaşılamadı. API sitesini ve interneti kontrol edin.')
    }
    throw e
  }
  if (!res.ok) {
    let body: any = null
    try {
      body = await res.json()
    } catch {
      /* ignore */
    }
    if (res.status === 401 && (body?.code === 'SESSION_REPLACED' || body?.error?.includes?.('başka bir cihaz'))) {
      await clearSession()
      onSessionInvalidated?.()
      throw new SessionReplacedError(body?.error)
    }
    if (res.status === 403 && body?.code === 'SHOP_LICENSE_EXPIRED') {
      cachedLicense = {
        licenseType: 'unknown',
        licenseStatus: 'expired',
        daysRemaining: null,
      }
      if (auth) {
        await clearSession()
        onLicenseExpired?.()
      }
      throw new ShopLicenseExpiredError(body?.error)
    }
    if (res.status === 403 && body?.code === 'PLAN_LIMIT') {
      throw new PlanLimitError(body?.error)
    }
    if (res.status === 403 && body?.code === 'PLAN_FEATURE') {
      throw new PlanFeatureError(body?.error, body?.feature)
    }
    if (res.status === 409 && body?.vehicleId) {
      throw new PlateConflictError({
        vehicleId: body.vehicleId,
        customerId: body.customerId,
        customerName: body.customerName,
        brand: body.brand,
        model: body.model,
      })
    }
    if (res.status === 409 && body?.error) {
      if (body.error.includes('telefon numarasıyla')) throw new PhoneConflictError(body.error)
      if (body.error.includes('tamamlanmış')) throw new WorkOrderCompletedError(body.error)
      if (body.error.includes('farklı bir günde')) throw new WorkOrderReopenBlockedError(body.error)
      throw new Error(body.error)
    }
    let msg = `HTTP ${res.status}`
    if (body?.error) msg = body.error
    else if (body?.title) msg = body.title
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function mapStatus(s: string): JobStatus {
  if (s === 'islemde') return 'islemde'
  if (s === 'teslim_edildi') return 'teslim_edildi'
  if (s === 'odeme_tamamlandi') return 'odeme_tamamlandi'
  if (s === 'tamamlandi') return 'tamamlandi'
  return 'bekliyor'
}

export function mapFuel(f: string): string {
  const x = f.trim().toLowerCase()
  if (x.includes('diz')) return 'dizel'
  if (x.includes('benz')) return 'benzin'
  if (x.includes('lpg')) return 'lpg'
  if (x.includes('elek')) return 'elektrik'
  if (x.includes('hib')) return 'hibrit'
  if (['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit', 'diger'].includes(x)) return x
  return 'diger'
}

type WoDetail = {
  id: string
  status: string
  vehicle: {
    id: string
    customerId: string
    customerName: string
    plate: string
    brand: string
    model: string
    modelYear?: number
    color?: string
    fuel: string
    chassisNo?: string
    engineNo?: string
    engineVolume?: string
    mileage?: number
  }
  customer: {
    id: string
    fullName: string
    phone: string
    address?: string
    city?: string
  }
  complaints: { id: string; description: string; createdAt: string; category?: string }[]
  services: { id: string; title: string; price: number }[]
  parts: {
    id: string
    name: string
    quantity: number
    unitPrice: number
    source: string
    supplierId?: string
    supplierName?: string
    purchasePrice?: number
    returnedAt?: string
  }[]
  assignedTo?: string | null
  laborTotal?: number
  partsTotal?: number
  discount?: number
  grandTotal?: number
  paidTotal?: number
  openedAt?: string | null
  startedAt?: string | null
  closedAt?: string | null
  visitNumber?: number | null
}

function mapWorkOrder(wo: WoDetail): Vehicle {
  const v = wo.vehicle
  const c = wo.customer
  const visitNumber = wo.visitNumber != null ? Number(wo.visitNumber) : undefined
  return {
    id: v.id,
    workOrderId: wo.id,
    plate: v.plate,
    brand: v.brand,
    model: v.model,
    year: v.modelYear ? String(v.modelYear) : '',
    color: v.color ?? '',
    fuel: v.fuel,
    chassis: v.chassisNo ?? '',
    engineNo: v.engineNo ?? '',
    engineVolume: v.engineVolume ?? '',
    km: v.mileage != null ? String(v.mileage) : '',
    status: mapStatus(wo.status),
    assignedTo: wo.assignedTo ?? undefined,
    createdAt: wo.openedAt ?? new Date().toISOString(),
    startedAt: wo.startedAt ?? undefined,
    closedAt: wo.closedAt ?? undefined,
    visitNumber: visitNumber && visitNumber > 0 ? visitNumber : undefined,
    laborTotal: wo.laborTotal != null ? Number(wo.laborTotal) : undefined,
    partsTotal: wo.partsTotal != null ? Number(wo.partsTotal) : undefined,
    discount: wo.discount != null ? Number(wo.discount) : undefined,
    grandTotal: wo.grandTotal != null ? Number(wo.grandTotal) : undefined,
    paidTotal: wo.paidTotal != null ? Number(wo.paidTotal) : undefined,
    customer: {
      id: c.id,
      name: c.fullName,
      phone: c.phone,
      address: c.address ?? c.city,
    },
    complaints: wo.complaints.map((k) => ({
      id: k.id,
      text: k.description,
      createdAt: k.createdAt,
      category: normalizeComplaintCategory(k.category),
    })),
    services: wo.services.map((s) => ({
      id: s.id,
      title: s.title,
      price: Number(s.price),
    })),
    products: wo.parts.map((p) => ({
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      price: Number(p.unitPrice),
      source: p.source === 'disaridan' ? 'disaridan' : 'stok',
      supplierId: p.supplierId,
      supplierName: p.supplierName,
      purchasePrice: p.purchasePrice != null ? Number(p.purchasePrice) : undefined,
      returnedAt: p.returnedAt ?? undefined,
    })),
  }
}

export async function getStoredShopName(): Promise<string | null> {
  return AsyncStorage.getItem(SHOP_NAME_KEY)
}

export async function loginUser(
  identifier: string,
  password: string,
): Promise<AuthResult> {
  try {
    const storedTenant = (await AsyncStorage.getItem(TENANT_CODE_KEY))?.trim()
    const res = await api<{
      token: string
      user: { id: string; fullName: string }
      activeShop?: { shopName: string; tenantCode: string; role?: string }
      license?: any
      entitlements?: any
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: identifier.trim(),
        password,
        tenantCode: storedTenant || undefined,
      }),
    }, false)

    token = res.token
    cachedLicense = mapLicense(res.license)
    cachedEntitlements = mapEntitlements(res.entitlements)
    await AsyncStorage.setItem(TOKEN_KEY, res.token)
    await AsyncStorage.setItem(USER_KEY, res.user.fullName)
    await AsyncStorage.setItem(USER_ID_KEY, res.user.id)
    await AsyncStorage.setItem(USER_ROLE_KEY, res.activeShop?.role ?? 'personel')
    if (res.activeShop?.tenantCode) {
      await AsyncStorage.setItem(TENANT_CODE_KEY, res.activeShop.tenantCode)
    }
    if (res.activeShop?.shopName) {
      await AsyncStorage.setItem(SHOP_NAME_KEY, res.activeShop.shopName)
    }
    return { ok: true, name: res.user.fullName, license: cachedLicense }
  } catch (e) {
    if (e instanceof ShopLicenseExpiredError) {
      return { ok: false, error: e.message, licenseExpired: true }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Giriş başarısız.' }
  }
}

export async function fetchShopLicense(): Promise<ShopLicense | null> {
  try {
    const raw = await api<any>('/api/auth/license')
    cachedLicense = mapLicense(raw)
    return cachedLicense
  } catch (e) {
    if (e instanceof ShopLicenseExpiredError) throw e
    return cachedLicense
  }
}

export async function fetchEntitlements(): Promise<PlanEntitlements | null> {
  try {
    const raw = await api<any>('/api/auth/entitlements')
    cachedEntitlements = mapEntitlements(raw)
    return cachedEntitlements
  } catch {
    return cachedEntitlements
  }
}

export type AppUpdateInfo = {
  latestVersion: string
  latestVersionCode: number
  minVersionCode: number
  storeUrl?: string | null
  releaseNotes?: string | null
}

/**
 * Play Console sürüm kontrolü — kimlik doğrulama gerektirmez, uygulama açılışında
 * (giriş ekranından önce) çağrılabilir. Hata durumunda `null` döner; çağıran taraf
 * güncelleme kontrolünü sessizce atlamalı (ağ hatası kullanıcıyı kilitlemez).
 */
export async function fetchAppUpdateInfo(): Promise<AppUpdateInfo | null> {
  try {
    const raw = await api<any>('/api/app/update-info', {}, false)
    const latestVersionCode = Number(raw?.latestVersionCode ?? raw?.LatestVersionCode ?? 0)
    if (!latestVersionCode) return null
    return {
      latestVersion: String(raw?.latestVersion ?? raw?.LatestVersion ?? ''),
      latestVersionCode,
      minVersionCode: Number(raw?.minVersionCode ?? raw?.MinVersionCode ?? 0),
      storeUrl: raw?.storeUrl ?? raw?.StoreUrl ?? null,
      releaseNotes: raw?.releaseNotes ?? raw?.ReleaseNotes ?? null,
    }
  } catch {
    return null
  }
}

export async function registerUser(): Promise<AuthResult> {
  return {
    ok: false,
    error: 'Yeni hesap oluşturma yalnızca yönetici tarafından yapılabilir.',
  }
}

export async function initSession(): Promise<string | null> {
  const name = await getStoredUser()
  const t = await loadToken()
  if (!name || !t) return null
  try {
    await api('/api/dashboard')
    try {
      await fetchShopLicense()
    } catch {
      /* license fetch optional on boot */
    }
    try {
      await fetchEntitlements()
    } catch {
      /* entitlements optional on boot */
    }
    return name
  } catch (e) {
    // Sadece oturum/yetki hatalarında çıkış; ağ kesintisinde token korunur
    if (e instanceof SessionReplacedError) return null
    if (e instanceof ShopLicenseExpiredError) return null
    const msg = e instanceof Error ? e.message : ''
    if (
      msg.includes('HTTP 401') ||
      msg.includes('HTTP 403') ||
      msg.toLocaleLowerCase('tr').includes('unauthorized')
    ) {
      await clearSession()
      return null
    }
    // Offline / sunucu kapalı: kayıtlı oturumu koru, uygulama yine açılsın
    return name
  }
}

export type DashboardStats = {
  waiting: number
  inProgress: number
  customers: number
  vehicles: number
  staffCount: number
  lowStock: number
  monthVehiclesServiced: number
  monthOperations: number
}

export async function loadDashboardStats(): Promise<DashboardStats> {
  const d = await api<{
    waiting: number
    inProgress: number
    customers: number
    vehicles: number
    staffCount: number
    lowStock: number
    monthVehiclesServiced?: number
    monthOperations?: number
  }>('/api/dashboard')
  return {
    waiting: d.waiting,
    inProgress: d.inProgress,
    customers: d.customers,
    vehicles: d.vehicles,
    staffCount: d.staffCount,
    lowStock: d.lowStock,
    monthVehiclesServiced: d.monthVehiclesServiced ?? 0,
    monthOperations: d.monthOperations ?? 0,
  }
}

export type StaffPerformanceRow = {
  userId?: string
  fullName: string
  jobCount: number
  revenue: number
}

export async function getStaffPerformance(date?: string, userId?: string): Promise<StaffPerformanceRow[]> {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (userId) params.set('userId', userId)
  const q = params.toString()
  const rows = await api<{ userId?: string; fullName: string; jobCount: number; revenue: number }[]>(
    `/api/staff/performance${q ? `?${q}` : ''}`,
  )
  return rows.map((r) => ({ ...r, revenue: Number(r.revenue) }))
}

export type PaymentPendingItem = {
  workOrderId: string
  vehicleId: string
  plate: string
  customerName: string
  status: JobStatus
  grandTotal: number
  paidTotal: number
  remaining: number
  visitNumber?: number
  pendingSince?: string
  daysWaiting?: number
}

export type PaymentsPendingReport = {
  count: number
  totalRemaining: number
  items: PaymentPendingItem[]
}

export type CashTodayReport = {
  total: number
  nakit: number
  kart: number
  havale: number
  diger: number
}

export async function getPaymentsPending(): Promise<PaymentsPendingReport> {
  const d = await api<{
    count: number
    totalRemaining: number
    items: {
      workOrderId: string
      vehicleId: string
      plate: string
      customerName: string
      status: string
      grandTotal: number
      paidTotal: number
      remaining: number
      visitNumber?: number
      pendingSince?: string
      daysWaiting?: number
    }[]
  }>('/api/reports/payments-pending')
  return {
    count: d.count,
    totalRemaining: Number(d.totalRemaining),
    items: (d.items ?? []).map((i) => ({
      workOrderId: i.workOrderId,
      vehicleId: i.vehicleId,
      plate: i.plate,
      customerName: i.customerName,
      status: mapStatus(i.status),
      grandTotal: Number(i.grandTotal),
      paidTotal: Number(i.paidTotal),
      remaining: Number(i.remaining),
      visitNumber: i.visitNumber != null ? Number(i.visitNumber) : undefined,
      pendingSince: i.pendingSince ?? undefined,
      daysWaiting: i.daysWaiting != null ? Number(i.daysWaiting) : undefined,
    })),
  }
}

export async function getCashToday(): Promise<CashTodayReport> {
  const d = await api<{
    total: number
    nakit: number
    kart: number
    havale: number
    diger: number
  }>('/api/reports/cash-today')
  return {
    total: Number(d.total),
    nakit: Number(d.nakit),
    kart: Number(d.kart),
    havale: Number(d.havale),
    diger: Number(d.diger),
  }
}

export async function loadVehicles(): Promise<Vehicle[]> {
  const rows = await api<WoDetail[]>('/api/app/vehicles')
  return rows.map(mapWorkOrder)
}

export async function loadCustomers(): Promise<Customer[]> {
  const rows = await api<CustomerApiRow[]>('/api/customers')
  return rows.map(mapCustomerRow)
}

export async function loadStock(): Promise<StockProduct[]> {
  const rows = await api<{
    id: string
    name: string
    category: string
    code?: string
    price: number
    quantity: number
  }[]>('/api/stock')
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category as StockCategory,
    code: s.code ?? '-',
    price: Number(s.price),
    stock: s.quantity,
    purchasePrice: (s as { purchasePrice?: number | null }).purchasePrice != null
      ? Number((s as { purchasePrice?: number | null }).purchasePrice)
      : undefined,
  }))
}

export async function loadServiceCatalog(): Promise<ServiceCatalogItem[]> {
  const rows = await api<{
    id: string
    code?: string
    name: string
    category: string
    defaultPrice: number
  }[]>('/api/servicecatalog')
  return rows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    category: s.category,
    defaultPrice: Number(s.defaultPrice),
  }))
}

type CustomerApiRow = {
  id: string
  fullName: string
  phone: string
  address?: string
  city?: string
  isSupplier?: boolean
  isCustomer?: boolean
  taxNo?: string
  openingBalance?: number
  balance?: number
  supplierBalance?: number
}

function mapCustomerRow(c: CustomerApiRow): Customer {
  return {
    id: c.id,
    name: c.fullName,
    phone: c.phone,
    address: c.address ?? c.city,
    isSupplier: c.isSupplier ?? false,
    isCustomer: c.isCustomer ?? true,
    taxNo: c.taxNo,
    openingBalance: c.openingBalance != null ? Number(c.openingBalance) : undefined,
    balance: c.balance != null ? Number(c.balance) : undefined,
    supplierBalance: c.supplierBalance != null ? Number(c.supplierBalance) : undefined,
  }
}

export async function createCustomer(data: Omit<Customer, 'id'>): Promise<Customer> {
  const c = await api<CustomerApiRow>('/api/customers', {
    method: 'POST',
    body: JSON.stringify({
      fullName: data.name,
      phone: data.phone,
      address: data.address,
      isSupplier: data.isSupplier ?? false,
      isCustomer: data.isCustomer ?? true,
      taxNo: data.taxNo || null,
      openingBalance: data.isSupplier ? (data.openingBalance ?? 0) : 0,
    }),
  })
  return mapCustomerRow(c)
}

export async function updateCustomerApi(id: string, data: Omit<Customer, 'id'>): Promise<Customer> {
  const body: Record<string, unknown> = {
    fullName: data.name,
    phone: data.phone,
    address: data.address,
    isSupplier: data.isSupplier ?? false,
    isCustomer: data.isCustomer ?? true,
    taxNo: data.taxNo || null,
  }
  // Açılış bakiyesini sadece tedarikçi kaydında gönder; aksi halde API sıfırlamasın.
  if (data.isSupplier) body.openingBalance = data.openingBalance ?? 0
  const c = await api<CustomerApiRow>(`/api/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return mapCustomerRow(c)
}

export async function createStock(data: Omit<StockProduct, 'id'>): Promise<StockProduct> {
  const s = await api<{
    id: string
    name: string
    category: string
    code?: string
    price: number
    quantity: number
    purchasePrice?: number | null
  }>('/api/stock', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      category: data.category,
      code: data.code === '-' ? null : data.code,
      price: data.price,
      quantity: data.stock,
      purchasePrice: data.purchasePrice ?? null,
    }),
  })
  return {
    id: s.id,
    name: s.name,
    category: s.category as StockCategory,
    code: s.code ?? '-',
    price: Number(s.price),
    stock: s.quantity,
    purchasePrice: s.purchasePrice != null ? Number(s.purchasePrice) : undefined,
  }
}

/**
 * PDF'den okunan satır. unitPrice/lineTotal: e-Fatura'da KDV DAHİL net; Parçacı'da fatura değeri.
 * code: faturadaki ORİJİNAL stok kodu (firma ön ekleriyle), brand: marka.
 */
export type InvoiceScanLine = {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
  code?: string
  brand?: string
  netUnitPriceExclVat?: number
  vatRate?: number
  warning?: string
}

export type InvoiceScanResult = {
  documentNo?: string
  documentDate?: string
  lines: InvoiceScanLine[]
  provider?: string
  supplierName?: string
  grandTotal?: number
  format?: 'parcaci' | 'efatura'
  warning?: string
}

export async function scanInvoiceApi(fileBase64: string, mimeType = 'application/pdf'): Promise<InvoiceScanResult> {
  const raw = await api<{
    documentNo?: string
    documentDate?: string
    lines: {
      name: string
      quantity: number
      unitPrice: number
      lineTotal: number
      code?: string | null
      brand?: string | null
      netUnitPriceExclVat?: number | null
      vatRate?: number | null
      warning?: string | null
    }[]
    provider?: string
    supplierName?: string | null
    grandTotal?: number | null
    format?: string
    warning?: string | null
  }>('/api/ai/scan-invoice', {
    method: 'POST',
    body: JSON.stringify({ fileBase64, mimeType }),
  })
  return {
    documentNo: raw.documentNo,
    documentDate: raw.documentDate,
    provider: raw.provider,
    supplierName: raw.supplierName ?? undefined,
    grandTotal: raw.grandTotal != null ? Number(raw.grandTotal) : undefined,
    format: raw.format === 'efatura' ? 'efatura' : 'parcaci',
    warning: raw.warning ?? undefined,
    lines: (raw.lines ?? []).map((l) => ({
      name: (l.name ?? '').trim(),
      quantity: Math.max(1, Number(l.quantity) || 1),
      unitPrice: Number(l.unitPrice) || 0,
      lineTotal: Number(l.lineTotal) || 0,
      code: l.code?.trim() || undefined,
      brand: l.brand?.trim() || undefined,
      netUnitPriceExclVat: l.netUnitPriceExclVat != null ? Number(l.netUnitPriceExclVat) : undefined,
      vatRate: l.vatRate != null ? Number(l.vatRate) : undefined,
      warning: l.warning ?? undefined,
    })),
  }
}

/* ---- PDF satırı ↔ stok eşleştirme ---- */
export type MatchCandidate = {
  stockId: string
  name: string
  code?: string
  quantity: number
  price: number
  score: number
  reason: string
}

export type MatchStatus = 'exact' | 'multiple' | 'suggested' | 'none'

export type MatchLineResult = {
  index: number
  rawCode?: string
  manufacturerCode?: string
  status: MatchStatus
  candidates: MatchCandidate[]
}

export async function matchStockLinesApi(
  supplierId: string | null | undefined,
  lines: { index: number; name: string; rawCode?: string; brand?: string }[],
): Promise<MatchLineResult[]> {
  if (lines.length === 0) return []
  const raw = await api<
    {
      index: number
      rawCode?: string | null
      manufacturerCode?: string | null
      status: string
      candidates: {
        stockId: string
        name: string
        code?: string | null
        quantity: number
        price: number
        score: number
        reason: string
      }[]
    }[]
  >('/api/stock/match-lines', {
    method: 'POST',
    body: JSON.stringify({
      supplierId: supplierId || null,
      lines: lines.map((l) => ({
        index: l.index,
        name: l.name,
        rawCode: l.rawCode || null,
        brand: l.brand || null,
      })),
    }),
  })
  return (raw ?? []).map((r) => ({
    index: r.index,
    rawCode: r.rawCode ?? undefined,
    manufacturerCode: r.manufacturerCode ?? undefined,
    status: (['exact', 'multiple', 'suggested', 'none'].includes(r.status) ? r.status : 'none') as MatchStatus,
    candidates: (r.candidates ?? []).map((c) => ({
      stockId: c.stockId,
      name: c.name,
      code: c.code ?? undefined,
      quantity: Number(c.quantity) || 0,
      price: Number(c.price) || 0,
      score: Number(c.score) || 0,
      reason: c.reason,
    })),
  }))
}

export type ImportPurchaseLine = {
  name: string
  quantity: number
  unitPrice: number
  salePrice?: number
  category?: StockCategory
  /** Faturadaki orijinal kod (ön ekleriyle) */
  code?: string
  /** Kullanıcının/otomatik eşleşmenin seçtiği mevcut stok ürünü */
  stockProductId?: string
  /** Ön ekleri soyulmuş üretici kodu (yeni ürünün kodu olur) */
  manufacturerCode?: string
  brand?: string
}

export async function importPurchaseApi(
  supplierId: string,
  lines: ImportPurchaseLine[],
  documentNo?: string,
  documentDate?: string,
): Promise<{ createdCount: number; updatedCount: number; totalPurchase: number }> {
  return api('/api/stock/import-purchase', {
    method: 'POST',
    body: JSON.stringify({
      supplierId,
      documentNo: documentNo || null,
      documentDate: documentDate || null,
      lines: lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        salePrice: l.salePrice ?? l.unitPrice,
        category: l.category ?? 'diger',
        code: l.code || null,
        stockProductId: l.stockProductId || null,
        manufacturerCode: l.manufacturerCode || null,
        brand: l.brand || null,
      })),
    }),
  })
}

export async function updateStockApi(id: string, data: Omit<StockProduct, 'id'>): Promise<StockProduct> {
  const s = await api<{
    id: string
    name: string
    category: string
    code?: string
    price: number
    quantity: number
    minQuantity: number
    purchasePrice?: number | null
  }>(`/api/stock/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: data.name,
      category: data.category,
      code: data.code === '-' ? null : data.code,
      price: data.price,
      quantity: data.stock,
      minQuantity: 0,
      purchasePrice: data.purchasePrice ?? null,
    }),
  })
  return {
    id: s.id,
    name: s.name,
    category: s.category as StockCategory,
    code: s.code ?? '-',
    price: Number(s.price),
    stock: s.quantity,
    purchasePrice: s.purchasePrice != null ? Number(s.purchasePrice) : undefined,
  }
}

export async function deleteStockApi(id: string): Promise<void> {
  await api<void>(`/api/stock/${id}`, { method: 'DELETE' })
}

export async function createVehicleApi(
  customerId: string,
  plate: string,
  brand: string,
  model: string,
  year: string,
  color: string,
  fuel: string,
  chassis: string,
  engineNo: string,
  engineVolume: string,
  km: string,
  complaint?: string,
  complaintCategory?: ComplaintCategory,
  /** YYYY-MM-DD (TR takvim günü). Boşsa bugün. */
  openedAt?: string,
): Promise<Vehicle> {
  const res = await api<{ vehicleId: string; workOrderId: string }>('/api/vehicles', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      plate: plate.trim().toUpperCase(),
      brand,
      model,
      modelYear: year ? parseInt(year, 10) : null,
      color: color || null,
      fuel: mapFuel(fuel),
      chassisNo: chassis ? chassis.trim().toUpperCase() : null,
      engineNo: engineNo || null,
      engineVolume: engineVolume || null,
      mileage: km ? parseInt(km.replace(/\D/g, ''), 10) : null,
      complaint: complaint || null,
      complaintCategory: complaint ? complaintCategory || 'diger' : null,
      openedAt: openedAt || null,
    }),
  })
  // Az önce oluşturulan iş emrini doğrudan kendi id'siyle çekiyoruz.
  // Önceden burada tüm araç listesi yüklenip "her aracın en son iş emri"
  // sorgusuyla eşleştirme yapılıyordu; bu, aynı saniye içinde açılan başka
  // iş emirleriyle karışma riski taşıyordu (bkz. opened_at saniye hassasiyeti).
  return refreshVehicle(res.workOrderId)
}

export type VehicleInfoPayload = {
  plate: string
  brand: string
  model: string
  year: string
  color: string
  fuel: string
  chassis: string
  engineNo: string
  engineVolume: string
  km: string
}

export async function updateVehicleApi(id: string, data: VehicleInfoPayload): Promise<void> {
  await api<void>(`/api/vehicles/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      plate: data.plate.trim().toUpperCase(),
      brand: data.brand.trim(),
      model: data.model.trim(),
      modelYear: data.year ? parseInt(data.year, 10) || null : null,
      color: data.color.trim() || null,
      fuel: mapFuel(data.fuel),
      chassisNo: data.chassis ? data.chassis.trim().toUpperCase() : null,
      engineNo: data.engineNo.trim() || null,
      engineVolume: data.engineVolume.trim() || null,
      mileage: data.km ? parseInt(data.km.replace(/\D/g, ''), 10) || null : null,
    }),
  })
}

export async function refreshVehicle(workOrderId: string): Promise<Vehicle> {
  const wo = await api<WoDetail>(`/api/workorders/${workOrderId}`)
  return mapWorkOrder(wo)
}

export type ActivityLogEntry = {
  id: number
  action: string
  entityType: string
  description: string
  userName?: string | null
  createdAt: string
}

export async function getCustomerActivity(customerId: string): Promise<ActivityLogEntry[]> {
  const rows = await api<{
    id: number
    action: string
    entityType: string
    description: string
    userName?: string | null
    createdAt: string
  }[]>(`/api/customers/${encodeURIComponent(customerId)}/activity`)
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    description: r.description,
    userName: r.userName,
    createdAt: r.createdAt,
  }))
}

export type VehicleHistoryService = { id: string; title: string; price: number }
export type VehicleHistoryPart = {
  id: string
  name: string
  quantity: number
  unitPrice: number
}
export type VehicleVisitHistory = {
  workOrderId: string
  orderNo: number
  status: JobStatus
  openedAt: string
  visitNumber: number
  services: VehicleHistoryService[]
  parts: VehicleHistoryPart[]
}
export type VehicleServiceHistory = {
  vehicleId: string
  plate: string
  brand: string
  model: string
  visits: VehicleVisitHistory[]
}

export async function getVehicleServiceHistory(
  vehicleId: string,
): Promise<VehicleServiceHistory> {
  const d = await api<{
    vehicleId: string
    plate: string
    brand: string
    model: string
    visits: {
      workOrderId: string
      orderNo: number
      status: string
      openedAt: string
      visitNumber: number
      services: { id: string; title: string; price: number }[]
      parts: { id: string; name: string; quantity: number; unitPrice: number }[]
    }[]
  }>(`/api/vehicles/${encodeURIComponent(vehicleId)}/service-history`)
  return {
    vehicleId: d.vehicleId,
    plate: d.plate,
    brand: d.brand,
    model: d.model,
    visits: (d.visits ?? []).map((v) => ({
      workOrderId: v.workOrderId,
      orderNo: Number(v.orderNo),
      status: mapStatus(v.status),
      openedAt: v.openedAt,
      visitNumber: Number(v.visitNumber) || 1,
      services: (v.services ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        price: Number(s.price),
      })),
      parts: (v.parts ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        quantity: Number(p.quantity),
        unitPrice: Number(p.unitPrice),
      })),
    })),
  }
}

export async function loadVehiclesByCustomer(customerId: string): Promise<CustomerVehicleSummary[]> {
  const rows = await api<{
    id: string
    plate: string
    brand: string
    model: string
    status?: string
  }[]>(`/api/vehicles?customerId=${encodeURIComponent(customerId)}`)
  return rows.map((v) => ({
    id: v.id,
    plate: v.plate,
    brand: v.brand,
    model: v.model,
    status: mapStatus(v.status ?? 'bekliyor'),
  }))
}

export async function transferVehicleApi(
  vehicleId: string,
  newCustomerId: string,
  complaint?: string,
  complaintCategory?: ComplaintCategory,
): Promise<Vehicle> {
  const res = await api<{ vehicleId: string; workOrderId: string }>(
    `/api/vehicles/${vehicleId}/transfer`,
    {
      method: 'POST',
      body: JSON.stringify({
        newCustomerId,
        complaint: complaint || null,
        complaintCategory: complaint ? complaintCategory || 'diger' : null,
      }),
    },
  )
  return refreshVehicle(res.workOrderId)
}

export async function setWorkOrderStatus(
  workOrderId: string,
  status: JobStatus,
  assignment?: { assignedUserId?: string; assignedUserName?: string },
) {
  await api(`/api/workorders/${workOrderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      assignedUserId: assignment?.assignedUserId ?? null,
      assignedUserName: assignment?.assignedUserName ?? null,
    }),
  })
}

/** Yalnızca bekliyor (işleme alınmamış) iş emrini sistemden siler. */
export async function deleteWaitingWorkOrder(workOrderId: string) {
  await api(`/api/workorders/${workOrderId}`, { method: 'DELETE' })
}

export type ShopPaymentInfo = {
  shopName: string
  bankIban?: string | null
  bankName?: string | null
  accountHolder?: string | null
}

export type WorkOrderPaymentResult = {
  grandTotal: number
  paidTotal: number
  discount?: number
  paymentId?: string | null
}

export type WorkOrderPayment = {
  id: string
  amount: number
  method: string
  paidAt: string
  receivedByName?: string | null
}

export async function getShopPaymentInfo(): Promise<ShopPaymentInfo> {
  return api<ShopPaymentInfo>('/api/shop/payment-info')
}

export async function updateShopPaymentInfo(data: {
  bankIban?: string | null
  bankName?: string | null
  accountHolder?: string | null
}): Promise<ShopPaymentInfo> {
  return api<ShopPaymentInfo>('/api/shop/payment-info', {
    method: 'PUT',
    body: JSON.stringify({
      bankIban: data.bankIban ?? null,
      bankName: data.bankName ?? null,
      accountHolder: data.accountHolder ?? null,
    }),
  })
}

export async function listWorkOrderPayments(
  workOrderId: string,
): Promise<WorkOrderPayment[]> {
  const rows = await api<WorkOrderPayment[]>(`/api/workorders/${workOrderId}/payments`)
  return rows.map((p) => ({
    ...p,
    amount: Number(p.amount),
  }))
}

export async function addWorkOrderPayment(
  workOrderId: string,
  amount: number,
  method: 'nakit' | 'kart' | 'havale' | 'diger' = 'nakit',
): Promise<WorkOrderPaymentResult> {
  const res = await api<WorkOrderPaymentResult>(`/api/workorders/${workOrderId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ amount, method }),
  })
  return {
    grandTotal: Number(res.grandTotal),
    paidTotal: Number(res.paidTotal),
    discount: res.discount != null ? Number(res.discount) : undefined,
    paymentId: res.paymentId ?? null,
  }
}

export async function updateWorkOrderPayment(
  workOrderId: string,
  paymentId: string,
  amount: number,
  method: 'nakit' | 'kart' | 'havale' | 'diger' = 'nakit',
): Promise<WorkOrderPaymentResult> {
  return api<WorkOrderPaymentResult>(
    `/api/workorders/${workOrderId}/payments/${paymentId}`,
    {
      method: 'POST',
      body: JSON.stringify({ amount, method }),
    },
  )
}

export async function deleteWorkOrderPayment(
  workOrderId: string,
  paymentId: string,
): Promise<WorkOrderPaymentResult> {
  return api<WorkOrderPaymentResult>(
    `/api/workorders/${workOrderId}/payments/${paymentId}/delete`,
    { method: 'POST' },
  )
}

export async function updateWorkOrderDiscount(
  workOrderId: string,
  amount: number,
): Promise<WorkOrderPaymentResult> {
  return api<WorkOrderPaymentResult>(`/api/workorders/${workOrderId}/discount`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

export async function getStaffList(): Promise<StaffMember[]> {
  return api<StaffMember[]>('/api/staff')
}

export async function addComplaintApi(
  workOrderId: string,
  text: string,
  category: ComplaintCategory = 'diger',
): Promise<string> {
  const res = await api<{ id: string }>(`/api/workorders/${workOrderId}/complaints`, {
    method: 'POST',
    body: JSON.stringify({ description: text, category }),
  })
  return res.id
}

export async function addServiceApi(
  workOrderId: string,
  service: Omit<ServiceItem, 'id'>,
  force = false,
): Promise<string> {
  const res = await api<{ id: string }>(`/api/workorders/${workOrderId}/services`, {
    method: 'POST',
    body: JSON.stringify({ title: service.title, price: service.price, force }),
  })
  return res.id
}

export async function updateServiceApi(
  workOrderId: string,
  serviceId: string,
  data: Omit<ServiceItem, 'id'>,
) {
  await api(`/api/workorders/${workOrderId}/services/${serviceId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: data.title, price: data.price }),
  })
}

export async function deleteServiceApi(workOrderId: string, serviceId: string) {
  await api(`/api/workorders/${workOrderId}/services/${serviceId}`, { method: 'DELETE' })
}

export async function addPartApi(
  workOrderId: string,
  product: Omit<ProductItem, 'id'>,
  force = false,
) {
  await api(`/api/workorders/${workOrderId}/parts`, {
    method: 'POST',
    body: JSON.stringify({
      stockProductId: product.stockProductId ?? null,
      name: product.name,
      quantity: product.quantity,
      unitPrice: product.price,
      source: product.source,
      supplierId: product.supplierId ?? null,
      purchasePrice: product.purchasePrice ?? null,
      force,
      supplierCode: product.supplierCode ?? null,
      matchedStockProductId: product.matchedStockProductId ?? null,
      manufacturerCode: product.manufacturerCode ?? null,
      brand: product.brand ?? null,
    }),
  })
}

export async function updatePartApi(
  workOrderId: string,
  partId: string,
  data: Omit<ProductItem, 'id'>,
) {
  await api(`/api/workorders/${workOrderId}/parts/${partId}`, {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      quantity: data.quantity,
      unitPrice: data.price,
      purchasePrice: data.purchasePrice ?? null,
      source: data.source,
      supplierId: data.supplierId ?? null,
      stockProductId: data.stockProductId ?? null,
      supplierCode: data.supplierCode ?? null,
      manufacturerCode: data.manufacturerCode ?? null,
      matchedStockProductId: data.matchedStockProductId ?? null,
    }),
  })
}

export async function deletePartApi(workOrderId: string, partId: string) {
  await api(`/api/workorders/${workOrderId}/parts/${partId}/delete`, { method: 'POST' })
}

export async function returnPartToSupplier(workOrderId: string, partId: string) {
  await api(`/api/workorders/${workOrderId}/parts/${partId}/return-to-supplier`, { method: 'POST' })
}

export async function updateComplaintApi(
  workOrderId: string,
  complaintId: string,
  text: string,
  category: ComplaintCategory = 'diger',
) {
  await api(`/api/workorders/${workOrderId}/complaints/${complaintId}`, {
    method: 'PUT',
    body: JSON.stringify({ description: text, category }),
  })
}

export async function deleteComplaintApi(workOrderId: string, complaintId: string) {
  await api(`/api/workorders/${workOrderId}/complaints/${complaintId}`, { method: 'DELETE' })
}

export type StatusHistoryEntry = {
  id: string
  oldStatus?: string | null
  newStatus: string
  changedAt: string
  changedByName?: string | null
}

export async function getWorkOrderHistory(workOrderId: string): Promise<StatusHistoryEntry[]> {
  return api<StatusHistoryEntry[]>(`/api/workorders/${workOrderId}/history`)
}

export async function openNewVisit(
  vehicleId: string,
  complaint?: string,
  complaintCategory?: ComplaintCategory,
  /** YYYY-MM-DD (TR takvim günü). Boşsa bugün. */
  openedAt?: string,
): Promise<Vehicle> {
  const res = await api<{ vehicleId: string; workOrderId: string }>(
    `/api/vehicles/${vehicleId}/new-visit`,
    {
      method: 'POST',
      body: JSON.stringify({
        complaint: complaint || null,
        complaintCategory: complaint ? complaintCategory || 'diger' : null,
        openedAt: openedAt || null,
      }),
    },
  )
  return refreshVehicle(res.workOrderId)
}

export type StockProductLite = {
  id: string
  name: string
  price: number
  quantity: number
  code?: string
  purchasePrice?: number
}

export async function listStockProducts(search?: string): Promise<StockProductLite[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : ''
  const rows = await api<{
    id: string
    name: string
    price: number
    quantity: number
    code?: string | null
    purchasePrice?: number | null
  }[]>(`/api/stock${q}`)
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    price: Number(s.price),
    quantity: s.quantity,
    code: s.code ?? undefined,
    purchasePrice: s.purchasePrice != null ? Number(s.purchasePrice) : undefined,
  }))
}

export type WorkOrderImage = {
  id: string
  imageType: string
  url: string
  createdAt: string
  complaintId?: string
  serviceId?: string
}

export async function getWorkOrderImages(workOrderId: string): Promise<WorkOrderImage[]> {
  return api<WorkOrderImage[]>(`/api/workorders/${workOrderId}/images`)
}

export async function deleteWorkOrderImage(workOrderId: string, imageId: string): Promise<void> {
  await api(`/api/workorders/${workOrderId}/images/${imageId}`, { method: 'DELETE' })
}

export type RuhsatScanResult = {
  plate: string
  brand: string
  model: string
  year: string
  color: string
  fuel: string
  chassis: string
  engineNo: string
  engineVolume: string
  provider?: string
  modelUsed?: string
}

/** Ruhsat okuma — sunucu tarafı AI failover (Gemini → OpenAI). */
export async function scanRuhsatApi(
  imageBase64: string,
  mimeType = 'image/jpeg',
): Promise<RuhsatScanResult> {
  const raw = await api<RuhsatScanResult>('/api/ai/scan-ruhsat', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType }),
  })
  return {
    plate: (raw.plate ?? '').trim(),
    brand: (raw.brand ?? '').trim(),
    model: (raw.model ?? '').trim(),
    year: (raw.year ?? '').trim(),
    color: (raw.color ?? '').trim(),
    fuel: (raw.fuel ?? '').trim(),
    chassis: (raw.chassis ?? '').trim(),
    engineNo: (raw.engineNo ?? '').trim(),
    engineVolume: (raw.engineVolume ?? '').trim(),
    provider: raw.provider,
    modelUsed: raw.modelUsed,
  }
}

export async function uploadWorkOrderImage(
  workOrderId: string,
  imageUri: string,
  imageType: 'ruhsat' | 'arac' | 'hasar' | 'diger',
  complaintId?: string,
  serviceId?: string,
): Promise<WorkOrderImage> {
  // RN/Expo yeni fetch FormData'da { uri, name, type } nesnesini kabul etmiyor
  // ("Unsupported FormDataPart implementation"). expo-file-system File + expo/fetch kullan.
  // Tarayıcıda ise seçilen dosya blob adresidir; standart fetch ile yüklenir.
  const form = new FormData()
  if (Platform.OS === 'web') {
    const blob = await fetch(imageUri).then((r) => r.blob())
    const ext = blob.type.includes('png') ? 'png' : 'jpg'
    form.append('file', blob, `photo.${ext}`)
  } else {
    const file = new File(imageUri)
    form.append('file', file as unknown as Blob)
  }
  form.append('imageType', imageType)
  if (complaintId) form.append('complaintId', complaintId)
  if (serviceId) form.append('serviceId', serviceId)

  const headers: Record<string, string> = {}
  const t = await loadToken()
  if (t) headers.Authorization = `Bearer ${t}`

  const post = Platform.OS === 'web' ? fetch : expoFetch
  const res = await post(`${API_BASE_URL}/api/workorders/${workOrderId}/images`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) {
    let body: any = null
    try {
      body = await res.json()
    } catch {
      /* ignore */
    }
    throw new Error(body?.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function absoluteImageUrl(url: string): string {
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

export async function ensureCustomer(data: Omit<Customer, 'id'>): Promise<Customer> {
  return createCustomer(data)
}

export type SupplierTransaction = {
  id: string
  type: 'alis' | 'odeme' | 'iade' | 'iskonto'
  amount: number
  description?: string
  createdAt: string
  method?: string | null
  workOrderPartId?: string | null
  partName?: string | null
  partQuantity?: number | null
  purchasePrice?: number | null
  plate?: string | null
  brand?: string | null
  model?: string | null
  workOrderId?: string | null
  vehicleId?: string | null
}

export type SupplierLedger = {
  supplier: Supplier
  transactions: SupplierTransaction[]
}

export type SupplierReportRow = {
  supplierId: string
  supplierName: string
  totalPurchases: number
  totalReturns: number
  transactionCount: number
}

function mapSupplier(s: {
  id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  taxNo?: string
  balance: number
}): Supplier {
  return {
    id: s.id,
    name: s.name,
    contact: s.contact,
    phone: s.phone,
    email: s.email,
    address: s.address,
    taxNo: s.taxNo,
    balance: Number(s.balance),
  }
}

export async function listSuppliers(search?: string): Promise<Supplier[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : ''
  const rows = await api<Parameters<typeof mapSupplier>[0][]>(`/api/suppliers${q}`)
  return rows.map(mapSupplier)
}

export async function createSupplier(data: {
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  taxNo?: string
  openingBalance?: number
}): Promise<Supplier> {
  const s = await api<Parameters<typeof mapSupplier>[0]>('/api/suppliers', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      contact: data.contact || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      taxNo: data.taxNo || null,
      openingBalance: data.openingBalance ?? 0,
    }),
  })
  return mapSupplier(s)
}

/**
 * SQL prosedürü yanlış encoding ile kurulunca oluşan UTF-8 mojibake'i düzeltir.
 * Örn: "Ä°ÅŸ emri…" → "İş emri…"
 * Not: sqlcmd CP1252 ile yazınca 0x9F baytı U+0178 (Ÿ) olur; sadece &0xff yetmez.
 */
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
}

function fixMojibake(text?: string | null): string | undefined {
  if (!text) return text ?? undefined
  if (!/[ÄÃÅ]/.test(text)) return text
  try {
    const bytes = Uint8Array.from(Array.from(text, (ch) => {
      const c = ch.charCodeAt(0)
      if (c <= 0xff) return c
      return CP1252_TO_BYTE[c] ?? (c & 0xff)
    }))
    const decoded = new TextDecoder('utf-8').decode(bytes)
    if (!decoded || decoded.includes('\uFFFD')) return text
    return decoded
  } catch {
    return text
  }
}

export async function getSupplierLedger(id: string): Promise<SupplierLedger> {
  const res = await api<{
    supplier: Parameters<typeof mapSupplier>[0]
    transactions: SupplierTransaction[]
  }>(`/api/suppliers/${id}`)
  return mapSupplierLedger(res)
}

function mapSupplierLedger(res: {
  supplier: Parameters<typeof mapSupplier>[0]
  transactions: SupplierTransaction[]
}): SupplierLedger {
  return {
    supplier: mapSupplier(res.supplier),
    transactions: res.transactions.map((t) => ({
      ...t,
      amount: Number(t.amount),
      description: fixMojibake(t.description),
      partName: t.partName ? fixMojibake(t.partName) : t.partName,
      purchasePrice:
        t.purchasePrice != null && t.purchasePrice !== undefined
          ? Number(t.purchasePrice)
          : t.purchasePrice,
      partQuantity:
        t.partQuantity != null && t.partQuantity !== undefined
          ? Number(t.partQuantity)
          : t.partQuantity,
    })),
  }
}

export async function recordSupplierPayment(
  id: string,
  amount: number,
  description?: string,
  method?: string,
): Promise<SupplierLedger> {
  const res = await api<{
    supplier: Parameters<typeof mapSupplier>[0]
    transactions: SupplierTransaction[]
  }>(`/api/suppliers/${id}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount,
      description: description || null,
      method: method || null,
    }),
  })
  return mapSupplierLedger(res)
}

export async function recordSupplierDiscount(
  id: string,
  amount: number,
  description?: string,
): Promise<SupplierLedger> {
  const res = await api<{
    supplier: Parameters<typeof mapSupplier>[0]
    transactions: SupplierTransaction[]
  }>(`/api/suppliers/${id}/discounts`, {
    method: 'POST',
    body: JSON.stringify({ amount, description: description || null }),
  })
  return mapSupplierLedger(res)
}

export async function updateSupplierTransaction(
  supplierId: string,
  txId: string,
  data: { amount: number; description?: string; method?: string },
): Promise<SupplierLedger> {
  const res = await api<{
    supplier: Parameters<typeof mapSupplier>[0]
    transactions: SupplierTransaction[]
  }>(`/api/suppliers/${supplierId}/transactions/${txId}`, {
    method: 'PUT',
    body: JSON.stringify({
      amount: data.amount,
      description: data.description || null,
      method: data.method || null,
    }),
  })
  return mapSupplierLedger(res)
}

export async function deleteSupplierTransaction(
  supplierId: string,
  txId: string,
): Promise<SupplierLedger> {
  const res = await api<{
    supplier: Parameters<typeof mapSupplier>[0]
    transactions: SupplierTransaction[]
  }>(`/api/suppliers/${supplierId}/transactions/${txId}`, { method: 'DELETE' })
  return mapSupplierLedger(res)
}

export async function getSupplierReport(
  from: string,
  to: string,
): Promise<SupplierReportRow[]> {
  const q = new URLSearchParams({ from, to })
  const rows = await api<{
    supplierId: string
    supplierName: string
    totalPurchases: number
    totalReturns: number
    transactionCount: number
  }[]>(`/api/suppliers/report?${q}`)
  return rows.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    totalPurchases: Number(r.totalPurchases),
    totalReturns: Number(r.totalReturns),
    transactionCount: r.transactionCount,
  }))
}

/* ---------------------------------------------------------------------
   Stok / cari / satış raporları
   ------------------------------------------------------------------- */

export type StockUsageRow = {
  stockProductId?: string | null
  name: string
  category?: string | null
  totalQuantity: number
  totalRevenue: number
  workOrderCount: number
}

export type StockPurchaseSaleRow = {
  stockProductId?: string | null
  name: string
  category?: string | null
  totalQuantity: number
  totalPurchaseAmount: number
  totalSaleAmount: number
  profit: number
}

export type StockPurchaseSaleVehicleRow = {
  vehicleId: string
  plate: string
  customerName?: string | null
  brand?: string | null
  model?: string | null
  totalQuantity: number
  totalPurchaseAmount: number
  totalSaleAmount: number
  profit: number
}

export type StockPurchaseSaleSupplierRow = {
  supplierId?: string | null
  supplierName: string
  source: 'stok' | 'disaridan' | string
  totalQuantity: number
  totalPurchaseAmount: number
  totalSaleAmount: number
  profit: number
}

export type StockPurchaseSaleGroupBy = 'product' | 'vehicle' | 'supplier'

export type StockMovementDetail = {
  date: string
  plate: string
  customerName: string
  quantity: number
  unitPrice: number
  purchasePrice?: number | null
  supplierName?: string | null
  partName?: string | null
}

export type AccountLedgerRow = {
  accountId: string
  accountName: string
  accountType: 'musteri' | 'tedarikci'
  totalDebit: number
  totalCredit: number
  movementCount: number
  currentBalance: number
}

export type CustomerLedgerEntry = {
  date: string
  type: 'borc' | 'tahsilat'
  description: string
  amount: number
  plate?: string | null
}

export type TopServiceRow = { title: string; count: number; totalAmount: number }
export type TopPartRow = { name: string; quantity: number; totalAmount: number }

export type SalesReport = {
  workOrderCount: number
  totalRevenue: number
  totalPaid: number
  totalDiscount: number
  /** Dönemde açılan iş emirlerinin hâlâ ödenmemiş bakiyesi. */
  totalOutstanding: number
  nakit: number
  kart: number
  havale: number
  diger: number
  topServices: TopServiceRow[]
  /** Adet sırasıyla en çok yapılan işçilikler. */
  topJobs: TopServiceRow[]
  /** Adet sırasıyla en çok satılan yedek parçalar. */
  topParts: TopPartRow[]
}

export async function getStockUsageReport(from: string, to: string): Promise<StockUsageRow[]> {
  const q = new URLSearchParams({ from, to })
  return api<StockUsageRow[]>(`/api/reports/stock-usage?${q}`)
}

export async function getStockPurchaseSaleReport(
  from: string,
  to: string,
  groupBy: StockPurchaseSaleGroupBy = 'product',
): Promise<StockPurchaseSaleRow[] | StockPurchaseSaleVehicleRow[] | StockPurchaseSaleSupplierRow[]> {
  const q = new URLSearchParams({ from, to, groupBy })
  return api(`/api/reports/stock-purchase-sale?${q}`)
}

export async function getStockMovementDetail(
  stockProductId: string | null | undefined,
  name: string | null | undefined,
  from: string,
  to: string,
  opts?: {
    vehicleId?: string | null
    supplierId?: string | null
    source?: string | null
  },
): Promise<StockMovementDetail[]> {
  const q = new URLSearchParams({ from, to })
  if (name) q.set('name', name)
  if (stockProductId) q.set('stockProductId', stockProductId)
  if (opts?.vehicleId) q.set('vehicleId', opts.vehicleId)
  if (opts?.supplierId) q.set('supplierId', opts.supplierId)
  if (opts?.source) q.set('source', opts.source)
  return api<StockMovementDetail[]>(`/api/reports/stock-movements?${q}`)
}

export async function getAccountLedgerReport(from: string, to: string): Promise<AccountLedgerRow[]> {
  const q = new URLSearchParams({ from, to })
  return api<AccountLedgerRow[]>(`/api/reports/account-ledger?${q}`)
}

export async function getCustomerLedgerDetail(
  customerId: string,
  from: string,
  to: string,
): Promise<CustomerLedgerEntry[]> {
  const q = new URLSearchParams({ customerId, from, to })
  return api<CustomerLedgerEntry[]>(`/api/reports/customer-ledger?${q}`)
}

export async function getSalesReport(from: string, to: string): Promise<SalesReport> {
  const q = new URLSearchParams({ from, to })
  const d = await api<SalesReport & {
    topJobs?: TopServiceRow[]
    topParts?: TopPartRow[]
  }>(`/api/reports/sales?${q}`)
  return {
    ...d,
    topServices: d.topServices ?? [],
    topJobs: (d.topJobs ?? []).map((j) => ({
      title: j.title,
      count: Number(j.count),
      totalAmount: Number(j.totalAmount),
    })),
    topParts: (d.topParts ?? []).map((p) => ({
      name: p.name,
      quantity: Number(p.quantity),
      totalAmount: Number(p.totalAmount),
    })),
  }
}
