using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;

namespace OtoServis.Api.Services;

public sealed record ParsedInvoiceLine(string Name, int Quantity, decimal UnitPrice, decimal LineTotal, string? Code = null);

public sealed record ParsedInvoice(
    string? DocumentNo,
    string? DocumentDate,
    IReadOnlyList<ParsedInvoiceLine> Lines,
    string Provider);

public static class InvoiceTextParser
{
    /// <summary>Türkçe para: 150,00 / 7.400,00</summary>
    private static readonly Regex Money = new(
        @"\d{1,3}(?:\.\d{3})*,\d{2}",
        RegexOptions.Compiled);

    private static readonly Regex DocNoRx = new(
        @"(?:Evrak|Fatura)\s*No\.?\s*:?\s*(?<v>[A-Z0-9]{3,30})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex DocDateRx = new(
        @"(?:Evrak|Fatura)\s*Tarihi\s*:?\s*(?<v>\d{2}[.\-/]\d{2}[.\-/]\d{4})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>e-Fatura genel toplam satırları (KDV dahil).</summary>
    private static readonly Regex GrandTotalRx = new(
        @"(?:Ödenecek\s*Tutar|Vergiler\s*Dahil\s*Toplam\s*Tutar|KDV\s*Dahil\s*Toplam(?:\s*Tutar)?)\s*:?\s*(?<v>\d{1,3}(?:\.\d{3})*,\d{2})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ParcaciHeaderRx = new(
        @"Stok\s*Ad[ıi]\s+Miktar[ıi]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex EFaturaHintRx = new(
        @"e-?\s*Fatura|ETTN|Fatura\s*No\s*:|Mal\s*/?\s*Hizmet|Stok\s*Kodu",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public enum InvoiceFormat { Parcaci, EFatura, Unknown }

    /// <summary>Metinden fatura formatını kestirir.</summary>
    public static InvoiceFormat DetectFormat(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return InvoiceFormat.Unknown;
        var parcaci = ParcaciHeaderRx.IsMatch(text) && text.Contains("Evrak", StringComparison.OrdinalIgnoreCase);
        if (parcaci) return InvoiceFormat.Parcaci;
        if (EFaturaHintRx.IsMatch(text)) return InvoiceFormat.EFatura;
        return InvoiceFormat.Unknown;
    }

    /// <summary>Fatura üst bilgisi (no / tarih / KDV dahil genel toplam) — formattan bağımsız.</summary>
    public static (string? DocNo, string? DocDate, decimal? GrandTotal) ExtractHeader(string text)
    {
        string? docNo = null, docDate = null;
        decimal? grand = null;
        var m = DocNoRx.Match(text);
        if (m.Success) docNo = m.Groups["v"].Value;
        var d = DocDateRx.Match(text);
        if (d.Success) docDate = d.Groups["v"].Value.Replace('-', '.').Replace('/', '.');
        // Birden fazla toplam satırı olabilir; en son geçeni (genelde "Ödenecek Tutar") al
        Match? last = null;
        foreach (Match g in GrandTotalRx.Matches(text)) last = g;
        if (last is not null) grand = ParseMoney(last.Groups["v"].Value);
        return (docNo, docDate, grand);
    }

    private static readonly HashSet<string> SkipStarts = new(StringComparer.OrdinalIgnoreCase)
    {
        "Evrak No", "Evrak Tarihi", "Ödeme Tarihi", "Nakli Yekün", "Toplam Tutar",
        "Evrak Yekünü", "Yalnız Yazı", "Stok Adı", "YETMİŞ", "İKİ BİN", "-- ",
    };

    public static string ExtractTextFromPdf(byte[] pdfBytes)
    {
        using var doc = PdfDocument.Open(pdfBytes);
        var sb = new StringBuilder();
        foreach (var page in doc.GetPages())
        {
            // Kelime konumuna göre satır birleştir (fatura tabloları için daha sağlam)
            var words = page.GetWords().ToList();
            if (words.Count == 0)
            {
                if (!string.IsNullOrWhiteSpace(page.Text))
                    sb.AppendLine(page.Text);
                continue;
            }

            var lines = words
                .GroupBy(w => (int)Math.Round(w.BoundingBox.Bottom / 2.0) * 2)
                .OrderByDescending(g => g.Key)
                .Select(g => string.Join(" ", g.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text)))
                .ToList();

            foreach (var line in lines)
                sb.AppendLine(line);
            sb.AppendLine();
        }
        return sb.ToString();
    }

    public static ParsedInvoice Parse(string text)
    {
        var lines = new List<ParsedInvoiceLine>();
        string? docNo = null;
        string? docDate = null;

        foreach (var raw in text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var line = raw.Trim();
            if (line.Length < 8) continue;

            if (docNo is null)
            {
                var m = DocNoRx.Match(line);
                if (m.Success) docNo = m.Groups["v"].Value;
            }
            if (docDate is null)
            {
                var m = DocDateRx.Match(line);
                if (m.Success) docDate = m.Groups["v"].Value.Replace('-', '.').Replace('/', '.');
            }

            if (SkipStarts.Any(s => line.StartsWith(s, StringComparison.OrdinalIgnoreCase)))
                continue;
            if (line.Contains("Yekün", StringComparison.OrdinalIgnoreCase))
                continue;
            if (line.Contains("Lira", StringComparison.OrdinalIgnoreCase) && !Money.IsMatch(line))
                continue;

            var parsed = TryParseLine(line);
            if (parsed is not null)
                lines.Add(parsed);
        }

        return new ParsedInvoice(docNo, docDate, lines, "pdf-text");
    }

    private static ParsedInvoiceLine? TryParseLine(string line)
    {
        var moneyMatches = Money.Matches(line).Cast<Match>().ToList();
        if (moneyMatches.Count < 3) return null;

        // Parçacı faturaları: Stok Adı | Miktarı | Fiyat | Tutar
        // İsim içinde 0,20 / 7,80 gibi değerler olabildiği için SON 3 para birimini kullan.
        var qtyDec = ParseMoney(moneyMatches[^3].Value);
        var unit = ParseMoney(moneyMatches[^2].Value);
        var total = ParseMoney(moneyMatches[^1].Value);

        // Çapraz kontrol: qty×unit ≈ total değilse yaygın alternatif sırayı dene
        // (eski hatalı: birim, tutar, miktar)
        if (!LooksConsistent(qtyDec, unit, total))
        {
            var altUnit = ParseMoney(moneyMatches[^3].Value);
            var altTotal = ParseMoney(moneyMatches[^2].Value);
            var altQty = ParseMoney(moneyMatches[^1].Value);
            if (LooksConsistent(altQty, altUnit, altTotal))
            {
                qtyDec = altQty;
                unit = altUnit;
                total = altTotal;
            }
            else if (qtyDec >= 10 && unit > 0 && unit <= 20 && Math.Abs(total - qtyDec) < 0.05m)
            {
                // Klasik karışıklık: miktar↔birim (1,00 ile 7.400,00 yer değişmiş)
                (qtyDec, unit) = (unit, qtyDec);
            }
        }

        var qty = Math.Max(1, (int)Math.Round(qtyDec, MidpointRounding.AwayFromZero));
        if (unit <= 0 && total > 0) unit = Math.Round(total / qty, 2);
        if (unit <= 0) return null;
        if (total <= 0) total = Math.Round(unit * qty, 2);

        // Ürün adı: satırın son 3 para biriminden önceki kısım
        var cutAt = moneyMatches[^3].Index;
        var head = cutAt > 0 ? line[..cutAt].Trim() : line;
        // Sondaki yalnız sıra no kalmışsa at
        head = Regex.Replace(head, @"[\t ]+\d+\s*$", "").Trim();
        var name = CleanName(head);
        if (name.Length < 2) return null;

        var split = SplitLeadingCode(name);
        return new ParsedInvoiceLine(split.Name, qty, unit, total, split.Code);
    }

    /// <summary>
    /// "AYD-01827 ROT BASI SOL" → Code=AYD-01827, Name=ROT BASI SOL.
    /// "F-APS 14 ISITMA BUJİSİ" → Code=F-APS 14, Name=ISITMA BUJİSİ.
    /// Kod yoksa Name aynen kalır.
    /// </summary>
    public static (string Name, string? Code) SplitLeadingCode(string name)
    {
        var parts = name.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return (name.Trim(), null);

        var take = 0;
        while (take < parts.Length - 1)
        {
            var p = parts[take];
            var compact = Regex.Replace(p, @"[.\-_/]", "");
            var hasDigit = p.Any(char.IsDigit);
            var alphaPrefix = compact.Length is >= 1 and <= 6 && compact.All(char.IsLetter);
            var codeToken = hasDigit && compact.Length >= 2 && compact.All(char.IsLetterOrDigit);
            var nextHasDigit = take + 1 < parts.Length && parts[take + 1].Any(char.IsDigit);
            if (codeToken || (alphaPrefix && nextHasDigit))
            {
                take++;
                continue;
            }
            break;
        }
        if (take == 0) return (name.Trim(), null);
        var rest = string.Join(" ", parts.Skip(take));
        if (rest.Length < 2) return (name.Trim(), null);
        return (rest, string.Join(" ", parts.Take(take)));
    }

    /// <summary>qty × unit ≈ total (küçük yuvarlama toleransı).</summary>
    private static bool LooksConsistent(decimal qty, decimal unit, decimal total)
    {
        if (qty <= 0 || unit <= 0 || total <= 0) return false;
        var expected = Math.Round(qty * unit, 2, MidpointRounding.AwayFromZero);
        var diff = Math.Abs(expected - total);
        // Mutlak 0.05 veya satır tutarının %1'i
        var tol = Math.Max(0.05m, Math.Round(total * 0.01m, 2));
        return diff <= tol;
    }

    private static string CleanName(string name)
    {
        name = name.Replace('\t', ' ').Trim();
        name = Regex.Replace(name, @"\s+", " ");
        // Baştaki satır no: "13 ISITMA..." → "ISITMA..."
        name = Regex.Replace(name, @"^\d{1,3}[\t ]+", "");
        // Kesilmiş parantezleri toparla
        if (name.EndsWith('(') || name.EndsWith('+'))
            name = name.TrimEnd('(', '+', ' ').Trim();
        return name;
    }

    public static decimal ParseMoney(string raw)
    {
        var s = raw.Trim().Replace(".", "").Replace(',', '.');
        return decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : 0;
    }
}
