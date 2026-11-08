using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc.Rendering;

namespace OtoServis.Admin.Models;

public class LoginViewModel
{
    [Required(ErrorMessage = "Telefon veya kullanıcı adı gerekli")]
    [Display(Name = "Telefon veya kullanıcı adı")]
    public string Identifier { get; set; } = "";

    [Required(ErrorMessage = "Şifre gerekli")]
    [DataType(DataType.Password)]
    [Display(Name = "Şifre")]
    public string Password { get; set; } = "";
}

public class SelectShopViewModel
{
    public IReadOnlyList<ShopOption> Shops { get; set; } = [];
    public Guid? SelectedShopId { get; set; }
}

public record ShopOption(Guid ShopId, string TenantCode, string ShopName, string? City, string Role, bool IsDefault);

public class DashboardViewModel
{
    public string ShopName { get; set; } = "";
    public int Waiting { get; set; }
    public int InProgress { get; set; }
    public int Customers { get; set; }
    public int Vehicles { get; set; }
    public int StaffCount { get; set; }
    public int LowStock { get; set; }
}

public class CustomerListItem
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string? Address { get; set; }
    public string? City { get; set; }
    public string CustomerType { get; set; } = "";
    public bool IsSupplier { get; set; }
}

public class CustomersIndexViewModel
{
    public string? Search { get; set; }
    public IReadOnlyList<CustomerListItem> Items { get; set; } = [];
}

public class CustomerFormViewModel
{
    public Guid? Id { get; set; }

    [Required(ErrorMessage = "Ad soyad gerekli")]
    [StringLength(150)]
    [Display(Name = "Ad Soyad")]
    public string FullName { get; set; } = "";

    [Required(ErrorMessage = "Telefon gerekli")]
    [StringLength(30)]
    [Display(Name = "Telefon")]
    public string Phone { get; set; } = "";

    [StringLength(30)]
    [Display(Name = "Telefon 2")]
    public string? Phone2 { get; set; }

    [EmailAddress(ErrorMessage = "Geçerli bir e-posta girin")]
    [StringLength(150)]
    [Display(Name = "E-posta")]
    public string? Email { get; set; }

    [Required]
    [Display(Name = "Müşteri Tipi")]
    public string CustomerType { get; set; } = "bireysel";

    [StringLength(200)]
    [Display(Name = "Firma Adı")]
    public string? CompanyName { get; set; }

    [StringLength(11)]
    [Display(Name = "TC Kimlik No")]
    public string? TcNo { get; set; }

    [StringLength(20)]
    [Display(Name = "Vergi No")]
    public string? TaxNo { get; set; }

    [StringLength(400)]
    [Display(Name = "Adres")]
    public string? Address { get; set; }

    [StringLength(60)]
    [Display(Name = "İl")]
    public string? City { get; set; }

    [StringLength(60)]
    [Display(Name = "İlçe")]
    public string? District { get; set; }

    [StringLength(1000)]
    [Display(Name = "Notlar")]
    public string? Notes { get; set; }

    [Display(Name = "Aynı zamanda tedarikçi mi?")]
    public bool IsSupplier { get; set; }

    public IReadOnlyList<CustomerTypeOption> CustomerTypes { get; set; } = [];
}

public record CustomerTypeOption(string Code, string Label);

public class WorkOrderReportRow
{
    public Guid Id { get; set; }
    public long OrderNo { get; set; }
    public string Status { get; set; } = "";
    public string Plate { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public decimal GrandTotal { get; set; }
    public decimal PaidTotal { get; set; }
    public DateTime OpenedAt { get; set; }
    /// <summary>Aynı araç için kaçıncı servis kaydı (1, 2, 3…).</summary>
    public int VisitNumber { get; set; } = 1;
}

public class WorkOrdersReportViewModel
{
    public string? StatusFilter { get; set; }
    public IReadOnlyList<StatusCountRow> StatusOptions { get; set; } = [];
    public IReadOnlyList<WorkOrderReportRow> Rows { get; set; } = [];
    public decimal TotalRevenue { get; set; }
    public decimal TotalPaid { get; set; }
    public decimal TotalOutstanding => TotalRevenue - TotalPaid;
    public int Count { get; set; }
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
}

public class RevenueReportViewModel
{
    public decimal LaborTotal { get; set; }
    public decimal PartsTotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public decimal PaidTotal { get; set; }
    public decimal Outstanding => GrandTotal - PaidTotal;
    public int WorkOrderCount { get; set; }
    public IReadOnlyList<MonthlyRevenueRow> MonthlyRows { get; set; } = [];
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
}

public class MonthlyRevenueRow
{
    public int Year { get; set; }
    public int Month { get; set; }
    public string MonthLabel { get; set; } = "";
    public int WorkOrderCount { get; set; }
    public decimal Revenue { get; set; }
    public decimal Paid { get; set; }
    public decimal Outstanding => Revenue - Paid;
}

public class StockReportRow
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Code { get; set; }
    public string Category { get; set; } = "";
    public string CategoryLabel { get; set; } = "";
    public int Quantity { get; set; }
    public int MinQuantity { get; set; }
    public decimal Price { get; set; }
    public decimal StockValue => Quantity * Price;
    public bool IsLowStock => Quantity <= MinQuantity;
}

