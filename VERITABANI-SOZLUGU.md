# MobilServisiniz — Veritabanı Sözlüğü

> Bu doküman canlı sunucudaki (`31.57.33.85` / `OtoServis`) veritabanı şemasından
> otomatik olarak çıkarılmıştır (12.08.2026). Her tablonun ne işe yaradığı ve
> her kolonun anlamı Türkçe olarak açıklanmıştır.
>
> Notlar:
> - **PK** = Birincil anahtar (Primary Key)
> - **Zorunlu** = `NOT NULL` (boş geçilemez)
> - Çoğu tabloda `shop_id` kolonu bulunur — bu, verinin **hangi servise (dükkâna)**
>   ait olduğunu belirtir (çoklu servis / multi-tenant yapı).

---

## 1) Servis / Kullanıcı

### `shops` — Servisler (dükkânlar)
Sisteme kayıtlı her oto servis şubesini temsil eder. Uygulamaya giren herkes bir şubeye bağlıdır.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Servisin benzersiz kimliği |
| `tenant_code` | Servis kodu (örn. `OTO-IST`) — eski girişlerde kullanılıyordu |
| `slug` | URL'de kullanılabilecek kısa ad |
| `name` | Servisin görünen adı |
| `legal_name` | Servisin resmi/ticari unvanı |
| `tax_no` | Vergi numarası |
| `tax_office` | Vergi dairesi |
| `phone` | Servis telefonu |
| `email` | Servis e-postası |
| `address` | Servis adresi |
| `city` / `district` | İl / ilçe |
| `logo_url` | Servis logosunun dosya yolu |
| `subscription_plan` | Abonelik paket kodu (örn. `standard`, `pro`) |
| `default_vat_rate` | Varsayılan KDV oranı (%) |
| `currency` | Para birimi (varsayılan `TRY`) |
| `timezone` | Saat dilimi |
| `is_active` | Servis aktif mi? |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |
| `bank_iban` | Servisin banka IBAN'ı (fatura/ödeme için) |
| `bank_name` | Banka adı |
| `account_holder` | Hesap sahibinin adı/unvanı |
| `max_users` | Bu serviste izin verilen maksimum kullanıcı sayısı (boşsa plan limiti geçerli) |
| `license_type` | Lisans türü (örn. `unlimited`, `trial`) |
| `license_started_at` | Lisansın başlama tarihi |
| `license_expires_at` | Lisansın bitiş tarihi (dolunca giriş kilitlenir) |

