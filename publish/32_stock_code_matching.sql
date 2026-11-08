/* ==========================================================================
   OtoServis — PDF stok kodu akıllı eşleştirme
   --------------------------------------------------------------------------
   1) stock_products.code_norm : kodun ayırıcısız/BÜYÜK normalize hali
      ("F-APS 14" -> "FAPS14", "APS 14" -> "APS14"). Persisted computed.
   2) stock_code_aliases       : tedarikçi faturasında geçen ORİJİNAL kodun
      (ön ekleriyle) hangi stok ürününe karşılık geldiğini saklar; aynı
      tedarikçiden aynı kod tekrar gelince deterministik eşleşme sağlar ve
      tedarikçi ön eklerini (prefix) öğrenmeye yarar.
   Idempotent. Sunucuda: sqlcmd -S . -d OtoServis -E -C -I -i bu_dosya.sql
   ========================================================================== */
USE OtoServis;
GO
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ---------- 1) stock_products.code_norm ---------- */
/* REPLACE/UPPER ifadesi varsayılan nvarchar(4000) üretir → indeks anahtarı 8016 bayt uyarısı.
   CAST(... AS nvarchar(50)): code zaten nvarchar(50), ayırıcılar yalnızca kısalır. */

/* Geniş (nvarchar(4000)) eski kolon varsa indeks + kolonu düşürüp yeniden ekle. */
IF COL_LENGTH(N'dbo.stock_products', N'code_norm') IS NOT NULL
   AND EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.stock_products')
          AND name = N'code_norm' AND max_length > 100
   )
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_stock_code_norm' AND object_id = OBJECT_ID(N'dbo.stock_products')
    )
        DROP INDEX IX_stock_code_norm ON dbo.stock_products;
    ALTER TABLE dbo.stock_products DROP COLUMN code_norm;
    PRINT N'stock_products.code_norm (geniş) düşürüldü, nvarchar(50) olarak yeniden eklenecek.';
END
GO

IF COL_LENGTH(N'dbo.stock_products', N'code_norm') IS NULL
BEGIN
    ALTER TABLE dbo.stock_products ADD code_norm AS (
        CAST(
            CASE WHEN code IS NULL THEN NULL ELSE
                UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    REPLACE(REPLACE(code COLLATE Turkish_CI_AS, N'i', N'I'), N'ı', N'I'),
                    N' ', N''), N'-', N''), N'_', N''), N'.', N''), N'/', N''), N'\', N''))
            END
        AS nvarchar(50))
    ) PERSISTED;
    PRINT N'stock_products.code_norm eklendi (nvarchar(50)).';
END
ELSE PRINT N'stock_products.code_norm zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_stock_code_norm' AND object_id = OBJECT_ID(N'dbo.stock_products')
)
BEGIN
    /* SQL Server: filtrelenmiş indekste computed kolon (code_norm) kullanılamaz.
       code_norm yalnızca code NOT NULL iken dolu → filtreyi taban kolona yaz. */
    CREATE INDEX IX_stock_code_norm ON dbo.stock_products (shop_id, code_norm)
        INCLUDE (name, code, is_active)
        WHERE code IS NOT NULL;
    PRINT N'IX_stock_code_norm eklendi.';
END
ELSE PRINT N'IX_stock_code_norm zaten var.';
GO

/* ---------- 2) stock_code_aliases ---------- */
IF OBJECT_ID(N'dbo.stock_code_aliases', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stock_code_aliases (
        id uniqueidentifier NOT NULL CONSTRAINT DF_sca_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        stock_product_id uniqueidentifier NOT NULL,
        supplier_id uniqueidentifier NULL,
        raw_code nvarchar(80) NOT NULL,              -- PDF'de geçen orijinal kod (ön ekleriyle)
        raw_code_norm nvarchar(80) NOT NULL,         -- ayırıcısız BÜYÜK
        manufacturer_code_norm nvarchar(80) NULL,    -- ön ek soyulmuş üretici kodu (normalize)
        prefix_norm nvarchar(40) NULL,               -- soyulan ön ek (öğrenme için), ör. "F", "FI", "FBI"
        brand nvarchar(60) NULL,                     -- faturadaki marka (MANDO, BSG...)
        source nvarchar(20) NOT NULL CONSTRAINT DF_sca_source DEFAULT N'pdf',
        created_by uniqueidentifier NULL,
        created_at datetime2(0) NOT NULL CONSTRAINT DF_sca_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_stock_code_aliases PRIMARY KEY (id),
        CONSTRAINT FK_sca_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_sca_stock FOREIGN KEY (stock_product_id) REFERENCES dbo.stock_products(id) ON DELETE CASCADE
    );
    /* Aynı tedarikçide aynı ham kod yalnızca bir ürüne bağlanır (supplier NULL ayrı grup) */
    CREATE UNIQUE INDEX UX_sca_shop_supplier_raw
        ON dbo.stock_code_aliases (shop_id, supplier_id, raw_code_norm);
    CREATE INDEX IX_sca_shop_mfr ON dbo.stock_code_aliases (shop_id, manufacturer_code_norm)
        INCLUDE (stock_product_id, supplier_id);
    CREATE INDEX IX_sca_stock ON dbo.stock_code_aliases (stock_product_id);
    PRINT N'stock_code_aliases oluşturuldu.';
END
ELSE PRINT N'stock_code_aliases zaten var.';
GO

PRINT N'32_stock_code_matching OK.';
GO
