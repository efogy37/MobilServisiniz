import { type ReactNode, useEffect, useState } from 'react'
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Car, Home, LogOut, Package, Plus, Users } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { colors } from '@/lib/theme'

export type MainTabKey = 'dashboard' | 'vehicles' | 'customers' | 'products' | 'new'

/** Web masaüstü: sol menü. Telefonda aynı uygulama alt sekmeli kalır. */
export const DESKTOP_BREAKPOINT = 900

export function useDesktopLayout() {
  const { width } = useWindowDimensions()
  const [inner, setInner] = useState(() =>
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.innerWidth : width,
  )

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const sync = () => setInner(window.innerWidth)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  const w = Platform.OS === 'web' ? Math.max(width, inner) : width
  return Platform.OS === 'web' && w >= DESKTOP_BREAKPOINT
}

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
  const desktop = useDesktopLayout()

  return (
    <View
      className="overflow-hidden border-b border-primary-foreground/10 bg-primary px-3 pb-2.5"
      style={{ paddingTop: desktop ? 12 : insets.top + 4 }}
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
  shopLabel,
  onLogout,
  children,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  headerRight?: ReactNode
  activeTab: MainTabKey
  onNavigate: (tab: MainTabKey) => void
  showStock?: boolean
  shopLabel?: string
  onLogout?: () => void
  children: ReactNode
}) {
  const desktop = useDesktopLayout()
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

  if (desktop) {
    return (
      <View className="flex-1 flex-row bg-background" style={{ flex: 1, flexDirection: 'row' }}>
        <DesktopSidebar
          activeTab={activeTab}
          onNavigate={onNavigate}
          showStock={showStock}
          shopLabel={shopLabel}
          onLogout={onLogout}
        />
        <View className="min-w-0 flex-1" style={{ flex: 1, minWidth: 0 }}>
          <AppHeader title={title} subtitle={subtitle} onBack={onBack} right={headerRight} />
          <View className="flex-1">{children}</View>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <AppHeader title={title} subtitle={subtitle} onBack={onBack} right={headerRight} />
      <View className="flex-1">{children}</View>
      {keyboardOpen ? null : (
        <AppFooter activeTab={activeTab} onNavigate={onNavigate} showStock={showStock} />
      )}
    </KeyboardAvoidingView>
  )
}

function DesktopSidebar({
  activeTab,
  onNavigate,
  showStock,
  shopLabel,
  onLogout,
}: {
  activeTab: MainTabKey
  onNavigate: (tab: MainTabKey) => void
  showStock: boolean
  shopLabel?: string
  onLogout?: () => void
}) {
  const items = NAV_ITEMS.filter((i) => showStock || i.key !== 'products')

  return (
    <View
      style={{
        width: 248,
        backgroundColor: colors.primary,
        paddingTop: 20,
        paddingBottom: 16,
        paddingHorizontal: 14,
        justifyContent: 'space-between',
      }}
    >
      <View>
        <View className="mb-6 flex-row items-center gap-3 px-1">
          <View className="h-10 w-10 overflow-hidden rounded-xl">
            <Image
              source={require('../../assets/logo.png')}
              style={{ width: 40, height: 40 }}
              resizeMode="cover"
            />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-extrabold text-primary-foreground" numberOfLines={1}>
              MobilServisiniz
            </Text>
            {shopLabel ? (
              <Text className="text-[11px] text-primary-foreground/70" numberOfLines={1}>
                {shopLabel}
              </Text>
            ) : null}
          </View>
        </View>

        <Pressable
          onPress={() => onNavigate('new')}
          className="mb-4 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 active:opacity-90"
        >
          <Plus size={18} color={colors.accentForeground} strokeWidth={2.5} />
          <Text className="text-sm font-bold text-accent-foreground">Yeni Kayıt</Text>
        </Pressable>

        {items.map((item) => {
          const active = activeTab === item.key
          const Icon = item.icon
          return (
            <Pressable
              key={item.key}
              onPress={() => onNavigate(item.key)}
              className="mb-1 flex-row items-center gap-3 rounded-xl px-3 py-2.5"
              style={active ? { backgroundColor: 'rgba(255,255,255,0.14)' } : undefined}
            >
              <Icon
                size={20}
                color={active ? colors.primaryForeground : 'rgba(252,252,253,0.72)'}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text
                className={cn(
                  'text-sm font-semibold',
                  active ? 'text-primary-foreground' : 'text-primary-foreground/70',
                )}
              >
                {item.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {onLogout ? (
        <Pressable
          onPress={onLogout}
          className="flex-row items-center gap-3 rounded-xl px-3 py-2.5 active:opacity-80"
        >
          <LogOut size={18} color="rgba(252,252,253,0.72)" />
          <Text className="text-sm font-semibold text-primary-foreground/70">Çıkış</Text>
        </Pressable>
      ) : null}
    </View>
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
