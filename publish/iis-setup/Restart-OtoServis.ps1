# Restart-OtoServis.ps1
# API + Admin + Platform servislerini durdurur/baslatir.
# IIS App Pool'lari (OtoServisApiPool/OtoServisAdminPool/OtoServisPlatformPool) varsa onlari
# kullanir; henuz IIS gecisi yapilmadiysa eski dotnet konsol surecine geri duser.
#
# Kullanim:
#   .\Restart-OtoServis.ps1              (durdur + baslat)
#   .\Restart-OtoServis.ps1 -StopOnly
#   .\Restart-OtoServis.ps1 -StartOnly

param(
    [switch]$StopOnly,
    [switch]$StartOnly,
    [string]$BaseDir = ""
)

if (-not $BaseDir) { $BaseDir = if ($env:OTOSERVIS_BASE_DIR) { $env:OTOSERVIS_BASE_DIR } else { "C:\OtoServis" } }

$pools = @("OtoServisApiPool", "OtoServisAdminPool", "OtoServisPlatformPool")
$legacy = @(
    @{ Name = "OtoServis.Api";      Port = 5280; Path = (Join-Path $BaseDir "api\OtoServis.Api.dll") },
    @{ Name = "OtoServis.Admin";    Port = 5281; Path = (Join-Path $BaseDir "admin\OtoServis.Admin.dll") },
    @{ Name = "OtoServis.Platform"; Port = 5282; Path = (Join-Path $BaseDir "platform\OtoServis.Platform.dll") }
)

Import-Module WebAdministration -ErrorAction SilentlyContinue
$iisAvailable = [bool](Get-Module WebAdministration -ErrorAction SilentlyContinue)
if ($iisAvailable) {
    $iisAvailable = Test-Path "IIS:\AppPools\$($pools[0])"
}

function Wait-AppPoolFullyStopped {
    param([string]$PoolName, [int]$TimeoutSec = 20)

    # 1) App Pool durumu "Stopped" olana kadar bekle (Stop-WebAppPool asenkrondur).
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        $state = (Get-WebAppPoolState -Name $PoolName -ErrorAction SilentlyContinue).Value
        if ($state -eq 'Stopped') { break }
        Start-Sleep -Milliseconds 500
    }

    # 2) Asil kilit sorunu w3wp.exe surecinin tam kapanmamasidir - o surecin de
    #    gercekten bitmesini bekle (dosya kilitleri ancak o zaman serbest kalir).
    $sw.Restart()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        $procs = Get-CimInstance Win32_Process -Filter "Name='w3wp.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match [regex]::Escape($PoolName) }
        if (-not $procs) { return }
        Start-Sleep -Milliseconds 500
    }

    # 3) Hala kapanmadiysa (nadir), sureci zorla sonlandir ki dosya kilitleri kesin acilsin.
    Write-Host "  UYARI: $PoolName icin w3wp.exe zamaninda kapanmadi, zorla sonlandiriliyor..." -ForegroundColor Yellow
    Get-CimInstance Win32_Process -Filter "Name='w3wp.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match [regex]::Escape($PoolName) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

function Stop-Services {
    if ($iisAvailable) {
        Write-Host "IIS App Pool'lari durduruluyor..." -ForegroundColor Cyan
        foreach ($p in $pools) {
            if (Test-Path "IIS:\AppPools\$p") {
                Stop-WebAppPool -Name $p -ErrorAction SilentlyContinue
                Wait-AppPoolFullyStopped -PoolName $p
                Write-Host "  $p durduruldu (surec de kapandi)"
            }
        }
    } else {
        Write-Host "IIS App Pool bulunamadi, eski dotnet surecleri durduruluyor..." -ForegroundColor Yellow
        foreach ($svc in $legacy) {
            try {
                Get-NetTCPConnection -LocalPort $svc.Port -ErrorAction SilentlyContinue |
                    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
            } catch {}
        }
        Start-Sleep -Seconds 2
    }
}

function Start-Services {
    if ($iisAvailable) {
        Write-Host "IIS App Pool'lari baslatiliyor..." -ForegroundColor Cyan
        foreach ($p in $pools) {
            if (Test-Path "IIS:\AppPools\$p") {
                Start-WebAppPool -Name $p -ErrorAction SilentlyContinue
                Write-Host "  $p baslatildi"
            }
        }
    } else {
        Write-Host "IIS App Pool bulunamadi, eski dotnet surecleri ile baslatiliyor..." -ForegroundColor Yellow
        Write-Host "  (Bu durum IIS gecisi henuz yapilmadigini gosterir - bkz. publish\iis-setup\)" -ForegroundColor DarkYellow
        $env:ASPNETCORE_ENVIRONMENT = "Production"
        foreach ($svc in $legacy) {
            if (Test-Path $svc.Path) {
                $env:ASPNETCORE_URLS = "http://0.0.0.0:$($svc.Port)"
                Start-Process -FilePath "dotnet" -ArgumentList "`"$($svc.Path)`"" -WorkingDirectory (Split-Path $svc.Path) -WindowStyle Hidden
                Write-Host "  $($svc.Name) baslatildi (port $($svc.Port))"
                Start-Sleep -Seconds 2
            }
        }
    }
}

if ($StopOnly) { Stop-Services }
elseif ($StartOnly) { Start-Services }
else { Stop-Services; Start-Services }

Write-Host ""
Write-Host "Tamamlandi. Mod: $(if ($iisAvailable) { 'IIS' } else { 'Legacy dotnet' })" -ForegroundColor Green
