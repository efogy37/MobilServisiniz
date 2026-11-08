export type JobStatus = 'bekliyor' | 'islemde' | 'tamamlandi'

export interface Customer {
  id: string
  name: string
  phone: string
  address?: string
}

export interface Complaint {
  id: string
  text: string
  createdAt: string
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
  plate: string
  brand: string
  model: string
  year: string
  color: string
  fuel: string
  chassis: string
  km: string
  status: JobStatus
  createdAt: string
  customer: Customer
  complaints: Complaint[]
  services: ServiceItem[]
  products: ProductItem[]
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  bekliyor: 'Bekliyor',
  islemde: 'İşlemde',
  tamamlandi: 'Servis Tamamlandı',
}
