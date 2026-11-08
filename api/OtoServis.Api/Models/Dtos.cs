namespace OtoServis.Api.Models;

/// <summary>
/// Giriş: telefon veya kullanıcı adı + şifre.
/// TenantCode isteğe bağlı (eski istemciler / çoklu servis seçimi için).
/// Identifier veya Phone alanlarından biri yeterlidir.
/// </summary>
public record LoginRequest(
    string Password,
    string? Identifier = null,
    string? Phone = null,
    string? TenantCode = null);
public record SelectShopRequest(Guid ShopId);
public record ShopPreviewDto(Guid ShopId, string TenantCode, string ShopName, string? City);

public record AuthResponse(
    string Token,
    UserDto User,
    IReadOnlyList<ShopMembershipDto> Shops,
    ShopMembershipDto? ActiveShop,
    ShopLicenseDto? License = null,
    PlanEntitlementsDto? Entitlements = null);

public record ShopLicenseDto(
    string LicenseType,
    DateTime? LicenseExpiresAt,
    string LicenseStatus,
    int? DaysRemaining);

public record PlanFeaturesDto(
    bool Stock,
    bool Suppliers,
    bool StaffPerformance,
    bool AiRuhsat,
    bool AiInvoice,
    bool ApiAccess);

public record PlanEntitlementsDto(
    string PlanCode,
    string PlanLabel,
    decimal MonthlyPrice,
    int? MaxUsers,
    int? MaxVehiclesPerMonth,
    PlanFeaturesDto Features);

public record UserDto(Guid Id, string FullName, string Phone, string? Email);

public record ShopMembershipDto(
    Guid ShopId,
    string TenantCode,
    string Slug,
    string ShopName,
    string? City,
    string Role,
    string? Title,
    bool IsOwner,
    bool IsDefault);

public record DashboardDto(
    int Waiting,
    int InProgress,
    int Customers,
    int Vehicles,
    int StaffCount,
    int LowStock,
    int MonthVehiclesServiced = 0,
    int MonthOperations = 0);

public record CustomerDto(
    Guid Id,
    string CustomerType,
    string FullName,
    string? CompanyName,
    string Phone,
    string? Email,
    string? Address,
    string? City,
    bool IsSupplier = false,
    bool IsCustomer = true,
    string? TaxNo = null,
    decimal? OpeningBalance = null,
    /// <summary>Müşteri alacağı: ödenmemiş iş emri kalanları toplamı.</summary>
    decimal? Balance = null,
    /// <summary>Tedarikçi borcu: opening + alış − ödeme − iade − iskonto.</summary>
    decimal? SupplierBalance = null);

public record CreateCustomerRequest(
    string FullName,
    string Phone,
    string CustomerType = "bireysel",
    string? CompanyName = null,
    string? Email = null,
    string? Address = null,
    string? City = null,
    bool IsSupplier = false,
    bool IsCustomer = true,
    string? TaxNo = null,
    decimal? OpeningBalance = null);

public record UpdateCustomerRequest(
    string FullName,
    string Phone,
    string CustomerType = "bireysel",
    string? CompanyName = null,
    string? Email = null,
    string? Address = null,
    string? City = null,
    bool IsSupplier = false,
    bool IsCustomer = true,
    string? TaxNo = null,
    decimal? OpeningBalance = null);

public class CustomerPhoneConflictException()
    : Exception("Bu telefon numarasıyla kayıtlı bir müşteri zaten var.");

public record CreateStockRequest(
    string Name,
    string Category = "diger",
    string? Code = null,
    decimal Price = 0,
    int Quantity = 0,
    int MinQuantity = 0,
    decimal? PurchasePrice = null);

public record UpdateStockRequest(
    string Name,
    string Category,
    string? Code,
    decimal Price,
    int Quantity,
    int MinQuantity,
    decimal? PurchasePrice = null);

public record ScanInvoiceRequest(string FileBase64, string? MimeType = "application/pdf");

