# 03-Set-Permissions.ps1
# IIS App Pool kimlikleri (ApplicationPoolIdentity) varsayilan olarak dusuk yetkilidir.
# Eskiden dotnet.exe yonetici RDP oturumunda calistigi icin sorun olmuyordu; IIS'e gecince
# calisma zamaninda dosya yazilan klasorlere ACIKCA izin vermek gerekir. Atlanirsa foto/APK
# yuklemeleri sessizce basarisiz olur (500 hatasi / "Access denied").
#
# Onemli: APK yukleme Platform uygulamasindan Api'nin wwwroot\releases klasorune yaziyor,
# bu yuzden o klasore HEM Api HEM Platform App Pool kimligi icin izin veriliyor.
#
# Kullanim:
#   .\03-Set-Permissions.ps1
#   .\03-Set-Permissions.ps1 -BaseDir "D:\YeniKok"

param(
    [string]$BaseDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $BaseDir) { $BaseDir = if ($env:OTOSERVIS_BASE_DIR) { $env:OTOSERVIS_BASE_DIR } else { "C:\inetpub\wwwroot\mobilservisiniz" } }
$apiWwwroot = Join-Path $BaseDir "api\wwwroot"

$grants = @(
    @{ Path = (Join-Path $apiWwwroot "uploads");  Pool = "OtoServisApiPool" },
    @{ Path = (Join-Path $apiWwwroot "releases");  Pool = "OtoServisApiPool" },
    @{ Path = (Join-Path $apiWwwroot "releases");  Pool = "OtoServisPlatformPool" }
)

foreach ($g in $grants) {
    if (-not (Test-Path $g.Path)) {
        New-Item -ItemType Directory -Force -Path $g.Path | Out-Null
        Write-Host "Klasor olusturuldu: $($g.Path)"
    }
    $identity = "IIS AppPool\$($g.Pool)"
    Write-Host "Izin veriliyor: $($g.Path) -> $identity (Modify)" -ForegroundColor Cyan
    icacls $g.Path /grant "${identity}:(OI)(CI)M" | Out-Null
}

Write-Host "`nTamamlandi. Kontrol icin:" -ForegroundColor Green
$uniquePaths = $grants | ForEach-Object { $_.Path } | Select-Object -Unique
foreach ($g in $uniquePaths) {
    Write-Host "  icacls `"$g`""
}
