export type JobStatus =
  | 'bekliyor'
  | 'islemde'
  | 'tamamlandi'
  | 'odeme_tamamlandi'
  | 'teslim_edildi'

export interface Customer {
  id: string
  name: string
  phone: string
  address?: string
  isSupplier?: boolean
  isCustomer?: boolean
  /** Sadece isSupplier=true kayıtlarda anlamlıdır. */
  taxNo?: string
  openingBalance?: number
  /** Müşteri alacağı: ödenmemiş iş emri kalanları. */
  balance?: number
  /** Tedarikçi borcu: opening + alış − ödeme − iade − iskonto. */
  supplierBalance?: number
}

export type ComplaintCategory =
  | 'motor'
  | 'fren'
  | 'elektrik'
  | 'klima'
  | 'suspansiyon'
  | 'kaporta'
  | 'lastik'
  | 'yag_bakim'
  | 'diagnostik'
  | 'istek'
  | 'diger'

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  motor: 'Motor',
  fren: 'Fren',
  elektrik: 'Elektrik',
  klima: 'Klima',
  suspansiyon: 'Süspansiyon',
  kaporta: 'Kaporta / Hasar',
  lastik: 'Lastik / Jant',
  yag_bakim: 'Yağ / Bakım',
  diagnostik: 'Diagnostik',
  istek: 'İstek / Talep',
  diger: 'Diğer',
}

/** Liste grup sırası */
export const COMPLAINT_CATEGORY_ORDER: ComplaintCategory[] = [
  'motor',
  'fren',
  'elektrik',
  'klima',
  'suspansiyon',
  'kaporta',
  'lastik',
  'yag_bakim',
  'diagnostik',
  'istek',
  'diger',
]

export interface Complaint {
  id: string
  text: string
  createdAt: string
  category: ComplaintCategory
}

export interface ServiceItem {
  id: string
  title: string
  price: number
}

export interface ProductItem {
  id: string
  name: string
  quantity: number
  price: number
  source: 'stok' | 'disaridan'
  supplierId?: string
  supplierName?: string
  purchasePrice?: number
  returnedAt?: string
  /** Stok kataloğundan seçildiyse — sadece ekleme sırasında kullanılır (stok düşümü için). */
  stockProductId?: string
  /** PDF akışı: faturadaki orijinal tedarikçi kodu (alias öğrenme için; stok düşmez). */
  supplierCode?: string
  /** PDF akışı: eşleştirilen stok ürünü (stok düşmeden alias ilişkisi için). */
  matchedStockProductId?: string
  manufacturerCode?: string
  brand?: string
}

export interface Supplier {
  id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  taxNo?: string
  balance: number
}

export type StockCategory =
  | 'yag'
  | 'filtre'
  | 'fren'
  | 'lastik'
  | 'elektrik'
  | 'motor'
  | 'mekanik'
  | 'diger'

export interface StockProduct {
  id: string
  name: string
  category: StockCategory
  code: string
  price: number
  stock: number
  purchasePrice?: number
}

export const STOCK_CATEGORY_LABELS: Record<StockCategory, string> = {
  yag: 'Yağ',
  filtre: 'Filtre',
  fren: 'Fren',
  lastik: 'Lastik',
  elektrik: 'Elektrik',
  motor: 'Motor',
  mekanik: 'Mekanik',
  diger: 'Diğer',
}

export interface Vehicle {
  id: string
  /** SQL Server iş emri — API işlemleri için gerekli */
  workOrderId: string
  plate: string
  brand: string
  model: string
  year: string
  color: string
  fuel: string
  chassis: string
  engineNo: string
  engineVolume: string
  km: string
  status: JobStatus
  assignedTo?: string
  createdAt: string
  startedAt?: string
  closedAt?: string
  /** Aynı araç için bu iş emrinin kaçıncı servis kaydı (1, 2, 3…). */
  visitNumber?: number
  laborTotal?: number
  partsTotal?: number
  discount?: number
  grandTotal?: number
  paidTotal?: number
  customer: Customer
  complaints: Complaint[]
  services: ServiceItem[]
  products: ProductItem[]
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  bekliyor: 'Bekliyor',
  islemde: 'İşlemde',
  tamamlandi: 'Servis Tamamlandı',
  odeme_tamamlandi: 'Ödeme Tamamlandı',
  teslim_edildi: 'Teslim Edildi',
}
