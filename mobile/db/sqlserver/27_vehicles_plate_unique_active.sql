/*
  Silinen (is_active=0) araçların plakası yeni kaydı engelliyordu.
  Unique indeks yalnızca aktif araçlarda geçerli olacak.

  Not: plate_norm CONVERT ile nvarchar(4000) gibi görünüyordu (8016 byte uyarısı).
  Kolon CAST(AS nvarchar(20)) ile yeniden oluşturulur; indeks anahtarı kısa kalır.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/* 1) Eski indeks(ler) */
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_vehicles_plate'
      AND object_id = OBJECT_ID(N'dbo.vehicles')
)
BEGIN
    DROP INDEX UX_vehicles_plate ON dbo.vehicles;
    PRINT N'UX_vehicles_plate kaldırıldı.';
END
GO

/* 2) plate_norm tipini nvarchar(20) olacak şekilde yenile */
IF COL_LENGTH(N'dbo.vehicles', N'plate_norm') IS NOT NULL
BEGIN
    ALTER TABLE dbo.vehicles DROP COLUMN plate_norm;
    PRINT N'plate_norm (eski computed) kaldırıldı.';
END
GO

IF COL_LENGTH(N'dbo.vehicles', N'plate_norm') IS NULL
BEGIN
    ALTER TABLE dbo.vehicles ADD plate_norm AS (
        CAST(UPPER(REPLACE(plate, N' ', N'')) AS nvarchar(20))
    ) PERSISTED;
    PRINT N'plate_norm nvarchar(20) olarak eklendi.';
END
GO

/* 3) Yalnızca aktif araçlarda unique */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_vehicles_plate'
      AND object_id = OBJECT_ID(N'dbo.vehicles')
)
BEGIN
    CREATE UNIQUE INDEX UX_vehicles_plate
        ON dbo.vehicles(shop_id, plate_norm)
        WHERE is_active = 1;
    PRINT N'UX_vehicles_plate (yalnızca aktif, kısa anahtar) oluşturuldu.';
END
GO