/// <summary>
/// PDF'den okunan satır. UnitPrice/LineTotal: e-Fatura'da KDV DAHİL net değerler,
/// Parçacı formatında faturadaki birim fiyat/tutar (KDV bilgisi yok).
/// Code: faturada geçen ORİJİNAL stok kodu (firma ön ekleriyle, dokunulmamış).
/// </summary>
public record InvoiceScanLineDto(
    string Name,
    int Quantity,
    decimal UnitPrice,
    decimal LineTotal,
    string? Code = null,
    string? Brand = null,
    decimal? NetUnitPriceExclVat = null,
    decimal? VatRate = null,
    string? Warning = null);

public record InvoiceScanResponse(
    string? DocumentNo,
    string? DocumentDate,
    IReadOnlyList<InvoiceScanLineDto> Lines,
    string? Provider = null,
    string? SupplierName = null,
    decimal? GrandTotal = null,
    string Format = "parcaci",
    string? Warning = null);

public record ImportPurchaseLineRequest(
    string Name,
    int Quantity,
    decimal UnitPrice,
    decimal? SalePrice = null,
    string Category = "diger",
    string? Code = null,
    Guid? StockProductId = null,
    string? ManufacturerCode = null,
    string? Brand = null);

/* ---- PDF satırı ↔ stok eşleştirme ---- */
public record MatchLineRequest(int Index, string Name, string? RawCode = null, string? Brand = null);
public record MatchStockLinesRequest(Guid? SupplierId, IReadOnlyList<MatchLineRequest> Lines);
public record MatchCandidateDto(Guid StockId, string Name, string? Code, int Quantity, decimal Price, int Score, string Reason);
/// <summary>Status: exact | multiple | suggested | none</summary>
public record MatchLineResultDto(
    int Index,
    string? RawCode,
    string? ManufacturerCode,
    string Status,
    IReadOnlyList<MatchCandidateDto> Candidates);

public record ImportPurchaseRequest(
    Guid SupplierId,
    IReadOnlyList<ImportPurchaseLineRequest> Lines,
    string? DocumentNo = null,
    string? DocumentDate = null);

public record ImportPurchaseResponse(
    int CreatedCount,
    int UpdatedCount,
    decimal TotalPurchase,
    Guid? LedgerTransactionId);

public record UpdateServiceRequest(string Title, decimal Price);
public record UpdatePartRequest(
    string Name,
    int Quantity,
    decimal UnitPrice,
    decimal? PurchasePrice = null,
    string? Source = null,
    Guid? SupplierId = null,
    Guid? StockProductId = null);

public record CreateVehicleResponse(Guid VehicleId, Guid WorkOrderId, VehicleDto Vehicle);

public record VehicleDto(
    Guid Id,
    Guid CustomerId,
    string CustomerName,
    string Plate,
    string Brand,
    string Model,
    int? ModelYear,
    string? Color,
    string Fuel,
    string? ChassisNo,
    string? EngineNo,
    string? EngineVolume,
    int? Mileage,
    string? Status);

public record CreateVehicleRequest(
    Guid CustomerId,
    string Plate,
    string Brand,
    string Model,
    int? ModelYear = null,
    string? Color = null,
    string Fuel = "diger",
    string? ChassisNo = null,
    string? EngineNo = null,
    string? EngineVolume = null,
    int? Mileage = null,
    string? Complaint = null,
    string? ComplaintCategory = null,
    /// <summary>Geliş/servis tarihi (Türkiye takvim günü). Boşsa şimdi.</summary>
    DateTime? OpenedAt = null);

public record UpdateVehicleRequest(
    string Plate,
    string Brand,
    string Model,
    int? ModelYear = null,
    string? Color = null,
    string Fuel = "diger",
    string? ChassisNo = null,
    string? EngineNo = null,
    string? EngineVolume = null,
    int? Mileage = null);

public record VehicleConflictDto(
    Guid VehicleId,
    Guid CustomerId,
    string CustomerName,
    string Brand,
    string Model);

public class VehiclePlateConflictException(VehicleConflictDto conflict)
    : Exception("Bu plaka zaten başka bir müşteriye kayıtlı.")
{
    public VehicleConflictDto Conflict { get; } = conflict;
}

public record TransferVehicleRequest(
    Guid NewCustomerId,
    string? Complaint = null,
    string? ComplaintCategory = null);
public record TransferVehicleResponse(Guid VehicleId, Guid WorkOrderId);

public record ServiceCatalogDto(
    Guid Id,
    string? Code,
    string Name,
    string Category,
    decimal DefaultPrice,
    int? EstimatedMinutes);

