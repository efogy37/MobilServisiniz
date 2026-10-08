import { useEffect, useState } from 'react'
import { Alert, Platform, Pressable, Text, View } from 'react-native'
import { colors } from '@/lib/theme'

type AlertButton = {
  text?: string
  onPress?: () => void
  style?: 'default' | 'cancel' | 'destructive'
}

type AlertRequest = {
  id: number
  title: string
  message?: string
  buttons: AlertButton[]
}

let pushAlert: ((req: AlertRequest) => void) | null = null
let seq = 0

/** react-native-web Alert.alert boş fonksiyondur; silme onayları bu yüzden hiç açılmaz. */
export function installWebAlert() {
  if (Platform.OS !== 'web') return
  Alert.alert = (title, message, buttons) => {
    const list =
      buttons && buttons.length > 0 ? buttons : [{ text: 'Tamam', style: 'default' as const }]
    const req: AlertRequest = {
      id: ++seq,
      title: title ?? '',
      message: message ?? undefined,
      buttons: list,
    }
    if (pushAlert) {
      pushAlert(req)
      return
    }
    const text = [title, message].filter(Boolean).join('\n\n')
    const cancel = list.find((b) => b.style === 'cancel')
    const accept = [...list].reverse().find((b) => b.style !== 'cancel') ?? list[0]
    if (list.length <= 1) {
      window.alert(text)
      list[0]?.onPress?.()
      return
    }
    if (window.confirm(text)) accept?.onPress?.()
    else cancel?.onPress?.()
  }
}

export function WebAlertHost() {
  const [queue, setQueue] = useState<AlertRequest[]>([])

  useEffect(() => {
    pushAlert = (req) => setQueue((q) => [...q, req])
    return () => {
      pushAlert = null
    }
  }, [])

  const current = queue[0]
  if (Platform.OS !== 'web' || !current) return null

  function close(button?: AlertButton) {
    setQueue((q) => q.filter((item) => item.id !== current.id))
    button?.onPress?.()
  }

  const cancel = current.buttons.find((b) => b.style === 'cancel')

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 2147483646,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: 'rgba(43, 50, 68, 0.45)',
      }}
    >
      <Pressable
        onPress={() => cancel && close(cancel)}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <View
        style={{
          width: '100%',
          maxWidth: 360,
          borderRadius: 20,
          backgroundColor: colors.card,
          padding: 20,
        }}
      >
        <Text className="text-lg font-extrabold text-foreground">{current.title}</Text>
        {current.message ? (
          <Text className="mt-2 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
            {current.message}
          </Text>
        ) : null}
        <View className="mt-4 gap-2">
          {current.buttons.map((button, index) => {
            const destructive = button.style === 'destructive'
            const isCancel = button.style === 'cancel'
            return (
              <Pressable
                key={`${current.id}-${index}`}
                onPress={() => close(button)}
                className={
                  destructive
                    ? 'h-12 items-center justify-center rounded-xl bg-destructive active:opacity-90'
                    : isCancel
                      ? 'h-12 items-center justify-center rounded-xl bg-secondary active:opacity-90'
                      : 'h-12 items-center justify-center rounded-xl bg-primary active:opacity-90'
                }
              >
                <Text
                  className={
                    isCancel
                      ? 'text-sm font-extrabold text-secondary-foreground'
                      : 'text-sm font-extrabold text-white'
                  }
                >
                  {button.text || 'Tamam'}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}
