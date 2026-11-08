using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Data.SqlClient;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using OtoServis.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<DbFactory>();
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<TenantService>();
builder.Services.AddScoped<PlanEntitlementsService>();
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.AddScoped<DataService>();
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.AddSingleton<OcrScanService>();
builder.Services.AddHttpClient<AiScanService>(c =>
{
    c.Timeout = TimeSpan.FromSeconds(90);
});
builder.Services.AddHttpClient<InvoiceScanService>(c =>
{
    c.Timeout = TimeSpan.FromSeconds(90);
});

var jwtKey = builder.Configuration["Jwt:Key"]!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        };
    });
builder.Services.AddAuthorization();

builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(opt =>
{
    opt.MultipartBodyLengthLimit = 30_000_000;
});
builder.WebHost.ConfigureKestrel(opt =>
{
    opt.Limits.MaxRequestBodySize = 30_000_000;
});
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "MobilServisiniz API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "JWT: Bearer {token}",
    });
    c.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", document)] = [],
    });
});

builder.Services.AddCors(opt =>
{
    opt.AddDefaultPolicy(p => p
        .AllowAnyOrigin()
        .AllowAnyHeader()
        .AllowAnyMethod());
});

var storage = builder.Configuration.GetSection(StorageOptions.SectionName).Get<StorageOptions>()
    ?? new StorageOptions();
var contentRoot = builder.Environment.ContentRootPath;
if (!string.IsNullOrWhiteSpace(storage.Root))
    builder.WebHost.UseWebRoot(storage.ResolveWwwroot(contentRoot));

var app = builder.Build();

// Cloudflare/IIS arkasinda calisiyoruz: X-Forwarded-Proto/X-Forwarded-For'u okuyup
// Request.Scheme'i duzeltiyoruz (Admin/Platform'daki ayni duzeltmeyle tutarli olsun).
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
};
// ONEMLI: "KnownNetworks = { }" / "KnownProxies = { }" koleksiyonu TEMIZLEMEZ,
// sadece "hic eleman ekleme" demektir - varsayilan (sadece loopback) degerler
// oldugu gibi kalir ve Cloudflare'den (loopback olmayan) gelen baglanti
// guvenilmez sayilip X-Forwarded-* hic islenmez. Gercekten temizlemek icin
// .Clear() gerekir.
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeadersOptions);

app.UseExceptionHandler(err =>
{
    err.UseCors();
    err.Run(async ctx =>
    {
        var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
        ctx.Response.ContentType = "application/json";
        if (ex is SqlException sql && sql.Number is 2601 or 2627)
        {
            ctx.Response.StatusCode = StatusCodes.Status409Conflict;
            await ctx.Response.WriteAsJsonAsync(new
            {
                error = "Bu ürün kodu zaten stokta var. Aynı kodla ikinci ürün eklenemez; kodu değiştirin veya boş bırakın.",
            });
            return;
        }
        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await ctx.Response.WriteAsJsonAsync(new { error = "Sunucu hatası. Tekrar deneyin." });
    });
});

app.UseSwagger();
app.UseSwaggerUI();

app.UseCors();

var webRoot = app.Environment.WebRootPath
    ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var uploadsRoot = storage.ResolveUploads(app.Environment.ContentRootPath);
Directory.CreateDirectory(uploadsRoot);
Directory.CreateDirectory(Path.Combine(webRoot, "releases"));
Directory.CreateDirectory(Path.Combine(webRoot, "apk", "ios", "mobilservisiniz"));
var staticTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
staticTypes.Mappings[".apk"] = "application/vnd.android.package-archive";
staticTypes.Mappings[".ipa"] = "application/octet-stream";
staticTypes.Mappings[".plist"] = "application/xml";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = staticTypes });
var defaultUploads = Path.GetFullPath(Path.Combine(webRoot, "uploads"));
if (!string.Equals(Path.GetFullPath(uploadsRoot), defaultUploads, StringComparison.OrdinalIgnoreCase))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(uploadsRoot),
        RequestPath = "/uploads",
        ContentTypeProvider = staticTypes,
    });
}

app.UseAuthentication();
app.Use(async (ctx, next) =>
{
    if (ctx.User.Identity?.IsAuthenticated == true)
    {
        // Anonim auth uçları: istemci yanlışlıkla eski Bearer gönderse bile login çalışsın
        var path = ctx.Request.Path.Value ?? "";
        var skipSession =
            path.StartsWith("/api/auth/login", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/auth/lookup-tenant", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/app/update-info", StringComparison.OrdinalIgnoreCase);

        var tenant = ctx.RequestServices.GetRequiredService<TenantContext>();
        var auth = ctx.RequestServices.GetRequiredService<AuthService>();
        var userId = ctx.User.GetUserId();

        if (!skipSession)
        {
            var sessionId = ctx.User.GetSessionId();
            if (!await auth.ValidateSessionAsync(userId, sessionId))
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsJsonAsync(new
                {
                    error = "Hesabınıza başka bir cihazdan giriş yapıldı. Lütfen tekrar giriş yapın.",
                    code = "SESSION_REPLACED",
                });
                return;
            }
        }

        var shopId = ctx.User.GetShopId();
        var role = ctx.User.GetShopRole();

        if (shopId.HasValue && !string.IsNullOrEmpty(role))
        {
            if (await auth.ValidateShopAccessAsync(userId, shopId.Value))
                tenant.Set(userId, shopId.Value, role);

            if (!skipSession)
            {
                var license = await auth.GetShopLicenseAsync(shopId.Value);
                if (license?.LicenseStatus == "expired")
                {
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    ctx.Response.ContentType = "application/json";
                    await ctx.Response.WriteAsJsonAsync(new
                    {
                        error = "Servis lisans süreniz dolmuştur. Yenileme için lütfen iletişime geçin.",
                        code = ShopLicenseHelper.ExpiredCode,
                    });
                    return;
                }
            }
        }
    }
    await next();
});
app.UseAuthorization();
app.MapControllers();

app.Run();