public record WorkOrderDto(
    Guid Id,
    long OrderNo,
    string Status,
    string Plate,
    string CustomerName,
    string CustomerPhone,
    int? MileageIn,
    decimal GrandTotal,
    decimal PaidTotal,
    DateTime OpenedAt,
    /// <summary>Aynı araç için bu iş emrinin kaçıncı servis kaydı (1, 2, 3…).</summary>
    int VisitNumber = 1);

public record WorkOrderDetailDto(
    Guid Id,
    long OrderNo,
    string Status,
    VehicleDto Vehicle,
    CustomerDto Customer,
    IReadOnlyList<ComplaintDto> Complaints,
    IReadOnlyList<ServiceLineDto> Services,
    IReadOnlyList<PartLineDto> Parts,
    decimal LaborTotal,
    decimal PartsTotal,
    decimal Discount,
    decimal GrandTotal,
    decimal PaidTotal,
    string? AssignedTo,
    DateTime OpenedAt = default,
    DateTime? StartedAt = null,
    DateTime? ClosedAt = null,
    /// <summary>Aynı araç için bu iş emrinin kaçıncı servis kaydı (1, 2, 3…).</summary>
    int VisitNumber = 1);

public record ComplaintDto(Guid Id, string Description, DateTime CreatedAt, string Category = "diger");
public record ServiceLineDto(Guid Id, string Title, decimal Price);

/// <summary>Müşteri detayında araç tıklanınca gösterilen servis/ürün geçmişi.</summary>
public record VehicleServiceHistoryDto(
    Guid VehicleId,
    string Plate,
    string Brand,
    string Model,
    IReadOnlyList<VehicleVisitHistoryDto> Visits);

public record VehicleVisitHistoryDto(
    Guid WorkOrderId,
    long OrderNo,
    string Status,
    DateTime OpenedAt,
    int VisitNumber,
    IReadOnlyList<ServiceLineDto> Services,
    IReadOnlyList<VehicleHistoryPartDto> Parts);

public record VehicleHistoryPartDto(
    Guid Id,
    string Name,
    int Quantity,
    decimal UnitPrice);
public record PartLineDto(
    Guid Id,
    string Name,
    int Quantity,
    decimal UnitPrice,
    string Source,
    Guid? SupplierId,
    string? SupplierName,
    decimal? PurchasePrice,
    DateTime? ReturnedAt);

public record StockProductDto(
    Guid Id,
    string Name,
    string Category,
    string? Code,
    decimal Price,
    int Quantity,
    int MinQuantity,
    decimal? PurchasePrice = null);

public record AddServiceRequest(Guid? ServiceCatalogId, string Title, decimal Price, bool Force = false);
public record AddPartRequest(
    Guid? StockProductId,
    string Name,
    int Quantity,
    decimal UnitPrice,
    string Source = "stok",
    Guid? SupplierId = null,
    decimal? PurchasePrice = null,
    bool Force = false,
    string? SupplierCode = null,
    Guid? MatchedStockProductId = null,
    string? ManufacturerCode = null,
    string? Brand = null);
public record AddComplaintRequest(string Description, string? Category = null);
public record UpdateComplaintRequest(string Description, string? Category = null);
public record UpdateStatusRequest(string Status, Guid? AssignedUserId = null, string? AssignedUserName = null);

public record ShopPaymentInfoDto(string ShopName, string? BankIban, string? BankName, string? AccountHolder);

public record AppUpdateInfoDto(
    string LatestVersion,
    int LatestVersionCode,
    int MinVersionCode,
    string? StoreUrl,
    string? ReleaseNotes);

public record UpdateShopPaymentInfoRequest(
    string? BankIban = null,
    string? BankName = null,
    string? AccountHolder = null);

public record RecordWorkOrderPaymentRequest(decimal Amount, string Method = "nakit");

public record UpdateWorkOrderPaymentRequest(decimal Amount, string Method = "nakit");

public record WorkOrderPaymentDto(
    Guid Id,
    decimal Amount,
    string Method,
    DateTime PaidAt,
    string? ReceivedByName);

public record WorkOrderPaymentResultDto(
    decimal GrandTotal,
    decimal PaidTotal,
    decimal Discount = 0,
    Guid? PaymentId = null);

