'use client'

import { useMemo, useState } from 'react'
import { Search, Plus, Package, ArrowLeft, Pencil, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STOCK_CATEGORY_LABELS,
  type StockCategory,
  type StockProduct,
} from '@/lib/types'
import { TextField, SelectField } from '@/components/form-field'
import { formatCurrency } from '@/lib/format'

type Filter = 'all' | StockCategory

const LOW_STOCK = 10

const categoryOptions = (Object.keys(STOCK_CATEGORY_LABELS) as StockCategory[]).map(
  (key) => ({ value: key, label: STOCK_CATEGORY_LABELS[key] }),
)

export function Products({
  products,
  onAdd,
  onUpdate,
}: {
  products: StockProduct[]
  onAdd: (p: Omit<StockProduct, 'id'>) => void
  onUpdate: (id: string, p: Omit<StockProduct, 'id'>) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<StockProduct | 'new' | null>(null)

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Tümü' },
    ...categoryOptions.map((o) => ({ key: o.value as Filter, label: o.label })),
  ]

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return products.filter((p) => {
      const matchCat = filter === 'all' || p.category === filter
      const matchQuery =
        !q ||
        `${p.name} ${p.code}`.toLocaleLowerCase('tr').includes(q)
      return matchCat && matchQuery
    })
  }, [products, query, filter])

  const lowCount = products.filter((p) => p.stock <= LOW_STOCK).length

  if (editing) {
    return (
      <ProductForm
        initial={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSave={(data) => {
          if (editing === 'new') onAdd(data)
          else onUpdate(editing.id, data)
          setEditing(null)
        }}
      />
    )
  }

  return (
    <div>
      <header className="sticky top-0 z-10 bg-background/95 px-5 pb-3 pt-8 backdrop-blur">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          Ürün & Stok
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {products.length} ürün
          {lowCount > 0 && (
            <span className="ml-1 font-semibold text-destructive">
              · {lowCount} üründe stok az
            </span>
          )}
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card px-4 shadow-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
          <Search className="size-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ürün adı veya kodu ara"
            className="h-14 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setEditing('new')}
          className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-base font-bold text-accent-foreground shadow-lg shadow-accent/25 transition-transform active:scale-[0.99]"
        >
          <Plus className="size-6" strokeWidth={2.4} /> Yeni Ürün Ekle
        </button>
      </header>

      <div className="px-5 pt-2">
        {filtered.length === 0 ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
              <Package className="size-8 text-muted-foreground" />
            </span>
            <p className="mt-4 text-base font-bold text-foreground">
              Ürün bulunamadı
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Aramanı değiştir veya yeni bir ürün ekle.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((p) => {
              const low = p.stock <= LOW_STOCK
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
                        {STOCK_CATEGORY_LABELS[p.category]}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-base font-bold text-foreground">
                      {p.name}
                    </p>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="text-base font-extrabold text-primary">
                        {formatCurrency(p.price)}
                      </span>
                      <span
                        className={cn(
                          'flex items-center gap-1 text-sm font-semibold',
                          low ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {low && <AlertTriangle className="size-4" />}
                        {p.stock} adet
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
                    aria-label={`${p.name} düzenle`}
                  >
                    <Pencil className="size-5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ProductForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: StockProduct | null
  onCancel: () => void
  onSave: (data: Omit<StockProduct, 'id'>) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [code, setCode] = useState(initial?.code ?? '')
  const [category, setCategory] = useState<StockCategory>(
    initial?.category ?? 'diger',
  )
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [purchasePrice, setPurchasePrice] = useState(
    initial && 'purchasePrice' in initial && initial.purchasePrice != null && initial.purchasePrice > 0
      ? String(initial.purchasePrice)
      : '',
  )
  const [stock, setStock] = useState(initial ? String(initial.stock) : '')
  const [error, setError] = useState('')

  function handleSave() {
    if (name.trim().length < 2) {
      setError('Lütfen ürün adını girin.')
      return
    }
    const priceNum = Number(price.replace(',', '.'))
    if (!priceNum || priceNum <= 0) {
      setError('Lütfen geçerli bir satış fiyatı girin.')
      return
    }
    const purchaseRaw = purchasePrice.trim().replace(',', '.')
    const purchaseNum = purchaseRaw === '' ? undefined : Number(purchaseRaw)
    if (purchaseNum != null && (Number.isNaN(purchaseNum) || purchaseNum < 0)) {
      setError('Alış fiyatı geçersiz.')
      return
    }
    onSave({
      name: name.trim(),
      code: code.trim() || '-',
      category,
      price: priceNum,
      ...(purchaseNum != null && purchaseNum > 0 ? { purchasePrice: purchaseNum } : {}),
      stock: Number(stock) || 0,
    } as Omit<StockProduct, 'id'>)
  }

  return (
    <div>
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/95 px-5 pb-3 pt-8 backdrop-blur">
        <button
          type="button"
          onClick={onCancel}
          className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
          aria-label="Geri"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-xl font-extrabold tracking-tight text-foreground">
          {initial ? 'Ürünü Düzenle' : 'Yeni Ürün'}
        </h1>
      </header>

      <div className="flex flex-col gap-4 px-5 pt-2">
        <TextField
          label="Ürün Adı"
          value={name}
          onChange={setName}
          placeholder="Örn. Motor Yağı 5W-30"
        />
        <SelectField
          label="Kategori"
          value={category}
          onChange={(v) => setCategory(v as StockCategory)}
          options={categoryOptions}
        />
        <TextField
          label="Ürün Kodu (isteğe bağlı)"
          value={code}
          onChange={setCode}
          placeholder="Örn. YG-530-5"
        />
        <div className="flex gap-3">
          <TextField
            label="Alış fiyatı (₺)"
            value={purchasePrice}
            onChange={setPurchasePrice}
            placeholder="0"
            inputMode="decimal"
            className="flex-1"
          />
          <TextField
            label="Satış fiyatı (₺)"
            value={price}
            onChange={setPrice}
            placeholder="0"
            inputMode="decimal"
            className="flex-1"
          />
        </div>
        <TextField
          label="Stok (adet)"
          value={stock}
          onChange={setStock}
          placeholder="0"
          inputMode="numeric"
        />

        {error && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="mt-1 flex h-14 items-center justify-center rounded-xl bg-primary text-base font-extrabold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-[0.99]"
        >
          {initial ? 'Değişiklikleri Kaydet' : 'Ürünü Kaydet'}
        </button>
      </div>
    </div>
  )
}
