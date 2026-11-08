import { useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll'
import { Search, Plus, Package, ArrowLeft, Pencil, AlertTriangle, Trash2, Truck, BarChart3 } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import {
  STOCK_CATEGORY_LABELS,
  type StockCategory,
  type StockProduct,
} from '@/lib/types'
import { TextField, SelectField } from '@/components/form-field'
import { formatCurrency } from '@/lib/format'
import { colors, withAlpha } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'

type Filter = 'all' | StockCategory

const LOW_STOCK = 10

const categoryOptions = (Object.keys(STOCK_CATEGORY_LABELS) as StockCategory[]).map(
  (key) => ({ value: key, label: STOCK_CATEGORY_LABELS[key] }),
)

export function Products({
  products,
  onAdd,
  onUpdate,
  onDelete,
  onRefresh,
  onImportPurchase,
  onOpenReports,
}: {
  products: StockProduct[]
  onAdd: (p: Omit<StockProduct, 'id'>) => void | Promise<void>
  onUpdate: (id: string, p: Omit<StockProduct, 'id'>) => void | Promise<void>
  onDelete?: (id: string) => void | Promise<void>
  onRefresh?: () => Promise<void>
  onImportPurchase?: () => void
  onOpenReports?: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<StockProduct | 'new' | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function confirmDelete(p: StockProduct) {
    if (!onDelete) return
    Alert.alert(
      'Ürünü sil',
      `"${p.name}" stoktan silinsin mi?\n\nBu ürün bir iş emrinde kullanıldıysa veya alış/satış hareketi varsa silinemez; önce ilgili hareketi kaldırmanız gerekir.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(p.id)
            try {
              await onDelete(p.id)
            } catch {
              /* hata mesajı üst seviyede zaten gösterilir */
            } finally {
              setDeletingId(null)
            }
          },
        },
      ],
    )
  }

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Tümü' },
    ...categoryOptions.map((o) => ({ key: o.value as Filter, label: o.label })),
  ]

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return products.filter((p) => {
      const matchCat = filter === 'all' || p.category === filter
      const matchQuery = !q || `${p.name} ${p.code}`.toLocaleLowerCase('tr').includes(q)
      return matchCat && matchQuery
    })
  }, [products, query, filter])

  const lowCount = products.filter((p) => p.stock <= LOW_STOCK).length

  if (editing) {
    return (
      <ProductForm
        initial={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSave={async (data) => {
          if (editing === 'new') await onAdd(data)
          else await onUpdate(editing.id, data)
          setEditing(null)
        }}
      />
    )
  }

  return (
    <View className="flex-1">
      <View className="bg-background px-5 pb-3 pt-3">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-sm text-muted-foreground">
            {products.length} ürün
            {lowCount > 0 ? (
              <Text className="font-semibold text-destructive">
                {' '}· {lowCount} üründe stok az
              </Text>
            ) : null}
          </Text>
          {onOpenReports ? (
            <Pressable
              onPress={onOpenReports}
              className="flex-row items-center gap-1.5 rounded-xl bg-secondary px-3 py-2"
            >
              <BarChart3 size={16} color={colors.secondaryForeground} />
              <Text className="text-xs font-bold text-secondary-foreground">Raporlar</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="mt-3 flex-row items-center gap-2 rounded-2xl border border-border bg-card px-4">
          <Search size={20} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ürün adı veya kodu ara"
            placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
            className="h-14 flex-1 text-base font-medium text-foreground"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
        >
          {filters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              className={cn(
                'rounded-full px-4 py-2',
                filter === f.key ? 'bg-primary' : 'bg-secondary',
              )}
            >
              <Text
                className={cn(
                  'text-sm font-semibold',
                  filter === f.key
                    ? 'text-primary-foreground'
                    : 'text-secondary-foreground',
                )}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={() => setEditing('new')}
            className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-accent active:opacity-95"
            style={accentShadow}
          >
            <Plus size={22} color={colors.accentForeground} strokeWidth={2.4} />
            <Text className="text-sm font-bold text-accent-foreground">Ürün Ekle</Text>
          </Pressable>
          {onImportPurchase ? (
            <Pressable
              onPress={onImportPurchase}
              className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-95"
            >
              <Truck size={20} color={colors.primaryForeground} strokeWidth={2.4} />
              <Text className="text-sm font-bold text-primary-foreground">Dışarıdan Temin</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              if (!onRefresh) return
              setRefreshing(true)
              try {
                await onRefresh()
              } finally {
                setRefreshing(false)
              }
            }}
          />
        }
      >
        {filtered.length === 0 ? (
          <View className="mt-16 items-center">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <Package size={32} color={colors.mutedForeground} />
            </View>
            <Text className="mt-4 text-base font-bold text-foreground">
              Ürün bulunamadı
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Aramanı değiştir veya yeni bir ürün ekle.
            </Text>
          </View>
        ) : (
          <View className="flex flex-col gap-3">
            {filtered.map((p) => {
              const low = p.stock <= LOW_STOCK
              return (
                <View
                  key={p.id}
                  className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4"
                  style={cardShadow}
                >
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-center gap-2">
                      <View className="rounded-lg bg-secondary px-2 py-0.5">
                        <Text className="text-xs font-bold text-secondary-foreground">
                          {STOCK_CATEGORY_LABELS[p.category]}
                        </Text>
                      </View>
                      <Text className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </Text>
                    </View>
                    <Text className="mt-1 text-base font-bold text-foreground" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View className="mt-1 flex-row flex-wrap items-center gap-x-3 gap-y-0.5">
                      <Text className="text-base font-extrabold text-primary">
                        Satış {formatCurrency(p.price)}
                      </Text>
                      {p.purchasePrice != null && p.purchasePrice > 0 ? (
                        <Text className="text-sm font-semibold text-muted-foreground">
                          Alış {formatCurrency(p.purchasePrice)}
                        </Text>
                      ) : null}
                      <View className="flex-row items-center gap-1">
                        {low && <AlertTriangle size={16} color={colors.destructive} />}
                        <Text
                          className={cn(
                            'text-sm font-semibold',
                            low ? 'text-destructive' : 'text-muted-foreground',
                          )}
                        >
                          {p.stock} adet
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Pressable
                      onPress={() => setEditing(p)}
                      className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
                    >
                      <Pencil size={20} color={colors.secondaryForeground} />
                    </Pressable>
                    {onDelete ? (
                      <Pressable
                        onPress={() => confirmDelete(p)}
                        disabled={deletingId === p.id}
                        className={cn(
                          'h-11 w-11 items-center justify-center rounded-xl bg-destructive/10',
                          deletingId === p.id && 'opacity-50',
                        )}
                      >
                        <Trash2 size={20} color={colors.destructive} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

function ProductForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: StockProduct | null
  onCancel: () => void
  onSave: (data: Omit<StockProduct, 'id'>) => void | Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [code, setCode] = useState(initial?.code ?? '')
  const [category, setCategory] = useState<StockCategory>(initial?.category ?? 'diger')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [purchasePrice, setPurchasePrice] = useState(
    initial?.purchasePrice != null && initial.purchasePrice > 0
      ? String(initial.purchasePrice)
      : '',
  )
  const [stock, setStock] = useState(initial ? String(initial.stock) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (name.trim().length < 2) {
      setError('Lütfen ürün adını girin.')
      return
    }
    const priceNum = Number(price.replace(',', '.'))
    if (!priceNum || priceNum <= 0) {
      setError('Lütfen geçerli bir satış fiyatı girin.')
      return
    }
    const purchaseRaw = purchasePrice.trim().replace(',', '.')
    const purchaseNum = purchaseRaw === '' ? undefined : Number(purchaseRaw)
    if (purchaseNum != null && (Number.isNaN(purchaseNum) || purchaseNum < 0)) {
      setError('Alış fiyatı geçersiz.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(),
        code: code.trim() || '-',
        category,
        price: priceNum,
        purchasePrice: purchaseNum != null && purchaseNum > 0 ? purchaseNum : undefined,
        stock: Number(stock) || 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kayıt başarısız. Bilgileri kontrol edip tekrar deneyin.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 bg-background px-5 pb-3 pt-3">
        <Pressable
          onPress={onCancel}
          className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
        >
          <ArrowLeft size={20} color={colors.secondaryForeground} />
        </Pressable>
        <Text className="text-xl font-extrabold tracking-tight text-foreground">
          {initial ? 'Ürünü Düzenle' : 'Yeni Ürün'}
        </Text>
      </View>

      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        basePaddingBottom={48}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex flex-col gap-4">
          <TextField
            label="Ürün Kodu (isteğe bağlı)"
            value={code}
            onChange={setCode}
            placeholder="Örn. APS 14"
          />
          <TextField label="Ürün Adı" value={name} onChange={setName} placeholder="Örn. Motor Yağı 5W-30" />
          <SelectField
            label="Kategori"
            value={category}
            onChange={(v) => setCategory(v as StockCategory)}
            options={categoryOptions}
          />
          <View className="flex-row gap-3">
            <TextField
              label="Alış fiyatı (₺)"
              value={purchasePrice}
              onChange={setPurchasePrice}
              placeholder="0"
              inputMode="numeric"
              className="flex-1"
            />
            <TextField
              label="Satış fiyatı (₺)"
              value={price}
              onChange={setPrice}
              placeholder="0"
              inputMode="numeric"
              className="flex-1"
            />
          </View>
          <TextField
            label="Stok (adet)"
            value={stock}
            onChange={setStock}
            placeholder="0"
            inputMode="numeric"
          />

          {error !== '' && (
            <View className="rounded-xl bg-destructive/10 px-4 py-3">
              <Text className="text-sm font-semibold text-destructive">{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSave}
            disabled={saving}
            className={cn(
              'mt-1 h-14 items-center justify-center rounded-xl bg-primary active:opacity-95',
              saving && 'opacity-70',
            )}
            style={primaryShadow}
          >
            <Text className="text-base font-extrabold text-primary-foreground">
              {saving ? 'Kaydediliyor…' : initial ? 'Değişiklikleri Kaydet' : 'Ürünü Kaydet'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  )
}

const accentShadow = {
  shadowColor: '#e07d33',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.28,
  shadowRadius: 12,
  elevation: 5,
}

const primaryShadow = {
  shadowColor: '#2f4a86',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.28,
  shadowRadius: 12,
  elevation: 5,
}
