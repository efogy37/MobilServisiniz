/* ==========================================================================
   OtoServis — Microsoft SQL Server (Multi-Tenant / Servis Bazlı)
   --------------------------------------------------------------------------
   Her "servis" (shop) bir tenant'tır. Veriler shop_id ile izole edilir.
   Kullanıcılar shop_users üzerinden bir veya birden fazla servise bağlanır.

   Çalıştırma (sırayla):
     sqlcmd -S SUNUCU\INSTANCE -i 00_reset.sql      -- opsiyonel, temiz kurulum
     sqlcmd -S SUNUCU\INSTANCE -i 01_schema.sql
     sqlcmd -S SUNUCU\INSTANCE -i 02_seed.sql
   ========================================================================== */

IF DB_ID(N'OtoServis') IS NULL
    CREATE DATABASE OtoServis COLLATE Turkish_CI_AS;
GO
USE OtoServis;
GO
SET NOCOUNT ON;
GO

/* ==========================================================================
   REFERANS TABLOLAR (platform geneli — tüm tenant'lar paylaşır)
   ========================================================================== */

IF OBJECT_ID(N'dbo.ref_work_order_status', N'U') IS NULL
    CREATE TABLE dbo.ref_work_order_status (
        code nvarchar(20) NOT NULL, label nvarchar(50) NOT NULL,
        sort_order tinyint NOT NULL, is_terminal bit NOT NULL DEFAULT 0,
        CONSTRAINT PK_ref_work_order_status PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_fuel_types', N'U') IS NULL
    CREATE TABLE dbo.ref_fuel_types (
        code nvarchar(20) NOT NULL, label nvarchar(40) NOT NULL, sort_order tinyint NOT NULL,
        CONSTRAINT PK_ref_fuel_types PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_stock_categories', N'U') IS NULL
    CREATE TABLE dbo.ref_stock_categories (
        code nvarchar(20) NOT NULL, label nvarchar(40) NOT NULL, sort_order tinyint NOT NULL,
        CONSTRAINT PK_ref_stock_categories PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_service_categories', N'U') IS NULL
    CREATE TABLE dbo.ref_service_categories (
        code nvarchar(20) NOT NULL, label nvarchar(50) NOT NULL, sort_order tinyint NOT NULL,
        CONSTRAINT PK_ref_service_categories PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_payment_methods', N'U') IS NULL
    CREATE TABLE dbo.ref_payment_methods (
        code nvarchar(20) NOT NULL, label nvarchar(40) NOT NULL, sort_order tinyint NOT NULL,
        CONSTRAINT PK_ref_payment_methods PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_user_roles', N'U') IS NULL
    CREATE TABLE dbo.ref_user_roles (
        code nvarchar(20) NOT NULL, label nvarchar(40) NOT NULL, description nvarchar(200) NULL,
        is_platform_role bit NOT NULL DEFAULT 0,   -- 1 = super_admin (tenant dışı)
        CONSTRAINT PK_ref_user_roles PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_customer_types', N'U') IS NULL
    CREATE TABLE dbo.ref_customer_types (
        code nvarchar(20) NOT NULL, label nvarchar(40) NOT NULL,
        CONSTRAINT PK_ref_customer_types PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_appointment_status', N'U') IS NULL
    CREATE TABLE dbo.ref_appointment_status (
        code nvarchar(20) NOT NULL, label nvarchar(40) NOT NULL, sort_order tinyint NOT NULL,
        CONSTRAINT PK_ref_appointment_status PRIMARY KEY (code)
    );
GO

IF OBJECT_ID(N'dbo.ref_subscription_plans', N'U') IS NULL
    CREATE TABLE dbo.ref_subscription_plans (
        code nvarchar(20) NOT NULL, label nvarchar(50) NOT NULL,
        max_users int NOT NULL, max_vehicles_per_month int NULL,
        monthly_price decimal(12,2) NOT NULL DEFAULT 0,
        CONSTRAINT PK_ref_subscription_plans PRIMARY KEY (code)
    );
GO

/* Referans lookup verileri (FK constraint'ler için zorunlu) */
IF NOT EXISTS (SELECT 1 FROM dbo.ref_subscription_plans)
    INSERT INTO dbo.ref_subscription_plans (code, label, max_users, max_vehicles_per_month, monthly_price) VALUES
    (N'trial', N'Deneme', 3, 50, 0),
    (N'standard', N'Standard', 10, 500, 990),
    (N'premium', N'Premium', 50, NULL, 2490);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_work_order_status)
    INSERT INTO dbo.ref_work_order_status (code, label, sort_order, is_terminal) VALUES
    (N'bekliyor',N'Bekliyor',1,0),(N'islemde',N'İşlemde',2,0),(N'tamamlandi',N'Tamamlandı',3,0),
    (N'odeme_tamamlandi',N'Ödeme Tamamlandı',4,1),(N'teslim_edildi',N'Teslim Edildi',5,1),(N'iptal',N'İptal',6,1);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_fuel_types)
    INSERT INTO dbo.ref_fuel_types (code, label, sort_order) VALUES
    (N'benzin',N'Benzin',1),(N'dizel',N'Dizel',2),(N'lpg',N'LPG',3),
    (N'elektrik',N'Elektrik',4),(N'hibrit',N'Hibrit',5),(N'diger',N'Diğer',6);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_stock_categories)
    INSERT INTO dbo.ref_stock_categories (code, label, sort_order) VALUES
    (N'yag',N'Yağ',1),(N'filtre',N'Filtre',2),(N'fren',N'Fren',3),
    (N'lastik',N'Lastik',4),(N'elektrik',N'Elektrik',5),
    (N'motor',N'Motor',6),(N'mekanik',N'Mekanik',7),(N'diger',N'Diğer',8);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_service_categories)
    INSERT INTO dbo.ref_service_categories (code, label, sort_order) VALUES
    (N'periyodik',N'Periyodik Bakım',1),(N'motor',N'Motor',2),(N'fren',N'Fren',3),
    (N'suspansiyon',N'Süspansiyon',4),(N'elektrik',N'Elektrik',5),(N'klima',N'Klima',6),
    (N'sanziman',N'Şanzıman',7),(N'lastik',N'Lastik',8),(N'kaporta',N'Kaporta',9),(N'genel',N'Genel',10);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_payment_methods)
    INSERT INTO dbo.ref_payment_methods (code, label, sort_order) VALUES
    (N'nakit',N'Nakit',1),(N'kart',N'Kart',2),(N'havale',N'Havale',3),(N'diger',N'Diğer',4);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_user_roles)
    INSERT INTO dbo.ref_user_roles (code, label, description, is_platform_role) VALUES
    (N'super_admin',N'Platform Yöneticisi',N'Tüm servisleri yönetir',1),
    (N'admin',N'Servis Yöneticisi',N'Servis içi tüm yetkiler',0),
    (N'usta',N'Usta',N'İş emri ve servis işlemleri',0),
    (N'personel',N'Personel',N'Kayıt ve temel işlemler',0);

IF NOT EXISTS (SELECT 1 FROM dbo.ref_customer_types)
    INSERT INTO dbo.ref_customer_types (code, label) VALUES
    (N'bireysel',N'Bireysel'),(N'kurumsal',N'Kurumsal');

IF NOT EXISTS (SELECT 1 FROM dbo.ref_appointment_status)
    INSERT INTO dbo.ref_appointment_status (code, label, sort_order) VALUES
    (N'bekliyor',N'Bekliyor',1),(N'onaylandi',N'Onaylandı',2),
    (N'tamamlandi',N'Tamamlandı',3),(N'iptal',N'İptal',4);
GO

/* ==========================================================================
   TENANT = SERVİS (shops)
   Her kayıt bağımsız bir oto servis işletmesidir.
   ========================================================================== */
IF OBJECT_ID(N'dbo.shops', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.shops (
        id               uniqueidentifier NOT NULL CONSTRAINT DF_shops_id DEFAULT NEWID(),
        tenant_code      nvarchar(20)     NOT NULL,          -- OTO-IST, OTO-ANK
        slug             nvarchar(50)     NOT NULL,          -- otoservis-istanbul (subdomain)
        name             nvarchar(200)    NOT NULL,
        legal_name       nvarchar(200)    NULL,
        tax_no           nvarchar(20)     NULL,
        tax_office       nvarchar(100)    NULL,
        phone            nvarchar(30)     NULL,
        email            nvarchar(150)    NULL,
        address          nvarchar(500)    NULL,
        city             nvarchar(60)     NULL,
        district         nvarchar(60)     NULL,
        logo_url         nvarchar(500)    NULL,
        subscription_plan nvarchar(20)    NOT NULL CONSTRAINT DF_shops_plan DEFAULT N'standard',
        default_vat_rate decimal(5,2)     NOT NULL CONSTRAINT DF_shops_vat DEFAULT 20.00,
        currency         nvarchar(3)      NOT NULL CONSTRAINT DF_shops_currency DEFAULT N'TRY',
        timezone         nvarchar(50)     NOT NULL CONSTRAINT DF_shops_tz DEFAULT N'Europe/Istanbul',
        is_active        bit              NOT NULL CONSTRAINT DF_shops_active DEFAULT 1,
        created_at       datetime2(0)     NOT NULL CONSTRAINT DF_shops_created DEFAULT SYSUTCDATETIME(),
        updated_at       datetime2(0)     NOT NULL CONSTRAINT DF_shops_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_shops PRIMARY KEY (id),
        CONSTRAINT UQ_shops_tenant_code UNIQUE (tenant_code),
        CONSTRAINT UQ_shops_slug UNIQUE (slug),
        CONSTRAINT FK_shops_plan FOREIGN KEY (subscription_plan) REFERENCES dbo.ref_subscription_plans(code),
        CONSTRAINT CK_shops_vat CHECK (default_vat_rate BETWEEN 0 AND 100)
    );
    CREATE INDEX IX_shops_active ON dbo.shops(is_active) WHERE is_active = 1;
END
GO

/* Tenant bazlı sıra numaraları (iş emri, fatura — her servis kendi sayacı) */
IF OBJECT_ID(N'dbo.tenant_counters', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tenant_counters (
        shop_id      uniqueidentifier NOT NULL,
        counter_name nvarchar(30)     NOT NULL,
        last_value   bigint           NOT NULL CONSTRAINT DF_tc_value DEFAULT 0,
        CONSTRAINT PK_tenant_counters PRIMARY KEY (shop_id, counter_name),
        CONSTRAINT FK_tc_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id) ON DELETE CASCADE
    );
END
GO

/* ==========================================================================
   KULLANICILAR (platform kimliği — tenant'tan bağımsız hesap)
   Bir kullanıcı birden fazla servise shop_users ile bağlanabilir.
   ========================================================================== */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id              uniqueidentifier NOT NULL CONSTRAINT DF_users_id DEFAULT NEWID(),
        username        nvarchar(50)     NULL,
        full_name       nvarchar(150)    NOT NULL,
        phone           nvarchar(30)     NOT NULL,
        email           nvarchar(150)    NULL,
        password_hash   nvarchar(128)    NOT NULL,
        default_shop_id uniqueidentifier NULL,             -- son seçilen / varsayılan servis
        session_id      uniqueidentifier NULL,             -- aktif mobil oturum (tek cihaz)
        is_active       bit              NOT NULL CONSTRAINT DF_users_active DEFAULT 1,
        last_login_at   datetime2(0)     NULL,
        created_at      datetime2(0)     NOT NULL CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME(),
        updated_at      datetime2(0)     NOT NULL CONSTRAINT DF_users_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_users PRIMARY KEY (id),
        CONSTRAINT UQ_users_phone UNIQUE (phone),
        CONSTRAINT FK_users_default_shop FOREIGN KEY (default_shop_id) REFERENCES dbo.shops(id) ON DELETE SET NULL,
        CONSTRAINT CK_users_username CHECK (username IS NULL OR LEN(username) >= 3)
    );
    CREATE UNIQUE INDEX UX_users_username ON dbo.users(username) WHERE username IS NOT NULL;
    CREATE UNIQUE INDEX UX_users_email ON dbo.users(email) WHERE email IS NOT NULL;
END
GO

/* ==========================================================================
   SHOP_USERS — kullanıcı ↔ servis üyeliği (tenant bazlı rol)
   ========================================================================== */
IF OBJECT_ID(N'dbo.shop_users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.shop_users (
        id         uniqueidentifier NOT NULL CONSTRAINT DF_su_id DEFAULT NEWID(),
        shop_id    uniqueidentifier NOT NULL,
        user_id    uniqueidentifier NOT NULL,
        role       nvarchar(20)     NOT NULL CONSTRAINT DF_su_role DEFAULT N'personel',
        title      nvarchar(80)     NULL,
        is_owner   bit              NOT NULL CONSTRAINT DF_su_owner DEFAULT 0,
        is_active  bit              NOT NULL CONSTRAINT DF_su_active DEFAULT 1,
        joined_at  datetime2(0)     NOT NULL CONSTRAINT DF_su_joined DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_shop_users PRIMARY KEY (id),
        CONSTRAINT UQ_shop_users UNIQUE (shop_id, user_id),
        CONSTRAINT FK_su_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id) ON DELETE CASCADE,
        CONSTRAINT FK_su_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE,
        CONSTRAINT FK_su_role FOREIGN KEY (role) REFERENCES dbo.ref_user_roles(code)
    );
    CREATE INDEX IX_su_user ON dbo.shop_users(user_id);
    CREATE INDEX IX_su_shop ON dbo.shop_users(shop_id);
