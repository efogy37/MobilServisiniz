using System.ComponentModel.DataAnnotations;

namespace OtoServis.Platform.Models;

public class LoginViewModel
{
    [Required(ErrorMessage = "Telefon gerekli")]
    [Display(Name = "Telefon")]
    public string Phone { get; set; } = "";

    [Required(ErrorMessage = "Şifre gerekli")]
    [DataType(DataType.Password)]
    [Display(Name = "Şifre")]
    public string Password { get; set; } = "";
}

public class ShopListItem
{
    public Guid Id { get; set; }
    public string TenantCode { get; set; } = "";
    public string Name { get; set; } = "";
    public string? City { get; set; }
    public string SubscriptionPlan { get; set; } = "";
    public string PlanLabel { get; set; } = "";
    public int? MaxUsersOverride { get; set; }
    public int? PlanMaxUsers { get; set; }
    public int? EffectiveMaxUsers { get; set; }
    public int ActiveUsers { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public string LicenseType { get; set; } = "unlimited";
    public DateTime? LicenseExpiresAt { get; set; }
    public string LicenseStatus { get; set; } = "active";
    public int? DaysRemaining { get; set; }
}

public class ShopDetailViewModel
{
    public ShopListItem Shop { get; set; } = new();
    public ShopEditForm Edit { get; set; } = new();
    public List<ShopUserRow> Users { get; set; } = [];
    public AddUserForm AddUser { get; set; } = new();
    public ShopUsageStats Stats { get; set; } = new();
    public List<ActivityRow> StatusHistory { get; set; } = [];
    public List<PaymentActivityRow> Payments { get; set; } = [];
    public List<PlanOption> Plans { get; set; } = [];
    public LicenseEditForm LicenseEdit { get; set; } = new();
    public List<LicenseEventRow> LicenseEvents { get; set; } = [];
    public string? Flash { get; set; }
    public string? Error { get; set; }
}

public class LicenseEditForm
{
    public Guid ShopId { get; set; }

    [Required, Display(Name = "Lisans tipi")]
    public string LicenseType { get; set; } = "trial";

    [Display(Name = "Bitiş tarihi (elle)")]
    [DataType(DataType.Date)]
    public DateTime? LicenseExpiresAt { get; set; }

    [Display(Name = "Not")]
    public string? Note { get; set; }
}

public class LicenseEventRow
{
    public DateTime CreatedAt { get; set; }
    public string NewLicenseType { get; set; } = "";
    public DateTime? NewExpiresAt { get; set; }
    public string? Note { get; set; }
    public string? CreatedByName { get; set; }
}

public class ShopEditForm
{
    public Guid Id { get; set; }

    [Required, Display(Name = "Servis adı")]
    public string Name { get; set; } = "";

    [Display(Name = "Telefon")]
    public string? Phone { get; set; }

    [Display(Name = "Şehir")]
    public string? City { get; set; }

    [Required, Display(Name = "Plan")]
    public string SubscriptionPlan { get; set; } = "baslangic";

    [Display(Name = "Kullanıcı limiti (boş = plan)")]
    [Range(1, 500, ErrorMessage = "Limit 1-500 arası olmalı")]
    public int? MaxUsers { get; set; }

    [Display(Name = "Aktif")]
    public bool IsActive { get; set; } = true;
}

public class CreateShopForm
{
    [Required, Display(Name = "Servis kodu")]
    [RegularExpression(@"^[A-Za-z0-9\-]+$", ErrorMessage = "Sadece harf, rakam ve tire")]
    public string TenantCode { get; set; } = "";

    [Required, Display(Name = "Servis adı")]
    public string Name { get; set; } = "";

    [Display(Name = "Şehir")]
    public string? City { get; set; }

    [Required, Display(Name = "Plan")]
    public string SubscriptionPlan { get; set; } = "baslangic";

    [Display(Name = "Kullanıcı limiti (boş = plan)")]
    [Range(1, 500)]
    public int? MaxUsers { get; set; }

    [Required, Display(Name = "Sahip adı")]
    public string OwnerName { get; set; } = "";

