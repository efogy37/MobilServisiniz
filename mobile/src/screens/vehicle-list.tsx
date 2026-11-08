import { useDeferredValue, useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Search, Plus, CarFront } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { STATUS_LABELS, type JobStatus, type Vehicle } from '@/lib/types'
import { VehicleCard } from '@/components/vehicle-card'
import { colors, withAlpha } from '@/lib/theme'

export type VehicleListFilter = 'all' | JobStatus

/** Boş aramada ekranda tutulan maksimum satır (sanal liste + bu limit). */
const EMPTY_QUERY_LIMIT = 80

const filters: { key: VehicleListFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'bekliyor', label: STATUS_LABELS.bekliyor },
  { key: 'islemde', label: STATUS_LABELS.islemde },
  { key: 'tamamlandi', label: STATUS_LABELS.tamamlandi },
  { key: 'odeme_tamamlandi', label: STATUS_LABELS.odeme_tamamlandi },
  { key: 'teslim_edildi', label: STATUS_LABELS.teslim_edildi },
]

function matchesVehicleQuery(v: Vehicle, q: string) {
  if (!q) return true
  if (v.plate.toLocaleLowerCase('tr').includes(q)) return true
  if (v.brand.toLocaleLowerCase('tr').includes(q)) return true
  if (v.model.toLocaleLowerCase('tr').includes(q)) return true
  if (v.customer.name.toLocaleLowerCase('tr').includes(q)) return true
  return false
}

export function VehicleList({
  vehicles,
  onOpenVehicle,
  onNewVehicle,
  initialFilter = 'all',
  onRefresh,
}: {
  vehicles: Vehicle[]
  onOpenVehicle: (id: string) => void
  onNewVehicle: () => void
  /** Dashboard'daki durum kartlarından gelindiğinde önceden seçili filtre. */
  initialFilter?: VehicleListFilter
  onRefresh?: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<VehicleListFilter>(initialFilter)
  const [refreshing, setRefreshing] = useState(false)
  const deferredQuery = useDeferredValue(query)

  const { rows, totalMatched, capped } = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase('tr')
    const matched = vehicles.filter((v) => {
      const matchStatus = filter === 'all' || v.status === filter
      return matchStatus && matchesVehicleQuery(v, q)
    })
    const shouldCap = !q
    const rows = shouldCap ? matched.slice(0, EMPTY_QUERY_LIMIT) : matched
    return {
      rows,
      totalMatched: matched.length,
      capped: shouldCap && matched.length > EMPTY_QUERY_LIMIT,
    }
  }, [vehicles, deferredQuery, filter])

  return (
    <View className="flex-1">
      <View className="bg-background px-5 pb-3 pt-3">
        <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-card px-4">
          <Search size={20} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Plaka, marka veya müşteri ara"
            placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
            className="h-14 flex-1 text-base font-medium text-foreground"
            autoCorrect={false}
            autoCapitalize="characters"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          keyboardShouldPersistTaps="handled"
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
      </View>

      <FlatList
        className="flex-1"
        data={rows}
        keyExtractor={(v) => v.id}
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
        ListEmptyComponent={
          <View className="mt-16 items-center">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <CarFront size={32} color={colors.mutedForeground} />
            </View>
            <Text className="mt-4 text-base font-bold text-foreground">Araç bulunamadı</Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              Aramanı değiştir veya yeni bir kayıt oluştur.
            </Text>
            <Pressable
              onPress={onNewVehicle}
              className="mt-5 flex-row items-center gap-2 rounded-xl bg-accent px-5 py-3"
            >
              <Plus size={20} color={colors.accentForeground} />
              <Text className="text-sm font-bold text-accent-foreground">Yeni Araç Kaydı</Text>
            </Pressable>
          </View>
        }
        ListHeaderComponent={
          totalMatched > 0 ? (
            <Text className="mb-3 text-xs font-semibold text-muted-foreground">
              {capped
                ? `Son ${rows.length} kayıt · ${totalMatched} araç — daha fazlası için arayın`
                : `${totalMatched} araç`}
            </Text>
          ) : null
        }
        ListFooterComponent={
          capped ? (
            <Text className="mt-4 text-center text-xs text-muted-foreground">
              Tüm listeyi görmek için plaka, marka veya müşteri adı yazın.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <VehicleCard vehicle={item} onPress={() => onOpenVehicle(item.id)} />
        )}
      />
    </View>
  )
}
