import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { readUriAsBase64 } from '@/lib/read-base64'
import { ArrowLeft, Check, FileText, Keyboard, Plus, Trash2, Truck } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import {
  STOCK_CATEGORY_LABELS,
  type StockCategory,
  type Supplier,
} from '@/lib/types'
import { TextField, SelectField } from '@/components/form-field'
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll'
import { formatCurrency } from '@/lib/format'
import { colors } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'
import {
  importPurchaseApi,
  listSuppliers,
  scanInvoiceApi,
  type InvoiceScanLine,
} from '@/lib/api'

type Step = 'supplier' | 'pdf' | 'review'
type EditLine = InvoiceScanLine & {
  id: string
  selected: boolean
  salePrice: number
  category: StockCategory
}

const categoryOptions = (Object.keys(STOCK_CATEGORY_LABELS) as StockCategory[]).map((key) => ({
  value: key,
  label: STOCK_CATEGORY_LABELS[key],
}))

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function emptyLine(): EditLine {
  return {
    id: uid(),
    name: '',
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    selected: true,
    salePrice: 0,
    category: 'diger',
  }
}

export function SupplierImport({
  onCancel,
  onDone,
}: {
  onCancel: () => void
  onDone: () => Promise<void> | void
}) {
  const [step, setStep] = useState<Step>('supplier')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [documentNo, setDocumentNo] = useState('')
  const [documentDate, setDocumentDate] = useState('')
  const [lines, setLines] = useState<EditLine[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listSuppliers()
      .then((rows) => {
        if (active) setSuppliers(rows)
      })
      .catch(() => {
        if (active) setError('Tedarikçi listesi yüklenemedi.')
      })
      .finally(() => {
        if (active) setLoadingSuppliers(false)
      })
    return () => {
      active = false
    }
  }, [])

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null
  const selectedLines = useMemo(() => lines.filter((l) => l.selected), [lines])
  const totalPurchase = useMemo(
    () => selectedLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    [selectedLines],
  )

  async function pickAndScanPdf() {
    if (!supplierId) {
      Alert.alert('Tedarikçi', 'Önce tedarikçi seçin.')
      return
    }
    setError('')
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (picked.canceled || !picked.assets?.[0]) return

      const asset = picked.assets[0]
      setScanning(true)
      const base64 = await readUriAsBase64(asset.uri)
      const result = await scanInvoiceApi(base64, asset.mimeType ?? 'application/pdf')
      if (!result.lines.length) {
        setError('PDF’den ürün satırı okunamadı.')
        return
      }
      if (result.documentNo) setDocumentNo((prev) => prev || result.documentNo || '')
      if (result.documentDate) setDocumentDate((prev) => prev || result.documentDate || '')
      const mapped = result.lines.map((l) => ({
        ...l,
        id: uid(),
        selected: true,
        salePrice: l.unitPrice,
        category: 'diger' as StockCategory,
      }))
      // Dolu satır varsa PDF sonuçlarını ekle; yoksa listeyi değiştir
      setLines((prev) => (prev.some((p) => p.name.trim()) ? [...prev, ...mapped] : mapped))
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF okunamadı.')
    } finally {
      setScanning(false)
    }
  }

  function updateLine(id: string, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function addManualLine() {
    setLines((prev) => [...prev, emptyLine()])
    setStep('review')
    setError('')
  }

  function startManualEntry() {
    setDocumentNo('')
    setDocumentDate('')
    setLines([emptyLine()])
    setStep('review')
    setError('')
  }

  function removeLine(id: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.id !== id)
      return next.length > 0 ? next : [emptyLine()]
    })
  }

  async function handleSave() {
    if (!supplierId) return
    const toSave = selectedLines.filter((l) => l.name.trim().length >= 2 && l.unitPrice >= 0)
    if (toSave.length === 0) {
      Alert.alert('Satır yok', 'En az bir ürün adı ve fiyat girin.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await importPurchaseApi(
        supplierId,
        toSave.map((l) => ({
          name: l.name.trim(),
          quantity: Math.max(1, l.quantity),
          unitPrice: l.unitPrice,
          salePrice: l.salePrice > 0 ? l.salePrice : l.unitPrice,
          category: l.category,
        })),
        documentNo || undefined,
        documentDate || undefined,
      )
      await onDone()
      Alert.alert(
        'Alım kaydedildi',
        `${res.createdCount} yeni, ${res.updatedCount} güncellenen ürün.\nCari alış: ${formatCurrency(res.totalPurchase)}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kayıt başarısız.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 bg-background px-5 pb-3 pt-3">
        <Pressable
          onPress={() => {
            if (step === 'review') setStep('pdf')
            else if (step === 'pdf') setStep('supplier')
            else onCancel()
          }}
          className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
        >
          <ArrowLeft size={20} color={colors.secondaryForeground} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xl font-extrabold tracking-tight text-foreground">
            Dışarıdan Temin Et
          </Text>
          <Text className="text-xs text-muted-foreground">
            {step === 'supplier'
              ? '1/3 Tedarikçi seç'
              : step === 'pdf'
                ? '2/3 PDF yükle'
                : '3/3 Satırları kontrol et'}
          </Text>
        </View>
      </View>

      {step === 'supplier' && (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mt-2 text-sm text-muted-foreground">
            Alımı hangi tedarikçi carisine işleyeceğiz?
          </Text>
          {loadingSuppliers ? (
            <ActivityIndicator className="mt-10" color={colors.primary} />
          ) : suppliers.length === 0 ? (
            <View className="mt-8 rounded-2xl border border-border bg-card p-4">
              <Text className="text-sm text-muted-foreground">
                Kayıtlı tedarikçi yok. Önce Müşteriler’den tedarikçi ekleyin.
              </Text>
            </View>
          ) : (
            <View className="mt-4 flex flex-col gap-2">
              {suppliers.map((s) => {
                const active = s.id === supplierId
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSupplierId(s.id)}
                    className={cn(
                      'flex-row items-center gap-3 rounded-2xl border bg-card p-4',
                      active ? 'border-primary' : 'border-border',
                    )}
                    style={cardShadow}
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                      <Truck size={20} color={colors.secondaryForeground} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-bold text-foreground">{s.name}</Text>
                      <Text className="text-xs text-muted-foreground">
                        Bakiye: {formatCurrency(s.balance)}
                      </Text>
                    </View>
                    {active && <Check size={18} color={colors.primary} strokeWidth={2.5} />}
                  </Pressable>
                )
              })}
            </View>
          )}
          {error ? (
            <Text className="mt-3 text-sm font-semibold text-destructive">{error}</Text>
          ) : null}
          <Pressable
            disabled={!supplierId}
            onPress={() => setStep('pdf')}
            className={cn(
              'mt-6 h-14 items-center justify-center rounded-xl bg-primary',
              !supplierId && 'opacity-40',
            )}
          >
            <Text className="text-base font-extrabold text-primary-foreground">Devam</Text>
          </Pressable>
        </ScrollView>
      )}

      {step === 'pdf' && (
        <View className="flex-1 px-5 pt-2">
          <View className="rounded-2xl border border-border bg-card p-4" style={cardShadow}>
            <Text className="text-sm font-semibold text-muted-foreground">Tedarikçi</Text>
            <Text className="mt-1 text-base font-bold text-foreground">
              {selectedSupplier?.name ?? '—'}
            </Text>
          </View>
          <Pressable
            onPress={pickAndScanPdf}
            disabled={scanning}
            className={cn(
              'mt-5 items-center rounded-3xl border border-dashed border-primary/40 bg-primary/5 px-6 py-8',
              scanning && 'opacity-70',
            )}
          >
            {scanning ? (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text className="mt-3 text-sm font-semibold text-primary">PDF okunuyor…</Text>
              </>
            ) : (
              <>
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
                  <FileText size={28} color={colors.primary} />
                </View>
                <Text className="mt-3 text-lg font-extrabold text-foreground">PDF Yükle</Text>
                <Text className="mt-1 text-center text-sm text-muted-foreground">
                  Faturadan ürünleri otomatik okut
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            onPress={startManualEntry}
            disabled={scanning}
            className="mt-3 items-center rounded-3xl border border-border bg-card px-6 py-8"
            style={cardShadow}
          >
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Keyboard size={28} color={colors.secondaryForeground} />
            </View>
            <Text className="mt-3 text-lg font-extrabold text-foreground">Manuel satır ekle</Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              Ürünleri tek tek elle gir
            </Text>
          </Pressable>

          {error ? (
            <Text className="mt-4 text-sm font-semibold text-destructive">{error}</Text>
          ) : null}
        </View>
      )}

      {step === 'review' && (
        <KeyboardAwareScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20 }}
          basePaddingBottom={40}
        >
          <View className="mt-1 rounded-2xl border border-border bg-card p-4" style={cardShadow}>
            <Text className="text-sm font-semibold text-foreground">{selectedSupplier?.name}</Text>
            <Text className="mt-1 text-xs text-muted-foreground">
              {selectedLines.length} kalem · Alış toplamı {formatCurrency(totalPurchase)}
            </Text>
            {(documentNo || documentDate) && (
              <Text className="mt-1 text-xs text-muted-foreground">
                {[documentNo && `Evrak ${documentNo}`, documentDate].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>

          <View className="mt-3 flex-row gap-2">
            <TextField
              label="Evrak no (opsiyonel)"
              value={documentNo}
              onChange={setDocumentNo}
              placeholder="Örn. 2026994306523"
              className="flex-1"
            />
          </View>
          <View className="mt-2">
            <TextField
              label="Evrak tarihi (opsiyonel)"
              value={documentDate}
              onChange={setDocumentDate}
              placeholder="GG.AA.YYYY"
            />
          </View>

          <View className="mt-3 flex flex-col gap-3">
            {lines.map((l, index) => (
              <View key={l.id} className="rounded-2xl border border-border bg-card p-3" style={cardShadow}>
                <View className="mb-2 flex-row items-center gap-2">
                  <Pressable
                    onPress={() => updateLine(l.id, { selected: !l.selected })}
                    className="flex-1 flex-row items-center gap-2"
                  >
                    <View
                      className={cn(
                        'h-5 w-5 items-center justify-center rounded border',
                        l.selected ? 'border-primary bg-primary' : 'border-border',
                      )}
                    >
                      {l.selected && (
                        <Check size={12} color={colors.primaryForeground} strokeWidth={3} />
                      )}
                    </View>
                    <Text className="text-sm font-bold text-foreground">
                      Satır {index + 1}
                      {l.name.trim() ? ` · ${l.name.trim()}` : ''}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => removeLine(l.id)}
                    className="h-9 w-9 items-center justify-center rounded-lg bg-destructive/10"
                  >
                    <Trash2 size={16} color={colors.destructive} />
                  </Pressable>
                </View>
                <TextField
                  label="Ürün adı"
                  value={l.name}
                  onChange={(v) => updateLine(l.id, { name: v })}
                  placeholder="Parça / ürün adı"
                  required
                />
                <View className="mt-2 flex-row gap-2">
                  <View className="flex-1">
                    <TextField
                      label="Miktar"
                      value={String(l.quantity)}
                      inputMode="numeric"
                      onChange={(v) =>
                        updateLine(l.id, {
                          quantity: Math.max(1, parseInt(v.replace(/\D/g, ''), 10) || 1),
                        })
                      }
                    />
                  </View>
                  <View className="flex-1">
                    <TextField
                      label="Alış"
                      value={l.unitPrice ? String(l.unitPrice) : ''}
                      inputMode="numeric"
                      onChange={(v) => {
                        const unitPrice = Number(v.replace(',', '.')) || 0
                        updateLine(l.id, {
                          unitPrice,
                          salePrice: l.salePrice === 0 || l.salePrice === l.unitPrice ? unitPrice : l.salePrice,
                        })
                      }}
                      placeholder="0"
                    />
                  </View>
                  <View className="flex-1">
                    <TextField
                      label="Satış"
                      value={l.salePrice ? String(l.salePrice) : ''}
                      inputMode="numeric"
                      onChange={(v) =>
                        updateLine(l.id, { salePrice: Number(v.replace(',', '.')) || 0 })
                      }
                      placeholder="0"
                    />
                  </View>
                </View>
                <View className="mt-2">
                  <SelectField
                    label="Kategori"
                    value={l.category}
                    options={categoryOptions}
                    onChange={(v) => updateLine(l.id, { category: v as StockCategory })}
                  />
                </View>
              </View>
            ))}
          </View>

          <Pressable
            onPress={addManualLine}
            className="mt-3 h-12 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-secondary"
          >
            <Plus size={18} color={colors.secondaryForeground} />
            <Text className="text-sm font-bold text-secondary-foreground">Satır ekle</Text>
          </Pressable>

          {error ? (
            <Text className="mt-3 text-sm font-semibold text-destructive">{error}</Text>
          ) : null}

          <Pressable
            onPress={handleSave}
            disabled={saving || selectedLines.filter((l) => l.name.trim().length >= 2).length === 0}
            className={cn(
              'mt-5 h-14 items-center justify-center rounded-xl bg-accent',
              (saving || selectedLines.filter((l) => l.name.trim().length >= 2).length === 0) &&
                'opacity-60',
            )}
          >
            {saving ? (
              <ActivityIndicator color={colors.accentForeground} />
            ) : (
              <Text className="text-base font-extrabold text-accent-foreground">
                Stoğa ve cariye kaydet · {formatCurrency(totalPurchase)}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={pickAndScanPdf} className="mt-3 h-12 items-center justify-center">
            <Text className="text-sm font-semibold text-primary">PDF’den oku / ekle</Text>
          </Pressable>
        </KeyboardAwareScrollView>
      )}
    </View>
  )
}
