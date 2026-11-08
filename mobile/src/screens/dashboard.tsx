import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native'
import {
  Camera,
  Clock,
  Wrench,
  CheckCircle2,
  ArrowRight,
  Landmark,
  Banknote,
} from 'lucide-react-native'
import { STATUS_LABELS as JOB_STATUS_LABELS, type JobStatus, type Vehicle } from '@/lib/types'
import { VehicleCard, cardShadow } from '@/components/vehicle-card'
import { formatDate, formatCurrency, formatDaysWaiting } from '@/lib/format'
import { colors } from '@/lib/theme'
import { TextField } from '@/components/form-field'
import { AppSheet, SheetCancelButton } from '@/components/app-modal'
import {
  getCashToday,
  getPaymentsPending,
  getShopPaymentInfo,
  loadDashboardStats,
  updateShopPaymentInfo,
  type CashTodayReport,
  type CurrentUser,
  type DashboardStats,
  type PaymentPendingItem,
  type PaymentsPendingReport,
  type ShopLicense,
  type ShopPaymentInfo,
} from '@/lib/api'

type IconType = typeof Clock

const STATUS_LABELS: Record<'bekliyor' | 'islemde' | 'tamamlandi', string> = {
  bekliyor: 'Bekleyen Araçlar',
  islemde: 'İşlemdeki Araçlar',
  tamamlandi: 'Servisi Tamamlanan Araçlar',
}

const STATUS_EMPTY_LABELS: Record<'bekliyor' | 'islemde' | 'tamamlandi', string> = {
  bekliyor: 'Bekleyen araç yok.',
  islemde: 'İşlemde araç yok.',
  tamamlandi: 'Servisi tamamlanan araç yok.',
}

function matchesDashboardFilter(status: JobStatus, filter: JobStatus) {
  if (filter === 'tamamlandi') {
    return (
      status === 'tamamlandi' || status === 'teslim_edildi' || status === 'odeme_tamamlandi'
    )
  }
  return status === filter
}

