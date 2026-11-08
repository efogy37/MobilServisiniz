import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Check, PackagePlus, PackageSearch, Search, Tag, X } from 'lucide-react-native'
import { AppSheet } from '@/components/app-modal'
import { TextField } from '@/components/form-field'
import { cn } from '@/lib/utils'
import { colors } from '@/lib/theme'
import { formatCurrency } from '@/lib/format'
import { listStockProducts, type MatchCandidate, type StockProductLite } from '@/lib/api'
import {
  candidateReasonLabel,
  matchBadge,
  type StockMatchDecision,
  type StockMatchState,
} from '@/lib/stock-match'

/**
 * PDF satırı için stok eşleştirme kararı:
 * adaylar (kod / ad benzerliği), stoktan arama, yeni ürün oluşturma (import modunda),
 * üretici kodu düzenleme. Orijinal PDF kodu her zaman gösterilir ve değiştirilmez.
 */
export function StockMatchSheet({
  visible,
  onClose,
  lineName,
  match,
  mode,
  onDecide,
  onManufacturerCodeChange,
}: {
  visible: boolean
  onClose: () => void
  lineName: string
  match: StockMatchState
  mode: 'import' | 'workorder'
  onDecide: (d: StockMatchDecision) => void
  onManufacturerCodeChange: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<StockProductLite[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [consumeStock, setConsumeStock] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) {
      setQuery('')
      setResults([])
      setSearchOpen(false)
      setConsumeStock(false)
    }
  }, [visible])

  useEffect(() => {
    if (!searchOpen) return
    const q = query.trim()
    if (timer.current) clearTimeout(timer.current)
    if (q.length < 2) {
      setResults([])
      return
    }
    timer.current = setTimeout(() => {
      setSearching(true)
      listStockProducts(q)
        .then((rows) => setResults(rows.slice(0, 25)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, searchOpen])

  const selectedId = match.decision?.kind === 'existing' ? match.decision.stockId : undefined

  function pick(c: { id: string; name: string; code?: string }) {
    onDecide({
      kind: 'existing',
      stockId: c.id,
      name: c.name,
      code: c.code,
      consumeStock: mode === 'workorder' ? consumeStock : undefined,
    })
    onClose()
  }

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="Stok eşleştirme"
      subtitle={lineName}
    >
      {/* PDF kodu + üretici kodu */}
      <View className="rounded-2xl border border-border bg-secondary/40 p-3">
        <View className="flex-row items-center gap-2">
          <Tag size={14} color={colors.mutedForeground} />
          <Text className="text-xs font-semibold text-muted-foreground">Faturadaki kod</Text>
        </View>
        <Text className="mt-1 text-base font-extrabold text-foreground">
          {match.rawCode || '—'}
          {match.brand ? <Text className="text-sm font-semibold text-muted-foreground">  · {match.brand}</Text> : null}
        </Text>
        <View className="mt-3">
          <TextField
            label="Ürün kodu"
            value={match.manufacturerCode ?? ''}
            onChange={onManufacturerCodeChange}
            placeholder="Örn. APS 14"
          />
          <Text className="mt-1 text-[11px] text-muted-foreground">
            Yeni ürün oluşturulursa stok kodu bu olur. Faturadaki orijinal kod ayrıca saklanır.
          </Text>
        </View>
      </View>

      {mode === 'workorder' ? (
        <Pressable
          onPress={() => setConsumeStock((v) => !v)}
          className={cn(
            'mt-3 flex-row items-center gap-2 rounded-xl border px-3 py-2.5',
            consumeStock ? 'border-primary bg-primary/10' : 'border-border bg-card',
          )}
        >
          <View
            className={cn(
              'h-5 w-5 items-center justify-center rounded border',
              consumeStock ? 'border-primary bg-primary' : 'border-border',
            )}
          >
            {consumeStock ? (
              <Check size={12} color={colors.primaryForeground} strokeWidth={3} />
            ) : null}
          </View>
          <View className="flex-1">
            <Text className="text-sm font-bold text-foreground">Stoktan kullan (stok düşer)</Text>
            <Text className="text-[11px] text-muted-foreground">
              Kapalıysa parça dışarıdan yazılır, stok miktarı değişmez; kod yine öğrenilir.
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* Adaylar */}
      {match.candidates.length > 0 && (
        <View className="mt-4">
          <Text className="mb-2 text-sm font-bold text-foreground">
            {match.status === 'exact' ? 'Eşleşen ürün' : 'Olası eşleşmeler'}
          </Text>
          <View className="gap-2">
            {match.candidates.map((c) => (
              <CandidateRow
                key={c.stockId}
                c={c}
                selected={c.stockId === selectedId}
                onPress={() => pick({ id: c.stockId, name: c.name, code: c.code })}
              />
            ))}
          </View>
        </View>
      )}

      {/* Stoktan ara */}
      <View className="mt-4">
        {!searchOpen ? (
          <Pressable
            onPress={() => setSearchOpen(true)}
            className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card"
          >
            <Search size={16} color={colors.secondaryForeground} />
            <Text className="text-sm font-bold text-secondary-foreground">Stoktan başka ürün ara</Text>
          </Pressable>
        ) : (
          <View>
            <View className="flex-row items-end gap-2">
              <TextField
                label="Stokta ara"
                value={query}
                onChange={setQuery}
                placeholder="Ürün adı veya kodu"
                className="flex-1"
              />
              <Pressable
                onPress={() => {
                  setSearchOpen(false)
                  setQuery('')
                }}
                className="h-14 w-12 items-center justify-center rounded-xl bg-secondary"
              >
                <X size={16} color={colors.secondaryForeground} />
              </Pressable>
            </View>
            {searching ? (
              <ActivityIndicator className="mt-3" color={colors.primary} />
            ) : query.trim().length >= 2 && results.length === 0 ? (
              <Text className="mt-3 text-xs text-muted-foreground">Sonuç yok.</Text>
            ) : (
              <View className="mt-2 gap-2">
                {results.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => pick(r)}
                    className={cn(
                      'flex-row items-center gap-3 rounded-xl border bg-card p-3',
                      r.id === selectedId ? 'border-primary' : 'border-border',
                    )}
                  >
                    <PackageSearch size={16} color={colors.mutedForeground} />
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-foreground" numberOfLines={2}>
                        {r.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {r.code ? `${r.code} · ` : ''}Stok {r.quantity} · {formatCurrency(r.price)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Yeni ürün / ilişkilendirme */}
      <View className="mt-4 gap-2">
        {mode === 'import' ? (
          <Pressable
            onPress={() => {
              onDecide({ kind: 'new' })
              onClose()
            }}
            className={cn(
              'h-12 flex-row items-center justify-center gap-2 rounded-xl border',
              match.decision?.kind === 'new' ? 'border-primary bg-primary/10' : 'border-border bg-card',
            )}
          >
            <PackagePlus size={16} color={colors.primary} />
            <Text className="text-sm font-bold text-primary">Yeni stok ürünü olarak oluştur</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              onDecide({ kind: 'skip' })
              onClose()
            }}
            className={cn(
              'h-12 flex-row items-center justify-center gap-2 rounded-xl border',
              match.decision?.kind === 'skip' ? 'border-primary bg-primary/10' : 'border-border bg-card',
            )}
          >
            <X size={16} color={colors.secondaryForeground} />
            <Text className="text-sm font-bold text-secondary-foreground">Stokla ilişkilendirme</Text>
          </Pressable>
        )}
      </View>
    </AppSheet>
  )
}

function CandidateRow({
  c,
  selected,
  onPress,
}: {
  c: MatchCandidate
  selected: boolean
  onPress: () => void
}) {
  const strong = c.score >= 90
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-xl border bg-card p-3',
        selected ? 'border-primary' : 'border-border',
      )}
    >
      <View
        className={cn(
          'h-9 w-9 items-center justify-center rounded-lg',
          strong ? 'bg-accent/15' : 'bg-secondary',
        )}
      >
        <Text className={cn('text-xs font-extrabold', strong ? 'text-accent' : 'text-secondary-foreground')}>
          %{c.score}
        </Text>
      </View>
      <View className="flex-1">
        <Text className="text-sm font-bold text-foreground" numberOfLines={2}>
          {c.name}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {c.code ? `${c.code} · ` : ''}
          {candidateReasonLabel(c)} · Stok {c.quantity} · {formatCurrency(c.price)}
        </Text>
      </View>
      {selected && <Check size={18} color={colors.primary} strokeWidth={2.5} />}
    </Pressable>
  )
}

const BADGE_TONE = {
  ok: { wrap: 'border-accent/40 bg-accent/10', text: 'text-accent' },
  warn: { wrap: 'border-amber-500/40 bg-amber-50', text: 'text-amber-800' },
  info: { wrap: 'border-primary/40 bg-primary/10', text: 'text-primary' },
  muted: { wrap: 'border-border bg-secondary', text: 'text-muted-foreground' },
} as const

/** Ürün kodu (stoktaki kod, eşleştirme anahtarı) + tedarikçinin faturadaki kodu. */
export function PdfCodeFields({
  rawCode,
  stockCode,
  onRawCode,
  onStockCode,
}: {
  rawCode: string
  stockCode: string
  onRawCode: (v: string) => void
  onStockCode: (v: string) => void
}) {
  return (
    <View className="mt-2">
      <View className="flex-row gap-2">
        <TextField
          label="Ürün kodu"
          value={stockCode}
          onChange={onStockCode}
          placeholder="Örn. APS 14"
          className="flex-1"
        />
        <TextField
          label="Tedarikçi kodu"
          value={rawCode}
          onChange={onRawCode}
          placeholder="Örn. F-APS 14"
          className="flex-1"
        />
      </View>
      <Text className="mt-1 text-[11px] text-muted-foreground">
        Ürün kodu stok kaydıyla eşleşir (ön ekler soyulmuş). Tedarikçi kodu faturadaki orijinal koddur.
      </Text>
    </View>
  )
}

export function MatchBadge({
  match,
  onPress,
  mode = 'import',
}: {
  match: StockMatchState
  onPress: () => void
  mode?: 'import' | 'workorder'
}) {
  const { label, tone } = matchBadge(match, mode)
  const t = BADGE_TONE[tone]
  return (
    <Pressable
      onPress={onPress}
      className={cn('mb-2 rounded-lg border px-2.5 py-1.5', t.wrap)}
    >
      <Text className={cn('text-xs font-bold', t.text)}>{label}</Text>
      <Text className="mt-0.5 text-[10px] text-muted-foreground">Dokunarak değiştir</Text>
    </Pressable>
  )
}
