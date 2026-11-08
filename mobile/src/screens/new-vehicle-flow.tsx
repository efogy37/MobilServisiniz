import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import {
  ArrowLeft,
  Camera,
  ImageIcon,
  Sparkles,
  Check,
  CarFront,
  User,
  UserPlus,
  UserCheck,
  Search,
  Keyboard,
  MessageSquareWarning,
  X,
} from 'lucide-react-native'
import { cn } from '@/lib/utils'
import type { ComplaintCategory, Customer, Vehicle } from '@/lib/types'
import {
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_CATEGORY_ORDER,
} from '@/lib/types'
import { scanRuhsat } from '@/lib/ai-scan'
import { getCachedEntitlements } from '@/lib/api'
import { TextField, TextArea, SelectField } from '@/components/form-field'
import { ArrivalDateField, turkeyTodayIso } from '@/components/arrival-date-field'
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll'
import { colors, withAlpha } from '@/lib/theme'
import { PlateConflictError } from '@/lib/api'

type Step = 0 | 1 | 2 | 3
type IconType = typeof User
const stepTitles = ['Ruhsat', 'Araç', 'Müşteri', 'Şikayet']

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function NewVehicleFlow({
  customers,
  onCancel: _onCancel,
  onComplete,
  onTransferConflict,
}: {
  customers: Customer[]
  onCancel: () => void
  onComplete: (vehicle: Vehicle, opts?: { ruhsatUri?: string }) => Promise<void>
  onTransferConflict: (
    vehicleId: string,
    newCustomerId: string,
    complaint: string,
    complaintCategory?: ComplaintCategory,
  ) => void
}) {
  const [step, setStep] = useState<Step>(0)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [ruhsatUri, setRuhsatUri] = useState<string | undefined>()

  const [plate, setPlate] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('')
  const [fuel, setFuel] = useState('')
  const [chassis, setChassis] = useState('')
  const [engineNo, setEngineNo] = useState('')
  const [engineVolume, setEngineVolume] = useState('')
  const [km, setKm] = useState('')

  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>(
    customers.length > 0 ? 'existing' : 'new',
  )
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  const [complaint, setComplaint] = useState('')
  const [complaintCategory, setComplaintCategory] = useState<ComplaintCategory>('diger')
  const [arrivalDate, setArrivalDate] = useState(turkeyTodayIso)

  async function pickImage(source: 'camera' | 'gallery') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Kamera izni gerekli', 'Ruhsatı çekmek için kamera iznini verin.')
        return null
      }
      return ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.45,
        base64: true,
        exif: false,
      })
    }

    // Android 13+ sistem foto seçici çoğu durumda tam galeri izni istemez.
    // BlueStacks / emülatörde izin reddedilse bile picker'ı açmayı deneriz.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted && Platform.OS === 'ios') {
      Alert.alert('Galeri izni gerekli', 'Ruhsat fotoğrafını seçmek için galeri iznini verin.')
      return null
    }

    try {
      return await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.45,
        base64: true,
        exif: false,
        allowsMultipleSelection: false,
        // Emülatör / BlueStacks uyumu için eski dosya seçici
        legacy: true,
      })
    } catch {
      return ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.45,
        base64: true,
        exif: false,
        allowsMultipleSelection: false,
      })
    }
  }

  async function runScan(source: 'camera' | 'gallery') {
    try {
      const result = await pickImage(source)
      if (!result || result.canceled) {
        if (source === 'gallery') {
          Alert.alert(
            'Galeri',
            'Fotoğraf seçilmedi.\n\nBlueStacks kullanıyorsanız:\n1) PC’deki ruhsat fotoğrafını BlueStacks Media Manager’a sürükleyin\n2) Sonra uygulamada tekrar Galeriden Seç’e basın',
          )
        }
        return
      }
      const asset = result.assets?.[0]
      if (!asset?.base64) {
        Alert.alert(
          'Hata',
          'Fotoğraf okunamadı. BlueStacks’te önce fotoğrafı Media Manager’a ekleyip Galeri’den seçin.',
        )
        return
      }

      if (getCachedEntitlements()?.features.aiRuhsat === false) {
        Alert.alert('Paket özelliği', 'AI ruhsat okuma bu pakette yok.')
        return
      }
      setScanning(true)
      setRuhsatUri(asset.uri)
      const data = await scanRuhsat(asset.base64, asset.mimeType ?? 'image/jpeg')
      setPlate(data.plate)
      setBrand(data.brand)
      setModel(data.model)
      setYear(data.year)
      setColor(data.color)
      setFuel(data.fuel)
      setChassis(data.chassis)
      setEngineNo(data.engineNo)
      setEngineVolume(data.engineVolume)
      setScanned(true)

      if (!data.plate && !data.brand && !data.model) {
        Alert.alert(
          'Bilgi okunamadı',
          'Ruhsattan bilgi çıkarılamadı. Daha net bir fotoğraf çekin veya bilgileri elle düzeltin.',
        )
      }
    } catch (e) {
      Alert.alert(
        'Ruhsat okunamadı',
        e instanceof Error ? e.message : 'Bilinmeyen bir hata oluştu. Manuel giriş yapabilirsiniz.',
      )
    } finally {
      setScanning(false)
    }
  }

  function startManual() {
    setScanned(false)
    setStep(1)
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null

  async function handleSave() {
    const missing: string[] = []
    if (!plate) missing.push('Plaka')
    if (!brand) missing.push('Marka')
    if (!model) missing.push('Model')
    if (customerMode === 'existing') {
      if (!selectedCustomer) missing.push('Müşteri Seçimi')
    } else {
      if (!name) missing.push('Ad Soyad')
      if (!phone) missing.push('Telefon')
    }
    if (missing.length > 0) {
      Alert.alert('Eksik bilgi', `Lütfen zorunlu alanları doldurun: ${missing.join(', ')}`)
      return
    }
    const now = new Date().toISOString()
    const customer: Customer =
      customerMode === 'existing' && selectedCustomer
        ? selectedCustomer
        : { id: uid(), name, phone, address }

    const vehicle: Vehicle = {
      id: uid(),
      workOrderId: '',
      plate: plate || 'PLAKA YOK',
      brand,
      model,
      year,
      color,
      fuel,
      chassis,
      engineNo,
      engineVolume,
      km,
      status: 'bekliyor',
      // YYYY-MM-DD → createVehicleApi openedAt olarak gönderilir
      createdAt: arrivalDate || now,
      customer,
      complaints: complaint.trim()
        ? [
            {
              id: uid(),
              text: complaint.trim(),
              createdAt: arrivalDate || now,
              category: complaintCategory,
            },
          ]
        : [],
      services: [],
      products: [],
    }

    try {
      await onComplete(vehicle, ruhsatUri ? { ruhsatUri } : undefined)
    } catch (e) {
      if (e instanceof PlateConflictError && e.resolvedCustomerId) {
        const newCustomerId = e.resolvedCustomerId
        Alert.alert(
          'Plaka zaten kayıtlı',
          `Bu plaka zaten ${e.conflict.customerName} adlı müşteriye kayıtlı. Bu aracı yeni müşteriye devretmek ister misiniz?`,
          [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Devret',
              style: 'destructive',
              onPress: () =>
                onTransferConflict(
                  e.conflict.vehicleId,
                  newCustomerId,
                  complaint.trim(),
                  complaintCategory,
                ),
            },
          ],
        )
      }
    }
  }

  const canNextVehicle = Boolean(plate && brand && model)
  const canNextCustomer =
    customerMode === 'existing' ? Boolean(selectedCustomer) : Boolean(name && phone)

  function handleNextVehicle() {
    const missing: string[] = []
    if (!plate) missing.push('Plaka')
    if (!brand) missing.push('Marka')
    if (!model) missing.push('Model')
    if (missing.length > 0) {
      Alert.alert('Eksik bilgi', `Lütfen zorunlu alanları doldurun: ${missing.join(', ')}`)
      return
    }
    setStep(2)
  }

  function handleNextCustomer() {
    if (customerMode === 'existing') {
      if (!selectedCustomer) {
        Alert.alert('Eksik bilgi', 'Lütfen devam etmeden önce bir müşteri seçin.')
        return
      }
      setStep(3)
      return
    }
    const missing: string[] = []
    if (!name) missing.push('Ad Soyad')
    if (!phone) missing.push('Telefon')
    if (missing.length > 0) {
      Alert.alert('Eksik bilgi', `Lütfen zorunlu alanları doldurun: ${missing.join(', ')}`)
      return
    }
    setStep(3)
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 bg-background px-4 pb-3 pt-3">
        {step > 0 ? (
          <Pressable
            onPress={() => setStep((step - 1) as Step)}
            className="h-11 w-11 items-center justify-center rounded-xl bg-secondary"
          >
            <ArrowLeft size={20} color={colors.secondaryForeground} />
          </Pressable>
        ) : null}
        <View className="flex-1">
          <Text className="text-xs font-semibold text-muted-foreground">
            Adım {step + 1} / 4
          </Text>
          <Text className="text-lg font-extrabold text-foreground">
            {stepTitles[step]}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-1.5 px-5">
        {stepTitles.map((_, i) => (
          <View
            key={i}
            className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-border')}
          />
        ))}
      </View>

      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24 }}
        basePaddingBottom={48}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <ScanStep
            scanning={scanning}
            scanned={scanned}
            onScanCamera={() => runScan('camera')}
            onScanGallery={() => runScan('gallery')}
            onManual={startManual}
            plate={plate}
            brand={brand}
            model={model}
            onContinue={() => setStep(1)}
          />
        )}

        {step === 1 && (
          <View className="flex flex-col gap-4">
            {scanned && (
              <View className="flex-row items-center gap-2 rounded-xl bg-chart-4/10 px-4 py-3">
                <Sparkles size={16} color={colors.chart4} />
                <Text className="flex-1 text-sm font-semibold text-chart-4">
                  Bilgiler ruhsattan otomatik dolduruldu. Kontrol edip düzeltebilirsin.
                </Text>
              </View>
            )}
            <TextField label="Plaka" value={plate} onChange={(v) => setPlate(v.toUpperCase())} placeholder="Örn: 34 ABC 123" required />
            <View className="flex-row gap-3">
              <TextField label="Marka" value={brand} onChange={setBrand} placeholder="Örn: Toyota" className="flex-1" required />
              <TextField label="Model" value={model} onChange={setModel} placeholder="Örn: Corolla" className="flex-1" required />
            </View>
            <View className="flex-row gap-3">
              <TextField label="Yıl" value={year} onChange={setYear} inputMode="numeric" placeholder="Örn: 2020" className="flex-1" />
              <TextField label="Renk" value={color} onChange={setColor} placeholder="Örn: Beyaz" className="flex-1" />
            </View>
            <View className="flex-row gap-3">
              <TextField label="Yakıt" value={fuel} onChange={setFuel} placeholder="Örn: Dizel" className="flex-1" />
              <TextField label="Kilometre" value={km} onChange={setKm} inputMode="numeric" placeholder="Örn: 120.000" className="flex-1" />
            </View>
            <TextField label="Şasi No" value={chassis} onChange={(v) => setChassis(v.toUpperCase())} placeholder="Örn: WVWZZZ..." />
            <View className="flex-row gap-3">
              <TextField label="Motor No" value={engineNo} onChange={setEngineNo} placeholder="Örn: CXX..." className="flex-1" />
              <TextField label="Motor Hacmi" value={engineVolume} onChange={setEngineVolume} placeholder="Örn: 1598 cm³" className="flex-1" />
            </View>
            <StepButton muted={!canNextVehicle} onPress={handleNextVehicle} label="Devam Et" />
          </View>
        )}

        {step === 2 && (
          <CustomerStep
            customers={customers}
            mode={customerMode}
            onModeChange={setCustomerMode}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={setSelectedCustomerId}
            name={name}
            phone={phone}
            address={address}
            onName={setName}
            onPhone={setPhone}
            onAddress={setAddress}
            canNext={canNextCustomer}
            onNext={handleNextCustomer}
          />
        )}

        {step === 3 && (
          <View className="flex flex-col gap-4">
            <IntroLine
              icon={MessageSquareWarning}
              text="Müşterinin belirttiği şikayet / istek"
            />
            <SelectField
              label="Kategori"
              value={complaintCategory}
              onChange={(v) => setComplaintCategory(v as ComplaintCategory)}
              options={COMPLAINT_CATEGORY_ORDER.map((value) => ({
                value,
                label: COMPLAINT_CATEGORY_LABELS[value],
              }))}
            />
            <TextArea
              label="Şikayet / İstek"
              value={complaint}
              onChange={setComplaint}
              rows={5}
              placeholder="Örn: Motordan ses geliyor, fren balataları ses yapıyor..."
            />
            <ArrivalDateField value={arrivalDate} onChange={setArrivalDate} />
            <StepButton onPress={handleSave} variant="accent">
              <Check size={20} color={colors.accentForeground} />
              <Text className="text-base font-extrabold text-accent-foreground">
                Kaydı Tamamla
              </Text>
            </StepButton>
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  )
}

