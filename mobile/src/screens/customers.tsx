import { useDeferredValue, useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native'
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll'
import { Search, Plus, Phone, MapPin, Users, ArrowLeft, Pencil, Truck, BarChart3 } from 'lucide-react-native'
import type { Customer } from '@/lib/types'
import { TextField, TextArea } from '@/components/form-field'
import { formatCurrency } from '@/lib/format'
import { colors, withAlpha } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'
import { cn } from '@/lib/utils'

type ContactFilter = 'all' | 'customers' | 'suppliers'

const EMPTY_QUERY_LIMIT = 80

const FILTER_OPTIONS: { key: ContactFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'customers', label: 'Müşteriler' },
  { key: 'suppliers', label: 'Tedarikçiler' },
]

export function Customers({
  customers,
  onAdd,
  onUpdate,
  onOpenCustomer,
  onOpenReport,
  onRefresh,
  allowSuppliers = true,
}: {
  customers: Customer[]
  onAdd: (c: Omit<Customer, 'id'>) => void | Promise<void>
  onUpdate: (id: string, c: Omit<Customer, 'id'>) => void | Promise<void>
  onOpenCustomer: (customer: Customer) => void
  onOpenReport?: () => void
  onRefresh?: () => Promise<void>
  allowSuppliers?: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContactFilter>('all')
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const deferredQuery = useDeferredValue(query)

  const filterOptions = allowSuppliers
    ? FILTER_OPTIONS
    : FILTER_OPTIONS.filter((o) => o.key !== 'suppliers')

  const { rows, totalMatched, capped } = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase('tr')
    const matched = customers.filter((c) => {
      if (!allowSuppliers && c.isSupplier && c.isCustomer === false) return false
      if (filter === 'suppliers' && !c.isSupplier) return false
      if (filter === 'customers' && c.isCustomer === false) return false
      if (!q) return true
      if (c.name.toLocaleLowerCase('tr').includes(q)) return true
      if (c.phone.toLocaleLowerCase('tr').includes(q)) return true
      if ((c.address ?? '').toLocaleLowerCase('tr').includes(q)) return true
      return false
    })
    const shouldCap = !q
    return {
      rows: shouldCap ? matched.slice(0, EMPTY_QUERY_LIMIT) : matched,
      totalMatched: matched.length,
      capped: shouldCap && matched.length > EMPTY_QUERY_LIMIT,
    }
  }, [customers, deferredQuery, filter, allowSuppliers])

  if (editing) {
    return (
      <CustomerForm
        initial={editing === 'new' ? null : editing}
        allowSuppliers={allowSuppliers}
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
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">
            Toplam {customers.length} müşteri kayıtlı
          </Text>
          {allowSuppliers && onOpenReport ? (
            <Pressable
              onPress={onOpenReport}
              className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
            >
              <BarChart3 size={20} color={colors.secondaryForeground} />
            </Pressable>
          ) : (
            <View className="h-11 w-11" />
          )}
        </View>

        <View className="mt-3 flex-row items-center gap-2 rounded-2xl border border-border bg-card px-4">
          <Search size={20} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="İsim veya telefon ara"
            placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
            className="h-14 flex-1 text-base font-medium text-foreground"
          />
        </View>

        <View className="mt-3 flex-row gap-2">
          {filterOptions.map((opt) => {
            const active = filter === opt.key
            return (
              <Pressable
                key={opt.key}
                onPress={() => setFilter(opt.key)}
                className={cn(
                  'h-10 flex-1 items-center justify-center rounded-xl border',
                  active ? 'border-primary bg-primary/10' : 'border-border bg-card',
                )}
              >
                <Text
                  className={cn(
                    'text-sm font-bold',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {opt.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Pressable
          onPress={() => setEditing('new')}
          className="mt-3 h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl bg-accent active:opacity-95"
          style={accentShadow}
        >
          <Plus size={24} color={colors.accentForeground} strokeWidth={2.4} />
          <Text className="text-base font-bold text-accent-foreground">
            Yeni Cari Ekle
          </Text>
        </Pressable>
      </View>

      <FlatList
        className="flex-1"
        data={rows}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 24,
          flexGrow: 1,
        }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
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
        ListHeaderComponent={
          totalMatched > 0 ? (
            <Text className="mb-3 text-xs font-semibold text-muted-foreground">
              {capped
                ? `İlk ${rows.length} kayıt · ${totalMatched} cari — daha fazlası için arayın`
                : `${totalMatched} cari`}
            </Text>
          ) : null
        }
        ListFooterComponent={
          capped ? (
            <Text className="mt-4 text-center text-xs text-muted-foreground">
              Tüm listeyi görmek için isim veya telefon yazın.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View className="mt-16 items-center">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <Users size={32} color={colors.mutedForeground} />
            </View>
            <Text className="mt-4 text-base font-bold text-foreground">Müşteri bulunamadı</Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Aramanı değiştir veya yeni bir müşteri ekle.
            </Text>
          </View>
        }
        renderItem={({ item: c }) => (
          <Pressable
            onPress={() => onOpenCustomer(c)}
            className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4 active:bg-muted"
            style={cardShadow}
          >
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <Text className="text-base font-extrabold text-primary">{initials(c.name)}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="shrink text-base font-bold text-foreground" numberOfLines={1}>
                  {c.name}
                </Text>
                {c.isSupplier ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5">
                    <Truck size={12} color={colors.accent} />
                    <Text className="text-[11px] font-bold text-accent">Tedarikçi</Text>
                  </View>
                ) : null}
              </View>
              <View className="mt-0.5 flex-row items-center gap-1.5">
                <Phone size={16} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{c.phone}</Text>
              </View>
              {c.address ? (
                <View className="mt-0.5 flex-row items-center gap-1.5">
                  <MapPin size={16} color={colors.mutedForeground} />
                  <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
                    {c.address}
                  </Text>
                </View>
              ) : null}
            </View>
            {c.isCustomer !== false || c.isSupplier ? (
              <View className="items-end gap-1">
                {c.isCustomer !== false ? (
                  <View className="items-end">
                    <Text className="text-[11px] font-semibold text-muted-foreground">Alacak</Text>
                    <Text
                      className={
                        (c.balance ?? 0) > 0
                          ? 'text-sm font-extrabold text-destructive'
                          : 'text-sm font-extrabold text-foreground'
                      }
                    >
                      {formatCurrency(c.balance ?? 0)}
                    </Text>
                  </View>
                ) : null}
                {c.isSupplier ? (
                  <View className="items-end">
                    <Text className="text-[11px] font-semibold text-muted-foreground">Borç</Text>
                    <Text
                      className={
                        (c.supplierBalance ?? 0) > 0
                          ? 'text-sm font-extrabold text-destructive'
                          : 'text-sm font-extrabold text-foreground'
                      }
                    >
                      {formatCurrency(c.supplierBalance ?? 0)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable
              onPress={() => setEditing(c)}
              className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
            >
              <Pencil size={20} color={colors.secondaryForeground} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  )
}

type ContactRole = 'customer' | 'supplier' | 'both'

export function CustomerForm({
  initial,
  onCancel,
  onSave,
  allowSuppliers = true,
}: {
  initial: Customer | null
  onCancel: () => void
  onSave: (data: Omit<Customer, 'id'>) => void | Promise<void>
  allowSuppliers?: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [role, setRole] = useState<ContactRole>(() => {
    if (!allowSuppliers) return 'customer'
    if (initial?.isSupplier && initial?.isCustomer !== false) return 'both'
    if (initial?.isSupplier) return 'supplier'
    return 'customer'
  })
  const [taxNo, setTaxNo] = useState(initial?.taxNo ?? '')
  const [openingBalance, setOpeningBalance] = useState(
    initial?.openingBalance != null ? String(initial.openingBalance) : '',
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const isSupplier = allowSuppliers && (role === 'supplier' || role === 'both')
  const isCustomer = role === 'customer' || role === 'both' || !allowSuppliers

  async function handleSave() {
    if (name.trim().length < 2) {
      setError(isSupplier && !isCustomer ? 'Lütfen tedarikçi adını girin.' : 'Lütfen müşteri adını girin.')
      return
    }
    if (phone.trim().length < 7) {
      setError('Lütfen geçerli bir telefon girin.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        isSupplier,
        isCustomer,
        taxNo: isSupplier ? taxNo.trim() || undefined : undefined,
        openingBalance: isSupplier ? parseMoneyInput(openingBalance) : undefined,
      })
    } catch {
      setError('Kayıt başarısız. Bilgileri kontrol edip tekrar deneyin.')
    } finally {
      setSaving(false)
    }
  }

  const title = initial
    ? 'Cariyi Düzenle'
    : role === 'supplier'
      ? 'Yeni Tedarikçi'
      : role === 'both'
        ? 'Yeni Cari'
        : 'Yeni Müşteri'

  const saveLabel = initial
    ? 'Değişiklikleri Kaydet'
    : role === 'supplier'
      ? 'Tedarikçiyi Kaydet'
      : 'Kaydet'

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
          {title}
        </Text>
      </View>

      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        basePaddingBottom={48}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex flex-col gap-4">
          {allowSuppliers ? (
            <View>
              <Text className="mb-1.5 text-sm font-semibold text-muted-foreground">
                Kayıt türü
              </Text>
              <View className="flex-row gap-1 rounded-2xl bg-secondary p-1">
                {(
                  [
                    { key: 'customer' as const, label: 'Müşteri' },
                    { key: 'supplier' as const, label: 'Tedarikçi' },
                    { key: 'both' as const, label: 'Her ikisi' },
                  ] as const
                ).map((opt) => {
                  const active = role === opt.key
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setRole(opt.key)}
                      className={cn(
                        'flex-1 items-center justify-center rounded-xl py-2.5',
                        active && 'bg-card',
                      )}
                      style={active ? cardShadow : undefined}
                    >
                      <Text
                        className={cn(
                          'text-sm font-bold',
                          active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}

          <TextField
            label={isSupplier && !isCustomer ? 'Tedarikçi Adı' : 'Ad Soyad'}
            value={name}
            onChange={setName}
            placeholder={isSupplier && !isCustomer ? 'Örn. ABC Oto Yedek Parça' : 'Örn. Ayşe Kaya'}
          />
          <TextField
            label="Telefon"
            value={phone}
            onChange={setPhone}
            placeholder="05XX XXX XX XX"
            inputMode="tel"
          />
          <TextArea
            label="Adres (isteğe bağlı)"
            value={address}
            onChange={setAddress}
            placeholder="Mahalle, ilçe, il"
            rows={3}
          />

          {isSupplier ? (
            <View className="flex-row gap-3">
              <TextField
                label="Vergi No (isteğe bağlı)"
                value={taxNo}
                onChange={setTaxNo}
                className="flex-1"
              />
              <TextField
                label="Açılış Bakiyesi (₺)"
                value={openingBalance}
                onChange={setOpeningBalance}
                inputMode="numeric"
                placeholder="0"
                className="flex-1"
              />
            </View>
          ) : null}

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
              {saving ? 'Kaydediliyor…' : saveLabel}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  )
}

/** "1.250,50" / "1250,50" / "1250.50" → number */
function parseMoneyInput(raw: string): number {
  const t = raw.trim().replace(/\s/g, '')
  if (!t) return 0
  const normalized =
    t.includes(',') && t.includes('.')
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase('tr'))
    .join('')
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
