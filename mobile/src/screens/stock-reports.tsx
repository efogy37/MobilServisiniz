import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy'
import { openWebPrintPreview } from '@/lib/web-print-share'
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  ChevronRight,
  FileSpreadsheet,
  FileText,
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
  getStoredShopName,
  getSupplierLedger,
  type AccountLedgerRow,
  type CustomerLedgerEntry,
  type SalesReport,
  type StockMovementDetail,
  type StockPurchaseSaleGroupBy,
  type StockPurchaseSaleRow,
  type StockPurchaseSaleSupplierRow,
  type StockPurchaseSaleVehicleRow,
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
          <DateField
            label="Başlangıç"
            value={fromIso}
            onPress={() => setPicker('from')}
            onChangeIso={setFromIso}
          />
          <DateField
            label="Bitiş"
            value={toIsoDate}
            onPress={() => setPicker('to')}
            onChangeIso={setToIsoDate}
          />
        </View>
      ) : null}

      {/* Web'de DateTimePicker çalışmıyor — DateField native input kullanır */}
      {picker && Platform.OS !== 'web' ? (
        <DateTimePicker
          value={parseIso(picker === 'from' ? fromIso : toIsoDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            if (Platform.OS === 'android') setPicker(null)
            if (event.type === 'dismissed' || !date) return
            const iso = toIso(date)
            if (picker === 'from') setFromIso(iso)
            else setToIsoDate(iso)
            if (Platform.OS === 'ios') setPicker(null)
          }}
        />
      ) : null}
    </View>
  )
}

function DateField({
  label,
  value,
  onPress,
  onChangeIso,
}: {
  label: string
  value: string
  onPress: () => void
  onChangeIso?: (iso: string) => void
}) {
  if (Platform.OS === 'web' && onChangeIso) {
    return (
      <View className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5">
        <Text className="text-[11px] font-semibold text-muted-foreground">{label}</Text>
        <View className="mt-1 flex-row items-center gap-1.5">
          <Calendar size={14} color={colors.mutedForeground} />
          {/* RN Web: tarayıcı tarih seçici */}
          <input
            type="date"
            value={value}
            onChange={(e) => {
              const next = e.target.value
              if (next) onChangeIso(next)
            }}
            style={{
              border: 'none',
              background: 'transparent',
              fontWeight: 700,
              fontSize: 14,
              color: colors.foreground,
              outline: 'none',
              width: '100%',
              fontFamily: 'inherit',
              minHeight: 22,
            }}
          />
        </View>
      </View>
    )
  }

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
      title: 'Parça Kâr Raporu',
      subtitle: 'Ürün, araç veya tedarikçi bazlı alış–satış ve kâr',
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

function ProfitAmounts({
  purchase,
  sale,
  profit,
}: {
  purchase: number
  sale: number
  profit: number
}) {
  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-x-4 gap-y-1">
      <Text className="text-xs font-semibold text-muted-foreground">
        Alış: <Text className="text-foreground">{formatCurrency(purchase)}</Text>
      </Text>
      <Text className="text-xs font-semibold text-muted-foreground">
        Satış: <Text className="text-foreground">{formatCurrency(sale)}</Text>
      </Text>
      <Text className={cn('text-xs font-bold', profit >= 0 ? 'text-chart-2' : 'text-destructive')}>
        Kâr: {formatCurrency(profit)}
      </Text>
    </View>
  )
}

type ProfitExportRow = {
  col1: string
  col2: string
  quantity: number
  purchase: number
  sale: number
  profit: number
}

