import { type ReactNode, useEffect, useState } from 'react'
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Car, Home, LogOut, Package, Plus, Users } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { colors } from '@/lib/theme'

export type MainTabKey = 'dashboard' | 'vehicles' | 'customers' | 'products' | 'new'

type IconType = typeof Home

const NAV_ITEMS: { key: Exclude<MainTabKey, 'new'>; label: string; icon: IconType }[] = [
  { key: 'dashboard', label: 'Ana Sayfa', icon: Home },
  { key: 'vehicles', label: 'Araçlar', icon: Car },
  { key: 'customers', label: 'Müşteri', icon: Users },
  { key: 'products', label: 'Stok', icon: Package },
]

export function AppHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: ReactNode
}) {
  const insets = useSafeAreaInsets()

  return (
    <View
      className="overflow-hidden border-b border-primary-foreground/10 bg-primary px-3 pb-2.5"
      style={{ paddingTop: insets.top + 4 }}
    >
      <View className="h-11 flex-row items-center gap-2.5">
        {onBack ? (
          <Pressable
            onPress={onBack}
            className="h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/12 active:opacity-85"
          >
            <ArrowLeft size={18} color={colors.primaryForeground} />
          </Pressable>
        ) : (
          <View className="h-8 w-8 overflow-hidden rounded-lg">
            <Image
              source={require('../../assets/logo.png')}
              style={{ width: 32, height: 32 }}
              resizeMode="cover"
            />
          </View>
        )}

        <View className="min-w-0 flex-1">
          <Text
            className="text-base font-extrabold tracking-tight text-primary-foreground"
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-[11px] text-primary-foreground/70" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {right ?? (onBack ? <View className="h-9 w-9" /> : null)}
      </View>
    </View>
  )
}

export function AppFooter({
  activeTab,
  onNavigate,
  showStock = true,
}: {
  activeTab: MainTabKey
  onNavigate: (tab: MainTabKey) => void
  showStock?: boolean
}) {
  const insets = useSafeAreaInsets()
  const rightItems = NAV_ITEMS.slice(2).filter((i) => showStock || i.key !== 'products')

  return (
    <View
      className="flex-row items-center justify-around border-t border-border bg-card px-2 pt-2"
      style={
        Platform.OS === 'web'
          ? {
              paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
              backgroundColor: '#ffffff',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.05), 0 80px 0 0 #ffffff',
            }
          : { paddingBottom: insets.bottom + 8, ...navShadow }
      }
    >
      {NAV_ITEMS.slice(0, 2).map((item) => (
        <NavButton
          key={item.key}
          label={item.label}
          icon={item.icon}
          active={activeTab === item.key}
          onPress={() => onNavigate(item.key)}
        />
      ))}

      <Pressable onPress={() => onNavigate('new')} className="items-center px-2">
        <View
          className="h-14 w-14 items-center justify-center rounded-2xl border-4 border-background bg-accent"
          style={{ transform: [{ translateY: -16 }], ...accentShadow }}
        >
          <Plus size={28} color={colors.accentForeground} strokeWidth={2.5} />
        </View>
        <Text className="text-xs font-semibold text-accent" style={{ marginTop: -8 }}>
          Yeni Kayıt
        </Text>
      </Pressable>

      {rightItems.map((item) => (
        <NavButton
          key={item.key}
          label={item.label}
          icon={item.icon}
          active={activeTab === item.key}
          onPress={() => onNavigate(item.key)}
        />
      ))}
    </View>
  )
}

export function AppShell({
  title,
  subtitle,
  onBack,
  headerRight,
  activeTab,
  onNavigate,
  showStock = true,
  children,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  headerRight?: ReactNode
  activeTab: MainTabKey
  onNavigate: (tab: MainTabKey) => void
  showStock?: boolean
  children: ReactNode
}) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, () => setKeyboardOpen(true))
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <AppHeader title={title} subtitle={subtitle} onBack={onBack} right={headerRight} />
      <View className="flex-1">{children}</View>
      {/* Alt menü klavyenin üstüne binmesin */}
      {keyboardOpen ? null : (
        <AppFooter activeTab={activeTab} onNavigate={onNavigate} showStock={showStock} />
      )}
    </KeyboardAvoidingView>
  )
}

export function HeaderLogoutButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/12 active:opacity-85"
    >
      <LogOut size={18} color={colors.primaryForeground} />
    </Pressable>
  )
}

function NavButton({
  label,
  icon: Icon,
  active,
  onPress,
}: {
  label: string
  icon: IconType
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-w-14 items-center gap-1 rounded-xl px-2 py-2"
    >
      <Icon
        size={24}
        color={active ? colors.primary : colors.mutedForeground}
        strokeWidth={active ? 2.4 : 2}
      />
      <Text
        className={cn(
          'text-xs font-semibold',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const navShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.05,
  shadowRadius: 20,
  elevation: 12,
}

const accentShadow = {
  shadowColor: '#e07d33',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.4,
  shadowRadius: 12,
  elevation: 8,
}
