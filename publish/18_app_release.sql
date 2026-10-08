/*
  18 — Mobil APK sürüm / otomatik güncelleme
  - dbo.app_release: tek satır (latest + min versionCode + apk_url)
*/
USE OtoServis;
GO
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID(N'dbo.app_release', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_release (
        id int NOT NULL CONSTRAINT PK_app_release PRIMARY KEY
            CONSTRAINT CK_app_release_singleton CHECK (id = 1),
        latest_version nvarchar(20) NOT NULL,
        latest_version_code int NOT NULL,
        min_version_code int NOT NULL,
        apk_url nvarchar(500) NULL,
        release_notes nvarchar(1000) NULL,
        updated_at datetime2(0) NOT NULL CONSTRAINT DF_app_release_updated DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_app_release_codes CHECK (
            latest_version_code > 0
            AND min_version_code > 0
            AND min_version_code <= latest_version_code
        )
    );
    PRINT N'app_release tablosu olusturuldu.';
END
ELSE
    PRINT N'app_release zaten var.';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.app_release WHERE id = 1)
BEGIN
    INSERT INTO dbo.app_release (
        id, latest_version, latest_version_code, min_version_code, apk_url, release_notes
    )
    VALUES (
        1,
        N'1.0.19',
        20,
        20,
        N'http://31.57.33.85:5280/releases/MobilServisiniz.apk',
        N'Mevcut surum'
    );
    PRINT N'app_release seed (1.0.19 / code 20) eklendi.';
END
ELSE
    PRINT N'app_release seed zaten var.';
GO

PRINT N'18_app_release OK.';
GO
