import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { readUriAsBase64 } from '@/lib/read-base64'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { openWebPrintPreview } from '@/lib/web-print-share'
import {
  Phone,
  MapPin,
  Plus,
  Wrench,
  Package,
  MessageSquareWarning,
  Info,
  Check,
  Pencil,
  Trash2,
  User,
  Truck,
  Undo2,
  Search,
  X,
  Share2,
  ChevronDown,
  ChevronUp,
  History,
  Camera,
  ImagePlus,
  PlayCircle,
  CalendarPlus,
  FileText,
  MessageCircle,
  Banknote,
  Landmark,
  Sparkles,
} from 'lucide-react-native'
import { cn } from '@/lib/utils'
import {
  STATUS_LABELS,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_CATEGORY_ORDER,
  type Complaint,
  type ComplaintCategory,
  type JobStatus,
  type ProductItem,
  type ServiceItem,
  type Supplier,
  type Vehicle,
} from '@/lib/types'
import { TextField, TextArea, SelectField } from '@/components/form-field'
import { ArrivalDateField, turkeyTodayIso } from '@/components/arrival-date-field'
import { AppSheet, SheetActionList, SheetCancelButton } from '@/components/app-modal'
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll'
import { formatCurrency, formatDate, formatDateTime, formatTime } from '@/lib/format'
import { colors, withAlpha } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'
import type {
  CurrentUser,
  StaffMember,
  StatusHistoryEntry,
  StockProductLite,
  WorkOrderImage,
  WorkOrderPayment,
  WorkOrderPaymentResult,
} from '@/lib/api'
import {
  absoluteImageUrl,
  createSupplier,
  deleteWorkOrderImage,
  getCachedEntitlements,
  getShopPaymentInfo,
  getStoredShopName,
  getSupplierLedger,
  refreshVehicle,
  getWorkOrderHistory,
  getWorkOrderImages,
  listStockProducts,
  listSuppliers,
  listWorkOrderPayments,
  mapFuel,
  recordSupplierPayment,
  matchStockLinesApi,
  scanInvoiceApi,
  uploadWorkOrderImage,
  type InvoiceScanLine,
  type VehicleInfoPayload,
  type ShopPaymentInfo,
  WorkOrderCompletedError,
  WorkOrderReopenBlockedError,
} from '@/lib/api'
import {
  SERVICE_CATEGORY_LABELS,
  serviceCatalog as defaultCatalog,
  type ServiceCatalogCategory,
  type ServiceCatalogItem,
} from '@/lib/service-catalog'
import { scanRuhsat } from '@/lib/ai-scan'
import { MatchBadge, PdfCodeFields, StockMatchSheet } from '@/components/stock-match-sheet'
import {
  applyPdfLineCodes,
  matchStateFromResult,
  suggestStockCodeFromRaw,
  type StockMatchDecision,
  type StockMatchState,
} from '@/lib/stock-match'

const ASSIGNABLE_ROLES = ['admin', 'usta']

const STATUS_STEPS: { key: JobStatus; short: string }[] = [
  { key: 'bekliyor', short: 'Bekliyor' },
  { key: 'islemde', short: 'İşlemde' },
  { key: 'tamamlandi', short: 'Servis' },
  { key: 'odeme_tamamlandi', short: 'Ödeme' },
  { key: 'teslim_edildi', short: 'Teslim' },
]

function statusStepIndex(status: JobStatus): number {
  const i = STATUS_STEPS.findIndex((s) => s.key === status)
  return i >= 0 ? i : 0
}

function showError(e: unknown) {
  Alert.alert('Hata', e instanceof Error ? e.message : 'İşlem başarısız.')
}

/** Kayıt sonrası fotoğraf yükler; hata olursa kullanıcıya gösterir. */
async function attachPhotoAfterSave(
  workOrderId: string | undefined,
  photoUri: string | null,
  imageType: 'ruhsat' | 'arac' | 'hasar' | 'diger',
  opts?: { complaintId?: string; serviceId?: string },
): Promise<boolean> {
  if (!photoUri) return true
  if (!workOrderId) {
    Alert.alert('Fotoğraf yüklenemedi', 'İş emri bulunamadı. Kaydı yenileyip tekrar deneyin.')
    return false
  }
  try {
    await uploadWorkOrderImage(
      workOrderId,
      photoUri,
      imageType,
      opts?.complaintId,
      opts?.serviceId,
    )
    return true
  } catch (e) {
    Alert.alert(
      'Fotoğraf yüklenemedi',
      e instanceof Error ? e.message : 'Kayıt eklendi ancak fotoğraf sunucuya gönderilemedi.',
    )
    return false
  }
}

function normalizePhoneForWhatsApp(phone: string): string {
  let p = phone.replace(/[^\d]/g, '')
  if (p.startsWith('90') && p.length > 10) p = p.slice(2)
  if (p.startsWith('0')) p = p.slice(1)
  return `90${p}`
}

function resolveTotals(vehicle: Vehicle) {
  const activeProducts = vehicle.products.filter((p) => !p.returnedAt)
  const laborTotal = vehicle.laborTotal ?? vehicle.services.reduce((s, i) => s + i.price, 0)
  const partsTotal =
    vehicle.partsTotal ?? activeProducts.reduce((s, i) => s + i.price * i.quantity, 0)
  const subtotal = Math.round((laborTotal + partsTotal) * 100) / 100
  let discount = Number(vehicle.discount) || 0
  // Bazı istemcilerde discount alanı gelmezse grandTotal farkından çıkar.
  if (discount <= 0 && vehicle.grandTotal != null) {
    const implied = Math.round((subtotal - Number(vehicle.grandTotal)) * 100) / 100
    if (implied > 0.005) discount = implied
  }
  const grandTotal =
    vehicle.grandTotal != null
      ? Number(vehicle.grandTotal)
      : Math.max(0, Math.round((subtotal - discount) * 100) / 100)
  return { activeProducts, laborTotal, partsTotal, subtotal, discount, grandTotal }
}

