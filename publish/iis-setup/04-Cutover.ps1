# 04-Cutover.ps1
# Gecis anini gerceklestirir: eski standalone "dotnet X.dll" konsol sureclerini durdurur,
# ardindan IIS App Pool'larini/Site'larini baslatir. Boylece hem eski IP:port (5280/5281/5282)
# hem yeni https://api.<domain> adresleri IIS uzerinden ayni anda calisir hale gelir.
#
# On kosul: 02-Create-Sites.ps1 calistirilmis olmali (App Pool + Site + binding'ler hazir).
#
# Kullanim:
#   .\04-Cutover.ps1

$ErrorActionPreference = "Stop"
Import-Module WebAdministration

$legacyPorts = @(5280, 5281, 5282)
$pools = @("OtoServisApiPool", "OtoServisAdminPool", "OtoServisPlatformPool", "OtoServisWebPool", "OtoServisSitePool")
$sites = @("OtoServis-Api", "OtoServis-Admin", "OtoServis-Platform", "OtoServis-Web", "OtoServis-Site")

Write-Host "=== 1/3: Eski dotnet surecleri durduruluyor ===" -ForegroundColor Cyan
foreach ($port in $legacyPorts) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "  Port $port -> PID $($proc.Id) ($($proc.ProcessName)) durduruluyor"
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 3

Write-Host "`n=== 2/3: IIS App Pool'lari baslatiliyor ===" -ForegroundColor Cyan
foreach ($p in $pools) {
    if (Test-Path "IIS:\AppPools\$p") {
        Start-WebAppPool -Name $p -ErrorAction SilentlyContinue
        Write-Host "  $p baslatildi"
    } else {
        Write-Host "  UYARI: $p bulunamadi (once 02-Create-Sites.ps1 calistirin)" -ForegroundColor Yellow
    }
}
foreach ($s in $sites) {
    if (Test-Path "IIS:\Sites\$s") {
        Start-Website -Name $s -ErrorAction SilentlyContinue
        Write-Host "  $s baslatildi"
    }
}

Write-Host "`n=== 3/3: Dogrulama ===" -ForegroundColor Cyan
Start-Sleep -Seconds 2
$checks = @(
    @{ Url = "http://localhost:5280/swagger/index.html"; Label = "Eski IP - API (5280)" },
    @{ Url = "http://localhost:5281"; Label = "Eski IP - Admin (5281)" },
    @{ Url = "http://localhost:5282"; Label = "Eski IP - Platform (5282)" }
)
foreach ($chk in $checks) {
    try {
        $resp = Invoke-WebRequest -Uri $chk.Url -UseBasicParsing -TimeoutSec 10
        Write-Host "  OK  [$($resp.StatusCode)] $($chk.Label)" -ForegroundColor Green
    } catch {
        Write-Host "  HATA $($chk.Label): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`nTamamlandi. Simdi tarayicidan da test edin:" -ForegroundColor Green
Write-Host "  http://31.57.33.85:5280/swagger  (eski, hala calismali)"
Write-Host "  https://api.<domaininiz>/swagger    (yeni)"
Write-Host "  https://panel.<domaininiz>"
Write-Host "  https://yonetim.<domaininiz>"