public class StockReportViewModel
{
    public IReadOnlyList<StockReportRow> Rows { get; set; } = [];
    public int TotalItems { get; set; }
    public int LowStockCount { get; set; }
    public decimal TotalStockValue { get; set; }
    public string? CategoryFilter { get; set; }
    public IReadOnlyList<StockCategoryOption> Categories { get; set; } = [];
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
}

public record StockCategoryOption(string Code, string Label);

public class CustomerReportRow
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string CustomerType { get; set; } = "";
    public int VehicleCount { get; set; }
    public int WorkOrderCount { get; set; }
    public decimal TotalRevenue { get; set; }
    public decimal PaidTotal { get; set; }
    public decimal Outstanding => TotalRevenue - PaidTotal;
}

public class CustomerReportViewModel
{
    public IReadOnlyList<CustomerReportRow> Rows { get; set; } = [];
    public int TotalCustomers { get; set; }
    public decimal TotalRevenue { get; set; }
    public decimal TotalPaid { get; set; }
    public decimal TotalOutstanding => TotalRevenue - TotalPaid;
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
}

public class StatusCountRow
{
    public string Status { get; set; } = "";
    public string Label { get; set; } = "";
    public int Count { get; set; }
}

public class ReportsHubViewModel
{
    public IReadOnlyList<StatusCountRow> StatusCounts { get; set; } = [];
    public decimal MonthRevenue { get; set; }
    public int MonthWorkOrders { get; set; }
    public int MonthVehiclesServiced { get; set; }
    public int MonthOperations { get; set; }
}

public class SupplierListItem
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Contact { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public decimal Balance { get; set; }
}

public class SuppliersIndexViewModel
{
    public string? Search { get; set; }
    public IReadOnlyList<SupplierListItem> Items { get; set; } = [];
}

public class SupplierFormViewModel
{
    public Guid? Id { get; set; }

    [Required(ErrorMessage = "Cari adı gerekli")]
    [StringLength(150)]
    [Display(Name = "Cari Adı")]
    public string Name { get; set; } = "";

    [StringLength(150)]
    [Display(Name = "İlgili Kişi")]
    public string? Contact { get; set; }

    [StringLength(30)]
    [Display(Name = "Telefon")]
    public string? Phone { get; set; }

    [EmailAddress(ErrorMessage = "Geçerli bir e-posta girin")]
    [StringLength(150)]
    [Display(Name = "E-posta")]
    public string? Email { get; set; }

    [StringLength(300)]
    [Display(Name = "Adres")]
    public string? Address { get; set; }

    [StringLength(20)]
    [Display(Name = "Vergi No")]
    public string? TaxNo { get; set; }

    [Display(Name = "Açılış Bakiyesi (₺)")]
    public decimal OpeningBalance { get; set; }
}

