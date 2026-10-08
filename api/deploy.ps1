# OtoServis — Publish ve sunucuya deploy
# Sunucu: 31.57.33.85
# Domain (IIS uzerinden): api./panel./yonetim.mobilservisiniz.com
# Eski portlar (gecis suresince, IIS ayni binding'leri de sunuyor): API 5280 | Admin 5281 | Platform 5282

param(
    [switch]$DeployOnly,
    [switch]$SkipDeploy,
    [string]$RemoteBaseDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishRoot = Join-Path (Split-Path -Parent $Root) "publish"
$Server = "31.57.33.85"
$ServerUser = "administrator"
# Gercek sunucu parolasi kaynak kodda tutulmaz: calistirmadan once
#   $env:OTOSERVIS_SERVER_PASS = "..."
# olarak ayarlayin (veya PowerShell profilinizde tanimlayin).
$ServerPass = $env:OTOSERVIS_SERVER_PASS
if (-not $RemoteBaseDir) { $RemoteBaseDir = if ($env:OTOSERVIS_BASE_DIR) { $env:OTOSERVIS_BASE_DIR } else { "C:\OtoServis" } }
$RemoteApiPath = Join-Path $RemoteBaseDir "api"
$RemoteAdminPath = Join-Path $RemoteBaseDir "admin"
$RemotePlatformPath = Join-Path $RemoteBaseDir "platform"
if ($RemoteBaseDir -notmatch '^([A-Za-z]):\\(.*)$') { throw "RemoteBaseDir disk harfi ile baslamali: $RemoteBaseDir" }
$RemoteUnc = "\\$Server\$($Matches[1])`$\$($Matches[2])"

function Publish-Project {
    param([string]$ProjectPath, [string]$Profile)
    Write-Host ">> Publish: $ProjectPath" -ForegroundColor Cyan
    dotnet publish $ProjectPath -p:PublishProfile=$Profile -c Release
    if ($LASTEXITCODE -ne 0) { throw "Publish failed: $ProjectPath" }
}

if (-not $DeployOnly) {
    Publish-Project "$Root\OtoServis.Api\OtoServis.Api.csproj" "Production"
    Publish-Project "$Root\OtoServis.Admin\OtoServis.Admin.csproj" "Production"
    Publish-Project "$Root\OtoServis.Platform\OtoServis.Platform.csproj" "Production"

    Copy-Item "$Root\publish-templates\start-api.bat" "$PublishRoot\api\" -Force
    Copy-Item "$Root\publish-templates\start-admin.bat" "$PublishRoot\admin\" -Force
    Copy-Item "$Root\publish-templates\start-platform.bat" "$PublishRoot\platform\" -Force

    foreach ($pair in @(
        @{ Src = "$PublishRoot\api"; Zip = "$PublishRoot\OtoServis-Api.zip" },
        @{ Src = "$PublishRoot\admin"; Zip = "$PublishRoot\OtoServis-Admin.zip" },
        @{ Src = "$PublishRoot\platform"; Zip = "$PublishRoot\OtoServis-Platform.zip" }
    )) {
        if (Test-Path $pair.Zip) { Remove-Item $pair.Zip -Force }
        Compress-Archive -Path "$($pair.Src)\*" -DestinationPath $pair.Zip -Force
    }

    Write-Host "`nPublish tamamlandi:" -ForegroundColor Green
    Write-Host "  API:      $PublishRoot\api"
    Write-Host "  Admin:    $PublishRoot\admin"
    Write-Host "  Platform: $PublishRoot\platform"
    Write-Host "  Zips: OtoServis-Api.zip, OtoServis-Admin.zip, OtoServis-Platform.zip"
}

if ($SkipDeploy) { exit 0 }

# --- Sunucuya kopyala (WinRM veya admin paylasimi) ---
$ApiSource = "$PublishRoot\api"
$AdminSource = "$PublishRoot\admin"
$PlatformSource = "$PublishRoot\platform"

if (-not (Test-Path $ApiSource)) { throw "API publish klasoru yok. Once publish calistirin." }
if (-not $ServerPass) { throw "OTOSERVIS_SERVER_PASS ortam degiskeni tanimli degil. Once: `$env:OTOSERVIS_SERVER_PASS = '...'" }

Write-Host "`n>> Sunucuya deploy: $Server" -ForegroundColor Cyan

$secPass = ConvertTo-SecureString $ServerPass -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($ServerUser, $secPass)

# iis-setup script'lerini (Restart-OtoServis.ps1 dahil) once kopyala — deployScript bunu kullanacak.
$IisSetupSource = "$PublishRoot\iis-setup"
if (Test-Path $IisSetupSource) {
    try {
        New-Item -ItemType Directory -Force -Path "$RemoteUnc\iis-setup" -ErrorAction SilentlyContinue | Out-Null
        Copy-Item "$IisSetupSource\*" -Destination "$RemoteUnc\iis-setup\" -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "UYARI: iis-setup klasoru kopyalanamadi (SMB erisimi yok olabilir): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$deployScript = @"
`$apiPath = '$RemoteApiPath'
`$adminPath = '$RemoteAdminPath'
`$platformPath = '$RemotePlatformPath'
New-Item -ItemType Directory -Force -Path `$apiPath, `$adminPath, `$platformPath | Out-Null

`$restartScript = Join-Path '$RemoteBaseDir' 'iis-setup\Restart-OtoServis.ps1'
if (Test-Path `$restartScript) {
    & `$restartScript -StopOnly -BaseDir '$RemoteBaseDir'
} else {
    Get-Process -Name 'dotnet','OtoServis.Api','OtoServis.Admin','OtoServis.Platform' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

if (-not (Get-NetFirewallRule -DisplayName 'OtoServis API 5280' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'OtoServis API 5280' -Direction Inbound -Protocol TCP -LocalPort 5280 -Action Allow | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName 'OtoServis Admin 5281' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'OtoServis Admin 5281' -Direction Inbound -Protocol TCP -LocalPort 5281 -Action Allow | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName 'OtoServis Platform 5282' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'OtoServis Platform 5282' -Direction Inbound -Protocol TCP -LocalPort 5282 -Action Allow | Out-Null
}

Write-Host 'Deploy klasorleri hazir.'
"@

try {
    Invoke-Command -ComputerName $Server -Credential $cred -ScriptBlock ([scriptblock]::Create($deployScript)) -ErrorAction Stop
    Write-Host "WinRM baglantisi OK" -ForegroundColor Green

    $apiZip = "$env:TEMP\otoservis-api.zip"
    $adminZip = "$env:TEMP\otoservis-admin.zip"
    $platformZip = "$env:TEMP\otoservis-platform.zip"
    foreach ($z in @($apiZip, $adminZip, $platformZip)) { if (Test-Path $z) { Remove-Item $z -Force } }
    Compress-Archive -Path "$ApiSource\*" -DestinationPath $apiZip -Force
    Compress-Archive -Path "$AdminSource\*" -DestinationPath $adminZip -Force
    Compress-Archive -Path "$PlatformSource\*" -DestinationPath $platformZip -Force

    Copy-Item $apiZip -Destination "$RemoteUnc\otoservis-api.zip" -Force
    Copy-Item $adminZip -Destination "$RemoteUnc\otoservis-admin.zip" -Force
    Copy-Item $platformZip -Destination "$RemoteUnc\otoservis-platform.zip" -Force

    $startScript = @"
Expand-Archive -Path (Join-Path '$RemoteBaseDir' 'otoservis-api.zip') -DestinationPath '$RemoteApiPath' -Force
Expand-Archive -Path (Join-Path '$RemoteBaseDir' 'otoservis-admin.zip') -DestinationPath '$RemoteAdminPath' -Force
Expand-Archive -Path (Join-Path '$RemoteBaseDir' 'otoservis-platform.zip') -DestinationPath '$RemotePlatformPath' -Force

`$restartScript = Join-Path '$RemoteBaseDir' 'iis-setup\Restart-OtoServis.ps1'
if (Test-Path `$restartScript) {
    & `$restartScript -StartOnly -BaseDir '$RemoteBaseDir'
} else {
    `$env:ASPNETCORE_ENVIRONMENT = 'Production'
    Start-Process -FilePath 'dotnet' -ArgumentList '$RemoteApiPath\OtoServis.Api.dll' -WorkingDirectory '$RemoteApiPath' -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Start-Process -FilePath 'dotnet' -ArgumentList '$RemoteAdminPath\OtoServis.Admin.dll' -WorkingDirectory '$RemoteAdminPath' -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Start-Process -FilePath 'dotnet' -ArgumentList '$RemotePlatformPath\OtoServis.Platform.dll' -WorkingDirectory '$RemotePlatformPath' -WindowStyle Hidden
}

Write-Host 'API, Admin ve Platform baslatildi.'
"@

    Invoke-Command -ComputerName $Server -Credential $cred -ScriptBlock ([scriptblock]::Create($startScript))
    Write-Host "`nDeploy basarili!" -ForegroundColor Green
    Write-Host "  API:      https://api.mobilservisiniz.com/swagger  (eski: http://${Server}:5280/swagger)"
    Write-Host "  Admin:    https://panel.mobilservisiniz.com  (eski: http://${Server}:5281)"
    Write-Host "  Platform: https://yonetim.mobilservisiniz.com  (eski: http://${Server}:5282)"
}
catch {
    Write-Host "`nOtomatik deploy basarisiz: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host @"

Manuel deploy adimlari:
1. publish\api, publish\admin, publish\platform klasorlerini sunucuya kopyalayin:
   $RemoteApiPath
   $RemoteAdminPath
   $RemotePlatformPath

2. Sunucuda .NET 8 Runtime yuklu olmali

3. Firewall'da 5280, 5281, 5282 portlarini acin

4. Baslatma:
   start-api.bat / start-admin.bat / start-platform.bat

5. Test:
   https://api.mobilservisiniz.com/swagger  (veya eski: http://${Server}:5280/swagger)
   https://panel.mobilservisiniz.com        (veya eski: http://${Server}:5281)
   https://yonetim.mobilservisiniz.com      (veya eski: http://${Server}:5282)
"@ -ForegroundColor Gray
}
