import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FileText, X } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { colors } from '@/lib/theme'
import { cardShadow } from '@/components/vehicle-card'
import { useKeyboardHeight } from '@/lib/keyboard'

type IconType = typeof FileText

export function AppSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  visible: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const kb = useKeyboardHeight()
  const scrollRef = useRef<ScrollView>(null)
  const bottomPad = Math.max(insets.bottom, 16) + 8
  // Modal Android'de genelde pencereyi küçültmez; sheet'i klavye kadar yukarı al.
  const lift = kb > 0 ? kb : 0
  const maxSheetHeight = Math.max(240, Math.round(windowHeight * 0.92) - lift)

  useEffect(() => {
    if (!visible || lift <= 0) return
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    }, Platform.OS === 'ios' ? 60 : 140)
    return () => clearTimeout(t)
  }, [visible, lift])

  // Web'de visible=false Modal overlay'i bazen yerinde bırakır; kapanınca tamamen kaldır.
  if (!visible) return null

  return (
    <Modal
      visible
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 0,
            backgroundColor: 'rgba(43, 50, 68, 0.4)',
          }}
        />

        <View
          className="rounded-t-3xl border-t border-border bg-card px-4 pt-3"
          style={{
            zIndex: 1,
            maxHeight: maxSheetHeight,
            paddingBottom: bottomPad,
            marginBottom: lift,
            ...sheetShadow,
          }}
        >
          <View className="mb-3 items-center">
            <View className="h-1.5 w-12 rounded-full bg-border" />
          </View>

          <View className="mb-1 flex-row items-start gap-3 px-1">
            <View className="flex-1">
              <Text className="text-lg font-extrabold tracking-tight text-foreground">{title}</Text>
              {subtitle ? (
                <Text className="mt-1 text-sm text-muted-foreground">{subtitle}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-xl bg-secondary"
            >
              <X size={18} color={colors.secondaryForeground} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
          >
            {children}
          </ScrollView>
          {footer ? <View className="pt-1">{footer}</View> : null}
        </View>
      </View>
    </Modal>
  )
}

export type SheetAction = {
  key: string
  label: string
  description?: string
  icon: IconType
  tone?: 'primary' | 'accent' | 'destructive' | 'muted'
  onPress: () => void
}

const TONE_STYLES = {
  primary: {
    bg: 'bg-primary/10',
    icon: colors.primary,
  },
  accent: {
    bg: 'bg-accent/15',
    icon: colors.accent,
  },
  destructive: {
    bg: 'bg-destructive/10',
    icon: colors.destructive,
  },
  muted: {
    bg: 'bg-secondary',
    icon: colors.secondaryForeground,
  },
} as const

export function SheetActionList({
  actions,
  onClose,
}: {
  actions: SheetAction[]
  onClose?: () => void
}) {
  return (
    <View className="gap-2">
      {actions.map((action) => {
        const tone = TONE_STYLES[action.tone ?? 'primary']
        const Icon = action.icon
        return (
          <Pressable
            key={action.key}
            onPress={() => {
              onClose?.()
              // Modal kapanış animasyonu bitsin diye kısa gecikme
              setTimeout(() => action.onPress(), 80)
            }}
            className="flex-row items-center gap-3 rounded-2xl border border-border bg-background px-3 py-3.5 active:opacity-90"
            style={cardShadow}
          >
            <View className={cn('h-11 w-11 items-center justify-center rounded-xl', tone.bg)}>
              <Icon size={20} color={tone.icon} strokeWidth={2.2} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-foreground">{action.label}</Text>
              {action.description ? (
                <Text className="mt-0.5 text-xs text-muted-foreground">{action.description}</Text>
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export function SheetCancelButton({ onPress, label = 'Vazgeç' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-3 h-12 items-center justify-center rounded-2xl bg-secondary active:opacity-90"
    >
      <Text className="text-sm font-bold text-secondary-foreground">{label}</Text>
    </Pressable>
  )
}

const sheetShadow = {
  shadowColor: '#2b3244',
  shadowOffset: { width: 0, height: -8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 16,
}
