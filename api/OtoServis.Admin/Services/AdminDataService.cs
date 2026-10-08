using System.Security.Claims;
using Dapper;
using OtoServis.Admin.Models;

namespace OtoServis.Admin.Services;

public class AdminDataService(DbFactory db, TenantContext tenant)
{
    private Guid ShopId => tenant.IsSet
        ? tenant.ShopId
        : throw new InvalidOperationException("Servis seçilmedi.");

    /// <summary>Türkiye takvim günü → UTC penceresi (UTC+3). API raporlarıyla aynı sınır.</summary>
    private static (DateTime? FromUtc, DateTime? ToUtc) TurkeyDateRange(DateTime? from, DateTime? to)
    {
        DateTime? fromUtc = from.HasValue
            ? DateOnly.FromDateTime(from.Value).ToDateTime(TimeOnly.MinValue).AddHours(-3)
            : null;
        DateTime? toUtc = to.HasValue
            ? DateOnly.FromDateTime(to.Value).AddDays(1).ToDateTime(TimeOnly.MinValue).AddHours(-3)
            : null;
        return (fromUtc, toUtc);
    }

    public void BindTenant(ClaimsPrincipal user)
    {
        var shopId = user.GetShopId();
        if (shopId is null) return;
        tenant.Set(
            user.GetUserId(),
            shopId.Value,
            user.GetShopRole() ?? "personel",
            user.GetShopName() ?? "");
    }

    public async Task<DashboardViewModel?> GetDashboardAsync()
    {
        await using var conn = await db.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<DashboardViewModel>(
            @"SELECT shop_name AS ShopName, waiting AS Waiting, in_progress AS InProgress,
                     customers AS Customers, vehicles AS Vehicles, staff_count AS StaffCount,
                     low_stock AS LowStock
              FROM dbo.vw_ShopDashboard WHERE shop_id = @ShopId",
            new { ShopId });
    }

    public async Task<IReadOnlyList<CustomerListItem>> GetCustomersAsync(string? search)
    {
        await using var conn = await db.OpenAsync();
        var sql = @"SELECT id AS Id, full_name AS FullName, phone AS Phone,
                           address AS Address, city AS City, customer_type AS CustomerType,
                           is_supplier AS IsSupplier
                    FROM dbo.customers
                    WHERE shop_id = @ShopId AND is_active = 1 AND is_customer = 1";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (full_name LIKE @q OR phone LIKE @q)";
        sql += " ORDER BY full_name";
        var rows = await conn.QueryAsync<CustomerListItem>(sql,
            new { ShopId, q = $"%{search?.Trim()}%" });
        return rows.ToList();
    }

