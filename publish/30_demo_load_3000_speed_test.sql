/* ==========================================================================
   OtoServis — Hız / yük testi: 3000 demo kayıt (+ işlemler)
   --------------------------------------------------------------------------
   Hedef: 05551112233 kullanıcısının servisi (OtoServis İstanbul / OTO-IST)

   Üretir:
     - 750 müşteri
     - 3000 araç + 3000 iş emri
     - ~%70 işe 1 işçilik, ~%40 işe 1 parça
     - tamamlanan işlere kısmi/tam tahsilat

   Temizlik: notes / phone önekleri DEMO_LOAD_3000 / 0599D
   Sunucuda: sqlcmd -S . -d OtoServis -E -I -f 65001 -i bu_dosya.sql
   Süre: genelde 1–3 dk (diske göre).
   ========================================================================== */
USE OtoServis;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @Phone nvarchar(30) = N'05551112233';
DECLARE @TargetCount int = 3000;
DECLARE @CustomerCount int = 750;
DECLARE @Tag nvarchar(40) = N'DEMO_LOAD_3000';
DECLARE @ShopId uniqueidentifier;
DECLARE @UserId uniqueidentifier;
DECLARE @ShopName nvarchar(200);
DECLARE @OrderBase bigint;
DECLARE @HasSource bit = CASE WHEN COL_LENGTH(N'dbo.work_order_parts', N'source') IS NULL THEN 0 ELSE 1 END;
DECLARE @HasPurchase bit = CASE WHEN COL_LENGTH(N'dbo.work_order_parts', N'purchase_price') IS NULL THEN 0 ELSE 1 END;

/* ---- Servis bul ---- */
SELECT TOP 1
    @UserId = u.id,
    @ShopId = COALESCE(u.default_shop_id, su.shop_id),
    @ShopName = s.name
FROM dbo.users u
LEFT JOIN dbo.shop_users su ON su.user_id = u.id AND su.is_active = 1
LEFT JOIN dbo.shops s ON s.id = COALESCE(u.default_shop_id, su.shop_id)
WHERE REPLACE(REPLACE(u.phone, N' ', N''), N'-', N'') = REPLACE(REPLACE(@Phone, N' ', N''), N'-', N'')
  AND u.is_active = 1
ORDER BY CASE WHEN su.is_owner = 1 THEN 0 ELSE 1 END, su.joined_at;

IF @ShopId IS NULL
BEGIN
    SELECT TOP 1 @ShopId = id, @ShopName = name
    FROM dbo.shops
    WHERE tenant_code = N'OTO-IST' OR name LIKE N'%İstanbul%' OR name LIKE N'%Istanbul%'
    ORDER BY CASE WHEN tenant_code = N'OTO-IST' THEN 0 ELSE 1 END;
END

IF @ShopId IS NULL
BEGIN
    RAISERROR(N'Servis bulunamadı (05551112233 / OTO-IST).', 16, 1);
    RETURN;
END

IF @UserId IS NULL
    SELECT TOP 1 @UserId = user_id FROM dbo.shop_users WHERE shop_id = @ShopId AND is_active = 1 ORDER BY is_owner DESC;

PRINT CONCAT(N'Hedef servis: ', @ShopName, N' / ', CONVERT(nvarchar(36), @ShopId));
PRINT CONCAT(N'Kullanıcı: ', CONVERT(nvarchar(36), ISNULL(@UserId, '00000000-0000-0000-0000-000000000000')));

/* ---- Önceki demo yükünü temizle ---- */
BEGIN TRAN;

DELETE py
FROM dbo.payments py
INNER JOIN dbo.work_orders wo ON wo.id = py.work_order_id
WHERE wo.shop_id = @ShopId AND wo.notes = @Tag;

DELETE s FROM dbo.services s
INNER JOIN dbo.work_orders wo ON wo.id = s.work_order_id
WHERE wo.shop_id = @ShopId AND wo.notes = @Tag;

DELETE p FROM dbo.work_order_parts p
INNER JOIN dbo.work_orders wo ON wo.id = p.work_order_id
WHERE wo.shop_id = @ShopId AND wo.notes = @Tag;

DELETE h FROM dbo.work_order_status_history h
INNER JOIN dbo.work_orders wo ON wo.id = h.work_order_id
WHERE wo.shop_id = @ShopId AND wo.notes = @Tag;

