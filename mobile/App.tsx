import './global.css'
import { Platform, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ServiceApp } from '@/service-app'
import { UpdateGate } from '@/components/update-gate'
import { installWebAlert, WebAlertHost } from '@/lib/web-alert'

installWebAlert()

export default function App() {
  const app = (
    <UpdateGate>
      <ServiceApp />
    </UpdateGate>
  )

  return (
    <SafeAreaProvider
      style={Platform.OS === 'web' ? { flex: 1, width: '100%', height: '100%' } : undefined}
    >
      <StatusBar style="light" />
      {Platform.OS === 'web' ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#f3f5f8',
          }}
        >
          {app}
          <WebAlertHost />
        </View>
      ) : (
        app
      )}
    </SafeAreaProvider>
  )
}