    public async Task<IReadOnlyList<CustomerTypeOption>> GetCustomerTypesAsync()
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<CustomerTypeOption>(
            "SELECT code AS Code, label AS Label FROM dbo.ref_customer_types ORDER BY code");
        return rows.ToList();
    }

    public async Task<CustomerFormViewModel?> GetCustomerFormAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        var row = await conn.QuerySingleOrDefaultAsync<CustomerFormViewModel>(
            @"SELECT id AS Id, full_name AS FullName, phone AS Phone, phone2 AS Phone2,
                     email AS Email, customer_type AS CustomerType, company_name AS CompanyName,
                     tc_no AS TcNo, tax_no AS TaxNo, address AS Address, city AS City,
                     district AS District, notes AS Notes, is_supplier AS IsSupplier
              FROM dbo.customers
              WHERE id = @id AND shop_id = @ShopId AND is_active = 1",
            new { id, ShopId });
        if (row is null) return null;
        row.CustomerTypes = await GetCustomerTypesAsync();
        return row;
    }

    public async Task<(bool Ok, string? Error)> CreateCustomerAsync(CustomerFormViewModel model)
    {
        if (await PhoneInUseAsync(model.Phone, null))
            return (false, "Bu telefon numarası zaten kayıtlı.");

        var id = Guid.NewGuid();
        await using var conn = await db.OpenAsync();
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.customers
                  (id, shop_id, customer_type, full_name, company_name, phone, phone2, email,
                   tc_no, tax_no, address, city, district, notes, is_supplier, created_by)
                  VALUES
                  (@id, @ShopId, @CustomerType, @FullName, @CompanyName, @Phone, @Phone2, @Email,
                   @TcNo, @TaxNo, @Address, @City, @District, @Notes, @IsSupplier, @UserId)",
                MapCustomerParams(id, model));
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return (false, "Bu telefon numarası zaten kayıtlı.");
        }
        return (true, null);
    }

    public async Task<(bool Ok, string? Error)> UpdateCustomerAsync(Guid id, CustomerFormViewModel model)
    {
        if (await PhoneInUseAsync(model.Phone, id))
            return (false, "Bu telefon numarası başka bir müşteride kayıtlı.");

        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.customers SET
                customer_type = @CustomerType, full_name = @FullName, company_name = @CompanyName,
                phone = @Phone, phone2 = @Phone2, email = @Email, tc_no = @TcNo, tax_no = @TaxNo,
                address = @Address, city = @City, district = @District, notes = @Notes,
                is_supplier = @IsSupplier, updated_at = SYSUTCDATETIME()
              WHERE id = @id AND shop_id = @ShopId AND is_active = 1",
            MapCustomerParams(id, model));
        if (n == 0) return (false, "Müşteri bulunamadı.");
        return (true, null);
    }

    public async Task<bool> DeleteCustomerAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.customers SET is_active = 0, updated_at = SYSUTCDATETIME()
              WHERE id = @id AND shop_id = @ShopId AND is_active = 1",
            new { id, ShopId });
        return n > 0;
    }

    private async Task<bool> PhoneInUseAsync(string phone, Guid? excludeId)
    {
        await using var conn = await db.OpenAsync();
        var sql = @"SELECT COUNT(1) FROM dbo.customers
                    WHERE shop_id = @ShopId AND phone = @phone AND is_active = 1";
        if (excludeId.HasValue) sql += " AND id <> @excludeId";
        var count = await conn.ExecuteScalarAsync<int>(sql,
            new { ShopId, phone = phone.Trim(), excludeId });
        return count > 0;
    }

    private object MapCustomerParams(Guid id, CustomerFormViewModel model) => new
    {
        id,
        ShopId,
        UserId = tenant.UserId,
        model.CustomerType,
        model.FullName,
        CompanyName = string.IsNullOrWhiteSpace(model.CompanyName) ? null : model.CompanyName.Trim(),
        Phone = model.Phone.Trim(),
        Phone2 = string.IsNullOrWhiteSpace(model.Phone2) ? null : model.Phone2.Trim(),
        Email = string.IsNullOrWhiteSpace(model.Email) ? null : model.Email.Trim(),
        TcNo = string.IsNullOrWhiteSpace(model.TcNo) ? null : model.TcNo.Trim(),
        TaxNo = string.IsNullOrWhiteSpace(model.TaxNo) ? null : model.TaxNo.Trim(),
        Address = string.IsNullOrWhiteSpace(model.Address) ? null : model.Address.Trim(),
        City = string.IsNullOrWhiteSpace(model.City) ? null : model.City.Trim(),
        District = string.IsNullOrWhiteSpace(model.District) ? null : model.District.Trim(),
        Notes = string.IsNullOrWhiteSpace(model.Notes) ? null : model.Notes.Trim(),
        model.IsSupplier,
    };

    public async Task<ReportsHubViewModel> GetReportsHubAsync()
    {
        await using var conn = await db.OpenAsync();

        var statusCounts = (await conn.QueryAsync<StatusCountRow>(
            @"SELECT wo.status AS Status, r.label AS Label, COUNT(*) AS Count
              FROM dbo.work_orders wo
              INNER JOIN dbo.ref_work_order_status r ON r.code = wo.status
              WHERE wo.shop_id = @ShopId
              GROUP BY wo.status, r.label, r.sort_order
              ORDER BY r.sort_order",
            new { ShopId })).ToList();

        // Türkiye ay başı (UTC+3) → UTC: GETUTCDATE()+3h ile ay, sonra -3h
        var month = await conn.QuerySingleAsync<dynamic>(
            @"DECLARE @trMonthStart date = DATEFROMPARTS(
                  YEAR(DATEADD(HOUR, 3, GETUTCDATE())),
                  MONTH(DATEADD(HOUR, 3, GETUTCDATE())),
                  1);
              DECLARE @monthStartUtc datetime2 = DATEADD(HOUR, -3, CAST(@trMonthStart AS datetime2));
              SELECT COUNT(*) AS Cnt, ISNULL(SUM(t.grand_total),0) AS Revenue,
                     (SELECT COUNT(DISTINCT wo2.vehicle_id) FROM dbo.work_orders wo2
                      WHERE wo2.shop_id = @ShopId
                        AND wo2.opened_at >= @monthStartUtc) AS VehiclesServiced,
                     ((SELECT COUNT(*) FROM dbo.services s WHERE s.shop_id = @ShopId
                       AND s.created_at >= @monthStartUtc) +
                      (SELECT COUNT(*) FROM dbo.work_order_parts p WHERE p.shop_id = @ShopId
                       AND p.created_at >= @monthStartUtc)
                     ) AS Operations
              FROM dbo.work_orders wo
              LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE wo.shop_id = @ShopId
                AND wo.opened_at >= @monthStartUtc",
            new { ShopId });

        return new ReportsHubViewModel
        {
            StatusCounts = statusCounts,
            MonthWorkOrders = (int)month.Cnt,
            MonthRevenue = (decimal)month.Revenue,
            MonthVehiclesServiced = (int)month.VehiclesServiced,
            MonthOperations = (int)month.Operations,
        };
    }

    public async Task<WorkOrdersReportViewModel> GetWorkOrdersReportAsync(
        string? status = null, DateTime? from = null, DateTime? to = null)
    {
        await using var conn = await db.OpenAsync();
        var (fromDate, toExclusive) = TurkeyDateRange(from, to);

        var statusSql = @"SELECT wo.status AS Status, r.label AS Label, COUNT(*) AS Count
              FROM dbo.work_orders wo
              INNER JOIN dbo.ref_work_order_status r ON r.code = wo.status
              WHERE wo.shop_id = @ShopId";
        if (fromDate.HasValue) statusSql += " AND wo.opened_at >= @fromDate";
        if (toExclusive.HasValue) statusSql += " AND wo.opened_at < @toExclusive";
        statusSql += " GROUP BY wo.status, r.label, r.sort_order ORDER BY r.sort_order";

        var statusOptions = (await conn.QueryAsync<StatusCountRow>(statusSql,
            new { ShopId, fromDate, toExclusive })).ToList();

        var sql = @"SELECT wo.id AS Id, wo.order_no AS OrderNo, wo.status AS Status,
                           v.plate AS Plate, c.full_name AS CustomerName,
                           t.grand_total AS GrandTotal, t.paid_total AS PaidTotal,
                           wo.opened_at AS OpenedAt
                    FROM dbo.work_orders wo
                    INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
                    INNER JOIN dbo.customers c ON c.id = wo.customer_id
                    LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
                    WHERE wo.shop_id = @ShopId";
        if (!string.IsNullOrWhiteSpace(status))
            sql += " AND wo.status = @status";
        if (fromDate.HasValue)
            sql += " AND wo.opened_at >= @fromDate";
        if (toExclusive.HasValue)
            sql += " AND wo.opened_at < @toExclusive";
        sql += " ORDER BY wo.opened_at DESC";

        var rows = (await conn.QueryAsync<WorkOrderReportRow>(sql,
            new { ShopId, status, fromDate, toExclusive })).ToList();

        return new WorkOrdersReportViewModel
        {
            StatusFilter = status,
            StatusOptions = statusOptions,
            Rows = rows,
            Count = rows.Count,
            TotalRevenue = rows.Sum(r => r.GrandTotal),
            TotalPaid = rows.Sum(r => r.PaidTotal),
            DateFrom = from,
            DateTo = to,
        };
    }

    public async Task<RevenueReportViewModel> GetRevenueReportAsync(DateTime? from = null, DateTime? to = null)
    {
        await using var conn = await db.OpenAsync();
        var (fromDate, toExclusive) = TurkeyDateRange(from, to);
        var hasRange = fromDate.HasValue || toExclusive.HasValue;

        var totalsSql = @"SELECT COUNT(*) AS WorkOrderCount,
                     ISNULL(SUM(t.labor_total),0) AS LaborTotal,
                     ISNULL(SUM(t.parts_total),0) AS PartsTotal,
                     ISNULL(SUM(wo.discount_amount),0) AS DiscountTotal,
                     ISNULL(SUM(t.grand_total),0) AS GrandTotal,
                     ISNULL(SUM(t.paid_total),0) AS PaidTotal
              FROM dbo.work_orders wo
              LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE wo.shop_id = @ShopId";
        if (fromDate.HasValue) totalsSql += " AND wo.opened_at >= @fromDate";
        if (toExclusive.HasValue) totalsSql += " AND wo.opened_at < @toExclusive";

        var row = await conn.QuerySingleAsync<RevenueReportViewModel>(totalsSql,
            new { ShopId, fromDate, toExclusive });

        var monthlySql = @"SELECT YEAR(wo.opened_at) AS Year, MONTH(wo.opened_at) AS Month,
                     COUNT(*) AS WorkOrderCount,
                     ISNULL(SUM(t.grand_total),0) AS Revenue,
                     ISNULL(SUM(t.paid_total),0) AS Paid
              FROM dbo.work_orders wo
              LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
              WHERE wo.shop_id = @ShopId";
        if (hasRange)
        {
            if (fromDate.HasValue) monthlySql += " AND wo.opened_at >= @fromDate";
            if (toExclusive.HasValue) monthlySql += " AND wo.opened_at < @toExclusive";
        }
        else
        {
            monthlySql += " AND wo.opened_at >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETUTCDATE()), MONTH(GETUTCDATE()), 1))";
        }
        monthlySql += " GROUP BY YEAR(wo.opened_at), MONTH(wo.opened_at) ORDER BY Year DESC, Month DESC";

        var monthly = (await conn.QueryAsync<MonthlyRevenueRow>(monthlySql,
            new { ShopId, fromDate, toExclusive })).ToList();

        foreach (var m in monthly)
            m.MonthLabel = new DateTime(m.Year, m.Month, 1).ToString("MMMM yyyy", new System.Globalization.CultureInfo("tr-TR"));

        row.MonthlyRows = monthly;
        row.DateFrom = from;
        row.DateTo = to;
        return row;
    }

    public async Task<StockReportViewModel> GetStockReportAsync(
        string? category = null, DateTime? from = null, DateTime? to = null)
    {
        await using var conn = await db.OpenAsync();
        var (fromDate, toExclusive) = TurkeyDateRange(from, to);

        var categories = (await conn.QueryAsync<StockCategoryOption>(
            @"SELECT code AS Code, label AS Label FROM dbo.ref_stock_categories ORDER BY sort_order",
            new { })).ToList();

        // from/to burada ürünün stoğa eklendiği tarihi (created_at) filtreler —
        // stok raporu bir "an" görüntüsü olduğu için tarih aralığı en anlamlı şekilde
        // "bu dönemde kataloğa eklenen ürünler" olarak yorumlanmıştır.
        var sql = @"SELECT sp.id AS Id, sp.name AS Name, sp.code AS Code,
                           sp.category AS Category, rc.label AS CategoryLabel,
                           sp.quantity AS Quantity, sp.min_quantity AS MinQuantity,
                           sp.price AS Price
                    FROM dbo.stock_products sp
                    INNER JOIN dbo.ref_stock_categories rc ON rc.code = sp.category
                    WHERE sp.shop_id = @ShopId AND sp.is_active = 1";
        if (!string.IsNullOrWhiteSpace(category))
            sql += " AND sp.category = @category";
        if (fromDate.HasValue)
            sql += " AND sp.created_at >= @fromDate";
        if (toExclusive.HasValue)
            sql += " AND sp.created_at < @toExclusive";
        sql += " ORDER BY sp.name";

        var rows = (await conn.QueryAsync<StockReportRow>(sql,
            new { ShopId, category, fromDate, toExclusive })).ToList();

        return new StockReportViewModel
        {
            CategoryFilter = category,
            Categories = categories,
            Rows = rows,
            TotalItems = rows.Count,
            LowStockCount = rows.Count(r => r.IsLowStock),
            TotalStockValue = rows.Sum(r => r.StockValue),
            DateFrom = from,
            DateTo = to,
        };
    }

    public async Task<CustomerReportViewModel> GetCustomerReportAsync(DateTime? from = null, DateTime? to = null)
    {
        await using var conn = await db.OpenAsync();
        var (fromDate, toExclusive) = TurkeyDateRange(from, to);

        // VehicleCount müşterinin sahip olduğu tüm aktif araçları gösterir (tarihten bağımsız);
        // WorkOrderCount/TotalRevenue/PaidTotal, from/to verildiğinde o aralıkta açılan iş emirlerine göre süzülür.
        var rows = (await conn.QueryAsync<CustomerReportRow>(
            @"SELECT c.id AS Id, c.full_name AS FullName, c.phone AS Phone,
                     c.customer_type AS CustomerType,
                     (SELECT COUNT(*) FROM dbo.vehicles v WHERE v.customer_id = c.id AND v.is_active = 1) AS VehicleCount,
                     (SELECT COUNT(*) FROM dbo.work_orders wo WHERE wo.customer_id = c.id
                        AND (@fromDate IS NULL OR wo.opened_at >= @fromDate)
                        AND (@toExclusive IS NULL OR wo.opened_at < @toExclusive)) AS WorkOrderCount,
                     ISNULL((
                         SELECT SUM(t.grand_total)
                         FROM dbo.work_orders wo
                         LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
                         WHERE wo.customer_id = c.id
                           AND (@fromDate IS NULL OR wo.opened_at >= @fromDate)
                           AND (@toExclusive IS NULL OR wo.opened_at < @toExclusive)
                     ), 0) AS TotalRevenue,
                     ISNULL((
                         SELECT SUM(t.paid_total)
                         FROM dbo.work_orders wo
                         LEFT JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
                         WHERE wo.customer_id = c.id
                           AND (@fromDate IS NULL OR wo.opened_at >= @fromDate)
                           AND (@toExclusive IS NULL OR wo.opened_at < @toExclusive)
                     ), 0) AS PaidTotal
              FROM dbo.customers c
              WHERE c.shop_id = @ShopId AND c.is_active = 1
              ORDER BY TotalRevenue DESC, c.full_name",
            new { ShopId, fromDate, toExclusive })).ToList();

        return new CustomerReportViewModel
        {
            Rows = rows,
            TotalCustomers = rows.Count,
            TotalRevenue = rows.Sum(r => r.TotalRevenue),
            TotalPaid = rows.Sum(r => r.PaidTotal),
            DateFrom = from,
            DateTo = to,
        };
    }

    public async Task<IReadOnlyList<SupplierListItem>> GetSuppliersAsync(string? search)
    {
        await using var conn = await db.OpenAsync();
        var sql = @"SELECT s.id AS Id, s.full_name AS Name, s.contact_person AS Contact, NULLIF(s.phone, N'') AS Phone,
                           s.email AS Email, ISNULL(b.balance, s.opening_balance) AS Balance
                    FROM dbo.customers s
                    LEFT JOIN dbo.vw_SupplierBalance b ON b.supplier_id = s.id AND b.shop_id = s.shop_id
                    WHERE s.shop_id = @ShopId AND s.is_active = 1 AND s.is_supplier = 1";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (s.full_name LIKE @q OR s.phone LIKE @q)";
        sql += " ORDER BY s.full_name";
        var rows = await conn.QueryAsync<SupplierListItem>(sql,
            new { ShopId, q = $"%{search?.Trim()}%" });
        return rows.ToList();
    }

    public async Task<SupplierFormViewModel?> GetSupplierFormAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<SupplierFormViewModel>(
            @"SELECT id AS Id, full_name AS Name, contact_person AS Contact, NULLIF(phone, N'') AS Phone, email AS Email,
                     address AS Address, tax_no AS TaxNo, opening_balance AS OpeningBalance
              FROM dbo.customers
              WHERE id = @id AND shop_id = @ShopId AND is_active = 1 AND is_supplier = 1",
            new { id, ShopId });
    }

    public async Task<(bool Ok, string? Error)> CreateSupplierAsync(SupplierFormViewModel model)
    {
        var id = Guid.NewGuid();
        await using var conn = await db.OpenAsync();
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.customers
                    (id, shop_id, customer_type, full_name, contact_person, phone, email, address, tax_no, opening_balance, is_supplier, is_customer, created_by)
                  VALUES
                    (@id, @ShopId, N'kurumsal', @Name, @Contact, @Phone, @Email, @Address, @TaxNo, @OpeningBalance, 1, 0, @UserId)",
                MapSupplierParams(id, model));
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return (false, "Bu telefon numarasıyla kayıtlı bir cari zaten var.");
        }
        return (true, null);
    }

    public async Task<(bool Ok, string? Error)> UpdateSupplierAsync(Guid id, SupplierFormViewModel model)
    {
        await using var conn = await db.OpenAsync();
        int n;
        try
        {
            n = await conn.ExecuteAsync(
                @"UPDATE dbo.customers SET
                    full_name = @Name, contact_person = @Contact, phone = @Phone, email = @Email,
                    address = @Address, tax_no = @TaxNo, updated_at = SYSUTCDATETIME()
                  WHERE id = @id AND shop_id = @ShopId AND is_active = 1 AND is_supplier = 1",
                MapSupplierParams(id, model));
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return (false, "Bu telefon numarasıyla kayıtlı bir cari zaten var.");
        }
        if (n == 0) return (false, "Cari bulunamadı.");
        return (true, null);
    }

    private object MapSupplierParams(Guid id, SupplierFormViewModel model) => new
    {
        id,
        ShopId,
        UserId = tenant.UserId,
        model.Name,
        Contact = string.IsNullOrWhiteSpace(model.Contact) ? null : model.Contact.Trim(),
        Phone = string.IsNullOrWhiteSpace(model.Phone) ? "" : model.Phone.Trim(),
        Email = string.IsNullOrWhiteSpace(model.Email) ? null : model.Email.Trim(),
        Address = string.IsNullOrWhiteSpace(model.Address) ? null : model.Address.Trim(),
        TaxNo = string.IsNullOrWhiteSpace(model.TaxNo) ? null : model.TaxNo.Trim(),
        model.OpeningBalance,
    };

    public async Task<SupplierLedgerViewModel?> GetSupplierLedgerAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        var supplier = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT s.id AS Id, s.full_name AS Name, NULLIF(s.phone, N'') AS Phone,
                     ISNULL(b.balance, s.opening_balance) AS Balance
              FROM dbo.customers s
              LEFT JOIN dbo.vw_SupplierBalance b ON b.supplier_id = s.id AND b.shop_id = s.shop_id
              WHERE s.id = @id AND s.shop_id = @ShopId AND s.is_active = 1 AND s.is_supplier = 1",
            new { id, ShopId });
        if (supplier is null) return null;

        var transactions = (await conn.QueryAsync<SupplierTransactionRow>(
            @"SELECT id AS Id, type AS Type, amount AS Amount, description AS Description, created_at AS CreatedAt
              FROM dbo.supplier_transactions
              WHERE supplier_id = @id AND shop_id = @ShopId
              ORDER BY created_at DESC",
            new { id, ShopId })).ToList();

        return new SupplierLedgerViewModel
        {
            SupplierId = (Guid)supplier.Id,
            SupplierName = (string)supplier.Name,
            Phone = (string?)supplier.Phone,
            Balance = (decimal)supplier.Balance,
            Transactions = transactions,
            Payment = new RecordPaymentViewModel { SupplierId = (Guid)supplier.Id },
        };
    }

    public async Task<(bool Ok, string? Error)> RecordPaymentAsync(RecordPaymentViewModel model)
    {
        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"INSERT INTO dbo.supplier_transactions (shop_id, supplier_id, type, amount, description, created_by)
              SELECT @ShopId, @SupplierId, N'odeme', @Amount, @Description, @UserId
              WHERE EXISTS (SELECT 1 FROM dbo.customers WHERE id=@SupplierId AND shop_id=@ShopId AND is_active=1 AND is_supplier=1)",
            new { ShopId, model.SupplierId, model.Amount, model.Description, UserId = tenant.UserId });
        if (n == 0) return (false, "Cari bulunamadı.");
        return (true, null);
    }

    public async Task<SupplierReportViewModel> GetSupplierReportAsync(string? period, DateTime? date)
    {
        var p = period == "weekly" ? "weekly" : "daily";
        var turkeyToday = DateTime.UtcNow.AddHours(3).Date;
        var d = (date ?? turkeyToday).Date;
        DateOnly fromDay, toDay;
        if (p == "weekly")
        {
            var diff = ((int)d.DayOfWeek + 6) % 7;
            fromDay = DateOnly.FromDateTime(d.AddDays(-diff));
            toDay = fromDay.AddDays(6);
        }
        else
        {
            fromDay = DateOnly.FromDateTime(d);
            toDay = fromDay;
        }
        var (from, to) = TurkeyDateRange(fromDay.ToDateTime(TimeOnly.MinValue), toDay.ToDateTime(TimeOnly.MinValue));

        await using var conn = await db.OpenAsync();
        var rows = (await conn.QueryAsync<SupplierReportRow>(
            @"SELECT s.id AS SupplierId, s.full_name AS SupplierName,
                     ISNULL(SUM(CASE WHEN st.type = N'alis' THEN st.amount ELSE 0 END), 0) AS TotalPurchases,
                     ISNULL(SUM(CASE WHEN st.type = N'iade' THEN st.amount ELSE 0 END), 0) AS TotalReturns,
                     SUM(CASE WHEN st.type IN (N'alis', N'iade') THEN 1 ELSE 0 END) AS TransactionCount
              FROM dbo.customers s
              INNER JOIN dbo.supplier_transactions st ON st.supplier_id = s.id
              WHERE s.shop_id = @ShopId AND st.shop_id = @ShopId AND s.is_supplier = 1
                AND st.created_at >= @from AND st.created_at < @to
                AND st.type IN (N'alis', N'iade')
              GROUP BY s.id, s.full_name
              HAVING SUM(CASE WHEN st.type IN (N'alis', N'iade') THEN 1 ELSE 0 END) > 0
              ORDER BY TotalPurchases DESC",
            new { ShopId, from, to })).ToList();

        return new SupplierReportViewModel
        {
            Period = p,
            Date = d,
            Rows = rows,
            TotalPurchases = rows.Sum(r => r.TotalPurchases),
            TotalReturns = rows.Sum(r => r.TotalReturns),
        };
    }

    public async Task<IReadOnlyList<VehicleListItem>> GetVehiclesAsync(string? search, Guid? customerId)
    {
        await using var conn = await db.OpenAsync();
        var sql = @"SELECT v.id AS Id, v.plate AS Plate, v.brand AS Brand, v.model AS Model,
                           CAST(v.model_year AS int) AS Year, v.customer_id AS CustomerId,
                           c.full_name AS CustomerName, v.is_active AS IsActive
                    FROM dbo.vehicles v
                    INNER JOIN dbo.customers c ON c.id = v.customer_id
                    WHERE v.shop_id = @ShopId AND v.is_active = 1";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (v.plate LIKE @q OR v.brand LIKE @q OR v.model LIKE @q OR c.full_name LIKE @q)";
        if (customerId.HasValue)
            sql += " AND v.customer_id = @customerId";
        sql += " ORDER BY v.plate";
        var rows = await conn.QueryAsync<VehicleListItem>(sql,
            new { ShopId, q = $"%{search?.Trim()}%", customerId });
        return rows.ToList();
    }

    public async Task<string?> GetCustomerNameAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        return await conn.ExecuteScalarAsync<string?>(
            "SELECT full_name FROM dbo.customers WHERE id = @id AND shop_id = @ShopId AND is_active = 1",
            new { id, ShopId });
    }

    public async Task<List<Microsoft.AspNetCore.Mvc.Rendering.SelectListItem>> GetCustomerSelectListAsync()
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(
            @"SELECT id AS Id, full_name AS FullName FROM dbo.customers
              WHERE shop_id = @ShopId AND is_active = 1 AND is_customer = 1 ORDER BY full_name",
            new { ShopId });
        return rows.Select(r => new Microsoft.AspNetCore.Mvc.Rendering.SelectListItem(
            (string)r.FullName, ((Guid)r.Id).ToString())).ToList();
    }

    public async Task<IReadOnlyList<FuelTypeOption>> GetFuelTypesAsync()
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<FuelTypeOption>(
            "SELECT code AS Code, label AS Label FROM dbo.ref_fuel_types ORDER BY sort_order");
        return rows.ToList();
    }

    public async Task<VehicleFormViewModel?> GetVehicleFormAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        var row = await conn.QuerySingleOrDefaultAsync<VehicleFormViewModel>(
            @"SELECT v.id AS Id, v.plate AS Plate, v.brand AS Brand, v.model AS Model,
                     CAST(v.model_year AS int) AS Year, v.color AS Color, v.fuel AS FuelType,
                     CAST(v.mileage AS int) AS Km, v.chassis_no AS ChassisNo, v.engine_no AS EngineNo,
                     v.engine_volume AS EngineVolume, v.customer_id AS CustomerId, c.full_name AS CustomerName
              FROM dbo.vehicles v
              INNER JOIN dbo.customers c ON c.id = v.customer_id
              WHERE v.id = @id AND v.shop_id = @ShopId AND v.is_active = 1",
            new { id, ShopId });
        if (row is null) return null;
        row.Customers = await GetCustomerSelectListAsync();
        row.FuelTypes = await GetFuelTypesAsync();
        return row;
    }

    private static string NormalizePlate(string plate) => plate.Trim().ToUpperInvariant().Replace(" ", "");

    private async Task<VehiclePlateConflict?> FindVehiclePlateConflictAsync(
        Microsoft.Data.SqlClient.SqlConnection conn, string plateNorm, Guid? excludeVehicleId)
    {
        var sql = @"SELECT TOP 1 v.id AS VehicleId, v.customer_id AS CustomerId, c.full_name AS CustomerName
                    FROM dbo.vehicles v
                    INNER JOIN dbo.customers c ON c.id = v.customer_id
                    WHERE v.shop_id = @ShopId AND v.plate_norm = @plateNorm AND v.is_active = 1";
        if (excludeVehicleId.HasValue) sql += " AND v.id <> @excludeVehicleId";
        return await conn.QuerySingleOrDefaultAsync<VehiclePlateConflict>(sql,
            new { ShopId, plateNorm, excludeVehicleId });
    }

    public async Task<(bool Ok, string? Error, Guid? ConflictVehicleId, string? ConflictOwnerName)> CreateVehicleAsync(
        VehicleFormViewModel model)
    {
        var plateNorm = NormalizePlate(model.Plate);
        await using var conn = await db.OpenAsync();

        var conflict = await FindVehiclePlateConflictAsync(conn, plateNorm, null);
        if (conflict is not null && conflict.CustomerId != model.CustomerId)
            return (false, null, conflict.VehicleId, conflict.CustomerName);

        var id = Guid.NewGuid();
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.vehicles
                  (id, shop_id, customer_id, plate, brand, model, model_year, color, fuel,
                   chassis_no, engine_no, engine_volume, mileage)
                  VALUES
                  (@id, @ShopId, @CustomerId, @Plate, @Brand, @Model, @Year, @Color, @FuelType,
                   @ChassisNo, @EngineNo, @EngineVolume, @Km)",
                MapVehicleParams(id, model));
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            var raceConflict = await FindVehiclePlateConflictAsync(conn, plateNorm, null);
            if (raceConflict is not null)
                return (false, null, raceConflict.VehicleId, raceConflict.CustomerName);
            return (false, "Bu plaka zaten kayıtlı.", null, null);
        }
        return (true, null, null, null);
    }

    public async Task<(bool Ok, string? Error, Guid? ConflictVehicleId, string? ConflictOwnerName)> UpdateVehicleAsync(
        Guid id, VehicleFormViewModel model)
    {
        var plateNorm = NormalizePlate(model.Plate);
        await using var conn = await db.OpenAsync();

        var conflict = await FindVehiclePlateConflictAsync(conn, plateNorm, id);
        if (conflict is not null && conflict.CustomerId != model.CustomerId)
            return (false, null, conflict.VehicleId, conflict.CustomerName);

        try
        {
            var n = await conn.ExecuteAsync(
                @"UPDATE dbo.vehicles SET
                    customer_id = @CustomerId, plate = @Plate, brand = @Brand, model = @Model,
                    model_year = @Year, color = @Color, fuel = @FuelType, chassis_no = @ChassisNo,
                    engine_no = @EngineNo, engine_volume = @EngineVolume, mileage = @Km,
                    updated_at = SYSUTCDATETIME()
                  WHERE id = @id AND shop_id = @ShopId AND is_active = 1",
                MapVehicleParams(id, model));
            if (n == 0) return (false, "Araç bulunamadı.", null, null);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            var raceConflict = await FindVehiclePlateConflictAsync(conn, plateNorm, id);
            if (raceConflict is not null)
                return (false, null, raceConflict.VehicleId, raceConflict.CustomerName);
            return (false, "Bu plaka zaten kayıtlı.", null, null);
        }
        return (true, null, null, null);
    }

    public async Task<bool> DeleteVehicleAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.vehicles SET is_active = 0, updated_at = SYSUTCDATETIME()
              WHERE id = @id AND shop_id = @ShopId AND is_active = 1",
            new { id, ShopId });
        return n > 0;
    }

    public async Task<VehicleTransferViewModel?> GetVehicleTransferAsync(Guid id)
    {
        await using var conn = await db.OpenAsync();
        var row = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT v.id AS Id, v.plate AS Plate, v.customer_id AS CustomerId, c.full_name AS CustomerName
              FROM dbo.vehicles v
              INNER JOIN dbo.customers c ON c.id = v.customer_id
              WHERE v.id = @id AND v.shop_id = @ShopId AND v.is_active = 1",
            new { id, ShopId });
        if (row is null) return null;
        return new VehicleTransferViewModel
        {
            VehicleId = (Guid)row.Id,
            Plate = (string)row.Plate,
            CurrentCustomerId = (Guid)row.CustomerId,
            CurrentCustomerName = (string)row.CustomerName,
            Customers = await GetCustomerSelectListAsync(),
        };
    }

    public async Task<(bool Ok, string? Error)> TransferVehicleAsync(Guid vehicleId, Guid newCustomerId)
    {
        await using var conn = await db.OpenAsync();

        var currentCustomerId = await conn.ExecuteScalarAsync<Guid?>(
            "SELECT customer_id FROM dbo.vehicles WHERE id = @vehicleId AND shop_id = @ShopId AND is_active = 1",
            new { vehicleId, ShopId });
        if (currentCustomerId is null) return (false, "Araç bulunamadı.");
        if (currentCustomerId == newCustomerId) return (false, "Araç zaten bu müşteriye kayıtlı.");

        var customerExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.customers WHERE id = @newCustomerId AND shop_id = @ShopId AND is_active = 1",
            new { newCustomerId, ShopId }) > 0;
        if (!customerExists) return (false, "Müşteri bulunamadı.");

        await conn.ExecuteAsync(
            @"UPDATE dbo.vehicles SET customer_id = @newCustomerId, updated_at = SYSUTCDATETIME()
              WHERE id = @vehicleId AND shop_id = @ShopId AND is_active = 1",
            new { vehicleId, newCustomerId, ShopId });
        return (true, null);
    }

    private object MapVehicleParams(Guid id, VehicleFormViewModel model) => new
    {
        id,
        ShopId,
        model.CustomerId,
        Plate = model.Plate.Trim().ToUpperInvariant(),
        Brand = model.Brand.Trim(),
        Model = model.Model.Trim(),
        model.Year,
        Color = string.IsNullOrWhiteSpace(model.Color) ? null : model.Color.Trim(),
        FuelType = string.IsNullOrWhiteSpace(model.FuelType) ? "diger" : model.FuelType,
        model.Km,
        ChassisNo = string.IsNullOrWhiteSpace(model.ChassisNo) ? null : model.ChassisNo.Trim().ToUpperInvariant(),
        EngineNo = string.IsNullOrWhiteSpace(model.EngineNo) ? null : model.EngineNo.Trim(),
        EngineVolume = string.IsNullOrWhiteSpace(model.EngineVolume) ? null : model.EngineVolume.Trim(),
    };

    private record VehiclePlateConflict(Guid VehicleId, Guid CustomerId, string CustomerName);

    // ==========================================================================
    // Kategoriler (ref_stock_categories / ref_service_categories)
    // Platform geneli referans tablolar — shop_id yok, tüm servisler paylaşır.
    // Tablo adları kullanıcı girdisinden değil, sabit bir switch'ten gelir.
    // ==========================================================================

    private enum CategoryKind { Stock, Service }

    private static string CategoryTable(CategoryKind kind) => kind switch
    {
        CategoryKind.Stock => "dbo.ref_stock_categories",
        CategoryKind.Service => "dbo.ref_service_categories",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static (string Table, string Column) CategoryUsage(CategoryKind kind) => kind switch
    {
        CategoryKind.Stock => ("dbo.stock_products", "category"),
        CategoryKind.Service => ("dbo.service_catalog", "category"),
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static int LabelMaxLength(CategoryKind kind) => kind == CategoryKind.Stock ? 40 : 50;

    public Task<IReadOnlyList<CategoryListItem>> GetStockCategoriesAsync() => GetCategoriesAsync(CategoryKind.Stock);
    public Task<IReadOnlyList<CategoryListItem>> GetServiceCategoriesAsync() => GetCategoriesAsync(CategoryKind.Service);

    private async Task<IReadOnlyList<CategoryListItem>> GetCategoriesAsync(CategoryKind kind)
    {
        var table = CategoryTable(kind);
        var (usageTable, usageColumn) = CategoryUsage(kind);
        await using var conn = await db.OpenAsync();
        var sql = $@"SELECT rc.code AS Code, rc.label AS Label, rc.sort_order AS SortOrder,
                            (SELECT COUNT(*) FROM {usageTable} u WHERE u.{usageColumn} = rc.code) AS UsageCount
                     FROM {table} rc
                     ORDER BY rc.sort_order, rc.code";
        var rows = await conn.QueryAsync<CategoryListItem>(sql);
        return rows.ToList();
    }

    public Task<CategoryFormViewModel?> GetStockCategoryFormAsync(string code) => GetCategoryFormAsync(CategoryKind.Stock, code);
    public Task<CategoryFormViewModel?> GetServiceCategoryFormAsync(string code) => GetCategoryFormAsync(CategoryKind.Service, code);

    private async Task<CategoryFormViewModel?> GetCategoryFormAsync(CategoryKind kind, string code)
    {
        var table = CategoryTable(kind);
        await using var conn = await db.OpenAsync();
        var row = await conn.QuerySingleOrDefaultAsync<CategoryFormViewModel>(
            $"SELECT code AS Code, label AS Label, sort_order AS SortOrder FROM {table} WHERE code = @code",
            new { code });
        if (row is null) return null;
        row.OriginalCode = row.Code;
        row.Kind = kind == CategoryKind.Stock ? "stock" : "service";
        return row;
    }

    public Task<(bool Ok, string? Error)> CreateStockCategoryAsync(CategoryFormViewModel model) => CreateCategoryAsync(CategoryKind.Stock, model);
    public Task<(bool Ok, string? Error)> CreateServiceCategoryAsync(CategoryFormViewModel model) => CreateCategoryAsync(CategoryKind.Service, model);

    private async Task<(bool Ok, string? Error)> CreateCategoryAsync(CategoryKind kind, CategoryFormViewModel model)
    {
        var table = CategoryTable(kind);
        var code = model.Code.Trim().ToLowerInvariant();
        var label = TrimToLength(model.Label, LabelMaxLength(kind));
        await using var conn = await db.OpenAsync();
        try
        {
            await conn.ExecuteAsync(
                $"INSERT INTO {table} (code, label, sort_order) VALUES (@code, @label, @SortOrder)",
                new { code, label, model.SortOrder });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return (false, "Bu kod zaten kullanılıyor.");
        }
        return (true, null);
    }

    public Task<(bool Ok, string? Error)> UpdateStockCategoryAsync(string code, CategoryFormViewModel model) => UpdateCategoryAsync(CategoryKind.Stock, code, model);
    public Task<(bool Ok, string? Error)> UpdateServiceCategoryAsync(string code, CategoryFormViewModel model) => UpdateCategoryAsync(CategoryKind.Service, code, model);

    private async Task<(bool Ok, string? Error)> UpdateCategoryAsync(CategoryKind kind, string code, CategoryFormViewModel model)
    {
        var table = CategoryTable(kind);
        var label = TrimToLength(model.Label, LabelMaxLength(kind));
        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            $"UPDATE {table} SET label = @label, sort_order = @SortOrder WHERE code = @code",
            new { code, label, model.SortOrder });
        if (n == 0) return (false, "Kategori bulunamadı.");
        return (true, null);
    }

    // ref_stock_categories / ref_service_categories'te is_active kolonu yok (platform geneli sabit referans
    // tablolar). Bu yüzden "deaktif etme" burada; kullanımda değilse kalıcı silme, kullanımdaysa dostane hata
    // olarak uygulanır (customers/vehicles'daki is_active=0 örüntüsünün bu tablolardaki karşılığı).
    public Task<(bool Ok, string? Error)> DeactivateStockCategoryAsync(string code) => DeactivateCategoryAsync(CategoryKind.Stock, code);
    public Task<(bool Ok, string? Error)> DeactivateServiceCategoryAsync(string code) => DeactivateCategoryAsync(CategoryKind.Service, code);

    private async Task<(bool Ok, string? Error)> DeactivateCategoryAsync(CategoryKind kind, string code)
    {
        var table = CategoryTable(kind);
        var (usageTable, usageColumn) = CategoryUsage(kind);
        await using var conn = await db.OpenAsync();

        var usage = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM {usageTable} WHERE {usageColumn} = @code", new { code });
        if (usage > 0)
            return (false, $"Bu kategori {usage} kayıtta kullanıldığı için silinemez.");

        try
        {
            var n = await conn.ExecuteAsync($"DELETE FROM {table} WHERE code = @code", new { code });
            if (n == 0) return (false, "Kategori bulunamadı.");
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 547)
        {
            return (false, "Bu kategori kullanımda olduğu için silinemez.");
        }
        return (true, null);
    }

    private static string TrimToLength(string value, int maxLength)
    {
        var trimmed = value.Trim();
        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }
}
