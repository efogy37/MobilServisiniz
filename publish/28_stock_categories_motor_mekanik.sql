/* ==========================================================================
   OtoServis — Stok kategorileri: Motor, Mekanik
   --------------------------------------------------------------------------
   Mevcut sunucu DB'sinde çalıştırın (SSMS / sqlcmd).
   Idempotent: kayıt varsa atlar / sort_order günceller.
   ========================================================================== */
USE OtoServis;
GO
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

MERGE dbo.ref_stock_categories AS t
USING (VALUES
    (N'motor',   N'Motor',   6),
    (N'mekanik', N'Mekanik', 7)
) AS s (code, label, sort_order)
ON t.code = s.code
WHEN MATCHED THEN
    UPDATE SET label = s.label, sort_order = s.sort_order
WHEN NOT MATCHED THEN
    INSERT (code, label, sort_order) VALUES (s.code, s.label, s.sort_order);
GO

-- Diğer'i listenin sonuna al
IF EXISTS (SELECT 1 FROM dbo.ref_stock_categories WHERE code = N'diger')
    UPDATE dbo.ref_stock_categories SET sort_order = 8 WHERE code = N'diger';
GO

PRINT N'ref_stock_categories: motor / mekanik hazır.';
GO