function ScanStep({
  scanning,
  scanned,
  onScanCamera,
  onScanGallery,
  onManual,
  plate,
  brand,
  model,
  onContinue,
}: {
  scanning: boolean
  scanned: boolean
  onScanCamera: () => void
  onScanGallery: () => void
  onManual: () => void
  plate: string
  brand: string
  model: string
  onContinue: () => void
}) {
  return (
    <View className="items-center">
      <View
        className={cn(
          'aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed',
          scanned ? 'border-chart-4/40 bg-chart-4/5' : 'border-border bg-secondary',
        )}
      >
        {scanning ? (
          <View className="items-center gap-3">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text className="text-sm font-bold text-primary">
              Yapay zeka ruhsatı okuyor...
            </Text>
          </View>
        ) : scanned ? (
          <View className="items-center gap-2">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-chart-4/15">
              <Check size={36} color={colors.chart4} strokeWidth={2.5} />
            </View>
            <Text className="text-base font-extrabold text-chart-4">Ruhsat Okundu</Text>
            <Text className="font-mono text-sm font-bold text-foreground">{plate}</Text>
            <Text className="text-sm text-muted-foreground">
              {brand} {model}
            </Text>
          </View>
        ) : (
          <View className="items-center gap-2">
            <CarFront size={48} color={colors.mutedForeground} />
            <Text className="px-8 text-center text-sm font-medium text-muted-foreground">
              Ruhsatın fotoğrafını çek, araç bilgileri otomatik dolsun
            </Text>
          </View>
        )}
      </View>

      {!scanned ? (
        <View className="mt-6 w-full flex flex-col gap-3">
          <StepButton onPress={onScanCamera} disabled={scanning} variant="accent">
            {scanning ? (
              <>
                <ActivityIndicator color={colors.accentForeground} />
                <Text className="text-base font-extrabold text-accent-foreground">
                  Okunuyor...
                </Text>
              </>
            ) : (
              <>
                <Camera size={20} color={colors.accentForeground} />
                <Text className="text-base font-extrabold text-accent-foreground">
                  Ruhsat Fotoğrafı Çek
                </Text>
              </>
            )}
          </StepButton>

          <Pressable
            onPress={onScanGallery}
            disabled={scanning}
            className={cn(
              'h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card active:opacity-90',
              scanning && 'opacity-40',
            )}
          >
            <ImageIcon size={20} color={colors.foreground} />
            <Text className="text-base font-extrabold text-foreground">
              Galeriden Seç
            </Text>
          </Pressable>

          <View className="flex-row items-center gap-3 py-1">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-xs font-semibold text-muted-foreground">ya da</Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <Pressable
            onPress={onManual}
            disabled={scanning}
            className={cn(
              'h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card active:opacity-90',
              scanning && 'opacity-40',
            )}
          >
            <Keyboard size={20} color={colors.foreground} />
            <Text className="text-base font-extrabold text-foreground">
              Fotoğrafsız Manuel Giriş
            </Text>
          </Pressable>
          <Text className="text-center text-xs text-muted-foreground">
            Ruhsat fotoğrafı yoksa bilgileri kendin yazabilirsin.
          </Text>
        </View>
      ) : (
        <View className="mt-6 w-full flex flex-col gap-3">
          <StepButton onPress={onContinue} label="Bilgileri Kontrol Et" />
          <Pressable
            onPress={onScanCamera}
            className="h-12 items-center justify-center rounded-xl active:opacity-70"
          >
            <Text className="text-sm font-semibold text-muted-foreground">
              Tekrar Çek
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

function CustomerStep({
  customers,
  mode,
  onModeChange,
  selectedCustomerId,
  onSelectCustomer,
  name,
  phone,
  address,
  onName,
  onPhone,
  onAddress,
  canNext,
  onNext,
}: {
  customers: Customer[]
  mode: 'existing' | 'new'
  onModeChange: (m: 'existing' | 'new') => void
  selectedCustomerId: string | null
  onSelectCustomer: (id: string) => void
  name: string
  phone: string
  address: string
  onName: (v: string) => void
  onPhone: (v: string) => void
  onAddress: (v: string) => void
  canNext: boolean
  onNext: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    if (!q) return customers
    return customers.filter((c) => {
      const name = c.name.toLocaleLowerCase('tr')
      const phone = c.phone.replace(/\s+/g, '')
      const qPhone = q.replace(/\s+/g, '')
      return name.includes(q) || phone.includes(qPhone)
    })
  }, [customers, query])

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null

  return (
    <View className="flex flex-col gap-4">
      <IntroLine icon={User} text="Aracı getiren müşteriyi seç veya ekle" />

      <View className="flex-row gap-2 rounded-2xl bg-secondary p-1.5">
        <ModeTab
          active={mode === 'existing'}
          icon={UserCheck}
          label="Kayıtlı Müşteri"
          onPress={() => onModeChange('existing')}
        />
        <ModeTab
          active={mode === 'new'}
          icon={UserPlus}
          label="Yeni Müşteri"
          onPress={() => onModeChange('new')}
        />
      </View>

      {mode === 'existing' ? (
        <>
          <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-4">
            <Search size={20} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="İsim veya telefon ara"
              placeholderTextColor={withAlpha(colors.mutedForeground, 0.6)}
              className="h-14 flex-1 text-base font-medium text-foreground"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {selectedCustomer ? (
            <View className="flex-row items-center gap-3 rounded-2xl border-2 border-primary bg-primary/5 p-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary">
                <Text className="text-base font-extrabold text-primary-foreground">
                  {selectedCustomer.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase tracking-wide text-primary">
                  Seçili müşteri
                </Text>
                <Text className="font-bold text-foreground" numberOfLines={1}>
                  {selectedCustomer.name}
                </Text>
                <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                  {selectedCustomer.phone}
                </Text>
              </View>
              <Check size={20} color={colors.primary} strokeWidth={2.5} />
            </View>
          ) : null}

          <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {filtered.length} müşteri
            {query.trim() ? ` · “${query.trim()}”` : ''}
          </Text>

          <View
            className="overflow-hidden rounded-2xl border border-border bg-card"
            style={{ maxHeight: 280 }}
          >
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 280 }}
              contentContainerStyle={{ padding: 8, gap: 8 }}
            >
              {filtered.length === 0 ? (
                <View className="rounded-xl bg-secondary px-4 py-6">
                  <Text className="text-center text-sm font-medium text-muted-foreground">
                    Müşteri bulunamadı. "Yeni Müşteri" ile ekleyebilirsin.
                  </Text>
                </View>
              ) : (
                filtered.map((c) => {
                  const active = c.id === selectedCustomerId
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => onSelectCustomer(c.id)}
                      className={cn(
                        'flex-row items-center gap-3 rounded-2xl border-2 bg-card p-3',
                        active ? 'border-primary bg-primary/5' : 'border-border',
                      )}
                    >
                      <View
                        className={cn(
                          'h-11 w-11 items-center justify-center rounded-xl',
                          active ? 'bg-primary' : 'bg-secondary',
                        )}
                      >
                        <Text
                          className={cn(
                            'text-base font-extrabold',
                            active ? 'text-primary-foreground' : 'text-secondary-foreground',
                          )}
                        >
                          {c.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-bold text-foreground" numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                          {c.phone}
                        </Text>
                      </View>
                      {active ? <Check size={20} color={colors.primary} strokeWidth={2.5} /> : null}
                    </Pressable>
                  )
                })
              )}
            </ScrollView>
          </View>
        </>
      ) : (
        <>
          <TextField label="Ad Soyad" value={name} onChange={onName} placeholder="Örn: Ahmet Yılmaz" required />
          <TextField label="Telefon" value={phone} onChange={onPhone} inputMode="tel" placeholder="Örn: 0532 000 00 00" required />
          <TextField label="Adres (isteğe bağlı)" value={address} onChange={onAddress} placeholder="Örn: İlçe, İl" />
        </>
      )}

      <StepButton muted={!canNext} onPress={onNext} label="Devam Et" />
    </View>
  )
}

function ModeTab({
  active,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean
  icon: IconType
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl',
        active && 'bg-card',
      )}
    >
      <Icon size={16} color={active ? colors.foreground : colors.mutedForeground} />
      <Text
        className={cn(
          'text-sm font-bold',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function IntroLine({ icon: Icon, text }: { icon: IconType; text: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={16} color={colors.primary} />
      <Text className="text-sm font-semibold text-muted-foreground">{text}</Text>
    </View>
  )
}

function StepButton({
  children,
  label,
  onPress,
  disabled,
  muted,
  variant = 'primary',
}: {
  children?: React.ReactNode
  label?: string
  onPress: () => void
  disabled?: boolean
  muted?: boolean
  variant?: 'primary' | 'accent'
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl active:opacity-95',
        variant === 'accent' ? 'bg-accent' : 'bg-primary',
        disabled && 'opacity-40',
        muted && !disabled && 'opacity-60',
      )}
    >
      {children ?? (
        <Text
          className={cn(
            'text-base font-extrabold',
            variant === 'accent' ? 'text-accent-foreground' : 'text-primary-foreground',
          )}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}
