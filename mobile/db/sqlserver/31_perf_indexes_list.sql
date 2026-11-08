/* ==========================================================================
   OtoServis — Liste / arama performans indeksleri
   --------------------------------------------------------------------------
   Mobil araç listesi latest-WO sorgusu + plaka/müşteri aramaları için.
   Idempotent. Sunucuda: sqlcmd -S . -d OtoServis -E -C -I -i bu_dosya.sql
   ========================================================================== */
USE OtoServis;
GO
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_wo_shop_vehicle_opened' AND object_id = OBJECT_ID(N'dbo.work_orders')
)
BEGIN
    CREATE INDEX IX_wo_shop_vehicle_opened
        ON dbo.work_orders (shop_id, vehicle_id, opened_at DESC)
        INCLUDE (status, assigned_user_id, assigned_user_name, order_no, discount_amount);
    PRINT N'IX_wo_shop_vehicle_opened eklendi.';
END
ELSE PRINT N'IX_wo_shop_vehicle_opened zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_wo_shop_opened' AND object_id = OBJECT_ID(N'dbo.work_orders')
)
BEGIN
    CREATE INDEX IX_wo_shop_opened
        ON dbo.work_orders (shop_id, opened_at DESC)
        INCLUDE (vehicle_id, status, customer_id);
    PRINT N'IX_wo_shop_opened eklendi.';
END
ELSE PRINT N'IX_wo_shop_opened zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_vehicles_shop_created' AND object_id = OBJECT_ID(N'dbo.vehicles')
)
BEGIN
    CREATE INDEX IX_vehicles_shop_created
        ON dbo.vehicles (shop_id, created_at DESC)
        WHERE is_active = 1;
    PRINT N'IX_vehicles_shop_created eklendi.';
END
ELSE PRINT N'IX_vehicles_shop_created zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_customers_shop_name' AND object_id = OBJECT_ID(N'dbo.customers')
)
BEGIN
    CREATE INDEX IX_customers_shop_name
        ON dbo.customers (shop_id, full_name)
        WHERE is_active = 1;
    PRINT N'IX_customers_shop_name eklendi.';
END
ELSE PRINT N'IX_customers_shop_name zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_services_wo' AND object_id = OBJECT_ID(N'dbo.services')
)
BEGIN
    CREATE INDEX IX_services_wo ON dbo.services (work_order_id) INCLUDE (price, title);
    PRINT N'IX_services_wo eklendi.';
END
ELSE PRINT N'IX_services_wo zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_parts_wo' AND object_id = OBJECT_ID(N'dbo.work_order_parts')
)
BEGIN
    CREATE INDEX IX_parts_wo ON dbo.work_order_parts (work_order_id) INCLUDE (quantity, unit_price, name);
    PRINT N'IX_parts_wo eklendi.';
END
ELSE PRINT N'IX_parts_wo zaten var.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_payments_wo' AND object_id = OBJECT_ID(N'dbo.payments')
)
BEGIN
    CREATE INDEX IX_payments_wo ON dbo.payments (work_order_id) INCLUDE (amount, method, paid_at);
    PRINT N'IX_payments_wo eklendi.';
END
ELSE PRINT N'IX_payments_wo zaten var.';
GO

PRINT N'31_perf_indexes_list OK.';
GO
