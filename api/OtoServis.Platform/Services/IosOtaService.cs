using System.Text;
using System.Text.RegularExpressions;

namespace OtoServis.Platform.Services;

public class IosOtaInfo
{
    public bool HasIpa { get; set; }
    public bool HasPlist { get; set; }
    public string? IpaUrl { get; set; }
    public string? PlistUrl { get; set; }
    public string? InstallUrl { get; set; }
    public DateTime? IpaUpdatedAt { get; set; }
    public DateTime? PlistUpdatedAt { get; set; }
}

public class IosOtaService(IConfiguration config)
{
    public const string DefaultSlug = "mobilservisiniz";

    public string StorageDir
    {
        get
        {
            var www = config["Storage:Wwwroot"];
            if (string.IsNullOrWhiteSpace(www))
            {
                var root = config["Storage:Root"];
                if (!string.IsNullOrWhiteSpace(root))
                    www = Path.Combine(root.TrimEnd('\\', '/'), "api", "wwwroot");
            }

            if (!string.IsNullOrWhiteSpace(www))
                return Path.Combine(www, "apk", "ios", DefaultSlug);

            var explicitPath = config["AppRelease:IosStoragePath"];
            if (!string.IsNullOrWhiteSpace(explicitPath))
                return explicitPath;

            return @"C:\OtoServis\api\wwwroot\apk\ios\mobilservisiniz";
        }
    }

    public string PublicBaseUrl =>
        (config["AppRelease:IosPublicBaseUrl"]
         ?? "https://api.mobilservisiniz.com/apk/ios/mobilservisiniz")
        .TrimEnd('/');

    public string IpaFileName => "app.ipa";
    public string PlistFileName => "manifest.plist";

    public string IpaPath => Path.Combine(StorageDir, IpaFileName);
    public string PlistPath => Path.Combine(StorageDir, PlistFileName);

    public string IpaUrl => $"{PublicBaseUrl}/{IpaFileName}";
    public string PlistUrl => $"{PublicBaseUrl}/{PlistFileName}";
    public string InstallUrl =>
        $"itms-services://?action=download-manifest&url={PlistUrl}";

    public IosOtaInfo GetInfo()
    {
        var ipa = new FileInfo(IpaPath);
        var plist = new FileInfo(PlistPath);
        return new IosOtaInfo
        {
            HasIpa = ipa.Exists,
            HasPlist = plist.Exists,
            IpaUrl = ipa.Exists ? IpaUrl : null,
            PlistUrl = plist.Exists ? PlistUrl : null,
            InstallUrl = ipa.Exists && plist.Exists ? InstallUrl : null,
            IpaUpdatedAt = ipa.Exists ? ipa.LastWriteTime : null,
            PlistUpdatedAt = plist.Exists ? plist.LastWriteTime : null,
        };
    }

    public async Task SaveAsync(
        IFormFile ipa,
        IFormFile? plist,
        string bundleId,
        string bundleVersion,
        string title)
    {
        if (ipa.Length == 0)
            throw new InvalidOperationException("IPA dosyası boş.");
        if (!ipa.FileName.EndsWith(".ipa", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Sadece .ipa yükleyin.");

        Directory.CreateDirectory(StorageDir);

        await using (var fs = File.Create(IpaPath))
            await ipa.CopyToAsync(fs);

        // Xcode'un OTA plist'i siklikla "https://" gibi bos URL birakir; iPhone
        // kurulumunu kirar. Her zaman bizim HTTPS IPA adresini yaziyoruz.
        await File.WriteAllTextAsync(
            PlistPath,
            BuildManifest(bundleId, bundleVersion, title),
            new UTF8Encoding(false));

        await File.WriteAllTextAsync(Path.Combine(StorageDir, "install.html"), BuildInstallPage(), new UTF8Encoding(false));
    }

    private string BuildInstallPage()
    {
        var href = System.Net.WebUtility.HtmlEncode(InstallUrl);
        return $$"""
            <!DOCTYPE html>
            <html lang="tr">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>MobilServisiniz — iOS Kurulum</title>
              <style>
                body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #f4f6fb; color: #1a1f2e; }
                .box { max-width: 420px; margin: 48px auto; padding: 28px 22px; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px rgba(20,30,60,.08); text-align: center; }
                h1 { font-size: 22px; margin: 0 0 8px; }
                p { color: #5b6478; line-height: 1.45; }
                a.btn { display: block; margin-top: 22px; padding: 16px; border-radius: 12px; background: #2f4a86; color: #fff; font-weight: 800; text-decoration: none; }
              </style>
            </head>
            <body>
              <div class="box">
                <h1>MobilServisiniz</h1>
                <p>iPhone'a kurmak için aşağıdaki butona basın. Safari dışındaki tarayıcılarda çalışmaz.</p>
                <a class="btn" href="{{href}}">Telefona kur</a>
                <p style="margin-top:18px;font-size:13px">Kurulumdan sonra Ayarlar → Genel → VPN ve cihaz yönetimi üzerinden geliştiriciye güvenmeniz gerekebilir.</p>
              </div>
            </body>
            </html>
            """;
    }

    private string BuildManifest(string bundleId, string bundleVersion, string title)
    {
        static string E(string s) => System.Security.SecurityElement.Escape(s) ?? "";
        return $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
              <key>items</key>
              <array>
                <dict>
                  <key>assets</key>
                  <array>
                    <dict>
                      <key>kind</key>
                      <string>software-package</string>
                      <key>url</key>
                      <string>{E(IpaUrl)}</string>
                    </dict>
                  </array>
                  <key>metadata</key>
                  <dict>
                    <key>bundle-identifier</key>
                    <string>{E(bundleId)}</string>
                    <key>bundle-version</key>
                    <string>{E(bundleVersion)}</string>
                    <key>kind</key>
                    <string>software</string>
                    <key>title</key>
                    <string>{E(title)}</string>
                  </dict>
                </dict>
              </array>
            </dict>
            </plist>
            """;
    }
}