DELETE FROM dbo.work_orders WHERE shop_id = @ShopId AND notes = @Tag;
DELETE FROM dbo.vehicles WHERE shop_id = @ShopId AND notes = @Tag;
DELETE FROM dbo.customers WHERE shop_id = @ShopId AND phone LIKE N'0599D%';

COMMIT TRAN;
PRINT N'Eski DEMO_LOAD_3000 temizlendi.';

/* ---- Sayı tablosu ---- */
IF OBJECT_ID(N'tempdb..#n') IS NOT NULL DROP TABLE #n;
CREATE TABLE #n (i int NOT NULL PRIMARY KEY);

;WITH
a AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9),
b AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9),
c AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9),
d AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)
INSERT INTO #n (i)
SELECT TOP (@TargetCount)
    ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
FROM a CROSS JOIN b CROSS JOIN c CROSS JOIN d;

SELECT @OrderBase = ISNULL(MAX(order_no), 1000) FROM dbo.work_orders WHERE shop_id = @ShopId;

DECLARE @Brands TABLE (ord int, brand nvarchar(60), model nvarchar(80), fuel nvarchar(20));
INSERT INTO @Brands VALUES
 (1, N'Volkswagen', N'Passat', N'dizel'),
 (2, N'Renault', N'Clio', N'dizel'),
 (3, N'Fiat', N'Egea', N'benzin'),
 (4, N'Toyota', N'Corolla', N'benzin'),
 (5, N'Ford', N'Focus', N'dizel'),
 (6, N'Hyundai', N'i20', N'benzin'),
 (7, N'Opel', N'Astra', N'dizel'),
 (8, N'Peugeot', N'308', N'dizel'),
 (9, N'BMW', N'320i', N'benzin'),
 (10, N'Mercedes', N'C200', N'dizel');

DECLARE @Colors TABLE (ord int, color nvarchar(40));
INSERT INTO @Colors VALUES
 (1, N'Beyaz'), (2, N'Siyah'), (3, N'Gri'), (4, N'Mavi'), (5, N'Kırmızı'), (6, N'Gümüş');

DECLARE @Statuses TABLE (ord int, status nvarchar(20));
INSERT INTO @Statuses VALUES
 (1, N'bekliyor'), (2, N'bekliyor'),
 (3, N'islemde'), (4, N'islemde'), (5, N'islemde'),
 (6, N'tamamlandi'), (7, N'tamamlandi'), (8, N'tamamlandi'),
 (9, N'odeme_tamamlandi'), (10, N'odeme_tamamlandi');

BEGIN TRAN;

/* ---- Müşteriler ---- */
;WITH src AS (
    SELECT TOP (@CustomerCount) i FROM #n ORDER BY i
)
INSERT INTO dbo.customers (
    id, shop_id, customer_type, full_name, phone, city, address,
    is_customer, is_supplier, created_by, created_at, updated_at
)
SELECT
    NEWID(),
    @ShopId,
    N'bireysel',
    CONCAT(N'Demo Müşteri ', RIGHT(CONCAT(N'0000', CAST(i AS nvarchar(10))), 4)),
    CONCAT(N'0599D', RIGHT(CONCAT(N'000000', CAST(i AS nvarchar(10))), 6)),
    N'İstanbul',
    N'Demo Adres',
    1, 0,
    @UserId,
    DATEADD(MINUTE, -i, SYSUTCDATETIME()),
    SYSUTCDATETIME()
FROM src;

PRINT CONCAT(N'Müşteri: ', @@ROWCOUNT);

/* ---- Araç + iş emri (eşleşmeli staging) ---- */
IF OBJECT_ID(N'tempdb..#demo') IS NOT NULL DROP TABLE #demo;
CREATE TABLE #demo (
    i int NOT NULL PRIMARY KEY,
    customer_id uniqueidentifier NOT NULL,
    vehicle_id uniqueidentifier NOT NULL,
    wo_id uniqueidentifier NOT NULL,
    plate nvarchar(20) NOT NULL,
    brand nvarchar(60) NOT NULL,
    model nvarchar(80) NOT NULL,
    fuel nvarchar(20) NOT NULL,
    color nvarchar(40) NOT NULL,
    status nvarchar(20) NOT NULL,
    year smallint NOT NULL,
    mileage int NOT NULL,
    opened_at datetime2(0) NOT NULL,
    labor_price decimal(12,2) NOT NULL,
    part_price decimal(12,2) NOT NULL,
    part_purchase decimal(12,2) NOT NULL
);

