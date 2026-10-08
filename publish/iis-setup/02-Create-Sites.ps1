# 02-Create-Sites.ps1
# Api / Admin / Platform icin ayri App Pool + Site olusturur, hostname binding'lerini
# (api./panel./yonetim.) ve eski port binding'lerini (5280/5281/5282, gecis suresince) ekler.
#
# On kosul:
#   - 01-Install-HostingBundle.ps1 calistirilmis olmali (IIS + Hosting Bundle + URL Rewrite)
#   - C:\OtoServis\api, C:\OtoServis\admin, C:\OtoServis\platform klasorleri zaten mevcut olmali
#   - Cloudflare Origin CA sertifikasi bir .pfx dosyasi olarak sunucuda bir yerde olmali
#
# Kullanim (PfxPath verirseniz sertifikayi da otomatik ice aktarir):
#   .\02-Create-Sites.ps1 -DomainRoot "mobilservisiniz.com" -PfxPath "C:\OtoServis\cf-origin.pfx" -PfxPassword "sifre"
#
# Sertifika zaten certlm.msc'ye ice aktarilmissa, thumbprint ile de calistirabilirsiniz:
#   .\02-Create-Sites.ps1 -DomainRoot "mobilservisiniz.com" -CertThumbprint "ABCDEF...."

param(
    [Parameter(Mandatory = $true)][string]$DomainRoot,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$CertThumbprint,
    [string]$BaseDir = "",
    [switch]$SkipLegacyPorts
)

if (-not $BaseDir) { $BaseDir = if ($env:OTOSERVIS_BASE_DIR) { $env:OTOSERVIS_BASE_DIR } else { "C:\OtoServis" } }

$ErrorActionPreference = "Stop"
Import-Module WebAdministration

# --- 0) Sertifika ice aktarma (istege bagli) ---
if ($PfxPath) {
    if (-not (Test-Path $PfxPath)) { throw "Pfx dosyasi bulunamadi: $PfxPath" }
    Write-Host "Sertifika ice aktariliyor: $PfxPath" -ForegroundColor Cyan
    $securePwd = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
    $cert = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation "Cert:\LocalMachine\My" -Password $securePwd
    $CertThumbprint = $cert.Thumbprint
    Write-Host "Sertifika ice aktarildi. Thumbprint: $CertThumbprint" -ForegroundColor Green
}

if (-not $CertThumbprint) {
    throw "CertThumbprint verilmedi ve PfxPath ile ice aktarma yapilmadi. Once sertifikayi certlm.msc'ye ice aktarip thumbprint'i -CertThumbprint ile verin."
}

# --- 1) Servis tanimlari ---
$services = @(
    @{ Key = "Api";      Sub = "api";     Pool = "OtoServisApiPool";      Path = (Join-Path $BaseDir "api");      LegacyPort = 5280; MaxContentLength = 130000000 },
    @{ Key = "Admin";    Sub = "panel";   Pool = "OtoServisAdminPool";    Path = (Join-Path $BaseDir "admin");    LegacyPort = 5281; MaxContentLength = 30000000 },
    @{ Key = "Platform"; Sub = "yonetim"; Pool = "OtoServisPlatformPool"; Path = (Join-Path $BaseDir "platform"); LegacyPort = 5282; MaxContentLength = 130000000 }
)