public record UpdateWorkOrderDiscountRequest(decimal Amount);

public record PaymentPendingItemDto(
    Guid WorkOrderId,
    Guid VehicleId,
    string Plate,
    string CustomerName,
    string Status,
    decimal GrandTotal,
    decimal PaidTotal,
    decimal Remaining,
    int VisitNumber = 1,
    /// <summary>Ödeme beklemeye başladığı an (servis tamamlanma / closed_at, yoksa opened_at).</summary>
    DateTime PendingSince = default,
    /// <summary>Türkiye takvim gününe göre kaç gündür bekliyor.</summary>
    int DaysWaiting = 0);

public record PaymentsPendingReportDto(
    int Count,
    decimal TotalRemaining,
    IReadOnlyList<PaymentPendingItemDto> Items);

public record CashTodayReportDto(
    decimal Total,
    decimal Nakit,
    decimal Kart,
    decimal Havale,
    decimal Diger);

public record ActivityLogEntryDto(
    long Id,
    string Action,
    string EntityType,
    string Description,
    string? UserName,
    DateTime CreatedAt);

public class WorkOrderCompletedException() : Exception("Bu iş tamamlanmış.");

public class StockInUseException()
    : Exception("Bu ürün daha önce iş emrinde kullanılmış veya alım/satım hareketi görmüş. Önce ilgili hareketleri (iş emri parçası vb.) silin, sonra stoktan silebilirsiniz.");

public class StockCodeConflictException()
    : Exception("Bu ürün kodu zaten stokta var. Aynı kodla ikinci ürün eklenemez; kodu değiştirin veya boş bırakın.");

public class WorkOrderReopenBlockedException()
    : Exception("Bu iş farklı bir günde tamamlandı, durumu geri alamazsınız. Yeni bir servis kaydı açabilirsiniz.");

public record OpenNewVisitRequest(
    string? Complaint = null,
    string? ComplaintCategory = null,
    /// <summary>Geliş/servis tarihi (Türkiye takvim günü). Boşsa şimdi.</summary>
    DateTime? OpenedAt = null);
public record OpenNewVisitResponse(Guid VehicleId, Guid WorkOrderId);

public record WorkOrderStatusHistoryDto(
    Guid Id,
    string? OldStatus,
    string NewStatus,
    DateTime ChangedAt,
    string? ChangedByName);

public record WorkOrderImageDto(Guid Id, string ImageType, string Url, DateTime CreatedAt, Guid? ComplaintId = null, Guid? ServiceId = null);

public class ImageTooLargeException() : Exception("Fotoğraf 5MB'den büyük olamaz.");
public class ImageLimitExceededException() : Exception("Bu iş emri için fotoğraf limiti (8) doldu.");

public record StaffDto(Guid Id, string FullName, string Role);

public record StaffPerformanceRow(Guid? UserId, string FullName, int JobCount, decimal Revenue);

public record SupplierDto(
    Guid Id,
    string Name,
    string? Contact,
    string? Phone,
    string? Email,
    string? Address,
    string? TaxNo,
    decimal Balance);

public record CreateSupplierRequest(
    string Name,
    string? Contact = null,
    string? Phone = null,
    string? Email = null,
    string? Address = null,
    string? TaxNo = null,
    decimal OpeningBalance = 0);

public record SupplierTransactionDto(
    Guid Id,
    string Type,
    decimal Amount,
    string? Description,
    DateTime CreatedAt,
    string? Method = null,
    Guid? WorkOrderPartId = null,
    string? PartName = null,
    int? PartQuantity = null,
    decimal? PurchasePrice = null,
    string? Plate = null,
    string? Brand = null,
    string? Model = null,
    Guid? WorkOrderId = null,
    Guid? VehicleId = null);

public record SupplierLedgerDto(SupplierDto Supplier, IReadOnlyList<SupplierTransactionDto> Transactions);
public record RecordSupplierPaymentRequest(
    decimal Amount,
    string? Description = null,
    string? Method = null);

public record RecordSupplierDiscountRequest(decimal Amount, string? Description = null);

public record UpdateSupplierTransactionRequest(
    decimal Amount,
    string? Description = null,
    string? Method = null);
