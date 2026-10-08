# Cloudflare Kurulum Rehberi — mobilservisiniz.com

Domain'in yetkili DNS sunucusu zaten Cloudflare (`destiny.ns.cloudflare.com` / `anderson.ns.cloudflare.com`
olarak dogrulandi). Bu yuzden **butun DNS islemleri Cloudflare Dashboard > DNS > Records** ekraninda yapilir.
Alan adi saglayicinizin (registrar) kendi panelindeki "Özel Nameserver (NS)" / glue record bolumu
BU IS ICIN KULLANILMAZ — orada eklenen kayitlar gercek DNS coz\u00fcmlemesinde kullanilmaz.

## 1) DNS A kayitlari

Cloudflare Dashboard > ilgili domain > **DNS > Records > + Add record** ile 3 kayit ekleyin:

| Type | Name | Content (IPv4) | Proxy status | TTL |
|---|---|---|---|---|
| A | `api` | `31.57.33.85` | Proxied (turuncu bulut) | Auto |
| A | `panel` | `31.57.33.85` | Proxied (turuncu bulut) | Auto |
| A | `yonetim` | `31.57.33.85` | **DNS only** (gri bulut) | Auto |

`yonetim` icin DNS-only onerilir: Platform'un APK yukleme formu 120 MB'a kadar dosya kabul
ediyor, Cloudflare Free plan istek govdesini 100 MB ile siniriyor. DNS-only oldugunda trafik
Cloudflare'i atlayip direkt sunucuya gider, boylece bu sinir devreye girmez.

## 2) SSL/TLS modu

Cloudflare Dashboard > **SSL/TLS > Overview** > Encryption mode: **Full (strict)** secin.

("Full (strict)" origin sunucuda gecerli/guvenilir bir sertifika olmasini gerektirir — asagida
bu sertifikayi Cloudflare Origin CA ile ucretsiz olusturacagiz.)

## 3) Origin CA sertifikasi olusturma

Cloudflare Dashboard > **SSL/TLS > Origin Server** > **Create Certificate**:

- Private key type: RSA (2048)
- Hostnames: `*.mobilservisiniz.com` ve `mobilservisiniz.com` (ikisini de ekleyin — tek
  sertifika ile api/panel/yonetim alt domainlerinin hepsi kapsanir)
- Certificate Validity: 15 yil (varsayilan)

**Create** dedikten sonra ekranda 2 kutu cikar:
- **Origin Certificate** (PEM) → `cf-origin.pem` olarak kaydedin
- **Private Key** (PEM) → `cf-origin.key` olarak kaydedin

Bu ikisini kapatirsaniz bir daha goremezsiniz, mutlaka kaydedin.

## 4) .pfx'e cevirme (IIS bunu bekliyor)

Bilgisayarinizda (OpenSSL kuruluysa) veya sunucuda calistirin:

```
openssl pkcs12 -export -out cf-origin.pfx -inkey cf-origin.key -in cf-origin.pem
```

Bir sifre belirlemeniz istenecek — bu sifreyi not edin, `02-Create-Sites.ps1` scriptine
`-PfxPassword` olarak verilecek.

OpenSSL yoksa: Windows'ta Git for Windows kurulumuyla birlikte gelir (`C:\Program Files\Git\usr\bin\openssl.exe`),
veya https://slproweb.com/products/Win32OpenSSL.html adresinden kurulabilir.

## 5) .pfx dosyasini sunucuya kopyalayin

`cf-origin.pfx` dosyasini RDP ile sunucuya, ornegin `C:\OtoServis\cf-origin.pfx` konumuna kopyalayin.
Bir sonraki adimda (`02-Create-Sites.ps1`) bu dosyayi otomatik olarak sertifika deposuna ice aktaracagiz.

## Not: yonetim.mobilservisiniz.com icin tarayici uyarisi

Origin CA sertifikasi sadece Cloudflare'in kendisi tarafindan guvenilir. `yonetim` alt domainini
DNS-only (gri bulut) yaptiginiz icin, tarayici bu alt domaine dogrudan (Cloudflare'i atlayarak)
baglanir ve sertifikaya "guvenilmeyen sertifika" uyarisi gosterir. Bu, sadece personelin
kullandigi bir yonetim paneli icin kabul edilebilir bir durumdur (butonla devam edilebilir).
Isterseniz ileride bu alt domain icin ozel olarak ucretsiz bir Let's Encrypt sertifikasi (win-acme
araciyla) kurulabilir — bu, plan disi, opsiyonel bir iyilestirmedir.