foreach ($svc in $services) {
    $hostname = "$($svc.Sub).$DomainRoot"
    $siteName = "OtoServis-$($svc.Key)"
    Write-Host "`n=== $siteName ($hostname) ===" -ForegroundColor Cyan

    if (-not (Test-Path $svc.Path)) {
        Write-Host "UYARI: $($svc.Path) bulunamadi, atlaniyor." -ForegroundColor Yellow
        continue
    }

    # --- App Pool ---
    if (-not (Test-Path "IIS:\AppPools\$($svc.Pool)")) {
        New-WebAppPool -Name $svc.Pool | Out-Null
        Write-Host "App Pool olusturuldu: $($svc.Pool)"
    } else {
        Write-Host "App Pool zaten var: $($svc.Pool)"
    }
    Set-ItemProperty "IIS:\AppPools\$($svc.Pool)" -Name "managedRuntimeVersion" -Value ""
    Set-ItemProperty "IIS:\AppPools\$($svc.Pool)" -Name "startMode" -Value "AlwaysRunning"
    Set-ItemProperty "IIS:\AppPools\$($svc.Pool)" -Name "processModel.idleTimeout" -Value ([TimeSpan]::Zero)

    # --- Site ---
    if (-not (Test-Path "IIS:\Sites\$siteName")) {
        New-Website -Name $siteName -PhysicalPath $svc.Path -ApplicationPool $svc.Pool -Port 80 -HostHeader $hostname | Out-Null
        Write-Host "Site olusturuldu: $siteName -> $($svc.Path)"
    } else {
        Write-Host "Site zaten var: $siteName"
        Set-ItemProperty "IIS:\Sites\$siteName" -Name "physicalPath" -Value $svc.Path
        Set-ItemProperty "IIS:\Sites\$siteName" -Name "applicationPool" -Value $svc.Pool
    }

    # --- IIS istek boyutu siniri (varsayilan ~30MB cok dusuk, buyuk dosya
    #     yuklemelerinde "request entity too large" hatasi verir) ---
    Set-WebConfigurationProperty -Filter "system.webServer/security/requestFiltering/requestLimits" `
        -PSPath "IIS:\Sites\$siteName" -Name "maxAllowedContentLength" -Value $svc.MaxContentLength
    Write-Host "Istek boyutu siniri: $($svc.MaxContentLength) byte"

    # --- HTTPS binding (443, SNI, Cloudflare Origin sertifikasi) ---
    $httpsExists = Get-WebBinding -Name $siteName -Protocol "https" -ErrorAction SilentlyContinue |
        Where-Object { $_.bindingInformation -like "*:443:$hostname" }
    if (-not $httpsExists) {
        New-WebBinding -Name $siteName -Protocol "https" -Port 443 -HostHeader $hostname -SslFlags 1
        Write-Host "HTTPS binding eklendi: $hostname:443"
    }
    $binding = Get-WebBinding -Name $siteName -Protocol "https" | Where-Object { $_.bindingInformation -like "*:443:$hostname" }
    if ($binding) {
        $binding.AddSslCertificate($CertThumbprint, "My")
        Write-Host "SSL sertifikasi baglandi (thumbprint $CertThumbprint)"
    }

    # --- Eski port binding'i (gecis suresince geriye uyumluluk) ---
    if (-not $SkipLegacyPorts) {
        $legacyExists = Get-WebBinding -Name $siteName -Protocol "http" -ErrorAction SilentlyContinue |
            Where-Object { $_.bindingInformation -like "*:$($svc.LegacyPort):" }
        if (-not $legacyExists) {
            New-WebBinding -Name $siteName -Protocol "http" -Port $svc.LegacyPort -HostHeader ""
            Write-Host "Eski port binding'i eklendi: *:$($svc.LegacyPort) (hostname yok, geriye uyumluluk)"
        }
    }

    try {
        Start-WebAppPool -Name $svc.Pool -ErrorAction Stop
        Start-Website -Name $siteName -ErrorAction Stop
        Write-Host "$siteName baslatildi." -ForegroundColor Green
    } catch {
        Write-Host "UYARI: $siteName baslatilamadi (port $($svc.LegacyPort) hala eski dotnet sureci tarafindan kullaniliyor olabilir)." -ForegroundColor Yellow
        Write-Host "  Once 04-Cutover.ps1'i calistirin, sonra bu scripti tekrar calistirin." -ForegroundColor Yellow
    }
}

Write-Host "`n=== Firewall ===" -ForegroundColor Cyan
foreach ($rule in @(
    @{ Name = "IIS HTTP 80"; Port = 80 },
    @{ Name = "IIS HTTPS 443"; Port = 443 }
)) {
    if (-not (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Protocol TCP -LocalPort $rule.Port -Action Allow | Out-Null
        Write-Host "Firewall kurali eklendi: $($rule.Name)"
    }
}

Write-Host "`nTamamlandi. Simdi test edin:" -ForegroundColor Green
foreach ($svc in $services) {
    Write-Host "  https://$($svc.Sub).$DomainRoot"
}
Write-Host "`nNot: Bu asamada eski standalone 'dotnet X.dll' surecleri hala calisiyorsa ayni portu" -ForegroundColor Yellow
Write-Host "(5280/5281/5282) kullanmaya calisip cakisabilirler. Devam etmeden once 04-Cutover.ps1'i calistirin." -ForegroundColor Yellow