END
GO

/* ==========================================================================
   MÜŞTERİLER (tenant kapsamında)
   ========================================================================== */
IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.customers (
        id            uniqueidentifier NOT NULL CONSTRAINT DF_customers_id DEFAULT NEWID(),
        shop_id       uniqueidentifier NOT NULL,
        customer_type nvarchar(20)     NOT NULL CONSTRAINT DF_customers_type DEFAULT N'bireysel',
        full_name     nvarchar(150)    NOT NULL,
        company_name  nvarchar(200)    NULL,
        phone         nvarchar(30)     NOT NULL,
        phone2        nvarchar(30)     NULL,
        email         nvarchar(150)    NULL,
        tc_no         nvarchar(11)     NULL,
        tax_no        nvarchar(20)     NULL,
        address       nvarchar(400)    NULL,
        city          nvarchar(60)     NULL,
        district      nvarchar(60)     NULL,
        notes         nvarchar(1000)   NULL,
        is_active     bit              NOT NULL CONSTRAINT DF_customers_active DEFAULT 1,
        created_by    uniqueidentifier NULL,
        created_at    datetime2(0)     NOT NULL CONSTRAINT DF_customers_created DEFAULT SYSUTCDATETIME(),
        updated_at    datetime2(0)     NOT NULL CONSTRAINT DF_customers_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_customers PRIMARY KEY (id),
        CONSTRAINT FK_customers_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_customers_type FOREIGN KEY (customer_type) REFERENCES dbo.ref_customer_types(code),
        CONSTRAINT FK_customers_created_by FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
    CREATE UNIQUE INDEX UX_customers_phone ON dbo.customers(shop_id, phone);
    CREATE INDEX IX_customers_shop ON dbo.customers(shop_id);
    CREATE INDEX IX_customers_name ON dbo.customers(full_name);
END
GO

/* Araç marka/model — platform geneli paylaşımlı referans */
IF OBJECT_ID(N'dbo.vehicle_brands', N'U') IS NULL
    CREATE TABLE dbo.vehicle_brands (
        id uniqueidentifier NOT NULL CONSTRAINT DF_vbrands_id DEFAULT NEWID(),
        name nvarchar(60) NOT NULL, is_active bit NOT NULL DEFAULT 1,
        CONSTRAINT PK_vehicle_brands PRIMARY KEY (id), CONSTRAINT UQ_vehicle_brands_name UNIQUE (name)
    );
GO

IF OBJECT_ID(N'dbo.vehicle_models', N'U') IS NULL
    CREATE TABLE dbo.vehicle_models (
        id uniqueidentifier NOT NULL CONSTRAINT DF_vmodels_id DEFAULT NEWID(),
        brand_id uniqueidentifier NOT NULL, name nvarchar(80) NOT NULL, is_active bit NOT NULL DEFAULT 1,
        CONSTRAINT PK_vehicle_models PRIMARY KEY (id),
        CONSTRAINT FK_vmodels_brand FOREIGN KEY (brand_id) REFERENCES dbo.vehicle_brands(id),
        CONSTRAINT UQ_vehicle_models UNIQUE (brand_id, name)
    );
GO

/* ==========================================================================
   ARAÇLAR (tenant kapsamında — plaka servis içinde benzersiz)
   ========================================================================== */
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
END
GO

/* ==========================================================================
   SERVİS KATALOĞU (tenant'a özel işçilik adları)
   ========================================================================== */
IF OBJECT_ID(N'dbo.service_catalog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_catalog (
        id                uniqueidentifier NOT NULL CONSTRAINT DF_svccat_id DEFAULT NEWID(),
        shop_id           uniqueidentifier NOT NULL,
        code              nvarchar(30)     NULL,
        name              nvarchar(200)    NOT NULL,
        category          nvarchar(20)     NOT NULL CONSTRAINT DF_svccat_cat DEFAULT N'genel',
        description       nvarchar(500)    NULL,
        default_price     decimal(12,2)    NOT NULL CONSTRAINT DF_svccat_price DEFAULT 0,
        estimated_minutes int              NULL,
        is_active         bit              NOT NULL CONSTRAINT DF_svccat_active DEFAULT 1,
        sort_order        int              NOT NULL CONSTRAINT DF_svccat_sort DEFAULT 0,
        created_at        datetime2(0)     NOT NULL CONSTRAINT DF_svccat_created DEFAULT SYSUTCDATETIME(),
        updated_at        datetime2(0)     NOT NULL CONSTRAINT DF_svccat_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_service_catalog PRIMARY KEY (id),
        CONSTRAINT FK_svccat_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_svccat_category FOREIGN KEY (category) REFERENCES dbo.ref_service_categories(code),
        CONSTRAINT CK_svccat_price CHECK (default_price >= 0)
    );
    CREATE UNIQUE INDEX UX_svccat_name ON dbo.service_catalog(shop_id, name);
    CREATE UNIQUE INDEX UX_svccat_code ON dbo.service_catalog(shop_id, code) WHERE code IS NOT NULL;
    CREATE INDEX IX_svccat_shop ON dbo.service_catalog(shop_id);
END
GO

/* ==========================================================================
   TEDARİKÇİLER + STOK (tenant kapsamında)
   ========================================================================== */
IF OBJECT_ID(N'dbo.suppliers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.suppliers (
        id uniqueidentifier NOT NULL CONSTRAINT DF_suppliers_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        name nvarchar(200) NOT NULL, contact nvarchar(100) NULL,
        phone nvarchar(30) NULL, email nvarchar(150) NULL,
        is_active bit NOT NULL DEFAULT 1,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_suppliers PRIMARY KEY (id),
        CONSTRAINT FK_suppliers_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id)
    );
    CREATE INDEX IX_suppliers_shop ON dbo.suppliers(shop_id);
