import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Calendar } from 'lucide-react-native'
import { colors } from '@/lib/theme'

/** Türkiye takvim günü YYYY-MM-DD (UTC+3). */
export function turkeyTodayIso(): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function toIsoLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTr(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

/** Yeni araç / yeni ziyaret için geliş tarihi seçici. */
export function ArrivalDateField({
  value,
  onChange,
  label = 'Geliş tarihi',
  hint = 'Geçmiş tarihli kayıt için tarihi değiştirin',
}: {
  value: string
  onChange: (iso: string) => void
  label?: string
  hint?: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const max = turkeyTodayIso()

  return (
    <View>
      <Text className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </Text>
      {Platform.OS === 'web' ? (
        <View className="h-12 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3">
          <Calendar size={16} color={colors.mutedForeground} />
          <input
            type="date"
            value={value}
            max={max}
            onChange={(e) => {
              const next = e.target.value
              if (next && next <= max) onChange(next)
            }}
            style={{
              border: 'none',
              background: 'transparent',
              flex: 1,
              fontWeight: 700,
              fontSize: 15,
              color: colors.foreground,
              outline: 'none',
            }}
          />
        </View>
      ) : (
        <>
          <Pressable
            onPress={() => setPickerOpen(true)}
            className="h-12 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 active:bg-muted"
          >
            <Calendar size={16} color={colors.mutedForeground} />
            <Text className="text-[15px] font-bold text-foreground">{formatTr(value)}</Text>
          </Pressable>
          {pickerOpen ? (
            <DateTimePicker
              value={parseIsoLocal(value)}
              mode="date"
              maximumDate={parseIsoLocal(max)}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                if (Platform.OS === 'android') setPickerOpen(false)
                if (event.type === 'dismissed' || !date) return
                const iso = toIsoLocal(date)
                if (iso <= max) onChange(iso)
                if (Platform.OS === 'ios') setPickerOpen(false)
              }}
            />
          ) : null}
        </>
      )}
      {hint ? (
        <Text className="mt-1 text-[11px] text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  )
}
