import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  ChevronRight,
  LineChart,
  Package,
  ShoppingCart,
  Truck,
  Wallet,
} from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { colors } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'
import { AppSheet, SheetCancelButton } from '@/components/app-modal'
import { formatCurrency, formatDate, toTurkeyDateKey } from '@/lib/format'
import {
  getAccountLedgerReport,
  getCustomerLedgerDetail,
  getSalesReport,
  getStockMovementDetail,
  getStockPurchaseSaleReport,
  getStockUsageReport,
  getSupplierLedger,
  type AccountLedgerRow,
  type CustomerLedgerEntry,
  type SalesReport,
  type StockMovementDetail,
  type StockPurchaseSaleRow,
  type StockUsageRow,
  type SupplierTransaction,
} from '@/lib/api'
import {
  SupplierTxDetailSheet,
  SupplierTxGroupedList,
} from '@/components/supplier-tx-detail'

type ReportKey = 'usage' | 'purchaseSale' | 'ledger' | 'sales'
type Period = 'daily' | 'weekly' | 'monthly' | 'custom'

function toIso(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function formatTr(iso: string) {
  return parseIso(iso).toLocaleDateString('tr-TR')
}

function startOfWeek(d: Date) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - day)
  return copy
}

function endOfWeek(d: Date) {
  const start = startOfWeek(d)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return end
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function inDateRange(iso: string, fromIso: string, toIsoDate: string) {
  const d = toTurkeyDateKey(iso)
  const from = fromIso <= toIsoDate ? fromIso : toIsoDate
  const to = fromIso <= toIsoDate ? toIsoDate : fromIso
  return d >= from && d <= to
}

/** Tüm raporlarda ortak dönem seçici: Günlük / Haftalık / Aylık / Tarih Aralığı. */
function usePeriodRange() {
  const today = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState<Period>('monthly')
  const [fromIso, setFromIso] = useState(toIso(startOfMonth(today)))
  const [toIsoDate, setToIsoDate] = useState(toIso(today))
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)

  function applyPreset(next: Period) {
    setPeriod(next)
    const now = new Date()
    if (next === 'daily') {
      const iso = toIso(now)
      setFromIso(iso)
      setToIsoDate(iso)
    } else if (next === 'weekly') {
      setFromIso(toIso(startOfWeek(now)))
      setToIsoDate(toIso(endOfWeek(now)))
    } else if (next === 'monthly') {
      setFromIso(toIso(startOfMonth(now)))
      setToIsoDate(toIso(endOfMonth(now)))
    }
  }

  const from = fromIso <= toIsoDate ? fromIso : toIsoDate
  const to = fromIso <= toIsoDate ? toIsoDate : fromIso
  const rangeLabel = `${formatTr(from)} – ${formatTr(to)}`

  return {
    period, applyPreset, fromIso, setFromIso, toIsoDate, setToIsoDate,
    picker, setPicker, from, to, rangeLabel,
  }
}

