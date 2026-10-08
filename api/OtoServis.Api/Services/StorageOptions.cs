namespace OtoServis.Api.Services;

/// <summary>
/// Fotoğraf / wwwroot fiziksel yolları. appsettings.json → Storage bölümünden okunur.
/// </summary>
public class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>Kurulum kökü, örn. C:\OtoServis. UploadsPath/Wwwroot boşsa api\wwwroot türetilir.</summary>
    public string? Root { get; set; }

    /// <summary>API wwwroot, örn. C:\OtoServis\api\wwwroot.</summary>
    public string? Wwwroot { get; set; }

    /// <summary>İş emri fotoğraflarının klasörü, örn. C:\OtoServis\api\wwwroot\uploads.</summary>
    public string? UploadsPath { get; set; }

    public string ResolveWwwroot(string contentRoot)
    {
        if (!string.IsNullOrWhiteSpace(Wwwroot))
            return Wwwroot.Trim();
        if (!string.IsNullOrWhiteSpace(Root))
            return Path.Combine(Root.TrimEnd('\\', '/'), "api", "wwwroot");
        return Path.Combine(contentRoot, "wwwroot");
    }

    public string ResolveUploads(string contentRoot)
    {
        if (!string.IsNullOrWhiteSpace(UploadsPath))
            return UploadsPath.Trim();
        return Path.Combine(ResolveWwwroot(contentRoot), "uploads");
    }
}