public class SupplierTransactionRow
{
    public Guid Id { get; set; }
    public string Type { get; set; } = "";
    public decimal Amount { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class SupplierLedgerViewModel
{
    public Guid SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public string? Phone { get; set; }
    public decimal Balance { get; set; }
    public IReadOnlyList<SupplierTransactionRow> Transactions { get; set; } = [];
    public RecordPaymentViewModel Payment { get; set; } = new();
}

public class RecordPaymentViewModel
{
    public Guid SupplierId { get; set; }

    [Required(ErrorMessage = "Tutar gerekli")]
    [Range(0.01, double.MaxValue, ErrorMessage = "Tutar 0'dan büyük olmalı")]
    [Display(Name = "Tutar (₺)")]
    public decimal Amount { get; set; }

    [StringLength(300)]
    [Display(Name = "Açıklama")]
    public string? Description { get; set; }
}

public class SupplierReportRow
{
    public Guid SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public decimal TotalPurchases { get; set; }
    public decimal TotalReturns { get; set; }
    public int TransactionCount { get; set; }
}

public class SupplierReportViewModel
{
    public string Period { get; set; } = "daily";
    public DateTime Date { get; set; }
    public IReadOnlyList<SupplierReportRow> Rows { get; set; } = [];
    public decimal TotalPurchases { get; set; }
    public decimal TotalReturns { get; set; }
}

public class VehicleListItem
{
    public Guid Id { get; set; }
    public string Plate { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Model { get; set; } = "";
    public int? Year { get; set; }
    public Guid CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public bool IsActive { get; set; }
}

public class VehiclesIndexViewModel
{
    public string? Search { get; set; }
    public Guid? CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public IReadOnlyList<VehicleListItem> Items { get; set; } = [];
}

public record FuelTypeOption(string Code, string Label);

public class VehicleFormViewModel
{
    public Guid? Id { get; set; }

    [Required(ErrorMessage = "Plaka gerekli")]
    [StringLength(20)]
    [Display(Name = "Plaka")]
    public string Plate { get; set; } = "";

    [Required(ErrorMessage = "Marka gerekli")]
    [StringLength(60)]
    [Display(Name = "Marka")]
    public string Brand { get; set; } = "";

    [Required(ErrorMessage = "Model gerekli")]
    [StringLength(80)]
    [Display(Name = "Model")]
    public string Model { get; set; } = "";

    [Range(1900, 2100, ErrorMessage = "Geçerli bir yıl girin")]
    [Display(Name = "Yıl")]
    public int? Year { get; set; }

    [StringLength(40)]
    [Display(Name = "Renk")]
    public string? Color { get; set; }

    [Display(Name = "Yakıt Tipi")]
    public string? FuelType { get; set; }

    [Range(0, int.MaxValue, ErrorMessage = "Km 0 veya üzeri olmalı")]
    [Display(Name = "Km")]
    public int? Km { get; set; }

    [StringLength(32)]
    [Display(Name = "Şasi No")]
    public string? ChassisNo { get; set; }

    [StringLength(32)]
    [Display(Name = "Motor No")]
    public string? EngineNo { get; set; }

    [StringLength(20)]
    [Display(Name = "Motor Hacmi")]
    public string? EngineVolume { get; set; }

    [Required(ErrorMessage = "Müşteri seçilmeli")]
    [Display(Name = "Müşteri")]
    public Guid CustomerId { get; set; }

    public string? CustomerName { get; set; }

    public List<SelectListItem> Customers { get; set; } = [];
    public IReadOnlyList<FuelTypeOption> FuelTypes { get; set; } = [];

    public Guid? ConflictVehicleId { get; set; }
    public string? ConflictOwnerName { get; set; }
}

public class VehicleTransferViewModel
{
    public Guid VehicleId { get; set; }
    public string Plate { get; set; } = "";
    public Guid CurrentCustomerId { get; set; }
    public string CurrentCustomerName { get; set; } = "";

    [Required(ErrorMessage = "Yeni müşteri seçilmeli")]
    [Display(Name = "Yeni Müşteri")]
    public Guid NewCustomerId { get; set; }

    public List<SelectListItem> Customers { get; set; } = [];
}

public class CategoryListItem
{
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int SortOrder { get; set; }
    public int UsageCount { get; set; }
}

public class CategoriesIndexViewModel
{
    public IReadOnlyList<CategoryListItem> StockCategories { get; set; } = [];
    public IReadOnlyList<CategoryListItem> ServiceCategories { get; set; } = [];
}

public class CategoryFormViewModel
{
    /// <summary>Null when creating; set to the existing code when editing (code is not renameable).</summary>
    public string? OriginalCode { get; set; }

    /// <summary>"stock" or "service" — picks the target ref table and the post-back action.</summary>
    public string Kind { get; set; } = "stock";

    [Required(ErrorMessage = "Kod gerekli")]
    [StringLength(20)]
    [RegularExpression("^[a-z0-9_]+$", ErrorMessage = "Kod yalnızca küçük harf, rakam ve alt çizgi (_) içerebilir")]
    [Display(Name = "Kod")]
    public string Code { get; set; } = "";

    [Required(ErrorMessage = "Etiket gerekli")]
    [StringLength(50)]
    [Display(Name = "Etiket")]
    public string Label { get; set; } = "";

    [Range(0, 255, ErrorMessage = "Sıra 0-255 arasında olmalı")]
    [Display(Name = "Sıra")]
    public int SortOrder { get; set; }
}