END
GO

IF OBJECT_ID(N'dbo.stock_products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stock_products (
        id uniqueidentifier NOT NULL CONSTRAINT DF_stock_id DEFAULT NEWID(),
        shop_id uniqueidentifier NOT NULL,
        supplier_id uniqueidentifier NULL,
        name nvarchar(200) NOT NULL,
        category nvarchar(20) NOT NULL CONSTRAINT DF_stock_cat DEFAULT N'diger',
        code nvarchar(50) NULL, barcode nvarchar(50) NULL,
        unit nvarchar(20) NOT NULL CONSTRAINT DF_stock_unit DEFAULT N'adet',
        purchase_price decimal(12,2) NULL,
        price decimal(12,2) NOT NULL CONSTRAINT DF_stock_price DEFAULT 0,
        quantity int NOT NULL CONSTRAINT DF_stock_qty DEFAULT 0,
        min_quantity int NOT NULL CONSTRAINT DF_stock_min DEFAULT 0,
        location nvarchar(80) NULL,
        is_active bit NOT NULL DEFAULT 1,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_stock_products PRIMARY KEY (id),
        CONSTRAINT FK_stock_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_stock_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.suppliers(id) ON DELETE SET NULL,
        CONSTRAINT FK_stock_category FOREIGN KEY (category) REFERENCES dbo.ref_stock_categories(code),
        CONSTRAINT CK_stock_price CHECK (price >= 0), CONSTRAINT CK_stock_qty CHECK (quantity >= 0)
    );
    CREATE UNIQUE INDEX UX_stock_code ON dbo.stock_products(shop_id, code) WHERE code IS NOT NULL;
    CREATE INDEX IX_stock_shop ON dbo.stock_products(shop_id);