function buildSummaryText(vehicle: Vehicle, shopName?: string | null): string {
  const { activeProducts, laborTotal, partsTotal, subtotal, discount, grandTotal } =
    resolveTotals(vehicle)
  const shop = shopName?.trim()

  const lines: string[] = []
  if (shop) lines.push(shop.toLocaleUpperCase('tr-TR'), '')
  lines.push(
    `${vehicle.plate} — ${vehicle.brand} ${vehicle.model}`,
    `Müşteri: ${vehicle.customer.name}`,
    `Durum: ${STATUS_LABELS[vehicle.status]}`,
  )

  if (vehicle.services.length > 0) {
    lines.push('', 'İşlemler:')
    vehicle.services.forEach((s) => lines.push(`- ${s.title}: ${formatCurrency(s.price)}`))
  }
  if (activeProducts.length > 0) {
    lines.push('', 'Ürün / Parça:')
    activeProducts.forEach((p) =>
      lines.push(`- ${p.name} (${p.quantity} adet): ${formatCurrency(p.price * p.quantity)}`),
    )
  }

  lines.push('', `İşçilik: ${formatCurrency(laborTotal)}`, `Malzeme: ${formatCurrency(partsTotal)}`)
  if (discount > 0) {
    lines.push(`Ara toplam: ${formatCurrency(subtotal)}`, `İskonto: -${formatCurrency(discount)}`)
  }
  lines.push(`Toplam: ${formatCurrency(grandTotal)}`)
  return lines.join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildSummaryHtml(vehicle: Vehicle, shopName?: string | null): string {
  const { activeProducts, laborTotal, partsTotal, subtotal, discount, grandTotal } =
    resolveTotals(vehicle)
  const shop = shopName?.trim()
  const shopUpper = shop ? shop.toLocaleUpperCase('tr-TR') : ''

  const serviceRows = vehicle.services
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.title)}</td><td class="right">${formatCurrency(s.price)}</td></tr>`,
    )
    .join('')
  const productRows = activeProducts
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.name)} (${p.quantity} adet)</td><td class="right">${formatCurrency(p.price * p.quantity)}</td></tr>`,
    )
    .join('')

  const discountRows =
    discount > 0
      ? `<tr><td>Ara toplam</td><td class="right">${formatCurrency(subtotal)}</td></tr>
    <tr><td>İskonto</td><td class="right discount">-${formatCurrency(discount)}</td></tr>`
      : ''

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 24px; }
  .shop-name {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-align: center;
    margin: 0 0 18px;
    line-height: 1.2;
    text-transform: uppercase;
  }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #555; margin-top: 24px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td { padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px; }
  .right { text-align: right; }
  .meta { font-size: 13px; color: #444; line-height: 1.6; }
  .totals td { font-size: 14px; padding: 4px 0; border-bottom: none; }
  .totals .discount { color: #b45309; font-weight: 600; }
  .totals .grand { font-weight: 700; font-size: 16px; border-top: 2px solid #1a1a1a; padding-top: 8px; }
</style>
</head>
<body>
  ${shopUpper ? `<div class="shop-name">${escapeHtml(shopUpper)}</div>` : ''}
  <h1>${escapeHtml(vehicle.plate)} — ${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)}</h1>
  <div class="meta">
    Müşteri: ${escapeHtml(vehicle.customer.name)}<br/>
    Durum: ${escapeHtml(STATUS_LABELS[vehicle.status])}
  </div>

  ${vehicle.services.length > 0 ? `<h2>İşlemler</h2><table>${serviceRows}</table>` : ''}
  ${activeProducts.length > 0 ? `<h2>Ürün / Parça</h2><table>${productRows}</table>` : ''}

  <h2>Toplam</h2>
  <table class="totals">
    <tr><td>İşçilik</td><td class="right">${formatCurrency(laborTotal)}</td></tr>
    <tr><td>Malzeme</td><td class="right">${formatCurrency(partsTotal)}</td></tr>
    ${discountRows}
    <tr><td class="grand">Toplam</td><td class="right grand">${formatCurrency(grandTotal)}</td></tr>
  </table>
</body>
</html>`
}

function openPrintPreview(html: string, plate?: string) {
  openWebPrintPreview(html, {
    title: 'İş emri önizleme',
    filename: `is-emri-${(plate || 'belge').replace(/\s+/g, '')}.html`,
  })
}

async function resolveVehicleForShare(vehicle: Vehicle): Promise<Vehicle> {
  if (!vehicle.workOrderId) return vehicle
  try {
    return await refreshVehicle(vehicle.workOrderId)
  } catch {
    return vehicle
  }
}

async function sharePdf(vehicle: Vehicle) {
  const fresh = await resolveVehicleForShare(vehicle)
  const shopName = await getStoredShopName()
  const html = buildSummaryHtml(fresh, shopName)
  if (Platform.OS === 'web') {
    openPrintPreview(html, fresh.plate)
    return
  }
  try {
    const { uri } = await Print.printToFileAsync({ html })
    const canShare = await Sharing.isAvailableAsync()
    if (canShare) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
    } else {
      Alert.alert('Paylaşım kullanılamıyor', 'Bu cihazda paylaşım özelliği bulunamadı.')
    }
  } catch (e) {
    showError(e)
  }
}

async function shareAsText(vehicle: Vehicle) {
  const fresh = await resolveVehicleForShare(vehicle)
  const text = buildSummaryText(fresh, await getStoredShopName())
  if (Platform.OS === 'web') {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text, title: fresh.plate })
        return
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(text)
      Alert.alert('Kopyalandı', 'İş özeti panoya kopyalandı.')
    } catch (e) {
      showError(e)
    }
    return
  }
  try {
    await Share.share({ message: text })
  } catch (e) {
    showError(e)
  }
}

async function shareViaWhatsApp(vehicle: Vehicle) {
  const fresh = await resolveVehicleForShare(vehicle)
  const text = buildSummaryText(fresh, await getStoredShopName())
  const phone = normalizePhoneForWhatsApp(fresh.customer.phone)
  const appUrl = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`
  const webUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
  try {
    const canOpen = await Linking.canOpenURL(appUrl)
    await Linking.openURL(canOpen ? appUrl : webUrl)
  } catch {
    Alert.alert('WhatsApp açılamadı', 'WhatsApp yüklü değil veya açılamadı.')
  }
}

type Tab = 'bilgiler' | 'sikayet' | 'islem' | 'urun'
type IconType = typeof Wrench

const tabs: { key: Tab; label: string }[] = [
  { key: 'bilgiler', label: 'Bilgiler' },
  { key: 'sikayet', label: 'Şikayet' },
  { key: 'islem', label: 'İşlemler' },
  { key: 'urun', label: 'Ürünler' },
]

export function VehicleDetail({
  vehicle,
  serviceCatalog: catalogProp,
  currentUser,
  staff,
  onBack: _onBack,
  onAddComplaint,
  onUpdateComplaint,
  onDeleteComplaint,
  onAddService,
  onUpdateService,
  onDeleteService,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onReturnProductToSupplier,
  onSetStatus,
  onAddPayment,
  onUpdatePayment,
  onDeletePayment,
  onUpdateDiscount,
  onOpenNewVisit,
  onDeleteWaiting,
  onUpdateVehicle,
}: {
  vehicle: Vehicle
  serviceCatalog?: ServiceCatalogItem[]
  currentUser: CurrentUser | null
  staff: StaffMember[]
  onBack: () => void
  onAddComplaint: (text: string, category: ComplaintCategory) => Promise<string | undefined>
  onUpdateComplaint: (complaintId: string, text: string, category: ComplaintCategory) => void
  onDeleteComplaint: (complaintId: string) => void
  onAddService: (s: Omit<ServiceItem, 'id'>, force?: boolean) => Promise<string | undefined>
  onUpdateService: (id: string, s: Omit<ServiceItem, 'id'>) => void
  onDeleteService: (id: string) => void
  onAddProduct: (p: Omit<ProductItem, 'id'>, force?: boolean) => Promise<void>
  onUpdateProduct: (id: string, p: Omit<ProductItem, 'id'>) => void | Promise<void>
  onDeleteProduct: (id: string) => void
  onReturnProductToSupplier: (id: string) => void
  onSetStatus: (
    status: JobStatus,
    assignment?: { assignedUserId?: string; assignedUserName?: string },
  ) => Promise<void>
  onAddPayment: (
    amount: number,
    method: 'nakit' | 'kart' | 'havale',
  ) => Promise<WorkOrderPaymentResult>
  onUpdatePayment: (
    paymentId: string,
    amount: number,
    method: 'nakit' | 'kart' | 'havale',
  ) => Promise<WorkOrderPaymentResult>
  onDeletePayment: (paymentId: string) => Promise<WorkOrderPaymentResult>
  onUpdateDiscount: (amount: number) => Promise<WorkOrderPaymentResult>
  onOpenNewVisit: (complaint?: string, openedAt?: string) => void
  onDeleteWaiting?: () => Promise<void>
  onUpdateVehicle: (data: VehicleInfoPayload, opts?: { ruhsatUri?: string }) => Promise<void>
}) {
  const serviceCatalog = catalogProp ?? defaultCatalog
  const [tab, setTab] = useState<Tab>('bilgiler')
  const [assignOpen, setAssignOpen] = useState(false)
  const [newVisitOpen, setNewVisitOpen] = useState(false)
  const [newVisitDate, setNewVisitDate] = useState(turkeyTodayIso)
  const [newVisitComplaint, setNewVisitComplaint] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [ibanOpen, setIbanOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editPayment, setEditPayment] = useState<WorkOrderPayment | null>(null)
  const [payments, setPayments] = useState<WorkOrderPayment[]>([])

  const canAssign = !!currentUser && ASSIGNABLE_ROLES.includes(currentUser.role)

  function promptNewVisit() {
    setNewVisitDate(turkeyTodayIso())
    setNewVisitComplaint('')
    setNewVisitOpen(true)
  }

  function confirmNewVisit() {
    const date = newVisitDate || turkeyTodayIso()
    const complaint = newVisitComplaint.trim() || undefined
    setNewVisitOpen(false)
    onOpenNewVisit(complaint, date)
  }

  function handleStatusError(e: unknown) {
    if (e instanceof WorkOrderReopenBlockedError) {
      Alert.alert('Durum değiştirilemedi', e.message, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Yeni Servis Kaydı Aç', onPress: () => promptNewVisit() },
      ])
    } else {
      showError(e)
    }
  }

  const laborTotal = vehicle.laborTotal ?? vehicle.services.reduce((s, i) => s + i.price, 0)
  const partsTotal =
    vehicle.partsTotal ??
    vehicle.products
      .filter((p) => !p.returnedAt)
      .reduce((s, i) => s + i.price * i.quantity, 0)
  const discount = vehicle.discount ?? 0
  const total = vehicle.grandTotal ?? Math.max(0, laborTotal + partsTotal - discount)
  const paidTotal = vehicle.paidTotal ?? 0
  const remaining = Math.max(0, Math.round((total - paidTotal) * 100) / 100)
  const showPaymentUi =
    vehicle.status === 'tamamlandi' ||
    vehicle.status === 'teslim_edildi' ||
    vehicle.status === 'odeme_tamamlandi' ||
    paidTotal > 0 ||
    payments.length > 0 ||
    discount > 0
  const paymentNotDone =
    vehicle.status !== 'odeme_tamamlandi' && vehicle.status !== 'teslim_edildi'
  const jobSuppliersForPay = useMemo(
    () => jobSupplierPayOptions(vehicle.products),
    [vehicle.products],
  )

  async function reloadPayments() {
    if (!vehicle.workOrderId) return
    try {
      setPayments(await listWorkOrderPayments(vehicle.workOrderId))
    } catch {
      setPayments([])
    }
  }

  useEffect(() => {
    reloadPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.workOrderId, vehicle.paidTotal, vehicle.grandTotal, vehicle.discount])

  async function applyStatus(s: JobStatus) {
    try {
      if (s !== 'islemde') {
        await onSetStatus(s)
        return
      }
      if (canAssign) {
        setAssignOpen(true)
        return
      }
      await onSetStatus(s, currentUser ? { assignedUserId: currentUser.id } : undefined)
    } catch (e) {
      handleStatusError(e)
    }
  }

  function handleStatusPress(s: JobStatus) {
    if (s === vehicle.status) return

    if (s === 'odeme_tamamlandi' && remaining > 0) {
      Alert.alert(
        'Kalan tutar var',
        `Henüz ${formatCurrency(remaining)} ödenmedi. Yine de Ödeme Tamamlandı olarak işaretlensin mi?`,
        [
          { text: 'İptal', style: 'cancel' },
          {
            text: 'Evet',
            style: 'destructive',
            onPress: () => {
              void applyStatus('odeme_tamamlandi')
            },
          },
        ],
      )
      return
    }

    if (s === 'teslim_edildi' && (paymentNotDone || remaining > 0)) {
      const detail =
        remaining > 0
          ? `Henüz ${formatCurrency(remaining)} ödenmedi. Önce ödeme almanız önerilir.`
          : 'Ödeme henüz tamamlanmadı. Önce Ödeme Tamamlandı yapmanız önerilir.'
      Alert.alert('Ödeme alınmadı', `${detail}\n\nYine de teslim edilsin mi?`, [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Yine de Teslim Et',
          style: 'destructive',
          onPress: () => {
            void applyStatus('teslim_edildi')
          },
        },
      ])
      return
    }
    void applyStatus(s)
  }

  function handleShare() {
    setShareOpen(true)
  }

  async function afterPaymentRecorded(grandTotal: number, paid: number) {
    const rem = Math.max(0, Math.round((grandTotal - paid) * 100) / 100)
    if (rem > 0) return
    if (vehicle.status !== 'tamamlandi') return
    try {
      await onSetStatus('odeme_tamamlandi')
    } catch (e) {
      handleStatusError(e)
    }
  }

  // Tamamen ödenmiş ama durum hâlâ "tamamlandi" kaldıysa otomatik ilerlet
  useEffect(() => {
    if (vehicle.status !== 'tamamlandi' || remaining > 0) return
    void onSetStatus('odeme_tamamlandi').catch(() => {
      /* kullanıcı Durumu düzelt ile devam edebilir */
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.status, remaining])

  return (
    <View className="flex-1">
      <KeyboardAwareScrollView
        className="flex-1"
        stickyHeaderIndices={[2]}
        basePaddingBottom={32}
        showsVerticalScrollIndicator={false}
      >
        <View className="mx-4 mt-4 rounded-3xl border border-border bg-card px-4 py-4" style={cardShadow}>
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-row items-center gap-2">
              <View className="rounded-lg bg-foreground px-3 py-1.5">
                <Text className="font-mono text-base font-bold tracking-wide text-background">
                  {vehicle.plate}
                </Text>
              </View>
              {vehicle.visitNumber != null && vehicle.visitNumber > 1 ? (
                <View className="rounded-md bg-secondary px-2.5 py-1.5">
                  <Text className="text-xs font-extrabold text-secondary-foreground">
                    {vehicle.visitNumber}. kez
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={handleShare}
              className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
            >
              <Share2 size={18} color={colors.secondaryForeground} />
            </Pressable>
          </View>

          <Text className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">
            {vehicle.brand} {vehicle.model}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {vehicle.year} · {vehicle.color} · {fuelLabel(vehicle.fuel)}
          </Text>

          <StatusStepper
            status={vehicle.status}
            onSelectStatus={(s) => handleStatusPress(s)}
          />

          {/* Duruma göre ana işlem butonu */}
          {vehicle.status === 'bekliyor' ? (
            <View className="mt-3 gap-2">
              <Pressable
                onPress={() => handleStatusPress('islemde')}
                className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-accent active:opacity-90"
              >
                <PlayCircle size={18} color={colors.accentForeground} />
                <Text className="text-sm font-extrabold text-accent-foreground">İşleme Al</Text>
              </Pressable>
              {onDeleteWaiting ? (
                <Pressable
                  onPress={() => setDeleteOpen(true)}
                  className="h-12 flex-row items-center justify-center gap-2 rounded-xl border-2 border-destructive/40 bg-destructive/10 active:opacity-90"
                >
                  <Trash2 size={18} color={colors.destructive} />
                  <Text className="text-sm font-extrabold text-destructive">Kaydı Sil</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {vehicle.status === 'islemde' ? (
            <Pressable
              onPress={() => handleStatusPress('tamamlandi')}
              className="mt-3 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-chart-4 active:opacity-90"
            >
              <Check size={18} color="#fff" />
              <Text className="text-sm font-extrabold text-white">İşlemi Tamamla</Text>
            </Pressable>
          ) : null}

          {vehicle.status === 'tamamlandi' && remaining > 0 ? (
            <Pressable
              onPress={() => setPayOpen(true)}
              className="mt-3 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-90"
            >
              <Banknote size={18} color={colors.primaryForeground} />
              <Text className="text-sm font-extrabold text-primary-foreground">
                Müşteriden Tahsilat · {formatCurrency(remaining)}
              </Text>
            </Pressable>
          ) : null}

          {vehicle.status === 'tamamlandi' && remaining <= 0 ? (
            <Pressable
              onPress={() => handleStatusPress('odeme_tamamlandi')}
              className="mt-3 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-chart-4 active:opacity-90"
            >
              <Banknote size={18} color="#fff" />
              <Text className="text-sm font-extrabold text-white">Ödemeyi Onayla</Text>
            </Pressable>
          ) : null}

          {vehicle.status === 'odeme_tamamlandi' ? (
            <Pressable
              onPress={() => handleStatusPress('teslim_edildi')}
              className="mt-3 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-accent active:opacity-90"
            >
              <Check size={18} color={colors.accentForeground} />
              <Text className="text-sm font-extrabold text-accent-foreground">
                Müşteriye Teslim Et
              </Text>
            </Pressable>
          ) : null}

          {vehicle.status === 'teslim_edildi' ? (
            <Pressable
              onPress={promptNewVisit}
              className="mt-3 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-90"
            >
              <CalendarPlus size={18} color={colors.primaryForeground} />
              <Text className="text-sm font-extrabold text-primary-foreground">
                Yeni Servis Kaydı
              </Text>
            </Pressable>
          ) : null}

          {showPaymentUi && (
            <View className="mt-3 rounded-2xl border border-border bg-secondary/60 px-3 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-muted-foreground">Kalan tutar</Text>
                <Text className="text-base font-extrabold text-foreground">
                  {formatCurrency(remaining)}
                </Text>
              </View>

              {/* Birincil tahsilat yalnızca durum CTA'sı tamamlandi değilken burada */}
              {remaining > 0 && vehicle.status !== 'tamamlandi' ? (
                <Pressable
                  onPress={() => setPayOpen(true)}
                  className="mt-2.5 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-90"
                >
                  <Banknote size={17} color={colors.primaryForeground} />
                  <Text className="text-sm font-extrabold text-primary-foreground">
                    Müşteriden Tahsilat
                  </Text>
                </Pressable>
              ) : null}

              <View className="mt-2.5 flex-row gap-2">
                <Pressable
                  onPress={() => setDiscountOpen(true)}
                  className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl border-2 border-border bg-card active:opacity-90"
                >
                  <Text className="text-sm font-extrabold text-foreground">İskonto</Text>
                </Pressable>
                <Pressable
                  onPress={() => setIbanOpen(true)}
                  className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl border-2 border-border bg-card active:opacity-90"
                >
                  <Landmark size={17} color={colors.foreground} />
                  <Text className="text-sm font-extrabold text-foreground">IBAN</Text>
                </Pressable>
              </View>

              {(paidTotal > 0 || payments.length > 0) && (
                <View className="mt-3 border-t border-border pt-3">
                  <View className="mb-2 flex-row items-center justify-between">
                    <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Ödemeler
                    </Text>
                    <Text className="text-xs font-semibold text-muted-foreground">
                      Ödenen {formatCurrency(paidTotal)}
                    </Text>
                  </View>
                  {payments.length === 0 ? (
                    <Text className="text-xs text-muted-foreground">
                      Ödeme kaydı yüklenemedi. Aşağı çekerek yenileyin.
                    </Text>
                  ) : (
                    <View className="gap-2">
                      {payments.map((p) => (
                        <PaymentRow
                          key={p.id}
                          payment={p}
                          onEdit={() => setEditPayment(p)}
                          onDelete={() => {
                            Alert.alert(
                              'Ödemeyi sil',
                              `${formatCurrency(p.amount)} tutarındaki ödeme silinsin mi?\nBu tahsilatla birlikte yazılan tedarikçi ödemesi de geri alınır.`,
                              [
                                { text: 'İptal', style: 'cancel' },
                                {
                                  text: 'Sil',
                                  style: 'destructive',
                                  onPress: () => {
                                    onDeletePayment(p.id)
                                      .then((r) => {
                                        reloadPayments()
                                        return afterPaymentRecorded(r.grandTotal, r.paidTotal)
                                      })
                                      .catch(showError)
                                  },
                                },
                              ],
                            )
                          }}
                        />
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {vehicle.assignedTo ? (
            <View className="mt-2.5 flex-row items-center gap-1.5">
              <User size={13} color={colors.mutedForeground} />
              <Text className="text-xs font-semibold text-muted-foreground">
                Bu işi yapan: {vehicle.assignedTo}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="bg-background px-5 pt-3">
          <StatusTimeline workOrderId={vehicle.workOrderId} />
        </View>

        <View className="bg-background px-3 pt-3" style={{ marginTop: -8 }}>
          <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
            {tabs.map((t) => {
              const active = tab === t.key
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  className={cn('flex-1 rounded-xl py-2.5', active && 'bg-card')}
                  style={active ? cardShadow : undefined}
                >
                  <Text
                    className={cn(
                      'text-center text-sm font-bold',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View className="px-5 py-5">
          {tab === 'bilgiler' && (
            <InfoTab vehicle={vehicle} onUpdateVehicle={onUpdateVehicle} />
          )}
          {tab === 'sikayet' && (
            <ComplaintTab
              vehicle={vehicle}
              onAdd={onAddComplaint}
              onUpdate={onUpdateComplaint}
              onDelete={onDeleteComplaint}
            />
          )}
          {tab === 'islem' && (
            <ServiceTab
              vehicle={vehicle}
              catalog={serviceCatalog}
              onAdd={onAddService}
              onUpdate={onUpdateService}
              onDelete={onDeleteService}
            />
          )}
          {tab === 'urun' && (
            <ProductTab
              vehicle={vehicle}
              onAdd={onAddProduct}
              onUpdate={onUpdateProduct}
              onDelete={onDeleteProduct}
              onReturnToSupplier={onReturnProductToSupplier}
            />
          )}
        </View>

        {(vehicle.services.length > 0 || vehicle.products.length > 0) && (
          <View className="px-5 pb-5">
            <View className="rounded-2xl bg-foreground px-5 py-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-background/70">İşçilik</Text>
                <Text className="text-sm font-bold text-background/90">
                  {formatCurrency(laborTotal)}
                </Text>
              </View>
              <View className="mt-1.5 flex-row items-center justify-between">
                <Text className="text-sm font-medium text-background/70">Malzeme</Text>
                <Text className="text-sm font-bold text-background/90">
                  {formatCurrency(partsTotal)}
                </Text>
              </View>
              {(discount > 0 || showPaymentUi) && (
                <Pressable
                  onPress={() => setDiscountOpen(true)}
                  className="mt-1.5 flex-row items-center justify-between"
                >
                  <Text className="text-sm font-medium text-background/70">İskonto</Text>
                  <Text className="text-sm font-bold text-background/90">
                    {discount > 0 ? `−${formatCurrency(discount)}` : 'Ekle'}
                  </Text>
                </Pressable>
              )}
              <View className="mt-2.5 flex-row items-center justify-between border-t border-background/15 pt-2.5">
                <Text className="text-sm font-semibold text-background/80">Toplam</Text>
                <Text className="text-xl font-extrabold text-background">
                  {formatCurrency(total)}
                </Text>
              </View>
              {(paidTotal > 0 || payments.length > 0) && (
                <>
                  <View className="mt-1.5 flex-row items-center justify-between">
                    <Text className="text-sm font-medium text-background/70">Ödenen</Text>
                    <Text className="text-sm font-bold text-background/90">
                      {formatCurrency(paidTotal)}
                    </Text>
                  </View>
                  <View className="mt-1.5 flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-background/80">Kalan</Text>
                    <Text className="text-base font-extrabold text-background">
                      {formatCurrency(remaining)}
                    </Text>
                  </View>
                  {payments.length > 0 && (
                    <View className="mt-3 gap-2 border-t border-background/15 pt-3">
                      {payments.map((p) => (
                        <PaymentRow
                          key={p.id}
                          payment={p}
                          dark
                          onEdit={() => setEditPayment(p)}
                          onDelete={() => {
                            Alert.alert(
                              'Ödemeyi sil',
                              `${formatCurrency(p.amount)} tutarındaki ödeme silinsin mi?\nBu tahsilatla birlikte yazılan tedarikçi ödemesi de geri alınır.`,
                              [
                                { text: 'İptal', style: 'cancel' },
                                {
                                  text: 'Sil',
                                  style: 'destructive',
                                  onPress: () => {
                                    onDeletePayment(p.id)
                                      .then((r) => {
                                        reloadPayments()
                                        return afterPaymentRecorded(r.grandTotal, r.paidTotal)
                                      })
                                      .catch(showError)
                                  },
                                },
                              ],
                            )
                          }}
                        />
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </KeyboardAwareScrollView>

      <AssignmentModal
        visible={assignOpen}
        staff={staff}
        currentUser={currentUser}
        onCancel={() => setAssignOpen(false)}
        onConfirm={(assignment) => {
          setAssignOpen(false)
          onSetStatus('islemde', assignment).catch(handleStatusError)
        }}
      />

      <ShareSheet
        visible={shareOpen}
        vehicle={vehicle}
        onClose={() => setShareOpen(false)}
      />

      <AppSheet
        visible={newVisitOpen}
        onClose={() => setNewVisitOpen(false)}
        title="Yeni Servis Kaydı"
        subtitle={`${vehicle.plate} için yeni servis kaydı açılacak. Geçmiş tarihli geliş için tarihi değiştirin.`}
      >
        <View className="gap-3">
          <ArrivalDateField value={newVisitDate} onChange={setNewVisitDate} />
          <TextArea
            label="Şikayet (isteğe bağlı)"
            value={newVisitComplaint}
            onChange={setNewVisitComplaint}
            rows={3}
            placeholder="Örn: Periyodik bakım"
          />
          <Pressable
            onPress={confirmNewVisit}
            className="h-12 items-center justify-center rounded-2xl bg-accent active:opacity-90"
          >
            <Text className="text-sm font-extrabold text-accent-foreground">Aç</Text>
          </Pressable>
          <SheetCancelButton onPress={() => setNewVisitOpen(false)} />
        </View>
      </AppSheet>

      <AppSheet
        visible={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false)
        }}
        title="Kaydı sil"
        subtitle={`${vehicle.plate} bekleyen kaydı sistemden silinsin mi? İşleme alınmamış kayıtlar silinebilir.`}
      >
        <Pressable
          disabled={deleting}
          onPress={() => {
            if (!onDeleteWaiting) return
            setDeleting(true)
            void onDeleteWaiting()
              .then(() => setDeleteOpen(false))
              .catch(showError)
              .finally(() => setDeleting(false))
          }}
          className="h-12 items-center justify-center rounded-2xl bg-destructive active:opacity-90"
        >
          <Text className="text-sm font-extrabold text-white">
            {deleting ? 'Siliniyor...' : 'Sil'}
          </Text>
        </Pressable>
        <SheetCancelButton onPress={() => setDeleteOpen(false)} />
      </AppSheet>

      <PaymentSheet
        visible={payOpen}
        remaining={remaining}
        maxAmount={remaining}
        jobSuppliers={jobSuppliersForPay}
        onClose={() => setPayOpen(false)}
        onSubmit={async (amount, method, supplierPay) => {
          const result = await onAddPayment(amount, method)
          if (supplierPay) {
            try {
              const pid = result.paymentId
              const desc = pid
                ? `İş emri tahsilatı · ${vehicle.plate} · pid:${pid}`
                : `İş emri tahsilatı · ${vehicle.plate}`
              const ledger = await recordSupplierPayment(
                supplierPay.id,
                supplierPay.amount,
                desc,
                supplierPay.method,
              )
              Alert.alert(
                'Kaydedildi',
                `Müşteri tahsilatı: ${formatCurrency(amount)}\n${supplierPay.name} ödemesi: ${formatCurrency(supplierPay.amount)}\nYeni tedarikçi bakiyesi: ${formatCurrency(ledger.supplier.balance)}`,
              )
            } catch (e) {
              Alert.alert(
                'Tahsilat alındı',
                `Müşteri ödemesi kaydedildi ancak tedarikçi ödemesi yazılamadı.\n${e instanceof Error ? e.message : 'Tekrar deneyin.'}`,
              )
            }
          }
          setPayOpen(false)
          await reloadPayments()
          await afterPaymentRecorded(result.grandTotal, result.paidTotal)
        }}
      />

      <PaymentSheet
        visible={!!editPayment}
        remaining={remaining}
        maxAmount={
          Math.round((remaining + (editPayment?.amount ?? 0)) * 100) / 100
        }
        initialAmount={editPayment?.amount}
        initialMethod={
          editPayment?.method === 'kart' || editPayment?.method === 'havale'
            ? editPayment.method
            : 'nakit'
        }
        title="Ödemeyi Düzenle"
        onClose={() => setEditPayment(null)}
        onSubmit={async (amount, method) => {
          if (!editPayment) return
          const result = await onUpdatePayment(editPayment.id, amount, method)
          setEditPayment(null)
          await reloadPayments()
          await afterPaymentRecorded(result.grandTotal, result.paidTotal)
        }}
      />

      <DiscountSheet
        visible={discountOpen}
        current={discount}
        maxAmount={laborTotal + partsTotal}
        onClose={() => setDiscountOpen(false)}
        onSubmit={async (amount) => {
          const result = await onUpdateDiscount(amount)
          setDiscountOpen(false)
          await afterPaymentRecorded(result.grandTotal, result.paidTotal)
        }}
      />

      <IbanShareSheet
        visible={ibanOpen}
        vehicle={vehicle}
        amount={remaining > 0 ? remaining : total}
        onClose={() => setIbanOpen(false)}
      />
    </View>
  )
}

function StatusStepper({
  status,
  onSelectStatus,
}: {
  status: JobStatus
  onSelectStatus: (s: JobStatus) => void
}) {
  const activeIdx = statusStepIndex(status)
  return (
    <View className="mt-4 rounded-2xl border border-border bg-secondary/50 px-2.5 py-2.5">
      <Text className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Durum · {STATUS_LABELS[status]}
      </Text>
      <View className="flex-row items-center">
        {STATUS_STEPS.map((step, i) => {
          const done = i < activeIdx
          const active = i === activeIdx
          return (
            <View key={step.key} className="min-w-0 flex-1 flex-row items-center">
              <Pressable
                onPress={() => onSelectStatus(step.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className="min-w-0 flex-1 items-center active:opacity-80"
              >
                <View
                  className={cn(
                    'h-8 w-8 items-center justify-center rounded-full',
                    active ? 'bg-primary' : done ? 'bg-chart-4' : 'bg-border',
                  )}
                >
                  {done ? (
                    <Check size={14} color="#fff" strokeWidth={3} />
                  ) : (
                    <Text
                      className={cn(
                        'text-[11px] font-extrabold',
                        active ? 'text-primary-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {i + 1}
                    </Text>
                  )}
                </View>
                <Text
                  className={cn(
                    'mt-1 text-center text-[10px] font-bold',
                    active ? 'text-primary' : done ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  numberOfLines={1}
                >
                  {step.short}
                </Text>
              </Pressable>
              {i < STATUS_STEPS.length - 1 ? (
                <View
                  className={cn('mb-4 h-0.5 w-1.5', i < activeIdx ? 'bg-chart-4' : 'bg-border')}
                />
              ) : null}
            </View>
          )
        })}
      </View>
    </View>
  )
}

function ShareSheet({
  visible,
  vehicle,
  onClose,
}: {
  visible: boolean
  vehicle: Vehicle
  onClose: () => void
}) {
  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="Paylaş"
      subtitle={`${vehicle.plate} iş emrini nasıl paylaşmak istersiniz?`}
    >
      <SheetActionList
        onClose={onClose}
        actions={[
          {
            key: 'whatsapp',
            label: "WhatsApp'tan Paylaş",
            description: 'Müşteriye mesaj olarak gönder',
            icon: MessageCircle,
            tone: 'accent',
            onPress: () => shareViaWhatsApp(vehicle),
          },
          {
            key: 'text',
            label: 'Detay Paylaş',
            description: 'Özet metni diğer uygulamalarla gönder',
            icon: Share2,
            tone: 'primary',
            onPress: () => shareAsText(vehicle),
          },
          {
            key: 'pdf',
            label: 'PDF Paylaş',
            description: 'Yazdırılabilir PDF oluştur',
            icon: FileText,
            tone: 'primary',
            onPress: () => sharePdf(vehicle),
          },
        ]}
      />
      <SheetCancelButton onPress={onClose} />
    </AppSheet>
  )
}

function StatusTimeline({ workOrderId }: { workOrderId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [entries, setEntries] = useState<StatusHistoryEntry[]>([])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !loaded) {
      setLoading(true)
      getWorkOrderHistory(workOrderId)
        .then((rows) => {
          setEntries(rows)
          setLoaded(true)
        })
        .catch(() => setEntries([]))
        .finally(() => setLoading(false))
    }
  }

  return (
    <View className="mb-1 rounded-2xl border border-border bg-card">
      <Pressable
        onPress={toggle}
        className="flex-row items-center justify-between px-4 py-3"
      >
        <View className="flex-row items-center gap-2">
          <History size={16} color={colors.primary} />
          <Text className="text-sm font-bold text-foreground">Zaman Çizelgesi</Text>
        </View>
        {open ? (
          <ChevronUp size={18} color={colors.mutedForeground} />
        ) : (
          <ChevronDown size={18} color={colors.mutedForeground} />
        )}
      </Pressable>
      {open && (
        <View className="border-t border-border px-4 pb-3 pt-2">
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : entries.length === 0 ? (
            <Text className="py-2 text-xs text-muted-foreground">
              Henüz durum değişikliği yok.
            </Text>
          ) : (
            entries.map((e, i) => (
              <View
                key={e.id}
                className={cn('flex-row items-center justify-between py-2', i > 0 && 'border-t border-border')}
              >
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">
                    {e.oldStatus ? `${STATUS_LABELS[mapHistoryStatus(e.oldStatus)]} → ` : ''}
                    {STATUS_LABELS[mapHistoryStatus(e.newStatus)]}
                  </Text>
                  {e.changedByName ? (
                    <Text className="text-xs text-muted-foreground">{e.changedByName}</Text>
                  ) : null}
                </View>
                <Text className="text-xs font-medium text-muted-foreground">
                  {formatDate(e.changedAt)} {formatTime(e.changedAt)}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  )
}

function mapHistoryStatus(raw: string): JobStatus {
  if (raw === 'islemde') return 'islemde'
  if (raw === 'teslim_edildi') return 'teslim_edildi'
  if (raw === 'odeme_tamamlandi') return 'odeme_tamamlandi'
  if (raw === 'tamamlandi') return 'tamamlandi'
  return 'bekliyor'
}

function PaymentRow({
  payment,
  onEdit,
  onDelete,
  dark = false,
}: {
  payment: WorkOrderPayment
  onEdit: () => void
  onDelete: () => void
  dark?: boolean
}) {
  return (
    <View
      className={
        dark
          ? 'rounded-xl bg-background/10 px-3 py-2.5'
          : 'rounded-xl border border-border bg-card px-3 py-2.5'
      }
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text
            className={
              dark
                ? 'text-sm font-bold text-background'
                : 'text-sm font-bold text-foreground'
            }
          >
            {formatCurrency(payment.amount)}
            <Text className={dark ? 'font-medium text-background/70' : 'font-medium text-muted-foreground'}>
              {' · '}
              {PAY_METHOD_LABELS[payment.method] ?? payment.method}
            </Text>
          </Text>
          <Text className={dark ? 'mt-0.5 text-xs text-background/60' : 'mt-0.5 text-xs text-muted-foreground'}>
            {formatDateTime(payment.paidAt)}
          </Text>
        </View>
      </View>
      <View className="mt-2 flex-row gap-2">
        <Pressable
          onPress={onEdit}
          className={
            dark
              ? 'h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-background/15'
              : 'h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-secondary'
          }
        >
          <Pencil size={14} color={dark ? colors.background : colors.secondaryForeground} />
          <Text
            className={
              dark
                ? 'text-xs font-bold text-background'
                : 'text-xs font-bold text-secondary-foreground'
            }
          >
            Düzenle
          </Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          className={
            dark
              ? 'h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-destructive/40'
              : 'h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-destructive/10'
          }
        >
          <Trash2 size={14} color={dark ? colors.background : colors.destructive} />
          <Text
            className={
              dark ? 'text-xs font-bold text-background' : 'text-xs font-bold text-destructive'
            }
          >
            Sil
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const PAY_METHODS: { key: 'nakit' | 'kart' | 'havale'; label: string }[] = [
  { key: 'nakit', label: 'Nakit' },
  { key: 'kart', label: 'Kart' },
  { key: 'havale', label: 'Havale' },
]

const PAY_METHOD_LABELS: Record<string, string> = {
  nakit: 'Nakit',
  kart: 'Kart',
  havale: 'Havale',
  diger: 'Diğer',
}

type JobSupplierPayOption = {
  id: string
  name: string
  suggestAmount: number
}

const EMPTY_JOB_SUPPLIERS: JobSupplierPayOption[] = []

/** İş emrindeki dışarıdan ürünlerden tedarikçi bazlı alış toplamı. */
function jobSupplierPayOptions(products: ProductItem[]): JobSupplierPayOption[] {
  const map = new Map<string, JobSupplierPayOption>()
  for (const p of products) {
    if (p.source !== 'disaridan' || !p.supplierId || p.returnedAt) continue
    const cost = Math.round((p.purchasePrice ?? 0) * p.quantity * 100) / 100
    const prev = map.get(p.supplierId)
    if (prev) {
      prev.suggestAmount = Math.round((prev.suggestAmount + cost) * 100) / 100
    } else {
      map.set(p.supplierId, {
        id: p.supplierId,
        name: p.supplierName?.trim() || 'Tedarikçi',
        suggestAmount: cost,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

/** "Tedarikçiye de öde" açıkken müşteriden alınan / tedarikçiye aktarılan tutarı
 *  açıkça gösterir — tutar yalnızca tedarikçi alanından değiştirilirse (üstteki
 *  "Müşteriden alınan" alanı dokunulmadan kalırsa) farkın işletmede kaldığını
 *  netleştirip yanlışlıkla tam bakiye tahsil edilmiş gibi görünmesini engeller. */
function SupplierSplitSummary({
  customerAmount,
  supplierAmount,
  supplierName,
}: {
  customerAmount: string
  supplierAmount: string
  supplierName?: string
}) {
  const custVal = Number(String(customerAmount).replace(',', '.')) || 0
  const supVal = Number(String(supplierAmount).replace(',', '.')) || 0
  const leftover = Math.round((custVal - supVal) * 100) / 100
  const name = supplierName ?? 'tedarikçiye'

  return (
    <View className="mt-1 gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <Text className="text-xs text-muted-foreground">
        Müşteriden <Text className="font-extrabold text-foreground">{formatCurrency(custVal)}</Text> tahsil
        edilecek, bunun <Text className="font-extrabold text-foreground">{formatCurrency(supVal)}</Text>{"'"}si{' '}
        {name}{"'"}ye ödenecek.
      </Text>
      {leftover > 0.005 ? (
        <Text className="text-xs font-bold text-amber-600">
          Kalan {formatCurrency(leftover)} tedarikçiye gitmez, işletmede kalır.
        </Text>
      ) : leftover < -0.005 ? (
        <Text className="text-xs font-bold text-destructive">
          Tedarikçiye ödenen, müşteriden alınandan {formatCurrency(-leftover)} fazla!
        </Text>
      ) : null}
    </View>
  )
}

function PaymentSheet({
  visible,
  remaining,
  maxAmount,
  onClose,
  onSubmit,
  initialAmount,
  initialMethod,
  title = 'Müşteriden Tahsilat',
  jobSuppliers = EMPTY_JOB_SUPPLIERS,
}: {
  visible: boolean
  remaining: number
  /** Bu ödemede alınabilecek üst sınır (yeni: kalan; düzenle: kalan + mevcut tutar). */
  maxAmount: number
  onClose: () => void
  onSubmit: (
    amount: number,
    method: 'nakit' | 'kart' | 'havale',
    supplierPay?: { id: string; name: string; amount: number; method: 'nakit' | 'kart' | 'havale' },
  ) => Promise<void>
  initialAmount?: number
  initialMethod?: 'nakit' | 'kart' | 'havale'
  title?: string
  /** Tahsilatta birlikte kaydedilebilecek tedarikçi ödemeleri (sadece yeni tahsilat). */
  jobSuppliers?: JobSupplierPayOption[]
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'nakit' | 'kart' | 'havale'>('nakit')
  const [busy, setBusy] = useState(false)
  const [paySupplierAlso, setPaySupplierAlso] = useState(false)
  const [supplierId, setSupplierId] = useState<string | undefined>()
  const [supplierAmount, setSupplierAmount] = useState('')
  const [supplierMethod, setSupplierMethod] = useState<'nakit' | 'kart' | 'havale'>('nakit')
  /** Tedarikçi tutarı elle değiştirildiyse müşteri tutarıyla senkron kesilir. */
  const [supplierAmountTouched, setSupplierAmountTouched] = useState(false)
  /** Müşteri tutarı elle değiştirildiyse tedarikçi tutarıyla senkron kesilir. */
  const [customerAmountTouched, setCustomerAmountTouched] = useState(false)
  const cap = Math.max(0, Math.round(maxAmount * 100) / 100)
  const canOfferSupplier = title !== 'Ödemeyi Düzenle' && jobSuppliers.length > 0
  const selectedSupplier = jobSuppliers.find((s) => s.id === supplierId) ?? jobSuppliers[0]

  function supplierDefaultFor(customerAmountStr: string, supplier?: JobSupplierPayOption) {
    const cust = Number(String(customerAmountStr).replace(',', '.')) || 0
    const suggest = Math.max(0, supplier?.suggestAmount ?? 0)
    // Tedarikçi varsayılanı = bu işteki alış borcu; müşteri tahsilatını aşmasın.
    const val = Math.min(suggest > 0 ? suggest : cust, cust > 0 ? cust : suggest)
    return val > 0 ? String(Math.round(val * 100) / 100) : ''
  }

  /** "Tedarikçiye de öde" açıkken müşteri varsayılanı = min(kalan, alış borcu).
   *  Böylece 20.000 alış varken 22.850 kalanın tamamı tahsil edilmez. */
  function customerDefaultWithSupplier(remainingSeed: number, supplier?: JobSupplierPayOption) {
    const suggest = Math.max(0, supplier?.suggestAmount ?? 0)
    const base = Math.max(0, remainingSeed)
    const val = suggest > 0 ? Math.min(base, suggest) : base
    return val > 0 ? String(Math.round(val * 100) / 100) : ''
  }

  const wasVisibleRef = useRef(false)
  useEffect(() => {
    // Alanları yalnızca sheet kapalıyken açılırken sıfırla. Sheet açıkken
    // parent'ın tekrar render olması (ör. remaining/jobSuppliers referansı
    // değişmesi) kullanıcının yazdığı/sildiği tutarı geri sıfırlamamalı —
    // aksi halde "Ödemeyi Düzenle" alanında rakam silinemiyor gibi görünür.
    if (visible && !wasVisibleRef.current) {
      const seed = initialAmount ?? (remaining > 0 ? remaining : 0)
      const capped = Math.min(seed, cap)
      const first = jobSuppliers[0]
      const autoSupplier =
        title !== 'Ödemeyi Düzenle' && jobSuppliers.some((s) => s.suggestAmount > 0)
      const seedStr = autoSupplier
        ? customerDefaultWithSupplier(capped, first)
        : capped > 0
          ? String(capped)
          : ''
      setAmount(seedStr)
      setMethod(initialMethod ?? 'nakit')
      setBusy(false)
      setSupplierAmountTouched(false)
      setCustomerAmountTouched(false)
      setPaySupplierAlso(autoSupplier)
      setSupplierId(first?.id)
      // Varsayılan tedarikçi ödemesi = alış borcu (müşteri kalanının tamamı değil)
      setSupplierAmount(supplierDefaultFor(seedStr, first))
      setSupplierMethod(initialMethod ?? 'nakit')
    }
    wasVisibleRef.current = visible
  }, [visible, remaining, initialAmount, initialMethod, cap, jobSuppliers, title])

  function handleCustomerAmountChange(v: string) {
    setCustomerAmountTouched(true)
    setAmount(v)
    if (paySupplierAlso && !supplierAmountTouched) {
      setSupplierAmount(supplierDefaultFor(v, selectedSupplier))
    }
  }

  function handleSupplierAmountChange(v: string) {
    setSupplierAmountTouched(true)
    setSupplierAmount(v)
    // Müşteri tutarı elle dokunulmadıysa tedarikçi tutarıyla hizala (kalanı aşma)
    if (!customerAmountTouched) {
      const sVal = Number(String(v).replace(',', '.')) || 0
      if (sVal > 0) {
        setAmount(String(Math.min(cap, Math.round(sVal * 100) / 100)))
      }
    }
  }

  function pickSupplier(id: string) {
    setSupplierId(id)
    const next = jobSuppliers.find((s) => s.id === id)
    if (!supplierAmountTouched) {
      const nextSup = customerAmountTouched
        ? supplierDefaultFor(amount, next)
        : customerDefaultWithSupplier(cap, next)
      setSupplierAmount(nextSup)
      if (!customerAmountTouched) setAmount(nextSup)
    }
  }

  async function submit() {
    const value = Number(String(amount).replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert('Geçersiz tutar', '0\'dan büyük bir tutar girin.')
      return
    }
    if (value > cap + 0.001) {
      Alert.alert(
        'Tutar fazla',
        `Kalan tutardan (${formatCurrency(cap)}) fazla ödeme alınamaz.`,
      )
      return
    }

    let supplierPay:
      | { id: string; name: string; amount: number; method: 'nakit' | 'kart' | 'havale' }
      | undefined
    if (canOfferSupplier && paySupplierAlso && selectedSupplier) {
      const sVal = Number(String(supplierAmount).replace(',', '.'))
      if (!Number.isFinite(sVal) || sVal <= 0) {
        Alert.alert('Tedarikçi tutarı', 'Tedarikçi ödemesi için 0\'dan büyük tutar girin veya seçeneği kapatın.')
        return
      }
      supplierPay = {
        id: selectedSupplier.id,
        name: selectedSupplier.name,
        amount: Math.round(sVal * 100) / 100,
        method: supplierMethod,
      }
    }

    setBusy(true)
    try {
      await onSubmit(Math.round(value * 100) / 100, method, supplierPay)
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={
        title === 'Ödemeyi Düzenle'
          ? `En fazla: ${formatCurrency(cap)}`
          : `Kalan: ${formatCurrency(remaining)}`
      }
    >
      <TextField
        label="Müşteriden alınan (₺)"
        value={amount}
        onChange={handleCustomerAmountChange}
        inputMode="numeric"
        placeholder="0"
      />
      <Text className="mt-1.5 text-xs text-muted-foreground">
        En fazla {formatCurrency(cap)} alabilirsiniz.
      </Text>
      <Text className="mb-2 mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Tahsilat yöntemi
      </Text>
      <View className="flex-row gap-2">
        {PAY_METHODS.map((m) => {
          const active = method === m.key
          return (
            <Pressable
              key={m.key}
              onPress={() => {
                setMethod(m.key)
                if (paySupplierAlso) setSupplierMethod(m.key)
              }}
              className={cn(
                'h-11 flex-1 items-center justify-center rounded-xl',
                active ? 'bg-primary' : 'bg-secondary',
              )}
            >
              <Text
                className={cn(
                  'text-sm font-bold',
                  active ? 'text-primary-foreground' : 'text-secondary-foreground',
                )}
              >
                {m.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {canOfferSupplier ? (
        <View className="mt-4 rounded-2xl border border-accent/30 bg-accent/10 px-3 py-3">
          <Pressable
            onPress={() => {
              setPaySupplierAlso((v) => {
                const next = !v
                if (next) {
                  // Açılınca varsayılan = alış borcu; müşteri de buna çekilir
                  // (kullanıcı müşteri tutarını elle büyütmediyse).
                  const aligned = customerAmountTouched
                    ? supplierDefaultFor(amount, selectedSupplier)
                    : customerDefaultWithSupplier(cap, selectedSupplier)
                  if (!supplierAmountTouched) setSupplierAmount(aligned)
                  if (!customerAmountTouched) setAmount(aligned)
                  setSupplierMethod(method)
                }
                return next
              })
            }}
            className="flex-row items-center gap-2.5"
          >
            <View
              className={cn(
                'h-5 w-5 items-center justify-center rounded border',
                paySupplierAlso ? 'border-accent bg-accent' : 'border-border bg-card',
              )}
            >
              {paySupplierAlso ? (
                <Check size={12} color={colors.accentForeground} strokeWidth={3} />
              ) : null}
            </View>
            <View className="flex-1">
              <Text className="text-sm font-extrabold text-foreground">Tedarikçiye de öde</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Varsayılan tutar bu işteki alış borcudur; müşteri tahsilatı da buna ayarlanır
              </Text>
            </View>
            <Truck size={18} color={colors.accent} />
          </Pressable>

          {paySupplierAlso ? (
            <View className="mt-3 gap-2">
              {jobSuppliers.length > 1 ? (
                <View className="gap-1.5">
                  <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Tedarikçi
                  </Text>
                  <View className="gap-1.5">
                    {jobSuppliers.map((s) => {
                      const active = selectedSupplier?.id === s.id
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => pickSupplier(s.id)}
                          className={cn(
                            'rounded-xl border px-3 py-2.5',
                            active ? 'border-accent bg-card' : 'border-border bg-card/60',
                          )}
                        >
                          <Text
                            className={cn(
                              'text-sm font-bold',
                              active ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {s.name}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            Bu iş alış borcu: {formatCurrency(s.suggestAmount)}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              ) : selectedSupplier ? (
                <Text className="text-sm font-bold text-foreground">
                  {selectedSupplier.name}
                  <Text className="font-medium text-muted-foreground">
                    {' '}
                    · bu iş alış borcu {formatCurrency(selectedSupplier.suggestAmount)}
                  </Text>
                </Text>
              ) : null}

              <TextField
                label="Tedarikçiye ödenen (₺)"
                value={supplierAmount}
                onChange={handleSupplierAmountChange}
                inputMode="numeric"
                placeholder="0"
              />
              <Text className="text-xs text-muted-foreground">
                Varsayılan bu işteki alış borcudur. Daha fazla tahsilat almak için üstteki
                müşteri tutarını artırın; fark işletmede kalır.
              </Text>
              <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Ödeme yöntemi
              </Text>
              <View className="flex-row gap-2">
                {PAY_METHODS.map((m) => {
                  const active = supplierMethod === m.key
                  return (
                    <Pressable
                      key={m.key}
                      onPress={() => {
                        setSupplierMethod(m.key)
                        setMethod(m.key)
                      }}
                      className={cn(
                        'h-10 flex-1 items-center justify-center rounded-xl border-2',
                        active ? 'border-accent bg-accent' : 'border-border bg-card',
                      )}
                    >
                      <Text
                        className={cn(
                          'text-xs font-bold',
                          active ? 'text-accent-foreground' : 'text-foreground',
                        )}
                      >
                        {m.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <SupplierSplitSummary
                customerAmount={amount}
                supplierAmount={supplierAmount}
                supplierName={selectedSupplier?.name}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={busy}
        className="mt-4 h-12 items-center justify-center rounded-xl bg-primary active:opacity-90"
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text className="text-sm font-extrabold text-primary-foreground">
            {title === 'Ödemeyi Düzenle'
              ? 'Güncelle'
              : paySupplierAlso && canOfferSupplier
                ? 'Tahsilat + Tedarikçi Ödemesi'
                : 'Kaydet'}
          </Text>
        )}
      </Pressable>
      <SheetCancelButton onPress={onClose} />
    </AppSheet>
  )
}

function DiscountSheet({
  visible,
  current,
  maxAmount,
  onClose,
  onSubmit,
}: {
  visible: boolean
  current: number
  maxAmount: number
  onClose: () => void
  onSubmit: (amount: number) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (visible) {
      setAmount(current > 0 ? String(current) : '')
      setBusy(false)
    }
  }, [visible, current])

  async function submit() {
    const value = Number(String(amount).replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      Alert.alert('Geçersiz tutar', 'İskonto 0 veya daha büyük olmalı.')
      return
    }
    if (value > maxAmount) {
      Alert.alert('Geçersiz tutar', `İskonto en fazla ${formatCurrency(maxAmount)} olabilir.`)
      return
    }
    setBusy(true)
    try {
      await onSubmit(value)
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="İskonto"
      subtitle={`En fazla: ${formatCurrency(maxAmount)}`}
    >
      <TextField
        label="İskonto tutarı (₺)"
        value={amount}
        onChange={setAmount}
        inputMode="numeric"
        placeholder="0"
      />
      <Pressable
        onPress={submit}
        disabled={busy}
        className="mt-4 h-12 items-center justify-center rounded-xl bg-primary active:opacity-90"
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text className="text-sm font-extrabold text-primary-foreground">Kaydet</Text>
        )}
      </Pressable>
      {current > 0 && (
        <Pressable
          onPress={async () => {
            setBusy(true)
            try {
              await onSubmit(0)
            } catch (e) {
              showError(e)
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
          className="mt-2 h-11 items-center justify-center rounded-xl bg-secondary"
        >
          <Text className="text-sm font-bold text-secondary-foreground">İskontoyu kaldır</Text>
        </Pressable>
      )}
      <SheetCancelButton onPress={onClose} />
    </AppSheet>
  )
}

function buildIbanShareText(
  info: ShopPaymentInfo,
  vehicle: Vehicle,
  amount: number,
): string {
  const alici = info.accountHolder?.trim() || info.shopName
  const lines = [
    alici ? `Alıcı: ${alici}` : null,
    info.accountHolder?.trim() && info.shopName && info.accountHolder.trim() !== info.shopName
      ? `Servis: ${info.shopName}`
      : null,
    info.bankIban ? `IBAN: ${info.bankIban}` : null,
    info.bankName ? `Banka: ${info.bankName}` : null,
    `Tutar: ${formatCurrency(amount)}`,
    `Plaka: ${vehicle.plate}`,
    `Müşteri: ${vehicle.customer.name}`,
  ]
  return lines.filter(Boolean).join('\n')
}

function IbanShareSheet({
  visible,
  vehicle,
  amount,
  onClose,
}: {
  visible: boolean
  vehicle: Vehicle
  amount: number
  onClose: () => void
}) {
  const [info, setInfo] = useState<ShopPaymentInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    getShopPaymentInfo()
      .then((r) => {
        if (!cancelled) setInfo(r)
      })
      .catch((e) => {
        if (!cancelled) {
          setInfo(null)
          showError(e)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible])

  async function shareText() {
    if (!info?.bankIban) {
      Alert.alert('IBAN tanımlı değil', 'Servis IBAN bilgisi henüz girilmemiş. Yöneticiye bildirin.')
      return
    }
    const message = buildIbanShareText(info, vehicle, amount)
    try {
      await Share.share({ message })
    } catch {
      Alert.alert('Paylaşım kullanılamıyor', 'Bu cihazda paylaşım özelliği bulunamadı.')
    }
  }

  async function shareWhatsApp() {
    if (!info?.bankIban) {
      Alert.alert('IBAN tanımlı değil', 'Servis IBAN bilgisi henüz girilmemiş. Yöneticiye bildirin.')
      return
    }
    const message = buildIbanShareText(info, vehicle, amount)
    const phone = normalizePhoneForWhatsApp(vehicle.customer.phone)
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    const can = await Linking.canOpenURL(url)
    if (!can) {
      Alert.alert('WhatsApp açılamadı', 'WhatsApp yüklü değil veya açılamadı.')
      return
    }
    await Linking.openURL(url)
  }

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="IBAN Paylaş"
      subtitle={`${vehicle.plate} için havale bilgisi`}
    >
      {loading ? (
        <View className="items-center py-6">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          {info?.bankIban ? (
            <View className="mb-3 rounded-2xl bg-secondary px-4 py-3">
              <Text className="text-sm font-bold text-foreground">
                {info.accountHolder?.trim() || info.shopName}
              </Text>
              {info.accountHolder?.trim() && info.shopName ? (
                <Text className="mt-0.5 text-xs text-muted-foreground">{info.shopName}</Text>
              ) : null}
              <Text className="mt-1 font-mono text-sm text-foreground">{info.bankIban}</Text>
              {info.bankName ? (
                <Text className="mt-1 text-xs text-muted-foreground">{info.bankName}</Text>
              ) : null}
              <Text className="mt-2 text-sm font-extrabold text-foreground">
                {formatCurrency(amount)}
              </Text>
            </View>
          ) : (
            <Text className="mb-3 text-sm text-muted-foreground">
              Bu servis için IBAN tanımlı değil. Anasayfadan “IBAN Ekle” ile kaydedin.
            </Text>
          )}
          <SheetActionList
            onClose={onClose}
            actions={[
              {
                key: 'whatsapp',
                label: "WhatsApp'tan Paylaş",
                description: 'Müşteriye IBAN mesajı gönder',
                icon: MessageCircle,
                tone: 'accent',
                onPress: () => {
                  void shareWhatsApp()
                },
              },
              {
                key: 'share',
                label: 'Sistem Paylaşımı',
                description: 'Diğer uygulamalarla gönder',
                icon: Share2,
                tone: 'primary',
                onPress: () => {
                  void shareText()
                },
              },
            ]}
          />
        </>
      )}
    </AppSheet>
  )
}

function AssignmentModal({
  visible,
  staff,
  currentUser,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  staff: StaffMember[]
  currentUser: CurrentUser | null
  onCancel: () => void
  onConfirm: (assignment: { assignedUserId?: string; assignedUserName?: string }) => void
}) {
  const [mode, setMode] = useState<'list' | 'manual'>('list')
  const [selectedId, setSelectedId] = useState(currentUser?.id ?? '')
  const [manualName, setManualName] = useState('')

  useEffect(() => {
    if (!visible) return
    setMode('list')
    setSelectedId(currentUser?.id ?? '')
    setManualName('')
  }, [visible, currentUser?.id])

  function confirm() {
    if (mode === 'manual') {
      if (!manualName.trim()) return
      onConfirm({ assignedUserName: manualName.trim() })
      return
    }
    if (!selectedId) return
    onConfirm({ assignedUserId: selectedId })
  }

  return (
    <AppSheet
      visible={visible}
      onClose={onCancel}
      title="İşi Kim Yapıyor?"
      subtitle="İşleme başlamadan önce sorumlu personeli seçin."
    >
      <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
        <Pressable
          onPress={() => setMode('list')}
          className={cn('flex-1 rounded-xl py-2.5', mode === 'list' && 'bg-card')}
          style={mode === 'list' ? cardShadow : undefined}
        >
          <Text
            className={cn(
              'text-center text-sm font-bold',
              mode === 'list' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            Personelden Seç
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('manual')}
          className={cn('flex-1 rounded-xl py-2.5', mode === 'manual' && 'bg-card')}
          style={mode === 'manual' ? cardShadow : undefined}
        >
          <Text
            className={cn(
              'text-center text-sm font-bold',
              mode === 'manual' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            Manuel Giriş
          </Text>
        </Pressable>
      </View>

      {mode === 'list' ? (
        <ScrollView className="mt-3 max-h-72">
          {staff.length === 0 ? (
            <Text className="px-2 py-4 text-sm text-muted-foreground">
              Kayıtlı personel bulunamadı.
            </Text>
          ) : (
            staff.map((member) => {
              const active = member.id === selectedId
              return (
                <Pressable
                  key={member.id}
                  onPress={() => setSelectedId(member.id)}
                  className={cn(
                    'mt-1 flex-row items-center justify-between rounded-2xl border px-3 py-3.5',
                    active ? 'border-primary/40 bg-primary/5' : 'border-transparent',
                  )}
                >
                  <View>
                    <Text
                      className={cn(
                        'text-base font-semibold',
                        active ? 'text-primary' : 'text-foreground',
                      )}
                    >
                      {member.fullName}
                      {member.id === currentUser?.id ? ' (Ben)' : ''}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {STAFF_ROLE_LABELS[member.role] ?? member.role}
                    </Text>
                  </View>
                  {active && <Check size={20} color={colors.primary} strokeWidth={2.5} />}
                </Pressable>
              )
            })
          )}
        </ScrollView>
      ) : (
        <View className="mt-3">
          <TextField
            label="Ad Soyad"
            value={manualName}
            onChange={setManualName}
            placeholder="Örn: Kemal Usta"
          />
        </View>
      )}

      <View className="mt-4 flex-row gap-2">
        <SaveButton onPress={confirm} />
        <CancelButton onPress={onCancel} />
      </View>
    </AppSheet>
  )
}

const STAFF_ROLE_LABELS: Record<string, string> = {
  admin: 'Yönetici',
  usta: 'Usta',
  personel: 'Personel',
}

const FUEL_OPTIONS = [
  { value: 'benzin', label: 'Benzin' },
  { value: 'dizel', label: 'Dizel' },
  { value: 'lpg', label: 'LPG' },
  { value: 'elektrik', label: 'Elektrik' },
  { value: 'hibrit', label: 'Hibrit' },
  { value: 'diger', label: 'Diğer' },
]

function fuelLabel(code: string) {
  const mapped = mapFuel(code || '')
  return FUEL_OPTIONS.find((o) => o.value === mapped)?.label ?? (code || '-')
}

function InfoTab({
  vehicle,
  onUpdateVehicle,
}: {
  vehicle: Vehicle
  onUpdateVehicle: (data: VehicleInfoPayload, opts?: { ruhsatUri?: string }) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [photosVersion, setPhotosVersion] = useState(0)
  const [ruhsatUri, setRuhsatUri] = useState<string | null>(null)
  const [newRuhsatUri, setNewRuhsatUri] = useState<string | null>(null)

  const [plate, setPlate] = useState(vehicle.plate)
  const [brand, setBrand] = useState(vehicle.brand)
  const [model, setModel] = useState(vehicle.model)
  const [year, setYear] = useState(vehicle.year)
  const [color, setColor] = useState(vehicle.color)
  const [fuel, setFuel] = useState(mapFuel(vehicle.fuel || 'diger'))
  const [chassis, setChassis] = useState(vehicle.chassis)
  const [engineNo, setEngineNo] = useState(vehicle.engineNo)
  const [engineVolume, setEngineVolume] = useState(vehicle.engineVolume)
  const [km, setKm] = useState(vehicle.km)

  function startEdit() {
    setPlate(vehicle.plate)
    setBrand(vehicle.brand)
    setModel(vehicle.model)
    setYear(vehicle.year)
    setColor(vehicle.color)
    setFuel(mapFuel(vehicle.fuel || 'diger'))
    setChassis(vehicle.chassis)
    setEngineNo(vehicle.engineNo)
    setEngineVolume(vehicle.engineVolume)
    setKm(vehicle.km)
    setRuhsatUri(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setRuhsatUri(null)
  }

  async function saveEdit() {
    const missing: string[] = []
    if (!plate.trim()) missing.push('Plaka')
    if (!brand.trim()) missing.push('Marka')
    if (!model.trim()) missing.push('Model')
    if (missing.length > 0) {
      Alert.alert('Eksik bilgi', `Lütfen zorunlu alanları doldurun: ${missing.join(', ')}`)
      return
    }
    setSaving(true)
    try {
      await onUpdateVehicle(
        {
          plate,
          brand,
          model,
          year,
          color,
          fuel,
          chassis,
          engineNo,
          engineVolume,
          km,
        },
        ruhsatUri ? { ruhsatUri } : undefined,
      )
      setEditing(false)
      setRuhsatUri(null)
      setPhotosVersion((n) => n + 1)
    } catch {
      /* hata service-app içinde gösterilir */
    } finally {
      setSaving(false)
    }
  }

  async function addRuhsatPhoto(uri: string) {
    const ok = await attachPhotoAfterSave(vehicle.workOrderId, uri, 'ruhsat')
    if (ok) {
      setNewRuhsatUri(null)
      setPhotosVersion((n) => n + 1)
    }
  }

  async function runRescan(source: 'camera' | 'gallery') {
    try {
      if (getCachedEntitlements()?.features.aiRuhsat === false) {
        Alert.alert('Paket özelliği', 'AI ruhsat okuma bu pakette yok.')
        return
      }
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert(
          'İzin gerekli',
          source === 'camera'
            ? 'Ruhsatı çekmek için kamera iznini verin.'
            : 'Ruhsat fotoğrafını seçmek için galeri iznini verin.',
        )
        return
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 0.45,
              base64: true,
              exif: false,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.45,
              base64: true,
              exif: false,
              allowsMultipleSelection: false,
            })
      if (result.canceled) return
      const asset = result.assets?.[0]
      if (!asset?.base64) {
        Alert.alert('Hata', 'Fotoğraf okunamadı. Lütfen tekrar deneyin.')
        return
      }
      setScanning(true)
      setRuhsatUri(asset.uri)
      const data = await scanRuhsat(asset.base64, asset.mimeType ?? 'image/jpeg')
      if (data.plate) setPlate(data.plate)
      if (data.brand) setBrand(data.brand)
      if (data.model) setModel(data.model)
      if (data.year) setYear(data.year)
      if (data.color) setColor(data.color)
      if (data.fuel) setFuel(mapFuel(data.fuel))
      if (data.chassis) setChassis(data.chassis)
      if (data.engineNo) setEngineNo(data.engineNo)
      if (data.engineVolume) setEngineVolume(data.engineVolume)
      if (!data.plate && !data.brand && !data.model) {
        Alert.alert(
          'Bilgi okunamadı',
          'Ruhsattan bilgi çıkarılamadı. Daha net bir fotoğraf çekin veya bilgileri elle düzeltin.',
        )
      }
    } catch (e) {
      Alert.alert(
        'Ruhsat okunamadı',
        e instanceof Error ? e.message : 'Bilinmeyen bir hata oluştu. Alanları elle düzeltebilirsiniz.',
      )
    } finally {
      setScanning(false)
    }
  }

  const rows = [
    { label: 'Plaka', value: vehicle.plate },
    { label: 'Marka / Model', value: `${vehicle.brand} ${vehicle.model}` },
    { label: 'Model Yılı', value: vehicle.year },
    { label: 'Renk', value: vehicle.color },
    { label: 'Yakıt', value: fuelLabel(vehicle.fuel) },
    { label: 'Kilometre', value: vehicle.km ? `${vehicle.km} km` : '' },
    { label: 'Şasi No', value: vehicle.chassis, mono: true },
    { label: 'Motor No', value: vehicle.engineNo, mono: true },
    { label: 'Motor Hacmi', value: vehicle.engineVolume },
  ]

  return (
    <View className="flex flex-col gap-5">
      {editing ? (
        <View
          className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-card p-4"
          style={cardShadow}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Info size={16} color={colors.primary} />
              <Text className="text-sm font-bold text-muted-foreground">
                Araç Bilgilerini Düzenle
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => setScanOpen(true)}
            disabled={scanning}
            className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary/10"
          >
            {scanning ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Sparkles size={16} color={colors.primary} />
            )}
            <Text className="text-sm font-bold text-primary">
              {scanning ? 'Ruhsat okunuyor...' : 'Ruhsatı tekrar oku'}
            </Text>
          </Pressable>

          <TextField
            label="Plaka"
            value={plate}
            onChange={(v) => setPlate(v.toUpperCase())}
            placeholder="Örn: 34 ABC 123"
            required
          />
          <View className="flex-row gap-3">
            <TextField
              label="Marka"
              value={brand}
              onChange={setBrand}
              placeholder="Örn: Toyota"
              className="flex-1"
              required
            />
            <TextField
              label="Model"
              value={model}
              onChange={setModel}
              placeholder="Örn: Corolla"
              className="flex-1"
              required
            />
          </View>
          <View className="flex-row gap-3">
            <TextField
              label="Yıl"
              value={year}
              onChange={setYear}
              inputMode="numeric"
              placeholder="Örn: 2020"
              className="flex-1"
            />
            <TextField
              label="Renk"
              value={color}
              onChange={setColor}
              placeholder="Örn: Beyaz"
              className="flex-1"
            />
          </View>
          <View className="flex-row gap-3">
            <SelectField
              label="Yakıt"
              value={fuel}
              onChange={setFuel}
              options={FUEL_OPTIONS}
              className="flex-1"
            />
            <TextField
              label="Kilometre"
              value={km}
              onChange={setKm}
              inputMode="numeric"
              placeholder="Örn: 120000"
              className="flex-1"
            />
          </View>
          <TextField
            label="Şasi No"
            value={chassis}
            onChange={(v) => setChassis(v.toUpperCase())}
            placeholder="Örn: WVWZZZ..."
          />
          <View className="flex-row gap-3">
            <TextField
              label="Motor No"
              value={engineNo}
              onChange={setEngineNo}
              placeholder="Örn: CXX..."
              className="flex-1"
            />
            <TextField
              label="Motor Hacmi"
              value={engineVolume}
              onChange={setEngineVolume}
              placeholder="Örn: 1598 cm³"
              className="flex-1"
            />
          </View>

          {ruhsatUri ? (
            <View className="flex-row items-center gap-3">
              <Image source={{ uri: ruhsatUri }} resizeMode="cover" className="h-16 w-16 rounded-xl" />
              <Text className="flex-1 text-xs font-semibold text-muted-foreground">
                Yeni ruhsat fotoğrafı kayıtla birlikte yüklenecek.
              </Text>
            </View>
          ) : null}

          <View className="mt-1 flex-row gap-2">
            <SaveButton onPress={() => void saveEdit()} disabled={saving || scanning} />
            <CancelButton onPress={cancelEdit} />
          </View>
        </View>
      ) : (
        <View className="rounded-2xl border border-border bg-card p-4" style={cardShadow}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Info size={16} color={colors.primary} />
              <Text className="text-sm font-bold text-muted-foreground">
                Araç Bilgileri
              </Text>
            </View>
            <Pressable
              onPress={startEdit}
              className="h-9 flex-row items-center justify-center gap-1.5 rounded-lg bg-secondary px-3"
            >
              <Pencil size={14} color={colors.secondaryForeground} />
              <Text className="text-xs font-bold text-secondary-foreground">Düzenle</Text>
            </Pressable>
          </View>
          <View className="mt-3">
            {rows.map((r, i) => (
              <View
                key={r.label}
                className={cn(
                  'flex-row items-center justify-between py-2.5',
                  i > 0 && 'border-t border-border',
                )}
              >
                <Text className="text-sm text-muted-foreground">{r.label}</Text>
                <Text
                  className={cn(
                    'ml-3 flex-1 text-right text-sm font-bold text-foreground',
                    r.mono && 'font-mono text-xs',
                  )}
                >
                  {r.value || '-'}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className="rounded-2xl border border-border bg-card p-4" style={cardShadow}>
        <View className="flex-row items-center gap-2">
          <Phone size={16} color={colors.primary} />
          <Text className="text-sm font-bold text-muted-foreground">Müşteri</Text>
        </View>
        <Text className="mt-3 text-lg font-extrabold text-foreground">
          {vehicle.customer.name}
        </Text>
        <Pressable
          onPress={() =>
            Linking.openURL(`tel:${vehicle.customer.phone.replace(/\s/g, '')}`)
          }
          className="mt-2 flex-row items-center gap-2"
        >
          <Phone size={16} color={colors.primary} />
          <Text className="text-sm font-semibold text-primary">
            {vehicle.customer.phone}
          </Text>
        </Pressable>
        {vehicle.customer.address ? (
          <View className="mt-1.5 flex-row items-center gap-2">
            <MapPin size={16} color={colors.mutedForeground} />
            <Text className="text-sm text-muted-foreground">
              {vehicle.customer.address}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="rounded-2xl border border-border bg-card p-4" style={cardShadow}>
        <Text className="text-sm font-bold text-muted-foreground">Ruhsat fotoğrafı</Text>
        <PhotoGallery
          workOrderId={vehicle.workOrderId}
          imageType="ruhsat"
          refreshKey={photosVersion}
          editable
        />
        <PhotoPicker
          uri={newRuhsatUri}
          onPick={(uri) => void addRuhsatPhoto(uri)}
          onClear={() => setNewRuhsatUri(null)}
        />
      </View>

      <AppSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Ruhsatı tekrar oku"
        subtitle="Yeni fotoğraf çekin veya galeriden seçin. Okunan bilgiler forma doldurulur."
      >
        <SheetActionList
          onClose={() => setScanOpen(false)}
          actions={[
            {
              key: 'camera',
              label: 'Kamera',
              description: 'Ruhsatı yeniden çek',
              icon: Camera,
              tone: 'accent',
              onPress: () => void runRescan('camera'),
            },
            {
              key: 'gallery',
              label: 'Galeri',
              description: 'Kayıtlı fotoğraftan oku',
              icon: ImagePlus,
              tone: 'primary',
              onPress: () => void runRescan('gallery'),
            },
          ]}
        />
        <SheetCancelButton onPress={() => setScanOpen(false)} />
      </AppSheet>
    </View>
  )
}

const COMPLAINT_CATEGORY_OPTIONS = COMPLAINT_CATEGORY_ORDER.map((value) => ({
  value,
  label: COMPLAINT_CATEGORY_LABELS[value],
}))

function groupComplaintsByCategory(complaints: Complaint[]) {
  const map = new Map<ComplaintCategory, Complaint[]>()
  for (const c of complaints) {
    const key = c.category || 'diger'
    const list = map.get(key)
    if (list) list.push(c)
    else map.set(key, [c])
  }
  return COMPLAINT_CATEGORY_ORDER.filter((k) => map.has(k)).map((category) => ({
    category,
    label: COMPLAINT_CATEGORY_LABELS[category],
    items: map.get(category)!,
  }))
}

function ComplaintTab({
  vehicle,
  onAdd,
  onUpdate,
  onDelete,
}: {
  vehicle: Vehicle
  onAdd: (text: string, category: ComplaintCategory) => Promise<string | undefined>
  onUpdate: (complaintId: string, text: string, category: ComplaintCategory) => void
  onDelete: (complaintId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [category, setCategory] = useState<ComplaintCategory>('diger')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editCategory, setEditCategory] = useState<ComplaintCategory>('diger')
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null)
  const [photosVersion, setPhotosVersion] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function save() {
    if (!text.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen şikayet alanını doldurun.')
      return
    }
    const newComplaintId = await onAdd(text.trim(), category)
    const uploaded = await attachPhotoAfterSave(vehicle.workOrderId, photoUri, 'hasar', {
      complaintId: newComplaintId,
    })
    if (uploaded && photoUri) setPhotosVersion((v) => v + 1)
    setText('')
    setCategory('diger')
    setPhotoUri(null)
    setOpen(false)
  }

  function startEdit(c: Complaint) {
    setEditingId(c.id)
    setEditText(c.text)
    setEditCategory(c.category || 'diger')
    setEditPhotoUri(null)
  }

  async function saveEdit() {
    if (!editText.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen şikayet alanını doldurun.')
      return
    }
    if (editingId) {
      onUpdate(editingId, editText.trim(), editCategory)
      const uploaded = await attachPhotoAfterSave(vehicle.workOrderId, editPhotoUri, 'hasar', {
        complaintId: editingId,
      })
      if (uploaded && editPhotoUri) setPhotosVersion((v) => v + 1)
    }
    setEditingId(null)
    setEditText('')
    setEditCategory('diger')
    setEditPhotoUri(null)
  }

  const groups = groupComplaintsByCategory(vehicle.complaints)

  return (
    <View className="flex flex-col gap-3">
      {vehicle.complaints.length === 0 && !open && (
        <EmptyState icon={MessageSquareWarning} text="Henüz şikayet / istek eklenmedi." />
      )}

      {groups.map((g) => (
        <View key={g.category} className="gap-2">
          <View className="flex-row items-center justify-between px-0.5">
            <Text className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </Text>
            <Text className="text-xs font-semibold text-muted-foreground">
              {g.items.length} kayıt
            </Text>
          </View>
          {g.items.map((c) =>
            editingId === c.id ? (
              <View
                key={c.id}
                className="rounded-2xl border-2 border-primary/30 bg-card p-4"
                style={cardShadow}
              >
                <SelectField
                  label="Kategori"
                  value={editCategory}
                  onChange={(v) => setEditCategory(v as ComplaintCategory)}
                  options={COMPLAINT_CATEGORY_OPTIONS}
                />
                <View className="mt-3">
                  <TextArea
                    label="Şikayet / İstek"
                    value={editText}
                    onChange={setEditText}
                    rows={4}
                  />
                </View>
                <View className="mt-3">
                  <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Fotoğraflar
                  </Text>
                  <PhotoGallery
                    workOrderId={vehicle.workOrderId}
                    imageType="hasar"
                    complaintId={c.id}
                    refreshKey={photosVersion}
                    editable
                  />
                  <View className="mt-2">
                    <PhotoPicker
                      uri={editPhotoUri}
                      onPick={setEditPhotoUri}
                      onClear={() => setEditPhotoUri(null)}
                    />
                  </View>
                </View>
                <View className="mt-3 flex-row gap-2">
                  <SaveButton onPress={() => void saveEdit()} />
                  <CancelButton
                    onPress={() => {
                      setEditingId(null)
                      setEditPhotoUri(null)
                    }}
                  />
                </View>
              </View>
            ) : confirmDeleteId === c.id ? (
              <View
                key={c.id}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-3"
              >
                <View className="flex-1 pl-1">
                  <Text className="text-sm font-bold text-foreground">Silinsin mi?</Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
                    {c.text}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    onDelete(c.id)
                    setConfirmDeleteId(null)
                  }}
                  className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl bg-destructive px-4"
                >
                  <Trash2 size={16} color={colors.destructiveForeground} />
                  <Text className="text-sm font-bold text-destructive-foreground">Sil</Text>
                </Pressable>
                <Pressable
                  onPress={() => setConfirmDeleteId(null)}
                  className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
                >
                  <X size={20} color={colors.secondaryForeground} />
                </Pressable>
              </View>
            ) : (
              <View
                key={c.id}
                className="rounded-2xl border border-border bg-card p-4"
                style={cardShadow}
              >
                <View className="flex-row items-start gap-3">
                  <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
                    <MessageSquareWarning size={16} color={colors.accent} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold uppercase tracking-wide text-accent">
                      {COMPLAINT_CATEGORY_LABELS[c.category] ?? 'Diğer'}
                    </Text>
                    <Text className="mt-1 text-sm font-medium leading-relaxed text-foreground">
                      {c.text}
                    </Text>
                    <Text className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <Pressable
                      onPress={() => startEdit(c)}
                      className="h-9 w-9 items-center justify-center rounded-lg bg-secondary"
                    >
                      <Pencil size={14} color={colors.secondaryForeground} />
                    </Pressable>
                    <Pressable
                      onPress={() => setConfirmDeleteId(c.id)}
                      className="h-9 w-9 items-center justify-center rounded-lg bg-destructive/10"
                    >
                      <Trash2 size={14} color={colors.destructive} />
                    </Pressable>
                  </View>
                </View>
                <View className="mt-3">
                  <PhotoGallery
                    workOrderId={vehicle.workOrderId}
                    imageType="hasar"
                    complaintId={c.id}
                    refreshKey={photosVersion}
                  />
                </View>
              </View>
            ),
          )}
        </View>
      ))}

      <PhotoGallery
        workOrderId={vehicle.workOrderId}
        imageType="hasar"
        heading="Diğer Fotoğraflar"
        refreshKey={photosVersion}
      />

      {open ? (
        <View className="rounded-2xl border border-border bg-card p-4" style={cardShadow}>
          <SelectField
            label="Kategori"
            value={category}
            onChange={(v) => setCategory(v as ComplaintCategory)}
            options={COMPLAINT_CATEGORY_OPTIONS}
          />
          <View className="mt-3">
            <TextArea
              label="Yeni Şikayet / İstek"
              value={text}
              onChange={setText}
              rows={4}
              placeholder="Müşterinin belirttiği arıza veya talebi..."
            />
          </View>
          <PhotoPicker uri={photoUri} onPick={setPhotoUri} onClear={() => setPhotoUri(null)} />
          <View className="mt-3 flex-row gap-2">
            <SaveButton onPress={() => void save()} />
            <CancelButton
              onPress={() => {
                setOpen(false)
                setText('')
                setCategory('diger')
                setPhotoUri(null)
              }}
            />
          </View>
        </View>
      ) : (
        editingId === null && (
          <AddButton label="Şikayet / İstek Ekle" onPress={() => setOpen(true)} />
        )
      )}
    </View>
  )
}

function ServiceTab({
  vehicle,
  catalog,
  onAdd,
  onUpdate,
  onDelete,
}: {
  vehicle: Vehicle
  catalog: ServiceCatalogItem[]
  onAdd: (s: Omit<ServiceItem, 'id'>, force?: boolean) => Promise<string | undefined>
  onUpdate: (id: string, s: Omit<ServiceItem, 'id'>) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [photosVersion, setPhotosVersion] = useState(0)

  function reset() {
    setTitle('')
    setPrice('')
    setPhotoUri(null)
    setOpen(false)
    setEditingId(null)
  }

  function startAdd() {
    setEditingId(null)
    setTitle('')
    setPrice('')
    setPhotoUri(null)
    setOpen(true)
  }

  function startEdit(s: ServiceItem) {
    setOpen(false)
    setEditingId(s.id)
    setTitle(s.title)
    setPrice(String(s.price))
  }

  async function commit(priceNum: number, force = false) {
    const data = { title: title.trim(), price: priceNum }
    try {
      if (editingId) {
        onUpdate(editingId, data)
      } else {
        const pendingPhoto = photoUri
        const newServiceId = await onAdd(data, force)
        const uploaded = await attachPhotoAfterSave(vehicle.workOrderId, pendingPhoto, 'diger', {
          serviceId: newServiceId,
        })
        if (uploaded && pendingPhoto) setPhotosVersion((v) => v + 1)
      }
      reset()
    } catch (e) {
      if (!force && e instanceof WorkOrderCompletedError) {
        Alert.alert('Bu iş tamamlandı', 'Bu işe ürün/işlem eklemek istediğinize emin misiniz?', [
          { text: 'İptal', style: 'cancel' },
          { text: 'Evet, Ekle', onPress: () => commit(priceNum, true) },
        ])
      } else {
        showError(e)
      }
    }
  }

  function save() {
    if (!title.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen işlem adı alanını doldurun.')
      return
    }
    const priceNum = Number(price) || 0
    if (priceNum === 0) {
      Alert.alert('Fiyat girilmedi', 'Fiyat girmeden kaydetmek istediğinize emin misiniz?', [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet, Kaydet', onPress: () => commit(priceNum) },
      ])
      return
    }
    commit(priceNum)
  }

  const fields = (
    <>
      <ServiceSuggestions
        catalog={catalog}
        onPick={(s) => {
          setTitle(s.name)
          setPrice(String(s.price))
        }}
      />
      <TextField label="Yapılan İşlem" value={title} onChange={setTitle} placeholder="Örn: Yağ değişimi" />
      <TextField label="İşçilik Ücreti (₺)" value={price} onChange={setPrice} inputMode="numeric" placeholder="0" />
      <PhotoPicker uri={photoUri} onPick={setPhotoUri} onClear={() => setPhotoUri(null)} />
    </>
  )

  return (
    <View className="flex flex-col gap-3">
      {vehicle.services.length === 0 && !open && (
        <EmptyState icon={Wrench} text="Henüz işlem eklenmedi." />
      )}

      {vehicle.services.map((s) =>
        editingId === s.id ? (
          <ItemForm key={s.id} onSave={save} onCancel={reset} fields={fields} />
        ) : (
          <Row
            key={s.id}
            icon={Wrench}
            title={s.title}
            value={formatCurrency(s.price)}
            confirming={confirmId === s.id}
            onEdit={() => startEdit(s)}
            onDelete={() => setConfirmId(s.id)}
            onConfirmDelete={() => {
              onDelete(s.id)
              setConfirmId(null)
            }}
            onCancelDelete={() => setConfirmId(null)}
            footer={
              <PhotoGallery
                workOrderId={vehicle.workOrderId}
                imageType="diger"
                serviceId={s.id}
                refreshKey={photosVersion}
              />
            }
          />
        ),
      )}

      <PhotoGallery
        workOrderId={vehicle.workOrderId}
        imageType="diger"
        heading="İşlem fotoğrafları"
        showAllOfType
        refreshKey={photosVersion}
      />

      {open ? (
        <ItemForm onSave={save} onCancel={reset} fields={fields} />
      ) : (
        editingId === null && <AddButton label="İşlem Ekle" onPress={startAdd} />
      )}
    </View>
  )
}

type PdfEditLine = InvoiceScanLine & {
  id: string
  selected: boolean
  salePrice: number
  match?: StockMatchState
}

function newPdfLineId() {
  return Math.random().toString(36).slice(2, 10)
}

function ProductTab({
  vehicle,
  onAdd,
  onUpdate,
  onDelete,
  onReturnToSupplier,
}: {
  vehicle: Vehicle
  onAdd: (p: Omit<ProductItem, 'id'>, force?: boolean) => Promise<void>
  onUpdate: (id: string, p: Omit<ProductItem, 'id'>) => void | Promise<void>
  onDelete: (id: string) => void
  onReturnToSupplier: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [returnConfirmId, setReturnConfirmId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [productCode, setProductCode] = useState('')
  const [codeHits, setCodeHits] = useState<StockProductLite[]>([])
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [source, setSource] = useState<'stok' | 'disaridan'>('stok')
  const [stockProductId, setStockProductId] = useState<string | undefined>(undefined)
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined)
  const [supplierName, setSupplierName] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  /** Satış (birim fiyat) elle değiştirildiyse alış ile senkron kesilir. */
  const [saleTouched, setSaleTouched] = useState(false)
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [photosVersion, setPhotosVersion] = useState(0)
  const [pdfScanning, setPdfScanning] = useState(false)
  const [pdfSaving, setPdfSaving] = useState(false)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfLines, setPdfLines] = useState<PdfEditLine[]>([])
  const [pdfMatchSheetId, setPdfMatchSheetId] = useState<string | null>(null)
  const [paySupplier, setPaySupplier] = useState<{
    id: string
    name: string
    suggestAmount: number
  } | null>(null)
  const rematchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function reset() {
    setName('')
    setProductCode('')
    setCodeHits([])
    setQty('1')
    setPrice('')
    setSource('stok')
    setStockProductId(undefined)
    setSupplierId(undefined)
    setSupplierName('')
    setPurchasePrice('')
    setSaleTouched(false)
    setPhotoUri(null)
    setOpen(false)
    setEditingId(null)
  }

  function startAdd() {
    setEditingId(null)
    setName('')
    setProductCode('')
    setCodeHits([])
    setQty('1')
    setPrice('')
    setSource('stok')
    setStockProductId(undefined)
    setSupplierId(undefined)
    setSupplierName('')
    setPurchasePrice('')
    setSaleTouched(false)
    setPhotoUri(null)
    setOpen(true)
  }

  function startEdit(p: ProductItem) {
    setOpen(false)
    setEditingId(p.id)
    setName(p.name)
    setProductCode(p.manufacturerCode || p.supplierCode || '')
    setQty(String(p.quantity))
    setPrice(String(p.price))
    setSource(p.source ?? 'stok')
    setStockProductId(undefined)
    setSupplierId(p.supplierId)
    setSupplierName(p.supplierName ?? '')
    setPurchasePrice(p.purchasePrice != null ? String(p.purchasePrice) : String(p.price))
    setSaleTouched(
      p.purchasePrice != null && Number(p.purchasePrice) !== Number(p.price),
    )
  }

  /** Alış değişince satış henüz elle değiştirilmediyse aynı kalır (stok PDF akışı gibi). */
  function handlePurchaseChange(v: string) {
    setPurchasePrice(v)
    if (!saleTouched) setPrice(v)
  }

  function handlePriceChange(v: string) {
    setPrice(v)
    if (source === 'disaridan') setSaleTouched(true)
  }

  function handleNameChange(v: string) {
    setName(v)
    if (stockProductId) setStockProductId(undefined)
  }

  function handleProductCodeChange(v: string) {
    setProductCode(v)
    if (stockProductId) setStockProductId(undefined)
  }

  function applyCodeHit(s: StockProductLite) {
    setName(s.name)
    setProductCode(s.code?.trim() || productCode)
    setPrice(String(s.price))
    setPurchasePrice(String(s.purchasePrice ?? s.price))
    setSaleTouched(false)
    setStockProductId(s.id)
    setCodeHits([])
  }

  useEffect(() => {
    const q = productCode.trim()
    if (stockProductId || q.length < 2) {
      setCodeHits([])
      return
    }
    let active = true
    const t = setTimeout(() => {
      listStockProducts(q)
        .then((rows) => {
          if (!active) return
          const norm = (s?: string) => (s || '').replace(/[\s\-_.]/g, '').toLowerCase()
          const qn = norm(q)
          const exact = rows.filter((r) => norm(r.code) === qn)
          setCodeHits((exact.length ? exact : rows).slice(0, 5))
        })
        .catch(() => {
          if (active) setCodeHits([])
        })
    }, 280)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [productCode, stockProductId])

  useEffect(() => {
    if (source !== 'disaridan' || !supplierId || stockProductId || productCode.trim().length < 2) return
    let active = true
    const t = setTimeout(() => {
      matchStockLinesApi(supplierId, [
        { index: 0, name, rawCode: productCode.trim() },
      ])
        .then((results) => {
          if (!active) return
          const r = results[0]
          const extra = (r?.candidates ?? []).map((c) => ({
            id: c.stockId,
            name: c.name,
            price: c.price,
            quantity: c.quantity,
            code: c.code,
          }))
          if (extra.length === 0) return
          setCodeHits((prev) => {
            const seen = new Set(prev.map((p) => p.id))
            return [...prev, ...extra.filter((e) => !seen.has(e.id))].slice(0, 5)
          })
          if (r?.status === 'exact' && extra[0] && !name.trim()) setName(extra[0].name)
        })
        .catch(() => {
          /* katalog araması zaten gösteriliyor */
        })
    }, 400)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [productCode, supplierId, source, stockProductId, name])

  async function pickAndScanPdf() {
    if (!supplierId) {
      Alert.alert('Tedarikçi', 'Önce tedarikçi seçin.')
      return
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (picked.canceled || !picked.assets?.[0]) return

      setPdfScanning(true)
      const asset = picked.assets[0]
      const base64 = await readUriAsBase64(asset.uri)
      const result = await scanInvoiceApi(base64, asset.mimeType ?? 'application/pdf')
      if (!result.lines.length) {
        Alert.alert('PDF', 'PDF’den ürün satırı okunamadı.')
        return
      }
      const mapped: PdfEditLine[] = result.lines.map((l) => {
        const codes = applyPdfLineCodes(l.name, l.code, l.brand)
        return {
          ...l,
          name: codes.name,
          code: codes.rawCode,
          brand: codes.brand ?? l.brand,
          id: newPdfLineId(),
          selected: true,
          salePrice: l.unitPrice,
          match: matchStateFromResult(undefined, codes.rawCode, codes.brand),
        }
      })
      try {
        const results = await matchStockLinesApi(
          supplierId,
          mapped.map((l, i) => ({ index: i, name: l.name, rawCode: l.code, brand: l.brand })),
        )
        const byIndex = new Map(results.map((r) => [r.index, r]))
        setPdfLines(
          mapped.map((l, i) => ({
            ...l,
            match: matchStateFromResult(byIndex.get(i), l.code, l.brand),
          })),
        )
      } catch {
        setPdfLines(
          mapped.map((l) => ({
            ...l,
            match: matchStateFromResult(undefined, l.code, l.brand),
          })),
        )
      }
      setPdfOpen(true)
    } catch (e) {
      showError(e)
    } finally {
      setPdfScanning(false)
    }
  }

  function updatePdfLine(id: string, patch: Partial<PdfEditLine>) {
    setPdfLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function decidePdfLine(id: string, decision: StockMatchDecision) {
    setPdfLines((prev) =>
      prev.map((l) => (l.id === id && l.match ? { ...l, match: { ...l.match, decision } } : l)),
    )
  }

  function setPdfManufacturerCode(id: string, code: string) {
    setPdfLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              match: l.match
                ? { ...l.match, manufacturerCode: code }
                : matchStateFromResult(undefined, code, l.brand),
            }
          : l,
      ),
    )
  }

  function schedulePdfRematch(id: string, rawCode: string, lineName: string, brand?: string) {
    if (!supplierId) return
    if (rematchTimer.current) clearTimeout(rematchTimer.current)
    rematchTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const results = await matchStockLinesApi(supplierId, [
            { index: 0, name: lineName, rawCode: rawCode || undefined, brand },
          ])
          const r = results[0]
          setPdfLines((prev) =>
            prev.map((l) => {
              if (l.id !== id) return l
              const next = matchStateFromResult(r, rawCode, brand)
              return {
                ...l,
                match: {
                  ...next,
                  manufacturerCode: l.match?.manufacturerCode || next.manufacturerCode,
                  rawCode: l.match?.rawCode || next.rawCode,
                },
              }
            }),
          )
        } catch {
          /* eşleştirme hatası satırı bozmasın */
        }
      })()
    }, 400)
  }

  async function savePdfLines(force = false) {
    if (!supplierId) return
    const toSave = pdfLines.filter((l) => l.selected && l.name.trim().length >= 2)
    if (toSave.length === 0) {
      Alert.alert('Satır yok', 'En az bir ürün seçin / ad girin.')
      return
    }
    setPdfSaving(true)
    setPdfOpen(false)
    setPdfMatchSheetId(null)
    setOpen(false)
    // Web Modal overlay'inin kalkması için kayıt öncesi unmount'u işle.
    await new Promise((r) => setTimeout(r, Platform.OS === 'web' ? 50 : 0))
    try {
      for (const l of toSave) {
        const unit = Number(l.unitPrice) || 0
        const sale = l.salePrice > 0 ? Number(l.salePrice) : unit
        const d = l.match?.decision
        const consume = d?.kind === 'existing' && d.consumeStock
        const matchedName = d?.kind === 'existing' ? d.name : l.name.trim()
        await onAdd(
          {
            name: matchedName,
            quantity: Math.max(1, l.quantity),
            price: sale,
            source: consume ? 'stok' : 'disaridan',
            stockProductId: consume && d?.kind === 'existing' ? d.stockId : undefined,
            supplierId: consume ? undefined : supplierId,
            supplierName: consume ? undefined : supplierName || undefined,
            purchasePrice: unit,
            supplierCode: l.match?.rawCode || l.code,
            matchedStockProductId:
              !consume && d?.kind === 'existing' ? d.stockId : undefined,
            manufacturerCode: l.match?.manufacturerCode,
            brand: l.brand,
          },
          force,
        )
      }
      setPdfLines([])
      reset()
    } catch (e) {
      setPdfOpen(true)
      setOpen(true)
      if (!force && e instanceof WorkOrderCompletedError) {
        Alert.alert('Bu iş tamamlandı', 'Bu işe ürün eklemek istediğinize emin misiniz?', [
          { text: 'İptal', style: 'cancel' },
          { text: 'Evet, Ekle', onPress: () => void savePdfLines(true) },
        ])
      } else {
        showError(e)
      }
    } finally {
      setPdfSaving(false)
    }
  }

  async function commit(priceNum: number, force = false) {
    const purchaseNum =
      source === 'disaridan'
        ? Number(purchasePrice) || priceNum
        : undefined
    const data: Omit<ProductItem, 'id'> = {
      name: name.trim(),
      quantity: Number(qty) || 1,
      price: priceNum,
      source,
      stockProductId: source === 'stok' ? stockProductId : undefined,
      supplierId: source === 'disaridan' ? supplierId : undefined,
      supplierName: source === 'disaridan' ? supplierName : undefined,
      purchasePrice: purchaseNum,
      supplierCode: productCode.trim() || undefined,
      manufacturerCode: productCode.trim() || undefined,
      matchedStockProductId:
        source === 'disaridan' && stockProductId ? stockProductId : undefined,
    }
    try {
      if (editingId) {
        await onUpdate(editingId, data)
      } else {
        const pendingPhoto = photoUri
        await onAdd(data, force)
        const uploaded = await attachPhotoAfterSave(vehicle.workOrderId, pendingPhoto, 'arac')
        if (uploaded && pendingPhoto) setPhotosVersion((v) => v + 1)
      }
      reset()
    } catch (e) {
      if (!force && e instanceof WorkOrderCompletedError) {
        Alert.alert('Bu iş tamamlandı', 'Bu işe ürün/işlem eklemek istediğinize emin misiniz?', [
          { text: 'İptal', style: 'cancel' },
          { text: 'Evet, Ekle', onPress: () => commit(priceNum, true) },
        ])
      } else {
        showError(e)
      }
    }
  }

  function save() {
    if (!name.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen ürün/parça adı alanını doldurun.')
      return
    }
    if (source === 'disaridan' && !supplierId) {
      Alert.alert('Tedarikçi seçin', 'Dışarıdan alım için önce tedarikçi seçin, sonra kaydedin.')
      return
    }
    const priceNum = Number(price) || 0
    if (priceNum === 0) {
      Alert.alert('Fiyat girilmedi', 'Fiyat girmeden kaydetmek istediğinize emin misiniz?', [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet, Kaydet', onPress: () => commit(priceNum) },
      ])
      return
    }
    commit(priceNum)
  }

  const canSave = name.trim().length > 0 && (source === 'stok' || !!supplierId)
  const pdfMatchLine = pdfMatchSheetId
    ? pdfLines.find((x) => x.id === pdfMatchSheetId)
    : undefined

  const formFields = (
    <>
      <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
        <Pressable
          onPress={() => {
            setSource('stok')
            setSupplierId(undefined)
            setSupplierName('')
            setSaleTouched(false)
          }}
          className={cn('flex-1 rounded-xl py-2.5', source === 'stok' && 'bg-card')}
          style={source === 'stok' ? cardShadow : undefined}
        >
          <Text
            className={cn(
              'text-center text-sm font-bold',
              source === 'stok' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            Stoktan Kullanıldı
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSource('disaridan')
            setSaleTouched(false)
            if (purchasePrice === '' && price) setPurchasePrice(price)
            if (price === '' && purchasePrice) setPrice(purchasePrice)
          }}
          className={cn('flex-1 rounded-xl py-2.5', source === 'disaridan' && 'bg-card')}
          style={source === 'disaridan' ? cardShadow : undefined}
        >
          <Text
            className={cn(
              'text-center text-sm font-bold',
              source === 'disaridan' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            Dışarıdan Alındı
          </Text>
        </Pressable>
      </View>

      {source === 'disaridan' ? (
        <View className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5">
          <Text className="text-xs font-bold text-accent">İki ayrı para akışı</Text>
          <Text className="mt-1 text-[11px] leading-4 text-muted-foreground">
            · Alış → tedarikçi carisine borç yazılır (siz tedarikçiye ödersiniz).{'\n'}
            · Satış → müşteri iş emri tutarına eklenir (müşteriden tahsil edersiniz).
          </Text>
        </View>
      ) : null}

      {source === 'stok' && (
        <StockCatalogPicker
          onPick={(s) => {
            setName(s.name)
            setProductCode(s.code?.trim() || '')
            setPrice(String(s.price))
            setPurchasePrice(String(s.purchasePrice ?? s.price))
            setSaleTouched(false)
            setStockProductId(s.id)
            setCodeHits([])
          }}
        />
      )}

      {source === 'disaridan' && (
        <>
          <SupplierPicker
            selectedId={supplierId}
            selectedName={supplierName}
            onSelect={(s) => {
              setSource('disaridan')
              setSupplierId(s.id)
              setSupplierName(s.name)
            }}
            onClear={() => {
              setSupplierId(undefined)
              setSupplierName('')
            }}
          />
          {getCachedEntitlements()?.features.aiInvoice ? (
            <>
              <Pressable
                onPress={() => void pickAndScanPdf()}
                disabled={pdfScanning || !supplierId}
                className={cn(
                  'h-12 flex-row items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10',
                  (!supplierId || pdfScanning) && 'opacity-50',
                )}
              >
                {pdfScanning ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <FileText size={18} color={colors.primary} />
                    <Text className="text-sm font-extrabold text-primary">PDF’den Ekle</Text>
                  </>
                )}
              </Pressable>
              {!supplierId ? (
                <Text className="text-xs text-muted-foreground">
                  PDF okumak için önce tedarikçi seçin.
                </Text>
              ) : null}
            </>
          ) : (
            <Text className="text-xs text-muted-foreground">
              AI ürün / fatura okuma yalnızca Kurumsal pakette vardır.
            </Text>
          )}
        </>
      )}

      <TextField
        label="Ürün Kodu (isteğe bağlı)"
        value={productCode}
        onChange={handleProductCodeChange}
        placeholder="Örn. APS 14"
      />
      {codeHits.length > 0 ? (
        <View className="overflow-hidden rounded-xl border border-primary/25 bg-primary/5">
          <Text className="px-3 pt-2 text-[11px] font-bold text-primary">
            Stokta bu koda yakın ürün — dokunarak seç
          </Text>
          {codeHits.map((s, idx) => (
            <Pressable
              key={s.id}
              onPress={() => applyCodeHit(s)}
              className={cn(
                'flex-row items-center justify-between px-3 py-2.5',
                idx < codeHits.length - 1 && 'border-b border-border',
              )}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                  {s.name}
                </Text>
                {s.code ? (
                  <Text className="text-[11px] font-bold text-muted-foreground">{s.code}</Text>
                ) : null}
              </View>
              <Text className="text-xs font-bold text-muted-foreground">{formatCurrency(s.price)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextField
        label="Ürün / Parça Adı"
        value={name}
        onChange={handleNameChange}
        placeholder="Örn: Motor yağı 5W-30"
        required
      />
      <View className="flex-row gap-3">
        <TextField
          label="Adet"
          value={qty}
          onChange={setQty}
          inputMode="numeric"
          placeholder="1"
          className="flex-1"
        />
        {source === 'disaridan' ? (
          <TextField
            label="Alış (tedarikçiye) ₺"
            value={purchasePrice}
            onChange={handlePurchaseChange}
            inputMode="numeric"
            placeholder="0"
            className="flex-1"
          />
        ) : (
          <TextField
            label="Birim Fiyat (₺)"
            value={price}
            onChange={handlePriceChange}
            inputMode="numeric"
            placeholder="0"
            className="flex-1"
          />
        )}
      </View>
      {source === 'disaridan' && (
        <>
          <TextField
            label="Satış (müşteriye) ₺"
            value={price}
            onChange={handlePriceChange}
            inputMode="numeric"
            placeholder="Alış ile aynı (değiştirilebilir)"
          />
          {!!purchasePrice && !!qty && (
            <Text className="text-[11px] text-muted-foreground">
              Cariye borç: {formatCurrency((Number(purchasePrice) || 0) * (Number(qty) || 1))} ·
              Müşteriye satış:{' '}
              {formatCurrency((Number(price) || 0) * (Number(qty) || 1))}
            </Text>
          )}
        </>
      )}

      <PhotoPicker uri={photoUri} onPick={setPhotoUri} onClear={() => setPhotoUri(null)} />
    </>
  )

  return (
    <View className="flex flex-col gap-3">
      {vehicle.products.length === 0 && !open && (
        <EmptyState icon={Package} text="Henüz ürün/parça eklenmedi." />
      )}

      {vehicle.products.map((p) =>
        editingId === p.id ? (
          <ItemForm key={p.id} onSave={save} onCancel={reset} fields={formFields} disabled={!canSave} />
        ) : (
          <ProductRow
            key={p.id}
            product={p}
            confirming={confirmId === p.id}
            returnConfirming={returnConfirmId === p.id}
            onEdit={() => startEdit(p)}
            onDelete={() => setConfirmId(p.id)}
            onConfirmDelete={() => {
              onDelete(p.id)
              setConfirmId(null)
            }}
            onCancelDelete={() => setConfirmId(null)}
            onRequestReturn={() => setReturnConfirmId(p.id)}
            onConfirmReturn={() => {
              onReturnToSupplier(p.id)
              setReturnConfirmId(null)
            }}
            onCancelReturn={() => setReturnConfirmId(null)}
            onPaySupplier={
              p.source === 'disaridan' && p.supplierId && !p.returnedAt
                ? () =>
                    setPaySupplier({
                      id: p.supplierId!,
                      name: p.supplierName ?? 'Tedarikçi',
                      suggestAmount: (p.purchasePrice ?? 0) * p.quantity,
                    })
                : undefined
            }
          />
        ),
      )}

      <PhotoGallery
        workOrderId={vehicle.workOrderId}
        imageType="arac"
        refreshKey={photosVersion}
      />

      {open ? (
        <ItemForm onSave={save} onCancel={reset} fields={formFields} disabled={!canSave} />
      ) : (
        editingId === null && <AddButton label="Ürün Ekle" onPress={startAdd} />
      )}

      <AppSheet
        visible={pdfOpen}
        onClose={() => !pdfSaving && setPdfOpen(false)}
        title="PDF’den ürün ekle"
        subtitle={
          supplierName
            ? `${supplierName} · seçili satırlar iş emrine ve cariye yazılır`
            : 'Seçili satırlar iş emrine eklenir'
        }
        footer={
          <>
            <Pressable
              onPress={() => void savePdfLines()}
              disabled={pdfSaving}
              className="h-12 items-center justify-center rounded-xl bg-primary active:opacity-90"
            >
              {pdfSaving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text className="text-sm font-extrabold text-primary-foreground">
                  Seçilenleri Ekle
                </Text>
              )}
            </Pressable>
            <SheetCancelButton onPress={() => !pdfSaving && setPdfOpen(false)} />
          </>
        }
      >
        <View className="gap-3">
            {pdfLines.map((l, index) => (
              <View
                key={l.id}
                className="rounded-2xl border border-border bg-secondary/40 px-3 py-3"
              >
                <Pressable
                  onPress={() => updatePdfLine(l.id, { selected: !l.selected })}
                  className="mb-2 flex-row items-center gap-2"
                >
                  <View
                    className={cn(
                      'h-5 w-5 items-center justify-center rounded border',
                      l.selected ? 'border-primary bg-primary' : 'border-border bg-card',
                    )}
                  >
                    {l.selected && (
                      <Check size={12} color={colors.primaryForeground} strokeWidth={3} />
                    )}
                  </View>
                  <Text className="text-sm font-bold text-foreground">Satır {index + 1}</Text>
                </Pressable>
                <PdfCodeFields
                  rawCode={l.match?.rawCode || l.code || ''}
                  stockCode={l.match?.manufacturerCode || ''}
                  onRawCode={(v) => {
                    updatePdfLine(l.id, {
                      code: v,
                      match: l.match
                        ? {
                            ...l.match,
                            rawCode: v,
                            manufacturerCode: suggestStockCodeFromRaw(v, l.brand) || v,
                          }
                        : matchStateFromResult(undefined, v, l.brand),
                    })
                    schedulePdfRematch(l.id, v, l.name, l.brand)
                  }}
                  onStockCode={(v) => {
                    setPdfManufacturerCode(l.id, v)
                    schedulePdfRematch(l.id, v || l.code || '', l.name, l.brand)
                  }}
                />
                <TextField
                  label="Ürün adı"
                  value={l.name}
                  onChange={(v) => updatePdfLine(l.id, { name: v })}
                  placeholder="Parça adı"
                />
                {l.match ? (
                  <MatchBadge
                    match={l.match}
                    mode="workorder"
                    onPress={() => setPdfMatchSheetId(l.id)}
                  />
                ) : null}
                {l.warning ? (
                  <Text className="mb-2 text-[11px] font-semibold text-amber-800">{l.warning}</Text>
                ) : null}
                <View className="mt-2 flex-row gap-2">
                  <TextField
                    label="Adet"
                    value={String(l.quantity)}
                    onChange={(v) =>
                      updatePdfLine(l.id, {
                        quantity: Math.max(1, parseInt(v.replace(/\D/g, ''), 10) || 1),
                      })
                    }
                    inputMode="numeric"
                    className="flex-1"
                  />
                  <TextField
                    label="Alış"
                    value={l.unitPrice ? String(l.unitPrice) : ''}
                    onChange={(v) => {
                      const unitPrice = Number(v.replace(',', '.')) || 0
                      updatePdfLine(l.id, {
                        unitPrice,
                        salePrice:
                          l.salePrice === 0 || l.salePrice === l.unitPrice
                            ? unitPrice
                            : l.salePrice,
                      })
                    }}
                    inputMode="numeric"
                    className="flex-1"
                  />
                  <TextField
                    label="Satış"
                    value={l.salePrice ? String(l.salePrice) : ''}
                    onChange={(v) =>
                      updatePdfLine(l.id, { salePrice: Number(v.replace(',', '.')) || 0 })
                    }
                    inputMode="numeric"
                    className="flex-1"
                  />
                </View>
              </View>
            ))}
          </View>
      </AppSheet>

      {pdfMatchLine?.match ? (
        <StockMatchSheet
          visible
          onClose={() => setPdfMatchSheetId(null)}
          lineName={pdfMatchLine.name}
          match={pdfMatchLine.match}
          mode="workorder"
          onDecide={(d) => decidePdfLine(pdfMatchLine.id, d)}
          onManufacturerCodeChange={(c) => setPdfManufacturerCode(pdfMatchLine.id, c)}
        />
      ) : null}

      <SupplierPayFromJobSheet
        target={paySupplier}
        onClose={() => setPaySupplier(null)}
      />
    </View>
  )
}

function SupplierPayFromJobSheet({
  target,
  onClose,
}: {
  target: { id: string; name: string; suggestAmount: number } | null
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'nakit' | 'kart' | 'havale'>('nakit')
  const [balance, setBalance] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    setAmount(target.suggestAmount > 0 ? String(target.suggestAmount) : '')
    setMethod('nakit')
    setBusy(false)
    setBalance(null)
    getSupplierLedger(target.id)
      .then((l) => setBalance(l.supplier.balance))
      .catch(() => setBalance(null))
  }, [target])

  async function submit() {
    if (!target) return
    const value = Number(String(amount).replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert('Geçersiz tutar', '0\'dan büyük bir tutar girin.')
      return
    }
    setBusy(true)
    try {
      const ledger = await recordSupplierPayment(
        target.id,
        value,
        `İş emri ödemesi · ${target.name}`,
        method,
      )
      setBalance(ledger.supplier.balance)
      Alert.alert(
        'Tedarikçiye ödeme kaydedildi',
        `Yeni bakiye: ${formatCurrency(ledger.supplier.balance)}`,
      )
      onClose()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppSheet
      visible={!!target}
      onClose={onClose}
      title="Tedarikçiye ödeme"
      subtitle={
        target
          ? `${target.name}${balance != null ? ` · Güncel borç ${formatCurrency(balance)}` : ''}`
          : undefined
      }
    >
      <View className="mb-3 rounded-xl border border-border bg-secondary/60 px-3 py-2.5">
        <Text className="text-xs text-muted-foreground">
          Bu ödeme tedarikçi carisini düşürür. Müşteriden aldığınız para ayrıdır — üstteki
          “Müşteriden Tahsilat” ile kaydedilir.
        </Text>
      </View>
      <TextField
        label="Ödeme tutarı (₺)"
        value={amount}
        onChange={setAmount}
        inputMode="numeric"
        placeholder="0"
      />
      <Text className="mb-2 mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Yöntem
      </Text>
      <View className="flex-row gap-2">
        {(
          [
            { key: 'nakit' as const, label: 'Nakit' },
            { key: 'kart' as const, label: 'Kart' },
            { key: 'havale' as const, label: 'Havale' },
          ] as const
        ).map((m) => {
          const active = method === m.key
          return (
            <Pressable
              key={m.key}
              onPress={() => setMethod(m.key)}
              className={cn(
                'h-11 flex-1 items-center justify-center rounded-xl border-2',
                active ? 'border-primary bg-primary' : 'border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'text-sm font-bold',
                  active ? 'text-primary-foreground' : 'text-foreground',
                )}
              >
                {m.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <Pressable
        onPress={() => void submit()}
        disabled={busy}
        className="mt-4 h-12 items-center justify-center rounded-xl bg-accent active:opacity-90"
      >
        {busy ? (
          <ActivityIndicator color={colors.accentForeground} />
        ) : (
          <Text className="text-sm font-extrabold text-accent-foreground">Ödemeyi Kaydet</Text>
        )}
      </Pressable>
      <SheetCancelButton onPress={onClose} />
    </AppSheet>
  )
}

function StockCatalogPicker({ onPick }: { onPick: (s: StockProductLite) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockProductLite[]>([])
  const [loading, setLoading] = useState(false)
  const [pickedName, setPickedName] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    listStockProducts(query)
      .then((rows) => {
        if (active) setResults(rows)
      })
      .catch(() => {
        if (active) setResults([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [query])

  return (
    <View className="flex flex-col gap-1.5">
      <Text className="text-sm font-semibold text-muted-foreground">Stok Ürünü Ara</Text>
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-4">
        <Search size={18} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={(v) => {
            setQuery(v)
            setPickedName(null)
          }}
          placeholder="Ürün adı veya kodu ara"
          placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
          className="h-12 flex-1 text-sm font-medium text-foreground"
        />
      </View>
      {!loading && !pickedName && results.length > 0 && (
        <ScrollView
          style={{ maxHeight: 168 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          className="rounded-xl border border-border bg-card"
          contentContainerStyle={{ gap: 0, paddingVertical: 2 }}
        >
          {results.slice(0, 30).map((s, idx) => (
            <Pressable
              key={s.id}
              onPress={() => {
                onPick(s)
                setPickedName(s.name)
              }}
              className={cn(
                'flex-row items-center justify-between px-3 py-2.5 active:bg-primary/5',
                idx < Math.min(results.length, 30) - 1 && 'border-b border-border',
              )}
            >
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <Package size={14} color={colors.mutedForeground} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {s.name}
                  </Text>
                  {s.code ? (
                    <Text className="text-[11px] font-bold text-muted-foreground" numberOfLines={1}>
                      {s.code}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text className="text-xs font-bold text-muted-foreground">
                {formatCurrency(s.price)} · {s.quantity} adet
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!loading && query.trim().length > 0 && results.length === 0 && !pickedName && (
        <Text className="px-1 text-xs text-muted-foreground">
          Katalogda bulunamadı. Aşağıya elle girebilirsin.
        </Text>
      )}
      {pickedName && (
        <View className="flex-row items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1.5">
          <Check size={12} color={colors.primary} />
          <Text className="text-xs font-bold text-primary">{pickedName} seçildi</Text>
        </View>
      )}
    </View>
  )
}

function SupplierPicker({
  selectedId,
  selectedName,
  onSelect,
  onClear,
}: {
  selectedId?: string
  selectedName: string
  onSelect: (s: Supplier) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    listSuppliers(query)
      .then((rows) => {
        if (active) setResults(rows)
      })
      .catch(() => {
        if (active) setResults([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [query])

  async function handleQuickAdd() {
    if (!newName.trim()) return
    try {
      const created = await createSupplier({ name: newName.trim(), phone: newPhone.trim() || undefined })
      onSelect(created)
      setQuickAdd(false)
      setNewName('')
      setNewPhone('')
    } catch {
      /* hata mesajı üst seviyede zaten gösterilir */
    }
  }

  if (quickAdd) {
    return (
      <View className="rounded-xl border border-border bg-card p-3">
        <Text className="mb-2 text-xs font-bold text-muted-foreground">Yeni Tedarikçi</Text>
        <View className="flex flex-col gap-2">
          <TextField label="Tedarikçi Adı" value={newName} onChange={setNewName} placeholder="Örn: Bosch Yetkili Bayi" />
          <TextField label="Telefon (isteğe bağlı)" value={newPhone} onChange={setNewPhone} inputMode="tel" placeholder="05XX XXX XX XX" />
          <View className="flex-row gap-2">
            <SaveButton onPress={handleQuickAdd} />
            <CancelButton onPress={() => setQuickAdd(false)} />
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className="flex flex-col gap-1.5">
      <Text className="text-sm font-semibold text-muted-foreground">Tedarikçi (cari)</Text>
      {selectedId ? (
        <View className="flex-row items-center justify-between rounded-xl border-2 border-primary bg-primary/5 px-4 py-3">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Truck size={16} color={colors.primary} />
            <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
              {selectedName}
            </Text>
          </View>
          <Pressable onPress={onClear}>
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : (
        <>
          <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-4">
            <Search size={18} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Tedarikçi ara"
              placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
              className="h-12 flex-1 text-sm font-medium text-foreground"
            />
          </View>
          {!loading && results.length > 0 && (
            <ScrollView
              style={{ maxHeight: 160 }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              className="rounded-xl border border-border bg-card"
            >
              {results.slice(0, 20).map((s, idx) => (
                <Pressable
                  key={s.id}
                  onPress={() => onSelect(s)}
                  className={cn(
                    'flex-row items-center justify-between px-3 py-2.5 active:bg-primary/5',
                    idx < Math.min(results.length, 20) - 1 && 'border-b border-border',
                  )}
                >
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    <Truck size={14} color={colors.mutedForeground} />
                    <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
                      {s.name}
                    </Text>
                  </View>
                  <Text
                    className={cn(
                      'text-xs font-bold',
                      s.balance > 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {s.balance > 0 ? `Borç ${formatCurrency(s.balance)}` : 'Borç yok'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable
            onPress={() => {
              setQuickAdd(true)
              setNewName(query)
            }}
            className="flex-row items-center gap-1.5 self-start rounded-lg px-1 py-1.5"
          >
            <Plus size={14} color={colors.primary} />
            <Text className="text-xs font-bold text-primary">Yeni Tedarikçi</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

function ProductRow({
  product,
  confirming,
  returnConfirming,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onRequestReturn,
  onConfirmReturn,
  onCancelReturn,
  onPaySupplier,
}: {
  product: ProductItem
  confirming: boolean
  returnConfirming: boolean
  onEdit: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onRequestReturn: () => void
  onConfirmReturn: () => void
  onCancelReturn: () => void
  onPaySupplier?: () => void
}) {
  const isReturned = !!product.returnedAt
  const isExternal = product.source === 'disaridan'
  const purchaseUnit = product.purchasePrice ?? 0
  const purchaseTotal = purchaseUnit * product.quantity
  const saleTotal = product.price * product.quantity

  if (confirming) {
    return (
      <View className="flex-row items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-3">
        <View className="flex-1 pl-1">
          <Text className="text-sm font-bold text-foreground">Silinsin mi?</Text>
          <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
            {product.name}
            {isExternal
              ? ' — tedarikçi carisindeki alış kaydı da etkilenir.'
              : ''}
          </Text>
        </View>
        <Pressable
          onPress={onConfirmDelete}
          className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl bg-destructive px-4"
        >
          <Trash2 size={16} color={colors.destructiveForeground} />
          <Text className="text-sm font-bold text-destructive-foreground">Sil</Text>
        </Pressable>
        <Pressable
          onPress={onCancelDelete}
          className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
        >
          <X size={20} color={colors.secondaryForeground} />
        </Pressable>
      </View>
    )
  }

  if (returnConfirming) {
    return (
      <View className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-3">
        <Text className="text-sm font-bold text-foreground">Tedarikçiye iade edilsin mi?</Text>
        <Text className="mt-1 text-xs leading-4 text-muted-foreground">
          {product.name}
          {'\n'}· Müşteri iş emrinden satış tutarı düşer ({formatCurrency(saleTotal)})
          {'\n'}· Tedarikçi borcu alış tutarı kadar azalır ({formatCurrency(purchaseTotal)})
        </Text>
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={onConfirmReturn}
            className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-accent"
          >
            <Undo2 size={16} color={colors.accentForeground} />
            <Text className="text-sm font-bold text-accent-foreground">İade Et</Text>
          </Pressable>
          <Pressable
            onPress={onCancelReturn}
            className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
          >
            <X size={20} color={colors.secondaryForeground} />
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View
      className={cn(
        'rounded-2xl border border-border bg-card p-4',
        isReturned && 'opacity-70',
      )}
      style={cardShadow}
    >
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Package size={20} color={colors.primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-bold text-foreground">{product.name}</Text>
          {product.manufacturerCode || product.supplierCode ? (
            <Text className="mt-0.5 text-[11px] font-bold text-muted-foreground">
              Kod: {product.manufacturerCode || product.supplierCode}
            </Text>
          ) : null}
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {product.quantity} adet
            {isExternal ? ' · Dışarıdan temin' : ' · Stoktan'}
          </Text>
          {isExternal ? (
            <View className="mt-1.5 gap-0.5">
              <Text className="text-xs text-muted-foreground">
                Alış (tedarikçi) {formatCurrency(purchaseUnit)} × {product.quantity} ={' '}
                <Text className="font-bold text-destructive">{formatCurrency(purchaseTotal)}</Text>
              </Text>
              <Text className="text-xs text-muted-foreground">
                Satış (müşteri) {formatCurrency(product.price)} × {product.quantity} ={' '}
                <Text className="font-bold text-foreground">{formatCurrency(saleTotal)}</Text>
              </Text>
            </View>
          ) : (
            <Text className="mt-0.5 text-sm font-extrabold text-foreground">
              {formatCurrency(saleTotal)}
            </Text>
          )}
        </View>
        {!isReturned ? (
          <View className="flex-row items-center gap-1.5">
            <Pressable
              onPress={onEdit}
              className="h-10 w-10 items-center justify-center rounded-xl bg-secondary"
            >
              <Pencil size={16} color={colors.secondaryForeground} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              className="h-10 w-10 items-center justify-center rounded-xl bg-destructive/10"
            >
              <Trash2 size={16} color={colors.destructive} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {isExternal && (
        <View className="mt-3 gap-2 border-t border-border pt-3">
          <View className="flex-row flex-wrap items-center gap-2">
            <View className="flex-row items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1">
              <Truck size={12} color={colors.accent} />
              <Text className="text-xs font-bold text-accent">
                {product.supplierName ?? 'Tedarikçi'}
              </Text>
            </View>
            {isReturned ? (
              <View className="rounded-full bg-secondary px-2.5 py-1">
                <Text className="text-xs font-bold text-muted-foreground">İade edildi</Text>
              </View>
            ) : (
              <View className="rounded-full bg-destructive/10 px-2.5 py-1">
                <Text className="text-xs font-bold text-destructive">
                  Cari borç +{formatCurrency(purchaseTotal)}
                </Text>
              </View>
            )}
          </View>
          {!isReturned ? (
            <View className="flex-row gap-2">
              {onPaySupplier ? (
                <Pressable
                  onPress={onPaySupplier}
                  className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border-2 border-accent bg-accent/10 active:opacity-90"
                >
                  <Banknote size={14} color={colors.accent} />
                  <Text className="text-xs font-extrabold text-accent">Tedarikçiye Öde</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onRequestReturn}
                className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border-2 border-border bg-card active:opacity-90"
              >
                <Undo2 size={14} color={colors.foreground} />
                <Text className="text-xs font-extrabold text-foreground">İade Et</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}

function ServiceSuggestions({
  catalog,
  onPick,
}: {
  catalog: ServiceCatalogItem[]
  onPick: (item: ServiceCatalogItem) => void
}) {
  const cats = Object.keys(SERVICE_CATEGORY_LABELS) as ServiceCatalogCategory[]
  const [cat, setCat] = useState<ServiceCatalogCategory>('periyodik')
  const items = catalog.filter((s) => s.category === cat)

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold text-muted-foreground">
        Hazır servisler
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingRight: 4 }}
      >
        {cats.map((c) => {
          const active = c === cat
          return (
            <Pressable
              key={c}
              onPress={() => setCat(c)}
              className={cn(
                'rounded-full px-3 py-1.5',
                active ? 'bg-primary' : 'bg-secondary',
              )}
            >
              <Text
                className={cn(
                  'text-xs font-bold',
                  active ? 'text-primary-foreground' : 'text-secondary-foreground',
                )}
              >
                {SERVICE_CATEGORY_LABELS[c]}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <View className="flex-row flex-wrap gap-2">
        {items.map((s) => (
          <Pressable
            key={s.name}
            onPress={() => onPick(s)}
            className="rounded-lg border border-border bg-secondary px-2.5 py-1.5 active:bg-primary/10"
          >
            <Text className="text-xs font-semibold text-foreground">{s.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function PhotoPicker({
  uri,
  onPick,
  onClear,
}: {
  uri: string | null
  onPick: (uri: string) => void
  onClear: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  async function pickFrom(source: 'camera' | 'gallery') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('İzin gerekli', 'Fotoğraf eklemek için izin verin.')
      return
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 })
    if (result.canceled) return
    const asset = result.assets?.[0]
    if (asset?.uri) onPick(asset.uri)
  }

  return (
    <View className="mt-3">
      <AppSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Fotoğraf Ekle"
        subtitle="Fotoğrafı nereden eklemek istersiniz?"
      >
        <SheetActionList
          onClose={() => setPickerOpen(false)}
          actions={[
            {
              key: 'camera',
              label: 'Kamera',
              description: 'Yeni fotoğraf çek',
              icon: Camera,
              tone: 'accent',
              onPress: () => pickFrom('camera'),
            },
            {
              key: 'gallery',
              label: 'Galeri',
              description: 'Kayıtlı fotoğraftan seç',
              icon: ImagePlus,
              tone: 'primary',
              onPress: () => pickFrom('gallery'),
            },
          ]}
        />
        <SheetCancelButton onPress={() => setPickerOpen(false)} />
      </AppSheet>

      {uri ? (
        <View className="flex-row items-center gap-3">
          <Image source={{ uri }} resizeMode="cover" className="h-16 w-16 rounded-xl" />
          <Pressable
            onPress={onClear}
            className="h-9 flex-row items-center gap-1.5 rounded-lg bg-secondary px-3"
          >
            <X size={14} color={colors.secondaryForeground} />
            <Text className="text-xs font-bold text-secondary-foreground">Kaldır</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setPickerOpen(true)}
          className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/50"
        >
          <ImagePlus size={16} color={colors.mutedForeground} />
          <Text className="text-sm font-semibold text-muted-foreground">Fotoğraf Ekle</Text>
        </Pressable>
      )}
    </View>
  )
}

function imageLinkId(
  row: WorkOrderImage & { ComplaintId?: string; ServiceId?: string },
  key: 'complaint' | 'service',
) {
  const v = key === 'complaint' ? (row.complaintId ?? row.ComplaintId) : (row.serviceId ?? row.ServiceId)
  return (v ?? '').toString().toLowerCase()
}

function sameLinkId(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function PhotoGallery({
  workOrderId,
  imageType,
  complaintId,
  serviceId,
  heading,
  refreshKey = 0,
  editable = false,
  showAllOfType = false,
}: {
  workOrderId: string
  imageType: string
  /** Verilirse sadece bu şikayete ait fotoğraflar gösterilir. */
  complaintId?: string
  /** Verilirse sadece bu işleme ait fotoğraflar gösterilir. */
  serviceId?: string
  /** Başlık metni özelleştirmesi (örn. "Diğer Fotoğraflar"). Verilmezse "Fotoğraflar (N)" kullanılır. */
  heading?: string
  /** Yükleme sonrası galeriyi yeniden çekmek için artırılır. */
  refreshKey?: number
  /** true ise her fotoğrafın üzerinde silme (X) rozeti gösterilir. */
  editable?: boolean
  /** true ise bu tipteki tüm fotoğraflar (şikayete bağlı olanlar hariç) gösterilir. */
  showAllOfType?: boolean
}) {
  const [images, setImages] = useState<WorkOrderImage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [previewUri, setPreviewUri] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function confirmDeleteImage(img: WorkOrderImage) {
    Alert.alert('Fotoğraf silinsin mi?', 'Bu işlem geri alınamaz.', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(img.id)
          try {
            await deleteWorkOrderImage(workOrderId, img.id)
            setImages((prev) => prev.filter((i) => i.id !== img.id))
          } catch (e) {
            showError(e)
          } finally {
            setDeletingId(null)
          }
        },
      },
    ])
  }

  useEffect(() => {
    let active = true
    setLoaded(false)
    getWorkOrderImages(workOrderId)
      .then((rows) => {
        if (!active) return
        const byType = rows.filter((r) => r.imageType === imageType)
        const filtered = complaintId
          ? byType.filter((r) => sameLinkId(imageLinkId(r, 'complaint'), complaintId))
          : serviceId
            ? byType.filter((r) => sameLinkId(imageLinkId(r, 'service'), serviceId))
            : showAllOfType
              ? byType.filter((r) => !imageLinkId(r, 'complaint'))
              : byType.filter((r) => !imageLinkId(r, 'complaint') && !imageLinkId(r, 'service'))
        setImages(filtered)
      })
      .catch(() => {
        /* fotoğraflar yüklenemedi — sekmeyi kullanılamaz hale getirmeyelim */
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [workOrderId, imageType, complaintId, serviceId, refreshKey, showAllOfType])

  if (!loaded || images.length === 0) return null

  return (
    <>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center justify-between rounded-xl bg-secondary/60 px-3 py-2"
      >
        <View className="flex-row items-center gap-2">
          <ImagePlus size={16} color={colors.mutedForeground} />
          <Text className="text-xs font-bold text-muted-foreground">
            {heading ?? `Fotoğraflar (${images.length})`}
          </Text>
        </View>
        {expanded ? (
          <ChevronUp size={18} color={colors.mutedForeground} />
        ) : (
          <ChevronDown size={18} color={colors.mutedForeground} />
        )}
      </Pressable>

      {expanded && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, marginTop: 8 }}
        >
          {images.map((img) => {
            const uri = absoluteImageUrl(img.url)
            return (
              <View key={img.id} className="relative">
                <Pressable onPress={() => setPreviewUri(uri)} disabled={deletingId === img.id}>
                  <Image
                    source={{ uri }}
                    resizeMode="cover"
                    className="h-16 w-16 rounded-xl bg-secondary"
                    style={deletingId === img.id ? { opacity: 0.4 } : undefined}
                  />
                </Pressable>
                {editable ? (
                  <Pressable
                    onPress={() => confirmDeleteImage(img)}
                    disabled={deletingId === img.id}
                    className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-destructive"
                    style={{ elevation: 2 }}
                  >
                    <X size={13} color={colors.destructiveForeground} />
                  </Pressable>
                ) : null}
              </View>
            )
          })}
        </ScrollView>
      )}

      <Modal
        visible={!!previewUri}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUri(null)}
      >
        <Pressable
          onPress={() => setPreviewUri(null)}
          className="flex-1 items-center justify-center bg-foreground/90"
        >
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              resizeMode="contain"
              className="h-full w-full"
            />
          ) : null}
          <Pressable
            onPress={() => setPreviewUri(null)}
            className="absolute right-5 top-14 h-11 w-11 items-center justify-center rounded-xl bg-card"
          >
            <X size={22} color={colors.foreground} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function Row({
  icon: Icon,
  title,
  subtitle,
  value,
  confirming,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  footer,
}: {
  icon: IconType
  title: string
  subtitle?: string
  value: string
  confirming: boolean
  onEdit: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  footer?: React.ReactNode
}) {
  if (confirming) {
    return (
      <View className="flex-row items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-3">
        <View className="flex-1 pl-1">
          <Text className="text-sm font-bold text-foreground">Silinsin mi?</Text>
          <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable
          onPress={onConfirmDelete}
          className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl bg-destructive px-4"
        >
          <Trash2 size={16} color={colors.destructiveForeground} />
          <Text className="text-sm font-bold text-destructive-foreground">Sil</Text>
        </Pressable>
        <Pressable
          onPress={onCancelDelete}
          className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
        >
          <X size={20} color={colors.secondaryForeground} />
        </Pressable>
      </View>
    )
  }

  return (
    <View className="rounded-2xl border border-border bg-card p-4" style={cardShadow}>
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Icon size={20} color={colors.primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-bold text-foreground">{title}</Text>
          {subtitle ? (
            <Text className="mt-0.5 text-xs text-muted-foreground">{subtitle}</Text>
          ) : null}
          <Text className="mt-0.5 text-sm font-extrabold text-foreground">{value}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Pressable
            onPress={onEdit}
            className="h-10 w-10 items-center justify-center rounded-xl bg-secondary"
          >
            <Pencil size={16} color={colors.secondaryForeground} />
          </Pressable>
          <Pressable
            onPress={onDelete}
            className="h-10 w-10 items-center justify-center rounded-xl bg-destructive/10"
          >
            <Trash2 size={16} color={colors.destructive} />
          </Pressable>
        </View>
      </View>
      {footer ? <View className="mt-3">{footer}</View> : null}
    </View>
  )
}

function ItemForm({
  fields,
  onSave,
  onCancel,
  disabled,
}: {
  fields: React.ReactNode
  onSave: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  return (
    <View
      className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-card p-4"
      style={cardShadow}
    >
      {fields}
      <View className="flex-row gap-2">
        <SaveButton onPress={onSave} disabled={disabled} />
        <CancelButton onPress={onCancel} />
      </View>
    </View>
  )
}

function EmptyState({ icon: Icon, text }: { icon: IconType; text: string }) {
  return (
    <View className="items-center py-10">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
        <Icon size={28} color={colors.mutedForeground} />
      </View>
      <Text className="mt-3 text-sm font-medium text-muted-foreground">{text}</Text>
    </View>
  )
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 active:bg-primary/10"
    >
      <Plus size={20} color={colors.primary} />
      <Text className="text-base font-bold text-primary">{label}</Text>
    </Pressable>
  )
}

function SaveButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent',
        disabled && 'opacity-40',
      )}
    >
      <Check size={16} color={colors.accentForeground} />
      <Text className="text-sm font-extrabold text-accent-foreground">Kaydet</Text>
    </Pressable>
  )
}

function CancelButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-12 items-center justify-center rounded-xl bg-secondary px-5"
    >
      <Text className="text-sm font-bold text-secondary-foreground">Vazgeç</Text>
    </Pressable>
  )
}
