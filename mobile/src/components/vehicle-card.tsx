import { Pressable, Text, View } from 'react-native'
import { ChevronRight, User } from 'lucide-react-native'
import type { Customer, Vehicle } from '@/lib/types'
import { StatusBadge } from '@/components/status-badge'
import { formatDateTime, formatVisitLabel } from '@/lib/format'
import { colors } from '@/lib/theme'

export type VehicleCardData = Pick<
  Vehicle,
  'plate' | 'brand' | 'model' | 'status' | 'createdAt' | 'visitNumber'
> & {
  customer: Pick<Customer, 'name'>
}

export function VehicleCard({
  vehicle,
  onPress,
}: {
  vehicle: VehicleCardData
  onPress: () => void
}) {
  const visitLabel = formatVisitLabel(vehicle.visitNumber)
  return (
    <Pressable
      onPress={onPress}
      className="w-full flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4 active:bg-muted"
      style={cardShadow}
    >
      <View className="flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <View className="rounded-lg bg-foreground px-2.5 py-1">
              <Text className="font-mono text-sm font-bold tracking-wide text-background">
                {vehicle.plate}
              </Text>
            </View>
            {visitLabel ? (
              <View className="rounded-md bg-secondary px-2 py-1">
                <Text className="text-xs font-bold text-secondary-foreground">{visitLabel}</Text>
              </View>
            ) : null}
          </View>
          <StatusBadge status={vehicle.status} />
        </View>
        <Text className="mt-2 text-base font-bold text-foreground">
          {vehicle.brand} {vehicle.model}
        </Text>
        <View className="mt-1 flex-row items-center gap-1.5">
          <User size={14} color={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {vehicle.customer.name}
          </Text>
          <Text className="text-sm text-muted-foreground">·</Text>
          <Text className="text-sm text-muted-foreground">
            {formatDateTime(vehicle.createdAt)}
          </Text>
        </View>
      </View>
      <ChevronRight size={20} color={colors.mutedForeground} />
    </Pressable>
  )
}

export const cardShadow = {
  shadowColor: '#0b1220',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 1,
}
