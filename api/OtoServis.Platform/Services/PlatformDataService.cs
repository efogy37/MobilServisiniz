using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using OtoServis.Platform.Models;

namespace OtoServis.Platform.Services;

public class PlatformDataService(DbFactory db)
{
    public async Task<IReadOnlyList<ShopListItem>> ListShopsAsync(string? search = null)
    {
        await using var conn = await db.OpenAsync();
        var sql = @"
            SELECT s.id AS Id, s.tenant_code AS TenantCode, s.name AS Name, s.city AS City,
                   s.subscription_plan AS SubscriptionPlan, p.label AS PlanLabel,
                   s.max_users AS MaxUsersOverride, p.max_users AS PlanMaxUsers,
                   COALESCE(s.max_users, p.max_users) AS EffectiveMaxUsers,
                   (SELECT COUNT(1) FROM dbo.shop_users su WHERE su.shop_id = s.id AND su.is_active = 1) AS ActiveUsers,
                   CAST(s.is_active AS bit) AS IsActive, s.created_at AS CreatedAt,
                   ISNULL(s.license_type, N'unlimited') AS LicenseType,
                   s.license_expires_at AS LicenseExpiresAt
            FROM dbo.shops s
            INNER JOIN dbo.ref_subscription_plans p ON p.code = s.subscription_plan
            WHERE 1=1";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (s.name LIKE @q OR s.tenant_code LIKE @q OR s.city LIKE @q OR s.phone LIKE @q)";
        sql += " ORDER BY s.created_at DESC";
        var rows = (await conn.QueryAsync<ShopListItem>(sql, new { q = $"%{search?.Trim()}%" })).ToList();
        foreach (var r in rows) ApplyLicenseStatus(r);
        return rows;
    }

    public async Task<ShopListItem?> GetShopAsync(Guid shopId)
    {
        await using var conn = await db.OpenAsync();
        var row = await conn.QuerySingleOrDefaultAsync<ShopListItem>(
            @"SELECT s.id AS Id, s.tenant_code AS TenantCode, s.name AS Name, s.city AS City,
                     s.subscription_plan AS SubscriptionPlan, p.label AS PlanLabel,
                     s.max_users AS MaxUsersOverride, p.max_users AS PlanMaxUsers,
                     COALESCE(s.max_users, p.max_users) AS EffectiveMaxUsers,
                     (SELECT COUNT(1) FROM dbo.shop_users su WHERE su.shop_id = s.id AND su.is_active = 1) AS ActiveUsers,
                     CAST(s.is_active AS bit) AS IsActive, s.created_at AS CreatedAt,
                     ISNULL(s.license_type, N'unlimited') AS LicenseType,
                     s.license_expires_at AS LicenseExpiresAt
              FROM dbo.shops s
              INNER JOIN dbo.ref_subscription_plans p ON p.code = s.subscription_plan
              WHERE s.id = @shopId",
            new { shopId });
        if (row is not null) ApplyLicenseStatus(row);
        return row;
    }

    private static void ApplyLicenseStatus(ShopListItem r)
    {
        var (status, days) = LicenseHelper.Evaluate(r.LicenseType, r.LicenseExpiresAt);
        r.LicenseStatus = status;
        r.DaysRemaining = days;
    }

    public async Task<ShopEditForm?> GetShopEditAsync(Guid shopId)
    {
        await using var conn = await db.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<ShopEditForm>(
            @"SELECT id AS Id, name AS Name, phone AS Phone, city AS City,
                     subscription_plan AS SubscriptionPlan, max_users AS MaxUsers,
                     CAST(is_active AS bit) AS IsActive
              FROM dbo.shops WHERE id = @shopId",
            new { shopId });
    }

    public async Task<IReadOnlyList<PlanOption>> GetPlansAsync()
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<PlanOption>(
            @"SELECT code AS Code, label AS Label, max_users AS MaxUsers, monthly_price AS MonthlyPrice
              FROM dbo.ref_subscription_plans
              ORDER BY monthly_price");
        return rows.ToList();
    }

