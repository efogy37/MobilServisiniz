import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy'
import {
  BarChart3,
  Calendar,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Search,
  Share2,
  Truck,
  X,
} from 'lucide-react-native'
import { cn } from '@/lib/utils'
import {
  getStoredShopName,
  getSupplierLedger,
  getSupplierReport,
  type SupplierReportRow,
  type SupplierTransaction,
} from '@/lib/api'
import { formatCurrency, formatDate, formatTime, toTurkeyDateKey } from '@/lib/format'
import { colors, withAlpha } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'
import { AppSheet, SheetActionList, SheetCancelButton } from '@/components/app-modal'
import {
  SUPPLIER_METHOD_LABELS,
  SUPPLIER_TX_LABELS,
  formatSupplierDescription,
  SupplierTxDetailSheet,
  SupplierTxGroupedList,
  vehicleLabel,
} from '@/components/supplier-tx-detail'
import { openWebPrintPreview } from '@/lib/web-print-share'

type Period = 'daily' | 'weekly' | 'custom'
type ExportKind = 'pdf' | 'excel' | null

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
  const d = parseIso(iso)
  return d.toLocaleDateString('tr-TR')
}

function startOfWeek(d: Date) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (copy.getDay() + 6) % 7 // Pazartesi = 0
  copy.setDate(copy.getDate() - day)
  return copy
}

function endOfWeek(d: Date) {
  const start = startOfWeek(d)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return end
}

function inDateRange(iso: string, fromIso: string, toIso: string) {
  const d = toTurkeyDateKey(iso)
  const from = fromIso <= toIso ? fromIso : toIso
  const to = fromIso <= toIso ? toIso : fromIso
  return d >= from && d <= to
}

function escHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function csvCell(v: string | number) {
  const s = String(v ?? '')
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
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

function txTypeLabel(type: string) {
  return SUPPLIER_TX_LABELS[type] ?? type
}

function buildSummaryCsv(
  shopName: string,
  rangeLabel: string,
  rows: SupplierReportRow[],
  totalPurchases: number,
  totalReturns: number,
) {
  const lines = [
    csvCell('Tedarikçi Raporu'),
    csvCell(shopName),
    csvCell(rangeLabel),
    '',
    ['Tedarikçi', 'Hareket', 'Alış', 'İade'].map(csvCell).join(';'),
    ...rows.map((r) =>
      [
        r.supplierName,
        r.transactionCount,
        r.totalPurchases.toFixed(2).replace('.', ','),
        r.totalReturns.toFixed(2).replace('.', ','),
      ]
        .map(csvCell)
        .join(';'),
    ),
    '',
    ['TOPLAM', '', totalPurchases.toFixed(2).replace('.', ','), totalReturns.toFixed(2).replace('.', ',')]
      .map(csvCell)
      .join(';'),
  ]
  return `\uFEFF${lines.join('\n')}`
}

function buildSummaryPdfHtml(
  shopName: string,
  rangeLabel: string,
  rows: SupplierReportRow[],
  totalPurchases: number,
  totalReturns: number,
) {
  const bodyRows = rows
    .map(
      (r) => `<tr>
      <td>${escHtml(r.supplierName)}</td>
      <td style="text-align:center">${r.transactionCount}</td>
      <td style="text-align:right">${escHtml(formatCurrency(r.totalPurchases))}</td>
      <td style="text-align:right">${escHtml(formatCurrency(r.totalReturns))}</td>
    </tr>`,
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"/>
<title>Tedarikçi Raporu</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;padding:24px;font-size:13px}
  h1{font-size:20px;margin:0 0 4px;color:#2f4a86}
  .muted{color:#6b7280;margin:0 0 16px}
  .cards{display:flex;gap:12px;margin-bottom:18px}
  .card{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:12px}
  .card .lbl{font-size:11px;color:#6b7280;font-weight:700}
  .card .val{font-size:18px;font-weight:800;margin-top:4px}
  table{width:100%;border-collapse:collapse}
  th,td{border-bottom:1px solid #e5e7eb;padding:8px 6px;text-align:left}
  th{font-size:11px;color:#6b7280;text-transform:uppercase}
  tfoot td{font-weight:800;border-top:2px solid #2f4a86}
</style></head><body>
  <h1>Tedarikçi Raporu</h1>
  <p class="muted">${escHtml(shopName)} · ${escHtml(rangeLabel)}</p>
  <div class="cards">
    <div class="card"><div class="lbl">Toplam Alış</div><div class="val">${escHtml(formatCurrency(totalPurchases))}</div></div>
    <div class="card"><div class="lbl">Toplam İade</div><div class="val" style="color:#16a34a">${escHtml(formatCurrency(totalReturns))}</div></div>
  </div>
  <table>
    <thead><tr><th>Tedarikçi</th><th style="text-align:center">Hareket</th><th style="text-align:right">Alış</th><th style="text-align:right">İade</th></tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr>
      <td>Toplam</td><td></td>
      <td style="text-align:right">${escHtml(formatCurrency(totalPurchases))}</td>
      <td style="text-align:right">${escHtml(formatCurrency(totalReturns))}</td>
    </tr></tfoot>
  </table>
</body></html>`
}

function buildDetailCsv(
  shopName: string,
  supplierName: string,
  rangeLabel: string,
  txs: SupplierTransaction[],
) {
  const lines = [
    csvCell('Tedarikçi Hareket Raporu'),
    csvCell(shopName),
    csvCell(supplierName),
    csvCell(rangeLabel),
    '',
    ['Tarih', 'Saat', 'Tür', 'Ürün', 'Adet', 'Plaka', 'Araç', 'Yöntem', 'Açıklama', 'Tutar']
      .map(csvCell)
      .join(';'),
    ...txs.map((t) =>
      [
        formatDate(t.createdAt),
        formatTime(t.createdAt),
        txTypeLabel(t.type),
        t.partName ?? '',
        t.partQuantity ?? '',
        t.plate ?? '',
        vehicleLabel(t) ?? '',
        t.method ? SUPPLIER_METHOD_LABELS[t.method] ?? t.method : '',
        formatSupplierDescription(t.description) ?? '',
        t.amount.toFixed(2).replace('.', ','),
      ]
        .map(csvCell)
        .join(';'),
    ),
  ]
  return `\uFEFF${lines.join('\n')}`
}

function buildDetailPdfHtml(
  shopName: string,
  supplierName: string,
  rangeLabel: string,
  txs: SupplierTransaction[],
  totalPurchases: number,
  totalReturns: number,
) {
  const bodyRows = txs
    .map((t) => {
      const sub = [t.partName, t.plate, vehicleLabel(t)].filter(Boolean).join(' · ')
      return `<tr>
        <td>${escHtml(formatDate(t.createdAt))}<br/><span style="color:#6b7280;font-size:11px">${escHtml(formatTime(t.createdAt))}</span></td>
        <td>${escHtml(txTypeLabel(t.type))}${sub ? `<br/><span style="color:#6b7280;font-size:11px">${escHtml(sub)}</span>` : ''}</td>
        <td style="text-align:right;font-weight:700">${escHtml(formatCurrency(t.amount))}</td>
      </tr>`
    })
    .join('')
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"/>
<title>${escHtml(supplierName)} — Tedarikçi Raporu</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;padding:24px;font-size:13px}
  h1{font-size:20px;margin:0 0 4px;color:#2f4a86}
  .muted{color:#6b7280;margin:0 0 16px}
  .cards{display:flex;gap:12px;margin-bottom:18px}
  .card{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:12px}
  .card .lbl{font-size:11px;color:#6b7280;font-weight:700}
  .card .val{font-size:18px;font-weight:800;margin-top:4px}
  table{width:100%;border-collapse:collapse}
  th,td{border-bottom:1px solid #e5e7eb;padding:8px 6px;text-align:left;vertical-align:top}
  th{font-size:11px;color:#6b7280;text-transform:uppercase}
</style></head><body>
  <h1>${escHtml(supplierName)}</h1>
  <p class="muted">${escHtml(shopName)} · Tedarikçi hareket raporu · ${escHtml(rangeLabel)}</p>
  <div class="cards">
    <div class="card"><div class="lbl">Alış</div><div class="val">${escHtml(formatCurrency(totalPurchases))}</div></div>
    <div class="card"><div class="lbl">İade</div><div class="val" style="color:#16a34a">${escHtml(formatCurrency(totalReturns))}</div></div>
    <div class="card"><div class="lbl">Hareket</div><div class="val">${txs.length}</div></div>
  </div>
  <table>
    <thead><tr><th>Tarih</th><th>Hareket</th><th style="text-align:right">Tutar</th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="3">Hareket yok</td></tr>'}</tbody>
  </table>
</body></html>`
}

export function SupplierReport({ onBack: _onBack }: { onBack: () => void }) {
  const today = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState<Period>('daily')
  const [fromIso, setFromIso] = useState(toIso(today))
  const [toIsoDate, setToIsoDate] = useState(toIso(today))
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [rows, setRows] = useState<SupplierReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState<SupplierReportRow | null>(null)
  const [detailTxs, setDetailTxs] = useState<SupplierTransaction[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedTx, setSelectedTx] = useState<SupplierTransaction | null>(null)
  const [detailQuery, setDetailQuery] = useState('')
  const [exporting, setExporting] = useState<ExportKind>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [detailExporting, setDetailExporting] = useState<ExportKind>(null)

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
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    const from = fromIso <= toIsoDate ? fromIso : toIsoDate
    const to = fromIso <= toIsoDate ? toIsoDate : fromIso
    getSupplierReport(from, to)
      .then((r) => {
        if (active) setRows(r)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fromIso, toIsoDate])

  async function openSupplierDetail(row: SupplierReportRow) {
    setDetailRow(row)
    setDetailTxs([])
    setDetailQuery('')
    setDetailLoading(true)
    try {
      const ledger = await getSupplierLedger(row.supplierId)
      const from = fromIso <= toIsoDate ? fromIso : toIsoDate
      const to = fromIso <= toIsoDate ? toIsoDate : fromIso
      setDetailTxs(ledger.transactions.filter((t) => inDateRange(t.createdAt, from, to)))
    } catch {
      setDetailTxs([])
    } finally {
      setDetailLoading(false)
    }
  }

  const filteredDetailTxs = useMemo(() => {
    const q = detailQuery.trim().toLocaleLowerCase('tr')
    if (!q) return detailTxs
    return detailTxs.filter((t) => {
      const plate = t.plate?.toLocaleLowerCase('tr') ?? ''
      const partName = t.partName?.toLocaleLowerCase('tr') ?? ''
      return plate.includes(q) || partName.includes(q)
    })
  }, [detailTxs, detailQuery])

  const totalPurchases = rows.reduce((s, r) => s + r.totalPurchases, 0)
  const totalReturns = rows.reduce((s, r) => s + r.totalReturns, 0)
  const rangeFrom = fromIso <= toIsoDate ? fromIso : toIsoDate
  const rangeTo = fromIso <= toIsoDate ? toIsoDate : fromIso
  const rangeLabel = `${formatTr(rangeFrom)} – ${formatTr(rangeTo)}`
  const fileStamp = `${rangeFrom}_${rangeTo}`

  async function exportSummaryPdf() {
    if (rows.length === 0 || exporting) return
    setExporting('pdf')
    try {
      const shopName = (await getStoredShopName()) || 'MobilServisiniz'
      const html = buildSummaryPdfHtml(shopName, rangeLabel, rows, totalPurchases, totalReturns)
      if (Platform.OS === 'web') {
        openWebPrintPreview(html, {
          title: 'Tedarikçi Raporu',
          filename: `tedarikci-raporu_${fileStamp}.html`,
        })
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

  async function exportSummaryExcel() {
    if (rows.length === 0 || exporting) return
    setExporting('excel')
    try {
      const shopName = (await getStoredShopName()) || 'MobilServisiniz'
      const csv = buildSummaryCsv(shopName, rangeLabel, rows, totalPurchases, totalReturns)
      const filename = `tedarikci-raporu_${fileStamp}.csv`
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

  async function exportDetailPdf() {
    if (!detailRow || detailTxs.length === 0 || detailExporting) return
    setDetailExporting('pdf')
    try {
      const shopName = (await getStoredShopName()) || 'MobilServisiniz'
      const html = buildDetailPdfHtml(
        shopName,
        detailRow.supplierName,
        rangeLabel,
        filteredDetailTxs.length > 0 ? filteredDetailTxs : detailTxs,
        detailRow.totalPurchases,
        detailRow.totalReturns,
      )
      const safe = detailRow.supplierName.replace(/[^\w\-]+/g, '_').slice(0, 40)
      if (Platform.OS === 'web') {
        openWebPrintPreview(html, {
          title: detailRow.supplierName,
          filename: `tedarikci_${safe}_${fileStamp}.html`,
        })
        return
      }
      const { uri } = await Print.printToFileAsync({ html })
      await shareNativeFile(uri, 'application/pdf', 'com.adobe.pdf')
    } catch (e) {
      Alert.alert('PDF', e instanceof Error ? e.message : 'PDF oluşturulamadı.')
    } finally {
      setDetailExporting(null)
      setShareOpen(false)
    }
  }

  async function exportDetailExcel() {
    if (!detailRow || detailTxs.length === 0 || detailExporting) return
    setDetailExporting('excel')
    try {
      const shopName = (await getStoredShopName()) || 'MobilServisiniz'
      const txs = filteredDetailTxs.length > 0 ? filteredDetailTxs : detailTxs
      const csv = buildDetailCsv(shopName, detailRow.supplierName, rangeLabel, txs)
      const safe = detailRow.supplierName.replace(/[^\w\-]+/g, '_').slice(0, 40)
      const filename = `tedarikci_${safe}_${fileStamp}.csv`
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
      setDetailExporting(null)
      setShareOpen(false)
    }
  }

  return (
    <View className="flex-1">
      <View className="bg-background px-5 pb-3 pt-3">
        <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
          {(
            [
              { key: 'daily' as const, label: 'Günlük' },
              { key: 'weekly' as const, label: 'Haftalık' },
              { key: 'custom' as const, label: 'Tarih Aralığı' },
            ] as const
          ).map((opt) => {
            const active = period === opt.key
            return (
              <Pressable
                key={opt.key}
                onPress={() => applyPreset(opt.key)}
                className={cn(
                  'h-10 flex-1 items-center justify-center rounded-xl',
                  active ? 'bg-card' : '',
                )}
                style={active ? cardShadow : undefined}
              >
                <Text
                  className={cn(
                    'text-xs font-bold',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
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

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10">
          <Text className="mb-3 text-xs font-semibold text-muted-foreground">{rangeLabel}</Text>

          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Toplam Alış</Text>
              <Text className="mt-1 text-lg font-extrabold text-foreground">
                {formatCurrency(totalPurchases)}
              </Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
              <Text className="text-xs font-semibold text-muted-foreground">Toplam İade</Text>
              <Text className="mt-1 text-lg font-extrabold text-chart-4">
                {formatCurrency(totalReturns)}
              </Text>
            </View>
          </View>

          {rows.length > 0 ? (
            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => void exportSummaryExcel()}
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
                onPress={() => void exportSummaryPdf()}
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

          <Text className="mb-2 mt-5 text-sm font-bold text-muted-foreground">
            Tedarikçiler · detay için dokun
          </Text>

          {rows.length === 0 ? (
            <View className="mt-10 items-center">
              <View className="h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <BarChart3 size={32} color={colors.mutedForeground} />
              </View>
              <Text className="mt-4 text-base font-bold text-foreground">
                Bu dönemde hareket yok
              </Text>
              <Text className="mt-1 text-sm text-muted-foreground">
                Seçilen tarih aralığında tedarikçi hareketi bulunamadı.
              </Text>
            </View>
          ) : (
            <View className="flex flex-col gap-3">
              {rows.map((r) => (
                <Pressable
                  key={r.supplierId}
                  onPress={() => void openSupplierDetail(r)}
                  className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4 active:opacity-90"
                  style={cardShadow}
                >
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <Truck size={20} color={colors.primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                      {r.supplierName}
                    </Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground">
                      {r.transactionCount} hareket · detayı aç
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-extrabold text-foreground">
                      {formatCurrency(r.totalPurchases)}
                    </Text>
                    {r.totalReturns > 0 ? (
                      <Text className="mt-0.5 text-xs font-semibold text-chart-4">
                        İade: {formatCurrency(r.totalReturns)}
                      </Text>
                    ) : null}
                  </View>
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
          setDetailTxs([])
          setDetailQuery('')
          setShareOpen(false)
        }}
        title={detailRow?.supplierName ?? 'Hareketler'}
        subtitle={`${rangeLabel} · ${detailTxs.length} hareket`}
      >
        {detailLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : detailTxs.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">
            Bu aralıkta hareket bulunamadı.
          </Text>
        ) : (
          <>
            <View className="mb-3 flex-row gap-2">
              <Pressable
                onPress={() => setShareOpen(true)}
                className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-90"
              >
                <Share2 size={16} color={colors.primaryForeground} />
                <Text className="text-sm font-bold text-primary-foreground">Paylaş</Text>
              </Pressable>
            </View>
            <View className="mb-3 flex-row items-center gap-2 rounded-2xl border border-border bg-background px-3">
              <Search size={18} color={colors.mutedForeground} />
              <TextInput
                value={detailQuery}
                onChangeText={setDetailQuery}
                placeholder="Plaka veya ürün adı ara"
                placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
                autoCapitalize="none"
                className="h-12 flex-1 text-sm font-medium text-foreground"
              />
              {detailQuery !== '' ? (
                <Pressable onPress={() => setDetailQuery('')}>
                  <X size={18} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
            {filteredDetailTxs.length === 0 ? (
              <Text className="py-6 text-center text-sm text-muted-foreground">
                Aramanızla eşleşen hareket bulunamadı.
              </Text>
            ) : (
              <SupplierTxGroupedList
                transactions={filteredDetailTxs}
                onPress={setSelectedTx}
                compact
              />
            )}
          </>
        )}
        <SheetCancelButton
          onPress={() => {
            setDetailRow(null)
            setDetailTxs([])
            setDetailQuery('')
          }}
          label="Kapat"
        />
      </AppSheet>

      <AppSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Tedarikçiye paylaş"
        subtitle={
          detailRow
            ? `${detailRow.supplierName} · ${rangeLabel}`
            : undefined
        }
      >
        <SheetActionList
          onClose={() => setShareOpen(false)}
          actions={[
            {
              key: 'pdf',
              label: detailExporting === 'pdf' ? 'PDF hazırlanıyor...' : 'PDF Paylaş',
              description: 'Yazdırılabilir özet; WhatsApp vb. ile gönder',
              icon: FileText,
              tone: 'primary',
              onPress: () => {
                void exportDetailPdf()
              },
            },
            {
              key: 'excel',
              label: detailExporting === 'excel' ? 'Excel hazırlanıyor...' : 'Excel Paylaş',
              description: 'CSV dosyası (Excel ile açılır)',
              icon: FileSpreadsheet,
              tone: 'primary',
              onPress: () => {
                void exportDetailExcel()
              },
            },
          ]}
        />
        <SheetCancelButton onPress={() => setShareOpen(false)} />
      </AppSheet>

      <SupplierTxDetailSheet
        tx={selectedTx}
        supplierName={detailRow?.supplierName}
        onClose={() => setSelectedTx(null)}
      />
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
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5"
    >
      <Text className="text-[11px] font-semibold text-muted-foreground">{label}</Text>
      <View className="mt-1 flex-row items-center gap-1.5">
        <Calendar size={14} color={colors.mutedForeground} />
        <Text className="text-sm font-bold text-foreground">{formatTr(value)}</Text>
      </View>
    </Pressable>
  )
}