    [Required, Display(Name = "Sahip telefon")]
    public string OwnerPhone { get; set; } = "";

    [Required, Display(Name = "Sahip şifre")]
    [MinLength(4)]
    [DataType(DataType.Password)]
    public string OwnerPassword { get; set; } = "";

    [Required, Display(Name = "Lisans")]
    public string LicenseType { get; set; } = "trial";
}

public class AddUserForm
{
    [Required, Display(Name = "Ad soyad")]
    public string FullName { get; set; } = "";

    [Required, Display(Name = "Telefon")]
    public string Phone { get; set; } = "";

    [Required, Display(Name = "Şifre")]
    [MinLength(4)]
    [DataType(DataType.Password)]
    public string Password { get; set; } = "";

    [Required, Display(Name = "Rol")]
    public string Role { get; set; } = "personel";

    [Display(Name = "Ünvan")]
    public string? Title { get; set; }
}

public class ResetPasswordForm
{
    public Guid UserId { get; set; }

    [Required, MinLength(4), DataType(DataType.Password)]
    [Display(Name = "Yeni şifre")]
    public string NewPassword { get; set; } = "";
}

public class ShopUserRow
{
    public Guid UserId { get; set; }
    public Guid MembershipId { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Role { get; set; } = "";
    public string? Title { get; set; }
    public bool IsOwner { get; set; }
    public bool IsActive { get; set; }
    public DateTime JoinedAt { get; set; }
}

public class ShopUsageStats
{
    public int Customers { get; set; }
    public int Vehicles { get; set; }
    public int WorkOrders { get; set; }
    public int PaymentsCount { get; set; }
    public decimal PaymentsTotal { get; set; }
}

public class ActivityRow
{
    public DateTime ChangedAt { get; set; }
    public long OrderNo { get; set; }
    public string Plate { get; set; } = "";
    public string? OldStatus { get; set; }
    public string NewStatus { get; set; } = "";
    public string? ChangedByName { get; set; }
    public string? AssignedTo { get; set; }
}

public class PaymentActivityRow
{
    public DateTime PaidAt { get; set; }
    public long OrderNo { get; set; }
    public string Plate { get; set; } = "";
    public decimal Amount { get; set; }
    public string Method { get; set; } = "";
    public string? ReceivedByName { get; set; }
}

public class PlanOption
{
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int? MaxUsers { get; set; }
    public decimal MonthlyPrice { get; set; }
}

public class AppReleaseForm
{
    [Required, Display(Name = "Sürüm (ör. 1.0.20)")]
    [StringLength(20)]
    public string LatestVersion { get; set; } = "";

    [Required, Display(Name = "Version code (Android)")]
    [Range(1, int.MaxValue)]
    public int LatestVersionCode { get; set; }

    [Required, Display(Name = "Minimum zorunlu version code")]
    [Range(1, int.MaxValue)]
    public int MinVersionCode { get; set; }

    [Display(Name = "Play Store URL")]
    [StringLength(500)]
    public string? StoreUrl { get; set; }

    [Display(Name = "Sürüm notları")]
    [StringLength(1000)]
    public string? ReleaseNotes { get; set; }

    [Display(Name = "Bu sürümü zorunlu yap (min = latest)")]
    public bool ForceThisVersion { get; set; }

    public DateTime? UpdatedAt { get; set; }
}

public static class RoleLabels
{
    public static readonly (string Code, string Label)[] ShopRoles =
    [
        ("admin", "Yönetici"),
        ("usta", "Usta"),
        ("personel", "Personel"),
    ];

    public static string Label(string code) => code switch
    {
        "admin" => "Yönetici",
        "usta" => "Usta",
        "personel" => "Personel",
        "super_admin" => "Platform",
        _ => code,
    };

    public static string StatusLabel(string? code) => code switch
    {
        "bekliyor" => "Bekliyor",
        "islemde" => "İşlemde",
        "tamamlandi" => "Servis Tamamlandı",
        "odeme_tamamlandi" => "Ödeme Tamamlandı",
        "teslim_edildi" => "Teslim Edildi",
        _ => code ?? "-",
    };
}