;WITH cust AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, phone) AS rn
    FROM dbo.customers
    WHERE shop_id = @ShopId AND phone LIKE N'0599D%'
)
INSERT INTO #demo (
    i, customer_id, vehicle_id, wo_id, plate, brand, model, fuel, color, status,
    year, mileage, opened_at, labor_price, part_price, part_purchase
)
SELECT
    n.i,
    c.id,
    NEWID(),
    NEWID(),
    CONCAT(N'34 DM ', RIGHT(CONCAT(N'0000', CAST(n.i AS nvarchar(10))), 4)),
    b.brand,
    b.model,
    b.fuel,
    col.color,
    st.status,
    CAST(2012 + (n.i % 13) AS smallint),
    15000 + (n.i * 37) % 220000,
    DATEADD(MINUTE, -(n.i * 11), SYSUTCDATETIME()),
    CAST(350 + (n.i % 20) * 75 AS decimal(12,2)),
    CAST(180 + (n.i % 15) * 40 AS decimal(12,2)),
    CAST(90 + (n.i % 15) * 20 AS decimal(12,2))
FROM #n n
INNER JOIN cust c ON c.rn = ((n.i - 1) % @CustomerCount) + 1
INNER JOIN @Brands b ON b.ord = ((n.i - 1) % 10) + 1
INNER JOIN @Colors col ON col.ord = ((n.i - 1) % 6) + 1
INNER JOIN @Statuses st ON st.ord = ((n.i - 1) % 10) + 1;

INSERT INTO dbo.vehicles (
    id, shop_id, customer_id, plate, brand, model, model_year, color, fuel, mileage,
    notes, is_active, created_at, updated_at
)
SELECT
    vehicle_id, @ShopId, customer_id, plate, brand, model, year, color, fuel, mileage,
    @Tag, 1, opened_at, opened_at
FROM #demo;

PRINT CONCAT(N'Araç: ', @@ROWCOUNT);

INSERT INTO dbo.work_orders (
    id, shop_id, order_no, vehicle_id, customer_id, opened_by, assigned_user_id,
    status, mileage_in, notes, opened_at, started_at, closed_at, created_at, updated_at
)
SELECT
    wo_id,
    @ShopId,
    @OrderBase + i,
    vehicle_id,
    customer_id,
    @UserId,
    CASE WHEN status IN (N'islemde', N'tamamlandi', N'odeme_tamamlandi') THEN @UserId ELSE NULL END,
    status,
    mileage,
    @Tag,
    opened_at,
    CASE WHEN status = N'bekliyor' THEN NULL ELSE DATEADD(MINUTE, 30, opened_at) END,
    CASE WHEN status IN (N'tamamlandi', N'odeme_tamamlandi') THEN DATEADD(HOUR, 3, opened_at) ELSE NULL END,
    opened_at,
    opened_at
FROM #demo;

PRINT CONCAT(N'İş emri: ', @@ROWCOUNT);

/* ---- İşçilik (~%70) ---- */
INSERT INTO dbo.services (id, shop_id, work_order_id, title, price, performed_by, created_at)
SELECT
    NEWID(), @ShopId, wo_id,
    CASE (i % 5)
        WHEN 0 THEN N'Periyodik Bakım'
        WHEN 1 THEN N'Yağ ve Filtre Değişimi'
        WHEN 2 THEN N'Fren Balata Değişimi'
        WHEN 3 THEN N'Genel Kontrol'
        ELSE N'Klima Gazı Dolumu'
    END,
    labor_price,
    @UserId,
    DATEADD(MINUTE, 40, opened_at)
FROM #demo
WHERE (i % 10) NOT IN (0, 1, 2);  -- ~70%

PRINT CONCAT(N'İşçilik: ', @@ROWCOUNT);

/* ---- Parça (~%40) ---- */
IF @HasSource = 1 AND @HasPurchase = 1
BEGIN
    EXEC sp_executesql N'
    INSERT INTO dbo.work_order_parts (id, shop_id, work_order_id, name, quantity, unit_price, source, purchase_price, created_at)
    SELECT NEWID(), @ShopId, wo_id,
           CASE (i % 4)
             WHEN 0 THEN N''Yağ Filtresi''
             WHEN 1 THEN N''Hava Filtresi''
             WHEN 2 THEN N''Fren Balatası''
             ELSE N''Motor Yağı 5W-30''
           END,
           1, part_price, N''stok'', part_purchase, DATEADD(MINUTE, 50, opened_at)
    FROM #demo WHERE (i % 5) IN (1, 2);',
    N'@ShopId uniqueidentifier', @ShopId;
