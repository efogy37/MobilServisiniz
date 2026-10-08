# IIS + Domain Yayın Geçişi — Uygulama Sırası

Bu klasördeki script'ler, MobilServisiniz'in 3 servisini (API/Admin/Platform) IP:port'tan
domain + IIS'e taşımak için sırayla çalıştırılır. Detaylı plan: proje köküne bakın
(Cursor plan geçmişi: "IIS + Domain Yayın Geçişi").

## Sıra

1. **[00-CLOUDFLARE-REHBERI.md](00-CLOUDFLARE-REHBERI.md)** — Cloudflare Dashboard'da DNS A
   kayıtları + SSL modu + Origin CA sertifikası oluşturma. Bu adım dashboard üzerinden yapılır,
   script yok. Sonunda elinizde `cf-origin.pfx` + parola olacak.

2. **RDP ile sunucuya bağlanın**, `cf-origin.pfx` dosyasını kurulum köküne (varsayılan
   `C:\OtoServis`, yeni sunucuda `-BaseDir` / `OTOSERVIS_BASE_DIR`) kopyalayın; bu klasörün
   tamamını (`publish\iis-setup\*`) `{kök}\iis-setup\` altına koyun.

3. **01-Install-HostingBundle.ps1** — Yönetici PowerShell'de çalıştırın. IIS rolünü, .NET 8
   ASP.NET Core Hosting Bundle'ı ve URL Rewrite modülünü kurar.

   ```powershell
   cd C:\OtoServis\iis-setup
   .\01-Install-HostingBundle.ps1
   ```

4. **02-Create-Sites.ps1** — App Pool + Site + binding'leri oluşturur, sertifikayı içe aktarır.

   ```powershell
   .\02-Create-Sites.ps1 -DomainRoot "mobilservisiniz.com" -PfxPath "C:\OtoServis\cf-origin.pfx" -PfxPassword "<pfx-parolaniz>"
   ```

   Bu adımda eski `dotnet X.dll` süreçleri hâlâ 5280/5281/5282'yi kullandığından, script
   site'ları oluşturur ama başlatma başarısız olabilir — bu normaldir, bir sonraki adımda çözülür.

5. **03-Set-Permissions.ps1** — `uploads`/`releases` klasörlerine App Pool kimlikleri için
   yazma izni verir (atlanırsa foto/APK yükleme "Access denied" ile sessizce başarısız olur).

   ```powershell
   .\03-Set-Permissions.ps1
   ```

6. **04-Cutover.ps1** — Geçiş anı: eski `dotnet X.dll` süreçlerini durdurur, IIS App Pool/Site'ları
   başlatır, hem eski hem yeni adresleri test eder.

   ```powershell
   .\04-Cutover.ps1
   ```

7. Tarayıcıdan doğrulayın:
   - `https://api.mobilservisiniz.com/swagger`
   - `https://panel.mobilservisiniz.com`
   - `https://yonetim.mobilservisiniz.com`
   - `http://31.57.33.85:5280/swagger` (eski, hâlâ çalışmalı)

8. Mobil uygulamayı yeni sürümle (yeni API adresine işaret eden) güncelleyin — bkz. proje
   kökünde `mobile/src/lib/api-config.ts` (zaten güncellendi) ve Platform > Uygulama Sürümü
   sayfasından yeni APK'yı yükleyin.

## Sonraki deploy'lar (bundan sonra)

Artık `publish\SUNUCU-GUNCELLE.bat` ve `api\deploy.ps1`, IIS App Pool'ları algılayıp otomatik
olarak `Stop-WebAppPool` / dosyaları aç / `Start-WebAppPool` akışını kullanacak (bkz.
`Restart-OtoServis.ps1`). Elle `start-*.bat` çalıştırmaya gerek kalmaz.

## HTTP → HTTPS yönlendirmesi (opsiyonel)

Cloudflare "Full (strict)" modunda ziyaretçi zaten HTTPS üzerinden geliyor, bu yüzden bu adım
zorunlu değil. İsterseniz IIS Manager'da her site için **URL Rewrite > Add Rule > Blank rule**
ile şu kuralı ekleyebilirsiniz (sadece port 80'i yönlendirir, 5280/5281/5282'deki eski istemcileri
etkilemez):

- Pattern: `(.*)`
- Condition: `{HTTPS}` Equal to `off` VE `{SERVER_PORT}` Equal to `80`
- Action: Redirect to `https://{HTTP_HOST}/{R:1}`, Redirect type: Permanent (301)

## Geri alma

Herhangi bir adımda sorun olursa: IIS'te ilgili Site/App Pool'u durdurun
(`Stop-WebAppPool -Name OtoServisApiPool` vb.) ve eski `publish-templates\start-*.bat` dosyasını
elle çalıştırın. Uygulama dosyaları hiç değişmedi, sadece hangi process'in onları sunduğu değişti.

## Temizlik (geçiş tamamlandıktan haftalar sonra, opsiyonel)

IIS/Cloudflare loglarında eski IP:5280 trafiği belirgin şekilde azaldığında:

```powershell
Get-WebBinding -Name "OtoServis-Api" | Where-Object { $_.bindingInformation -like "*:5280:*" } | Remove-WebBinding
Remove-NetFirewallRule -DisplayName "OtoServis API 5280"
# Ayni sekilde Admin (5281) ve Platform (5282) icin de yapilabilir.
```