END
GO

/* ==========================================================================
   RANDEVULAR + İŞ EMİRLERİ (tenant kapsamında)
   ========================================================================== */
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
        category nvarchar(30) NOT NULL CONSTRAINT DF_complaints_category DEFAULT N'diger',
        is_resolved bit NOT NULL DEFAULT 0,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_complaints PRIMARY KEY (id),
        CONSTRAINT FK_complaints_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id),
        CONSTRAINT FK_complaints_wo FOREIGN KEY (work_order_id) REFERENCES dbo.work_orders(id) ON DELETE CASCADE,
        CONSTRAINT CK_complaints_category CHECK (category IN (
            N'motor', N'fren', N'elektrik', N'klima', N'suspansiyon',
            N'kaporta', N'lastik', N'yag_bakim', N'diagnostik', N'istek', N'diger'
        ))
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

IF OBJECT_ID(N'dbo.audit_log', N'U') IS NULL
    CREATE TABLE dbo.audit_log (
        id bigint NOT NULL IDENTITY(1,1),
        shop_id uniqueidentifier NULL,
        user_id uniqueidentifier NULL,
        action nvarchar(50) NOT NULL,
        entity_type nvarchar(50) NOT NULL,
        entity_id uniqueidentifier NULL,
        old_values nvarchar(max) NULL, new_values nvarchar(max) NULL,
        ip_address nvarchar(45) NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_audit_log PRIMARY KEY (id),
        CONSTRAINT FK_audit_shop FOREIGN KEY (shop_id) REFERENCES dbo.shops(id) ON DELETE SET NULL,
        CONSTRAINT FK_audit_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
    );
    CREATE INDEX IX_audit_shop ON dbo.audit_log(shop_id, created_at DESC);
