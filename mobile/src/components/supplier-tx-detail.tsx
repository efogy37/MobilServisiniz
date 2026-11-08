import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CarFront, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native'
import { AppSheet, SheetCancelButton } from '@/components/app-modal'
import { formatCurrency, formatDate, formatDateTime, formatTime, toTurkeyDateKey } from '@/lib/format'
import type { SupplierTransaction } from '@/lib/api'
import { colors } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'

export const SUPPLIER_TX_LABELS: Record<string, string> = {
  alis: 'Alış (borç)',
  odeme: 'Tedarikçiye ödeme',
  iade: 'İade',
  iskonto: 'İskonto',
}

export const SUPPLIER_METHOD_LABELS: Record<string, string> = {
  nakit: 'Nakit',
  kart: 'Kart',
  havale: 'Havale',
  diger: 'Diğer',
}

export function isSupplierCredit(type: string) {
  return type === 'odeme' || type === 'iade' || type === 'iskonto'
}

export function vehicleLabel(t: Pick<SupplierTransaction, 'brand' | 'model'>): string | undefined {
  const brand = t.brand?.trim()
  const model = t.model?.trim()
  if (brand && model) return `${brand} ${model}`
  return brand || model || undefined
}

/** Bağlı ödeme izi (pid:…) kullanıcıya gösterilmez; DB'de kalır. */
export function formatSupplierDescription(description?: string | null): string | undefined {
  if (!description) return undefined
  const cleaned = description
    .replace(/\s*[·•|-]?\s*pid:[0-9a-fA-F-]{36}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[·•|-]\s*$/g, '')
    .trim()
  return cleaned || undefined
}

export function supplierTxSubtitle(t: SupplierTransaction): string | undefined {
  if (t.partName) {
    const qty = t.partQuantity && t.partQuantity > 1 ? `${t.partQuantity}× ` : ''
    const plate = t.plate ? ` · ${t.plate}` : ''
    const vehicle = vehicleLabel(t)
    const vehiclePart = vehicle ? ` · ${vehicle}` : ''
    return `${qty}${t.partName}${plate}${vehiclePart}`
  }
  return formatSupplierDescription(t.description)
}

export type SupplierTxRow =
  | { kind: 'single'; tx: SupplierTransaction }
  | {
      kind: 'plate'
      plate: string
      brand?: string | null
      model?: string | null
      items: SupplierTransaction[]
      net: number
    }

export type SupplierTxDateGroup = {
  dateKey: string
  label: string
  items: SupplierTransaction[]
  rows: SupplierTxRow[]
  /** Alış − (ödeme+iade+iskonto) — günün net borç etkisi */
  netDebt: number
}

/** Aynı gün içindeki hareketleri araç plakasına göre alt gruplar; plakasız hareketler tekil satır olarak kalır. */
function buildSupplierTxRows(items: SupplierTransaction[]): SupplierTxRow[] {
  const rows: SupplierTxRow[] = []
  const plateIndex = new Map<string, number>()
  for (const t of items) {
    const plate = t.plate?.trim()
    if (plate) {
      const idx = plateIndex.get(plate)
      const signed = isSupplierCredit(t.type) ? -t.amount : t.amount
      if (idx != null) {
        const row = rows[idx]
        if (row.kind === 'plate') {
          row.items.push(t)
          row.net += signed
          if (!row.brand?.trim() && t.brand?.trim()) row.brand = t.brand
          if (!row.model?.trim() && t.model?.trim()) row.model = t.model
        }
      } else {
        plateIndex.set(plate, rows.length)
        rows.push({
          kind: 'plate',
          plate,
          brand: t.brand,
          model: t.model,
          items: [t],
          net: signed,
        })
      }
    } else {
      rows.push({ kind: 'single', tx: t })
    }
  }
  return rows.map((r) =>
    r.kind === 'plate' ? { ...r, net: Math.round(r.net * 100) / 100 } : r,
  )
}

/** Hareketleri Türkiye takvim gününe göre gruplar (yeni → eski). */
export function groupSupplierTxByDate(transactions: SupplierTransaction[]): SupplierTxDateGroup[] {
  const map = new Map<string, SupplierTransaction[]>()
  for (const t of transactions) {
    const key = toTurkeyDateKey(t.createdAt)
    const list = map.get(key)
    if (list) list.push(t)
    else map.set(key, [t])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([dateKey, items]) => {
      const sorted = [...items].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      )
      let net = 0
      for (const t of sorted) {
        net += isSupplierCredit(t.type) ? -t.amount : t.amount
      }
      return {
        dateKey,
        label: formatDate(sorted[0]?.createdAt ?? dateKey),
        items: sorted,
        rows: buildSupplierTxRows(sorted),
        netDebt: Math.round(net * 100) / 100,
      }
    })
}

