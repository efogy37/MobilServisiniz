/* ==========================================================================
   OtoServis — Eksik tabloları tamamla
   vehicles ve sonrası oluşmamışsa bu scripti çalıştırın.
   Sonra: 02_seed.sql (shops boşsa)
   ========================================================================== */
USE OtoServis;
GO
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.vehicles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.vehicles (
        id           uniqueidentifier NOT NULL CONSTRAINT DF_vehicles_id DEFAULT NEWID(),
        shop_id      uniqueidentifier NOT NULL,
        customer_id  uniqueidentifier NOT NULL,
        brand_id     uniqueidentifier NULL,
        model_id     uniqueidentifier NULL,
        plate        nvarchar(20)     NOT NULL,
        plate_norm   AS (CAST(UPPER(REPLACE(plate, N' ', N'')) AS nvarchar(20))) PERSISTED,
        brand        nvarchar(60)     NOT NULL CONSTRAINT DF_vehicles_brand DEFAULT N'',
        model        nvarchar(80)     NOT NULL CONSTRAINT DF_vehicles_model DEFAULT N'',
        model_year   smallint         NULL,
        color        nvarchar(40)     NULL,
        fuel         nvarchar(20)     NOT NULL CONSTRAINT DF_vehicles_fuel DEFAULT N'diger',
        chassis_no   nvarchar(32)     NULL,
        engine_no    nvarchar(32)     NULL,
        engine_volume nvarchar(20)    NULL,
        mileage      int              NULL,
        notes        nvarchar(500)    NULL,
        is_active    bit              NOT NULL CONSTRAINT DF_vehicles_active DEFAULT 1,
        created_at   datetime2(0)     NOT NULL CONSTRAINT DF_vehicles_created DEFAULT SYSUTCDATETIME(),
        updated_at   datetime2(0)     NOT NULL CONSTRAINT DF_vehicles_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_vehicles PRIMARY KEY (id),
        CONSTRAINT FK_vehicles_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_vehicles_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT FK_vehicles_brand_ref FOREIGN KEY (brand_id) REFERENCES dbo.vehicle_brands(id),
        CONSTRAINT FK_vehicles_model_ref FOREIGN KEY (model_id) REFERENCES dbo.vehicle_models(id),
        CONSTRAINT FK_vehicles_fuel FOREIGN KEY (fuel) REFERENCES dbo.ref_fuel_types(code),
        CONSTRAINT CK_vehicles_year CHECK (model_year IS NULL OR model_year BETWEEN 1900 AND 2100),
        CONSTRAINT CK_vehicles_mileage CHECK (mileage IS NULL OR mileage >= 0)
    );
    CREATE UNIQUE INDEX UX_vehicles_plate ON dbo.vehicles(shop_id, plate_norm) WHERE is_active = 1;
    CREATE INDEX IX_vehicles_shop ON dbo.vehicles(shop_id);
    CREATE INDEX IX_vehicles_customer ON dbo.vehicles(customer_id);
    PRINT N'vehicles tablosu oluşturuldu.';
END
ELSE PRINT N'vehicles zaten var.';
GO