function PeriodBar(props: ReturnType<typeof usePeriodRange>) {
  const { period, applyPreset, fromIso, toIsoDate, picker, setPicker, setFromIso, setToIsoDate } = props
  return (
    <View className="bg-background px-5 pb-3 pt-3">
      <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
        {(
          [
            { key: 'daily' as const, label: 'Bugün' },
            { key: 'weekly' as const, label: 'Bu Hafta' },
            { key: 'monthly' as const, label: 'Bu Ay' },
            { key: 'custom' as const, label: 'Aralık' },
          ] as const
        ).map((opt) => {
          const active = period === opt.key
          return (
            <Pressable
              key={opt.key}
              onPress={() => applyPreset(opt.key)}
              className={cn('h-10 flex-1 items-center justify-center rounded-xl', active ? 'bg-card' : '')}
              style={active ? cardShadow : undefined}
            >
              <Text className={cn('text-xs font-bold', active ? 'text-foreground' : 'text-muted-foreground')}>
                {opt.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {period === 'custom' ? (
        <View className="mt-3 flex-row gap-2">
          <DateField label="Başlangıç" value={fromIso} onPress={() => setPicker('from')} />
          <DateField label="Bitiş" value={toIsoDate} onPress={() => setPicker('to')} />
        </View>
      ) : null}

      {picker && (
        <DateTimePicker
          value={parseIso(picker === 'from' ? fromIso : toIsoDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') setPicker(null)
            if (!date) return
            const iso = toIso(date)
            if (picker === 'from') setFromIso(iso)
            else setToIsoDate(iso)
          }}
        />
      )}
    </View>
  )
}

function DateField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <Text className="text-[11px] font-semibold text-muted-foreground">{label}</Text>
      <View className="mt-1 flex-row items-center gap-1.5">
        <Calendar size={14} color={colors.mutedForeground} />
        <Text className="text-sm font-bold text-foreground">{formatTr(value)}</Text>
      </View>
    </Pressable>
  )
}

function ReportHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <View className="flex-row items-center gap-3 bg-background px-5 pb-1 pt-3">
      <Pressable onPress={onBack} className="h-11 w-11 items-center justify-center rounded-xl bg-secondary">
        <ArrowLeft size={20} color={colors.secondaryForeground} />
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text className="text-lg font-extrabold tracking-tight text-foreground" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <View className="mt-10 items-center">
      <View className="h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
        <BarChart3 size={32} color={colors.mutedForeground} />
      </View>
      <Text className="mt-4 text-base font-bold text-foreground">Bu dönemde veri yok</Text>
      <Text className="mt-1 text-sm text-muted-foreground">{label}</Text>
    </View>
  )
}

/* ---------------------------------------------------------------------
   Hub
   ------------------------------------------------------------------- */

export function StockReports({ onBack }: { onBack: () => void }) {
  const [active, setActive] = useState<ReportKey | null>(null)

  if (active === 'usage') return <StockUsageScreen onBack={() => setActive(null)} />
  if (active === 'purchaseSale') return <StockPurchaseSaleScreen onBack={() => setActive(null)} />
  if (active === 'ledger') return <AccountLedgerScreen onBack={() => setActive(null)} />
  if (active === 'sales') return <SalesReportScreen onBack={() => setActive(null)} />

  const cards: { key: ReportKey; title: string; subtitle: string; icon: typeof Package; color: string }[] = [
    {
      key: 'usage',
      title: 'Stok Kullanım Raporu',
      subtitle: 'Dönemde iş emrine eklenen parça miktarı ve satış tutarı',
      icon: Package,
      color: '#2f4a86',
    },
    {
      key: 'purchaseSale',
      title: 'Stok Alış–Satış Raporu',
      subtitle: 'Parça maliyeti, satış tutarı ve kâr (işçilik hariç)',
      icon: ShoppingCart,
      color: '#e07d33',
    },
    {
      key: 'ledger',
      title: 'Cari Hareket Raporu',
      subtitle: 'Müşteri iş emri/tahsilat ve tedarikçi alış/ödeme',
      icon: Wallet,
      color: '#0f766e',
    },
    {
      key: 'sales',
      title: 'Satış Raporu',
      subtitle: 'İş emri cirosu, dönem tahsilatı ve ödeme yöntemleri',
      icon: LineChart,
      color: '#7c3aed',
    },
  ]

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10 pt-4">
      <Text className="mb-3 text-sm font-bold text-muted-foreground">Raporlar</Text>
      <View className="flex flex-col gap-3">
        {cards.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setActive(c.key)}
            className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4 active:opacity-90"
            style={cardShadow}
          >
            <View
              className="h-12 w-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${c.color}1a` }}
            >
              <c.icon size={22} color={c.color} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold text-foreground">{c.title}</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
                {c.subtitle}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

/* ---------------------------------------------------------------------
   1) Stok Kullanım Raporu
   ------------------------------------------------------------------- */

function StockUsageScreen({ onBack }: { onBack: () => void }) {
  const range = usePeriodRange()
  const [rows, setRows] = useState<StockUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState<StockUsageRow | null>(null)
  const [detail, setDetail] = useState<StockMovementDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    getStockUsageReport(range.from, range.to)
      .then((r) => {
        if (active) setRows(r)
      })
      .catch(() => active && setRows([]))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])

  async function openDetail(row: StockUsageRow) {
    setDetailRow(row)
    setDetail([])
    setDetailLoading(true)
    try {
      const rows2 = await getStockMovementDetail(row.stockProductId, row.name, range.from, range.to)
      setDetail(rows2)
    } catch {
      setDetail([])
    } finally {
      setDetailLoading(false)
    }
  }

  const totalQty = rows.reduce((s, r) => s + r.totalQuantity, 0)
  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0)

  return (
    <View className="flex-1">
      <ReportHeader title="Stok Kullanım Raporu" subtitle={range.rangeLabel} onBack={onBack} />
      <PeriodBar {...range} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10">
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Toplam Kullanılan</Text>
              <Text className="mt-1 text-lg font-extrabold text-foreground">{totalQty} adet</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Parça Satışı</Text>
              <Text className="mt-1 text-lg font-extrabold text-foreground">{formatCurrency(totalRevenue)}</Text>
              <Text className="mt-0.5 text-[10px] text-muted-foreground">İşçilik hariç</Text>
            </View>
          </View>

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">
            En çok kullanılan · detay için dokun
          </Text>

          {rows.length === 0 ? (
            <EmptyState label="Seçilen tarih aralığında ürün kullanımı bulunamadı." />
          ) : (
            <View className="flex flex-col gap-3">
              {rows.map((r, i) => (
                <Pressable
                  key={`${r.stockProductId ?? 'x'}-${r.name}-${i}`}
                  onPress={() => void openDetail(r)}
                  className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4 active:opacity-90"
                  style={cardShadow}
                >
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <Text className="text-sm font-extrabold text-primary">#{i + 1}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground">
                      {r.workOrderCount} iş emri · {r.totalQuantity} adet
                    </Text>
                  </View>
                  <Text className="text-sm font-extrabold text-foreground">{formatCurrency(r.totalRevenue)}</Text>
                  <ChevronRight size={18} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <AppSheet
        visible={!!detailRow}
        onClose={() => {
          setDetailRow(null)
          setDetail([])
        }}
        title={detailRow?.name ?? 'Hareketler'}
        subtitle={`${range.rangeLabel} · ${detail.length} hareket`}
      >
        {detailLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : detail.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta hareket bulunamadı.</Text>
        ) : (
          <View className="flex flex-col gap-2">
            {detail.map((d, i) => (
              <View key={i} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold text-foreground">{d.plate}</Text>
                  <Text className="text-sm font-extrabold text-foreground">
                    {formatCurrency(d.quantity * d.unitPrice)}
                  </Text>
                </View>
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  {d.customerName} · {d.quantity} adet × {formatCurrency(d.unitPrice)}
                </Text>
                <Text className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(d.date)}</Text>
              </View>
            ))}
          </View>
        )}
        <SheetCancelButton
          onPress={() => {
            setDetailRow(null)
            setDetail([])
          }}
          label="Kapat"
        />
      </AppSheet>
    </View>
  )
}

/* ---------------------------------------------------------------------
   2) Stok Alış–Satış Raporu
   ------------------------------------------------------------------- */

function StockPurchaseSaleScreen({ onBack }: { onBack: () => void }) {
  const range = usePeriodRange()
  const [rows, setRows] = useState<StockPurchaseSaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState<StockPurchaseSaleRow | null>(null)
  const [detail, setDetail] = useState<StockMovementDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    getStockPurchaseSaleReport(range.from, range.to)
      .then((r) => {
        if (active) setRows(r)
      })
      .catch(() => active && setRows([]))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])

  async function openDetail(row: StockPurchaseSaleRow) {
    setDetailRow(row)
    setDetail([])
    setDetailLoading(true)
    try {
      const rows2 = await getStockMovementDetail(row.stockProductId, row.name, range.from, range.to)
      setDetail(rows2)
    } catch {
      setDetail([])
    } finally {
      setDetailLoading(false)
    }
  }

  const totalPurchase = rows.reduce((s, r) => s + r.totalPurchaseAmount, 0)
  const totalSale = rows.reduce((s, r) => s + r.totalSaleAmount, 0)
  const totalProfit = totalSale - totalPurchase

  return (
    <View className="flex-1">
      <ReportHeader title="Stok Alış–Satış Raporu" subtitle={range.rangeLabel} onBack={onBack} />
      <PeriodBar {...range} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10">
          <View className="flex-row gap-2">
            <View className="flex-1 rounded-2xl border border-border bg-card p-3.5" style={cardShadow}>
              <Text className="text-[11px] font-semibold text-muted-foreground">Alış</Text>
              <Text className="mt-1 text-base font-extrabold text-foreground">{formatCurrency(totalPurchase)}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-3.5" style={cardShadow}>
              <Text className="text-[11px] font-semibold text-muted-foreground">Parça Satışı</Text>
              <Text className="mt-1 text-base font-extrabold text-foreground">{formatCurrency(totalSale)}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-3.5" style={cardShadow}>
              <Text className="text-[11px] font-semibold text-muted-foreground">Kâr</Text>
              <Text
                className={cn(
                  'mt-1 text-base font-extrabold',
                  totalProfit >= 0 ? 'text-chart-2' : 'text-destructive',
                )}
              >
                {formatCurrency(totalProfit)}
              </Text>
            </View>
          </View>

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">
            Ürün bazlı özet · detay için dokun
          </Text>

          {rows.length === 0 ? (
            <EmptyState label="Seçilen tarih aralığında alış/satış hareketi bulunamadı." />
          ) : (
            <View className="flex flex-col gap-3">
              {rows.map((r, i) => (
                <Pressable
                  key={`${r.stockProductId ?? 'x'}-${r.name}-${i}`}
                  onPress={() => void openDetail(r)}
                  className="rounded-2xl border border-border bg-card p-4 active:opacity-90"
                  style={cardShadow}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="min-w-0 flex-1 text-sm font-bold text-foreground" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <ChevronRight size={18} color={colors.mutedForeground} />
                  </View>
                  <Text className="mt-0.5 text-xs text-muted-foreground">{r.totalQuantity} adet kullanıldı</Text>
                  <View className="mt-2 flex-row items-center gap-4">
                    <Text className="text-xs font-semibold text-muted-foreground">
                      Alış: <Text className="text-foreground">{formatCurrency(r.totalPurchaseAmount)}</Text>
                    </Text>
                    <Text className="text-xs font-semibold text-muted-foreground">
                      Satış: <Text className="text-foreground">{formatCurrency(r.totalSaleAmount)}</Text>
                    </Text>
                    <Text
                      className={cn(
                        'text-xs font-bold',
                        r.profit >= 0 ? 'text-chart-2' : 'text-destructive',
                      )}
                    >
                      Kâr: {formatCurrency(r.profit)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <AppSheet
        visible={!!detailRow}
        onClose={() => {
          setDetailRow(null)
          setDetail([])
        }}
        title={detailRow?.name ?? 'Hareketler'}
        subtitle={`${range.rangeLabel} · ${detail.length} hareket`}
      >
        {detailLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : detail.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta hareket bulunamadı.</Text>
        ) : (
          <View className="flex flex-col gap-2">
            {detail.map((d, i) => (
              <View key={i} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold text-foreground">{d.plate}</Text>
                  <Text className="text-[11px] text-muted-foreground">{formatDate(d.date)}</Text>
                </View>
                <Text className="mt-0.5 text-xs text-muted-foreground">{d.customerName}</Text>
                <View className="mt-1.5 flex-row items-center gap-4">
                  <Text className="text-xs font-semibold text-muted-foreground">
                    Alış: <Text className="text-foreground">
                      {formatCurrency((d.purchasePrice ?? 0) * d.quantity)}
                    </Text>
                    {d.supplierName ? ` (${d.supplierName})` : ''}
                  </Text>
                  <Text className="text-xs font-semibold text-muted-foreground">
                    Satış: <Text className="text-foreground">{formatCurrency(d.unitPrice * d.quantity)}</Text>
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
        <SheetCancelButton
          onPress={() => {
            setDetailRow(null)
            setDetail([])
          }}
          label="Kapat"
        />
      </AppSheet>
    </View>
  )
}

/* ---------------------------------------------------------------------
   3) Cari Hareket Raporu
   ------------------------------------------------------------------- */

function AccountLedgerScreen({ onBack }: { onBack: () => void }) {
  const range = usePeriodRange()
  const [rows, setRows] = useState<AccountLedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState<AccountLedgerRow | null>(null)
  const [customerEntries, setCustomerEntries] = useState<CustomerLedgerEntry[]>([])
  const [supplierTxs, setSupplierTxs] = useState<SupplierTransaction[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedTx, setSelectedTx] = useState<SupplierTransaction | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    getAccountLedgerReport(range.from, range.to)
      .then((r) => {
        if (active) setRows(r)
      })
      .catch(() => active && setRows([]))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])

  async function openDetail(row: AccountLedgerRow) {
    setDetailRow(row)
    setCustomerEntries([])
    setSupplierTxs([])
    setDetailLoading(true)
    try {
      if (row.accountType === 'musteri') {
        const rows2 = await getCustomerLedgerDetail(row.accountId, range.from, range.to)
        setCustomerEntries(rows2)
      } else {
        const ledger = await getSupplierLedger(row.accountId)
        setSupplierTxs(ledger.transactions.filter((t) => inDateRange(t.createdAt, range.from, range.to)))
      }
    } catch {
      setCustomerEntries([])
      setSupplierTxs([])
    } finally {
      setDetailLoading(false)
    }
  }

  const totalDebit = rows.reduce((s, r) => s + r.totalDebit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.totalCredit, 0)

  return (
    <View className="flex-1">
      <ReportHeader title="Cari Hareket Raporu" subtitle={range.rangeLabel} onBack={onBack} />
      <PeriodBar {...range} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10">
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Toplam Borç</Text>
              <Text className="mt-1 text-lg font-extrabold text-destructive">{formatCurrency(totalDebit)}</Text>
              <Text className="mt-0.5 text-[10px] text-muted-foreground">İş emri + tedarikçi alış</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Tahsilat / Ödeme</Text>
              <Text className="mt-1 text-lg font-extrabold text-chart-2">{formatCurrency(totalCredit)}</Text>
              <Text className="mt-0.5 text-[10px] text-muted-foreground">Müşteri tahsilat + tedarikçi ödeme</Text>
            </View>
          </View>

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">
            Hareketi olan cariler · detay için dokun
          </Text>

          {rows.length === 0 ? (
            <EmptyState label="Seçilen tarih aralığında cari hareketi bulunamadı." />
          ) : (
            <View className="flex flex-col gap-3">
              {rows.map((r) => (
                <Pressable
                  key={`${r.accountType}-${r.accountId}`}
                  onPress={() => void openDetail(r)}
                  className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4 active:opacity-90"
                  style={cardShadow}
                >
                  <View
                    className={cn(
                      'h-11 w-11 items-center justify-center rounded-xl',
                      r.accountType === 'tedarikci' ? 'bg-accent/10' : 'bg-primary/10',
                    )}
                  >
                    {r.accountType === 'tedarikci' ? (
                      <Truck size={20} color={colors.accent} />
                    ) : (
                      <Wallet size={20} color={colors.primary} />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {r.accountName}
                    </Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground">
                      {r.accountType === 'tedarikci' ? 'Tedarikçi' : 'Müşteri'} · {r.movementCount} hareket · Bakiye{' '}
                      {formatCurrency(r.currentBalance)}
                    </Text>
                  </View>
                  <View className="items-end">
                    {r.totalDebit > 0 ? (
                      <Text className="text-xs font-bold text-destructive">-{formatCurrency(r.totalDebit)}</Text>
                    ) : null}
                    {r.totalCredit > 0 ? (
                      <Text className="text-xs font-bold text-chart-2">+{formatCurrency(r.totalCredit)}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <AppSheet
        visible={!!detailRow}
        onClose={() => {
          setDetailRow(null)
          setCustomerEntries([])
          setSupplierTxs([])
        }}
        title={detailRow?.accountName ?? 'Hareketler'}
        subtitle={range.rangeLabel}
      >
        {detailLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : detailRow?.accountType === 'tedarikci' ? (
          supplierTxs.length === 0 ? (
            <Text className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta hareket bulunamadı.</Text>
          ) : (
            <SupplierTxGroupedList transactions={supplierTxs} onPress={setSelectedTx} compact />
          )
        ) : customerEntries.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta hareket bulunamadı.</Text>
        ) : (
          <View className="flex flex-col gap-2">
            {customerEntries.map((e, i) => (
              <View key={i} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
                    {e.description}
                  </Text>
                  <Text
                    className={cn(
                      'text-sm font-extrabold',
                      e.type === 'borc' ? 'text-destructive' : 'text-chart-2',
                    )}
                  >
                    {e.type === 'borc' ? '-' : '+'}
                    {formatCurrency(e.amount)}
                  </Text>
                </View>
                <Text className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(e.date)}</Text>
              </View>
            ))}
          </View>
        )}
        <SheetCancelButton
          onPress={() => {
            setDetailRow(null)
            setCustomerEntries([])
            setSupplierTxs([])
          }}
          label="Kapat"
        />
      </AppSheet>

      <SupplierTxDetailSheet
        tx={selectedTx}
        supplierName={detailRow?.accountName}
        onClose={() => setSelectedTx(null)}
      />
    </View>
  )
}

/* ---------------------------------------------------------------------
   4) Satış Raporu
   ------------------------------------------------------------------- */

function SalesReportScreen({ onBack }: { onBack: () => void }) {
  const range = usePeriodRange()
  const [report, setReport] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getSalesReport(range.from, range.to)
      .then((r) => {
        if (active) setReport(r)
      })
      .catch(() => active && setReport(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])

  return (
    <View className="flex-1">
      <ReportHeader title="Satış Raporu" subtitle={range.rangeLabel} onBack={onBack} />
      <PeriodBar {...range} />

      {loading || !report ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10">
          <View className="rounded-2xl bg-foreground px-5 py-4">
            <Text className="text-sm font-semibold text-background/80">Toplam Ciro</Text>
            <Text className="mt-1 text-3xl font-extrabold text-background">
              {formatCurrency(report.totalRevenue)}
            </Text>
            <Text className="mt-0.5 text-xs text-background/60">
              Dönemde açılan {report.workOrderCount} iş emri · İskonto{' '}
              {formatCurrency(report.totalDiscount)}
            </Text>
          </View>

          <View className="mt-3 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Dönem Tahsilatı</Text>
              <Text className="mt-1 text-lg font-extrabold text-chart-2">
                {formatCurrency(report.totalPaid)}
              </Text>
              <Text className="mt-0.5 text-[10px] text-muted-foreground">Bu aralıkta alınan ödemeler</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Açık Bakiye</Text>
              <Text className="mt-1 text-lg font-extrabold text-destructive">
                {formatCurrency(report.totalOutstanding ?? 0)}
              </Text>
              <Text className="mt-0.5 text-[10px] text-muted-foreground">Dönem işlerinden kalan</Text>
            </View>
          </View>

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">
            Ödeme Yöntemi · dönem tahsilatı dağılımı
          </Text>
          <View className="flex flex-col gap-2">
            {(
              [
                { label: 'Nakit', value: report.nakit },
                { label: 'Kart', value: report.kart },
                { label: 'Havale', value: report.havale },
                { label: 'Diğer', value: report.diger },
              ] as const
            )
              .filter((m) => m.value > 0)
              .map((m) => (
                <View
                  key={m.label}
                  className="flex-row items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                >
                  <Text className="text-sm font-semibold text-foreground">{m.label}</Text>
                  <Text className="text-sm font-extrabold text-foreground">{formatCurrency(m.value)}</Text>
                </View>
              ))}
            {report.nakit + report.kart + report.havale + report.diger === 0 ? (
              <Text className="py-2 text-center text-sm text-muted-foreground">Bu aralıkta tahsilat yok.</Text>
            ) : null}
          </View>

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">En Çok Satılan Hizmetler</Text>
          {report.topServices.length === 0 ? (
            <Text className="py-2 text-center text-sm text-muted-foreground">Bu aralıkta işçilik kaydı yok.</Text>
          ) : (
            <View className="flex flex-col gap-2">
              {report.topServices.map((s, i) => (
                <View
                  key={`${s.title}-${i}`}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <Text className="text-xs font-extrabold text-muted-foreground">#{i + 1}</Text>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text className="text-xs text-muted-foreground">{s.count} kez</Text>
                  </View>
                  <Text className="text-sm font-extrabold text-foreground">{formatCurrency(s.totalAmount)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  )
}
