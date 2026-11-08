using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoServis.Platform.Filters;
using OtoServis.Platform.Models;
using OtoServis.Platform.Services;

namespace OtoServis.Platform.Controllers;

[Authorize]
[RequirePlatformAdmin]
public class ShopsController(PlatformDataService data) : Controller
{
    [HttpGet]
    public async Task<IActionResult> Index(string? q)
    {
        ViewData["Title"] = "Servisler";
        ViewBag.Search = q;
        var shops = await data.ListShopsAsync(q);
        return View(shops);
    }

    [HttpGet]
    public async Task<IActionResult> Create()
    {
        ViewData["Title"] = "Yeni Servis";
        ViewBag.Plans = await data.GetPlansAsync();
        return View(new CreateShopForm());
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(CreateShopForm form)
    {
        ViewData["Title"] = "Yeni Servis";
        ViewBag.Plans = await data.GetPlansAsync();
        if (!ModelState.IsValid) return View(form);

        try
        {
            var id = await data.CreateShopAsync(form);
            TempData["Flash"] = "Servis oluşturuldu.";
            return RedirectToAction(nameof(Details), new { id });
        }
        catch (Exception ex)
        {
            ModelState.AddModelError(string.Empty, ex.Message);
            return View(form);
        }
    }

    [HttpGet]
    public async Task<IActionResult> Details(Guid id)
    {
        var vm = await BuildDetailsAsync(id);
        if (vm is null) return NotFound();
        ViewData["Title"] = vm.Shop.Name;
        return View(vm);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Update([Bind(Prefix = "Edit")] ShopEditForm form)
    {
        if (!ModelState.IsValid)
        {
            var bad = await BuildDetailsAsync(form.Id);
            if (bad is null) return NotFound();
            bad.Edit = form;
            bad.Error = "Form hatalarını düzeltin.";
            ViewData["Title"] = bad.Shop.Name;
            return View("Details", bad);
        }

        try
        {
            await data.UpdateShopAsync(form);
            TempData["Flash"] = "Servis bilgileri güncellendi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id = form.Id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> AddUser(Guid id, AddUserForm form)
    {
        if (!ModelState.IsValid)
        {
            TempData["Error"] = "Kullanıcı formu eksik veya hatalı.";
            return RedirectToAction(nameof(Details), new { id });
        }

        try
        {
            await data.AddUserAsync(id, form);
            TempData["Flash"] = "Kullanıcı eklendi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeactivateUser(Guid id, Guid userId)
    {
        try
        {
            await data.DeactivateUserAsync(id, userId);
            TempData["Flash"] = "Kullanıcı pasifleştirildi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ActivateUser(Guid id, Guid userId)
    {
        try
        {
            await data.ActivateUserAsync(id, userId);
            TempData["Flash"] = "Kullanıcı aktifleştirildi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SetLicense(Guid id, LicenseEditForm form)
    {
        try
        {
            var actorId = User.GetUserId();
            await data.SetLicenseAsync(id, form.LicenseType, form.LicenseExpiresAt, form.Note, actorId);
            TempData["Flash"] = "Lisans güncellendi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ExtendLicense(Guid id, string licenseType)
    {
        try
        {
            await data.SetLicenseAsync(id, licenseType, null, $"Hızlı uzatma: {licenseType}", User.GetUserId());
            TempData["Flash"] = "Lisans uzatıldı.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ResetPassword(Guid id, ResetPasswordForm form)
    {
        if (!ModelState.IsValid || string.IsNullOrWhiteSpace(form.NewPassword))
        {
            TempData["Error"] = "Yeni şifre en az 4 karakter olmalı.";
            return RedirectToAction(nameof(Details), new { id });
        }

        try
        {
            await data.ResetPasswordAsync(form.UserId, form.NewPassword);
            TempData["Flash"] = "Şifre güncellendi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> UpdateUser(Guid id, EditUserForm form)
    {
        if (!ModelState.IsValid)
        {
            TempData["Error"] = "Kullanıcı düzenleme formu eksik veya hatalı.";
            return RedirectToAction(nameof(Details), new { id });
        }

        try
        {
            await data.UpdateUserAsync(id, form);
            TempData["Flash"] = "Kullanıcı güncellendi.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = ex.Message;
        }
        return RedirectToAction(nameof(Details), new { id });
    }

    private async Task<ShopDetailViewModel?> BuildDetailsAsync(Guid id)
    {
        var shop = await data.GetShopAsync(id);
        var edit = await data.GetShopEditAsync(id);
        if (shop is null || edit is null) return null;

        return new ShopDetailViewModel
        {
            Shop = shop,
            Edit = edit,
            Users = (await data.GetShopUsersAsync(id)).ToList(),
            Stats = await data.GetShopUsageStatsAsync(id),
            StatusHistory = (await data.GetStatusHistoryAsync(id)).ToList(),
            Payments = (await data.GetPaymentsAsync(id)).ToList(),
            Plans = (await data.GetPlansAsync()).ToList(),
            LicenseEvents = (await data.GetLicenseEventsAsync(id)).ToList(),
            LicenseEdit = new LicenseEditForm
            {
                ShopId = id,
                LicenseType = shop.LicenseType,
                LicenseExpiresAt = shop.LicenseExpiresAt,
            },
            Flash = TempData["Flash"] as string,
            Error = TempData["Error"] as string,
            AddUser = new AddUserForm(),
        };
    }
}
