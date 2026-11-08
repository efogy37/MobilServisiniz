# MobilServisiniz — Sunucu Kurulum Rehberi

**Sunucu:** `31.57.33.85`
**Domain (IIS üzerinden, önerilen):**
- API: `https://api.mobilservisiniz.com`
- Admin (servis paneli): `https://panel.mobilservisiniz.com`
- Platform (tüm servisler / üst yönetim): `https://yonetim.mobilservisiniz.com`

**Eski IP:port (geçiş süresince IIS aynı binding'leri de sunuyor, geriye uyumluluk için):**
- API: `http://31.57.33.85:5280`
- Admin: `http://31.57.33.85:5281`
- Platform: `http://31.57.33.85:5282`

**SQL Server:** `31.57.33.85` / `OtoServis` / `otoservis_api`

**Kurulum / fotoğraf kökü:** `"Storage": { "Root": "C:\\\\inetpub\\\\wwwroot\\\\mobilservisiniz" }`.
Fotoğraflar `{Root}\\api\\wwwroot\\uploads`. Web (PWA) klasörü `{Root}\\app`.

---

## 0. Domain + IIS ilk kurulumu (bir kez yapılır)

Servisler artık IIS tarafından (ASP.NET Core Hosting Bundle + In-Process hosting) barındırılıyor.
IIS, her uygulamanın process yaşam döngüsünü kendisi yönetir (otomatik başlatma, çökme sonrası
yeniden başlatma, sunucu reboot sonrası otomatik ayağa kalkma) — elle `start-*.bat` çalıştırmaya
gerek kalmaz.

İlk kurulum adımları: **`publish\iis-setup\README.md`** (Cloudflare DNS/SSL → Hosting Bundle
kurulumu → IIS Site/App Pool oluşturma → dosya izinleri → cutover). Bu, tek seferlik bir kurulumdur;
sonraki güncellemeler için sadece aşağıdaki adım 1-4 yeterlidir.

---

## 1. Publish (yerel makinede)

```powershell
cd api
.\deploy.ps1 -SkipDeploy
```

Çıktı klasörleri:
- `publish\api\` — REST API
- `publish\admin\` — Servis web paneli
- `publish\platform\` — Platform yönetim paneli
- `publish\OtoServis-Api.zip`
- `publish\OtoServis-Admin.zip`
- `publish\OtoServis-Platform.zip`

Platform / lisans SQL:
- `publish\15_platform_admin.sql`
- `publish\16_shop_license.sql`

---

## 2. Sunucu gereksinimleri

1. **.NET 8 Runtime (ASP.NET Core)** — IIS kurulumu yapıldıysa Hosting Bundle bunu da kurar.
   Manuel kurulum: https://dotnet.microsoft.com/download/dotnet/8.0

2. **Firewall** — gelen TCP portları açın:
   - `80`, `443` — IIS/domain (asıl trafik)
   - `5280`, `5281`, `5282` — eski IP:port (geçiş süresince, mobil uygulamanın eski sürümleri için)

```powershell
New-NetFirewallRule -DisplayName "OtoServis API 5280" -Direction Inbound -Protocol TCP -LocalPort 5280 -Action Allow
New-NetFirewallRule -DisplayName "OtoServis Admin 5281" -Direction Inbound -Protocol TCP -LocalPort 5281 -Action Allow
New-NetFirewallRule -DisplayName "OtoServis Platform 5282" -Direction Inbound -Protocol TCP -LocalPort 5282 -Action Allow
```

---

## 3. Sunucuya kopyalama (RDP ile)

1. Zip + SQL dosyalarını `C:\inetpub\wwwroot\mobilservisiniz\` altına kopyalayın
2. PowerShell:

```powershell
$root = "C:\inetpub\wwwroot\mobilservisiniz"
Expand-Archive "$root\OtoServis-Api.zip" -DestinationPath "$root\api" -Force
Expand-Archive "$root\OtoServis-Admin.zip" -DestinationPath "$root\admin" -Force
Expand-Archive "$root\OtoServis-Platform.zip" -DestinationPath "$root\platform" -Force
Expand-Archive "$root\OtoServis-Web.zip" -DestinationPath "$root\app" -Force
```

---

## 4. Başlatma

IIS kurulumu yapıldıysa (bkz. `publish\iis-setup\`), dosyaları güncelledikten sonra sadece:

```powershell
C:\inetpub\wwwroot\mobilservisiniz\iis-setup\Restart-OtoServis.ps1
```

çalıştırmanız yeterli — IIS App Pool'larını algılayıp onları yeniden başlatır. IIS henüz
kurulmadıysa aynı script otomatik olarak eski `dotnet X.dll` konsol yöntemine geri döner
(veya elle: `start-api.bat` / `start-admin.bat` / `start-platform.bat`).

Ya da tek adımda hepsini yapan: **`SUNUCU-GUNCELLE.bat`** (SQL migration + zip açma + servisleri
yeniden başlatma — IIS varsa App Pool, yoksa eski süreç yöntemiyle).

---

## 5. Test

| Test | Yeni (domain) | Eski (IP:port, geçiş süresince) |
|------|------|------|
| API Swagger | https://api.mobilservisiniz.com/swagger | http://31.57.33.85:5280/swagger |
| Admin giriş | https://panel.mobilservisiniz.com | http://31.57.33.85:5281 |
| Platform giriş | https://yonetim.mobilservisiniz.com | http://31.57.33.85:5282 |

**Admin demo:** `OTO-IST` + `05551112233` + `1234`
**Platform demo:** `05000000001` + `1234` (önce `15_platform_admin.sql`)

---

## 6. Mobil uygulama

`mobile/src/lib/api-config.ts` → `https://api.mobilservisiniz.com`

Eski IP:port binding'i IIS üzerinden çalışmaya devam ettiği sürece, kurulu eski sürümler
kesintiye uğramaz. Yeni sürüm, Platform'un "Uygulama Sürümü" sayfasından yayınlanarak mevcut
kullanıcılara kendi güncelleme mekanizmasıyla ulaştırılır.

---

## 7. Otomatik deploy (WinRM açıksa)

```powershell
cd api
.\deploy.ps1
```

`deploy.ps1`, `publish\iis-setup\Restart-OtoServis.ps1`'i sunucuya kopyalar ve IIS App Pool'ları
varsa onları kullanarak durdurma/başlatma yapar; yoksa eski `dotnet X.dll` yöntemine düşer.

---

## 8. Geçiş sonrası temizlik (opsiyonel, haftalar sonra)

Eski IP:port trafiği (IIS/Cloudflare loglarında) belirgin şekilde azaldığında 5280/5281/5282
binding'leri ve firewall kuralları kaldırılabilir — bkz. `publish\iis-setup\README.md` sonu.
