import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { User, Lock, Eye, EyeOff, Check } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { colors, withAlpha } from '@/lib/theme'
import { useDesktopLayout } from '@/components/app-shell'
import {
  clearRememberedLogin,
  getRememberedLogin,
  saveRememberedLogin,
  type AuthResult,
} from '@/lib/api'

export function Login({
  onLogin,
}: {
  onLogin: (identifier: string, password: string) => Promise<AuthResult>
}) {
  const insets = useSafeAreaInsets()
  const desktop = useDesktopLayout()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [licenseLocked, setLicenseLocked] = useState(false)

  useEffect(() => {
    ;(async () => {
      const remembered = await getRememberedLogin()
      if (remembered) {
        setIdentifier(remembered.identifier || remembered.phone || '')
        setPassword(remembered.password)
        setRememberMe(true)
      }
    })()
  }, [])

  async function handleSubmit() {
    setError('')

    const id = identifier.trim()
    if (id.length < 3) {
      setError('Telefon numarası veya kullanıcı adınızı girin.')
      return
    }
    if (password.length < 4) {
      setError('Şifre en az 4 karakter olmalı.')
      return
    }

    setLoading(true)
    try {
      const res = await onLogin(id, password)
      if (!res.ok) {
        if (res.licenseExpired) {
          setLicenseLocked(true)
          setError(res.error)
          return
        }
        setLicenseLocked(false)
        setError(res.error)
        return
      }
      setLicenseLocked(false)
      if (rememberMe) {
        await saveRememberedLogin({ identifier: id, password })
      } else {
        await clearRememberedLogin()
      }
    } catch {
      setError('Bir hata oluştu, lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const form = (
        <>
          <View className="items-center">
            <View className="overflow-hidden rounded-[28px]" style={logoBox}>
              <Image
                source={require('../../assets/logo.png')}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            </View>
            <Text className="mt-5 text-3xl font-extrabold tracking-tight text-primary-foreground">
              MobilServisiniz
            </Text>
            <Text className="mt-2 text-sm text-primary-foreground/75">
              Telefon veya kullanıcı adınız ile giriş yapın
            </Text>
          </View>

          <View className="mt-8 rounded-3xl bg-card p-5" style={cardBigShadow}>
            {licenseLocked ? (
              <View className="py-2">
                <Text className="text-lg font-extrabold text-destructive">Süreniz doldu</Text>
                <Text className="mt-2 text-sm leading-5 text-muted-foreground">
                  {error ||
                    'Servis lisans süreniz dolmuştur. Yenileme için lütfen iletişime geçin.'}
                </Text>
                <Pressable
                  onPress={() => {
                    setLicenseLocked(false)
                    setError('')
                  }}
                  className="mt-5 items-center rounded-xl bg-primary py-3.5"
                >
                  <Text className="font-bold text-primary-foreground">Tekrar dene</Text>
                </Pressable>
              </View>
            ) : null}
            {!licenseLocked ? (
              <View className="flex flex-col gap-4">
                <View>
                  <Text className="text-sm font-semibold text-muted-foreground">
                    Telefon veya kullanıcı adı
                  </Text>
                  <View className="mt-1.5 flex-row items-center gap-3 rounded-xl border border-border bg-card px-4">
                    <User size={20} color={colors.mutedForeground} />
                    <TextInput
                      value={identifier}
                      onChangeText={setIdentifier}
                      placeholder="05XX XXX XX XX"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="default"
                      placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
                      className="h-14 flex-1 text-base font-medium text-foreground"
                    />
                  </View>
                </View>

                <View>
                  <Text className="text-sm font-semibold text-muted-foreground">Şifre</Text>
                  <View className="mt-1.5 flex-row items-center gap-3 rounded-xl border border-border bg-card px-4">
                    <Lock size={20} color={colors.mutedForeground} />
                    <TextInput
                      secureTextEntry={!showPass}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="••••••"
                      placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
                      className="h-14 flex-1 text-base font-medium text-foreground"
                      onSubmitEditing={handleSubmit}
                      returnKeyType="go"
                    />
                    <Pressable onPress={() => setShowPass((s) => !s)}>
                      {showPass ? (
                        <EyeOff size={20} color={colors.mutedForeground} />
                      ) : (
                        <Eye size={20} color={colors.mutedForeground} />
                      )}
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  onPress={() => setRememberMe((v) => !v)}
                  className="flex-row items-center gap-3 py-1"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rememberMe }}
                >
                  <View
                    className={cn(
                      'h-6 w-6 items-center justify-center rounded-md border',
                      rememberMe ? 'border-primary bg-primary' : 'border-border bg-card',
                    )}
                  >
                    {rememberMe && (
                      <Check size={14} color={colors.primaryForeground} strokeWidth={3} />
                    )}
                  </View>
                  <Text className="text-sm font-semibold text-foreground">Beni hatırla</Text>
                </Pressable>

                {error !== '' && (
                  <View className="rounded-xl bg-destructive/10 px-4 py-3">
                    <Text className="text-sm font-semibold text-destructive">{error}</Text>
                  </View>
                )}

                <Pressable
                  onPress={handleSubmit}
                  disabled={loading}
                  className={cn(
                    'mt-1 h-14 flex-row items-center justify-center gap-2 rounded-xl bg-accent active:opacity-90',
                    loading && 'opacity-70',
                  )}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.accentForeground} />
                  ) : (
                    <Text className="text-base font-extrabold text-accent-foreground">
                      Giriş Yap
                    </Text>
                  )}
                </Pressable>

                <Text className="text-center text-xs leading-5 text-muted-foreground">
                  Yeni hesap oluşturma yalnızca yönetici tarafından yapılır.
                </Text>
              </View>
            ) : null}
          </View>
        </>
  )

  if (desktop) {
    return (
      <View
        className="flex-1 bg-primary"
        style={{ flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}
      >
        <View style={{ maxWidth: 440, width: '100%' }}>{form}</View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1">{form}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const logoBox = {
  width: 112,
  height: 112,
  shadowColor: '#0b1220',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.25,
  shadowRadius: 16,
  elevation: 6,
}

const cardBigShadow = {
  shadowColor: '#0b1220',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.18,
  shadowRadius: 24,
  elevation: 8,
}