export function SupplierTxGroupedList({
  transactions,
  onPress,
  compact = false,
}: {
  transactions: SupplierTransaction[]
  onPress: (tx: SupplierTransaction) => void
  /** Rapor sheet’i için biraz daha sıkı satırlar */
  compact?: boolean
}) {
  const groups = groupSupplierTxByDate(transactions)
  return (
    <View className="flex flex-col gap-4">
      {groups.map((g) => (
        <View key={g.dateKey}>
          <View className="mb-2 flex-row items-center justify-between px-0.5">
            <Text className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </Text>
            <Text className="text-xs font-semibold text-muted-foreground">
              {g.items.length} hareket
              {g.netDebt !== 0
                ? ` · net ${g.netDebt > 0 ? '+' : ''}${formatCurrency(g.netDebt)}`
                : ''}
            </Text>
          </View>
          <View className="flex flex-col gap-2">
            {g.rows.map((row) =>
              row.kind === 'plate' ? (
                <PlateGroupRow
                  key={`plate-${row.plate}-${row.items[0]?.id}`}
                  plate={row.plate}
                  brand={row.brand}
                  model={row.model}
                  items={row.items}
                  net={row.net}
                  onPress={onPress}
                  compact={compact}
                />
              ) : (
                <SingleTxRow
                  key={row.tx.id}
                  tx={row.tx}
                  onPress={onPress}
                  compact={compact}
                />
              ),
            )}
          </View>
        </View>
      ))}
    </View>
  )
}