function groupByLabel(groupBy: StockPurchaseSaleGroupBy) {
  if (groupBy === 'vehicle') return 'Araç'
  if (groupBy === 'supplier') return 'Tedarikçi'
  return 'Ürün'
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function csvCell(value: string | number) {
  const s = String(value ?? '')
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function numTr(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',')
}

function buildProfitExportRows(
  groupBy: StockPurchaseSaleGroupBy,
  productRows: StockPurchaseSaleRow[],
  vehicleRows: StockPurchaseSaleVehicleRow[],
  supplierRows: StockPurchaseSaleSupplierRow[],
): ProfitExportRow[] {
  if (groupBy === 'vehicle') {
    return vehicleRows.map((r) => ({
      col1: r.plate,
      col2: [r.brand, r.model, r.customerName].filter(Boolean).join(' · '),
      quantity: r.totalQuantity,
      purchase: r.totalPurchaseAmount,
      sale: r.totalSaleAmount,
      profit: r.profit,
    }))
  }
  if (groupBy === 'supplier') {
    return supplierRows.map((r) => ({
      col1: r.supplierName,
      col2: r.source === 'disaridan' ? 'Dışarıdan' : 'Stok',
      quantity: r.totalQuantity,
      purchase: r.totalPurchaseAmount,
      sale: r.totalSaleAmount,
      profit: r.profit,
    }))
  }
  return productRows.map((r) => ({
    col1: r.name,
    col2: r.category?.trim() || '—',
    quantity: r.totalQuantity,
    purchase: r.totalPurchaseAmount,
    sale: r.totalSaleAmount,
    profit: r.profit,
  }))
}

function buildProfitCsv(
  groupBy: StockPurchaseSaleGroupBy,
  rangeLabel: string,
  shopName: string | null | undefined,
  rows: ProfitExportRow[],
) {
  const header1 =
    groupBy === 'vehicle' ? 'Plaka' : groupBy === 'supplier' ? 'Tedarikçi / Kaynak' : 'Ürün'
  const header2 =
    groupBy === 'vehicle' ? 'Araç / Müşteri' : groupBy === 'supplier' ? 'Kaynak tipi' : 'Kategori'
  const lines = [
    csvCell('Parça Kâr Raporu'),
    csvCell(shopName?.trim() || ''),
    csvCell(`Dönem: ${rangeLabel}`),
    csvCell(`Görünüm: ${groupByLabel(groupBy)}`),
    '',
    [header1, header2, 'Adet', 'Alış', 'Satış', 'Kâr'].map(csvCell).join(';'),
    ...rows.map((r) =>
      [r.col1, r.col2, r.quantity, numTr(r.purchase), numTr(r.sale), numTr(r.profit)]
        .map(csvCell)
        .join(';'),
    ),
    '',
    [
      'TOPLAM',
      '',
      rows.reduce((s, r) => s + r.quantity, 0),
      numTr(rows.reduce((s, r) => s + r.purchase, 0)),
      numTr(rows.reduce((s, r) => s + r.sale, 0)),
      numTr(rows.reduce((s, r) => s + r.profit, 0)),
    ]
      .map(csvCell)
      .join(';'),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

function buildProfitPdfHtml(
  groupBy: StockPurchaseSaleGroupBy,
  rangeLabel: string,
  shopName: string | null | undefined,
  rows: ProfitExportRow[],
) {
  const header1 =
    groupBy === 'vehicle' ? 'Plaka' : groupBy === 'supplier' ? 'Tedarikçi' : 'Ürün'
  const header2 =
    groupBy === 'vehicle' ? 'Detay' : groupBy === 'supplier' ? 'Kaynak' : 'Kategori'
  const shop = shopName?.trim()
  const totalPurchase = rows.reduce((s, r) => s + r.purchase, 0)
  const totalSale = rows.reduce((s, r) => s + r.sale, 0)
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0)
  const body = rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.col1)}</td>
      <td>${escapeHtml(r.col2)}</td>
      <td class="num">${r.quantity}</td>
      <td class="num">${escapeHtml(formatCurrency(r.purchase))}</td>
      <td class="num">${escapeHtml(formatCurrency(r.sale))}</td>
      <td class="num ${r.profit >= 0 ? 'pos' : 'neg'}">${escapeHtml(formatCurrency(r.profit))}</td>
    </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 24px; }
  .shop { font-size: 22px; font-weight: 800; text-align: center; letter-spacing: .03em; margin: 0 0 8px; text-transform: uppercase; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .cards { display: flex; gap: 8px; margin-bottom: 16px; }
  .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }
  .card .l { font-size: 11px; color: #6b7280; }
  .card .v { font-size: 15px; font-weight: 800; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #eee; padding: 8px 6px; font-size: 12px; text-align: left; vertical-align: top; }
  th { color: #6b7280; font-size: 11px; }
  .num { text-align: right; white-space: nowrap; }
  .pos { color: #15803d; font-weight: 700; }
  .neg { color: #b91c1c; font-weight: 700; }
  tfoot td { font-weight: 800; border-top: 2px solid #1a1a1a; padding-top: 10px; }
</style>
</head>
<body>
  ${shop ? `<div class="shop">${escapeHtml(shop.toLocaleUpperCase('tr-TR'))}</div>` : ''}
  <h1>Parça Kâr Raporu</h1>
  <div class="meta">${escapeHtml(rangeLabel)} · ${escapeHtml(groupByLabel(groupBy))} görünümü · işçilik hariç</div>
  <div class="cards">
    <div class="card"><div class="l">Alış</div><div class="v">${escapeHtml(formatCurrency(totalPurchase))}</div></div>
    <div class="card"><div class="l">Parça Satışı</div><div class="v">${escapeHtml(formatCurrency(totalSale))}</div></div>
    <div class="card"><div class="l">Kâr</div><div class="v ${totalProfit >= 0 ? 'pos' : 'neg'}">${escapeHtml(formatCurrency(totalProfit))}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(header1)}</th>
        <th>${escapeHtml(header2)}</th>
        <th class="num">Adet</th>
        <th class="num">Alış</th>
        <th class="num">Satış</th>
        <th class="num">Kâr</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr>
        <td>Toplam</td>
        <td></td>
        <td class="num">${rows.reduce((s, r) => s + r.quantity, 0)}</td>
        <td class="num">${escapeHtml(formatCurrency(totalPurchase))}</td>
        <td class="num">${escapeHtml(formatCurrency(totalSale))}</td>
        <td class="num ${totalProfit >= 0 ? 'pos' : 'neg'}">${escapeHtml(formatCurrency(totalProfit))}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`
}

function openHtmlPrintPreview(html: string) {
  openWebPrintPreview(html, {
    title: 'Parça kâr raporu',
    filename: 'parca-kar-raporu.html',
  })
}

function downloadWebFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function shareNativeFile(uri: string, mimeType: string, uti?: string) {
  const canShare = await Sharing.isAvailableAsync()
  if (!canShare) {
    Alert.alert('Paylaşım', 'Bu cihazda paylaşım kullanılamıyor.')
    return
  }
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle: 'Raporu paylaş' })
}

function StockPurchaseSaleScreen({ onBack }: { onBack: () => void }) {
  const range = usePeriodRange()
  const [groupBy, setGroupBy] = useState<StockPurchaseSaleGroupBy>('product')
  const [productRows, setProductRows] = useState<StockPurchaseSaleRow[]>([])
  const [vehicleRows, setVehicleRows] = useState<StockPurchaseSaleVehicleRow[]>([])
  const [supplierRows, setSupplierRows] = useState<StockPurchaseSaleSupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailTitle, setDetailTitle] = useState<string | null>(null)
  const [detail, setDetail] = useState<StockMovementDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    getStockPurchaseSaleReport(range.from, range.to, groupBy)
      .then((r) => {
        if (!active) return
        if (groupBy === 'vehicle') {
          setVehicleRows(r as StockPurchaseSaleVehicleRow[])
          setProductRows([])
          setSupplierRows([])
        } else if (groupBy === 'supplier') {
          setSupplierRows(r as StockPurchaseSaleSupplierRow[])
          setProductRows([])
          setVehicleRows([])
        } else {
          setProductRows(r as StockPurchaseSaleRow[])
          setVehicleRows([])
          setSupplierRows([])
        }
      })
      .catch(() => {
        if (!active) return
        setProductRows([])
        setVehicleRows([])
        setSupplierRows([])
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, groupBy])

  const activeRows =
    groupBy === 'vehicle' ? vehicleRows : groupBy === 'supplier' ? supplierRows : productRows
  const totalPurchase = activeRows.reduce((s, r) => s + r.totalPurchaseAmount, 0)
  const totalSale = activeRows.reduce((s, r) => s + r.totalSaleAmount, 0)
  const totalProfit = totalSale - totalPurchase

  async function openProductDetail(row: StockPurchaseSaleRow) {
    setDetailTitle(row.name)
    setDetail([])
    setDetailLoading(true)
    try {
      setDetail(await getStockMovementDetail(row.stockProductId, row.name, range.from, range.to))
    } catch {
      setDetail([])
    } finally {
      setDetailLoading(false)
    }
  }

  async function openVehicleDetail(row: StockPurchaseSaleVehicleRow) {
    const label = [row.plate, row.brand, row.model].filter(Boolean).join(' · ')
    setDetailTitle(label)
    setDetail([])
    setDetailLoading(true)
    try {
      setDetail(
        await getStockMovementDetail(null, null, range.from, range.to, {
          vehicleId: row.vehicleId,
        }),
      )
    } catch {
      setDetail([])
    } finally {
      setDetailLoading(false)
    }
  }

  async function openSupplierDetail(row: StockPurchaseSaleSupplierRow) {
    setDetailTitle(row.supplierName)
    setDetail([])
    setDetailLoading(true)
    try {
      setDetail(
        await getStockMovementDetail(null, null, range.from, range.to, {
          supplierId: row.supplierId,
          source: row.source,
        }),
      )
    } catch {
      setDetail([])
    } finally {
      setDetailLoading(false)
    }
  }

  const groupTabs: { key: StockPurchaseSaleGroupBy; label: string }[] = [
    { key: 'product', label: 'Ürün' },
    { key: 'vehicle', label: 'Araç' },
    { key: 'supplier', label: 'Tedarikçi' },
  ]

  const listHint =
    groupBy === 'vehicle'
      ? 'Araç bazlı özet · detay için dokun'
      : groupBy === 'supplier'
        ? 'Tedarikçi / stok özeti · Samet Oto gibi dışarıdan temin dahil'
        : 'Ürün bazlı özet · detay için dokun'

  const exportRows = buildProfitExportRows(groupBy, productRows, vehicleRows, supplierRows)
  const fileStamp = `${range.from}_${range.to}_${groupBy}`

  async function exportPdf() {
    if (exportRows.length === 0 || exporting) return
    setExporting('pdf')
    try {
      const shopName = await getStoredShopName()
      const html = buildProfitPdfHtml(groupBy, range.rangeLabel, shopName, exportRows)
      if (Platform.OS === 'web') {
        openHtmlPrintPreview(html)
        return
      }
      const { uri } = await Print.printToFileAsync({ html })
      await shareNativeFile(uri, 'application/pdf', 'com.adobe.pdf')
    } catch (e) {
      Alert.alert('PDF', e instanceof Error ? e.message : 'PDF oluşturulamadı.')
    } finally {
      setExporting(null)
    }
  }

  async function exportExcel() {
    if (exportRows.length === 0 || exporting) return
    setExporting('excel')
    try {
      const shopName = await getStoredShopName()
      const csv = buildProfitCsv(groupBy, range.rangeLabel, shopName, exportRows)
      const filename = `parca-kar-raporu_${fileStamp}.csv`
      if (Platform.OS === 'web') {
        downloadWebFile(filename, csv, 'text/csv;charset=utf-8;')
        return
      }
      if (!cacheDirectory) throw new Error('Dosya klasörü bulunamadı.')
      const uri = `${cacheDirectory}${filename}`
      await writeAsStringAsync(uri, csv, { encoding: EncodingType.UTF8 })
      await shareNativeFile(uri, 'text/csv', 'public.comma-separated-values-text')
    } catch (e) {
      Alert.alert('Excel', e instanceof Error ? e.message : 'Excel dosyası oluşturulamadı.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <View className="flex-1">
      <ReportHeader title="Parça Kâr Raporu" subtitle={range.rangeLabel} onBack={onBack} />
      <PeriodBar {...range} />

      <View className="px-5 pb-2">
        <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
          {groupTabs.map((tab) => {
            const active = groupBy === tab.key
            return (
              <Pressable
                key={tab.key}
                onPress={() => setGroupBy(tab.key)}
                className={cn('h-10 flex-1 items-center justify-center rounded-xl', active ? 'bg-card' : '')}
                style={active ? cardShadow : undefined}
              >
                <Text className={cn('text-xs font-bold', active ? 'text-foreground' : 'text-muted-foreground')}>
                  {tab.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10">
          <View className="flex-row gap-2">
            <View className="flex-1 rounded-2xl border border-border bg-card p-3.5" style={cardShadow}>
              <Text className="text-[11px] font-semibold text-muted-foreground">Alış</Text>
              <Text className="mt-1 text-base font-extrabold text-foreground">
                {formatCurrency(totalPurchase)}
              </Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-3.5" style={cardShadow}>
              <Text className="text-[11px] font-semibold text-muted-foreground">Parça Satışı</Text>
              <Text className="mt-1 text-base font-extrabold text-foreground">
                {formatCurrency(totalSale)}
              </Text>
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

          {activeRows.length > 0 ? (
            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => void exportExcel()}
                disabled={!!exporting}
                className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card active:opacity-90"
                style={cardShadow}
              >
                {exporting === 'excel' ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <FileSpreadsheet size={18} color={colors.primary} />
                )}
                <Text className="text-sm font-bold text-foreground">Excel</Text>
              </Pressable>
              <Pressable
                onPress={() => void exportPdf()}
                disabled={!!exporting}
                className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card active:opacity-90"
                style={cardShadow}
              >
                {exporting === 'pdf' ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <FileText size={18} color={colors.primary} />
                )}
                <Text className="text-sm font-bold text-foreground">PDF</Text>
              </Pressable>
            </View>
          ) : null}

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">{listHint}</Text>

          {activeRows.length === 0 ? (
            <EmptyState label="Seçilen tarih aralığında alış/satış hareketi bulunamadı." />
          ) : groupBy === 'vehicle' ? (
            <View className="flex flex-col gap-3">
              {vehicleRows.map((r) => (
                <Pressable
                  key={r.vehicleId}
                  onPress={() => void openVehicleDetail(r)}
                  className="rounded-2xl border border-border bg-card p-4 active:opacity-90"
                  style={cardShadow}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="min-w-0 flex-1 text-sm font-bold text-foreground" numberOfLines={1}>
                      {r.plate}
                    </Text>
                    <ChevronRight size={18} color={colors.mutedForeground} />
                  </View>
                  <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
                    {[r.brand, r.model].filter(Boolean).join(' ')}
                    {r.customerName ? ` · ${r.customerName}` : ''}
                    {` · ${r.totalQuantity} adet`}
                  </Text>
                  <ProfitAmounts
                    purchase={r.totalPurchaseAmount}
                    sale={r.totalSaleAmount}
                    profit={r.profit}
                  />
                </Pressable>
              ))}
            </View>
          ) : groupBy === 'supplier' ? (
            <View className="flex flex-col gap-3">
              {supplierRows.map((r, i) => (
                <Pressable
                  key={`${r.source}-${r.supplierId ?? 'x'}-${i}`}
                  onPress={() => void openSupplierDetail(r)}
                  className="rounded-2xl border border-border bg-card p-4 active:opacity-90"
                  style={cardShadow}
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="min-w-0 flex-1 text-sm font-bold text-foreground" numberOfLines={1}>
                      {r.supplierName}
                    </Text>
                    <Text className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {r.source === 'disaridan' ? 'Dışarıdan' : 'Stok'}
                    </Text>
                    <ChevronRight size={18} color={colors.mutedForeground} />
                  </View>
                  <Text className="mt-0.5 text-xs text-muted-foreground">{r.totalQuantity} adet kullanıldı</Text>
                  <ProfitAmounts
                    purchase={r.totalPurchaseAmount}
                    sale={r.totalSaleAmount}
                    profit={r.profit}
                  />
                </Pressable>
              ))}
            </View>
          ) : (
            <View className="flex flex-col gap-3">
              {productRows.map((r, i) => (
                <Pressable
                  key={`${r.stockProductId ?? 'x'}-${r.name}-${i}`}
                  onPress={() => void openProductDetail(r)}
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
                  <ProfitAmounts
                    purchase={r.totalPurchaseAmount}
                    sale={r.totalSaleAmount}
                    profit={r.profit}
                  />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <AppSheet
        visible={!!detailTitle}
        onClose={() => {
          setDetailTitle(null)
          setDetail([])
        }}
        title={detailTitle ?? 'Hareketler'}
        subtitle={`${range.rangeLabel} · ${detail.length} hareket`}
      >
        {detailLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : detail.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">
            Bu aralıkta hareket bulunamadı.
          </Text>
        ) : (
          <View className="flex flex-col gap-2">
            {detail.map((d, i) => {
              const purchase = (d.purchasePrice ?? 0) * d.quantity
              const sale = d.unitPrice * d.quantity
              const profit = sale - purchase
              const partLabel = d.partName?.trim() || 'Parça'
              return (
                <View key={i} className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="min-w-0 flex-1 text-sm font-bold text-foreground" numberOfLines={2}>
                      {partLabel}
                    </Text>
                    <Text className="text-[11px] text-muted-foreground">{formatDate(d.date)}</Text>
                  </View>
                  <Text className="mt-0.5 text-xs text-muted-foreground">
                    {d.plate}
                    {d.customerName ? ` · ${d.customerName}` : ''}
                    {` · ${d.quantity} adet`}
                  </Text>
                  {d.supplierName ? (
                    <Text className="mt-0.5 text-[11px] text-muted-foreground">Kaynak: {d.supplierName}</Text>
                  ) : null}
                  <ProfitAmounts purchase={purchase} sale={sale} profit={profit} />
                </View>
              )
            })}
          </View>
        )}
        <SheetCancelButton
          onPress={() => {
            setDetailTitle(null)
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

          <RankedSalesSection
            title="En Çok Yapılan İşler"
            emptyText="Bu aralıkta işçilik kaydı yok."
            rows={report.topJobs.map((j) => ({
              key: j.title,
              label: j.title,
              meta: `${j.count} kez`,
              amount: j.totalAmount,
            }))}
          />

          <RankedSalesSection
            title="En Çok Satılan Hizmetler"
            emptyText="Bu aralıkta hizmet kaydı yok."
            rows={report.topServices.map((s) => ({
              key: s.title,
              label: s.title,
              meta: `${s.count} kez`,
              amount: s.totalAmount,
            }))}
          />

          <RankedSalesSection
            title="En Çok Satılan Yedek Parçalar"
            emptyText="Bu aralıkta yedek parça satışı yok."
            rows={report.topParts.map((p) => ({
              key: p.name,
              label: p.name,
              meta: `${p.quantity} adet`,
              amount: p.totalAmount,
            }))}
          />
        </ScrollView>
      )}
    </View>
  )
}

function RankedSalesSection({
  title,
  emptyText,
  rows,
}: {
  title: string
  emptyText: string
  rows: { key: string; label: string; meta: string; amount: number }[]
}) {
  return (
    <View>
      <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">{title}</Text>
      {rows.length === 0 ? (
        <Text className="py-2 text-center text-sm text-muted-foreground">{emptyText}</Text>
      ) : (
        <View className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <View
              key={`${row.key}-${i}`}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <Text className="text-xs font-extrabold text-muted-foreground">#{i + 1}</Text>
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                  {row.label}
                </Text>
                <Text className="text-xs text-muted-foreground">{row.meta}</Text>
              </View>
              <Text className="text-sm font-extrabold text-foreground">
                {formatCurrency(row.amount)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
