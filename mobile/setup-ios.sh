#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Klasor: $(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "HATA: Node.js yok. https://nodejs.org adresinden LTS kurun, VS Code'u kapatip acin."
  exit 1
fi

echo "Node: $(node -v)"
echo "npm install..."
npm install

echo "iOS native proje olusturuluyor (expo prebuild)..."
npx expo prebuild --platform ios --yes

if [ ! -d ios ]; then
  echo "HATA: ios klasoru yine olusmadi. Yukaridaki hata satirlarini kopyalayin."
  exit 1
fi

echo "ios icerigi:"
ls -la ios

WORKSPACE=$(ls ios/*.xcworkspace 2>/dev/null | head -n 1)
if [ -n "$WORKSPACE" ]; then
  echo "Xcode aciliyor: $WORKSPACE"
  open "$WORKSPACE"
else
  echo "xcworkspace yok, xcodeproj acilacak."
  open ios/*.xcodeproj
fi