END
ELSE
BEGIN
    INSERT INTO dbo.work_order_parts (id, shop_id, work_order_id, name, quantity, unit_price, created_at)
    SELECT
        NEWID(), @ShopId, wo_id,
        CASE (i % 4)
            WHEN 0 THEN N'Yağ Filtresi'
            WHEN 1 THEN N'Hava Filtresi'
            WHEN 2 THEN N'Fren Balatası'
            ELSE N'Motor Yağı 5W-30'
        END,
        1, part_price, DATEADD(MINUTE, 50, opened_at)
    FROM #demo
    WHERE (i % 5) IN (1, 2);
END

PRINT CONCAT(N'Parça: ', @@ROWCOUNT);

/* ---- Tahsilat: tamamlandi kısmi, odeme_tamamlandi tam ---- */
INSERT INTO dbo.payments (id, shop_id, work_order_id, amount, method, received_by, paid_at)
SELECT
    NEWID(),
    @ShopId,
    d.wo_id,
    CASE
        WHEN d.status = N'odeme_tamamlandi' THEN
            ISNULL((SELECT SUM(s.price) FROM dbo.services s WHERE s.work_order_id = d.wo_id), 0)
          + ISNULL((SELECT SUM(p.quantity * p.unit_price) FROM dbo.work_order_parts p WHERE p.work_order_id = d.wo_id), 0)
        ELSE
            ROUND(
              (
                ISNULL((SELECT SUM(s.price) FROM dbo.services s WHERE s.work_order_id = d.wo_id), 0)
              + ISNULL((SELECT SUM(p.quantity * p.unit_price) FROM dbo.work_order_parts p WHERE p.work_order_id = d.wo_id), 0)
              ) * 0.5, 2)
    END,
    CASE (d.i % 3) WHEN 0 THEN N'nakit' WHEN 1 THEN N'kart' ELSE N'havale' END,
    @UserId,
    DATEADD(HOUR, 4, d.opened_at)
FROM #demo d
WHERE d.status IN (N'tamamlandi', N'odeme_tamamlandi')
  AND (
        ISNULL((SELECT SUM(s.price) FROM dbo.services s WHERE s.work_order_id = d.wo_id), 0)
      + ISNULL((SELECT SUM(p.quantity * p.unit_price) FROM dbo.work_order_parts p WHERE p.work_order_id = d.wo_id), 0)
      ) > 0;

PRINT CONCAT(N'Tahsilat: ', @@ROWCOUNT);

/* Sayaç */
MERGE dbo.tenant_counters AS t
USING (SELECT @ShopId AS shop_id, N'work_order_no' AS counter_name, @OrderBase + @TargetCount AS last_value) AS s
ON t.shop_id = s.shop_id AND t.counter_name = s.counter_name
WHEN MATCHED THEN UPDATE SET last_value = CASE WHEN t.last_value < s.last_value THEN s.last_value ELSE t.last_value END
WHEN NOT MATCHED THEN INSERT (shop_id, counter_name, last_value) VALUES (s.shop_id, s.counter_name, s.last_value);

COMMIT TRAN;

PRINT N'--- Özet ---';
SELECT
    (SELECT COUNT(*) FROM dbo.customers WHERE shop_id = @ShopId AND phone LIKE N'0599D%') AS demo_customers,
    (SELECT COUNT(*) FROM dbo.vehicles WHERE shop_id = @ShopId AND notes = @Tag) AS demo_vehicles,
    (SELECT COUNT(*) FROM dbo.work_orders WHERE shop_id = @ShopId AND notes = @Tag) AS demo_work_orders,
    (SELECT COUNT(*) FROM dbo.services s INNER JOIN dbo.work_orders wo ON wo.id = s.work_order_id WHERE wo.shop_id = @ShopId AND wo.notes = @Tag) AS demo_services,
    (SELECT COUNT(*) FROM dbo.work_order_parts p INNER JOIN dbo.work_orders wo ON wo.id = p.work_order_id WHERE wo.shop_id = @ShopId AND wo.notes = @Tag) AS demo_parts,
    (SELECT COUNT(*) FROM dbo.payments py INNER JOIN dbo.work_orders wo ON wo.id = py.work_order_id WHERE wo.shop_id = @ShopId AND wo.notes = @Tag) AS demo_payments;

PRINT N'Tamam. Plaka öneki: 34 DM xxxx | Temizlik: notes=DEMO_LOAD_3000 / phone 0599D%';
GO
