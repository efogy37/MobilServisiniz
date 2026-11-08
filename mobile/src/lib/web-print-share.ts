import { Alert, Platform } from 'react-native'

/** Ana ekrana eklenmiş / standalone PWA mı? */
export function isStandalonePwa(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  )
}

function downloadBlob(content: BlobPart, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function shareHtmlFile(html: string, filename: string): Promise<boolean> {
  try {
    const safeName = filename.toLowerCase().endsWith('.html') ? filename : `${filename}.html`
    const file = new File([html], safeName, { type: 'text/html' })
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) return false
    await navigator.share({ files: [file], title: safeName })
    return true
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return true
    return false
  }
}

/**
 * Web / PWA için iş emri-rapor önizleme.
 * Tarayıcı sekmesinde: yazdırma diyaloğu.
 * Ana ekrana ekli uygulamada: print çoğu cihazda açılmaz → Web Share veya indirme.
 */
export function openWebPrintPreview(html: string, opts?: { title?: string; filename?: string }) {
  if (typeof document === 'undefined') return

  const title = opts?.title ?? 'Önizleme'
  const filename = opts?.filename ?? 'belge.html'
  const frameId = 'ms-print-frame'
  document.getElementById(frameId)?.remove()

  const standalone = isStandalonePwa()
  const primaryLabel = standalone ? 'Paylaş / İndir' : 'PDF / Yazdır'

  const frame = document.createElement('iframe')
  frame.id = frameId
  frame.setAttribute('title', title)
  frame.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff;z-index:2147483647;'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    Alert.alert(title, 'Önizleme açılamadı.')
    return
  }

  const withActions = html.replace(
    '</body>',
    `<div class="noprint" style="position:sticky;bottom:0;display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom, 0px));background:#fff;border-top:1px solid #e5e7eb;z-index:2;">
      <button id="ms-print" type="button" style="flex:1;height:48px;border:0;border-radius:12px;background:#2f4a86;color:#fff;font-weight:700;font-size:16px;">${primaryLabel}</button>
      <button id="ms-close" type="button" style="flex:1;height:48px;border:0;border-radius:12px;background:#e8eaef;color:#2b3244;font-weight:700;font-size:16px;">Kapat</button>
    </div>
    <style>@media print { .noprint { display: none !important; } }</style>
    </body>`,
  )

  const runPrimary = async () => {
    if (standalone) {
      // Ana ekran PWA: iframe/window.print çoğu telefonda diyalog açmaz.
      const shared = await shareHtmlFile(html, filename)
      if (shared) return
      downloadBlob(html, filename.toLowerCase().endsWith('.html') ? filename : `${filename}.html`, 'text/html;charset=utf-8')
      Alert.alert(
        'Dosya indirildi',
        'Bu uygulama modunda yazdırma penceresi açılmıyor. İndirilen dosyayı açıp yazdırabilir veya paylaşabilirsiniz.',
      )
      return
    }

    // Normal tarayıcı: yazdır (PDF olarak kaydet seçeneği çıkar)
    try {
      win.focus()
      win.print()
    } catch {
      downloadBlob(html, filename.toLowerCase().endsWith('.html') ? filename : `${filename}.html`, 'text/html;charset=utf-8')
    }
  }

  const bind = () => {
    doc.getElementById('ms-print')?.addEventListener('click', () => {
      void runPrimary()
    })
    doc.getElementById('ms-close')?.addEventListener('click', () => frame.remove())
  }

  doc.open()
  doc.write(withActions)
  doc.close()
  if (doc.readyState === 'complete') bind()
  else frame.addEventListener('load', bind, { once: true })
}
