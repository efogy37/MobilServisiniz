import { useEffect, useMemo, useState } from 'react'

import { ActivityIndicator, Alert, BackHandler, View } from 'react-native'

import { LogOut } from 'lucide-react-native'

import { AppShell, HeaderLogoutButton, type MainTabKey } from '@/components/app-shell'

import { AppSheet, SheetActionList, SheetCancelButton } from '@/components/app-modal'

import { colors } from '@/lib/theme'

import type {

  Complaint,

  Customer,

  ProductItem,

  ServiceItem,

  StockProduct,

  Supplier,

  Vehicle,

} from '@/lib/types'

import {

  initSession,

  clearSession,

  setSessionInvalidatedHandler,

  setLicenseExpiredHandler,

  getCachedLicense,

  getCachedEntitlements,

  fetchShopLicense,

  fetchEntitlements,

  type PlanEntitlements,

  SessionReplacedError,

  type ShopLicense,

  loadCustomers,

  loadStock,

  loadVehicles,

  loadServiceCatalog,

  loginUser,

  getStoredShopName,

  getStoredTenantCode,

  createCustomer,

  uploadWorkOrderImage,

  updateCustomerApi,

  createStock,

  updateStockApi,

  deleteStockApi,

  createVehicleApi,

  updateVehicleApi,

  transferVehicleApi,

  PlateConflictError,

  PhoneConflictError,

  refreshVehicle,

  setWorkOrderStatus,
  deleteWaitingWorkOrder,

  addWorkOrderPayment,
  updateWorkOrderPayment,
  deleteWorkOrderPayment,
  updateWorkOrderDiscount,

  addComplaintApi,

  addServiceApi,

  updateServiceApi,

  deleteServiceApi,

  addPartApi,

  updatePartApi,

  deletePartApi,

  ensureCustomer,

  getCurrentUser,

  getStaffList,

  listSuppliers,

  returnPartToSupplier,

  updateComplaintApi,

  deleteComplaintApi,

  openNewVisit,

  type AuthResult,

  type ServiceCatalogItem,

  type CurrentUser,

  type StaffMember,

} from '@/lib/api'

import {

  SERVICE_CATEGORY_LABELS,

  type ServiceCatalogCategory,

  type ServiceCatalogItem as UiCatalogItem,

} from '@/lib/service-catalog'

import { Login } from '@/screens/login'

import { Dashboard } from '@/screens/dashboard'

import { VehicleList, type VehicleListFilter } from '@/screens/vehicle-list'

import { VehicleDetail } from '@/screens/vehicle-detail'

import { NewVehicleFlow } from '@/screens/new-vehicle-flow'

import { Customers } from '@/screens/customers'

import { CustomerDetail } from '@/screens/customer-detail'

import { Products } from '@/screens/products'

import { SupplierImport } from '@/screens/supplier-import'

import { SupplierReport } from '@/screens/supplier-report'

import { StockReports } from '@/screens/stock-reports'



type View_ =
  | 'dashboard'
  | 'vehicles'
  | 'detail'
  | 'new'
  | 'customers'
  | 'products'
  | 'customerDetail'
  | 'supplierReport'
  | 'supplierImport'
  | 'stockReports'

function reportError(e: unknown) {

  console.warn('MobilServisiniz API hatası:', e)

  if (e instanceof SessionReplacedError) {

    Alert.alert('Oturum sonlandı', e.message)

    return

  }

  if (e instanceof PhoneConflictError) {

    Alert.alert('Uyarı', 'Bu telefon numarasıyla kayıtlı bir müşteri zaten var.')

    return

  }

  const msg = e instanceof Error ? e.message : 'İşlem başarısız.'

  Alert.alert('Hata', msg)

}



function toUiCatalog(items: ServiceCatalogItem[]): UiCatalogItem[] {

  return items.map((s) => ({

    name: s.name,

    price: s.defaultPrice,

    category: s.category as ServiceCatalogCategory,

  }))

}