### `users` — Kullanıcılar
Sisteme giriş yapabilen tüm kişiler (servis sahibi, personel, platform yöneticisi).

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kullanıcının benzersiz kimliği |
| `username` | Kullanıcı adı (opsiyonel, telefonla da giriş yapılabilir) |
| `full_name` | Ad soyad |
| `phone` | Telefon numarası — giriş için kullanılır |
| `email` | E-posta |
| `password_hash` | Şifrenin özetlenmiş (hash'lenmiş) hâli — düz metin şifre saklanmaz |
| `default_shop_id` | Kullanıcının varsayılan/son bağlı olduğu servis |
| `is_active` | Hesap aktif mi? |
| `last_login_at` | Son giriş zamanı |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |
| `session_id` | Aktif oturum kimliği — aynı hesapla başka cihazdan girişte eskisini geçersiz kılmak için kullanılır |
| `is_platform_admin` | Bu kullanıcı Platform (üst yönetim) paneline girebilir mi? |

### `shop_users` — Kullanıcı ↔ Servis bağlantısı
Bir kullanıcının hangi servis(ler)de hangi rolle çalıştığını tutar (bir kullanıcı birden fazla serviste olabilir).

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `shop_id` | Bağlı olduğu servis |
| `user_id` | Bağlı olan kullanıcı |
| `role` | Roldeki yetki: `sahip` / `yonetici` / `personel` vb. |
| `title` | Unvan (örn. "Usta", "Muhasebe") |
| `is_owner` | Bu kişi servis sahibi mi? |
| `is_active` | Bu servisteki üyeliği aktif mi? |
| `joined_at` | Servise katılma tarihi |

### `shop_license_events` — Lisans geçmişi
Bir servisin lisans türü/süresi her değiştiğinde (yönetici tarafından) buraya kayıt düşer — denetim amaçlı.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `shop_id` | Hangi servis için yapıldığı |
| `old_license_type` / `new_license_type` | Eski / yeni lisans türü |
| `old_expires_at` / `new_expires_at` | Eski / yeni bitiş tarihi |
| `note` | Not (örn. "Yıllık yenileme") |
| `created_by` | İşlemi yapan (platform admin) kullanıcı |
| `created_at` | İşlem zamanı |

---

## 2) Müşteri / Tedarikçi

### `customers` — Müşteriler ve Tedarikçiler
**Tek tablo**: hem müşteriler hem tedarikçiler burada tutulur. `is_customer` / `is_supplier`
bayraklarıyla bir kayıt sadece müşteri, sadece tedarikçi ya da her ikisi birden olabilir
(örn. "hem araç servise getirip hem de parça satan" bir kişi/firma).

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın benzersiz kimliği |
| `shop_id` | Hangi servise ait |
| `customer_type` | `bireysel` / `kurumsal` |
| `full_name` | Ad soyad / firma adı |
| `company_name` | Şirket unvanı (kurumsalsa) |
| `phone` | Ana telefon — giriş/iletişim için |
| `phone2` | İkinci telefon |
| `email` | E-posta |
| `tc_no` | TC kimlik numarası |
| `tax_no` | Vergi numarası |
| `address` | Adres |
| `city` / `district` | İl / ilçe |
| `notes` | Serbest not alanı |
| `is_active` | Kayıt aktif mi (silinen kayıtlar pasife çekilir) |
| `created_by` | Kaydı oluşturan kullanıcı |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |
| `is_supplier` | Bu kişi/firma bir **tedarikçi** mi? |
| `is_customer` | Bu kişi/firma bir **müşteri** mi? |
| `contact_person` | Firmadaki yetkili kişi adı (tedarikçilerde kullanılır) |
| `opening_balance` | Açılış bakiyesi — sisteme kayıt anında devam eden borç/alacak |

### `suppliers_deprecated` — (KULLANILMIYOR — eski tedarikçi tablosu)
Eskiden tedarikçiler ayrı bir tabloda tutuluyordu; artık hepsi `customers` tablosuna
taşındı (`is_supplier=1` ile). Bu tablo veri kaybı riskine karşı silinmeden
yeniden adlandırılmış hâliyle duruyor, **aktif olarak kullanılmıyor**.

---

## 3) Araç

### `vehicles` — Araçlar
| Kolon | Açıklama |
|---|---|
| `id` (PK) | Aracın benzersiz kimliği |
| `shop_id` | Hangi servise kayıtlı |
| `customer_id` | Aracın sahibi (müşteri) |
| `brand_id` / `model_id` | Marka/model referans tablosuna bağlantı (opsiyonel) |
| `plate` | Plaka |
| `plate_norm` | Plakanın normalize edilmiş (boşluksuz/büyük harf) hâli — arama için |
| `brand` | Marka adı (serbest metin) |
| `model` | Model adı (serbest metin) |
| `model_year` | Model yılı |
| `color` | Renk |
| `fuel` | Yakıt tipi (benzin/dizel/lpg/elektrik/diğer) |
| `chassis_no` | Şasi numarası |
| `engine_no` | Motor numarası |
| `mileage` | Bilinen son kilometre |
| `notes` | Not |
| `is_active` | Kayıt aktif mi |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |
| `engine_volume` | Motor hacmi (örn. "1.6", "2.0") |

### `vehicle_brands` — Araç markaları (referans listesi)
| Kolon | Açıklama |
|---|---|
| `id` (PK) | Marka kimliği |
| `name` | Marka adı (örn. "Renault") |
| `is_active` | Listede görünsün mü |

### `vehicle_models` — Araç modelleri (referans listesi)
| Kolon | Açıklama |
|---|---|
| `id` (PK) | Model kimliği |
| `brand_id` | Bağlı olduğu marka |
| `name` | Model adı (örn. "Clio") |
| `is_active` | Listede görünsün mü |

---

## 4) İş Emri (Servis Kaydı)

### `work_orders` — İş emirleri
Bir aracın servise girişinden çıkışına kadar olan tüm süreci temsil eden ana kayıt.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | İş emrinin benzersiz kimliği |
| `shop_id` | Hangi servise ait |
| `order_no` | Servise özel, sıralı iş emri numarası (görünen numara) |
| `vehicle_id` | İlgili araç |
| `customer_id` | İlgili müşteri |
| `assigned_user_id` | İşi yapan/atanan personel (sistemde kayıtlıysa) |
| `opened_by` | İş emrini açan kullanıcı |
| `status` | Durum: `bekliyor` / `islemde` / `odeme_tamamlandi` / `teslim_edildi` vb. |
| `mileage_in` / `mileage_out` | Araç geliş / gidiş kilometresi |
| `discount_amount` | Toplam üzerinden yapılan indirim tutarı |
| `notes` | Müşteriye görünen not |
| `internal_notes` | Sadece servis içi not (müşteri görmez) |
| `opened_at` | Açılış zamanı |
| `started_at` | İşleme alınma zamanı |
| `closed_at` | Kapanış (ödeme tamamlanma) zamanı |
| `delivered_at` | Araç teslim zamanı |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |
| `assigned_user_name` | Sistemde kayıtlı olmayan bir kişi elle atandıysa, adı burada serbest metin olarak tutulur |

### `services` — İş emrindeki işçilik/hizmet kalemleri
Bir iş emrine eklenen her "yapılan iş" (işçilik) satırı.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kalemin kimliği |
| `shop_id` | Hangi servise ait |
| `work_order_id` | Bağlı olduğu iş emri |
| `service_catalog_id` | Hizmet kataloğundan seçildiyse, referans |
| `title` | Hizmetin adı (örn. "Yağ değişimi") |
| `price` | Bu hizmetin tutarı |
| `performed_by` | İşi yapan personel |
| `created_at` | Eklenme zamanı |

### `service_catalog` — Hizmet kataloğu (fiyat listesi)
Servisin sık kullandığı, önceden tanımlı hizmetler/fiyatlar listesi (hızlı seçim için).

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `shop_id` | Hangi servise ait |
| `code` | Kısa kod |
| `name` | Hizmet adı |
| `category` | Kategori |
| `description` | Açıklama |
| `default_price` | Varsayılan fiyat |
| `estimated_minutes` | Tahmini süre (dakika) |
| `is_active` | Aktif mi |
| `sort_order` | Listeleme sırası |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |

### `work_order_parts` — İş emrindeki parça/ürün kalemleri
Bir iş emrine eklenen her parça/ürün satırı — stoktan mı yoksa dışarıdan (bir
tedarikçiden) mi alındığını da tutar.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kalemin kimliği |
| `shop_id` | Hangi servise ait |
| `work_order_id` | Bağlı olduğu iş emri |
| `stock_product_id` | Stoktan düşüldüyse, ilgili stok ürünü |
| `name` | Parça/ürün adı |
| `quantity` | Miktar |
| `unit_price` | Müşteriye satış birim fiyatı |
| `created_at` | Eklenme zamanı |
| `source` | Kaynak: `stok` (depodan) veya `disaridan` (bir tedarikçiden direkt alım) |
| `supplier_id` | `disaridan` ise, hangi tedarikçiden alındığı |
| `purchase_price` | `disaridan` ise, tedarikçiye ödenen/ödenecek birim alış fiyatı |
| `returned_at` | Bu parça tedarikçiye iade edildiyse, iade zamanı |

### `work_order_status_history` — İş emri durum geçmişi
Bir iş emrinin durumu her değiştiğinde (`bekliyor` → `islemde` → ...) buraya kayıt düşer.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `work_order_id` | Hangi iş emri |
| `shop_id` | Hangi servise ait |
| `old_status` / `new_status` | Eski / yeni durum |
| `changed_by` | Değişikliği yapan kullanıcı |
| `note` | Not (opsiyonel) |
| `changed_at` | Değişiklik zamanı |

### `work_order_images` — İş emri fotoğrafları
Ruhsat taraması, araç hasar fotoğrafı gibi iş emrine bağlı görseller.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `shop_id` | Hangi servise ait |
| `work_order_id` | Bağlı iş emri (varsa) |
| `vehicle_id` | Bağlı araç (varsa) |
| `image_type` | Görsel türü (örn. `ruhsat`, `hasar`) |
| `file_path` | Dosyanın sunucudaki yolu/URL'si |
| `mime_type` | Dosya türü (örn. `image/jpeg`) |
| `ai_scanned` | Bu görsel yapay zekâ ile tarandı mı (ruhsat okuma) |
| `ai_result_json` | AI taramasının ham sonucu (JSON) |
| `uploaded_by` | Yükleyen kullanıcı |
| `created_at` | Yüklenme zamanı |
| `complaint_id` | Bir şikâyete bağlıysa, ilgili şikâyet |
| `service_id` | Bir hizmete bağlıysa, ilgili hizmet |

### `complaints` — Müşteri şikâyetleri / talepleri
Müşterinin araç için bildirdiği arıza/şikâyet listesi (iş emri açılırken girilir).

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `shop_id` | Hangi servise ait |
| `work_order_id` | Bağlı olduğu iş emri |
| `description` | Şikâyet açıklaması |
| `is_resolved` | Çözüldü mü? |
| `created_at` | Oluşturulma zamanı |
| `category` | Şikâyet kategorisi (örn. `motor`, `fren`, `elektrik`, `diger`) |

### `appointments` — Randevular
| Kolon | Açıklama |
|---|---|
| `id` (PK) | Randevu kimliği |
| `shop_id` | Hangi servise ait |
| `customer_id` | İlgili müşteri |
| `vehicle_id` | İlgili araç (opsiyonel) |
| `assigned_user_id` | Randevuyla ilgilenecek personel |
| `status` | Durum (`bekliyor` vb.) |
| `scheduled_at` | Planlanan tarih/saat |
| `duration_minutes` | Tahmini süre (dakika) |
| `subject` | Randevu konusu |
| `notes` | Not |
| `work_order_id` | Randevu bir iş emrine dönüştüyse, bağlantı |
| `created_by` | Oluşturan kullanıcı |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |

---

## 5) Ödeme / Cari Hesap

### `payments` — Müşteri tahsilatları
Bir iş emri için müşteriden alınan her ödeme.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Ödemenin kimliği |
| `shop_id` | Hangi servise ait |
| `work_order_id` | Hangi iş emri için yapıldığı |
| `amount` | Tutar |
| `method` | Ödeme yöntemi: `nakit` / `kart` / `havale` vb. |
| `reference_no` | Referans/işlem numarası (kart/havale için) |
| `received_by` | Tahsilatı alan kullanıcı |
| `paid_at` | Ödeme zamanı |

### `invoices` — Faturalar
| Kolon | Açıklama |
|---|---|
| `id` (PK) | Fatura kimliği |
| `shop_id` | Hangi servise ait |
| `work_order_id` | Hangi iş emri için kesildiği |
| `invoice_no` | Fatura numarası (sıralı) |
| `customer_id` | Müşteri |
| `subtotal` | KDV hariç toplam |
| `discount` | İndirim tutarı |
| `vat_rate` | Uygulanan KDV oranı (%) |
| `vat_amount` | KDV tutarı |
| `grand_total` | Genel toplam (KDV dahil) |
| `issued_at` | Kesilme zamanı |
| `issued_by` | Faturayı kesen kullanıcı |

### `supplier_transactions` — Tedarikçi cari hareketleri
Bir tedarikçiyle olan tüm parasal hareketler (alış, ödeme, iade, iskonto).
Tedarikçi bakiyesi (`vw_SupplierBalance` görünümü) bu tablodan hesaplanır.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Hareketin kimliği |
| `shop_id` | Hangi servise ait |
| `supplier_id` | İlgili tedarikçi (`customers` tablosuna bağlı) |
| `type` | Hareket türü: `alis` (borç artışı) / `odeme` (borç azalışı) / `iade` (borç azalışı) / `iskonto` (borç azalışı) |
| `amount` | Tutar (her zaman pozitif; etkisi `type`'a göre yorumlanır) |
| `work_order_part_id` | `alis`/`iade` bir iş emri parçasından geldiyse, ilgili kalem |
| `description` | Açıklama (örn. "İş emri #123 için dışarıdan alım: Fren balatası") |
| `created_by` | İşlemi yapan kullanıcı |
| `created_at` | İşlem zamanı |
| `method` | `odeme`/`iskonto` için ödeme yöntemi (`nakit`/`kart`/`havale`) |

> **Tedarikçi bakiyesi formülü:** `açılış bakiyesi + alış − ödeme − iade − iskonto`

---

## 6) Stok

### `stock_products` — Stok ürünleri
Servisin depoda tuttuğu, iş emirlerinde kullanılan parça/ürünler.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Ürünün kimliği |
| `shop_id` | Hangi servise ait |
| `supplier_id` | Bu ürünün genelde alındığı tedarikçi (opsiyonel) |
| `name` | Ürün adı |
| `category` | Kategori |
| `code` | Stok kodu |
| `barcode` | Barkod |
| `unit` | Birim (`adet`, `litre` vb.) |
| `purchase_price` | Alış fiyatı (birim) |
| `price` | Satış fiyatı (birim) |
| `quantity` | Güncel stok adedi |
| `min_quantity` | Kritik stok eşiği (bunun altına düşünce uyarı verilir) |
| `location` | Depodaki raf/konum bilgisi |
| `is_active` | Aktif mi (silinen ürünler pasife çekilir) |
| `created_at` / `updated_at` | Oluşturulma / güncellenme zamanı |

### `stock_movements` — Stok hareketleri
Bir stok ürününün miktarı her değiştiğinde (giriş/çıkış) buraya kayıt düşer.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Hareketin kimliği |
| `shop_id` | Hangi servise ait |
| `stock_product_id` | Hangi ürün |
| `change_qty` | Değişim miktarı (giriş için pozitif, çıkış için negatif) |
| `movement_type` | `giris` / `cikis` |
| `reason` | Sebep (örn. "İş emrinde kullanıldı", "Tedarikçiden alım") |
| `work_order_id` | İlgili iş emri (varsa) |
| `created_by` | İşlemi yapan kullanıcı |
| `created_at` | İşlem zamanı |

---

## 7) Sistem / Kayıt-İzleme / Referans

### `audit_log` — Aktivite / işlem geçmişi
Sistemde yapılan önemli işlemlerin (ekleme, güncelleme, silme) kaydı — ihtilaf/denetim
durumlarında "kim ne zaman ne yaptı" sorusuna cevap vermek için tutulur.

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Kaydın kimliği |
| `shop_id` | Hangi servise ait |
| `user_id` | İşlemi yapan kullanıcı |
| `action` | İşlem türü (`created` / `updated` / `deleted` vb.) |
| `entity_type` | Hangi kayıt türü üzerinde (örn. `supplier_payment`, `work_order`) |
| `entity_id` | İlgili kaydın kimliği |
| `old_values` | Değişiklik öncesi değerler (JSON, opsiyonel) |
| `new_values` | Değişiklik sonrası değerler (JSON, opsiyonel) |
| `ip_address` | İşlemin yapıldığı IP adresi |
| `created_at` | İşlem zamanı |
| `customer_id` | İlgili müşteri/tedarikçi (varsa) — müşteri bazlı aktivite geçmişi için |
| `vehicle_id` | İlgili araç (varsa) |
| `description` | İnsan tarafından okunabilir açıklama (örn. "Tedarikçiye ödeme yapıldı: 500 ₺") |

### `app_release` — Mobil uygulama sürüm bilgisi
Mobil APK güncelleme kontrolü için tek satırlık ayar tablosu (Platform panelinden yönetilir).

| Kolon | Açıklama |
|---|---|
| `id` (PK) | Sabit kayıt kimliği |
| `latest_version` | Son sürüm adı (örn. "1.0.27") |
| `latest_version_code` | Son sürüm kodu (sayısal, karşılaştırma için) |
| `min_version_code` | Bu kodun altındaki uygulamalar zorunlu güncellemeye yönlendirilir |
| `apk_url` | Güncel APK'nın indirme adresi |
| `release_notes` | Sürüm notları |
| `updated_at` | Son güncellenme zamanı |

### `tenant_counters` — Servise özel sayaçlar
Her servisin kendi içinde sıralı numara üretmesi için (örn. iş emri numarası).

| Kolon | Açıklama |
|---|---|
| `shop_id` (PK) | Hangi servise ait |
| `counter_name` (PK) | Sayaç adı (örn. `work_order_no`) |
| `last_value` | Son üretilen değer |

### Referans (`ref_*`) tabloları
Bunlar sabit, önceden tanımlı **seçenek listeleridir** (dropdown/select alanları için).
Hepsinde ortak yapı: `code` (sistemde kullanılan kod) ve `label` (ekranda görünen Türkçe metin).

| Tablo | Ne için kullanılır |
|---|---|
| `ref_appointment_status` | Randevu durumları |
| `ref_customer_types` | Müşteri tipleri (`bireysel` / `kurumsal`) |
| `ref_fuel_types` | Yakıt tipleri |
| `ref_payment_methods` | Ödeme yöntemleri (`nakit` / `kart` / `havale`) |
| `ref_service_categories` | Hizmet kategorileri |
| `ref_stock_categories` | Stok ürün kategorileri |
| `ref_subscription_plans` | Abonelik paketleri — her paketin fiyatı ve **hangi özelliklere izin verdiği** (`feature_stock`, `feature_suppliers`, `feature_staff_performance`, `feature_ai_ruhsat`, `feature_ai_invoice`, `feature_api_access`) |
| `ref_user_roles` | Kullanıcı rolleri (`sahip`, `personel` vb.) — `is_platform_role` platform-seviyesi bir rol mü onu belirtir |
| `ref_work_order_status` | İş emri durumları — `sort_order` sıralamayı, `is_terminal` bu durumun "bitmiş" sayılıp sayılmadığını belirtir |

---

## 8) Önemli Görünümler (View) — Hesaplanmış Bakiyeler

Bunlar tablo değil, birkaç tablodan **anlık hesaplanan** özet görünümlerdir:

| Görünüm | Ne hesaplar |
|---|---|
| `vw_CustomerBalance` | Bir müşterinin bize olan borcu = açılış bakiyesi + ödenmemiş iş emri kalanları |
| `vw_SupplierBalance` | Bir tedarikçiye olan borcumuz = açılış bakiyesi + alış − ödeme − iade − iskonto |
| `vw_WorkOrderTotals` | Bir iş emrinin toplamı = işçilik + parça − indirim, ve o iş emrine yapılan toplam tahsilat |
| `vw_ShopDashboard` | Servis anasayfasındaki özet sayılar (bekleyen iş, müşteri sayısı vb.) |
