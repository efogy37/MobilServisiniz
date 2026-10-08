using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using OtoServis.Api.Models;

namespace OtoServis.Api.Services;

public class DataService(
    TenantService tenant,
    IWebHostEnvironment env,
    PlanEntitlementsService plans,
    IOptions<StorageOptions> storageOptions)
{
    private static readonly string[] AllowedImageTypes = ["ruhsat", "arac", "hasar", "diger"];
    private const long MaxImageBytes = 5 * 1024 * 1024;
    private const int MaxImagesPerWorkOrder = 8;

    private static readonly Dictionary<string, string> WORK_ORDER_STATUS_LABELS = new()
    {
        ["bekliyor"] = "Bekliyor",
        ["islemde"] = "İşlemde",
        ["tamamlandi"] = "Servis Tamamlandı",
        ["teslim_edildi"] = "Teslim Edildi",
        ["odeme_tamamlandi"] = "Ödeme Tamamlandı",
    };

    private static readonly Dictionary<string, string> PAY_METHOD_LABELS = new()
    {
        ["nakit"] = "Nakit",
        ["kart"] = "Kart",
        ["havale"] = "Havale",
        ["diger"] = "Diğer",
    };

    private string UploadsRoot =>
        storageOptions.Value.ResolveUploads(env.ContentRootPath);

    private string PhysicalFromRelative(string relPath)
    {
        var normalized = relPath.Replace('/', Path.DirectorySeparatorChar)
            .TrimStart(Path.DirectorySeparatorChar);
        const string prefix = "uploads";
        if (normalized.StartsWith(prefix + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || normalized.Equals(prefix, StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized.Length <= prefix.Length
                ? ""
                : normalized[(prefix.Length + 1)..];
        }
        return Path.Combine(UploadsRoot, normalized);
    }

    private sealed record WoContext(Guid CustomerId, Guid VehicleId, string Plate);

    /// <summary>İş emrinin bağlı olduğu müşteri/araç/plaka bilgisini getirir (aktivite loglamak için).</summary>
    private static async Task<WoContext?> GetWorkOrderContextAsync(SqlConnection conn, Guid woId, Guid shopId)
    {
        return await conn.QuerySingleOrDefaultAsync<WoContext>(
            @"SELECT wo.customer_id AS CustomerId, wo.vehicle_id AS VehicleId, v.plate AS Plate
              FROM dbo.work_orders wo
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              WHERE wo.id = @woId AND wo.shop_id = @shopId",
            new { woId, shopId });
    }

    /// <summary>Bir müşterinin (veya tedarikçinin) tüm aktivite geçmişini getirir — en yeni önce.</summary>
    public async Task<IReadOnlyList<ActivityLogEntryDto>> GetCustomerActivityAsync(Guid customerId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.customers WHERE id=@customerId AND shop_id=@shopId",
            new { customerId, shopId });
        if (exists == 0) return [];

        var rows = await conn.QueryAsync<ActivityLogEntryDto>(
            @"SELECT a.id AS Id, a.action AS Action, a.entity_type AS EntityType,
                     ISNULL(a.description, a.action) AS Description,
                     u.full_name AS UserName, a.created_at AS CreatedAt
              FROM dbo.audit_log a
              LEFT JOIN dbo.users u ON u.id = a.user_id
              WHERE a.shop_id = @shopId AND a.customer_id = @customerId
              ORDER BY a.created_at DESC, a.id DESC",
            new { shopId, customerId });
        return rows.ToList();
    }

    public async Task<DashboardDto?> GetDashboardAsync()
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var dash = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT waiting AS Waiting, in_progress AS InProgress, customers AS Customers,
                     vehicles AS Vehicles, staff_count AS StaffCount, low_stock AS LowStock
              FROM dbo.vw_ShopDashboard WHERE shop_id = @shopId",
            new { shopId });
        if (dash is null) return null;

        // Türkiye takvim ayı (UTC+3) → UTC penceresi; cash-today ile aynı gün sınırı.
        var turkeyNow = DateTime.UtcNow.AddHours(3);
        var turkeyMonthStart = new DateOnly(turkeyNow.Year, turkeyNow.Month, 1);
        var monthStartUtc = turkeyMonthStart.ToDateTime(TimeOnly.MinValue).AddHours(-3);
        var month = await conn.QuerySingleAsync<dynamic>(
            @"SELECT
                (SELECT COUNT(DISTINCT wo.vehicle_id) FROM dbo.work_orders wo
                 WHERE wo.shop_id = @shopId AND wo.opened_at >= @monthStartUtc) AS VehiclesServiced,
                ((SELECT COUNT(*) FROM dbo.services s WHERE s.shop_id = @shopId AND s.created_at >= @monthStartUtc) +
                 (SELECT COUNT(*) FROM dbo.work_order_parts p WHERE p.shop_id = @shopId AND p.created_at >= @monthStartUtc)
                ) AS Operations",
            new { shopId, monthStartUtc });

        return new DashboardDto(
            (int)dash.Waiting, (int)dash.InProgress, (int)dash.Customers, (int)dash.Vehicles,
            (int)dash.StaffCount, (int)dash.LowStock, (int)month.VehiclesServiced, (int)month.Operations);
    }

    public async Task<IReadOnlyList<CustomerDto>> GetCustomersAsync(string? search = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var sql = @"SELECT c.id AS Id, c.customer_type AS CustomerType, c.full_name AS FullName,
                           c.company_name AS CompanyName, c.phone AS Phone, c.email AS Email,
                           c.address AS Address, c.city AS City, c.is_supplier AS IsSupplier, c.is_customer AS IsCustomer,
                           c.tax_no AS TaxNo, c.opening_balance AS OpeningBalance,
                           CASE WHEN c.is_customer = 1 THEN ISNULL(cb.balance, 0) ELSE NULL END AS Balance,
                           CASE WHEN c.is_supplier = 1 THEN ISNULL(sb.balance, c.opening_balance) ELSE NULL END AS SupplierBalance
                    FROM dbo.customers c
                    LEFT JOIN dbo.vw_CustomerBalance cb ON cb.customer_id = c.id AND cb.shop_id = c.shop_id
                    LEFT JOIN dbo.vw_SupplierBalance sb ON sb.supplier_id = c.id AND sb.shop_id = c.shop_id
                    WHERE c.shop_id = @shopId AND c.is_active = 1 AND (c.is_customer = 1 OR c.is_supplier = 1)";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (c.full_name LIKE @q OR c.phone LIKE @q)";
        sql += " ORDER BY c.full_name";
        var rows = await conn.QueryAsync<CustomerDto>(sql,
            new { shopId, q = $"%{search?.Trim()}%" });
        return rows.ToList();
    }

    private async Task<CustomerDto?> GetCustomerByIdAsync(SqlConnection conn, Guid id, Guid shopId)
    {
        return await conn.QuerySingleOrDefaultAsync<CustomerDto>(
            @"SELECT c.id AS Id, c.customer_type AS CustomerType, c.full_name AS FullName,
                     c.company_name AS CompanyName, c.phone AS Phone, c.email AS Email,
                     c.address AS Address, c.city AS City, c.is_supplier AS IsSupplier, c.is_customer AS IsCustomer,
                     c.tax_no AS TaxNo, c.opening_balance AS OpeningBalance,
                     CASE WHEN c.is_customer = 1 THEN ISNULL(cb.balance, 0) ELSE NULL END AS Balance,
                     CASE WHEN c.is_supplier = 1 THEN ISNULL(sb.balance, c.opening_balance) ELSE NULL END AS SupplierBalance
              FROM dbo.customers c
              LEFT JOIN dbo.vw_CustomerBalance cb ON cb.customer_id = c.id AND cb.shop_id = c.shop_id
              LEFT JOIN dbo.vw_SupplierBalance sb ON sb.supplier_id = c.id AND sb.shop_id = c.shop_id
              WHERE c.id = @id AND c.shop_id = @shopId",
            new { id, shopId });
    }

    public async Task<CustomerDto?> CreateCustomerAsync(CreateCustomerRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        if (req.IsSupplier)
            await plans.RequireFeatureAsync("suppliers");
        var id = Guid.NewGuid();
        await using var conn = await tenant.OpenAsync();
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.customers (id, shop_id, customer_type, full_name, company_name, phone, email, address, city, tax_no, opening_balance, is_supplier, is_customer, created_by)
                  VALUES (@id, @shopId, @CustomerType, @FullName, @CompanyName, @Phone, @Email, @Address, @City, @TaxNo, @OpeningBalance, @IsSupplier, @IsCustomer, @userId)",
                new
                {
                    id, shopId, req.CustomerType, req.FullName, req.CompanyName, req.Phone, req.Email, req.Address,
                    req.City, TaxNo = req.TaxNo, OpeningBalance = req.OpeningBalance ?? 0, req.IsSupplier, req.IsCustomer, userId,
                });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            throw new CustomerPhoneConflictException();
        }
        var kind = req.IsSupplier ? "Tedarikçi" : "Müşteri";
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "created", "customer", id,
            $"{kind} kaydı oluşturuldu: {req.FullName}", customerId: id);
        return await GetCustomerByIdAsync(conn, id, shopId);
    }

    public async Task<IReadOnlyList<VehicleDto>> GetVehiclesAsync(string? status = null, string? search = null, Guid? customerId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var sql = @"
            SELECT v.id AS Id, v.customer_id AS CustomerId, c.full_name AS CustomerName,
                   v.plate AS Plate, v.brand AS Brand, v.model AS Model,
                   CAST(v.model_year AS int) AS ModelYear,
                   v.color AS Color, v.fuel AS Fuel, v.chassis_no AS ChassisNo,
                   v.engine_no AS EngineNo, v.engine_volume AS EngineVolume,
                   CAST(v.mileage AS int) AS Mileage,
                   cs.status AS Status
            FROM dbo.vehicles v
            INNER JOIN dbo.customers c ON c.id = v.customer_id
            LEFT JOIN dbo.vw_VehicleCurrentStatus cs ON cs.vehicle_id = v.id
            WHERE v.shop_id = @shopId AND v.is_active = 1";
        if (!string.IsNullOrWhiteSpace(status))
            sql += " AND cs.status = @status";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (v.plate LIKE @q OR c.full_name LIKE @q OR v.brand LIKE @q)";
        if (customerId.HasValue)
            sql += " AND v.customer_id = @customerId";
        sql += " ORDER BY v.created_at DESC";
        var rows = await conn.QueryAsync<VehicleDto>(sql, new { shopId, status, q = $"%{search?.Trim()}%", customerId });
        return rows.ToList();
    }

    private static string NormalizePlate(string plate) => plate.Trim().ToUpperInvariant().Replace(" ", "");

    private static readonly HashSet<string> FuelCodes = ["benzin", "dizel", "lpg", "elektrik", "hibrit", "diger"];

    private static string NormalizeFuel(string? fuel)
    {
        var x = (fuel ?? "").Trim().ToLowerInvariant().Replace("\u0307", "");
        if (FuelCodes.Contains(x)) return x;
        if (x.Contains("diz")) return "dizel";
        if (x.Contains("benz")) return "benzin";
        if (x.Contains("lpg")) return "lpg";
        if (x.Contains("elek")) return "elektrik";
        if (x.Contains("hib")) return "hibrit";
        return "diger";
    }

    private async Task<VehicleConflictDto?> FindPlateConflictAsync(
        SqlConnection conn, Guid shopId, string plateNorm, Guid? excludeVehicleId = null)
    {
        return await conn.QuerySingleOrDefaultAsync<VehicleConflictDto>(
            @"SELECT TOP 1 v.id AS VehicleId, v.customer_id AS CustomerId, c.full_name AS CustomerName,
                     v.brand AS Brand, v.model AS Model
              FROM dbo.vehicles v
              INNER JOIN dbo.customers c ON c.id = v.customer_id
              WHERE v.shop_id = @shopId AND v.plate_norm = @plateNorm AND v.is_active = 1
                AND (@excludeVehicleId IS NULL OR v.id <> @excludeVehicleId)",
            new { shopId, plateNorm, excludeVehicleId });
    }

    private async Task<VehicleDto?> GetVehicleByIdAsync(SqlConnection conn, Guid id, Guid shopId)
    {
        return await conn.QuerySingleOrDefaultAsync<VehicleDto>(
            @"SELECT v.id AS Id, v.customer_id AS CustomerId, c.full_name AS CustomerName,
                     v.plate AS Plate, v.brand AS Brand, v.model AS Model,
                     CAST(v.model_year AS int) AS ModelYear,
                     v.color AS Color, v.fuel AS Fuel, v.chassis_no AS ChassisNo,
                     v.engine_no AS EngineNo, v.engine_volume AS EngineVolume,
                     CAST(v.mileage AS int) AS Mileage,
                     cs.status AS Status
              FROM dbo.vehicles v
              INNER JOIN dbo.customers c ON c.id = v.customer_id
              LEFT JOIN dbo.vw_VehicleCurrentStatus cs ON cs.vehicle_id = v.id
              WHERE v.id = @id AND v.shop_id = @shopId AND v.is_active = 1",
            new { id, shopId });
    }

    public async Task<CreateVehicleResponse?> CreateVehicleAsync(CreateVehicleRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await plans.EnsureWorkOrderQuotaAsync();
        var vehicleId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        var plateNorm = NormalizePlate(req.Plate);

        await using var conn = await tenant.OpenAsync();

        var conflict = await FindPlateConflictAsync(conn, shopId, plateNorm);
        if (conflict is not null && conflict.CustomerId != req.CustomerId)
            throw new VehiclePlateConflictException(conflict);

        await using var tx = await conn.BeginTransactionAsync();
        Guid woId;
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.vehicles (id, shop_id, customer_id, plate, brand, model, model_year, color, fuel, chassis_no, engine_no, engine_volume, mileage)
                  VALUES (@vehicleId, @shopId, @CustomerId, @Plate, @Brand, @Model, @ModelYear, @Color, @Fuel, @ChassisNo, @EngineNo, @EngineVolume, @Mileage)",
                new
                {
                    vehicleId,
                    shopId,
                    req.CustomerId,
                    Plate = req.Plate.Trim().ToUpperInvariant(),
                    req.Brand,
                    req.Model,
                    req.ModelYear,
                    req.Color,
                    req.Fuel,
                    ChassisNo = req.ChassisNo?.Trim().ToUpperInvariant(),
                    req.EngineNo,
                    req.EngineVolume,
                    req.Mileage,
                },
                tx);

            var orderNo = await conn.ExecuteScalarAsync<long>(
                "DECLARE @n bigint; EXEC dbo.usp_NextTenantCounter @shopId, N'work_order_no', @n OUTPUT; SELECT @n",
                new { shopId }, tx);

            woId = Guid.NewGuid();
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.work_orders (id, shop_id, order_no, vehicle_id, customer_id, opened_by, status, mileage_in, opened_at)
                  VALUES (@woId, @shopId, @orderNo, @vehicleId, @CustomerId, @userId, N'bekliyor', @Mileage, @now)",
                new { woId, shopId, orderNo, vehicleId, req.CustomerId, userId, req.Mileage, now }, tx);

            if (!string.IsNullOrWhiteSpace(req.Complaint))
            {
                var cat = NormalizeComplaintCategory(req.ComplaintCategory);
                await conn.ExecuteAsync(
                    @"INSERT INTO dbo.complaints (shop_id, work_order_id, description, category, created_at)
                      VALUES (@shopId, @woId, @Complaint, @cat, @now)",
                    new { shopId, woId, Complaint = req.Complaint, cat, now }, tx);
            }

            await tx.CommitAsync();
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            await tx.RollbackAsync();
            var raceConflict = await FindPlateConflictAsync(conn, shopId, plateNorm);
            if (raceConflict is not null)
                throw new VehiclePlateConflictException(raceConflict);
            throw;
        }

        var vehicle = (await GetVehiclesAsync()).FirstOrDefault(v => v.Id == vehicleId);

        await ActivityLogService.LogAsync(
            conn, shopId, userId, "created", "vehicle", vehicleId,
            $"Araç eklendi: {req.Plate.Trim().ToUpperInvariant()} ({req.Brand} {req.Model}) — yeni iş emri açıldı",
            customerId: req.CustomerId, vehicleId: vehicleId);

        return vehicle is null ? null : new CreateVehicleResponse(vehicleId, woId, vehicle);
    }

    public async Task<VehicleDto?> UpdateVehicleAsync(Guid id, UpdateVehicleRequest req, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        var plate = req.Plate.Trim().ToUpperInvariant();
        var plateNorm = NormalizePlate(plate);
        var fuel = NormalizeFuel(req.Fuel);
        int? year = req.ModelYear is >= 1900 and <= 2100 ? req.ModelYear : null;
        int? mileage = req.Mileage is >= 0 ? req.Mileage : null;

        await using var conn = await tenant.OpenAsync();

        var existing = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT customer_id AS CustomerId, plate AS Plate FROM dbo.vehicles WHERE id=@id AND shop_id=@shopId AND is_active=1",
            new { id, shopId });
        if (existing is null) return null;
        Guid customerId = existing.CustomerId;

        var conflict = await FindPlateConflictAsync(conn, shopId, plateNorm, id);
        if (conflict is not null)
            throw new VehiclePlateConflictException(conflict);

        try
        {
            var n = await conn.ExecuteAsync(
                @"UPDATE dbo.vehicles SET
                    plate = @Plate, brand = @Brand, model = @Model,
                    model_year = @Year, color = @Color, fuel = @Fuel,
                    chassis_no = @ChassisNo, engine_no = @EngineNo,
                    engine_volume = @EngineVolume, mileage = @Mileage,
                    updated_at = SYSUTCDATETIME()
                  WHERE id = @id AND shop_id = @shopId AND is_active = 1",
                new
                {
                    id,
                    shopId,
                    Plate = plate,
                    Brand = req.Brand.Trim(),
                    Model = req.Model.Trim(),
                    Year = year,
                    Color = string.IsNullOrWhiteSpace(req.Color) ? null : req.Color.Trim(),
                    Fuel = fuel,
                    ChassisNo = string.IsNullOrWhiteSpace(req.ChassisNo) ? null : req.ChassisNo.Trim().ToUpperInvariant(),
                    EngineNo = string.IsNullOrWhiteSpace(req.EngineNo) ? null : req.EngineNo.Trim(),
                    EngineVolume = string.IsNullOrWhiteSpace(req.EngineVolume) ? null : req.EngineVolume.Trim(),
                    Mileage = mileage,
                });
            if (n == 0) return null;
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            var raceConflict = await FindPlateConflictAsync(conn, shopId, plateNorm, id);
            if (raceConflict is not null)
                throw new VehiclePlateConflictException(raceConflict);
            throw;
        }

        await ActivityLogService.LogAsync(
            conn, shopId, userId, "updated", "vehicle", id,
            $"Araç bilgileri güncellendi: {plate} ({req.Brand.Trim()} {req.Model.Trim()})",
            customerId: customerId, vehicleId: id);

        return await GetVehicleByIdAsync(conn, id, shopId);
    }

    public async Task<TransferVehicleResponse?> TransferVehicleOwnerAsync(Guid vehicleId, TransferVehicleRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await plans.EnsureWorkOrderQuotaAsync();
        var now = DateTime.UtcNow;

        await using var conn = await tenant.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var vehicle = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT mileage, customer_id, plate FROM dbo.vehicles WHERE id=@vehicleId AND shop_id=@shopId AND is_active=1",
            new { vehicleId, shopId }, tx);
        if (vehicle is null)
        {
            await tx.RollbackAsync();
            return null;
        }
        Guid oldCustomerId = vehicle.customer_id;
        string plate = vehicle.plate;

        var newCustomerName = await conn.ExecuteScalarAsync<string?>(
            "SELECT full_name FROM dbo.customers WHERE id=@NewCustomerId AND shop_id=@shopId AND is_active=1",
            new { req.NewCustomerId, shopId }, tx);
        if (newCustomerName is null)
        {
            await tx.RollbackAsync();
            return null;
        }
        var oldCustomerName = await conn.ExecuteScalarAsync<string?>(
            "SELECT full_name FROM dbo.customers WHERE id=@oldCustomerId AND shop_id=@shopId",
            new { oldCustomerId, shopId }, tx);

        await conn.ExecuteAsync(
            @"UPDATE dbo.vehicles SET customer_id=@NewCustomerId, updated_at=SYSUTCDATETIME()
              WHERE id=@vehicleId AND shop_id=@shopId AND is_active=1",
            new { req.NewCustomerId, vehicleId, shopId }, tx);

        var orderNo = await conn.ExecuteScalarAsync<long>(
            "DECLARE @n bigint; EXEC dbo.usp_NextTenantCounter @shopId, N'work_order_no', @n OUTPUT; SELECT @n",
            new { shopId }, tx);

        int? mileage = vehicle.mileage;
        var woId = Guid.NewGuid();
        await conn.ExecuteAsync(
            @"INSERT INTO dbo.work_orders (id, shop_id, order_no, vehicle_id, customer_id, opened_by, status, mileage_in, opened_at)
              VALUES (@woId, @shopId, @orderNo, @vehicleId, @NewCustomerId, @userId, N'bekliyor', @mileage, @now)",
            new { woId, shopId, orderNo, vehicleId, req.NewCustomerId, userId, mileage, now }, tx);

        if (!string.IsNullOrWhiteSpace(req.Complaint))
        {
            var cat = NormalizeComplaintCategory(req.ComplaintCategory);
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.complaints (shop_id, work_order_id, description, category, created_at)
                  VALUES (@shopId, @woId, @Complaint, @cat, @now)",
                new { shopId, woId, req.Complaint, cat, now }, tx);
        }

        await tx.CommitAsync();

        await ActivityLogService.LogAsync(
            conn, shopId, userId, "transferred", "vehicle", vehicleId,
            $"Araç devredildi: {plate} → {newCustomerName}",
            customerId: oldCustomerId, vehicleId: vehicleId);
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "transferred", "vehicle", vehicleId,
            $"Araç devralındı: {plate} ({oldCustomerName ?? "önceki sahip"} müşterisinden) — yeni iş emri açıldı",
            customerId: req.NewCustomerId, vehicleId: vehicleId);

        return new TransferVehicleResponse(vehicleId, woId);
    }

    public async Task<CustomerDto?> UpdateCustomerAsync(Guid id, UpdateCustomerRequest req, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        if (req.IsSupplier)
            await plans.RequireFeatureAsync("suppliers");
        await using var conn = await tenant.OpenAsync();
        int n;
        try
        {
            n = await conn.ExecuteAsync(
                @"UPDATE dbo.customers SET customer_type=@CustomerType, full_name=@FullName, company_name=@CompanyName,
                  phone=@Phone, email=@Email, address=@Address, city=@City, is_supplier=@IsSupplier, is_customer=@IsCustomer,
                  tax_no=@TaxNo,
                  opening_balance = CASE WHEN @OpeningBalance IS NOT NULL THEN @OpeningBalance ELSE opening_balance END,
                  updated_at=SYSUTCDATETIME()
                  WHERE id=@id AND shop_id=@shopId AND is_active=1",
                new
                {
                    id,
                    shopId,
                    req.CustomerType,
                    req.FullName,
                    req.CompanyName,
                    req.Phone,
                    req.Email,
                    req.Address,
                    req.City,
                    req.IsSupplier,
                    req.IsCustomer,
                    TaxNo = req.TaxNo,
                    OpeningBalance = req.OpeningBalance,
                });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            throw new CustomerPhoneConflictException();
        }
        if (n == 0) return null;
        var kind = req.IsSupplier ? "Tedarikçi" : "Müşteri";
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "updated", "customer", id,
            $"{kind} bilgileri güncellendi: {req.FullName}", customerId: id);
        return await GetCustomerByIdAsync(conn, id, shopId);
    }

    public async Task<StockProductDto?> CreateStockAsync(CreateStockRequest req)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        var id = Guid.NewGuid();
        await using var conn = await tenant.OpenAsync();
        await conn.ExecuteAsync(
            @"INSERT INTO dbo.stock_products (id, shop_id, name, category, code, price, purchase_price, quantity, min_quantity)
              VALUES (@id, @shopId, @Name, @Category, @Code, @Price, @PurchasePrice, @Quantity, @MinQuantity)",
            new
            {
                id, shopId, req.Name, req.Category, req.Code, req.Price,
                PurchasePrice = req.PurchasePrice, req.Quantity, req.MinQuantity,
            });
        return (await GetStockAsync()).FirstOrDefault(s => s.Id == id);
    }

    public async Task<StockProductDto?> UpdateStockAsync(Guid id, UpdateStockRequest req)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.stock_products SET name=@Name, category=@Category, code=@Code,
              price=@Price, purchase_price=@PurchasePrice, quantity=@Quantity, min_quantity=@MinQuantity,
              updated_at=SYSUTCDATETIME()
              WHERE id=@id AND shop_id=@shopId AND is_active=1",
            new
            {
                id, shopId, req.Name, req.Category, req.Code, req.Price,
                PurchasePrice = req.PurchasePrice, req.Quantity, req.MinQuantity,
            });
        if (n == 0) return null;
        return (await GetStockAsync()).FirstOrDefault(s => s.Id == id);
    }

    /// <summary>
    /// Stok kaydını siler. Ürün herhangi bir stok hareketinde (alış/kullanım) veya
    /// bir iş emri parçasında geçtiyse silmeyi reddeder (StockInUseException).
    /// </summary>
    public async Task<bool?> DeleteStockAsync(Guid id)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        await using var conn = await tenant.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.stock_products WHERE id=@id AND shop_id=@shopId AND is_active=1",
            new { id, shopId });
        if (exists == 0) return null;

        var used = await conn.ExecuteScalarAsync<int>(
            @"SELECT
                (SELECT COUNT(1) FROM dbo.stock_movements WHERE stock_product_id=@id AND shop_id=@shopId)
              + (SELECT COUNT(1) FROM dbo.work_order_parts WHERE stock_product_id=@id AND shop_id=@shopId)",
            new { id, shopId });
        if (used > 0)
            throw new StockInUseException();

        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.stock_products SET is_active=0, updated_at=SYSUTCDATETIME()
              WHERE id=@id AND shop_id=@shopId",
            new { id, shopId });
        return n > 0;
    }

    public async Task<ImportPurchaseResponse> ImportPurchaseAsync(ImportPurchaseRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        await plans.RequireFeatureAsync("suppliers");
        if (req.Lines is null || req.Lines.Count == 0)
            throw new ArgumentException("En az bir ürün satırı gerekli.");

        await using var conn = await tenant.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var supplierOk = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(1) FROM dbo.customers
              WHERE id=@id AND shop_id=@shopId AND is_active=1 AND is_supplier=1",
            new { id = req.SupplierId, shopId }, tx);
        if (supplierOk == 0)
            throw new ArgumentException("Tedarikçi bulunamadı.");

        var created = 0;
        var updated = 0;
        decimal total = 0;

        foreach (var line in req.Lines)
        {
            if (string.IsNullOrWhiteSpace(line.Name) || line.Quantity <= 0 || line.UnitPrice < 0)
                continue;

            var name = line.Name.Trim();
            var category = string.IsNullOrWhiteSpace(line.Category) ? "diger" : line.Category.Trim();
            var sale = line.SalePrice ?? line.UnitPrice;
            var lineTotal = line.UnitPrice * line.Quantity;
            total += lineTotal;

            var existingId = await conn.ExecuteScalarAsync<Guid?>(
                @"SELECT TOP 1 id
                  FROM dbo.stock_products
                  WHERE shop_id=@shopId AND is_active=1 AND LOWER(LTRIM(RTRIM(name)))=LOWER(@name)",
                new { shopId, name }, tx);

            if (existingId is Guid stockId)
            {
                await conn.ExecuteAsync(
                    @"UPDATE dbo.stock_products
                      SET quantity = quantity + @qty,
                          purchase_price = @purchase,
                          price = @sale,
                          supplier_id = @supplierId,
                          category = @category,
                          updated_at = SYSUTCDATETIME()
                      WHERE id=@id AND shop_id=@shopId",
                    new
                    {
                        id = stockId, shopId, qty = line.Quantity,
                        purchase = line.UnitPrice, sale, supplierId = req.SupplierId, category,
                    }, tx);
                await conn.ExecuteAsync(
                    @"INSERT INTO dbo.stock_movements (id, shop_id, stock_product_id, change_qty, movement_type, reason, created_by)
                      VALUES (NEWID(), @shopId, @stockId, @qty, N'giris', @reason, @userId)",
                    new
                    {
                        shopId, stockId, qty = line.Quantity, userId,
                        reason = $"PDF alım{(string.IsNullOrWhiteSpace(req.DocumentNo) ? "" : ": " + req.DocumentNo)}",
                    }, tx);
                updated++;
            }
            else
            {
                var id = Guid.NewGuid();
                await conn.ExecuteAsync(
                    @"INSERT INTO dbo.stock_products
                        (id, shop_id, supplier_id, name, category, code, price, purchase_price, quantity, min_quantity)
                      VALUES
                        (@id, @shopId, @supplierId, @name, @category, @code, @sale, @purchase, @qty, 0)",
                    new
                    {
                        id, shopId, supplierId = req.SupplierId, name, category,
                        code = string.IsNullOrWhiteSpace(line.Code) ? null : line.Code.Trim(),
                        sale, purchase = line.UnitPrice, qty = line.Quantity,
                    }, tx);
                await conn.ExecuteAsync(
                    @"INSERT INTO dbo.stock_movements (id, shop_id, stock_product_id, change_qty, movement_type, reason, created_by)
                      VALUES (NEWID(), @shopId, @stockId, @qty, N'giris', @reason, @userId)",
                    new
                    {
                        shopId, stockId = id, qty = line.Quantity, userId,
                        reason = $"PDF alım{(string.IsNullOrWhiteSpace(req.DocumentNo) ? "" : ": " + req.DocumentNo)}",
                    }, tx);
                created++;
            }
        }

        if (created + updated == 0)
            throw new ArgumentException("Geçerli ürün satırı yok.");

        var ledgerId = Guid.NewGuid();
        var desc = string.IsNullOrWhiteSpace(req.DocumentNo)
            ? $"PDF ile dışarıdan alım ({created + updated} kalem)"
            : $"PDF alım: {req.DocumentNo.Trim()} ({created + updated} kalem)";
        if (!string.IsNullOrWhiteSpace(req.DocumentDate))
            desc += $" · {req.DocumentDate.Trim()}";

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.supplier_transactions (id, shop_id, supplier_id, type, amount, description, created_by)
              VALUES (@ledgerId, @shopId, @supplierId, N'alis', @total, @desc, @userId)",
            new { ledgerId, shopId, supplierId = req.SupplierId, total, desc, userId }, tx);

        await tx.CommitAsync();
        return new ImportPurchaseResponse(created, updated, total, ledgerId);
    }

    public async Task<IReadOnlyList<WorkOrderDetailDto>> GetMobileVehiclesAsync()
    {
        var shopId = tenant.RequireShopId();
        var userId = tenant.RequireUserId();
        var seeAll = tenant.CanSeeAllWorkOrders();
        await using var conn = await tenant.OpenAsync();
        var sql = @"
            SELECT wo.id FROM dbo.work_orders wo
            INNER JOIN (
                SELECT vehicle_id, MAX(opened_at) AS max_opened
                FROM dbo.work_orders WHERE shop_id=@shopId GROUP BY vehicle_id
            ) latest ON latest.vehicle_id=wo.vehicle_id AND latest.max_opened=wo.opened_at
            WHERE wo.shop_id=@shopId";
        if (!seeAll)
        {
            // Yönetici dışı: kendine atanan + henüz atanmamış (bekleyen) işler
            sql += @" AND (
                wo.assigned_user_id = @userId
                OR (wo.assigned_user_id IS NULL AND wo.assigned_user_name IS NULL)
            )";
        }
        sql += " ORDER BY wo.opened_at DESC";

        var woIds = (await conn.QueryAsync<Guid>(sql, new { shopId, userId })).ToList();

        var list = new List<WorkOrderDetailDto>();
        foreach (var woId in woIds)
        {
            var d = await GetWorkOrderDetailAsync(woId);
            if (d is not null) list.Add(d);
        }
        return list;
    }

    public async Task<bool> UpdateServiceAsync(Guid woId, Guid serviceId, UpdateServiceRequest req, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.services SET title=@Title, price=@Price
              WHERE id=@serviceId AND work_order_id=@woId AND shop_id=@shopId",
            new { serviceId, woId, shopId, req.Title, req.Price });
        if (n > 0)
        {
            await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);
            var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
            if (ctx is not null)
                await ActivityLogService.LogAsync(
                    conn, shopId, userId, "updated", "service", serviceId,
                    $"İşçilik güncellendi: {req.Title} ({req.Price:0.##} ₺) — {ctx.Plate}",
                    customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
        }
        return n > 0;
    }

    public async Task<bool> DeleteServiceAsync(Guid woId, Guid serviceId, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var service = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT title, price FROM dbo.services WHERE id=@serviceId AND work_order_id=@woId AND shop_id=@shopId",
            new { serviceId, woId, shopId });
        var n = await conn.ExecuteAsync(
            "DELETE FROM dbo.services WHERE id=@serviceId AND work_order_id=@woId AND shop_id=@shopId",
            new { serviceId, woId, shopId });
        if (n > 0)
        {
            await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);
            if (service is not null)
            {
                var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
                if (ctx is not null)
                    await ActivityLogService.LogAsync(
                        conn, shopId, userId, "deleted", "service", serviceId,
                        $"İşçilik silindi: {(string)service.title} ({(decimal)service.price:0.##} ₺) — {ctx.Plate}",
                        customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
            }
        }
        return n > 0;
    }

    public async Task UpdatePartAsync(Guid woId, Guid partId, UpdatePartRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        // Alış fiyatını SP'den önce yaz: eski usp_UpdateWorkOrderPart @purchase_price
        // kabul etmez (8144 → HTTP 500); yeni SP (SQL17) NULL gelince DB'deki değeri kullanır.
        if (req.PurchasePrice.HasValue)
        {
            await conn.ExecuteAsync(
                @"UPDATE dbo.work_order_parts
                  SET purchase_price = @PurchasePrice
                  WHERE id = @partId AND work_order_id = @woId AND shop_id = @shopId
                    AND source = N'disaridan' AND returned_at IS NULL",
                new { req.PurchasePrice, partId, woId, shopId });

            // Eski SP amount=0 yazmaya çalışır → CK_suptx_amount ihlali; alış 0 ise cariyi temizle
            if (req.PurchasePrice.Value <= 0)
            {
                await conn.ExecuteAsync(
                    @"DELETE FROM dbo.supplier_transactions
                      WHERE work_order_part_id = @partId AND shop_id = @shopId AND type = N'alis'",
                    new { partId, shopId });
            }
        }

        await conn.ExecuteAsync(
            @"EXEC dbo.usp_UpdateWorkOrderPart
                @shop_id=@shopId,
                @work_order_id=@woId,
                @work_order_part_id=@partId,
                @name=@Name,
                @quantity=@Quantity,
                @unit_price=@UnitPrice,
                @created_by=@userId",
            new { shopId, woId, partId, req.Name, req.Quantity, req.UnitPrice, userId });

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);

        var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
        if (ctx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "updated", "part", partId,
                $"Ürün güncellendi: {req.Name} x{req.Quantity} — {ctx.Plate}",
                customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
    }

    public async Task DeletePartAsync(Guid woId, Guid partId, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var part = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT name, quantity FROM dbo.work_order_parts WHERE id=@partId AND work_order_id=@woId AND shop_id=@shopId",
            new { partId, woId, shopId });
        var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
        await conn.ExecuteAsync(
            @"EXEC dbo.usp_DeleteWorkOrderPart
                @shop_id=@shopId,
                @work_order_id=@woId,
                @work_order_part_id=@partId,
                @created_by=@userId",
            new { shopId, woId, partId, userId });

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);

        if (part is not null && ctx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "deleted", "part", partId,
                $"Ürün silindi: {(string)part.name} x{(int)part.quantity} — {ctx.Plate}",
                customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
    }

    public async Task<IReadOnlyList<ServiceCatalogDto>> GetServiceCatalogAsync()
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<ServiceCatalogDto>(
            @"SELECT id AS Id, code AS Code, name AS Name, category AS Category,
                     default_price AS DefaultPrice, estimated_minutes AS EstimatedMinutes
              FROM dbo.service_catalog WHERE shop_id = @shopId AND is_active = 1 ORDER BY sort_order",
            new { shopId });
        return rows.ToList();
    }

    public async Task<IReadOnlyList<StockProductDto>> GetStockAsync(string? category = null, string? search = null)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        await using var conn = await tenant.OpenAsync();
        var sql = @"SELECT id AS Id, name AS Name, category AS Category, code AS Code,
                           price AS Price, quantity AS Quantity, min_quantity AS MinQuantity,
                           purchase_price AS PurchasePrice
                    FROM dbo.stock_products WHERE shop_id = @shopId AND is_active = 1";
        if (!string.IsNullOrWhiteSpace(category))
            sql += " AND category = @category";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (name LIKE @q OR code LIKE @q)";
        sql += " ORDER BY name";
        var rows = await conn.QueryAsync<StockProductDto>(sql, new { shopId, category, q = $"%{search?.Trim()}%" });
        return rows.ToList();
    }

    public async Task<IReadOnlyList<WorkOrderDto>> GetWorkOrdersAsync(string? status = null)
    {
        var shopId = tenant.RequireShopId();
        var userId = tenant.RequireUserId();
        var seeAll = tenant.CanSeeAllWorkOrders();
        await using var conn = await tenant.OpenAsync();
        var sql = @"
            SELECT wo.id AS Id, wo.order_no AS OrderNo, wo.status AS Status,
                   v.plate AS Plate, c.full_name AS CustomerName, c.phone AS CustomerPhone,
                   wo.mileage_in AS MileageIn, t.grand_total AS GrandTotal, t.paid_total AS PaidTotal,
                   wo.opened_at AS OpenedAt
            FROM dbo.work_orders wo
            INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
            INNER JOIN dbo.customers c ON c.id = wo.customer_id
            LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
            WHERE wo.shop_id = @shopId";
        if (!seeAll)
        {
            sql += @" AND (
                wo.assigned_user_id = @userId
                OR (wo.assigned_user_id IS NULL AND wo.assigned_user_name IS NULL)
            )";
        }
        if (!string.IsNullOrWhiteSpace(status))
            sql += " AND wo.status = @status";
        sql += " ORDER BY wo.opened_at DESC";
        var rows = await conn.QueryAsync<WorkOrderDto>(sql, new { shopId, userId, status });
        return rows.ToList();
    }

    public async Task<WorkOrderDetailDto?> GetWorkOrderDetailAsync(Guid id)
    {
        var shopId = tenant.RequireShopId();
        var userId = tenant.RequireUserId();
        var seeAll = tenant.CanSeeAllWorkOrders();
        await using var conn = await tenant.OpenAsync();

        var wo = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT wo.id, wo.order_no AS OrderNo, wo.status, wo.mileage_in AS MileageIn,
                     wo.discount_amount AS Discount, wo.opened_at AS OpenedAt,
                     wo.started_at AS StartedAt, wo.closed_at AS ClosedAt,
                     wo.assigned_user_id AS AssignedUserId,
                     wo.assigned_user_name AS AssignedUserNameRaw, au.full_name AS AssignedUserFullName,
                     v.id AS VehicleId, v.customer_id AS CustomerId, v.plate, v.brand, v.model,
                     v.model_year AS ModelYear, v.color, v.fuel, v.chassis_no AS ChassisNo,
                     v.engine_no AS EngineNo, v.engine_volume AS EngineVolume, v.mileage,
                     c.full_name AS CustomerName, c.phone AS CustomerPhone, c.customer_type AS CustomerType,
                     c.email AS CustomerEmail, c.address AS CustomerAddress, c.city AS CustomerCity
              FROM dbo.work_orders wo
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              INNER JOIN dbo.customers c ON c.id = wo.customer_id
              LEFT JOIN dbo.users au ON au.id = wo.assigned_user_id
              WHERE wo.id = @id AND wo.shop_id = @shopId",
            new { id, shopId });

        if (wo is null) return null;

        if (!seeAll)
        {
            Guid? assignedId = (Guid?)wo.AssignedUserId;
            string? assignedName = (string?)wo.AssignedUserNameRaw;
            var isMine = assignedId == userId;
            var isUnassigned = assignedId is null && string.IsNullOrWhiteSpace(assignedName);
            if (!isMine && !isUnassigned) return null;
        }

        var complaints = (await conn.QueryAsync<ComplaintDto>(
            @"SELECT id AS Id, description AS Description, created_at AS CreatedAt,
                     ISNULL(category, N'diger') AS Category
              FROM dbo.complaints WHERE work_order_id=@id
              ORDER BY created_at ASC",
            new { id })).ToList();

        var services = (await conn.QueryAsync<ServiceLineDto>(
            "SELECT id AS Id, title AS Title, price AS Price FROM dbo.services WHERE work_order_id=@id",
            new { id })).ToList();

        var parts = (await conn.QueryAsync<PartLineDto>(
            @"SELECT p.id AS Id, p.name AS Name, p.quantity AS Quantity, p.unit_price AS UnitPrice,
                     p.source AS Source, p.supplier_id AS SupplierId, s.full_name AS SupplierName,
                     p.purchase_price AS PurchasePrice, p.returned_at AS ReturnedAt
              FROM dbo.work_order_parts p
              LEFT JOIN dbo.customers s ON s.id = p.supplier_id AND s.is_supplier = 1
              WHERE p.work_order_id=@id",
            new { id })).ToList();

        var totals = await conn.QuerySingleAsync<dynamic>(
            "SELECT labor_total AS LaborTotal, parts_total AS PartsTotal, grand_total AS GrandTotal, paid_total AS PaidTotal FROM dbo.vw_WorkOrderTotals WHERE id=@id",
            new { id });

        string? assignedTo = (string?)wo.AssignedUserFullName ?? (string?)wo.AssignedUserNameRaw;

        return new WorkOrderDetailDto(
            wo.id, (long)wo.OrderNo, (string)wo.status,
            new VehicleDto(wo.VehicleId, wo.CustomerId, (string)wo.CustomerName, (string)wo.plate,
                (string)wo.brand, (string)wo.model, wo.ModelYear, wo.color, (string)wo.fuel,
                wo.ChassisNo, wo.EngineNo, wo.EngineVolume, wo.mileage, (string)wo.status),
            new CustomerDto(wo.CustomerId, (string)wo.CustomerType, (string)wo.CustomerName, null,
                (string)wo.CustomerPhone, wo.CustomerEmail, wo.CustomerAddress, wo.CustomerCity),
            complaints, services, parts,
            (decimal)totals.LaborTotal, (decimal)totals.PartsTotal, (decimal)wo.Discount,
            (decimal)totals.GrandTotal, (decimal)totals.PaidTotal, assignedTo,
            (DateTime)wo.OpenedAt, (DateTime?)wo.StartedAt, (DateTime?)wo.ClosedAt);
    }

    public async Task<IReadOnlyList<StaffDto>> GetStaffAsync(string? callerRole, Guid callerUserId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var sql = @"SELECT u.id AS Id, u.full_name AS FullName, su.role AS Role
                    FROM dbo.shop_users su
                    INNER JOIN dbo.users u ON u.id = su.user_id
                    WHERE su.shop_id = @shopId AND su.is_active = 1";
        if (callerRole != "admin" && callerRole != "usta")
            sql += " AND su.user_id = @callerUserId";
        sql += " ORDER BY u.full_name";
        var rows = await conn.QueryAsync<StaffDto>(sql, new { shopId, callerUserId });
        return rows.ToList();
    }

    public async Task<PaymentsPendingReportDto> GetPaymentsPendingAsync()
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var items = (await conn.QueryAsync<PaymentPendingItemDto>(
            @"SELECT wo.id AS WorkOrderId, v.id AS VehicleId, v.plate AS Plate,
                     c.full_name AS CustomerName, wo.status AS Status,
                     t.grand_total AS GrandTotal, t.paid_total AS PaidTotal,
                     t.grand_total - t.paid_total AS Remaining
              FROM dbo.work_orders wo
              INNER JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              INNER JOIN dbo.customers c ON c.id = wo.customer_id
              WHERE wo.shop_id = @shopId
                AND wo.status IN (N'tamamlandi', N'odeme_tamamlandi', N'teslim_edildi')
                AND t.grand_total - t.paid_total > 0.005
              ORDER BY Remaining DESC, v.plate",
            new { shopId })).ToList();
        return new PaymentsPendingReportDto(
            items.Count,
            items.Sum(i => i.Remaining),
            items);
    }

    public async Task<CashTodayReportDto> GetCashTodayAsync()
    {
        var shopId = tenant.RequireShopId();
        // Turkey local day (UTC+3, fixed — no DST since 2016)
        var turkeyToday = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        var fromUtc = turkeyToday.ToDateTime(TimeOnly.MinValue).AddHours(-3);
        var toUtc = turkeyToday.AddDays(1).ToDateTime(TimeOnly.MinValue).AddHours(-3);

        await using var conn = await tenant.OpenAsync();
        var row = await conn.QuerySingleAsync<dynamic>(
            @"SELECT
                ISNULL(SUM(amount), 0) AS Total,
                ISNULL(SUM(CASE WHEN method = N'nakit' THEN amount ELSE 0 END), 0) AS Nakit,
                ISNULL(SUM(CASE WHEN method = N'kart' THEN amount ELSE 0 END), 0) AS Kart,
                ISNULL(SUM(CASE WHEN method = N'havale' THEN amount ELSE 0 END), 0) AS Havale,
                ISNULL(SUM(CASE WHEN method NOT IN (N'nakit', N'kart', N'havale') THEN amount ELSE 0 END), 0) AS Diger
              FROM dbo.payments
              WHERE shop_id = @shopId AND paid_at >= @fromUtc AND paid_at < @toUtc",
            new { shopId, fromUtc, toUtc });
        return new CashTodayReportDto(
            (decimal)row.Total, (decimal)row.Nakit, (decimal)row.Kart,
            (decimal)row.Havale, (decimal)row.Diger);
    }

    public async Task<IReadOnlyList<StaffPerformanceRow>> GetStaffPerformanceAsync(
        DateOnly date, string? callerRole, Guid callerUserId, Guid? userId)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("staff_performance");
        var effectiveUserId = callerRole == "personel" ? callerUserId : userId;
        // Türkiye takvim günü → UTC (cash-today ile aynı)
        var from = date.ToDateTime(TimeOnly.MinValue).AddHours(-3);
        var to = date.AddDays(1).ToDateTime(TimeOnly.MinValue).AddHours(-3);

        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<StaffPerformanceRow>(
            @"WITH completed_today AS (
                  SELECT DISTINCT h.work_order_id
                  FROM dbo.work_order_status_history h
                  WHERE h.shop_id = @shopId AND h.new_status IN (N'tamamlandi', N'teslim_edildi', N'odeme_tamamlandi')
                    AND h.changed_at >= @from AND h.changed_at < @to
              )
              SELECT wo.assigned_user_id AS UserId,
                     ISNULL(u.full_name, ISNULL(wo.assigned_user_name, N'Atanmamış')) AS FullName,
                     COUNT(DISTINCT ct.work_order_id) AS JobCount,
                     ISNULL(SUM(t.grand_total), 0) AS Revenue
              FROM completed_today ct
              INNER JOIN dbo.work_orders wo ON wo.id = ct.work_order_id AND wo.shop_id = @shopId
              LEFT JOIN dbo.users u ON u.id = wo.assigned_user_id
              LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE (wo.assigned_user_id IS NOT NULL OR wo.assigned_user_name IS NOT NULL)
                AND (@effectiveUserId IS NULL OR wo.assigned_user_id = @effectiveUserId)
              GROUP BY wo.assigned_user_id, u.full_name, wo.assigned_user_name
              ORDER BY Revenue DESC",
            new { shopId, from, to, effectiveUserId });
        return rows.ToList();
    }

    /// <summary>
    /// İşleme alınmamış (bekliyor) iş emrini siler.
    /// Başka iş emri yoksa aracı da pasife alır.
    /// </summary>
    public async Task<bool> DeleteWaitingWorkOrderAsync(Guid woId, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var row = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT wo.status AS Status, wo.vehicle_id AS VehicleId, wo.customer_id AS CustomerId,
                     v.plate AS Plate, ISNULL(t.paid_total, 0) AS PaidTotal
              FROM dbo.work_orders wo
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE wo.id = @woId AND wo.shop_id = @shopId",
            new { woId, shopId });
        if (row is null) return false;

        string status = (string)row.Status;
        if (!string.Equals(status, "bekliyor", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Yalnızca işleme alınmamış (bekliyor) kayıtlar silinebilir.");

        if ((decimal)row.PaidTotal > 0.005m)
            throw new ArgumentException("Ödeme alınmış iş emri silinemez.");

        Guid vehicleId = (Guid)row.VehicleId;
        Guid customerId = (Guid)row.CustomerId;
        string plate = (string)row.Plate;

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Dışarıdan alış cari satırlarını temizle (FK SET NULL bırakmasın)
            await conn.ExecuteAsync(
                @"DELETE st
                  FROM dbo.supplier_transactions st
                  INNER JOIN dbo.work_order_parts p ON p.id = st.work_order_part_id
                  WHERE p.work_order_id = @woId AND p.shop_id = @shopId",
                new { woId, shopId }, tx);

            // Stoktan düşülmüş parçaları geri ver
            var stockParts = (await conn.QueryAsync<dynamic>(
                @"SELECT stock_product_id AS StockProductId, quantity AS Qty
                  FROM dbo.work_order_parts
                  WHERE work_order_id = @woId AND shop_id = @shopId
                    AND stock_product_id IS NOT NULL AND quantity > 0",
                new { woId, shopId }, tx)).ToList();

            foreach (var sp in stockParts)
            {
                Guid stockProductId = (Guid)sp.StockProductId;
                int qty = (int)sp.Qty;
                await conn.ExecuteAsync(
                    @"UPDATE dbo.stock_products SET quantity = quantity + @qty
                      WHERE id = @stockProductId AND shop_id = @shopId",
                    new { stockProductId, qty, shopId }, tx);
                await conn.ExecuteAsync(
                    @"INSERT INTO dbo.stock_movements
                        (id, shop_id, stock_product_id, change_qty, movement_type, reason, work_order_id, created_by)
                      VALUES
                        (NEWID(), @shopId, @stockProductId, @qty, N'giris',
                         N'Bekleyen iş emri silindi (stoğa iade)', @woId, @userId)",
                    new { shopId, stockProductId, qty, woId, userId }, tx);
            }

            await conn.ExecuteAsync(
                @"DELETE FROM dbo.work_orders WHERE id = @woId AND shop_id = @shopId",
                new { woId, shopId }, tx);

            var otherWo = await conn.ExecuteScalarAsync<int>(
                @"SELECT COUNT(1) FROM dbo.work_orders
                  WHERE vehicle_id = @vehicleId AND shop_id = @shopId",
                new { vehicleId, shopId }, tx);

            if (otherWo == 0)
            {
                await conn.ExecuteAsync(
                    @"UPDATE dbo.vehicles
                      SET is_active = 0, updated_at = SYSUTCDATETIME()
                      WHERE id = @vehicleId AND shop_id = @shopId",
                    new { vehicleId, shopId }, tx);
            }

            await tx.CommitAsync();

            await ActivityLogService.LogAsync(
                conn, shopId, userId, "deleted", "work_order", woId,
                $"Bekleyen kayıt silindi: {plate}", customerId: customerId, vehicleId: vehicleId);

            return true;
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public async Task<bool> UpdateWorkOrderStatusAsync(
        Guid id, string status, string? callerRole, Guid callerUserId,
        Guid? assignedUserId, string? assignedUserName)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var current = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT status, closed_at,
                     CASE WHEN closed_at IS NOT NULL
                          AND CAST(DATEADD(HOUR, 3, closed_at) AS date) = CAST(DATEADD(HOUR, 3, SYSUTCDATETIME()) AS date)
                          THEN 1 ELSE 0 END AS same_local_day
              FROM dbo.work_orders WHERE id=@id AND shop_id=@shopId",
            new { id, shopId });
        if (current is null) return false;

        string currentStatus = (string)current.status;
        bool sameLocalDay = (int)current.same_local_day == 1;
        bool currentIsTerminal = currentStatus is "tamamlandi" or "teslim_edildi" or "odeme_tamamlandi";
        bool targetReopensWork = status is "bekliyor" or "islemde";

        // "Same day" is evaluated in Turkey local time (UTC+3, fixed offset — no DST since 2016),
        // even though closed_at is stored in UTC.
        if (currentIsTerminal && targetReopensWork)
        {
            if (!sameLocalDay)
                throw new WorkOrderReopenBlockedException();
        }

        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "bekliyor", "islemde", "tamamlandi", "teslim_edildi", "odeme_tamamlandi" };
        if (!allowed.Contains(status))
            throw new ArgumentException("Geçersiz iş durumu.");

        var woCtx = await GetWorkOrderContextAsync(conn, id, shopId);
        async Task<bool> LogAndReturnAsync(int n0)
        {
            if (n0 > 0 && woCtx is not null)
            {
                var label = WORK_ORDER_STATUS_LABELS.GetValueOrDefault(status, status);
                await ActivityLogService.LogAsync(
                    conn, shopId, callerUserId, "status_changed", "work_order", id,
                    $"İş emri durumu değişti: {WORK_ORDER_STATUS_LABELS.GetValueOrDefault(currentStatus, currentStatus)} → {label} ({woCtx.Plate})",
                    customerId: woCtx.CustomerId, vehicleId: woCtx.VehicleId);
            }
            return n0 > 0;
        }

        if (status is "tamamlandi")
        {
            var n0 = await conn.ExecuteAsync(
                @"UPDATE dbo.work_orders
                  SET status=@status,
                      closed_at=ISNULL(closed_at, SYSUTCDATETIME()),
                      delivered_at=NULL
                  WHERE id=@id AND shop_id=@shopId",
                new { id, status, shopId });
            return await LogAndReturnAsync(n0);
        }

        if (status is "teslim_edildi")
        {
            var n0 = await conn.ExecuteAsync(
                @"UPDATE dbo.work_orders
                  SET status=@status,
                      closed_at=ISNULL(closed_at, SYSUTCDATETIME()),
                      delivered_at=ISNULL(delivered_at, SYSUTCDATETIME())
                  WHERE id=@id AND shop_id=@shopId",
                new { id, status, shopId });
            return await LogAndReturnAsync(n0);
        }

        if (status is "odeme_tamamlandi")
        {
            var n0 = await conn.ExecuteAsync(
                @"UPDATE dbo.work_orders
                  SET status=@status,
                      closed_at=ISNULL(closed_at, SYSUTCDATETIME())
                  WHERE id=@id AND shop_id=@shopId",
                new { id, status, shopId });
            return await LogAndReturnAsync(n0);
        }

        if (status != "islemde")
        {
            // bekliyor (yeniden açma dahil)
            var n0 = await conn.ExecuteAsync(
                @"UPDATE dbo.work_orders
                  SET status=@status, closed_at=NULL, delivered_at=NULL
                  WHERE id=@id AND shop_id=@shopId",
                new { id, status, shopId });
            return await LogAndReturnAsync(n0);
        }

        Guid? finalUserId;
        string? finalUserName;

        if (callerRole == "admin" || callerRole == "usta")
        {
            if (assignedUserId is Guid uid)
            {
                var isMember = await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(1) FROM dbo.shop_users WHERE shop_id=@shopId AND user_id=@uid AND is_active=1",
                    new { shopId, uid });
                if (isMember == 0)
                    throw new ArgumentException("Seçilen kişi bu servisin kayıtlı personeli değil.");
                finalUserId = uid;
                finalUserName = null;
            }
            else if (!string.IsNullOrWhiteSpace(assignedUserName))
            {
                finalUserId = null;
                finalUserName = assignedUserName.Trim();
            }
            else
            {
                finalUserId = callerUserId;
                finalUserName = null;
            }
        }
        else
        {
            finalUserId = callerUserId;
            finalUserName = null;
        }

        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.work_orders
              SET status=@status,
                  assigned_user_id=@finalUserId,
                  assigned_user_name=@finalUserName,
                  started_at=ISNULL(started_at, SYSUTCDATETIME()),
                  closed_at=NULL,
                  delivered_at=NULL
              WHERE id=@id AND shop_id=@shopId",
            new { id, status, shopId, finalUserId, finalUserName });
        return await LogAndReturnAsync(n);
    }

    public async Task<OpenNewVisitResponse?> OpenNewVisitAsync(
        Guid vehicleId, Guid userId, string? complaint, string? complaintCategory = null)
    {
        var shopId = tenant.RequireShopId();
        await plans.EnsureWorkOrderQuotaAsync();
        await using var conn = await tenant.OpenAsync();

        var vehicle = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT customer_id, mileage FROM dbo.vehicles WHERE id=@vehicleId AND shop_id=@shopId AND is_active=1",
            new { vehicleId, shopId });
        if (vehicle is null) return null;

        Guid customerId = vehicle.customer_id;

        await using var tx = await conn.BeginTransactionAsync();

        var orderNo = await conn.ExecuteScalarAsync<long>(
            "DECLARE @n bigint; EXEC dbo.usp_NextTenantCounter @shopId, N'work_order_no', @n OUTPUT; SELECT @n",
            new { shopId }, tx);

        var woId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        int? mileage = vehicle.mileage;
        await conn.ExecuteAsync(
            @"INSERT INTO dbo.work_orders (id, shop_id, order_no, vehicle_id, customer_id, opened_by, status, mileage_in, opened_at)
              VALUES (@woId, @shopId, @orderNo, @vehicleId, @customerId, @userId, N'bekliyor', @mileage, @now)",
            new { woId, shopId, orderNo, vehicleId, customerId, userId, mileage, now }, tx);

        if (!string.IsNullOrWhiteSpace(complaint))
        {
            var cat = NormalizeComplaintCategory(complaintCategory);
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.complaints (shop_id, work_order_id, description, category, created_at)
                  VALUES (@shopId, @woId, @complaint, @cat, @now)",
                new { shopId, woId, complaint, cat, now }, tx);
        }

        await tx.CommitAsync();

        var plate = await conn.ExecuteScalarAsync<string?>(
            "SELECT plate FROM dbo.vehicles WHERE id=@vehicleId AND shop_id=@shopId", new { vehicleId, shopId });
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "created", "work_order", woId,
            $"Yeni ziyaret açıldı: {plate}", customerId: customerId, vehicleId: vehicleId);

        return new OpenNewVisitResponse(vehicleId, woId);
    }

    public async Task<IReadOnlyList<WorkOrderStatusHistoryDto>?> GetWorkOrderStatusHistoryAsync(Guid woId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId", new { woId, shopId });
        if (exists == 0) return null;

        var rows = await conn.QueryAsync<WorkOrderStatusHistoryDto>(
            @"SELECT h.id AS Id, h.old_status AS OldStatus, h.new_status AS NewStatus, h.changed_at AS ChangedAt,
                     u.full_name AS ChangedByName
              FROM dbo.work_order_status_history h
              LEFT JOIN dbo.users u ON u.id = h.changed_by
              WHERE h.work_order_id = @woId AND h.shop_id = @shopId
              ORDER BY h.changed_at ASC",
            new { woId, shopId });
        return rows.ToList();
    }

    public async Task<bool> UpdateComplaintAsync(Guid woId, Guid complaintId, string description, string? category = null)
    {
        var shopId = tenant.RequireShopId();
        var cat = NormalizeComplaintCategory(category);
        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.complaints SET description=@description, category=@cat
              WHERE id=@complaintId AND work_order_id=@woId AND shop_id=@shopId",
            new { complaintId, woId, shopId, description, cat });
        return n > 0;
    }

    public async Task<Guid?> AddComplaintAsync(Guid woId, string description, string? category = null)
    {
        var shopId = tenant.RequireShopId();
        var id = Guid.NewGuid();
        var cat = NormalizeComplaintCategory(category);
        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"INSERT INTO dbo.complaints (id, shop_id, work_order_id, description, category)
              SELECT @id, @shopId, @woId, @description, @cat
              WHERE EXISTS (SELECT 1 FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId)",
            new { id, shopId, woId, description, cat });
        return n > 0 ? id : null;
    }

    public async Task<bool> DeleteComplaintAsync(Guid woId, Guid complaintId, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var complaint = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT description FROM dbo.complaints WHERE id=@complaintId AND work_order_id=@woId AND shop_id=@shopId",
            new { complaintId, woId, shopId });
        if (complaint is null) return false;

        // FK_woimg_complaint ON DELETE NO ACTION oldugu icin, sikayete bagli fotograflari
        // (DB kaydi + fiziksel dosya) once temizlemeden sikayet silinemiyordu.
        var imagePaths = (await conn.QueryAsync<string>(
            "SELECT file_path FROM dbo.work_order_images WHERE complaint_id=@complaintId AND shop_id=@shopId",
            new { complaintId, shopId })).ToList();

        await conn.ExecuteAsync(
            "DELETE FROM dbo.work_order_images WHERE complaint_id=@complaintId AND shop_id=@shopId",
            new { complaintId, shopId });

        var n = await conn.ExecuteAsync(
            "DELETE FROM dbo.complaints WHERE id=@complaintId AND work_order_id=@woId AND shop_id=@shopId",
            new { complaintId, woId, shopId });

        if (n > 0)
        {
            foreach (var relPath in imagePaths)
            {
                try
                {
                    var absPath = PhysicalFromRelative(relPath);
                    if (File.Exists(absPath)) File.Delete(absPath);
                }
                catch
                {
                    // Fiziksel dosya silinemezse yut: DB kaydi zaten temizlendi, tutarsizlik olusmaz.
                }
            }

            var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
            if (ctx is not null)
                await ActivityLogService.LogAsync(
                    conn, shopId, userId, "deleted", "complaint", complaintId,
                    $"Şikayet silindi: {(string)complaint.description} — {ctx.Plate}",
                    customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
        }
        return n > 0;
    }

    private static readonly HashSet<string> ComplaintCategories = new(StringComparer.OrdinalIgnoreCase)
    {
        "motor", "fren", "elektrik", "klima", "suspansiyon",
        "kaporta", "lastik", "yag_bakim", "diagnostik", "istek", "diger",
    };

    private static string NormalizeComplaintCategory(string? category)
    {
        var c = string.IsNullOrWhiteSpace(category) ? "diger" : category.Trim().ToLowerInvariant();
        return ComplaintCategories.Contains(c) ? c : "diger";
    }

    private async Task<string?> GetWorkOrderStatusAsync(SqlConnection conn, Guid woId, Guid shopId) =>
        await conn.ExecuteScalarAsync<string?>(
            "SELECT status FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId", new { woId, shopId });

    private static bool IsCompletedStatus(string status) =>
        status is "tamamlandi" or "teslim_edildi" or "odeme_tamamlandi";

    public async Task<ShopPaymentInfoDto?> GetShopPaymentInfoAsync()
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<ShopPaymentInfoDto>(
            @"SELECT name AS ShopName, bank_iban AS BankIban, bank_name AS BankName,
                     account_holder AS AccountHolder
              FROM dbo.shops WHERE id=@shopId AND is_active=1",
            new { shopId });
    }

    public async Task<ShopPaymentInfoDto?> UpdateShopPaymentInfoAsync(UpdateShopPaymentInfoRequest req)
    {
        var shopId = tenant.RequireShopId();
        var iban = NormalizeIban(req.BankIban);
        var bankName = string.IsNullOrWhiteSpace(req.BankName) ? null : req.BankName.Trim();
        var holder = string.IsNullOrWhiteSpace(req.AccountHolder) ? null : req.AccountHolder.Trim();

        if (iban is { Length: > 34 })
            throw new ArgumentException("IBAN en fazla 34 karakter olabilir.");
        if (bankName is { Length: > 100 })
            throw new ArgumentException("Banka adı en fazla 100 karakter olabilir.");
        if (holder is { Length: > 150 })
            throw new ArgumentException("Hesap sahibi en fazla 150 karakter olabilir.");

        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.shops
              SET bank_iban=@iban, bank_name=@bankName, account_holder=@holder
              WHERE id=@shopId AND is_active=1",
            new { shopId, iban, bankName, holder });
        if (n == 0) return null;
        return await GetShopPaymentInfoAsync();
    }

    private static string? NormalizeIban(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var cleaned = new string(raw.Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();
        return cleaned.Length == 0 ? null : cleaned;
    }

    public async Task<IReadOnlyList<WorkOrderPaymentDto>?> GetWorkOrderPaymentsAsync(Guid woId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId",
            new { woId, shopId });
        if (exists == 0) return null;

        var rows = await conn.QueryAsync<WorkOrderPaymentDto>(
            @"SELECT p.id AS Id, p.amount AS Amount, p.method AS Method, p.paid_at AS PaidAt,
                     u.full_name AS ReceivedByName
              FROM dbo.payments p
              LEFT JOIN dbo.users u ON u.id = p.received_by
              WHERE p.work_order_id = @woId AND p.shop_id = @shopId
              ORDER BY p.paid_at DESC",
            new { woId, shopId });
        return rows.ToList();
    }

    public async Task<WorkOrderPaymentResultDto?> AddWorkOrderPaymentAsync(
        Guid woId, RecordWorkOrderPaymentRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        if (req.Amount <= 0)
            throw new ArgumentException("Ödeme tutarı 0'dan büyük olmalı.");

        var method = NormalizePayMethod(req.Method);

        await using var conn = await tenant.OpenAsync();
        var totals = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT grand_total AS GrandTotal, paid_total AS PaidTotal
              FROM dbo.vw_WorkOrderTotals WHERE id=@woId AND shop_id=@shopId",
            new { woId, shopId });
        if (totals is null) return null;

        var remaining = Math.Round((decimal)totals.GrandTotal - (decimal)totals.PaidTotal, 2);
        if (remaining <= 0)
            throw new ArgumentException("Bu iş emrinde kalan ödeme yok.");
        if (req.Amount > remaining)
            throw new ArgumentException($"Kalan tutardan ({remaining:0.##} ₺) fazla ödeme alınamaz.");

        var paymentId = Guid.NewGuid();
        await conn.ExecuteAsync(
            @"INSERT INTO dbo.payments (id, shop_id, work_order_id, amount, method, received_by)
              VALUES (@paymentId, @shopId, @woId, @Amount, @method, @userId)",
            new { paymentId, shopId, woId, req.Amount, method, userId });

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);
        var result = await GetPaymentResultAsync(conn, woId);

        var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
        if (ctx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "created", "payment", paymentId,
                $"Tahsilat alındı: {req.Amount:0.##} ₺ ({PAY_METHOD_LABELS.GetValueOrDefault(method, method)}) — {ctx.Plate}",
                customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);

        return result with { PaymentId = paymentId };
    }

    public async Task<WorkOrderPaymentResultDto?> UpdateWorkOrderPaymentAsync(
        Guid woId, Guid paymentId, UpdateWorkOrderPaymentRequest req, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        if (req.Amount <= 0)
            throw new ArgumentException("Ödeme tutarı 0'dan büyük olmalı.");
        var method = NormalizePayMethod(req.Method);

        await using var conn = await tenant.OpenAsync();
        var current = await conn.QuerySingleOrDefaultAsync<decimal?>(
            @"SELECT amount FROM dbo.payments
              WHERE id=@paymentId AND work_order_id=@woId AND shop_id=@shopId",
            new { paymentId, woId, shopId });
        if (current is null) return null;

        var totals = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT grand_total AS GrandTotal, paid_total AS PaidTotal
              FROM dbo.vw_WorkOrderTotals WHERE id=@woId AND shop_id=@shopId",
            new { woId, shopId });
        if (totals is null) return null;

        var maxAllowed = Math.Round(
            (decimal)totals.GrandTotal - (decimal)totals.PaidTotal + current.Value, 2);
        if (req.Amount > maxAllowed)
            throw new ArgumentException($"Kalan tutardan ({maxAllowed:0.##} ₺) fazla ödeme alınamaz.");

        await conn.ExecuteAsync(
            @"UPDATE dbo.payments
              SET amount = @Amount, method = @method
              WHERE id = @paymentId AND work_order_id = @woId AND shop_id = @shopId",
            new { paymentId, woId, shopId, req.Amount, method });

        // Bu tahsilatla birlikte "tedarikçiye de öde" seçeneğiyle yazılmış bağlı
        // tedarikçi ödemesi varsa (açıklamadaki pid: işareti), tutarı aynı oranda
        // güncelle — aksi halde müşteriden alınan tutar değişirken tedarikçiye
        // "ödendi" görünen tutar eskisinde kalır ve cari tutarsız hale gelir.
        await SyncLinkedSupplierPaymentAsync(conn, shopId, paymentId, current.Value, req.Amount, userId);

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);
        var updResult = await GetPaymentResultAsync(conn, woId);

        var updCtx = await GetWorkOrderContextAsync(conn, woId, shopId);
        if (updCtx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "updated", "payment", paymentId,
                $"Tahsilat düzenlendi: {req.Amount:0.##} ₺ ({PAY_METHOD_LABELS.GetValueOrDefault(method, method)}) — {updCtx.Plate}",
                customerId: updCtx.CustomerId, vehicleId: updCtx.VehicleId);

        return updResult;
    }

    /// <summary>
    /// "Müşteriden Tahsilat" ekranında "tedarikçiye de öde" seçeneğiyle bir
    /// tahsilatla birlikte otomatik yazılan tedarikçi ödemesini bulur (açıklamada
    /// "pid:{paymentId}" işareti) ve tahsilat tutarı değiştiğinde aynı oranda
    /// günceller. Oranlanan tutar 0'a inerse (ör. tahsilat neredeyse iptal edildiyse)
    /// cari hareketi tamamen kaldırır — CK_suptx_amount (amount &gt; 0) ihlalini önler.
    /// </summary>
    private static async Task SyncLinkedSupplierPaymentAsync(
        SqlConnection conn, Guid shopId, Guid paymentId, decimal oldAmount, decimal newAmount, Guid? userId)
    {
        if (oldAmount <= 0 || oldAmount == newAmount) return;
        var marker = $"pid:{paymentId:D}";
        var linkedRows = (await conn.QueryAsync<dynamic>(
            @"SELECT id, supplier_id AS SupplierId, amount FROM dbo.supplier_transactions
              WHERE shop_id = @shopId AND type = N'odeme' AND description LIKE '%' + @marker + '%'",
            new { shopId, marker })).ToList();
        if (linkedRows.Count == 0) return;

        var ratio = newAmount / oldAmount;
        foreach (var linked in linkedRows)
        {
            Guid linkedId = linked.id;
            Guid supplierId = linked.SupplierId;
            var newSupplierAmount = Math.Round((decimal)linked.amount * ratio, 2);

            if (newSupplierAmount <= 0)
            {
                await conn.ExecuteAsync(
                    "DELETE FROM dbo.supplier_transactions WHERE id = @linkedId AND shop_id = @shopId",
                    new { linkedId, shopId });
            }
            else
            {
                await conn.ExecuteAsync(
                    @"UPDATE dbo.supplier_transactions SET amount = @newSupplierAmount
                      WHERE id = @linkedId AND shop_id = @shopId",
                    new { newSupplierAmount, linkedId, shopId });
            }

            await ActivityLogService.LogAsync(
                conn, shopId, userId, "updated", "supplier_transaction", linkedId,
                $"Bağlı tedarikçi ödemesi tahsilat değişikliğiyle güncellendi: {newSupplierAmount:0.##} ₺",
                customerId: supplierId);
        }
    }

    public async Task<WorkOrderPaymentResultDto?> DeleteWorkOrderPaymentAsync(Guid woId, Guid paymentId, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var payment = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT amount, method FROM dbo.payments WHERE id=@paymentId AND work_order_id=@woId AND shop_id=@shopId",
            new { paymentId, woId, shopId });
        var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);

        var n = await conn.ExecuteAsync(
            @"DELETE FROM dbo.payments
              WHERE id = @paymentId AND work_order_id = @woId AND shop_id = @shopId",
            new { paymentId, woId, shopId });
        if (n == 0) return null;

        // Tahsilatla birlikte yazılan tedarikçi ödemesini de geri al (açıklamadaki pid işareti)
        var marker = $"pid:{paymentId:D}";
        await conn.ExecuteAsync(
            @"DELETE FROM dbo.supplier_transactions
              WHERE shop_id = @shopId
                AND type = N'odeme'
                AND description LIKE '%' + @marker + '%'",
            new { shopId, marker });

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);

        if (payment is not null && ctx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "deleted", "payment", paymentId,
                $"Tahsilat silindi: {(decimal)payment.amount:0.##} ₺ ({PAY_METHOD_LABELS.GetValueOrDefault((string)payment.method, (string)payment.method)}) — {ctx.Plate}",
                customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);

        return await GetPaymentResultAsync(conn, woId);
    }

    public async Task<WorkOrderPaymentResultDto?> UpdateWorkOrderDiscountAsync(
        Guid woId, UpdateWorkOrderDiscountRequest req, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        if (req.Amount < 0)
            throw new ArgumentException("İskonto negatif olamaz.");

        await using var conn = await tenant.OpenAsync();
        var row = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT ISNULL(labor_total,0) AS LaborTotal, ISNULL(parts_total,0) AS PartsTotal
              FROM dbo.vw_WorkOrderTotals WHERE id=@woId AND shop_id=@shopId",
            new { woId, shopId });
        if (row is null) return null;

        var maxDisc = (decimal)row.LaborTotal + (decimal)row.PartsTotal;
        if (req.Amount > maxDisc)
            throw new ArgumentException($"İskonto en fazla {maxDisc:0.##} olabilir.");

        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.work_orders
              SET discount_amount = @Amount, updated_at = SYSUTCDATETIME()
              WHERE id = @woId AND shop_id = @shopId",
            new { woId, shopId, req.Amount });
        if (n == 0) return null;

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);

        var discCtx = await GetWorkOrderContextAsync(conn, woId, shopId);
        if (discCtx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "updated", "discount", woId,
                $"İskonto güncellendi: {req.Amount:0.##} ₺ — {discCtx.Plate}",
                customerId: discCtx.CustomerId, vehicleId: discCtx.VehicleId);

        return await GetPaymentResultAsync(conn, woId);
    }

    private static string NormalizePayMethod(string? method)
    {
        var m = string.IsNullOrWhiteSpace(method) ? "nakit" : method.Trim().ToLowerInvariant();
        if (m is not ("nakit" or "kart" or "havale" or "diger"))
            throw new ArgumentException("Geçersiz ödeme yöntemi.");
        return m;
    }

    private static async Task<WorkOrderPaymentResultDto> GetPaymentResultAsync(SqlConnection conn, Guid woId)
    {
        var totals = await conn.QuerySingleAsync<dynamic>(
            @"SELECT grand_total AS GrandTotal, paid_total AS PaidTotal, discount_amount AS Discount
              FROM dbo.vw_WorkOrderTotals WHERE id=@woId",
            new { woId });
        return new WorkOrderPaymentResultDto(
            (decimal)totals.GrandTotal,
            (decimal)totals.PaidTotal,
            (decimal)totals.Discount);
    }

    private static async Task SyncWorkOrderPaymentStatusAsync(SqlConnection conn, Guid woId, Guid shopId)
    {
        var row = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT wo.status AS Status, t.grand_total AS GrandTotal, t.paid_total AS PaidTotal
              FROM dbo.work_orders wo
              INNER JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE wo.id=@woId AND wo.shop_id=@shopId",
            new { woId, shopId });
        if (row is null) return;

        var status = (string)row.Status;
        var grand = (decimal)row.GrandTotal;
        var paid = (decimal)row.PaidTotal;
        var remaining = Math.Round(grand - paid, 2);

        if (status == "teslim_edildi") return;

        if (remaining <= 0 && status == "tamamlandi")
        {
            await conn.ExecuteAsync(
                @"UPDATE dbo.work_orders
                  SET status = N'odeme_tamamlandi', updated_at = SYSUTCDATETIME()
                  WHERE id = @woId AND shop_id = @shopId",
                new { woId, shopId });
        }
        else if (remaining > 0 && status == "odeme_tamamlandi")
        {
            await conn.ExecuteAsync(
                @"UPDATE dbo.work_orders
                  SET status = N'tamamlandi', updated_at = SYSUTCDATETIME()
                  WHERE id = @woId AND shop_id = @shopId",
                new { woId, shopId });
        }
    }

    public async Task<Guid?> AddServiceAsync(Guid woId, AddServiceRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var status = await GetWorkOrderStatusAsync(conn, woId, shopId);
        if (status is null) return null;
        if (!req.Force && IsCompletedStatus(status))
            throw new WorkOrderCompletedException();

        var id = Guid.NewGuid();
        var n = await conn.ExecuteAsync(
            @"INSERT INTO dbo.services (id, shop_id, work_order_id, service_catalog_id, title, price, performed_by)
              SELECT @id, @shopId, @woId, @ServiceCatalogId, @Title, @Price, @userId
              WHERE EXISTS (SELECT 1 FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId)",
            new { id, shopId, woId, req.ServiceCatalogId, req.Title, req.Price, userId });
        if (n > 0)
        {
            await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);
            var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
            if (ctx is not null)
                await ActivityLogService.LogAsync(
                    conn, shopId, userId, "created", "service", id,
                    $"İşçilik eklendi: {req.Title} ({req.Price:0.##} ₺) — {ctx.Plate}",
                    customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
        }
        return n > 0 ? id : null;
    }

    public async Task<bool> AddPartAsync(Guid woId, AddPartRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        var source = (req.Source ?? "").Trim().ToLowerInvariant();
        if (source == "stok" || req.StockProductId.HasValue)
            await plans.RequireFeatureAsync("stock");
        if (source == "disaridan" || req.SupplierId.HasValue)
            await plans.RequireFeatureAsync("suppliers");

        await using var conn = await tenant.OpenAsync();

        var status = await GetWorkOrderStatusAsync(conn, woId, shopId);
        if (status is null) return false;
        if (!req.Force && IsCompletedStatus(status))
            throw new WorkOrderCompletedException();

        await conn.ExecuteAsync(
            @"EXEC dbo.usp_AddPartToWorkOrder
                @shop_id=@shopId,
                @work_order_id=@woId,
                @stock_product_id=@StockProductId,
                @name=@Name,
                @quantity=@Quantity,
                @unit_price=@UnitPrice,
                @created_by=@userId,
                @source=@Source,
                @supplier_id=@SupplierId,
                @purchase_price=@PurchasePrice",
            new
            {
                shopId, woId, req.StockProductId, req.Name, req.Quantity, req.UnitPrice, userId,
                req.Source, req.SupplierId, req.PurchasePrice,
            });

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);

        var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
        if (ctx is not null)
        {
            var sourceLabel = source == "disaridan" ? "dışarıdan temin" : source == "stok" ? "stoktan" : "";
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "created", "part", null,
                $"Ürün eklendi: {req.Name} x{req.Quantity}{(sourceLabel != "" ? $" ({sourceLabel})" : "")} — {ctx.Plate}",
                customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
        }
        return true;
    }

    public async Task ReturnPartToSupplierAsync(Guid woId, Guid partId, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var part = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT name, quantity FROM dbo.work_order_parts WHERE id=@partId AND work_order_id=@woId AND shop_id=@shopId",
            new { partId, woId, shopId });
        var ctx = await GetWorkOrderContextAsync(conn, woId, shopId);
        await conn.ExecuteAsync(
            "EXEC dbo.usp_ReturnPartToSupplier @shop_id=@shopId, @work_order_part_id=@partId, @created_by=@userId",
            new { shopId, partId, userId });

        await SyncWorkOrderPaymentStatusAsync(conn, woId, shopId);

        if (part is not null && ctx is not null)
            await ActivityLogService.LogAsync(
                conn, shopId, userId, "returned", "part", partId,
                $"Ürün tedarikçiye iade edildi: {(string)part.name} x{(int)part.quantity} — {ctx.Plate}",
                customerId: ctx.CustomerId, vehicleId: ctx.VehicleId);
    }

    public async Task<IReadOnlyList<SupplierDto>> GetSuppliersAsync(string? search = null)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("suppliers");
        await using var conn = await tenant.OpenAsync();
        var sql = @"SELECT s.id AS Id, s.full_name AS Name, s.contact_person AS Contact, NULLIF(s.phone, N'') AS Phone,
                           s.email AS Email, s.address AS Address, s.tax_no AS TaxNo,
                           ISNULL(b.balance, s.opening_balance) AS Balance
                    FROM dbo.customers s
                    LEFT JOIN dbo.vw_SupplierBalance b ON b.supplier_id = s.id AND b.shop_id = s.shop_id
                    WHERE s.shop_id = @shopId AND s.is_active = 1 AND s.is_supplier = 1";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (s.full_name LIKE @q OR s.phone LIKE @q)";
        sql += " ORDER BY s.full_name";
        var rows = await conn.QueryAsync<SupplierDto>(sql, new { shopId, q = $"%{search?.Trim()}%" });
        return rows.ToList();
    }

    public async Task<SupplierDto?> CreateSupplierAsync(CreateSupplierRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("suppliers");
        var id = Guid.NewGuid();
        var phone = string.IsNullOrWhiteSpace(req.Phone) ? "" : req.Phone.Trim();
        await using var conn = await tenant.OpenAsync();
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.customers
                    (id, shop_id, customer_type, full_name, contact_person, phone, email, address, tax_no, opening_balance, is_supplier, is_customer, created_by)
                  VALUES
                    (@id, @shopId, N'kurumsal', @Name, @Contact, @phone, @Email, @Address, @TaxNo, @OpeningBalance, 1, 0, @userId)",
                new { id, shopId, req.Name, req.Contact, phone, req.Email, req.Address, req.TaxNo, req.OpeningBalance, userId });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            throw new SupplierPhoneConflictException();
        }
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "created", "customer", id,
            $"Tedarikçi kaydı oluşturuldu: {req.Name}", customerId: id);
        return (await GetSuppliersAsync()).FirstOrDefault(s => s.Id == id);
    }

    public async Task<SupplierLedgerDto?> GetSupplierLedgerAsync(Guid id)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("suppliers");
        await using var conn = await tenant.OpenAsync();
        var supplier = await conn.QuerySingleOrDefaultAsync<SupplierDto>(
            @"SELECT s.id AS Id, s.full_name AS Name, s.contact_person AS Contact, NULLIF(s.phone, N'') AS Phone,
                     s.email AS Email, s.address AS Address, s.tax_no AS TaxNo,
                     ISNULL(b.balance, s.opening_balance) AS Balance
              FROM dbo.customers s
              LEFT JOIN dbo.vw_SupplierBalance b ON b.supplier_id = s.id AND b.shop_id = s.shop_id
              WHERE s.id = @id AND s.shop_id = @shopId AND s.is_active = 1 AND s.is_supplier = 1",
            new { id, shopId });
        if (supplier is null) return null;

        var transactions = (await conn.QueryAsync<SupplierTransactionDto>(
            @"SELECT st.id AS Id, st.type AS Type, st.amount AS Amount, st.description AS Description,
                     st.created_at AS CreatedAt, st.method AS Method,
                     st.work_order_part_id AS WorkOrderPartId,
                     p.name AS PartName, p.quantity AS PartQuantity, p.purchase_price AS PurchasePrice,
                     v.plate AS Plate, wo.id AS WorkOrderId, v.id AS VehicleId
              FROM dbo.supplier_transactions st
              LEFT JOIN dbo.work_order_parts p ON p.id = st.work_order_part_id
              LEFT JOIN dbo.work_orders wo ON wo.id = p.work_order_id
              LEFT JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              WHERE st.supplier_id = @id AND st.shop_id = @shopId
              ORDER BY st.created_at DESC",
            new { id, shopId })).ToList();

        return new SupplierLedgerDto(supplier, transactions);
    }

    public async Task<SupplierLedgerDto?> RecordSupplierPaymentAsync(Guid id, RecordSupplierPaymentRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        if (req.Amount <= 0)
            throw new ArgumentException("Ödeme tutarı 0'dan büyük olmalı.");
        var method = string.IsNullOrWhiteSpace(req.Method)
            ? null
            : NormalizePayMethod(req.Method);

        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"INSERT INTO dbo.supplier_transactions (shop_id, supplier_id, type, amount, description, method, created_by)
              SELECT @shopId, @id, N'odeme', @Amount, @Description, @method, @userId
              WHERE EXISTS (SELECT 1 FROM dbo.customers WHERE id=@id AND shop_id=@shopId AND is_active=1 AND is_supplier=1)",
            new { shopId, id, req.Amount, req.Description, method, userId });
        if (n == 0) return null;
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "created", "supplier_payment", id,
            $"Tedarikçiye ödeme yapıldı: {req.Amount:0.##} ₺" +
            (method is not null ? $" ({PAY_METHOD_LABELS.GetValueOrDefault(method, method)})" : ""),
            customerId: id);
        return await GetSupplierLedgerAsync(id);
    }

    public async Task<SupplierLedgerDto?> RecordSupplierDiscountAsync(
        Guid id, RecordSupplierDiscountRequest req, Guid userId)
    {
        var shopId = tenant.RequireShopId();
        if (req.Amount <= 0)
            throw new ArgumentException("İskonto tutarı 0'dan büyük olmalı.");

        await using var conn = await tenant.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"INSERT INTO dbo.supplier_transactions (shop_id, supplier_id, type, amount, description, created_by)
              SELECT @shopId, @id, N'iskonto', @Amount, @Description, @userId
              WHERE EXISTS (SELECT 1 FROM dbo.customers WHERE id=@id AND shop_id=@shopId AND is_active=1 AND is_supplier=1)",
            new { shopId, id, req.Amount, req.Description, userId });
        if (n == 0) return null;
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "created", "supplier_discount", id,
            $"Tedarikçi iskontosu eklendi: {req.Amount:0.##} ₺", customerId: id);
        return await GetSupplierLedgerAsync(id);
    }

    public async Task<SupplierLedgerDto?> UpdateSupplierTransactionAsync(
        Guid supplierId, Guid txId, UpdateSupplierTransactionRequest req, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        if (req.Amount <= 0)
            throw new ArgumentException("Tutar 0'dan büyük olmalı.");

        await using var conn = await tenant.OpenAsync();
        var type = await conn.ExecuteScalarAsync<string?>(
            @"SELECT type FROM dbo.supplier_transactions
              WHERE id=@txId AND supplier_id=@supplierId AND shop_id=@shopId",
            new { txId, supplierId, shopId });
        if (type is null) return null;
        if (type is not ("odeme" or "iskonto"))
            throw new ArgumentException("Bu hareket düzenlenemez. Alış/iade parça üzerinden yönetilir.");

        string? method = null;
        if (type == "odeme")
        {
            method = string.IsNullOrWhiteSpace(req.Method)
                ? null
                : NormalizePayMethod(req.Method);
        }

        await conn.ExecuteAsync(
            @"UPDATE dbo.supplier_transactions
              SET amount = @Amount, description = @Description, method = @method
              WHERE id = @txId AND supplier_id = @supplierId AND shop_id = @shopId",
            new { txId, supplierId, shopId, req.Amount, req.Description, method });

        var typeLabel = type == "odeme" ? "Tedarikçi ödemesi" : "Tedarikçi iskontosu";
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "updated", "supplier_transaction", txId,
            $"{typeLabel} düzenlendi: {req.Amount:0.##} ₺", customerId: supplierId);

        return await GetSupplierLedgerAsync(supplierId);
    }

    public async Task<SupplierLedgerDto?> DeleteSupplierTransactionAsync(Guid supplierId, Guid txId, Guid? userId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();
        var tx = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT type, amount FROM dbo.supplier_transactions
              WHERE id=@txId AND supplier_id=@supplierId AND shop_id=@shopId",
            new { txId, supplierId, shopId });
        if (tx is null) return null;
        string type = tx.type;
        if (type is not ("odeme" or "iskonto"))
            throw new ArgumentException("Bu hareket silinemez. Alış/iade parça üzerinden yönetilir.");

        await conn.ExecuteAsync(
            @"DELETE FROM dbo.supplier_transactions
              WHERE id=@txId AND supplier_id=@supplierId AND shop_id=@shopId",
            new { txId, supplierId, shopId });

        var typeLabel = type == "odeme" ? "Tedarikçi ödemesi" : "Tedarikçi iskontosu";
        await ActivityLogService.LogAsync(
            conn, shopId, userId, "deleted", "supplier_transaction", txId,
            $"{typeLabel} silindi: {(decimal)tx.amount:0.##} ₺", customerId: supplierId);

        return await GetSupplierLedgerAsync(supplierId);
    }

    public async Task<IReadOnlyList<SupplierReportRow>> GetSupplierReportAsync(
        DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<SupplierReportRow>(
            @"SELECT s.id AS SupplierId, s.full_name AS SupplierName,
                     ISNULL(SUM(CASE WHEN st.type = N'alis' THEN st.amount ELSE 0 END), 0) AS TotalPurchases,
                     ISNULL(SUM(CASE WHEN st.type = N'iade' THEN st.amount ELSE 0 END), 0) AS TotalReturns,
                     SUM(CASE WHEN st.type IN (N'alis', N'iade') THEN 1 ELSE 0 END) AS TransactionCount
              FROM dbo.customers s
              INNER JOIN dbo.supplier_transactions st ON st.supplier_id = s.id
              WHERE s.shop_id = @shopId AND st.shop_id = @shopId AND s.is_supplier = 1
                AND st.created_at >= @from AND st.created_at < @to
                AND st.type IN (N'alis', N'iade')
              GROUP BY s.id, s.full_name
              HAVING SUM(CASE WHEN st.type IN (N'alis', N'iade') THEN 1 ELSE 0 END) > 0
              ORDER BY TotalPurchases DESC",
            new { shopId, from, to });
        return rows.ToList();
    }

    public async Task<IReadOnlyList<SupplierReportRow>> GetSupplierReportAsync(string period, DateOnly date)
    {
        var (from, toExclusive) = period == "weekly" ? WeekRange(date) : (date, date.AddDays(1));
        return await GetSupplierReportAsync(from, toExclusive.AddDays(-1));
    }

    private static (DateOnly From, DateOnly To) WeekRange(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek + 6) % 7;
        var monday = date.AddDays(-diff);
        return (monday, monday.AddDays(7));
    }

    /// <summary>
    /// Türkiye takvim günü aralığını UTC zaman penceresine çevirir (UTC+3, DST yok).
    /// cash-today ile aynı gün sınırı; tüm dönem raporlarında kullanılır.
    /// </summary>
    private static (DateTime From, DateTime To) InclusiveDateRange(DateOnly fromInclusive, DateOnly toInclusive)
    {
        if (toInclusive < fromInclusive)
            (fromInclusive, toInclusive) = (toInclusive, fromInclusive);
        var fromUtc = fromInclusive.ToDateTime(TimeOnly.MinValue).AddHours(-3);
        var toUtc = toInclusive.AddDays(1).ToDateTime(TimeOnly.MinValue).AddHours(-3);
        return (fromUtc, toUtc);
    }

    /// <summary>
    /// Tarih aralığında en çok kullanılan/satılan ürünler.
    /// Aynı isimli satırlar (stoktan + dışarıdan) tek satırda birleşir; aksi halde çift görünür.
    /// </summary>
    public async Task<IReadOnlyList<StockUsageReportRow>> GetStockUsageReportAsync(DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<StockUsageReportRow>(
            @"SELECT MAX(p.stock_product_id) AS StockProductId,
                     MIN(LTRIM(RTRIM(p.name))) AS Name,
                     MAX(sp.category) AS Category,
                     SUM(p.quantity) AS TotalQuantity,
                     SUM(p.quantity * p.unit_price) AS TotalRevenue,
                     COUNT(DISTINCT p.work_order_id) AS WorkOrderCount
              FROM dbo.work_order_parts p
              LEFT JOIN dbo.stock_products sp ON sp.id = p.stock_product_id
              WHERE p.shop_id = @shopId AND p.returned_at IS NULL
                AND p.created_at >= @from AND p.created_at < @to
                AND LTRIM(RTRIM(ISNULL(p.name, N''))) <> N''
              GROUP BY LTRIM(RTRIM(p.name)) COLLATE Turkish_CI_AS
              ORDER BY SUM(p.quantity) DESC",
            new { shopId, from, to });
        return rows.ToList();
    }

    /// <summary>Ürün bazlı alış/satış/kâr — aynı isimler tek satırda toplanır.</summary>
    public async Task<IReadOnlyList<StockPurchaseSaleRow>> GetStockPurchaseSaleReportAsync(DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        await plans.RequireFeatureAsync("stock");
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<StockPurchaseSaleRow>(
            @"SELECT MAX(p.stock_product_id) AS StockProductId,
                     MIN(LTRIM(RTRIM(p.name))) AS Name,
                     MAX(sp.category) AS Category,
                     SUM(p.quantity) AS TotalQuantity,
                     SUM(p.quantity * ISNULL(p.purchase_price, ISNULL(sp.purchase_price, 0))) AS TotalPurchaseAmount,
                     SUM(p.quantity * p.unit_price) AS TotalSaleAmount,
                     SUM(p.quantity * p.unit_price) - SUM(p.quantity * ISNULL(p.purchase_price, ISNULL(sp.purchase_price, 0))) AS Profit
              FROM dbo.work_order_parts p
              LEFT JOIN dbo.stock_products sp ON sp.id = p.stock_product_id
              WHERE p.shop_id = @shopId AND p.returned_at IS NULL
                AND p.created_at >= @from AND p.created_at < @to
                AND LTRIM(RTRIM(ISNULL(p.name, N''))) <> N''
              GROUP BY LTRIM(RTRIM(p.name)) COLLATE Turkish_CI_AS
              ORDER BY Profit DESC",
            new { shopId, from, to });
        return rows.ToList();
    }

    /// <summary>Ürün hareketleri — isim eşleşmesi (stok + dışarıdan birlikte).</summary>
    public async Task<IReadOnlyList<StockMovementDetailRow>> GetStockMovementDetailAsync(
        Guid? stockProductId, string name, DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        var nameKey = (name ?? string.Empty).Trim();
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<StockMovementDetailRow>(
            @"SELECT p.created_at AS Date, v.plate AS Plate, c.full_name AS CustomerName,
                     p.quantity AS Quantity, p.unit_price AS UnitPrice,
                     p.purchase_price AS PurchasePrice, sup.full_name AS SupplierName
              FROM dbo.work_order_parts p
              INNER JOIN dbo.work_orders wo ON wo.id = p.work_order_id
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              INNER JOIN dbo.customers c ON c.id = wo.customer_id
              LEFT JOIN dbo.customers sup ON sup.id = p.supplier_id
              WHERE p.shop_id = @shopId AND p.returned_at IS NULL
                AND p.created_at >= @from AND p.created_at < @to
                AND (
                      LTRIM(RTRIM(p.name)) COLLATE Turkish_CI_AS = @nameKey COLLATE Turkish_CI_AS
                   OR (@stockProductId IS NOT NULL AND p.stock_product_id = @stockProductId)
                )
              ORDER BY p.created_at DESC",
            new { shopId, stockProductId, nameKey, from, to });
        return rows.ToList();
    }

    /// <summary>Cari hesap (müşteri + tedarikçi) hareket özeti — dönemde hareketi olan hesaplar.</summary>
    public async Task<IReadOnlyList<AccountLedgerRow>> GetAccountLedgerReportAsync(DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<AccountLedgerRow>(
            @"SELECT c.id AS AccountId, c.full_name AS AccountName, N'musteri' AS AccountType,
                     ISNULL(ch.amt,0) AS TotalDebit, ISNULL(pay.amt,0) AS TotalCredit,
                     ISNULL(ch.cnt,0) + ISNULL(pay.cnt,0) AS MovementCount,
                     ISNULL(bal.balance, 0) AS CurrentBalance
              FROM dbo.customers c
              OUTER APPLY (
                  SELECT SUM(t.grand_total) amt, COUNT(*) cnt
                  FROM dbo.work_orders wo
                  INNER JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
                  WHERE wo.customer_id = c.id AND wo.shop_id = c.shop_id
                    AND wo.opened_at >= @from AND wo.opened_at < @to
              ) ch
              OUTER APPLY (
                  SELECT SUM(py.amount) amt, COUNT(*) cnt
                  FROM dbo.payments py
                  INNER JOIN dbo.work_orders wo2 ON wo2.id = py.work_order_id
                  WHERE wo2.customer_id = c.id AND py.shop_id = c.shop_id
                    AND py.paid_at >= @from AND py.paid_at < @to
              ) pay
              LEFT JOIN dbo.vw_CustomerBalance bal ON bal.customer_id = c.id AND bal.shop_id = c.shop_id
              WHERE c.shop_id = @shopId AND c.is_active = 1 AND c.is_customer = 1
                AND (ISNULL(ch.cnt,0) + ISNULL(pay.cnt,0)) > 0

              UNION ALL

              SELECT c.id AS AccountId, c.full_name AS AccountName, N'tedarikci' AS AccountType,
                     ISNULL(st.alis,0) AS TotalDebit,
                     ISNULL(st.odeme,0) + ISNULL(st.iade,0) + ISNULL(st.iskonto,0) AS TotalCredit,
                     ISNULL(st.cnt,0) AS MovementCount,
                     ISNULL(bal2.balance, c.opening_balance) AS CurrentBalance
              FROM dbo.customers c
              OUTER APPLY (
                  SELECT
                    SUM(CASE WHEN t.type=N'alis' THEN t.amount ELSE 0 END) alis,
                    SUM(CASE WHEN t.type=N'odeme' THEN t.amount ELSE 0 END) odeme,
                    SUM(CASE WHEN t.type=N'iade' THEN t.amount ELSE 0 END) iade,
                    SUM(CASE WHEN t.type=N'iskonto' THEN t.amount ELSE 0 END) iskonto,
                    COUNT(*) cnt
                  FROM dbo.supplier_transactions t
                  WHERE t.supplier_id = c.id AND t.shop_id = c.shop_id
                    AND t.created_at >= @from AND t.created_at < @to
              ) st
              LEFT JOIN dbo.vw_SupplierBalance bal2 ON bal2.supplier_id = c.id AND bal2.shop_id = c.shop_id
              WHERE c.shop_id = @shopId AND c.is_active = 1 AND c.is_supplier = 1
                AND ISNULL(st.cnt,0) > 0

              ORDER BY TotalDebit DESC",
            new { shopId, from, to });
        return rows.ToList();
    }

    /// <summary>Bir müşterinin cari hesabındaki tek tek hareketler (iş emri borcu + tahsilat).</summary>
    public async Task<IReadOnlyList<CustomerLedgerEntryDto>> GetCustomerLedgerDetailAsync(
        Guid customerId, DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        await using var conn = await tenant.OpenAsync();
        var rows = await conn.QueryAsync<CustomerLedgerEntryDto>(
            @"SELECT wo.opened_at AS Date, N'borc' AS Type,
                     CONCAT(N'İş emri #', wo.order_no, N' — ', v.plate) AS Description,
                     t.grand_total AS Amount, v.plate AS Plate
              FROM dbo.work_orders wo
              INNER JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              WHERE wo.customer_id = @customerId AND wo.shop_id = @shopId
                AND wo.opened_at >= @from AND wo.opened_at < @to

              UNION ALL

              SELECT py.paid_at AS Date, N'tahsilat' AS Type,
                     CONCAT(N'Tahsilat (', py.method, N') — ', v2.plate) AS Description,
                     py.amount AS Amount, v2.plate AS Plate
              FROM dbo.payments py
              INNER JOIN dbo.work_orders wo2 ON wo2.id = py.work_order_id
              INNER JOIN dbo.vehicles v2 ON v2.id = wo2.vehicle_id
              WHERE wo2.customer_id = @customerId AND py.shop_id = @shopId
                AND py.paid_at >= @from AND py.paid_at < @to

              ORDER BY Date DESC",
            new { shopId, customerId, from, to });
        return rows.ToList();
    }

    /// <summary>
    /// Genel satış/ciro raporu.
    /// Ciro / iskonto / açık bakiye: dönemde açılan iş emirleri (opened_at).
    /// Tahsilat + yöntemler: dönemde alınan ödemeler (paid_at) — birbirine eşit olmalı.
    /// </summary>
    public async Task<SalesReportDto> GetSalesReportAsync(DateOnly fromInclusive, DateOnly toInclusive)
    {
        var shopId = tenant.RequireShopId();
        var (from, to) = InclusiveDateRange(fromInclusive, toInclusive);
        await using var conn = await tenant.OpenAsync();

        var totals = await conn.QuerySingleAsync<dynamic>(
            @"SELECT COUNT(DISTINCT wo.id) AS WorkOrderCount,
                     ISNULL(SUM(t.grand_total),0) AS TotalRevenue,
                     ISNULL(SUM(t.discount_amount),0) AS TotalDiscount,
                     ISNULL(SUM(CASE WHEN t.grand_total - t.paid_total > 0.005
                                     THEN t.grand_total - t.paid_total ELSE 0 END), 0) AS TotalOutstanding
              FROM dbo.work_orders wo
              INNER JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE wo.shop_id=@shopId AND wo.opened_at >= @from AND wo.opened_at < @to",
            new { shopId, from, to });

        var methods = await conn.QuerySingleAsync<dynamic>(
            @"SELECT
                 ISNULL(SUM(CASE WHEN method=N'nakit' THEN amount ELSE 0 END),0) AS Nakit,
                 ISNULL(SUM(CASE WHEN method=N'kart' THEN amount ELSE 0 END),0) AS Kart,
                 ISNULL(SUM(CASE WHEN method=N'havale' THEN amount ELSE 0 END),0) AS Havale,
                 ISNULL(SUM(CASE WHEN method NOT IN (N'nakit',N'kart',N'havale') THEN amount ELSE 0 END),0) AS Diger
              FROM dbo.payments WHERE shop_id=@shopId AND paid_at>=@from AND paid_at<@to",
            new { shopId, from, to });

        var topServices = (await conn.QueryAsync<TopServiceRow>(
            @"SELECT TOP 10 s.title AS Title, COUNT(*) AS Count, SUM(s.price) AS TotalAmount
              FROM dbo.services s
              INNER JOIN dbo.work_orders wo ON wo.id = s.work_order_id
              WHERE s.shop_id=@shopId AND wo.opened_at >= @from AND wo.opened_at < @to
              GROUP BY s.title
              ORDER BY SUM(s.price) DESC",
            new { shopId, from, to })).ToList();

        decimal nakit = (decimal)methods.Nakit;
        decimal kart = (decimal)methods.Kart;
        decimal havale = (decimal)methods.Havale;
        decimal diger = (decimal)methods.Diger;

        return new SalesReportDto(
            (int)totals.WorkOrderCount,
            (decimal)totals.TotalRevenue,
            nakit + kart + havale + diger,
            (decimal)totals.TotalDiscount,
            (decimal)totals.TotalOutstanding,
            nakit, kart, havale, diger,
            topServices);
    }

    public async Task<WorkOrderImageDto?> AddWorkOrderImageAsync(
        Guid woId, IFormFile file, string imageType, Guid userId, Guid? complaintId = null, Guid? serviceId = null)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var woExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId", new { woId, shopId });
        if (woExists == 0) return null;

        if (file.Length > MaxImageBytes)
            throw new ImageTooLargeException();

        var count = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.work_order_images WHERE work_order_id=@woId AND shop_id=@shopId", new { woId, shopId });
        if (count >= MaxImagesPerWorkOrder)
            throw new ImageLimitExceededException();

        var type = AllowedImageTypes.Contains(imageType) ? imageType : "diger";
        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(ext)) ext = ".jpg";
        var id = Guid.NewGuid();

        var relDir = $"uploads/{shopId}/{woId}";
        var absDir = Path.Combine(UploadsRoot, shopId.ToString(), woId.ToString());
        Directory.CreateDirectory(absDir);
        var fileName = $"{id}{ext}";
        var absPath = Path.Combine(absDir, fileName);
        await using (var stream = new FileStream(absPath, FileMode.Create))
            await file.CopyToAsync(stream);

        var relPath = $"{relDir}/{fileName}";
        var now = DateTime.UtcNow;
        await conn.ExecuteAsync(
            @"INSERT INTO dbo.work_order_images (id, shop_id, work_order_id, image_type, file_path, mime_type, uploaded_by, created_at, complaint_id, service_id)
              VALUES (@id, @shopId, @woId, @type, @relPath, @mimeType, @userId, @now, @complaintId, @serviceId)",
            new { id, shopId, woId, type, relPath, mimeType = file.ContentType, userId, now, complaintId, serviceId });

        return new WorkOrderImageDto(id, type, $"/{relPath}", now, complaintId, serviceId);
    }

    public async Task<IReadOnlyList<WorkOrderImageDto>?> GetWorkOrderImagesAsync(Guid woId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var woExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.work_orders WHERE id=@woId AND shop_id=@shopId", new { woId, shopId });
        if (woExists == 0) return null;

        var rows = await conn.QueryAsync<dynamic>(
            @"SELECT id AS Id, image_type AS ImageType, file_path AS FilePath, created_at AS CreatedAt,
                     complaint_id AS ComplaintId, service_id AS ServiceId
              FROM dbo.work_order_images WHERE work_order_id=@woId AND shop_id=@shopId
              ORDER BY created_at DESC",
            new { woId, shopId });
        return rows.Select(r => new WorkOrderImageDto(
            r.Id, (string)r.ImageType, $"/{(string)r.FilePath}", (DateTime)r.CreatedAt,
            (Guid?)r.ComplaintId, (Guid?)r.ServiceId)).ToList();
    }

    public async Task<bool> DeleteWorkOrderImageAsync(Guid woId, Guid imageId)
    {
        var shopId = tenant.RequireShopId();
        await using var conn = await tenant.OpenAsync();

        var relPath = await conn.ExecuteScalarAsync<string?>(
            "SELECT file_path FROM dbo.work_order_images WHERE id=@imageId AND work_order_id=@woId AND shop_id=@shopId",
            new { imageId, woId, shopId });
        if (relPath is null) return false;

        var n = await conn.ExecuteAsync(
            "DELETE FROM dbo.work_order_images WHERE id=@imageId AND work_order_id=@woId AND shop_id=@shopId",
            new { imageId, woId, shopId });

        if (n > 0)
        {
            try
            {
                var absPath = PhysicalFromRelative(relPath);
                if (File.Exists(absPath)) File.Delete(absPath);
            }
            catch
            {
                // Fiziksel dosya silinemezse yut: DB kaydi zaten temizlendi.
            }
        }
        return n > 0;
    }

    public async Task<AppUpdateInfoDto?> GetAppUpdateInfoAsync()
    {
        await using var conn = await tenant.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<AppUpdateInfoDto>(
            @"SELECT latest_version AS LatestVersion,
                     latest_version_code AS LatestVersionCode,
                     min_version_code AS MinVersionCode,
                     store_url AS StoreUrl,
                     release_notes AS ReleaseNotes
              FROM dbo.app_release WHERE id = 1");
    }
}
