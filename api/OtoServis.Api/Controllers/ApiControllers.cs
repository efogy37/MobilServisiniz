using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoServis.Api.Models;
using OtoServis.Api.Services;

namespace OtoServis.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(AuthService auth) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest req)
    {
        var identifier = (req.Identifier ?? req.Phone)?.Trim();
        if (string.IsNullOrWhiteSpace(identifier))
            return BadRequest(new { error = "Telefon veya kullanıcı adı gerekli." });
        if (string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "Şifre gerekli." });

        // Eski istemciler hâlâ tenant kodu gönderebilir; gönderilmişse doğrula.
        if (!string.IsNullOrWhiteSpace(req.TenantCode))
        {
            var shop = await auth.LookupTenantAsync(req.TenantCode);
            if (shop is null)
                return Unauthorized(new { error = "Servis kodu geçersiz." });
        }

        try
        {
            var result = await auth.LoginAsync(identifier, req.Password, req.TenantCode);
            if (result is null)
                return Unauthorized(new { error = "Telefon/kullanıcı adı veya şifre hatalı." });
            return Ok(result);
        }
        catch (ShopLicenseExpiredException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = ex.Message,
                code = ShopLicenseHelper.ExpiredCode,
            });
        }
    }

    [HttpGet("lookup-tenant")]
    [AllowAnonymous]
    public async Task<ActionResult<ShopPreviewDto>> LookupTenant([FromQuery] string code)
    {
        if (string.IsNullOrWhiteSpace(code))
            return BadRequest(new { error = "Servis kodu gerekli." });
        var shop = await auth.LookupTenantAsync(code);
        return shop is null ? NotFound(new { error = "Servis bulunamadı." }) : Ok(shop);
    }

    [HttpPost("select-shop")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> SelectShop([FromBody] SelectShopRequest req)
    {
        var userId = User.GetUserId();
        try
        {
            var result = await auth.SelectShopAsync(userId, req.ShopId);
            if (result is null) return Forbid();
            return Ok(result);
        }
        catch (ShopLicenseExpiredException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = ex.Message,
                code = ShopLicenseHelper.ExpiredCode,
            });
        }
    }

    [HttpGet("license")]
    [Authorize]
    public async Task<ActionResult<ShopLicenseDto>> GetLicense()
    {
        var shopId = User.GetShopId();
        if (shopId is null) return Unauthorized();
        var license = await auth.GetShopLicenseAsync(shopId.Value);
        return license is null ? NotFound() : Ok(license);
    }

    [HttpGet("entitlements")]
    [Authorize]
    public async Task<ActionResult<PlanEntitlementsDto>> GetEntitlements()
    {
        var shopId = User.GetShopId();
        if (shopId is null) return Unauthorized();
        var ent = await auth.GetEntitlementsAsync(shopId.Value);
        return ent is null ? NotFound() : Ok(ent);
    }

    [HttpGet("shops")]
    [Authorize]
    public async Task<ActionResult> GetMyShops()
    {
        var userId = User.GetUserId();
        await using var conn = new Microsoft.Data.SqlClient.SqlConnection(
            HttpContext.RequestServices.GetRequiredService<DbFactory>().ConnectionString);
        await conn.OpenAsync();
        var shops = await Dapper.SqlMapper.QueryAsync<ShopMembershipDto>(conn,
            @"SELECT shop_id AS ShopId, tenant_code AS TenantCode, slug AS Slug,
                     shop_name AS ShopName, city AS City, role AS Role, title AS Title,
                     is_owner AS IsOwner, CAST(is_default AS bit) AS IsDefault
              FROM dbo.vw_UserShops WHERE user_id = @userId", new { userId });
        return Ok(shops);
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DashboardController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Get()
    {
        var d = await data.GetDashboardAsync();
        return d is null ? NotFound() : Ok(d);
    }
}

[ApiController]
[Route("api/reports")]
[Authorize]
public class ReportsController(DataService data) : ControllerBase
{
    [HttpGet("payments-pending")]
    public async Task<ActionResult<PaymentsPendingReportDto>> PaymentsPending()
    {
        if (User.GetShopRole() == "personel")
            return Forbid();
        return Ok(await data.GetPaymentsPendingAsync());
    }

    [HttpGet("cash-today")]
    public async Task<ActionResult<CashTodayReportDto>> CashToday()
    {
        if (User.GetShopRole() == "personel")
            return Forbid();
        return Ok(await data.GetCashTodayAsync());
    }

    [HttpGet("stock-usage")]
    public async Task<ActionResult> StockUsage([FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        try
        {
            return Ok(await data.GetStockUsageReportAsync(from, to));
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpGet("stock-purchase-sale")]
    public async Task<ActionResult> StockPurchaseSale(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string groupBy = "product")
    {
        if (User.GetShopRole() == "personel") return Forbid();
        try
        {
            var mode = (groupBy ?? "product").Trim().ToLowerInvariant();
            return mode switch
            {
                "vehicle" or "arac" => Ok(await data.GetStockPurchaseSaleByVehicleAsync(from, to)),
                "supplier" or "tedarikci" => Ok(await data.GetStockPurchaseSaleBySupplierAsync(from, to)),
                _ => Ok(await data.GetStockPurchaseSaleReportAsync(from, to)),
            };
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpGet("stock-movements")]
    public async Task<ActionResult> StockMovements(
        [FromQuery] Guid? stockProductId, [FromQuery] string? name,
        [FromQuery] Guid? vehicleId, [FromQuery] Guid? supplierId, [FromQuery] string? source,
        [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        return Ok(await data.GetStockMovementDetailAsync(
            stockProductId, name, from, to, vehicleId, supplierId, source));
    }

    [HttpGet("account-ledger")]
    public async Task<ActionResult> AccountLedger([FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        return Ok(await data.GetAccountLedgerReportAsync(from, to));
    }

    [HttpGet("customer-ledger")]
    public async Task<ActionResult> CustomerLedger(
        [FromQuery] Guid customerId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        return Ok(await data.GetCustomerLedgerDetailAsync(customerId, from, to));
    }

    [HttpGet("sales")]
    public async Task<ActionResult<SalesReportDto>> Sales([FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        return Ok(await data.GetSalesReportAsync(from, to));
    }
}

[ApiController]
[Route("api/shop")]
[Authorize]
public class ShopController(DataService data) : ControllerBase
{
    [HttpGet("payment-info")]
    public async Task<ActionResult<ShopPaymentInfoDto>> PaymentInfo()
    {
        if (User.GetShopRole() == "personel")
            return Forbid();
        var info = await data.GetShopPaymentInfoAsync();
        return info is null ? NotFound() : Ok(info);
    }

    [HttpPut("payment-info")]
    public async Task<ActionResult<ShopPaymentInfoDto>> UpdatePaymentInfo(
        [FromBody] UpdateShopPaymentInfoRequest req)
    {
        if (User.GetShopRole() == "personel")
            return Forbid();
        try
        {
            var info = await data.UpdateShopPaymentInfoAsync(req);
            return info is null ? NotFound() : Ok(info);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class CustomersController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? search)
        => Ok(await data.GetCustomersAsync(search));

    [HttpPost]
    public async Task<ActionResult<CustomerDto>> Create([FromBody] CreateCustomerRequest req)
    {
        try
        {
            var created = await data.CreateCustomerAsync(req, User.GetUserId());
            return created is null ? BadRequest() : Ok(created);
        }
        catch (CustomerPhoneConflictException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<CustomerDto>> Update(Guid id, [FromBody] UpdateCustomerRequest req)
    {
        try
        {
            var updated = await data.UpdateCustomerAsync(id, req, User.GetUserId());
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (CustomerPhoneConflictException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpGet("{id:guid}/activity")]
    public async Task<ActionResult> Activity(Guid id)
        => Ok(await data.GetCustomerActivityAsync(id));
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class VehiclesController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? status, [FromQuery] string? search, [FromQuery] Guid? customerId)
        => Ok(await data.GetVehiclesAsync(status, search, customerId));

    [HttpGet("{id:guid}/service-history")]
    public async Task<ActionResult<VehicleServiceHistoryDto>> ServiceHistory(Guid id)
    {
        var history = await data.GetVehicleServiceHistoryAsync(id);
        return history is null ? NotFound(new { error = "Araç bulunamadı." }) : Ok(history);
    }

    [HttpPost]
    public async Task<ActionResult<CreateVehicleResponse>> Create([FromBody] CreateVehicleRequest req)
    {
        try
        {
            var created = await data.CreateVehicleAsync(req, User.GetUserId());
            return created is null ? BadRequest() : Ok(created);
        }
        catch (VehiclePlateConflictException ex)
        {
            return Conflict(ex.Conflict);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (PlanLimitExceededException ex) { return ex.ToActionResult(); }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return Conflict(new { error = "Bu plaka zaten kayıtlı." });
        }
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<VehicleDto>> Update(Guid id, [FromBody] UpdateVehicleRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Plate) ||
            string.IsNullOrWhiteSpace(req.Brand) ||
            string.IsNullOrWhiteSpace(req.Model))
            return BadRequest(new { error = "Plaka, marka ve model zorunludur." });

        try
        {
            var updated = await data.UpdateVehicleAsync(id, req, User.GetUserId());
            return updated is null ? NotFound(new { error = "Araç bulunamadı." }) : Ok(updated);
        }
        catch (VehiclePlateConflictException ex)
        {
            return Conflict(ex.Conflict);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return Conflict(new { error = "Bu plaka zaten kayıtlı." });
        }
    }

    [HttpPost("{id:guid}/transfer")]
    public async Task<ActionResult<TransferVehicleResponse>> Transfer(Guid id, [FromBody] TransferVehicleRequest req)
    {
        try
        {
            var result = await data.TransferVehicleOwnerAsync(id, req, User.GetUserId());
            return result is null ? NotFound(new { error = "Araç veya müşteri bulunamadı." }) : Ok(result);
        }
        catch (PlanLimitExceededException ex) { return ex.ToActionResult(); }
    }

    [HttpPost("{id:guid}/new-visit")]
    public async Task<ActionResult<OpenNewVisitResponse>> NewVisit(Guid id, [FromBody] OpenNewVisitRequest req)
    {
        try
        {
            var result = await data.OpenNewVisitAsync(
                id, User.GetUserId(), req.Complaint, req.ComplaintCategory, req.OpenedAt);
            return result is null ? NotFound(new { error = "Araç bulunamadı." }) : Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (PlanLimitExceededException ex) { return ex.ToActionResult(); }
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ServiceCatalogController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List()
        => Ok(await data.GetServiceCatalogAsync());
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class StockController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? category, [FromQuery] string? search)
    {
        try { return Ok(await data.GetStockAsync(category, search)); }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpPost]
    public async Task<ActionResult<StockProductDto>> Create([FromBody] CreateStockRequest req)
    {
        try
        {
            var created = await data.CreateStockAsync(req);
            return created is null ? BadRequest() : Ok(created);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (StockCodeConflictException ex) { return Conflict(new { error = ex.Message }); }
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<StockProductDto>> Update(Guid id, [FromBody] UpdateStockRequest req)
    {
        try
        {
            var updated = await data.UpdateStockAsync(id, req);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (StockCodeConflictException ex) { return Conflict(new { error = ex.Message }); }
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        try
        {
            var result = await data.DeleteStockAsync(id);
            return result is null ? NotFound() : NoContent();
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (StockInUseException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpPost("match-lines")]
    public async Task<ActionResult<IReadOnlyList<MatchLineResultDto>>> MatchLines([FromBody] MatchStockLinesRequest req)
    {
        try { return Ok(await data.MatchStockLinesAsync(req)); }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpPost("import-purchase")]
    public async Task<ActionResult<ImportPurchaseResponse>> ImportPurchase([FromBody] ImportPurchaseRequest req)
    {
        try
        {
            var result = await data.ImportPurchaseAsync(req, User.GetUserId());
            return Ok(result);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number >= 50000)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class WorkOrdersController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? status)
        => Ok(await data.GetWorkOrdersAsync(status));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<WorkOrderDetailDto>> Get(Guid id)
    {
        var wo = await data.GetWorkOrderDetailAsync(id);
        return wo is null ? NotFound() : Ok(wo);
    }

    /// <summary>Yalnızca bekliyor (işleme alınmamış) iş emrini sistemden siler.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> DeleteWaiting(Guid id)
    {
        try
        {
            var ok = await data.DeleteWaitingWorkOrderAsync(id, User.GetUserId());
            return ok ? NoContent() : NotFound();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number >= 50000)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<ActionResult> UpdateStatus(Guid id, [FromBody] UpdateStatusRequest req)
    {
        try
        {
            var ok = await data.UpdateWorkOrderStatusAsync(
                id, req.Status, User.GetShopRole(), User.GetUserId(), req.AssignedUserId, req.AssignedUserName);
            return ok ? NoContent() : NotFound();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (WorkOrderReopenBlockedException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpGet("{id:guid}/payments")]
    public async Task<ActionResult<IReadOnlyList<WorkOrderPaymentDto>>> ListPayments(Guid id)
    {
        var rows = await data.GetWorkOrderPaymentsAsync(id);
        return rows is null ? NotFound() : Ok(rows);
    }

    [HttpPost("{id:guid}/payments")]
    public async Task<ActionResult<WorkOrderPaymentResultDto>> AddPayment(
        Guid id, [FromBody] RecordWorkOrderPaymentRequest req)
    {
        try
        {
            var result = await data.AddWorkOrderPaymentAsync(id, req, User.GetUserId());
            return result is null ? NotFound() : Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("{id:guid}/payments/{paymentId:guid}")]
    [HttpPost("{id:guid}/payments/{paymentId:guid}")]
    public async Task<ActionResult<WorkOrderPaymentResultDto>> UpdatePayment(
        Guid id, Guid paymentId, [FromBody] UpdateWorkOrderPaymentRequest req)
    {
        try
        {
            var result = await data.UpdateWorkOrderPaymentAsync(id, paymentId, req, User.GetUserId());
            return result is null ? NotFound() : Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{id:guid}/payments/{paymentId:guid}")]
    [HttpPost("{id:guid}/payments/{paymentId:guid}/delete")]
    public async Task<ActionResult<WorkOrderPaymentResultDto>> DeletePayment(Guid id, Guid paymentId)
    {
        var result = await data.DeleteWorkOrderPaymentAsync(id, paymentId, User.GetUserId());
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{id:guid}/discount")]
    [HttpPost("{id:guid}/discount")]
    public async Task<ActionResult<WorkOrderPaymentResultDto>> UpdateDiscount(
        Guid id, [FromBody] UpdateWorkOrderDiscountRequest req)
    {
        try
        {
            var result = await data.UpdateWorkOrderDiscountAsync(id, req, User.GetUserId());
            return result is null ? NotFound() : Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("{id:guid}/history")]
    public async Task<ActionResult> GetHistory(Guid id)
    {
        var rows = await data.GetWorkOrderStatusHistoryAsync(id);
        return rows is null ? NotFound() : Ok(rows);
    }

    [HttpPost("{id:guid}/complaints")]
    public async Task<ActionResult> AddComplaint(Guid id, [FromBody] AddComplaintRequest req)
    {
        var complaintId = await data.AddComplaintAsync(id, req.Description, req.Category);
        return complaintId is null ? NotFound() : Ok(new { id = complaintId });
    }

    [HttpPut("{id:guid}/complaints/{complaintId:guid}")]
    public async Task<ActionResult> UpdateComplaint(Guid id, Guid complaintId, [FromBody] UpdateComplaintRequest req)
    {
        var ok = await data.UpdateComplaintAsync(id, complaintId, req.Description, req.Category);
        return ok ? NoContent() : NotFound();
    }

    [HttpDelete("{id:guid}/complaints/{complaintId:guid}")]
    public async Task<ActionResult> DeleteComplaint(Guid id, Guid complaintId)
    {
        var ok = await data.DeleteComplaintAsync(id, complaintId, User.GetUserId());
        return ok ? NoContent() : NotFound();
    }

    [HttpPost("{id:guid}/services")]
    public async Task<ActionResult> AddService(Guid id, [FromBody] AddServiceRequest req)
    {
        try
        {
            var serviceId = await data.AddServiceAsync(id, req, User.GetUserId());
            return serviceId is null ? NotFound() : Ok(new { id = serviceId });
        }
        catch (WorkOrderCompletedException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpPost("{id:guid}/parts")]
    public async Task<ActionResult> AddPart(Guid id, [FromBody] AddPartRequest req)
    {
        try
        {
            await data.AddPartAsync(id, req, User.GetUserId());
            return NoContent();
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (WorkOrderCompletedException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number >= 50000)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{id:guid}/images")]
    [RequestSizeLimit(6_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 6_000_000)]
    public async Task<ActionResult<WorkOrderImageDto>> UploadImage(
        Guid id, IFormFile? file, [FromForm] string imageType,
        [FromForm] string? complaintId, [FromForm] string? serviceId)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "Fotoğraf dosyası gerekli." });
        try
        {
            Guid? complaintGuid = Guid.TryParse(complaintId, out var cId) ? cId : null;
            Guid? serviceGuid = Guid.TryParse(serviceId, out var sId) ? sId : null;
            var img = await data.AddWorkOrderImageAsync(id, file, imageType, User.GetUserId(), complaintGuid, serviceGuid);
            return img is null ? NotFound() : Ok(img);
        }
        catch (ImageTooLargeException ex)
        {
            return StatusCode(413, new { error = ex.Message });
        }
        catch (ImageLimitExceededException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
        catch (IOException ex)
        {
            return StatusCode(500, new { error = "Fotoğraf kaydedilemedi: " + ex.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return StatusCode(500, new { error = "Fotoğraf klasörüne yazılamadı. IIS App Pool'a uploads yazma izni verin." });
        }
    }

    [HttpGet("{id:guid}/images")]
    public async Task<ActionResult> ListImages(Guid id)
    {
        var rows = await data.GetWorkOrderImagesAsync(id);
        return rows is null ? NotFound() : Ok(rows);
    }

    [HttpDelete("{id:guid}/images/{imageId:guid}")]
    public async Task<ActionResult> DeleteImage(Guid id, Guid imageId)
    {
        var ok = await data.DeleteWorkOrderImageAsync(id, imageId);
        return ok ? NoContent() : NotFound();
    }

    [HttpPatch("{id:guid}/services/{serviceId:guid}")]
    public async Task<ActionResult> UpdateService(Guid id, Guid serviceId, [FromBody] UpdateServiceRequest req)
    {
        var ok = await data.UpdateServiceAsync(id, serviceId, req, User.GetUserId());
        return ok ? NoContent() : NotFound();
    }

    [HttpDelete("{id:guid}/services/{serviceId:guid}")]
    public async Task<ActionResult> DeleteService(Guid id, Guid serviceId)
    {
        var ok = await data.DeleteServiceAsync(id, serviceId, User.GetUserId());
        return ok ? NoContent() : NotFound();
    }

    [HttpPatch("{id:guid}/parts/{partId:guid}")]
    [HttpPost("{id:guid}/parts/{partId:guid}")]
    public async Task<ActionResult> UpdatePart(Guid id, Guid partId, [FromBody] UpdatePartRequest req)
    {
        try
        {
            await data.UpdatePartAsync(id, partId, req, User.GetUserId());
            return NoContent();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number >= 50000)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpDelete("{id:guid}/parts/{partId:guid}")]
    [HttpPost("{id:guid}/parts/{partId:guid}/delete")]
    public async Task<ActionResult> DeletePart(Guid id, Guid partId)
    {
        try
        {
            await data.DeletePartAsync(id, partId, User.GetUserId());
            return NoContent();
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number >= 50000)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("{id:guid}/parts/{partId:guid}/return-to-supplier")]
    public async Task<ActionResult> ReturnPartToSupplier(Guid id, Guid partId)
    {
        try
        {
            await data.ReturnPartToSupplierAsync(id, partId, User.GetUserId());
            return NoContent();
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number >= 50000)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

[ApiController]
[Route("api/app")]
[Authorize]
public class AppController(DataService data) : ControllerBase
{
    [HttpGet("vehicles")]
    public async Task<ActionResult> GetVehicles()
        => Ok(await data.GetMobileVehiclesAsync());

    [HttpGet("update-info")]
    [AllowAnonymous]
    public async Task<ActionResult<AppUpdateInfoDto>> GetUpdateInfo()
    {
        var info = await data.GetAppUpdateInfoAsync();
        return info is null ? NotFound(new { error = "Sürüm bilgisi bulunamadı." }) : Ok(info);
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class StaffController(DataService data) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List()
        => Ok(await data.GetStaffAsync(User.GetShopRole(), User.GetUserId()));

    [HttpGet("performance")]
    public async Task<ActionResult> GetPerformance([FromQuery] DateOnly? date, [FromQuery] Guid? userId)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        try
        {
            var d = date ?? DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
            var rows = await data.GetStaffPerformanceAsync(d, User.GetShopRole(), User.GetUserId(), userId);
            return Ok(rows);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SuppliersController(DataService data, PlanEntitlementsService plans) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List([FromQuery] string? search)
    {
        try { return Ok(await data.GetSuppliersAsync(search)); }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpPost]
    public async Task<ActionResult<SupplierDto>> Create([FromBody] CreateSupplierRequest req)
    {
        try
        {
            var created = await data.CreateSupplierAsync(req, User.GetUserId());
            return created is null ? BadRequest() : Ok(created);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (SupplierPhoneConflictException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpGet("report")]
    public async Task<ActionResult> Report(
        [FromQuery] string? period,
        [FromQuery] DateOnly? date,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to)
    {
        if (User.GetShopRole() == "personel") return Forbid();
        try
        {
            await plans.RequireFeatureAsync("suppliers");
            if (from.HasValue || to.HasValue)
            {
                var turkeyToday = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
                var f = from ?? to ?? turkeyToday;
                var t = to ?? from ?? f;
                return Ok(await data.GetSupplierReportAsync(f, t));
            }

            var p = period == "weekly" ? "weekly" : "daily";
            var d = date ?? DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
            return Ok(await data.GetSupplierReportAsync(p, d));
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<SupplierLedgerDto>> Get(Guid id)
    {
        try
        {
            var ledger = await data.GetSupplierLedgerAsync(id);
            return ledger is null ? NotFound() : Ok(ledger);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
    }

    [HttpPost("{id:guid}/payments")]
    public async Task<ActionResult<SupplierLedgerDto>> RecordPayment(Guid id, [FromBody] RecordSupplierPaymentRequest req)
    {
        try
        {
            var ledger = await data.RecordSupplierPaymentAsync(id, req, User.GetUserId());
            return ledger is null ? NotFound() : Ok(ledger);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("{id:guid}/discounts")]
    public async Task<ActionResult<SupplierLedgerDto>> RecordDiscount(Guid id, [FromBody] RecordSupplierDiscountRequest req)
    {
        try
        {
            var ledger = await data.RecordSupplierDiscountAsync(id, req, User.GetUserId());
            return ledger is null ? NotFound() : Ok(ledger);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("{id:guid}/transactions/{txId:guid}")]
    public async Task<ActionResult<SupplierLedgerDto>> UpdateTransaction(
        Guid id, Guid txId, [FromBody] UpdateSupplierTransactionRequest req)
    {
        try
        {
            var ledger = await data.UpdateSupplierTransactionAsync(id, txId, req, User.GetUserId());
            return ledger is null ? NotFound() : Ok(ledger);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{id:guid}/transactions/{txId:guid}")]
    public async Task<ActionResult<SupplierLedgerDto>> DeleteTransaction(Guid id, Guid txId)
    {
        try
        {
            var ledger = await data.DeleteSupplierTransactionAsync(id, txId, User.GetUserId());
            return ledger is null ? NotFound() : Ok(ledger);
        }
        catch (PlanFeatureDeniedException ex) { return ex.ToActionResult(); }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
