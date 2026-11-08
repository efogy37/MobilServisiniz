namespace OtoServis.Api.Services;

/// <summary>
/// Tek kaynak: appsettings Storage:Root (örn. C:\inetpub\wwwroot\mobilservisiniz).
/// Fotoğraflar {Root}\api\wwwroot\uploads altına yazılır.
/// </summary>
public class StorageOptions
{
    public const string SectionName = "Storage";

    public string? Root { get; set; }

    public string ResolveWwwroot(string contentRoot)
    {
        if (!string.IsNullOrWhiteSpace(Root))
            return Path.Combine(Root.TrimEnd('\\', '/'), "api", "wwwroot");
        return Path.Combine(contentRoot, "wwwroot");
    }

    public string ResolveUploads(string contentRoot) =>
        Path.Combine(ResolveWwwroot(contentRoot), "uploads");
}