export function ServiceApp() {

  const [ready, setReady] = useState(false)

  const [user, setUser] = useState<string | null>(null)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  const [customers, setCustomers] = useState<Customer[]>([])

  const [stock, setStock] = useState<StockProduct[]>([])

  const [catalog, setCatalog] = useState<UiCatalogItem[]>([])

  const [view, setView] = useState<View_>('dashboard')
  const [detailReturnView, setDetailReturnView] = useState<View_>('vehicles')

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [shopLabel, setShopLabel] = useState<string | null>(null)
  const [shopLicense, setShopLicense] = useState<ShopLicense | null>(null)

  const [entitlements, setEntitlements] = useState<PlanEntitlements | null>(null)

  const [staff, setStaff] = useState<StaffMember[]>([])

  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [vehicleListFilter, setVehicleListFilter] = useState<VehicleListFilter>('all')
  const canSeeReports = currentUser?.role === 'admin' || currentUser?.role === 'usta'

  const [logoutOpen, setLogoutOpen] = useState(false)



  async function reloadAll() {
    const canStock = getCachedEntitlements()?.features.stock ?? entitlements?.features.stock ?? true
    const canSuppliers =
      getCachedEntitlements()?.features.suppliers ?? entitlements?.features.suppliers ?? true

    const [v, c, s, cat, st, sup] = await Promise.all([

      loadVehicles(),

      loadCustomers(),

      canStock ? loadStock() : Promise.resolve([] as StockProduct[]),

      loadServiceCatalog(),

      getStaffList(),

      canSuppliers ? listSuppliers() : Promise.resolve([] as Supplier[]),

    ])

    setVehicles(v)

    setCustomers(c)

    setStock(s)

    setCatalog(toUiCatalog(cat))

    setStaff(st)

    setSuppliers(sup)

  }



  function reloadSuppliers() {
    // Tedarikçi bakiyesini etkileyen işlemlerden sonra hem `suppliers`
    // (parça ekranındaki tedarikçi seçici için) hem de `customers`
    // (Müşteriler ekranındaki birleşik cari bakiyesi için) yenilenir.
    const canSuppliers =
      getCachedEntitlements()?.features.suppliers ?? entitlements?.features.suppliers ?? true
    Promise.all([
      canSuppliers ? listSuppliers() : Promise.resolve([] as Supplier[]),
      loadCustomers(),
    ])
      .then(([sup, cust]) => {
        setSuppliers(sup)
        setCustomers(cust)
      })
      .catch(reportError)
  }



  useEffect(() => {

    let active = true

    const resetLocal = () => {
      if (!active) return
      setUser(null)
      setCurrentUser(null)
      setShopLabel(null)
      setShopLicense(null)
      setEntitlements(null)
      setVehicles([])
      setCustomers([])
      setStock([])
      setStaff([])
      setSuppliers([])
      setCatalog([])
      setView('dashboard')
      setSelectedId(null)
      setSelectedCustomerId(null)
    }

    setSessionInvalidatedHandler(resetLocal)
    setLicenseExpiredHandler(resetLocal)

    ;(async () => {

      try {

        // Uygulama guncellemeleri artik Google Play uzerinden yonetiliyor;
        // uygulama ici APK indirme/kurma akisi kaldirildi (REQUEST_INSTALL_PACKAGES izni kullanilmiyor).

        const saved = await initSession()

        if (!active) return

        if (saved) {

          setUser(saved)

          setCurrentUser(await getCurrentUser())
          {
            const [name, code] = await Promise.all([getStoredShopName(), getStoredTenantCode()])
            setShopLabel([name, code].filter(Boolean).join(' · ') || null)
          }
          setShopLicense(getCachedLicense())
          setEntitlements(getCachedEntitlements())
          if (!getCachedEntitlements()) {
            setEntitlements(await fetchEntitlements())
          }

          await reloadAll()

        }

      } catch (e) {

        reportError(e)

      } finally {

        if (active) setReady(true)

      }

    })()

    return () => {

      active = false
      setSessionInvalidatedHandler(null)
      setLicenseExpiredHandler(null)

    }

  }, [])

  useEffect(() => {
    if (canSeeReports) return
    if (view === 'stockReports') setView('products')
    if (view === 'supplierReport') setView('customers')
  }, [canSeeReports, view])

  // Android donanım geri tuşu: uygulamadan çıkmak yerine, o ekrandaki
  // "geri" butonuyla aynı hedefe döner (üst seviye görünüm geçmişi yoktur,
  // bu yüzden her iç görünüm ana/liste görünümüne döner).
  useEffect(() => {

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {

      if (view === 'detail') {

        setView(detailReturnView === 'customerDetail' || detailReturnView === 'dashboard'
          ? detailReturnView
          : 'vehicles')

        return true

      }

      if (view === 'customerDetail') {

        setView('customers')

        return true

      }

      if (view === 'supplierReport') {

        setView('customers')

        return true

      }

      if (view === 'supplierImport') {

        setView('products')

        return true

      }

      if (view === 'new') {

        setView('dashboard')

        return true

      }

      return false

    })

    return () => sub.remove()

  }, [view, detailReturnView])



  const selected = useMemo(

    () => vehicles.find((v) => v.id === selectedId) ?? null,

    [vehicles, selectedId],

  )



  const selectedCustomer = useMemo(

    () => customers.find((c) => c.id === selectedCustomerId) ?? null,

    [customers, selectedCustomerId],

  )



  async function handleLogin(identifier: string, password: string): Promise<AuthResult> {

    const res = await loginUser(identifier, password)

    if (res.ok) {

      setUser(res.name)

      setCurrentUser(await getCurrentUser())
      {
        const [name, code] = await Promise.all([getStoredShopName(), getStoredTenantCode()])
        setShopLabel([name, code].filter(Boolean).join(' · ') || null)
      }
      setShopLicense(res.license ?? getCachedLicense())
      setEntitlements(getCachedEntitlements())

      try {
        if (!getCachedEntitlements()) {
          setEntitlements(await fetchEntitlements())
        }
        await reloadAll()
        const lic = await fetchShopLicense()
        if (lic) setShopLicense(lic)
      } catch (e) {
        reportError(e)
      }

    }

    return res

  }



  async function openVehicle(id: string) {
    setDetailReturnView(
      view === 'customerDetail' ? 'customerDetail' : view === 'dashboard' ? 'dashboard' : 'vehicles',
    )
    const v = vehicles.find((x) => x.id === id)
    setSelectedId(id)
    setView('detail')
    // Liste özet gelir; detay (işçilik/parça) iş emri yenilemesiyle dolar
    if (!v?.workOrderId) return
    try {
      const fresh = await refreshVehicle(v.workOrderId)
      await replaceVehicle(fresh)
      setSelectedId(fresh.id || id)
    } catch (e) {
      reportError(e)
    }
  }



  function openVehicleList(filter: VehicleListFilter) {

    setVehicleListFilter(filter)

    setView('vehicles')

  }



  function openCustomer(customer: Customer) {

    setSelectedCustomerId(customer.id)

    setView('customerDetail')

  }



  async function replaceVehicle(updated: Vehicle) {

    setVehicles((prev) => {
      const idx = prev.findIndex((v) => v.id === updated.id)
      if (idx < 0) return [updated, ...prev]
      const next = [...prev]
      next[idx] = updated
      return next
    })

  }

  async function openPendingWorkOrder(workOrderId: string, vehicleId: string) {
    setDetailReturnView(
      view === 'customerDetail' ? 'customerDetail' : view === 'dashboard' ? 'dashboard' : 'vehicles',
    )
    setBusy(true)
    try {
      const fresh = await refreshVehicle(workOrderId)
      await replaceVehicle(fresh)
      setSelectedId(fresh.id || vehicleId)
      setView('detail')
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }



  async function withWo<T>(vehicleId: string, fn: (woId: string) => Promise<T>, reloadStock = false): Promise<T> {

    const v = vehicles.find((x) => x.id === vehicleId)

    if (!v?.workOrderId) throw new Error('İş emri bulunamadı.')

    setBusy(true)

    try {

      const result = await fn(v.workOrderId)

      const fresh = await refreshVehicle(v.workOrderId)

      await replaceVehicle(fresh)

      if (reloadStock) {

        const s = await loadStock()

        setStock(s)

      }

      return result

    } finally {

      setBusy(false)

    }

  }



  async function addVehicle(vehicle: Vehicle, opts?: { ruhsatUri?: string }) {

    setBusy(true)

    let resolvedCustomerId = vehicle.customer.id

    try {

      if (!customers.some((c) => c.id === resolvedCustomerId)) {

        const created = await ensureCustomer({

          name: vehicle.customer.name,

          phone: vehicle.customer.phone,

          address: vehicle.customer.address,

        })

        resolvedCustomerId = created.id

        setCustomers((prev) => [created, ...prev])

      }



      const openedAt =
        /^\d{4}-\d{2}-\d{2}$/.test(vehicle.createdAt) ? vehicle.createdAt : undefined

      const created = await createVehicleApi(

        resolvedCustomerId,

        vehicle.plate,

        vehicle.brand,

        vehicle.model,

        vehicle.year,

        vehicle.color,

        vehicle.fuel,

        vehicle.chassis,

        vehicle.engineNo,

        vehicle.engineVolume,

        vehicle.km,

        vehicle.complaints[0]?.text,

        vehicle.complaints[0]?.category,

        openedAt,

      )

      if (opts?.ruhsatUri && created.workOrderId) {
        try {
          await uploadWorkOrderImage(created.workOrderId, opts.ruhsatUri, 'ruhsat')
        } catch (uploadErr) {
          reportError(uploadErr)
        }
      }

      setVehicles((prev) => [created, ...prev])

      setSelectedId(created.id)

      setView('detail')

    } catch (e) {

      // Plaka çakışması: müşteri bu akışta zaten oluşturulmuş olabilir (ensureCustomer),

      // bu yüzden çözülen müşteri id'sini hataya ekleyip NewVehicleFlow'un "Devret"

      // uyarısını göstermesi için yeniden fırlatıyoruz.

      if (e instanceof PlateConflictError) {

        e.resolvedCustomerId = resolvedCustomerId

        throw e

      }

      reportError(e)

    } finally {

      setBusy(false)

    }

  }



  async function updateVehicle(
    id: string,
    data: {
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
    },
    opts?: { ruhsatUri?: string },
  ) {
    const v = vehicles.find((x) => x.id === id)
    if (!v?.workOrderId) throw new Error('Araç bulunamadı.')

    setBusy(true)
    try {
      await updateVehicleApi(id, data)
      if (opts?.ruhsatUri) {
        try {
          await uploadWorkOrderImage(v.workOrderId, opts.ruhsatUri, 'ruhsat')
        } catch (uploadErr) {
          reportError(uploadErr)
        }
      }
      const fresh = await refreshVehicle(v.workOrderId)
      await replaceVehicle(fresh)
    } catch (e) {
      reportError(e)
      throw e
    } finally {
      setBusy(false)
    }
  }



  async function transferVehicle(vehicleId: string, newCustomerId: string, complaint: string, complaintCategory?: import("@/lib/types").ComplaintCategory) {

    setBusy(true)

    try {

      const created = await transferVehicleApi(vehicleId, newCustomerId, complaint || undefined, complaintCategory)

      setVehicles((prev) => [created, ...prev])

      setSelectedId(created.id)

      setView('detail')

    } catch (e) {

      reportError(e)

    } finally {

      setBusy(false)

    }

  }



  async function addComplaint(id: string, text: string, category: import("@/lib/types").ComplaintCategory = "diger"): Promise<string | undefined> {

    try {

      return await withWo(id, (woId) => addComplaintApi(woId, text, category))

    } catch (e) {

      reportError(e)

      return undefined

    }

  }



  function updateComplaint(id: string, complaintId: string, text: string, category: import("@/lib/types").ComplaintCategory = "diger") {

    withWo(id, (woId) => updateComplaintApi(woId, complaintId, text, category)).catch(reportError)

  }

  function deleteComplaint(id: string, complaintId: string) {

    withWo(id, (woId) => deleteComplaintApi(woId, complaintId)).catch(reportError)

  }



  async function performLogout() {

    await clearSession()

    setUser(null)

    setCurrentUser(null)

    setVehicles([])

    setCustomers([])

    setStock([])

    setStaff([])

    setSuppliers([])

    setView('dashboard')

  }



  function handleLogout() {
    setLogoutOpen(true)
  }

  function confirmLogout() {
    setLogoutOpen(false)
    performLogout()
  }



  async function openNewVisitForVehicle(
    id: string,
    complaint?: string,
    complaintCategory?: import("@/lib/types").ComplaintCategory,
    openedAt?: string,
  ) {

    const v = vehicles.find((x) => x.id === id)

    if (!v) return

    setBusy(true)

    try {

      const fresh = await openNewVisit(v.id, complaint, complaintCategory, openedAt)

      await replaceVehicle(fresh)

      setSelectedId(fresh.id)

    } catch (e) {

      reportError(e)

    } finally {

      setBusy(false)

    }

  }



  function addService(id: string, service: Omit<ServiceItem, 'id'>, force?: boolean): Promise<string> {

    return withWo(id, (woId) => addServiceApi(woId, service, force))

  }



  function updateService(id: string, serviceId: string, data: Omit<ServiceItem, 'id'>) {

    withWo(id, (woId) => updateServiceApi(woId, serviceId, data)).catch(reportError)

  }



  function deleteService(id: string, serviceId: string) {

    withWo(id, (woId) => deleteServiceApi(woId, serviceId)).catch(reportError)

  }



  function addProduct(id: string, product: Omit<ProductItem, 'id'>, force?: boolean) {

    return withWo(id, (woId) => addPartApi(woId, product, force), true)

  }



  function updateProduct(id: string, productId: string, data: Omit<ProductItem, 'id'>) {
    return withWo(id, (woId) => updatePartApi(woId, productId, data), true)
  }



  function deleteProduct(id: string, productId: string) {

    withWo(id, (woId) => deletePartApi(woId, productId), true).catch(reportError)

  }



  function returnProductToSupplier(id: string, productId: string) {

    withWo(id, (woId) => returnPartToSupplier(woId, productId))

      .then(() => reloadSuppliers())

      .catch(reportError)

  }



  function setStatus(
    id: string,
    status: Vehicle['status'],
    assignment?: { assignedUserId?: string; assignedUserName?: string },
  ) {

    return withWo(id, (woId) => setWorkOrderStatus(woId, status, assignment))

  }

  async function deleteWaitingVehicle(id: string) {
    const v = vehicles.find((x) => x.id === id)
    if (!v?.workOrderId) throw new Error('İş emri bulunamadı.')
    await deleteWaitingWorkOrder(v.workOrderId)
    setSelectedId(null)
    setView('vehicles')
    await reloadAll()
  }

  function addPayment(
    id: string,
    amount: number,
    method: 'nakit' | 'kart' | 'havale',
  ) {
    return withWo(id, (woId) => addWorkOrderPayment(woId, amount, method))
  }

  function updatePayment(
    id: string,
    paymentId: string,
    amount: number,
    method: 'nakit' | 'kart' | 'havale',
  ) {
    return withWo(id, (woId) => updateWorkOrderPayment(woId, paymentId, amount, method))
  }

  function deletePayment(id: string, paymentId: string) {
    return withWo(id, (woId) => deleteWorkOrderPayment(woId, paymentId))
  }

  function updateDiscount(id: string, amount: number) {
    return withWo(id, (woId) => updateWorkOrderDiscount(woId, amount))
  }



  async function addCustomer(data: Omit<Customer, 'id'>) {

    setBusy(true)

    try {

      const c = await createCustomer(data)

      setCustomers((prev) => [c, ...prev])

    } catch (e) {

      reportError(e)

      throw e

    } finally {

      setBusy(false)

    }

  }



  async function updateCustomer(id: string, data: Omit<Customer, 'id'>) {

    setBusy(true)

    try {

      const c = await updateCustomerApi(id, data)

      setCustomers((prev) => prev.map((x) => (x.id === id ? c : x)))

    } catch (e) {

      reportError(e)

      throw e

    } finally {

      setBusy(false)

    }

  }



  async function addStockItem(data: Omit<StockProduct, 'id'>) {

    setBusy(true)

    try {

      const p = await createStock(data)

      setStock((prev) => [p, ...prev])

    } catch (e) {

      reportError(e)

      throw e

    } finally {

      setBusy(false)

    }

  }



  async function updateStockItem(id: string, data: Omit<StockProduct, 'id'>) {

    setBusy(true)

    try {

      const p = await updateStockApi(id, data)

      setStock((prev) => prev.map((x) => (x.id === id ? p : x)))

    } catch (e) {

      reportError(e)

      throw e

    } finally {

      setBusy(false)

    }

  }



  async function deleteStockItem(id: string) {

    setBusy(true)

    try {

      await deleteStockApi(id)

      setStock((prev) => prev.filter((x) => x.id !== id))

    } catch (e) {

      reportError(e)

      throw e

    } finally {

      setBusy(false)

    }

  }



  if (!ready) {

    return (

      <View className="flex-1 items-center justify-center bg-background">

        <ActivityIndicator size="large" color={colors.primary} />

      </View>

    )

  }

  if (!user) {

    return (
      <View className="flex-1">
        <Login onLogin={handleLogin} />
      </View>
    )

  }



  const activeTab: MainTabKey =
    view === 'detail'
      ? 'vehicles'
      : view === 'customerDetail' || view === 'supplierReport'
        ? 'customers'
        : view === 'supplierImport' || view === 'stockReports'
          ? 'products'
          : view === 'new'
            ? 'new'
            : view === 'dashboard' || view === 'vehicles' || view === 'customers' || view === 'products'
              ? view
              : 'dashboard'

  const shellTitle =
    view === 'dashboard'
      ? 'Ana Sayfa'
      : view === 'vehicles'
        ? 'Araçlar'
        : view === 'customers'
          ? 'Müşteriler'
          : view === 'products'
            ? 'Stok'
            : view === 'supplierImport'
              ? 'Dışarıdan Temin'
              : view === 'stockReports'
                ? 'Stok Raporları'
                : view === 'detail'
                  ? selected?.plate || 'Araç Detay'
                  : view === 'customerDetail'
                    ? selectedCustomer?.name || 'Müşteri'
                    : view === 'supplierReport'
                      ? 'Tedarikçi Raporu'
                      : 'Yeni Kayıt'

  const shellSubtitle =
    view === 'detail' && selected
      ? `${selected.brand} ${selected.model}`
      : view === 'dashboard'
        ? shopLabel || undefined
        : view === 'supplierReport'
          ? 'Tedarikçi bazlı alış ve iade özeti'
          : undefined

  const shellOnBack =
    view === 'detail'
      ? () =>
          setView(
            detailReturnView === 'customerDetail' || detailReturnView === 'dashboard'
              ? detailReturnView
              : 'vehicles',
          )
      : view === 'customerDetail' || view === 'supplierReport'
        ? () => setView('customers')
        : view === 'supplierImport' || view === 'stockReports'
          ? () => setView('products')
          : view === 'new'
            ? () => setView('dashboard')
            : undefined

  function handleNav(tab: MainTabKey) {
    if (tab === 'new') {
      setView('new')
      return
    }
    if (tab === 'products' && entitlements?.features.stock === false) {
      Alert.alert(
        'Paket özelliği',
        'Stok yönetimi Profesyonel veya Kurumsal pakette vardır.',
      )
      return
    }
    if (tab === 'vehicles') openVehicleList(vehicleListFilter)
    else setView(tab)
  }

  return (
    <View className="flex-1 bg-background">
      {busy && (
        <View className="absolute inset-0 z-50 items-center justify-center bg-black/20">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <AppShell
        title={shellTitle}
        subtitle={shellSubtitle}
        onBack={shellOnBack}
        headerRight={
          view === 'dashboard' ? <HeaderLogoutButton onPress={handleLogout} /> : undefined
        }
        activeTab={activeTab}
        onNavigate={handleNav}
        showStock={entitlements?.features.stock !== false}
        shopLabel={shopLabel || undefined}
        onLogout={handleLogout}
      >
        {view === 'dashboard' && (
          <Dashboard
            vehicles={vehicles}
            userName={user}
            currentUser={currentUser}
            license={shopLicense}
            onLogout={handleLogout}
            onOpenVehicle={openVehicle}
            onOpenPendingWorkOrder={openPendingWorkOrder}
            onNewVehicle={() => setView('new')}
            onSeeAll={() => openVehicleList('all')}
            onRefresh={async () => {
              await reloadAll()
              try {
                const lic = await fetchShopLicense()
                setShopLicense(lic)
              } catch {
                /* ignore */
              }
            }}
          />
        )}

        {view === 'vehicles' && (
          <VehicleList
            vehicles={vehicles}
            onOpenVehicle={openVehicle}
            onNewVehicle={() => setView('new')}
            initialFilter={vehicleListFilter}
            onRefresh={reloadAll}
          />
        )}

        {view === 'customers' && (
          <Customers
            customers={customers}
            onAdd={addCustomer}
            onUpdate={updateCustomer}
            onOpenCustomer={openCustomer}
            onOpenReport={canSeeReports ? () => setView('supplierReport') : undefined}
            onRefresh={reloadAll}
            allowSuppliers={entitlements?.features.suppliers !== false}
          />
        )}

        {view === 'customerDetail' && selectedCustomer && (
          <CustomerDetail
            customer={selectedCustomer}
            onBack={() => setView('customers')}
            onUpdate={updateCustomer}
            onOpenVehicle={openVehicle}
            onOpenWorkOrder={openPendingWorkOrder}
            onChanged={reloadSuppliers}
            allowSuppliers={entitlements?.features.suppliers !== false}
          />
        )}

        {view === 'products' && entitlements?.features.stock !== false && (
          <Products
            products={stock}
            onAdd={addStockItem}
            onUpdate={updateStockItem}
            onDelete={deleteStockItem}
            onRefresh={reloadAll}
            onImportPurchase={() => setView('supplierImport')}
            onOpenReports={canSeeReports ? () => setView('stockReports') : undefined}
          />
        )}

        {view === 'supplierImport' && entitlements?.features.stock !== false && (
          <SupplierImport
            onCancel={() => setView('products')}
            onDone={async () => {
              await reloadAll()
              setView('products')
            }}
          />
        )}

        {view === 'stockReports' && canSeeReports && (
          <StockReports onBack={() => setView('products')} />
        )}

        {view === 'supplierReport' && canSeeReports && entitlements?.features.suppliers !== false && (
          <SupplierReport onBack={() => setView('customers')} />
        )}

        {view === 'detail' && selected && (
          <VehicleDetail
            vehicle={selected}
            serviceCatalog={catalog.length > 0 ? catalog : undefined}
            currentUser={currentUser}
            staff={staff}
            onBack={() => setView('vehicles')}
            onAddComplaint={(text, category) => addComplaint(selected.id, text, category)}
            onUpdateComplaint={(complaintId, text, category) => updateComplaint(selected.id, complaintId, text, category)}
            onDeleteComplaint={(complaintId) => deleteComplaint(selected.id, complaintId)}
            onAddService={(s, force) => addService(selected.id, s, force)}
            onUpdateService={(sid, s) => updateService(selected.id, sid, s)}
            onDeleteService={(sid) => deleteService(selected.id, sid)}
            onAddProduct={(p, force) => addProduct(selected.id, p, force)}
            onUpdateProduct={(pid, p) => updateProduct(selected.id, pid, p)}
            onDeleteProduct={(pid) => deleteProduct(selected.id, pid)}
            onReturnProductToSupplier={(pid) => returnProductToSupplier(selected.id, pid)}
            onSetStatus={(status, assignment) => setStatus(selected.id, status, assignment)}
            onAddPayment={(amount, method) => addPayment(selected.id, amount, method)}
            onUpdatePayment={(paymentId, amount, method) =>
              updatePayment(selected.id, paymentId, amount, method)
            }
            onDeletePayment={(paymentId) => deletePayment(selected.id, paymentId)}
            onUpdateDiscount={(amount) => updateDiscount(selected.id, amount)}
            onOpenNewVisit={(complaint, openedAt) =>
              openNewVisitForVehicle(selected.id, complaint, undefined, openedAt)
            }
            onDeleteWaiting={() => deleteWaitingVehicle(selected.id)}
            onUpdateVehicle={(data, opts) => updateVehicle(selected.id, data, opts)}
          />
        )}

        {view === 'new' && (
          <NewVehicleFlow
            customers={customers}
            onCancel={() => setView('dashboard')}
            onComplete={addVehicle}
            onTransferConflict={transferVehicle}
          />
        )}
      </AppShell>

      <AppSheet
        visible={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Çıkış Yap"
        subtitle="Hesabınızdan çıkış yapmak istediğinize emin misiniz?"
      >
        <SheetActionList
          onClose={() => setLogoutOpen(false)}
          actions={[
            {
              key: 'logout',
              label: 'Çıkış Yap',
              description: 'Oturumu kapat ve giriş ekranına dön',
              icon: LogOut,
              tone: 'destructive',
              onPress: confirmLogout,
            },
          ]}
        />
        <SheetCancelButton onPress={() => setLogoutOpen(false)} label="Vazgeç" />
      </AppSheet>
    </View>
  )
}


