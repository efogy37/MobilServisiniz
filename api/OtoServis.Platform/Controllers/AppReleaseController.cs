using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoServis.Platform.Filters;
using OtoServis.Platform.Models;
using OtoServis.Platform.Services;

namespace OtoServis.Platform.Controllers;

[Authorize]
[RequirePlatformAdmin]
public class AppReleaseController(
    PlatformDataService data,
    IosOtaService ios,
    IConfiguration config) : Controller
{
    [HttpGet]
    public async Task<IActionResult> Index()
    {
        ViewData["Title"] = "Uygulama Sürümü";
        ViewBag.Ios = ios.GetInfo();
        var form = await data.GetAppReleaseAsync() ?? new AppReleaseForm
        {
            LatestVersion = "1.0.19",
            LatestVersionCode = 20,
            MinVersionCode = 20,
        };
        form.ForceThisVersion = form.MinVersionCode >= form.LatestVersionCode;
        return View(form);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Index(AppReleaseForm form)
    {
        ViewData["Title"] = "Uygulama Sürümü";
        ViewBag.Ios = ios.GetInfo();
        if (!ModelState.IsValid)
            return View(form);

        try
        {
            await data.UpdateAppReleaseAsync(form);
            TempData["Flash"] = "Sürüm bilgisi güncellendi.";
            return RedirectToAction(nameof(Index));
        }
        catch (Exception ex)
        {
            ModelState.AddModelError(string.Empty, ex.Message);
            return View(form);
        }
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    [RequestSizeLimit(250_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 250_000_000)]
    public async Task<IActionResult> UploadIos(IFormFile? ipaFile, IFormFile? plistFile, string? iosVersion)
    {
        if (ipaFile is null || ipaFile.Length == 0)
        {
            TempData["IosError"] = "IPA dosyası seçin.";
            return RedirectToAction(nameof(Index));
        }

        try
        {
            var version = string.IsNullOrWhiteSpace(iosVersion) ? "1.0.32" : iosVersion.Trim();
            await ios.SaveAsync(
                ipaFile,
                plistFile,
                config["AppRelease:IosBundleId"] ?? "com.otoservis.app",
                version,
                config["AppRelease:IosTitle"] ?? "MobilServisiniz");
            TempData["IosFlash"] = "IPA yayınlandı. Aşağıdaki kurulum linkini iPhone Safari'den açın.";
        }
        catch (Exception ex)
        {
            TempData["IosError"] = ex.Message;
        }

        return RedirectToAction(nameof(Index));
    }
}