    public async Task UpdateShopAsync(ShopEditForm form)
    {
        await using var conn = await db.OpenAsync();
        await conn.ExecuteAsync(
            @"UPDATE dbo.shops
              SET name = @Name, phone = @Phone, city = @City,
                  subscription_plan = @SubscriptionPlan, max_users = @MaxUsers,
                  is_active = @IsActive, updated_at = SYSUTCDATETIME()
              WHERE id = @Id",
            form);
    }

    public async Task<Guid> CreateShopAsync(CreateShopForm form)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var tenantCode = form.TenantCode.Trim().ToUpperInvariant();
        var phone = form.OwnerPhone.Trim();
        var slug = MakeSlug(form.Name, tenantCode) + "-" + tenantCode.ToLowerInvariant();
        if (slug.Length > 80) slug = slug[..80];

        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.shops WHERE UPPER(tenant_code)=UPPER(@tenantCode)",
            new { tenantCode }, tx);
        if (exists > 0) throw new InvalidOperationException("Bu servis kodu zaten kullanılıyor.");

        // Telefon başka kullanıcıda varsa yeni kullanıcı açma; mevcut hesabı bu servise bağla.
        var existingUser = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT id AS Id, CAST(is_active AS bit) AS IsActive
              FROM dbo.users WHERE phone = @phone",
            new { phone }, tx);

        var shopId = Guid.NewGuid();
        Guid userId;
        var licenseType = string.IsNullOrWhiteSpace(form.LicenseType) ? "trial" : form.LicenseType.Trim().ToLowerInvariant();
        if (licenseType is not ("trial" or "monthly" or "yearly" or "unlimited"))
            throw new InvalidOperationException("Geçersiz lisans tipi.");
        var licenseExpires = LicenseHelper.ComputeNewExpiry(licenseType, null);
        var licenseStarted = DateTime.UtcNow.AddHours(3).Date;
        var passwordHash = PasswordHasher.Hash(form.OwnerPassword);

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.shops (id, tenant_code, slug, name, legal_name, phone, city, subscription_plan, max_users,
                                    license_type, license_started_at, license_expires_at)
              VALUES (@shopId, @tenantCode, @slug, @Name, @Name, @OwnerPhone, @City, @SubscriptionPlan, @MaxUsers,
                      @licenseType, @licenseStarted, @licenseExpires)",
            new
            {
                shopId,
                tenantCode,
                slug,
                form.Name,
                OwnerPhone = phone,
                form.City,
                form.SubscriptionPlan,
                form.MaxUsers,
                licenseType,
                licenseStarted,
                licenseExpires,
            }, tx);

        if (existingUser is null)
        {
            userId = Guid.NewGuid();
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.users (id, username, full_name, phone, password_hash, default_shop_id)
                  VALUES (@userId, @username, @OwnerName, @phone, @hash, @shopId)",
                new
                {
                    userId,
                    username = MakeUsername(form.OwnerName, phone),
                    form.OwnerName,
                    phone,
                    hash = passwordHash,
                    shopId,
                }, tx);
        }
        else
        {
            userId = (Guid)existingUser.Id;
            await conn.ExecuteAsync(
                @"UPDATE dbo.users
                  SET full_name = @OwnerName,
                      password_hash = @hash,
                      is_active = 1,
                      default_shop_id = ISNULL(default_shop_id, @shopId)
                  WHERE id = @userId",
                new { userId, form.OwnerName, hash = passwordHash, shopId }, tx);
        }

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.shop_license_events (shop_id, old_license_type, new_license_type, old_expires_at, new_expires_at, note, created_by)
              VALUES (@shopId, NULL, @licenseType, NULL, @licenseExpires, N'Servis oluşturuldu', @userId)",
            new { shopId, licenseType, licenseExpires, userId }, tx);

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.tenant_counters (shop_id, counter_name, last_value) VALUES
              (@shopId, N'work_order_no', 1000),
              (@shopId, N'invoice_no', 0)",
            new { shopId }, tx);

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.shop_users (shop_id, user_id, role, title, is_owner)
              VALUES (@shopId, @userId, N'admin', N'Servis Yöneticisi', 1)",
            new { shopId, userId }, tx);

        await tx.CommitAsync();
        return shopId;
    }

    public async Task<IReadOnlyList<ShopUserRow>> GetShopUsersAsync(Guid shopId)
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<ShopUserRow>(
            @"SELECT u.id AS UserId, su.id AS MembershipId, u.full_name AS FullName,
                     u.username AS Username, u.phone AS Phone,
                     su.role AS Role, su.title AS Title,
                     CAST(su.is_owner AS bit) AS IsOwner, CAST(su.is_active AS bit) AS IsActive,
                     su.joined_at AS JoinedAt
              FROM dbo.shop_users su
              INNER JOIN dbo.users u ON u.id = su.user_id
              WHERE su.shop_id = @shopId
              ORDER BY su.is_owner DESC, su.is_active DESC, u.full_name",
            new { shopId });
        return rows.ToList();
    }

    public async Task AddUserAsync(Guid shopId, AddUserForm form)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var limit = await GetEffectiveLimitAsync(conn, shopId, tx);
        var active = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.shop_users WHERE shop_id=@shopId AND is_active=1",
            new { shopId }, tx);
        if (limit.HasValue && active >= limit.Value)
            throw new InvalidOperationException($"Kullanıcı limiti dolu ({active}/{limit}). Limiti artırın veya bir kullanıcıyı pasifleştirin.");

        var phone = form.Phone.Trim();
        var role = form.Role.Trim().ToLowerInvariant();
        if (role is not ("admin" or "usta" or "personel"))
            throw new InvalidOperationException("Geçersiz rol.");

        var username = NormalizeUsername(form.Username)
                       ?? MakeUsername(form.FullName, phone);
        await EnsureUsernameAvailableAsync(conn, tx, username, excludeUserId: null);

        var existing = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT id, CAST(is_active AS bit) AS IsActive FROM dbo.users WHERE phone=@phone",
            new { phone }, tx);

        Guid userId;
        if (existing is null)
        {
            userId = Guid.NewGuid();
            await conn.ExecuteAsync(
                @"INSERT INTO dbo.users (id, username, full_name, phone, password_hash, default_shop_id)
                  VALUES (@userId, @username, @FullName, @phone, @hash, @shopId)",
                new
                {
                    userId,
                    username,
                    form.FullName,
                    phone,
                    hash = PasswordHasher.Hash(form.Password),
                    shopId,
                }, tx);
        }
        else
        {
            userId = (Guid)existing.id;
            var membership = await conn.QuerySingleOrDefaultAsync<dynamic>(
                "SELECT id, CAST(is_active AS bit) AS IsActive FROM dbo.shop_users WHERE shop_id=@shopId AND user_id=@userId",
                new { shopId, userId }, tx);

            if (membership is not null)
            {
                if (membership.IsActive is true)
                    throw new InvalidOperationException("Bu kullanıcı zaten bu serviste aktif.");
                await conn.ExecuteAsync(
                    @"UPDATE dbo.shop_users
                      SET is_active=1, role=@role, title=@Title, joined_at=SYSUTCDATETIME()
                      WHERE id=@id",
                    new { id = (Guid)membership.id, role, form.Title }, tx);
                await tx.CommitAsync();
                return;
            }

            await conn.ExecuteAsync(
                "UPDATE dbo.users SET full_name=@FullName, password_hash=@hash, is_active=1 WHERE id=@userId",
                new { userId, form.FullName, hash = PasswordHasher.Hash(form.Password) }, tx);
        }

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.shop_users (shop_id, user_id, role, title, is_owner, is_active)
              VALUES (@shopId, @userId, @role, @Title, 0, 1)",
            new { shopId, userId, role, form.Title }, tx);

        await tx.CommitAsync();
    }

    public async Task DeactivateUserAsync(Guid shopId, Guid userId)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var row = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT CAST(is_owner AS bit) AS IsOwner, CAST(is_active AS bit) AS IsActive
              FROM dbo.shop_users WHERE shop_id=@shopId AND user_id=@userId",
            new { shopId, userId }, tx);
        if (row is null) throw new InvalidOperationException("Üyelik bulunamadı.");
        if (row.IsActive is not true) return;

        if (row.IsOwner is true)
        {
            var otherActive = await conn.ExecuteScalarAsync<int>(
                @"SELECT COUNT(1) FROM dbo.shop_users
                  WHERE shop_id=@shopId AND is_active=1 AND user_id<>@userId",
                new { shopId, userId }, tx);
            if (otherActive == 0)
                throw new InvalidOperationException("Son aktif sahip kullanıcı pasifleştirilemez.");
        }

        await conn.ExecuteAsync(
            "UPDATE dbo.shop_users SET is_active=0 WHERE shop_id=@shopId AND user_id=@userId",
            new { shopId, userId }, tx);
        await tx.CommitAsync();
    }

    public async Task ActivateUserAsync(Guid shopId, Guid userId)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var limit = await GetEffectiveLimitAsync(conn, shopId, tx);
        var active = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.shop_users WHERE shop_id=@shopId AND is_active=1",
            new { shopId }, tx);
        if (limit.HasValue && active >= limit.Value)
            throw new InvalidOperationException($"Kullanıcı limiti dolu ({active}/{limit}).");

        var n = await conn.ExecuteAsync(
            "UPDATE dbo.shop_users SET is_active=1 WHERE shop_id=@shopId AND user_id=@userId",
            new { shopId, userId }, tx);
        if (n == 0) throw new InvalidOperationException("Üyelik bulunamadı.");
        await tx.CommitAsync();
    }

    public async Task ResetPasswordAsync(Guid userId, string newPassword)
    {
        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            "UPDATE dbo.users SET password_hash=@hash, updated_at=SYSUTCDATETIME() WHERE id=@userId",
            new { userId, hash = PasswordHasher.Hash(newPassword) });
        if (n == 0) throw new InvalidOperationException("Kullanıcı bulunamadı.");
    }

    public async Task UpdateUserAsync(Guid shopId, EditUserForm form)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var membership = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT id, CAST(is_owner AS bit) AS IsOwner
              FROM dbo.shop_users
              WHERE shop_id = @shopId AND user_id = @UserId",
            new { shopId, form.UserId }, tx);
        if (membership is null)
            throw new InvalidOperationException("Üyelik bulunamadı.");

        var fullName = (form.FullName ?? "").Trim();
        if (fullName.Length < 2)
            throw new InvalidOperationException("Ad soyad en az 2 karakter olmalı.");

        var phone = (form.Phone ?? "").Trim();
        if (phone.Length < 7)
            throw new InvalidOperationException("Telefon geçersiz.");

        var username = NormalizeUsername(form.Username)
                       ?? throw new InvalidOperationException("Kullanıcı adı en az 3 karakter olmalı.");
        await EnsureUsernameAvailableAsync(conn, tx, username, form.UserId);

        var phoneTaken = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(1) FROM dbo.users
              WHERE phone = @phone AND id <> @UserId",
            new { phone, form.UserId }, tx);
        if (phoneTaken > 0)
            throw new InvalidOperationException("Bu telefon başka bir kullanıcıda kayıtlı.");

        var role = (form.Role ?? "").Trim().ToLowerInvariant();
        if (role is not ("admin" or "usta" or "personel"))
            throw new InvalidOperationException("Geçersiz rol.");

        var nUser = await conn.ExecuteAsync(
            @"UPDATE dbo.users
              SET username = @username,
                  full_name = @fullName,
                  phone = @phone,
                  updated_at = SYSUTCDATETIME()
              WHERE id = @UserId",
            new { form.UserId, username, fullName, phone }, tx);
        if (nUser == 0)
            throw new InvalidOperationException("Kullanıcı bulunamadı.");

        await conn.ExecuteAsync(
            @"UPDATE dbo.shop_users
              SET role = @role, title = @Title
              WHERE shop_id = @shopId AND user_id = @UserId",
            new { shopId, form.UserId, role, form.Title }, tx);

        await tx.CommitAsync();
    }

    private static async Task EnsureUsernameAvailableAsync(
        SqlConnection conn, System.Data.Common.DbTransaction tx, string username, Guid? excludeUserId)
    {
        var taken = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(1) FROM dbo.users
              WHERE username IS NOT NULL
                AND LOWER(username) = LOWER(@username)
                AND (@excludeUserId IS NULL OR id <> @excludeUserId)",
            new { username, excludeUserId }, tx);
        if (taken > 0)
            throw new InvalidOperationException("Bu kullanıcı adı kullanılıyor.");
    }

    private static string? NormalizeUsername(string? raw)
    {
        var u = (raw ?? "").Trim().ToLowerInvariant();
        if (u.Length == 0) return null;
        if (u.Length < 3 || u.Length > 50)
            throw new InvalidOperationException("Kullanıcı adı 3–50 karakter olmalı.");
        if (!Regex.IsMatch(u, @"^[a-z0-9._-]+$"))
            throw new InvalidOperationException(
                "Kullanıcı adı yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir.");
        return u;
    }

    public async Task<ShopUsageStats> GetShopUsageStatsAsync(Guid shopId)
    {
        await using var conn = await db.OpenAsync();
        return await conn.QuerySingleAsync<ShopUsageStats>(
            @"SELECT
                (SELECT COUNT(1) FROM dbo.customers WHERE shop_id=@shopId AND is_active=1) AS Customers,
                (SELECT COUNT(1) FROM dbo.vehicles WHERE shop_id=@shopId AND is_active=1) AS Vehicles,
                (SELECT COUNT(1) FROM dbo.work_orders WHERE shop_id=@shopId) AS WorkOrders,
                (SELECT COUNT(1) FROM dbo.payments WHERE shop_id=@shopId) AS PaymentsCount,
                (SELECT ISNULL(SUM(amount),0) FROM dbo.payments WHERE shop_id=@shopId) AS PaymentsTotal",
            new { shopId });
    }

    public async Task<IReadOnlyList<ActivityRow>> GetStatusHistoryAsync(Guid shopId, int take = 80)
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<ActivityRow>(
            @"SELECT TOP (@take)
                     h.changed_at AS ChangedAt, wo.order_no AS OrderNo, v.plate AS Plate,
                     h.old_status AS OldStatus, h.new_status AS NewStatus,
                     cu.full_name AS ChangedByName,
                     COALESCE(au.full_name, wo.assigned_user_name) AS AssignedTo
              FROM dbo.work_order_status_history h
              INNER JOIN dbo.work_orders wo ON wo.id = h.work_order_id
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              LEFT JOIN dbo.users cu ON cu.id = h.changed_by
              LEFT JOIN dbo.users au ON au.id = wo.assigned_user_id
              WHERE h.shop_id = @shopId
              ORDER BY h.changed_at DESC",
            new { shopId, take });
        return rows.ToList();
    }

    public async Task<IReadOnlyList<PaymentActivityRow>> GetPaymentsAsync(Guid shopId, int take = 50)
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<PaymentActivityRow>(
            @"SELECT TOP (@take)
                     p.paid_at AS PaidAt, wo.order_no AS OrderNo, v.plate AS Plate,
                     p.amount AS Amount, p.method AS Method, u.full_name AS ReceivedByName
              FROM dbo.payments p
              INNER JOIN dbo.work_orders wo ON wo.id = p.work_order_id
              INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
              LEFT JOIN dbo.users u ON u.id = p.received_by
              WHERE p.shop_id = @shopId
              ORDER BY p.paid_at DESC",
            new { shopId, take });
        return rows.ToList();
    }

    public async Task SetLicenseAsync(Guid shopId, string licenseType, DateTime? explicitExpires, string? note, Guid? actorUserId)
    {
        var type = licenseType.Trim().ToLowerInvariant();
        if (type is not ("trial" or "monthly" or "yearly" or "unlimited"))
            throw new InvalidOperationException("Geçersiz lisans tipi.");

        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var current = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT license_type AS LicenseType, license_expires_at AS LicenseExpiresAt
              FROM dbo.shops WHERE id = @shopId",
            new { shopId }, tx);
        if (current is null) throw new InvalidOperationException("Servis bulunamadı.");

        DateTime? newExpires;
        if (type == "unlimited")
            newExpires = null;
        else if (explicitExpires.HasValue)
            newExpires = explicitExpires.Value.Date;
        else
            newExpires = LicenseHelper.ComputeNewExpiry(type, (DateTime?)current.LicenseExpiresAt);

        await conn.ExecuteAsync(
            @"UPDATE dbo.shops
              SET license_type = @type,
                  license_expires_at = @newExpires,
                  license_started_at = COALESCE(license_started_at, CAST(DATEADD(hour, 3, SYSUTCDATETIME()) AS date)),
                  updated_at = SYSUTCDATETIME()
              WHERE id = @shopId",
            new { shopId, type, newExpires }, tx);

        await conn.ExecuteAsync(
            @"INSERT INTO dbo.shop_license_events
                (shop_id, old_license_type, new_license_type, old_expires_at, new_expires_at, note, created_by)
              VALUES
                (@shopId, @oldType, @type, @oldExpires, @newExpires, @note, @actorUserId)",
            new
            {
                shopId,
                oldType = (string?)current.LicenseType,
                type,
                oldExpires = (DateTime?)current.LicenseExpiresAt,
                newExpires,
                note = string.IsNullOrWhiteSpace(note) ? "Platform üzerinden güncellendi" : note.Trim(),
                actorUserId,
            }, tx);

        await tx.CommitAsync();
    }

    public async Task<IReadOnlyList<LicenseEventRow>> GetLicenseEventsAsync(Guid shopId, int take = 20)
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<LicenseEventRow>(
            @"SELECT TOP (@take)
                     e.created_at AS CreatedAt,
                     e.new_license_type AS NewLicenseType,
                     e.new_expires_at AS NewExpiresAt,
                     e.note AS Note,
                     u.full_name AS CreatedByName
              FROM dbo.shop_license_events e
              LEFT JOIN dbo.users u ON u.id = e.created_by
              WHERE e.shop_id = @shopId
              ORDER BY e.created_at DESC",
            new { shopId, take });
        return rows.ToList();
    }

    public async Task<AppReleaseForm?> GetAppReleaseAsync()
    {
        await using var conn = await db.OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<AppReleaseForm>(
            @"SELECT latest_version AS LatestVersion,
                     latest_version_code AS LatestVersionCode,
                     min_version_code AS MinVersionCode,
                     store_url AS StoreUrl,
                     release_notes AS ReleaseNotes,
                     updated_at AS UpdatedAt
              FROM dbo.app_release WHERE id = 1");
    }

    public async Task UpdateAppReleaseAsync(AppReleaseForm form)
    {
        if (form.ForceThisVersion)
            form.MinVersionCode = form.LatestVersionCode;
        if (form.MinVersionCode > form.LatestVersionCode)
            throw new InvalidOperationException("Minimum version code, latest'ten büyük olamaz.");

        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync(
            @"UPDATE dbo.app_release
              SET latest_version = @LatestVersion,
                  latest_version_code = @LatestVersionCode,
                  min_version_code = @MinVersionCode,
                  store_url = @StoreUrl,
                  release_notes = @ReleaseNotes,
                  updated_at = SYSUTCDATETIME()
              WHERE id = 1",
            form);
        if (n == 0)
            throw new InvalidOperationException("app_release satırı yok. SQL18 çalıştırın.");
    }

    private static async Task<int?> GetEffectiveLimitAsync(SqlConnection conn, Guid shopId, System.Data.Common.DbTransaction tx)
    {
        return await conn.ExecuteScalarAsync<int?>(
            @"SELECT COALESCE(s.max_users, p.max_users)
              FROM dbo.shops s
              INNER JOIN dbo.ref_subscription_plans p ON p.code = s.subscription_plan
              WHERE s.id = @shopId",
            new { shopId }, tx);
    }

    private static string MakeSlug(string name, string tenantCode)
    {
        var raw = string.IsNullOrWhiteSpace(name) ? tenantCode : name;
        var slug = Regex.Replace(raw.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        if (string.IsNullOrEmpty(slug)) slug = tenantCode.ToLowerInvariant();
        return slug.Length > 80 ? slug[..80] : slug;
    }

    private static string MakeUsername(string fullName, string phone)
    {
        var baseName = Regex.Replace(fullName.ToLowerInvariant(), @"[^a-z0-9]", "");
        if (baseName.Length < 3)
            baseName = "user" + Regex.Replace(phone, @"\D", "");
        if (baseName.Length > 40) baseName = baseName[..40];
        return baseName + "_" + Guid.NewGuid().ToString("N")[..6];
    }
}
