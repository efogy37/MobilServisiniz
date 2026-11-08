// React Native (Hermes) ortamında Intl yerel verisi platforma göre değişebildiği
// için Türkçe biçimlendirmeyi elle yapıyoruz; web ile birebir aynı çıktıyı verir.
//
// API tarihleri SQL SYSUTCDATETIME (UTC) ile gelir; JSON'da genelde Z/offset yoktur.
// Bunları UTC kabul edip Türkiye saatinde (UTC+3, DST yok) gösteririz.

const TR_MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

/** Türkiye sabit UTC+3 (2016'dan beri yaz saati yok). */
const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000

function groupThousands(value: number): string {
  const rounded = Math.round(value)
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function formatCurrency(value: number): string {
  return `₺${groupThousands(value)}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function hasTimezone(iso: string): boolean {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)
}

/** API'den gelen ISO tarihini UTC anı olarak çözümler. */
function parseApiUtc(iso: string): Date | null {
  try {
    const raw = iso.trim()
    if (!raw) return null
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
    const d = new Date(hasTimezone(normalized) ? normalized : `${normalized}Z`)
    if (Number.isNaN(d.getTime())) return null
    return d
  } catch {
    return null
  }
}

/** UTC anını Türkiye duvar saatine kaydırır; getUTC* ile TR alanları okunur. */
function toTurkeyWallClock(iso: string): Date | null {
  const utc = parseApiUtc(iso)
  if (!utc) return null
  return new Date(utc.getTime() + TURKEY_OFFSET_MS)
}

export function formatTime(iso: string): string {
  const d = toTurkeyWallClock(iso)
  if (!d) return ''
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

export function formatDate(iso: string): string {
  const d = toTurkeyWallClock(iso)
  if (!d) return ''
  return `${pad2(d.getUTCDate())} ${TR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Türkiye takvim günü: YYYY-MM-DD (gruplama için). */
export function toTurkeyDateKey(iso: string): string {
  const d = toTurkeyWallClock(iso)
  if (!d) return iso.slice(0, 10)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** Örn: "27 Temmuz 2026 14:30" */
export function formatDateTime(iso: string): string {
  const date = formatDate(iso)
  const time = formatTime(iso)
  if (!date) return time
  if (!time) return date
  return `${date} ${time}`
}

/** Aynı araç için tekrarlayan servis kaydı etiketi; ilk gelişte boş. */
export function formatVisitLabel(visitNumber?: number | null): string {
  const n = visitNumber != null ? Number(visitNumber) : 0
  if (!Number.isFinite(n) || n < 2) return ''
  return `${Math.trunc(n)}. kez`
}

/** Örn: "Bugün", "1 gündür bekliyor", "12 gündür bekliyor" */
export function formatDaysWaiting(days?: number | null): string {
  const n = days != null ? Math.trunc(Number(days)) : NaN
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return 'Bugün'
  if (n === 1) return '1 gündür bekliyor'
  return `${n} gündür bekliyor`
}
