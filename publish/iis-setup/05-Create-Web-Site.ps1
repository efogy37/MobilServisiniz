# Mobil uygulama web sitesi: https://app.mobilservisiniz.com
# Dosyalar once {BaseDir}\app altina kopyalanmis olmali.
# Yonetici PowerShell:
#   .\05-Create-Web-Site.ps1
#   .\05-Create-Web-Site.ps1 -BaseDir "D:\YeniKok"

param(
    [string]$BaseDir = ""
)

$ErrorActionPreference = "Stop"
Import-Module WebAdministration

if (-not $BaseDir) { $BaseDir = if ($env:OTOSERVIS_BASE_DIR) { $env:OTOSERVIS_BASE_DIR } else { "C:\inetpub\wwwroot\mobilservisiniz" } }

$hostname = "app.mobilservisiniz.com"
$siteName = "OtoServis-Web"
$poolName = "OtoServisWebPool"
$path = Join-Path $BaseDir "app"

if (-not (Test-Path $path)) { throw "Klasor yok: $path  Once publish\web icerigini app klasorune kopyalayin." }
if (-not (Test-Path (Join-Path $path "index.html"))) { throw "index.html yok: $path" }

if (-not (Test-Path "IIS:\AppPools\$poolName")) {
    New-WebAppPool -Name $poolName | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$poolName" -Name "managedRuntimeVersion" -Value ""

if (-not (Test-Path "IIS:\Sites\$siteName")) {
    New-Website -Name $siteName -PhysicalPath $path -ApplicationPool $poolName -Port 80 -HostHeader $hostname | Out-Null
    Write-Host "Site olusturuldu: $siteName"
} else {
    Set-ItemProperty "IIS:\Sites\$siteName" -Name "physicalPath" -Value $path
    Set-ItemProperty "IIS:\Sites\$siteName" -Name "applicationPool" -Value $poolName
    Write-Host "Site guncellendi: $siteName"
}

$apiBinding = Get-WebBinding -Name "OtoServis-Api" -Protocol "https" -ErrorAction SilentlyContinue |
    Where-Object { $_.bindingInformation -like "*:443:api.mobilservisiniz.com" } |
    Select-Object -First 1
if (-not $apiBinding) { throw "api.mobilservisiniz.com HTTPS baglantisi bulunamadi." }
$thumb = $apiBinding.certificateHash
if (-not $thumb) { $thumb = $apiBinding.GetAttributeValue("certificateHash") }
if (-not $thumb) { throw "Mevcut API sertifika thumbprint alinamadi." }

$httpsExists = Get-WebBinding -Name $siteName -Protocol "https" -ErrorAction SilentlyContinue |
    Where-Object { $_.bindingInformation -like "*:443:$hostname" }
if (-not $httpsExists) {
    New-WebBinding -Name $siteName -Protocol "https" -Port 443 -HostHeader $hostname -SslFlags 1
}
$webBinding = Get-WebBinding -Name $siteName -Protocol "https" |
    Where-Object { $_.bindingInformation -like "*:443:$hostname" }
$webBinding.AddSslCertificate($thumb, "My")

Start-WebAppPool -Name $poolName
Start-Website -Name $siteName
Write-Host "Hazir: https://$hostname" -ForegroundColor Green