public record SupplierReportRow(Guid SupplierId, string SupplierName, decimal TotalPurchases, decimal TotalReturns, int TransactionCount);

/// <summary>Tarih aralığında en çok kullanılan/satılan stok ürünleri (miktar bazlı sıralı).</summary>
public record StockUsageReportRow(
    Guid? StockProductId,
    string Name,
    string? Category,
    int TotalQuantity,
    decimal TotalRevenue,
    int WorkOrderCount);

/// <summary>Bir stok kaleminin tek tek hareketleri (hangi tarihte, hangi araca/tedarikçiden ne fiyata).</summary>
public record StockMovementDetailRow(
    DateTime Date,
    string Plate,
    string CustomerName,
    int Quantity,
    decimal UnitPrice,
    decimal? PurchasePrice,
    string? SupplierName,
    string? PartName = null);

/// <summary>Ürün bazlı alış (maliyet) / satış (ciro) / kâr özeti.</summary>
public record StockPurchaseSaleRow(
    Guid? StockProductId,
    string Name,
    string? Category,
    int TotalQuantity,
    decimal TotalPurchaseAmount,
    decimal TotalSaleAmount,
    decimal Profit);

/// <summary>Araç bazlı parça alış / satış / kâr özeti.</summary>
public record StockPurchaseSaleVehicleRow(
    Guid VehicleId,
    string Plate,
    string? CustomerName,
    string? Brand,
    string? Model,
    int TotalQuantity,
    decimal TotalPurchaseAmount,
    decimal TotalSaleAmount,
    decimal Profit);

/// <summary>Tedarikçi / kaynak bazlı parça alış / satış / kâr özeti (stok + dışarıdan temin).</summary>
public record StockPurchaseSaleSupplierRow(
    Guid? SupplierId,
    string SupplierName,
    string Source, // "stok" | "disaridan"
    int TotalQuantity,
    decimal TotalPurchaseAmount,
    decimal TotalSaleAmount,
    decimal Profit);

/// <summary>Cari hesap (müşteri/tedarikçi) hareket özeti — seçilen dönemdeki borç/alacak.</summary>
public record AccountLedgerRow(
    Guid AccountId,
    string AccountName,
    string AccountType, // "musteri" | "tedarikci"
    decimal TotalDebit,
    decimal TotalCredit,
    int MovementCount,
    decimal CurrentBalance);

/// <summary>Bir müşterinin cari hesabındaki tek tek hareketler (iş emri borcu / tahsilat).</summary>
public record CustomerLedgerEntryDto(
    DateTime Date,
    string Type, // "borc" | "tahsilat"
    string Description,
    decimal Amount,
    string? Plate);

public record TopServiceRow(string Title, int Count, decimal TotalAmount);

public record TopPartRow(string Name, int Quantity, decimal TotalAmount);

/// <summary>
/// Genel satış/ciro raporu.
/// TotalRevenue / TotalDiscount / TotalOutstanding: dönemde açılan iş emirleri.
/// TotalPaid + Nakit/Kart/Havale/Diğer: dönemde alınan tahsilatlar (paid_at).
/// </summary>
public record SalesReportDto(
    int WorkOrderCount,
    decimal TotalRevenue,
    decimal TotalPaid,
    decimal TotalDiscount,
    decimal TotalOutstanding,
    decimal Nakit,
    decimal Kart,
    decimal Havale,
    decimal Diger,
    IReadOnlyList<TopServiceRow> TopServices,
    /// <summary>Dönemde en çok yapılan işçilikler (adet sırası).</summary>
    IReadOnlyList<TopServiceRow> TopJobs,
    /// <summary>Dönemde en çok satılan yedek parçalar (adet sırası).</summary>
    IReadOnlyList<TopPartRow> TopParts);

public class SupplierPhoneConflictException()
    : Exception("Bu telefon numarasıyla kayıtlı bir cari zaten var.");

public record ScanRuhsatRequest(string ImageBase64, string? MimeType = "image/jpeg");

public record RuhsatScanResponse(
    string Plate,
    string Brand,
    string Model,
    string Year,
    string Color,
    string Fuel,
    string Chassis,
    string EngineNo,
    string EngineVolume,
    string? Provider = null,
    string? ModelUsed = null);
