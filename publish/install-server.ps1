# Sunucuda calistirin (RDP ile 31.57.33.85)
# Once OtoServis-Api.zip ve OtoServis-Admin.zip dosyalarini C:\OtoServis\ altina kopyalayin

$ErrorActionPreference = "Stop"

$apiPath = "C:\OtoServis\api"
$adminPath = "C:\OtoServis\admin"
$zipApi = "C:\OtoServis\OtoServis-Api.zip"
$zipAdmin = "C:\OtoServis\OtoServis-Admin.zip"

Write-Host "OtoServis sunucu kurulumu..." -ForegroundColor Cyan

# .NET 8 kontrol
try {
    $dotnetVer = dotnet --list-runtimes | Select-String "Microsoft.AspNetCore.App 8"
    if (-not $dotnetVer) {
        Write-Host "UYARI: .NET 8 ASP.NET Core Runtime bulunamadi!" -ForegroundColor Red
        Write-Host "Indirin: https://dotnet.microsoft.com/download/dotnet/8.0" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ".NET 8 OK: $dotnetVer"
} catch {
    Write-Host "dotnet komutu bulunamadi. .NET 8 Runtime kurun." -ForegroundColor Red
    exit 1
}

# Klasorler
New-Item -ItemType Directory -Force -Path $apiPath, $adminPath | Out-Null

# Zip ac
if (Test-Path $zipApi) {
    Expand-Archive -Path $zipApi -DestinationPath $apiPath -Force
    Write-Host "API acildi: $apiPath"
} else {
    Write-Host "HATA: $zipApi bulunamadi" -ForegroundColor Red
    exit 1
}

if (Test-Path $zipAdmin) {
    Expand-Archive -Path $zipAdmin -DestinationPath $adminPath -Force
    Write-Host "Admin acildi: $adminPath"
} else {
    Write-Host "HATA: $zipAdmin bulunamadi" -ForegroundColor Red
    exit 1
}

# Firewall
foreach ($rule in @(
    @{ Name = "OtoServis API 5280"; Port = 5280 },
    @{ Name = "OtoServis Admin 5281"; Port = 5281 }
)) {
    if (-not (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Protocol TCP -LocalPort $rule.Port -Action Allow | Out-Null
        Write-Host "Firewall: $($rule.Name) eklendi"
    }
}

# Eski surecleri durdur
Get-Process dotnet -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*OtoServis*" -or $_.CommandLine -like "*OtoServis*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Baslat
$env:ASPNETCORE_ENVIRONMENT = "Production"

Start-Process -FilePath "dotnet" -ArgumentList "$apiPath\OtoServis.Api.dll" -WorkingDirectory $apiPath -WindowStyle Hidden
Start-Sleep -Seconds 3
Start-Process -FilePath "dotnet" -ArgumentList "$adminPath\OtoServis.Admin.dll" -WorkingDirectory $adminPath -WindowStyle Hidden

Write-Host ""
Write-Host "Kurulum tamamlandi!" -ForegroundColor Green
Write-Host "  API:   http://31.57.33.85:5280/swagger"
Write-Host "  Admin: http://31.57.33.85:5281"
Write-Host ""
Write-Host "Test:"
Write-Host '  Invoke-RestMethod "http://localhost:5280/api/auth/lookup-tenant?code=OTO-IST"'