function SingleTxRow({
  tx,
  onPress,
  compact,
}: {
  tx: SupplierTransaction
  onPress: (tx: SupplierTransaction) => void
  compact?: boolean
}) {
  const credit = isSupplierCredit(tx.type)
  const sub = supplierTxSubtitle(tx)
  return (
    <Pressable
      onPress={() => onPress(tx)}
      className={
        compact
          ? 'flex-row items-center justify-between rounded-2xl border border-border bg-background px-3 py-3 active:opacity-90'
          : 'flex-row items-center justify-between rounded-2xl border border-border bg-card p-3.5 active:opacity-90'
      }
      style={compact ? undefined : cardShadow}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-bold text-foreground">
          {SUPPLIER_TX_LABELS[tx.type] ?? tx.type}
          {tx.method ? ` · ${SUPPLIER_METHOD_LABELS[tx.method] ?? tx.method}` : ''}
        </Text>
        {sub ? (
          <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
        <Text className="mt-0.5 text-xs text-muted-foreground">{formatTime(tx.createdAt)}</Text>
      </View>
      <View className="ml-2 flex-row items-center gap-1">
        <Text
          className={
            credit
              ? 'text-base font-extrabold text-chart-4'
              : 'text-base font-extrabold text-destructive'
          }
        >
          {credit ? '-' : '+'}
          {formatCurrency(tx.amount)}
        </Text>
        {!compact ? <ChevronRight size={16} color={colors.mutedForeground} /> : null}
      </View>
    </Pressable>
  )
}

/** Aynı tarih + plaka için birden çok kalem varsa özet satır; dokununca kalem kalem detay açılır. */
function PlateGroupRow({
  plate,
  brand,
  model,
  items,
  net,
  onPress,
  compact,
}: {
  plate: string
  brand?: string | null
  model?: string | null
  items: SupplierTransaction[]
  net: number
  onPress: (tx: SupplierTransaction) => void
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const credit = net < 0
  const vehicle =
    vehicleLabel({ brand, model }) ??
    vehicleLabel(items.find((t) => t.brand?.trim() || t.model?.trim()) ?? {})

  // Tek kalemde de plaka + marka/model başlıkta kalsın (eski davranış: Alış satırı)
  if (items.length === 1) {
    const tx = items[0]
    const sub = supplierTxSubtitle(tx)
    const titleVehicle = vehicleLabel(tx) ?? vehicle
    return (
      <Pressable
        onPress={() => onPress(tx)}
        className={
          compact
            ? 'flex-row items-center justify-between rounded-2xl border border-border bg-background px-3 py-3 active:opacity-90'
            : 'flex-row items-center justify-between rounded-2xl border border-border bg-card p-3.5 active:opacity-90'
        }
        style={compact ? undefined : cardShadow}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <CarFront size={16} color={colors.primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
              {plate}
              {titleVehicle ? ` · ${titleVehicle}` : ''}
            </Text>
            {sub ? (
              <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
                {sub}
              </Text>
            ) : (
              <Text className="mt-0.5 text-xs text-muted-foreground">{formatTime(tx.createdAt)}</Text>
            )}
          </View>
        </View>
        <View className="ml-2 flex-row items-center gap-1">
          <Text
            className={
              isSupplierCredit(tx.type)
                ? 'text-base font-extrabold text-chart-4'
                : 'text-base font-extrabold text-destructive'
            }
          >
            {isSupplierCredit(tx.type) ? '-' : '+'}
            {formatCurrency(tx.amount)}
          </Text>
          {!compact ? <ChevronRight size={16} color={colors.mutedForeground} /> : null}
        </View>
      </Pressable>
    )
  }

  return (
    <View className="flex flex-col gap-1.5">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        className={
          compact
            ? 'flex-row items-center justify-between rounded-2xl border border-border bg-background px-3 py-3 active:opacity-90'
            : 'flex-row items-center justify-between rounded-2xl border border-border bg-card p-3.5 active:opacity-90'
        }
        style={compact ? undefined : cardShadow}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <CarFront size={16} color={colors.primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
              {plate}
              {vehicle ? ` · ${vehicle}` : ''}
            </Text>
            <Text className="mt-0.5 text-xs text-muted-foreground">
              {items.length} kalem · kalemler için dokun
            </Text>
          </View>
        </View>
        <View className="ml-2 flex-row items-center gap-1">
          <Text
            className={
              credit
                ? 'text-base font-extrabold text-chart-4'
                : 'text-base font-extrabold text-destructive'
            }
          >
            {credit ? '-' : '+'}
            {formatCurrency(Math.abs(net))}
          </Text>
          {expanded ? (
            <ChevronUp size={16} color={colors.mutedForeground} />
          ) : (
            <ChevronDown size={16} color={colors.mutedForeground} />
          )}
        </View>
      </Pressable>
      {expanded ? (
        <View className="ml-3 flex flex-col gap-1.5 border-l-2 border-border pl-3">
          {items.map((t) => {
            const itemCredit = isSupplierCredit(t.type)
            const qty = t.partQuantity && t.partQuantity > 1 ? `${t.partQuantity}× ` : ''
            const label = t.partName || SUPPLIER_TX_LABELS[t.type] || t.type
            return (
              <Pressable
                key={t.id}
                onPress={() => onPress(t)}
                className="flex-row items-center justify-between rounded-xl bg-background px-3 py-2.5 active:opacity-90"
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold text-foreground" numberOfLines={1}>
                    {qty}
                    {label}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatTime(t.createdAt)}
                  </Text>
                </View>
                <Text
                  className={
                    itemCredit
                      ? 'text-sm font-extrabold text-chart-4'
                      : 'text-sm font-extrabold text-destructive'
                  }
                >
                  {itemCredit ? '-' : '+'}
                  {formatCurrency(t.amount)}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3 border-b border-border py-2.5">
      <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Text>
      <Text className="max-w-[65%] text-right text-sm font-semibold text-foreground">{value}</Text>
    </View>
  )
}

export function SupplierTxDetailSheet({
  tx,
  supplierName,
  onClose,
  onEdit,
  onDelete,
}: {
  tx: SupplierTransaction | null
  supplierName?: string
  onClose: () => void
  onEdit?: (tx: SupplierTransaction) => void
  onDelete?: (tx: SupplierTransaction) => void
}) {
  const credit = tx ? isSupplierCredit(tx.type) : false
  const editable = tx ? tx.type === 'odeme' || tx.type === 'iskonto' : false
  const title = tx ? SUPPLIER_TX_LABELS[tx.type] ?? tx.type : ''
  const description = tx ? formatSupplierDescription(tx.description) : undefined

  return (
    <AppSheet
      visible={!!tx}
      onClose={onClose}
      title="Hareket detayı"
      subtitle={supplierName || title || undefined}
    >
      {!tx ? null : (
      <>
      <View className="mb-3 rounded-2xl bg-foreground px-4 py-3.5">
        <Text className="text-xs font-semibold text-background/70">{title}</Text>
        <Text
          className={
            credit
              ? 'mt-1 text-2xl font-extrabold text-chart-4'
              : 'mt-1 text-2xl font-extrabold text-destructive'
          }
        >
          {credit ? '-' : '+'}
          {formatCurrency(tx.amount)}
        </Text>
      </View>

      <DetailRow label="Tarih" value={formatDateTime(tx.createdAt)} />
      {tx.method ? (
        <DetailRow
          label="Yöntem"
          value={SUPPLIER_METHOD_LABELS[tx.method] ?? tx.method}
        />
      ) : null}
      {tx.plate ? (
        <DetailRow
          label="Plaka"
          value={vehicleLabel(tx) ? `${tx.plate} · ${vehicleLabel(tx)}` : tx.plate}
        />
      ) : null}
      {tx.partName ? <DetailRow label="Parça" value={tx.partName} /> : null}
      {tx.partQuantity != null && tx.partQuantity > 0 ? (
        <DetailRow label="Adet" value={String(tx.partQuantity)} />
      ) : null}
      {tx.purchasePrice != null && tx.purchasePrice > 0 ? (
        <DetailRow label="Birim alış" value={formatCurrency(tx.purchasePrice)} />
      ) : null}
      {description ? <DetailRow label="Açıklama" value={description} /> : null}

      {editable && (onEdit || onDelete) ? (
        <View className="mt-4 flex-row gap-2">
          {onEdit ? (
            <Pressable
              onPress={() => onEdit(tx)}
              className="h-12 flex-1 items-center justify-center rounded-xl bg-primary active:opacity-90"
            >
              <Text className="text-sm font-extrabold text-primary-foreground">Düzenle</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              onPress={() => onDelete(tx)}
              className="h-12 flex-1 items-center justify-center rounded-xl bg-destructive/15 active:opacity-90"
            >
              <Text className="text-sm font-extrabold" style={{ color: colors.destructive }}>
                Sil
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <SheetCancelButton onPress={onClose} label="Kapat" />
      </>
      )}
    </AppSheet>
  )
}
