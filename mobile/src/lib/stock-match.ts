import type { MatchCandidate, MatchLineResult, MatchStatus } from '@/lib/api'

/**
 * PDF satırı için kullanıcı/otomatik karar:
 * - existing: mevcut stok ürününe bağla (alım o ürüne işlenir / alias öğrenilir)
 * - new: yeni stok ürünü oluştur (yalnızca Dışarıdan Temin akışında)
 * - skip: iş emri akışında stokla ilişkilendirme (sadece dışarıdan parça)
 */
export type StockMatchDecision =
  | { kind: 'existing'; stockId: string; name: string; code?: string; consumeStock?: boolean }
  | { kind: 'new' }
  | { kind: 'skip' }

export type StockMatchState = {
  /** Faturadaki orijinal kod */
  rawCode?: string
  brand?: string
  /** Ön ekleri soyulmuş üretici kodu (düzenlenebilir) */
  manufacturerCode?: string
  status: MatchStatus
  candidates: MatchCandidate[]
  decision?: StockMatchDecision
}

export function matchStateFromResult(r: MatchLineResult | undefined, fallbackCode?: string, brand?: string): StockMatchState {
  if (!r) {
    return {
      rawCode: fallbackCode,
      brand,
      manufacturerCode: suggestStockCodeFromRaw(fallbackCode, brand) || fallbackCode,
      status: 'none',
      candidates: [],
    }
  }
  const raw = r.rawCode ?? fallbackCode
  const state: StockMatchState = {
    rawCode: raw,
    brand,
    manufacturerCode:
      r.manufacturerCode || suggestStockCodeFromRaw(raw, brand) || raw,
    status: r.status,
    candidates: r.candidates,
  }
  // Kesin tek eşleşme → otomatik karar (kullanıcı değiştirebilir)
  if (r.status === 'exact' && r.candidates[0]) {
    const c = r.candidates[0]
    state.decision = { kind: 'existing', stockId: c.stockId, name: c.name, code: c.code }
  }
  return state
}

export function isDecided(m: StockMatchState | undefined): boolean {
  return !!m?.decision
}

export type MatchBadgeTone = 'ok' | 'warn' | 'muted' | 'info'

/** Satır kartındaki rozet metni ve tonu. */
export function matchBadge(
  m: StockMatchState | undefined,
  mode: 'import' | 'workorder',
): { label: string; tone: MatchBadgeTone } {
  if (!m) return { label: 'Stok eşleşmesi bekleniyor', tone: 'muted' }
  if (m.decision?.kind === 'existing') {
    const code = m.decision.code ? ` (${m.decision.code})` : ''
    if (m.decision.consumeStock) {
      return { label: `Stoktan düşülecek: ${m.decision.name}${code}`, tone: 'ok' }
    }
    return { label: `Eşleşti: ${m.decision.name}${code}`, tone: 'ok' }
  }
  if (m.decision?.kind === 'new') return { label: 'Yeni stok ürünü oluşturulacak', tone: 'info' }
  if (m.decision?.kind === 'skip') return { label: 'Stokla ilişkilendirilmedi', tone: 'muted' }

  switch (m.status) {
    case 'multiple':
      return { label: `${m.candidates.length} aday bulundu — seçin`, tone: 'warn' }
    case 'suggested':
      return {
        label: `Öneri: ${m.candidates[0]?.name ?? ''} — onaylayın`,
        tone: 'warn',
      }
    case 'none':
    default:
      return mode === 'import'
        ? { label: 'Stokta bulunamadı — yeni ürün? onaylayın', tone: 'warn' }
        : { label: 'Stokta bulunamadı', tone: 'muted' }
  }
}

export function candidateReasonLabel(c: MatchCandidate): string {
  if (c.score >= 90) return 'Kod eşleşti'
  if (c.score >= 80) return 'Kod kısmen eşleşti'
  if (c.score >= 60) return 'Benzer ad'
  return 'Zayıf benzerlik'
}

/**
 * Adın başındaki tedarikçi/üretici kodunu ayırır.
 * "AYD-01827 ROT BASI SOL" → { code: "AYD-01827", rest: "ROT BASI SOL" }
 * "F-APS 14 ISITMA BUJİSİ" → { code: "F-APS 14", rest: "ISITMA BUJİSİ" }
 */
export function splitLeadingStockCode(name: string): { code?: string; rest: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { rest: name.trim() }
  let take = 0
  while (take < parts.length - 1) {
    const p = parts[take]
    const compact = p.replace(/[.\-_/]/g, '')
    const hasDigit = /\d/.test(p)
    const alphaPrefix = compact.length >= 1 && compact.length <= 6 && /^[A-Za-z]+$/.test(compact)
    const codeToken = hasDigit && compact.length >= 2 && /^[A-Za-z0-9]+$/.test(compact)
    const nextHasDigit = take + 1 < parts.length && /\d/.test(parts[take + 1])
    if (codeToken || (alphaPrefix && nextHasDigit)) {
      take += 1
      continue
    }
    break
  }
  if (take === 0) return { rest: name.trim() }
  const rest = parts.slice(take).join(' ').trim()
  if (rest.length < 2) return { rest: name.trim() }
  return { code: parts.slice(0, take).join(' '), rest }
}

/** F-APS 14 / FBI-280275 / BANDO 6PK1025 → üretici stok kodu (ön ekler soyulmuş). */
export function suggestStockCodeFromRaw(raw?: string, brand?: string): string {
  const src = (raw ?? '').trim()
  if (!src) return ''
  const segs = src.split(/[\s\-_./\\]+/).filter(Boolean)
  if (segs.length === 0) return src
  let i = 0
  const brandCanon = (brand ?? '').replace(/[\s\-_./\\]/g, '').toUpperCase()
  const firstCanon = segs[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (brandCanon.length >= 2 && firstCanon === brandCanon) i = 1
  while (i < segs.length - 1) {
    const seg = segs[i]
    if (!/^[A-Za-z]{1,6}$/.test(seg)) break
    const rest = segs.slice(i + 1).join('')
    if (!/\d/.test(rest) || rest.length < 3) break
    if (seg.length > 2 && rest.length < 5) break
    i += 1
  }
  return segs.slice(i).join(src.includes('-') ? '-' : ' ') || src
}

/** PDF satırından fatura kodu + stok kodu + temiz ad üretir. */
export function applyPdfLineCodes(name: string, code?: string, brand?: string) {
  const trimmedName = name.trim()
  const given = code?.trim()
  const split = given ? { code: given, rest: trimmedName } : splitLeadingStockCode(trimmedName)
  const rawCode = split.code
  const manufacturerCode = suggestStockCodeFromRaw(rawCode, brand) || rawCode
  return {
    name: split.rest || trimmedName,
    rawCode,
    manufacturerCode,
    brand: brand?.trim() || undefined,
  }
}
