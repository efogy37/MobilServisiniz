import { Platform } from 'react-native'
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy'

/** Dosya veya blob adresini API'ye gönderilecek base64'e çevirir. */
export async function readUriAsBase64(uri: string): Promise<string> {
  if (Platform.OS !== 'web') {
    return readAsStringAsync(uri, { encoding: EncodingType.Base64 })
  }
  const res = await fetch(uri)
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result ?? '')
      const comma = data.indexOf(',')
      resolve(comma >= 0 ? data.slice(comma + 1) : data)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Dosya okunamadı.'))
    reader.readAsDataURL(blob)
  })
}