export function Dashboard({
  vehicles,
  userName,
  currentUser,
  license,
  onLogout: _onLogout,
  onOpenVehicle,
  onOpenPendingWorkOrder,
  onNewVehicle,
  onSeeAll,
  onRefresh,
}: {
  vehicles: Vehicle[]
  userName: string
  currentUser: CurrentUser | null
  license?: ShopLicense | null
  onLogout: () => void
  onOpenVehicle: (id: string) => void
  onOpenPendingWorkOrder: (workOrderId: string, vehicleId: string) => void
  onNewVehicle: () => void
  onSeeAll: () => void
  onRefresh?: () => Promise<void>
}) {
  /** Personel finansal özet / IBAN görmez; admin ve usta görür. */
  const canSeeFinance = currentUser?.role === 'admin' || currentUser?.role === 'usta'
  const [activeFilter, setActiveFilter] = useState<'bekliyor' | 'islemde' | 'tamamlandi' | null>(
    null,
  )
  const bekleyen = vehicles.filter((v) => v.status === 'bekliyor').length
  const islemde = vehicles.filter((v) => v.status === 'islemde').length
  const tamamlanan = vehicles.filter(
    (v) =>
      v.status === 'tamamlandi' ||
      v.status === 'teslim_edildi' ||
      v.status === 'odeme_tamamlandi',
  ).length
  // Teslim edilmemiş iş emirleri = şu an serviste olanlar (tüm kayıtlı araçlar değil)
  const inService = vehicles.filter((v) => v.status !== 'teslim_edildi').length
  const recent = activeFilter
    ? vehicles.filter((v) => matchesDashboardFilter(v.status, activeFilter)).slice(0, 20)
    : vehicles.slice(0, 4)

  function toggleFilter(status: 'bekliyor' | 'islemde' | 'tamamlandi') {
    setActiveFilter((current) => (current === status ? null : status))
  }

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [statsError, setStatsError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [paymentInfo, setPaymentInfo] = useState<ShopPaymentInfo | null>(null)
  const [ibanOpen, setIbanOpen] = useState(false)
  const [pending, setPending] = useState<PaymentsPendingReport | null>(null)
  const [cashToday, setCashToday] = useState<CashTodayReport | null>(null)
  const [pendingOpen, setPendingOpen] = useState(false)

  useEffect(() => {
    loadDashboardStats()
      .then((s) => {
        setStats(s)
        setStatsError(false)
      })
      .catch(() => {
        setStats(null)
        setStatsError(true)
      })
  }, [refreshTick])

  useEffect(() => {
    if (!canSeeFinance) {
      setPaymentInfo(null)
      return
    }
    getShopPaymentInfo()
      .then(setPaymentInfo)
      .catch(() => setPaymentInfo(null))
  }, [refreshTick, canSeeFinance])

  useEffect(() => {
    if (!canSeeFinance) {
      setPending(null)
      setCashToday(null)
      return
    }
    getPaymentsPending()
      .then(setPending)
      .catch(() => setPending(null))
    getCashToday()
      .then(setCashToday)
      .catch(() => setCashToday(null))
  }, [refreshTick, canSeeFinance])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      if (onRefresh) await onRefresh()
      setRefreshTick((t) => t + 1)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      {license?.licenseStatus === 'warning' ? (
        <View className="mx-5 mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/15 px-4 py-3">
          <Text className="text-sm font-bold text-amber-800">
            Lisansınız {license.daysRemaining ?? '?'} gün sonra bitiyor
            {license.licenseExpiresAt
              ? ` (${formatDate(license.licenseExpiresAt)})`
              : ''}
          </Text>
          <Text className="mt-1 text-xs text-amber-900/80">
            Yenileme için lütfen iletişime geçin. Süre dolunca giriş kapanır.
          </Text>
        </View>
      ) : null}

      <View className="mx-5 mt-4 rounded-3xl border border-border bg-card px-5 py-5" style={cardShadow}>
        <View className="flex-row items-start gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-muted-foreground">
              {formatDate(new Date().toISOString())}
            </Text>
            <Text className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">
              Merhaba, {userName}
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Bugün serviste {inService} araç var.
            </Text>
          </View>
          {canSeeFinance ? (
            <Pressable
              onPress={() => setIbanOpen(true)}
              accessibilityLabel={paymentInfo?.bankIban ? 'IBAN Düzenle' : 'IBAN Ekle'}
              className="mt-0.5 h-11 flex-row items-center gap-1.5 rounded-xl border border-border bg-primary/10 px-3 active:opacity-80"
            >
              <Landmark size={16} color={colors.primary} />
              <Text className="text-xs font-extrabold text-primary">
                {paymentInfo?.bankIban ? 'IBAN' : 'IBAN Ekle'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View className="mt-5 flex-row gap-3">
          <Stat
            icon={Clock}
            label="Bekleyen"
            value={bekleyen}
            active={activeFilter === 'bekliyor'}
            onPress={() => toggleFilter('bekliyor')}
          />
          <Stat
            icon={Wrench}
            label="İşlemde"
            value={islemde}
            active={activeFilter === 'islemde'}
            onPress={() => toggleFilter('islemde')}
          />
          <Stat
            icon={CheckCircle2}
            label="Biten"
            value={tamamlanan}
            active={activeFilter === 'tamamlandi'}
            onPress={() => toggleFilter('tamamlandi')}
          />
        </View>

        {stats ? (
          <View className="mt-3 rounded-xl border border-border bg-secondary/70 px-4 py-2.5">
            <Text className="text-xs font-semibold text-secondary-foreground">
              Bu ay: {stats.monthVehiclesServiced} araç · {stats.monthOperations} işlem
            </Text>
          </View>
        ) : statsError ? (
          <View className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <Text className="text-xs font-semibold text-destructive">
              Aylık özet yüklenemedi. Yenilemek için aşağı çekin.
            </Text>
          </View>
        ) : null}

        {canSeeFinance && cashToday ? (
          <View className="mt-3 rounded-xl border border-border bg-secondary/70 px-4 py-2.5">
            <Text className="text-xs font-semibold text-secondary-foreground">
              Bugün tahsilat: {formatCurrency(cashToday.total)}
            </Text>
            <Text className="mt-1 text-[11px] text-muted-foreground">
              Nakit {formatCurrency(cashToday.nakit)} · Kart {formatCurrency(cashToday.kart)} ·
              Havale {formatCurrency(cashToday.havale)}
            </Text>
          </View>
        ) : null}

        {canSeeFinance ? (
          <Pressable
            onPress={() => setPendingOpen(true)}
            className="mt-3 flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 active:opacity-90"
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-accent/15">
              <Banknote size={18} color={colors.accent} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-extrabold text-foreground">Ödeme bekleyen</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {pending
                  ? pending.count > 0
                    ? `${pending.count} araç · ${formatCurrency(pending.totalRemaining)} kalan`
                    : 'Bekleyen ödeme yok'
                  : 'Yükleniyor…'}
              </Text>
            </View>
            <ArrowRight size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <View className="px-5">
        <Pressable
          onPress={onNewVehicle}
          className="mt-5 flex-row items-center gap-4 rounded-2xl bg-accent p-5 active:opacity-95"
          style={accentShadow}
        >
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-accent-foreground/15">
            <Camera size={32} color={colors.accentForeground} strokeWidth={2.2} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-extrabold text-accent-foreground">
              Yeni Araç Kaydı
            </Text>
            <Text className="text-sm text-accent-foreground/85">
              Ruhsatı çek, bilgiler otomatik dolsun
            </Text>
          </View>
          <ArrowRight size={24} color={colors.accentForeground} />
        </Pressable>

        <View className="mt-6 flex-row items-center justify-between">
          <Text className="text-lg font-extrabold text-foreground">
            {activeFilter ? STATUS_LABELS[activeFilter] : 'Son Araçlar'}
          </Text>
          {activeFilter ? (
            <Pressable onPress={() => setActiveFilter(null)}>
              <Text className="text-sm font-semibold text-primary">Filtreyi Temizle</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onSeeAll}>
              <Text className="text-sm font-semibold text-primary">Tümünü Gör</Text>
            </Pressable>
          )}
        </View>

        {recent.length === 0 ? (
          <View className="mt-3 rounded-2xl border border-border bg-card p-4">
            <Text className="text-sm text-muted-foreground">
              {activeFilter
                ? STATUS_EMPTY_LABELS[activeFilter]
                : 'Henüz araç kaydı yok. Yeni Araç Kaydı ile başlayın.'}
            </Text>
          </View>
        ) : (
          <View className="mt-3 flex flex-col gap-3">
            {recent.map((v) => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                onPress={() => onOpenVehicle(v.id)}
              />
            ))}
          </View>
        )}
      </View>

      <IbanEditSheet
        visible={ibanOpen}
        initial={paymentInfo}
        onClose={() => setIbanOpen(false)}
        onSaved={(info) => {
          setPaymentInfo(info)
          setIbanOpen(false)
        }}
      />

      <PendingPaymentsSheet
        visible={pendingOpen}
        items={pending?.items ?? []}
        totalRemaining={pending?.totalRemaining ?? 0}
        onClose={() => setPendingOpen(false)}
        onOpenItem={(item) => {
          setPendingOpen(false)
          onOpenPendingWorkOrder(item.workOrderId, item.vehicleId)
        }}
      />
    </ScrollView>
  )
}

function PendingPaymentsSheet({
  visible,
  items,
  totalRemaining,
  onClose,
  onOpenItem,
}: {
  visible: boolean
  items: PaymentPendingItem[]
  totalRemaining: number
  onClose: () => void
  onOpenItem: (item: PaymentPendingItem) => void
}) {
  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="Ödeme bekleyenler"
      subtitle={
        items.length > 0
          ? `${items.length} araç · toplam kalan ${formatCurrency(totalRemaining)}`
          : 'Tamamlanmış işlerde kalan ödeme yok'
      }
    >
      {items.length === 0 ? (
        <Text className="py-4 text-sm text-muted-foreground">Bekleyen ödeme bulunmuyor.</Text>
      ) : (
        <View className="gap-2">
          {items.map((item) => {
            const waitingLabel = formatDaysWaiting(item.daysWaiting)
            return (
            <Pressable
              key={item.workOrderId}
              onPress={() => onOpenItem(item)}
              className="rounded-2xl border border-border bg-secondary/50 px-4 py-3 active:opacity-90"
            >
              <View className="flex-row items-center justify-between gap-2">
                <View className="flex-row items-center gap-2">
                  <Text className="font-mono text-sm font-extrabold text-foreground">
                    {item.plate}
                  </Text>
                  {item.visitNumber != null && item.visitNumber > 1 ? (
                    <Text className="text-[11px] font-bold text-muted-foreground">
                      {item.visitNumber}. kez
                    </Text>
                  ) : null}
                </View>
                <Text className="text-sm font-extrabold text-accent">
                  {formatCurrency(item.remaining)}
                </Text>
              </View>
              <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
                {item.customerName} · {JOB_STATUS_LABELS[item.status]}
              </Text>
              <Text className="mt-0.5 text-[11px] text-muted-foreground">
                {item.pendingSince ? formatDate(item.pendingSince) : '—'}
                {waitingLabel ? ` · ${waitingLabel}` : ''}
              </Text>
              <Text className="mt-0.5 text-[11px] text-muted-foreground">
                Toplam {formatCurrency(item.grandTotal)} · Ödenen{' '}
                {formatCurrency(item.paidTotal)}
              </Text>
            </Pressable>
            )
          })}
        </View>
      )}
      <SheetCancelButton onPress={onClose} />
    </AppSheet>
  )
}

function IbanEditSheet({
  visible,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean
  initial: ShopPaymentInfo | null
  onClose: () => void
  onSaved: (info: ShopPaymentInfo) => void
}) {
  const [iban, setIban] = useState('')
  const [bankName, setBankName] = useState('')
  const [holder, setHolder] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!visible) return
    setIban(initial?.bankIban ?? '')
    setBankName(initial?.bankName ?? '')
    setHolder(initial?.accountHolder ?? '')
    setBusy(false)
  }, [visible, initial])

  async function save() {
    const cleaned = iban.replace(/\s+/g, '').toUpperCase()
    if (cleaned && !/^TR\d{24}$/i.test(cleaned)) {
      Alert.alert('Geçersiz IBAN', 'Türkiye IBAN’ı TR ile başlamalı ve 26 karakter olmalı.')
      return
    }
    setBusy(true)
    try {
      const info = await updateShopPaymentInfo({
        bankIban: cleaned || null,
        bankName: bankName.trim() || null,
        accountHolder: holder.trim() || null,
      })
      onSaved(info)
    } catch (e) {
      Alert.alert('Hata', e instanceof Error ? e.message : 'IBAN kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title={initial?.bankIban ? 'IBAN Düzenle' : 'IBAN Ekle'}
      subtitle="Müşteriye havale bilgisi paylaşılırken kullanılır"
    >
      <View className="gap-3">
        <TextField
          label="IBAN"
          value={iban}
          onChange={setIban}
          placeholder="TR00 0000 0000 0000 0000 0000 00"
        />
        <TextField
          label="Banka (opsiyonel)"
          value={bankName}
          onChange={setBankName}
          placeholder="Örn. Ziraat Bankası"
        />
        <TextField
          label="Hesap sahibi (opsiyonel)"
          value={holder}
          onChange={setHolder}
          placeholder="Örn. Servis Unvanı"
        />
      </View>
      <Pressable
        onPress={save}
        disabled={busy}
        className="mt-4 h-12 items-center justify-center rounded-xl bg-primary active:opacity-90"
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text className="text-sm font-extrabold text-primary-foreground">Kaydet</Text>
        )}
      </Pressable>
      <SheetCancelButton onPress={onClose} />
    </AppSheet>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  active = false,
  onPress,
}: {
  icon: IconType
  label: string
  value: number
  active?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className={
        active
          ? 'flex-1 rounded-2xl border-2 border-primary bg-primary/10 p-3 active:opacity-80'
          : 'flex-1 rounded-2xl border border-border bg-secondary/80 p-3 active:opacity-80'
      }
    >
      <Icon size={20} color={active ? colors.primary : colors.mutedForeground} />
      <Text
        className={
          active
            ? 'mt-2 text-2xl font-extrabold leading-none text-primary'
            : 'mt-2 text-2xl font-extrabold leading-none text-foreground'
        }
      >
        {value}
      </Text>
      <Text
        className={
          active
            ? 'mt-1 text-xs font-medium text-primary'
            : 'mt-1 text-xs font-medium text-muted-foreground'
        }
      >
        {label}
      </Text>
    </Pressable>
  )
}

const accentShadow = {
  shadowColor: '#e07d33',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.28,
  shadowRadius: 12,
  elevation: 5,
}

