const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'dist', 'index.html')
let html = fs.readFileSync(file, 'utf8')

html = html.replace(
  'width=device-width, initial-scale=1, shrink-to-fit=no',
  'width=device-width, initial-scale=1, viewport-fit=cover',
)

html = html.replace('<html lang="en">', '<html lang="tr">')

const tags = `
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />
    <meta name="theme-color" content="#2f4a86" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="MobilServisiniz" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <style>
      html, body {
        height: 100%;
        min-height: 100%;
        min-height: -webkit-fill-available;
        min-height: 100dvh;
        margin: 0;
        background: #ffffff;
      }
      #root {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        height: 100dvh;
        min-height: -webkit-fill-available;
        overflow: hidden;
        background: #ffffff;
      }
    </style>`

if (!html.includes('manifest.webmanifest')) {
  html = html.replace('</head>', `${tags}\n  </head>`)
} else if (!html.includes('http-equiv="Cache-Control"')) {
  html = html.replace(
    '<meta name="theme-color"',
    '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />\n    <meta http-equiv="Pragma" content="no-cache" />\n    <meta http-equiv="Expires" content="0" />\n    <meta name="theme-color"',
  )
}

fs.writeFileSync(file, html)
console.log('index.html guncellendi')
