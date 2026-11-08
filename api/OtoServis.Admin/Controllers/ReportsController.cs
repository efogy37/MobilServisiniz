using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using OtoServis.Admin.Filters;
using OtoServis.Admin.Services;

namespace OtoServis.Admin.Controllers;

[Authorize]
[RequireShop]
public class ReportsController(AdminDataService data) : Controller
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        base.OnActionExecuting(context);
        if (User.GetShopRole() == "personel")
            context.Result = RedirectToAction("Index", "Dashboard");
    }

    public async Task<IActionResult> Index()
    {
        var model = await data.GetReportsHubAsync();
        return View(model);
    }

    public async Task<IActionResult> WorkOrders(string? status, DateTime? from, DateTime? to)
    {
        var model = await data.GetWorkOrdersReportAsync(status, from, to);
        return View(model);
    }

    public async Task<IActionResult> Revenue(DateTime? from, DateTime? to)
    {
        var model = await data.GetRevenueReportAsync(from, to);
        return View(model);
    }

    public async Task<IActionResult> Stock(string? category, DateTime? from, DateTime? to)
    {
        var model = await data.GetStockReportAsync(category, from, to);
        return View(model);
    }

    public async Task<IActionResult> Customers(DateTime? from, DateTime? to)
    {
        var model = await data.GetCustomerReportAsync(from, to);
        return View(model);
    }

    public async Task<IActionResult> Suppliers(string? period, DateTime? date)
    {
        var model = await data.GetSupplierReportAsync(period, date);
        return View(model);
    }
}