GO

/* updated_at tetikleyicileri */
DECLARE @tbl TABLE (t sysname, tr sysname);
INSERT INTO @tbl VALUES
(N'shops',N'trg_shops_upd'),(N'users',N'trg_users_upd'),(N'customers',N'trg_customers_upd'),
(N'vehicles',N'trg_vehicles_upd'),(N'service_catalog',N'trg_svccat_upd'),
(N'suppliers',N'trg_suppliers_upd'),(N'stock_products',N'trg_stock_upd'),
(N'appointments',N'trg_appt_upd'),(N'work_orders',N'trg_wo_upd');
DECLARE @t sysname, @tr sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT t, tr FROM @tbl;
OPEN c; FETCH NEXT FROM c INTO @t, @tr;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(N'dbo.'+@t, N'U') IS NOT NULL
    BEGIN
        SET @sql = N'IF OBJECT_ID(N''dbo.'+@tr+N''',N''TR'') IS NOT NULL DROP TRIGGER dbo.'+@tr;
        EXEC sp_executesql @sql;
        SET @sql = N'CREATE TRIGGER dbo.'+@tr+N' ON dbo.'+@t+N' AFTER UPDATE AS
        BEGIN SET NOCOUNT ON; UPDATE t SET updated_at=SYSUTCDATETIME() FROM dbo.'+@t+N' t INNER JOIN inserted i ON t.id=i.id; END';
        EXEC sp_executesql @sql;
    END
    FETCH NEXT FROM c INTO @t, @tr;
END
CLOSE c; DEALLOCATE c;
GO

IF OBJECT_ID(N'dbo.trg_wo_status_history', N'TR') IS NOT NULL DROP TRIGGER dbo.trg_wo_status_history;
GO
CREATE TRIGGER dbo.trg_wo_status_history ON dbo.work_orders AFTER UPDATE AS
BEGIN SET NOCOUNT ON;
    INSERT INTO dbo.work_order_status_history (id, work_order_id, shop_id, old_status, new_status, changed_at)
    SELECT NEWID(), i.id, i.shop_id, d.status, i.status, SYSUTCDATETIME()
    FROM inserted i INNER JOIN deleted d ON i.id=d.id WHERE i.status<>d.status;
END
GO

/* ==========================================================================
   STORED PROCEDURE'LER
   ========================================================================== */
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

/* ==========================================================================
   GÖRÜNÜMLER (tenant filtresi shop_id ile yapılır)
   ========================================================================== */
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

PRINT N'OtoServis multi-tenant şeması oluşturuldu.';
GO