IF OBJECT_ID(N'dbo.appointments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointments (
        id uniqueidentifier NOT NULL CONSTRAINT DF_appt_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        customer_id uniqueidentifier NOT NULL,
        vehicle_id uniqueidentifier NULL,
        assigned_user_id uniqueidentifier NULL,
        status nvarchar(20) NOT NULL CONSTRAINT DF_appt_status DEFAULT N'bekliyor',
        scheduled_at datetime2(0) NOT NULL,
        duration_minutes int NOT NULL CONSTRAINT DF_appt_dur DEFAULT 60,
        subject nvarchar(200) NULL, notes nvarchar(500) NULL,
        work_order_id uniqueidentifier NULL,
        created_by uniqueidentifier NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_appointments PRIMARY KEY (id),
        CONSTRAINT FK_appt_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_appt_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT FK_appt_vehicle FOREIGN KEY (vehicle_id) REFERENCES dbo.vehicles(id) ON DELETE SET NULL,
        CONSTRAINT FK_appt_user FOREIGN KEY (assigned_user_id) REFERENCES dbo.users(id),
        CONSTRAINT FK_appt_status FOREIGN KEY (status) REFERENCES dbo.ref_appointment_status(code),
        CONSTRAINT FK_appt_created_by FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
    CREATE INDEX IX_appt_shop ON dbo.appointments(shop_id);
    CREATE INDEX IX_appt_scheduled ON dbo.appointments(shop_id, scheduled_at);
    PRINT N'appointments tablosu oluşturuldu.';
END
GO

IF OBJECT_ID(N'dbo.work_orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.work_orders (
        id uniqueidentifier NOT NULL CONSTRAINT DF_wo_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        order_no bigint NOT NULL,
        vehicle_id uniqueidentifier NOT NULL,
        customer_id uniqueidentifier NOT NULL,
        assigned_user_id uniqueidentifier NULL,
        assigned_user_name nvarchar(150) NULL,
        opened_by uniqueidentifier NULL,
        status nvarchar(20) NOT NULL CONSTRAINT DF_wo_status DEFAULT N'bekliyor',
        mileage_in int NULL, mileage_out int NULL,
        discount_amount decimal(12,2) NOT NULL CONSTRAINT DF_wo_disc DEFAULT 0,
        notes nvarchar(1000) NULL, internal_notes nvarchar(1000) NULL,
        opened_at datetime2(0) NOT NULL CONSTRAINT DF_wo_opened DEFAULT SYSUTCDATETIME(),
        started_at datetime2(0) NULL, closed_at datetime2(0) NULL, delivered_at datetime2(0) NULL,
        created_at datetime2(0) NOT NULL CONSTRAINT DF_wo_created DEFAULT SYSUTCDATETIME(),
        updated_at datetime2(0) NOT NULL CONSTRAINT DF_wo_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_work_orders PRIMARY KEY (id),
        CONSTRAINT UQ_wo_shop_no UNIQUE (shop_id, order_no),
        CONSTRAINT FK_wo_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_wo_vehicle FOREIGN KEY (vehicle_id) REFERENCES dbo.vehicles(id),
        CONSTRAINT FK_wo_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT FK_wo_user FOREIGN KEY (assigned_user_id) REFERENCES dbo.users(id),
        CONSTRAINT FK_wo_opened_by FOREIGN KEY (opened_by) REFERENCES dbo.users(id),
        CONSTRAINT FK_wo_status FOREIGN KEY (status) REFERENCES dbo.ref_work_order_status(code),
        CONSTRAINT CK_wo_discount CHECK (discount_amount >= 0)
    );
    CREATE INDEX IX_wo_shop ON dbo.work_orders(shop_id);
    CREATE INDEX IX_wo_status ON dbo.work_orders(shop_id, status);
    CREATE INDEX IX_wo_opened ON dbo.work_orders(shop_id, opened_at DESC);
    PRINT N'work_orders tablosu oluşturuldu.';
END
GO

IF OBJECT_ID(N'dbo.FK_appt_work_order', N'F') IS NULL
    ALTER TABLE dbo.appointments ADD CONSTRAINT FK_appt_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE SET NULL;
GO

IF OBJECT_ID(N'dbo.work_order_status_history', N'U') IS NULL
    CREATE TABLE dbo.work_order_status_history (
        id uniqueidentifier NOT NULL CONSTRAINT DF_wosh_id DEFAULT NEWID(),
        work_order_id uniqueidentifier NOT NULL,
        shop_id uniqueidentifier NOT NULL,
        old_status nvarchar(20) NULL, new_status nvarchar(20) NOT NULL,
        changed_by uniqueidentifier NULL, note nvarchar(300) NULL,
        changed_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_work_order_status_history PRIMARY KEY (id),
        CONSTRAINT FK_wosh_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_wosh_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_wosh_user FOREIGN KEY (changed_by) REFERENCES dbo.users(id),
        CONSTRAINT FK_wosh_new FOREIGN KEY (new_status) REFERENCES dbo.ref_work_order_status(code)
    );
GO

IF OBJECT_ID(N'dbo.work_order_images', N'U') IS NULL
    CREATE TABLE dbo.work_order_images (
        id uniqueidentifier NOT NULL CONSTRAINT DF_woimg_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        work_order_id uniqueidentifier NULL, vehicle_id uniqueidentifier NULL,
        image_type nvarchar(20) NOT NULL CONSTRAINT DF_woimg_type DEFAULT N'ruhsat',
        file_path nvarchar(500) NOT NULL, mime_type nvarchar(50) NULL,
        ai_scanned bit NOT NULL DEFAULT 0, ai_result_json nvarchar(max) NULL,
        uploaded_by uniqueidentifier NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_work_order_images PRIMARY KEY (id),
        CONSTRAINT FK_woimg_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_woimg_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_woimg_vehicle FOREIGN KEY (vehicle_id) REFERENCES dbo.vehicles(id) ON DELETE SET NULL,
        CONSTRAINT FK_woimg_user FOREIGN KEY (uploaded_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_woimg_type CHECK (image_type IN (N'ruhsat', N'arac', N'hasar', N'diger'))
    );
GO

IF OBJECT_ID(N'dbo.complaints', N'U') IS NULL
    CREATE TABLE dbo.complaints (
        id uniqueidentifier NOT NULL CONSTRAINT DF_complaints_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        work_order_id uniqueidentifier NOT NULL,
        description nvarchar(1000) NOT NULL,
        is_resolved bit NOT NULL DEFAULT 0,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_complaints PRIMARY KEY (id),
        CONSTRAINT FK_complaints_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_complaints_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE
    );
GO

IF OBJECT_ID(N'dbo.services', N'U') IS NULL
    CREATE TABLE dbo.services (
        id uniqueidentifier NOT NULL CONSTRAINT DF_services_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        work_order_id uniqueidentifier NOT NULL,
        service_catalog_id uniqueidentifier NULL,
        title nvarchar(200) NOT NULL, price decimal(12,2) NOT NULL DEFAULT 0,
        performed_by uniqueidentifier NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_services PRIMARY KEY (id),
        CONSTRAINT FK_services_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_services_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_services_catalog FOREIGN KEY (service_catalog_id) REFERENCES dbo.service_catalog(id) ON DELETE SET NULL,
        CONSTRAINT FK_services_user FOREIGN KEY (performed_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_services_price CHECK (price >= 0)
    );
GO

IF OBJECT_ID(N'dbo.work_order_parts', N'U') IS NULL
    CREATE TABLE dbo.work_order_parts (
        id uniqueidentifier NOT NULL CONSTRAINT DF_parts_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        work_order_id uniqueidentifier NOT NULL,
        stock_product_id uniqueidentifier NULL,
        name nvarchar(200) NOT NULL, quantity int NOT NULL DEFAULT 1,
        unit_price decimal(12,2) NOT NULL DEFAULT 0,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_work_order_parts PRIMARY KEY (id),
        CONSTRAINT FK_parts_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_parts_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_parts_stock FOREIGN KEY (stock_product_id) REFERENCES dbo.stock_products(id) ON DELETE SET NULL,
        CONSTRAINT CK_parts_qty CHECK (quantity > 0)
    );
GO

IF OBJECT_ID(N'dbo.stock_movements', N'U') IS NULL
    CREATE TABLE dbo.stock_movements (
        id uniqueidentifier NOT NULL CONSTRAINT DF_mov_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        stock_product_id uniqueidentifier NOT NULL,
        change_qty int NOT NULL,
        movement_type nvarchar(20) NOT NULL DEFAULT N'cikis',
        reason nvarchar(200) NULL, work_order_id uniqueidentifier NULL,
        created_by uniqueidentifier NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_stock_movements PRIMARY KEY (id),
        CONSTRAINT FK_mov_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_mov_stock FOREIGN KEY (stock_product_id) REFERENCES dbo.stock_products(id) ON DELETE CASCADE,
        CONSTRAINT FK_mov_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE SET NULL,
        CONSTRAINT FK_mov_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_mov_change CHECK (change_qty <> 0),
        CONSTRAINT CK_mov_type CHECK (movement_type IN (N'giris', N'cikis', N'sayim', N'iade'))
    );
GO

IF OBJECT_ID(N'dbo.payments', N'U') IS NULL
    CREATE TABLE dbo.payments (
        id uniqueidentifier NOT NULL CONSTRAINT DF_pay_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        work_order_id uniqueidentifier NOT NULL,
        amount decimal(12,2) NOT NULL, method nvarchar(20) NOT NULL DEFAULT N'nakit',
        reference_no nvarchar(50) NULL, received_by uniqueidentifier NULL,
        paid_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_payments PRIMARY KEY (id),
        CONSTRAINT FK_pay_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_pay_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_pay_method FOREIGN KEY (method) REFERENCES dbo.ref_payment_methods(code),
        CONSTRAINT FK_pay_user FOREIGN KEY (received_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_pay_amount CHECK (amount > 0)
    );
GO

IF OBJECT_ID(N'dbo.invoices', N'U') IS NULL
    CREATE TABLE dbo.invoices (
        id uniqueidentifier NOT NULL CONSTRAINT DF_inv_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        work_order_id uniqueidentifier NOT NULL,
        invoice_no bigint NOT NULL,
        customer_id uniqueidentifier NOT NULL,
        subtotal decimal(12,2) NOT NULL DEFAULT 0,
        discount decimal(12,2) NOT NULL DEFAULT 0,
        vat_rate decimal(5,2) NOT NULL DEFAULT 20.00,
        vat_amount decimal(12,2) NOT NULL DEFAULT 0,
        grand_total decimal(12,2) NOT NULL DEFAULT 0,
        issued_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        issued_by uniqueidentifier NULL,
        CONSTRAINT PK_invoices PRIMARY KEY (id),
        CONSTRAINT UQ_inv_shop_no UNIQUE (shop_id, invoice_no),
        CONSTRAINT UQ_invoices_wo UNIQUE (work_order_id),
        CONSTRAINT FK_inv_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_inv_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_inv_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT FK_inv_user FOREIGN KEY (issued_by) REFERENCES dbo.users(id)
    );
GO

/* Tetikleyiciler */
IF OBJECT_ID(N'dbo.trg_vehicles_upd', N'TR') IS NULL AND OBJECT_ID(N'dbo.vehicles', N'U') IS NOT NULL
    EXEC(N'CREATE TRIGGER dbo.trg_vehicles_upd ON dbo.vehicles AFTER UPDATE AS
    BEGIN SET NOCOUNT ON; UPDATE t SET updated_at=SYSUTCDATETIME() FROM dbo.vehicles t INNER JOIN inserted i ON t.id=i.id; END');
GO

IF OBJECT_ID(N'dbo.trg_appt_upd', N'TR') IS NULL AND OBJECT_ID(N'dbo.appointments', N'U') IS NOT NULL
    EXEC(N'CREATE TRIGGER dbo.trg_appt_upd ON dbo.appointments AFTER UPDATE AS
    BEGIN SET NOCOUNT ON; UPDATE t SET updated_at=SYSUTCDATETIME() FROM dbo.appointments t INNER JOIN inserted i ON t.id=i.id; END');
GO

IF OBJECT_ID(N'dbo.trg_wo_upd', N'TR') IS NULL AND OBJECT_ID(N'dbo.work_orders', N'U') IS NOT NULL
    EXEC(N'CREATE TRIGGER dbo.trg_wo_upd ON dbo.work_orders AFTER UPDATE AS
    BEGIN SET NOCOUNT ON; UPDATE t SET updated_at=SYSUTCDATETIME() FROM dbo.work_orders t INNER JOIN inserted i ON t.id=i.id; END');
GO

IF OBJECT_ID(N'dbo.trg_wo_status_history', N'TR') IS NOT NULL DROP TRIGGER dbo.trg_wo_status_history;
GO
IF OBJECT_ID(N'dbo.work_orders', N'U') IS NOT NULL
    EXEC(N'CREATE TRIGGER dbo.trg_wo_status_history ON dbo.work_orders AFTER UPDATE AS
    BEGIN SET NOCOUNT ON;
        INSERT INTO dbo.work_order_status_history (id, work_order_id, shop_id, old_status, new_status, changed_at)
        SELECT NEWID(), i.id, i.shop_id, d.status, i.status, SYSUTCDATETIME()
        FROM inserted i INNER JOIN deleted d ON i.id=d.id WHERE i.status<>d.status;
    END');
GO

/* Stored procedure''ler */
IF OBJECT_ID(N'dbo.usp_NextTenantCounter', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_NextTenantCounter;
GO
CREATE PROCEDURE dbo.usp_NextTenantCounter
    @shop_id uniqueidentifier, @counter_name nvarchar(30), @next_value bigint OUTPUT
AS
BEGIN SET NOCOUNT ON;
    MERGE dbo.tenant_counters AS t
    USING (SELECT @shop_id AS shop_id, @counter_name AS counter_name) AS s
    ON t.shop_id=s.shop_id AND t.counter_name=s.counter_name
    WHEN MATCHED THEN UPDATE SET last_value=last_value+1, @next_value=last_value+1
    WHEN NOT MATCHED THEN INSERT (shop_id, counter_name, last_value)
        VALUES (@shop_id, @counter_name, 1000);
    IF @next_value IS NULL SET @next_value=1000;
END
GO

IF OBJECT_ID(N'dbo.usp_AddPartToWorkOrder', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_AddPartToWorkOrder;
GO
CREATE PROCEDURE dbo.usp_AddPartToWorkOrder
    @shop_id uniqueidentifier, @work_order_id uniqueidentifier,
    @stock_product_id uniqueidentifier=NULL, @name nvarchar(200),
    @quantity int, @unit_price decimal(12,2), @created_by uniqueidentifier=NULL
AS
BEGIN SET NOCOUNT ON;
    IF @quantity<=0 THROW 50001, N'Miktar 0''dan büyük olmalı.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.work_orders WHERE id=@work_order_id AND shop_id=@shop_id)
        THROW 50004, N'İş emri bu servise ait değil.', 1;
    BEGIN TRY BEGIN TRAN;
        INSERT INTO dbo.work_order_parts (id,shop_id,work_order_id,stock_product_id,name,quantity,unit_price)
        VALUES (NEWID(),@shop_id,@work_order_id,@stock_product_id,@name,@quantity,@unit_price);
        IF @stock_product_id IS NOT NULL BEGIN
            IF (SELECT quantity FROM dbo.stock_products WHERE id=@stock_product_id AND shop_id=@shop_id)<@quantity
                THROW 50002, N'Yetersiz stok.', 1;
            UPDATE dbo.stock_products SET quantity=quantity-@quantity WHERE id=@stock_product_id AND shop_id=@shop_id;
            INSERT INTO dbo.stock_movements (id,shop_id,stock_product_id,change_qty,movement_type,reason,work_order_id,created_by)
            VALUES (NEWID(),@shop_id,@stock_product_id,-@quantity,N'cikis',N'İş emrinde kullanıldı',@work_order_id,@created_by);
        END
        COMMIT;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH
END
GO

/* Görünümler */
IF OBJECT_ID(N'dbo.vw_WorkOrderTotals', N'V') IS NOT NULL DROP VIEW dbo.vw_WorkOrderTotals;
GO
CREATE VIEW dbo.vw_WorkOrderTotals AS
SELECT wo.id, wo.shop_id, wo.order_no, wo.status, wo.customer_id, wo.vehicle_id,
    ISNULL(l.labor_total,0) labor_total, ISNULL(p.parts_total,0) parts_total,
    wo.discount_amount,
    ISNULL(l.labor_total,0)+ISNULL(p.parts_total,0)-wo.discount_amount grand_total,
    ISNULL(pay.paid_total,0) paid_total
FROM dbo.work_orders wo
OUTER APPLY (SELECT SUM(s.price) labor_total FROM dbo.services s WHERE s.work_order_id=wo.id) l
OUTER APPLY (SELECT SUM(pp.quantity*pp.unit_price) parts_total FROM dbo.work_order_parts pp WHERE pp.work_order_id=wo.id) p
OUTER APPLY (SELECT SUM(py.amount) paid_total FROM dbo.payments py WHERE py.work_order_id=wo.id) pay;
GO

IF OBJECT_ID(N'dbo.vw_ShopDashboard', N'V') IS NOT NULL DROP VIEW dbo.vw_ShopDashboard;
GO
CREATE VIEW dbo.vw_ShopDashboard AS
SELECT s.id shop_id, s.tenant_code, s.name shop_name,
    (SELECT COUNT(*) FROM dbo.work_orders wo WHERE wo.shop_id=s.id AND wo.status=N'bekliyor') waiting,
    (SELECT COUNT(*) FROM dbo.work_orders wo WHERE wo.shop_id=s.id AND wo.status=N'islemde') in_progress,
    (SELECT COUNT(*) FROM dbo.customers c WHERE c.shop_id=s.id AND c.is_active=1) customers,
    (SELECT COUNT(*) FROM dbo.vehicles v WHERE v.shop_id=s.id AND v.is_active=1) vehicles,
    (SELECT COUNT(*) FROM dbo.shop_users su WHERE su.shop_id=s.id AND su.is_active=1) staff_count,
    (SELECT COUNT(*) FROM dbo.stock_products sp WHERE sp.shop_id=s.id AND sp.is_active=1 AND sp.quantity<=sp.min_quantity) low_stock
FROM dbo.shops s WHERE s.is_active=1;
GO

IF OBJECT_ID(N'dbo.vw_UserShops', N'V') IS NOT NULL DROP VIEW dbo.vw_UserShops;
GO
CREATE VIEW dbo.vw_UserShops AS
SELECT su.user_id, su.shop_id, s.tenant_code, s.slug, s.name shop_name, s.city,
    su.role, su.title, su.is_owner, su.is_active,
    CASE WHEN u.default_shop_id=su.shop_id THEN 1 ELSE 0 END is_default
FROM dbo.shop_users su
INNER JOIN dbo.shops s ON s.id=su.shop_id
INNER JOIN dbo.users u ON u.id=su.user_id
WHERE su.is_active=1 AND s.is_active=1;
GO

IF OBJECT_ID(N'dbo.vw_VehicleCurrentStatus', N'V') IS NOT NULL DROP VIEW dbo.vw_VehicleCurrentStatus;
GO
CREATE VIEW dbo.vw_VehicleCurrentStatus AS
SELECT v.id AS vehicle_id, v.shop_id, wo.status
FROM dbo.vehicles v
OUTER APPLY (
    SELECT TOP 1 w.status
    FROM dbo.work_orders w
    WHERE w.vehicle_id = v.id AND w.shop_id = v.shop_id
    ORDER BY w.opened_at DESC
) wo;
GO

PRINT N'Eksik tablolar / view''lar tamamlandı. shops boşsa 02_seed.sql çalıştırın.';
GO
