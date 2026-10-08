using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.IdentityModel.Tokens;
using OtoServis.Api.Models;

namespace OtoServis.Api.Services;

public class AuthService(DbFactory db, IConfiguration config)
{
    public async Task<AuthResponse?> LoginAsync(string identifier, string password, string? tenantCode = null)
    {
        await using var conn = new SqlConnection(db.ConnectionString);

        var login = identifier?.Trim() ?? "";
        if (login.Length < 3) return null;

        var hash = PasswordHasher.Hash(password);
        var phoneDigits = DigitsOnly(login);
        var user = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT id, full_name AS FullName, phone, email, password_hash AS PasswordHash, default_shop_id AS DefaultShopId
              FROM dbo.users
              WHERE is_active = 1
                AND (
                  phone = @login
                  OR (@phoneDigits <> N'' AND REPLACE(REPLACE(REPLACE(phone, N' ', N''), N'-', N''), N'+', N'') = @phoneDigits)
                  OR (username IS NOT NULL AND LOWER(username) = LOWER(@login))
                )",
            new { login, phoneDigits });

        if (user is null || (string)user.PasswordHash != hash) return null;

        var userId = (Guid)user.id;
        var shops = await GetUserShopsAsync(conn, userId);
        if (shops.Count == 0) return null;

        ShopMembershipDto? active = null;
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var shop = await ResolveShopAsync(conn, tenantCode);
            if (shop is not null)
                active = shops.FirstOrDefault(s => s.ShopId == shop.ShopId);
        }
        if (active is null)
        {
            Guid? defaultShopId = user.DefaultShopId as Guid?;
            var preferred = shops.FirstOrDefault(s => s.IsDefault)
                            ?? (defaultShopId.HasValue
                                ? shops.FirstOrDefault(s => s.ShopId == defaultShopId.Value)
                                : null);
            var ordered = preferred is null
                ? shops
                : new[] { preferred }.Concat(shops.Where(s => s.ShopId != preferred.ShopId)).ToList();

            foreach (var candidate in ordered)
            {
                var candLic = await ShopLicenseHelper.GetForShopAsync(conn, candidate.ShopId)
                    ?? ShopLicenseHelper.Evaluate("unlimited", null);
                if (candLic.LicenseStatus != "expired")
                {
                    active = candidate;
                    break;
                }
            }

            if (active is null)
                throw new ShopLicenseExpiredException();
        }

        var license = await ShopLicenseHelper.GetForShopAsync(conn, active.ShopId)
            ?? ShopLicenseHelper.Evaluate("unlimited", null);
        if (license.LicenseStatus == "expired")
            throw new ShopLicenseExpiredException();

        // Yeni giriş → yeni oturum; diğer cihazlardaki JWT geçersiz olur
        var sessionId = Guid.NewGuid();
        await conn.ExecuteAsync(
            @"UPDATE dbo.users
              SET default_shop_id = @shopId,
                  last_login_at = SYSUTCDATETIME(),
                  session_id = @sessionId
              WHERE id = @userId",
            new { shopId = active.ShopId, userId, sessionId });

        var token = CreateToken(userId, (string)user.FullName, active.ShopId, active.Role, sessionId);
        var entitlements = await PlanEntitlementsService.QueryAsync(conn, active.ShopId);

        return new AuthResponse(
            token,
            new UserDto(userId, (string)user.FullName, (string)user.phone, user.email as string),
            shops,
            active,
            license,
            entitlements);
    }

    private static string DigitsOnly(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var chars = value.Where(char.IsDigit).ToArray();
        // Kullanıcı adı gibi görünen değerleri telefon sanma
        if (chars.Length < 7 || chars.Length < value.Count(c => !char.IsWhiteSpace(c)) * 0.7)
            return "";
        return new string(chars);
    }

    public async Task<ShopPreviewDto?> LookupTenantAsync(string tenantCode)
    {
        await using var conn = new SqlConnection(db.ConnectionString);
        var shop = await ResolveShopAsync(conn, tenantCode);
        return shop is null ? null : new ShopPreviewDto(shop.ShopId, shop.TenantCode, shop.ShopName, shop.City);
    }

    public async Task<AuthResponse?> SelectShopAsync(Guid userId, Guid shopId)
    {
        await using var conn = new SqlConnection(db.ConnectionString);
        var membership = await conn.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT su.role, u.full_name AS FullName, u.phone, u.email, u.session_id AS SessionId
              FROM dbo.shop_users su
              INNER JOIN dbo.users u ON u.id = su.user_id
              WHERE su.user_id = @userId AND su.shop_id = @shopId AND su.is_active = 1 AND u.is_active = 1",
            new { userId, shopId });

        if (membership is null) return null;

        var license = await ShopLicenseHelper.GetForShopAsync(conn, shopId)
            ?? ShopLicenseHelper.Evaluate("unlimited", null);
        if (license.LicenseStatus == "expired")
            throw new ShopLicenseExpiredException();

        // Aynı cihaz / oturum: session_id korunur (yeniden giriş sayılmaz)
        var sessionId = membership.SessionId is Guid sid && sid != Guid.Empty
            ? sid
            : Guid.NewGuid();

        await conn.ExecuteAsync(
            @"UPDATE dbo.users
              SET default_shop_id = @shopId,
                  last_login_at = SYSUTCDATETIME(),
                  session_id = @sessionId
              WHERE id = @userId",
            new { shopId, userId, sessionId });

        var shops = await GetUserShopsAsync(conn, userId);
        var active = shops.First(s => s.ShopId == shopId);
        var token = CreateToken(userId, (string)membership.FullName, shopId, (string)membership.role, sessionId);
        var entitlements = await PlanEntitlementsService.QueryAsync(conn, shopId);

        return new AuthResponse(
            token,
            new UserDto(userId, (string)membership.FullName, (string)membership.phone, membership.email as string),
            shops,
            active,
            license,
            entitlements);
    }

    public async Task<ShopLicenseDto?> GetShopLicenseAsync(Guid shopId)
    {
        await using var conn = new SqlConnection(db.ConnectionString);
        return await ShopLicenseHelper.GetForShopAsync(conn, shopId);
    }

    public async Task<PlanEntitlementsDto?> GetEntitlementsAsync(Guid shopId)
    {
        await using var conn = new SqlConnection(db.ConnectionString);
        await conn.OpenAsync();
        return await PlanEntitlementsService.QueryAsync(conn, shopId);
    }

    public async Task<bool> ValidateShopAccessAsync(Guid userId, Guid shopId)
    {
        await using var conn = new SqlConnection(db.ConnectionString);
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM dbo.shop_users WHERE user_id=@userId AND shop_id=@shopId AND is_active=1",
            new { userId, shopId }) > 0;
    }

    /// <summary>
    /// JWT içindeki sid, kullanıcının aktif session_id'si ile eşleşmeli.
    /// Eşleşmezse başka cihazda yeni giriş yapılmıştır.
    /// </summary>
    public async Task<bool> ValidateSessionAsync(Guid userId, Guid? sessionId)
    {
        if (!sessionId.HasValue || sessionId.Value == Guid.Empty)
            return false;

        await using var conn = new SqlConnection(db.ConnectionString);
        var active = await conn.ExecuteScalarAsync<Guid?>(
            "SELECT session_id FROM dbo.users WHERE id = @userId AND is_active = 1",
            new { userId });

        // Kolon henüz yoksa / hiç giriş rotasyonu olmadıysa geçici olarak kabul etmeyiz:
        // session_id NULL ise eski tokenlar da düşer → kullanıcı yeniden giriş yapar.
        return active.HasValue && active.Value == sessionId.Value;
    }

    private static async Task<ResolvedShop?> ResolveShopAsync(SqlConnection conn, string tenantCode)
    {
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;
        return await conn.QuerySingleOrDefaultAsync<ResolvedShop>(
            @"SELECT id AS ShopId, tenant_code AS TenantCode, name AS ShopName, city AS City
              FROM dbo.shops
              WHERE UPPER(tenant_code) = UPPER(@code) AND is_active = 1",
            new { code = tenantCode.Trim() });
    }

    private static async Task<IReadOnlyList<ShopMembershipDto>> GetUserShopsAsync(SqlConnection conn, Guid userId)
    {
        var rows = await conn.QueryAsync<ShopMembershipDto>(
            @"SELECT shop_id AS ShopId, tenant_code AS TenantCode, slug AS Slug,
                     shop_name AS ShopName, city AS City, role AS Role, title AS Title,
                     is_owner AS IsOwner, CAST(is_default AS bit) AS IsDefault
              FROM dbo.vw_UserShops WHERE user_id = @userId",
            new { userId });
        return rows.ToList();
    }

    private string CreateToken(Guid userId, string fullName, Guid? shopId, string? role, Guid sessionId)
    {
        var key = config["Jwt:Key"]!;
        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId.ToString()),
            new(ClaimTypes.Name, fullName),
            new(ClaimTypes_.SessionId, sessionId.ToString()),
        };
        if (shopId.HasValue)
        {
            claims.Add(new Claim(ClaimTypes_.ShopId, shopId.Value.ToString()));
            claims.Add(new Claim(ClaimTypes_.Role, role ?? "personel"));
        }

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(double.Parse(config["Jwt:ExpireHours"] ?? "24")),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private sealed class ResolvedShop
    {
        public Guid ShopId { get; init; }
        public string TenantCode { get; init; } = "";
        public string ShopName { get; init; } = "";
        public string? City { get; init; }
    }
}

public class TenantService(DbFactory db, TenantContext tenant)
{
    public Guid RequireShopId() =>
        tenant.IsSet ? tenant.ShopId : throw new UnauthorizedAccessException("Servis seçilmedi.");

    public Guid RequireUserId() =>
        tenant.IsSet ? tenant.UserId : throw new UnauthorizedAccessException("Oturum gerekli.");

    public string RequireRole() =>
        tenant.IsSet ? tenant.Role : throw new UnauthorizedAccessException("Oturum gerekli.");

    /// <summary>Servis yöneticisi servisteki tüm iş emirlerini görür.</summary>
    public bool CanSeeAllWorkOrders()
    {
        var role = RequireRole();
        return string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "usta", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<SqlConnection> OpenAsync()
    {
        var conn = new SqlConnection(db.ConnectionString);
        await conn.OpenAsync();
        // Filtrelenmiş indeksler (örn. UX_stock_code) için zorunlu.
        // Aksi halde stok UPDATE Msg 1934 / QUOTED_IDENTIFIER hatası verir.
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;";
        await cmd.ExecuteNonQueryAsync();
        return conn;
    }
}
