using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using OtoServis.Api.Models;

namespace OtoServis.Api.Services;

/// <summary>
/// PDF fatura okuma.
/// - Parçacı formatı (Stok Adı | Miktarı | Fiyat | Tutar): PdfPig metni + regex (anahtar gerekmez).
/// - e-Fatura (Dinamik, Martaş, Özaş, Oto İsmail, Başbuğ ...): hücreler satırlara dağıldığı için
///   PDF doğrudan Gemini'ye (inline_data) gönderilir; yedek olarak metin tabanlı Gemini/OpenAI.
/// Çıktıda UnitPrice/LineTotal KDV DAHİL net değerlerdir; Code faturadaki orijinal koddur.
/// </summary>
public sealed class InvoiceScanService(
    HttpClient http,
    IOptions<AiOptions> options,
    ILogger<InvoiceScanService> log)
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private const string LinePrompt = """
        Bu bir Türkçe oto yedek parça FATURASI (e-Fatura veya parçacı irsaliyesi). Ürün satırlarını tablo yapısına göre çıkar.
        SADECE şu JSON'u döndür:
        {"documentNo":"","documentDate":"","supplierName":"","grandTotalInclVat":0,
         "lines":[{"code":"","brand":"","name":"","quantity":1,"listUnitPrice":0,"netUnitPriceExclVat":0,"vatRate":20,"lineTotalExclVat":0,"lineTotalInclVat":0}]}

        Kurallar:
        - documentNo: "Fatura No" (yoksa "Evrak No"). documentDate: "Fatura Tarihi"/"Evrak Tarihi", GG.AA.YYYY biçiminde.
        - supplierName: faturayı kesen firma (en üstteki satıcı ünvanı), kısa.
        - grandTotalInclVat: "Ödenecek Tutar" / "Vergiler Dahil Toplam" / "KDV Dahil Toplam" (ondalık nokta: 4428.22).
        - Her ürün satırı için:
          * code: "Stok Kodu" / "Mal/Hizmet Kodu" sütunundaki kod, faturada YAZILDIĞI GİBİ (ön ekleri, tireleri koru; ör. "FBI-280275", "BOS-09864B7029", "BSG 75-305-049", "MOF4612"). Hücre iki satıra bölünmüşse birleştir. Kod sütunu yoksa ve ad "BANDO 6PK1025 KANALLI KAYIS" gibi marka+kod ile başlıyorsa code="6PK1025", brand="BANDO". Kod yoksa "".
          * brand: marka (MANDO, BSG, FAG, BANDO, BOSCH...) ayrı hücredeyse veya kodun/adın başında geçiyorsa; yoksa "".
          * name: ürün açıklaması (kodu ve markayı tekrar yazma; birden çok satıra taşan açıklamayı birleştir, kısa tut).
          * quantity: Miktar sütunu (1,0 → 1; 2,0 → 2). Fiyatla KARIŞTIRMA.
          * listUnitPrice: iskonto öncesi birim fiyat.
          * netUnitPriceExclVat: iskontolar düşülmüş, KDV HARİÇ birim fiyat ("Net Fiyat" varsa o; yoksa lineTotalExclVat / quantity).
          * vatRate: KDV oranı (20, 10, 1, 0).
          * lineTotalExclVat: satırın KDV hariç tutarı ("Mal Hizmet Tutarı" / "KDV Matrahı").
          * lineTotalInclVat: satırın KDV dahil tutarı = lineTotalExclVat × (1 + vatRate/100). Satırda yazmıyorsa hesapla.
        - Tüm sayılar ondalık NOKTA ile (7601.41). Para birimi yazma.
        - Toplam, iskonto, KDV, banka, adres, "Yalnız ..." satırlarını ürün olarak EKLEME.
        - Sıfır bedelli promosyon satırlarını lineTotal 0 ile ekle.
        - Yalnızca geçerli JSON.
        """;

    public async Task<InvoiceScanResponse> ScanAsync(
        string fileBase64,
        string? mimeType,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(fileBase64))
            throw new AiScanException("PDF verisi boş.", HttpStatusCode.BadRequest);

        byte[] bytes;
        string b64;
        try
        {
            b64 = fileBase64.Contains(',') ? fileBase64[(fileBase64.IndexOf(',') + 1)..] : fileBase64;
            bytes = Convert.FromBase64String(b64);
        }
        catch
        {
            throw new AiScanException("PDF base64 çözülemedi.", HttpStatusCode.BadRequest);
        }

        if (bytes.Length < 100)
            throw new AiScanException("Dosya çok küçük veya boş.", HttpStatusCode.BadRequest);
        if (bytes.Length > 12 * 1024 * 1024)
            throw new AiScanException("PDF en fazla 12 MB olabilir.", HttpStatusCode.BadRequest);

        mimeType = (mimeType ?? "application/pdf").Trim().ToLowerInvariant();
        if (!mimeType.Contains("pdf") && !(bytes.Length > 4 && bytes[0] == 0x25 && bytes[1] == 0x50)) // %PDF
            throw new AiScanException("Yalnızca PDF dosyası desteklenir.", HttpStatusCode.BadRequest);

        string text;
        try
        {
            text = InvoiceTextParser.ExtractTextFromPdf(bytes);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "PDF metin çıkarma başarısız");
            throw new AiScanException("PDF okunamadı. Dosya bozuk veya korumalı olabilir.", HttpStatusCode.BadRequest);
        }

        var format = InvoiceTextParser.DetectFormat(text);
        var header = InvoiceTextParser.ExtractHeader(text);
        log.LogInformation("Fatura formatı: {Format}, metin {Len} char", format, text.Length);

        // 1) Parçacı (veya bilinmeyen): regex yeterliyse AI'ya gerek yok
        if (format is InvoiceTextParser.InvoiceFormat.Parcaci or InvoiceTextParser.InvoiceFormat.Unknown)
        {
            var parsed = InvoiceTextParser.Parse(text);
            if (parsed.Lines.Count >= 1 && (format == InvoiceTextParser.InvoiceFormat.Parcaci || parsed.Lines.Count >= 2))
                return ToResponse(parsed, header.GrandTotal);
        }

        // 2) e-Fatura / zayıf metin: AI (PDF inline → metin yedek)
        var ai = await TryAiParseAsync(b64, text, header, format, ct);
        if (ai is not null && ai.Lines.Count > 0)
            return ai;

        // 3) Son çare: bilinmeyen formatta regex tek satır bulduysa onu ver
        if (format == InvoiceTextParser.InvoiceFormat.Unknown)
        {
            var parsed = InvoiceTextParser.Parse(text);
            if (parsed.Lines.Count >= 1) return ToResponse(parsed, header.GrandTotal);
        }

        if (string.IsNullOrWhiteSpace(text))
            throw new AiScanException(
                "PDF'den metin çıkarılamadı. Tarama (görüntü) PDF'leri için daha net bir dosya deneyin.",
                HttpStatusCode.UnprocessableEntity);

        var cfg = options.Value;
        if (format == InvoiceTextParser.InvoiceFormat.EFatura &&
            string.IsNullOrWhiteSpace(cfg.GeminiApiKey) && string.IsNullOrWhiteSpace(cfg.OpenAiApiKey))
            throw new AiScanException(
                "e-Fatura okuma için yapay zekâ anahtarı tanımlı değil (Ai:GeminiApiKey).",
                HttpStatusCode.UnprocessableEntity);

        throw new AiScanException(
            "Fatura satırları okunamadı. Daha net bir PDF deneyin veya satırları manuel girin.",
            HttpStatusCode.UnprocessableEntity);
    }

    private static InvoiceScanResponse ToResponse(ParsedInvoice parsed, decimal? grandTotal) =>
        new(
            parsed.DocumentNo,
            parsed.DocumentDate,
            parsed.Lines.Select(l => new InvoiceScanLineDto(
                l.Name, l.Quantity, l.UnitPrice, l.LineTotal, Code: l.Code)).ToList(),
            parsed.Provider,
            GrandTotal: grandTotal,
            Format: "parcaci");

    private async Task<InvoiceScanResponse?> TryAiParseAsync(
        string pdfBase64,
        string text,
        (string? DocNo, string? DocDate, decimal? GrandTotal) header,
        InvoiceTextParser.InvoiceFormat format,
        CancellationToken ct)
    {
        var cfg = options.Value;
        if (string.IsNullOrWhiteSpace(cfg.GeminiApiKey) && string.IsNullOrWhiteSpace(cfg.OpenAiApiKey))
            return null;

        var providers = (cfg.Providers is { Count: > 0 } ? cfg.Providers : AiOptions.DefaultProviders())
            .Where(p => p.Name is "gemini" or "openai")
            .ToList();

        var snippet = text.Length > 14000 ? text[..14000] : text;
        var textPrompt = LinePrompt + "\n\nFATURA METNİ (PDF'den çıkarıldı; hücreler satırlara bölünmüş olabilir):\n" + snippet;

        // Önce Gemini'ye PDF'in kendisini ver (düzen bilgisi korunur), sonra metin yedekleri
        var attempts = new List<(AiProviderOption P, bool Pdf)>();
        foreach (var p in providers.Where(p => p.Name == "gemini")) attempts.Add((p, true));
        foreach (var p in providers) attempts.Add((p, false));

        foreach (var (p, usePdf) in attempts)
        {
            try
            {
                string? json = p.Name.Equals("gemini", StringComparison.OrdinalIgnoreCase)
                    ? (usePdf
                        ? await CallGeminiPdfAsync(cfg.GeminiApiKey, p.Model, LinePrompt, pdfBase64, ct)
                        : await CallGeminiTextAsync(cfg.GeminiApiKey, p.Model, textPrompt, ct))
                    : await CallOpenAiTextAsync(cfg.OpenAiApiKey, p.Model, textPrompt, ct);
                if (string.IsNullOrWhiteSpace(json)) continue;

                var dto = JsonSerializer.Deserialize<AiInvoiceDto>(StripFences(json), JsonOpts);
                if (dto?.Lines is null || dto.Lines.Count == 0) continue;

                var result = BuildResponse(dto, header, $"{p.Name}:{p.Model}{(usePdf ? ":pdf" : ":text")}", format);
                if (result.Lines.Count == 0) continue;
                return result;
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Fatura AI parse başarısız: {Provider}/{Model} pdf={Pdf}", p.Name, p.Model, usePdf);
            }
        }
        return null;
    }

    private static InvoiceScanResponse BuildResponse(
        AiInvoiceDto dto,
        (string? DocNo, string? DocDate, decimal? GrandTotal) header,
        string provider,
        InvoiceTextParser.InvoiceFormat format)
    {
        // Her satır için iki KDV dahil toplam adayı:
        //  - fromTotal: AI'nın okuduğu satır tutarı (bazı faturalarda "Mal Hizmet Tutarı" iskonto ÖNCESİ brüt olabilir)
        //  - fromNet  : "Net Fiyat" × miktar × (1+KDV) — iskontolu net birim fiyattan hesap
        // Fatura genel toplamı biliniyorsa hangi küme tutuyorsa o kullanılır.
        //  - fromNetLine: "Net Fiyat" sütunu aslında satır NET TUTARI ise (Oto İsmail) → net × (1+KDV)
        var raw = new List<(string Name, string? Code, string? Brand, int Qty, decimal NetExcl, decimal Vat, decimal FromTotal, decimal FromNet, decimal FromNetLine, string? Warning)>();
        foreach (var l in dto.Lines!)
        {
            var name = (l.Name ?? "").Trim();
            var code = NullIfEmpty(l.Code);
            var brand = NullIfEmpty(l.Brand);
            if (code is null && name.Length >= 4)
            {
                var split = InvoiceTextParser.SplitLeadingCode(name);
                if (split.Code is not null)
                {
                    code = split.Code;
                    name = split.Name;
                }
            }
            if (name.Length < 2 && code is null) continue;
            if (name.Length < 2) name = code!;

            var qty = Math.Max(1, (int)Math.Round(l.Quantity <= 0 ? 1 : l.Quantity, MidpointRounding.AwayFromZero));
            var vat = l.VatRate is > 0 and <= 100 ? l.VatRate : (l.VatRate == 0 ? 0 : 20m);
            var vatMul = 1 + vat / 100m;

            var netExcl = l.NetUnitPriceExclVat;
            var netFromAi = netExcl > 0;
            if (netExcl <= 0 && l.LineTotalExclVat > 0) netExcl = Math.Round(l.LineTotalExclVat / qty, 4);
            if (netExcl <= 0 && l.ListUnitPrice > 0) netExcl = l.ListUnitPrice;
            if (netExcl <= 0 && l.UnitPrice > 0) netExcl = l.UnitPrice; // eski şema

            var fromTotal = l.LineTotalInclVat;
            if (fromTotal <= 0 && l.LineTotalExclVat > 0) fromTotal = Math.Round(l.LineTotalExclVat * vatMul, 2);
            if (fromTotal <= 0 && l.LineTotal > 0) fromTotal = l.LineTotal; // eski şema
            var fromNet = netExcl > 0 ? Math.Round(netExcl * qty * vatMul, 2) : 0m;
            var fromNetLine = netFromAi && qty > 1 ? Math.Round(netExcl * vatMul, 2) : 0m;
            if (fromTotal <= 0) fromTotal = fromNet;
            if (fromNet <= 0) fromNet = fromTotal;
            if (!netFromAi) fromNet = fromTotal; // net AI'dan gelmediyse alternatif yok
            if (fromNetLine <= 0) fromNetLine = fromNet;

            string? warning = null;
            if (netExcl > 0 && l.ListUnitPrice > 0 && netExcl > l.ListUnitPrice * 1.01m)
                warning = "Net fiyat liste fiyatından büyük görünüyor; kontrol edin.";

            raw.Add((name, code, brand, qty, netExcl, vat, fromTotal, fromNet, fromNetLine, warning));
        }

        var docNo = NullIfEmpty(dto.DocumentNo) ?? header.DocNo;
        var docDate = NormalizeDate(NullIfEmpty(dto.DocumentDate) ?? header.DocDate);
        var grand = header.GrandTotal ?? (dto.GrandTotalInclVat > 0 ? dto.GrandTotalInclVat : null);

        // Satır başına seçilen KDV dahil toplam. Varsayılan: AI'nın satır tutarı.
        // Fatura genel toplamı biliniyorsa, satır bazında alternatifler (net×adet, net=satır tutarı)
        // arasından toplamı genel toplama en çok yaklaştıran kombinasyon seçilir (koordinat inişi).
        var chosen = raw.Select(r => r.FromTotal).ToArray();
        string? respWarning = null;
        if (raw.Count > 0)
        {
            if (grand is decimal g && g > 0)
            {
                var tol = Math.Max(0.5m, Math.Round(g * 0.01m, 2));
                decimal Sum() => chosen.Sum();
                if (Math.Abs(Sum() - g) > tol)
                {
                    for (var pass = 0; pass < 3 && Math.Abs(Sum() - g) > tol; pass++)
                    {
                        for (var i = 0; i < raw.Count; i++)
                        {
                            var r = raw[i];
                            var others = Sum() - chosen[i];
                            var best = chosen[i];
                            foreach (var opt in new[] { r.FromTotal, r.FromNet, r.FromNetLine })
                                if (Math.Abs(others + opt - g) < Math.Abs(others + best - g)) best = opt;
                            chosen[i] = best;
                        }
                    }
                    if (Math.Abs(Sum() - g) > tol)
                        respWarning = $"Satır toplamı ({Sum():N2}) fatura toplamıyla ({g:N2}) uyuşmuyor; satırları kontrol edin.";
                }
            }
            else
            {
                // Genel toplam yok: iskontolu net fiyat × adet daha güvenilir kabul edilir
                var sumTotal = raw.Sum(x => x.FromTotal);
                var sumNet = raw.Sum(x => x.FromNet);
                if (sumNet > 0 && Math.Abs(sumNet - sumTotal) > Math.Max(0.5m, sumTotal * 0.01m))
                {
                    for (var i = 0; i < raw.Count; i++) chosen[i] = raw[i].FromNet;
                    respWarning = "Fatura genel toplamı okunamadı; tutarlar net fiyattan hesaplandı, kontrol edin.";
                }
            }
        }

        var lines = new List<InvoiceScanLineDto>(raw.Count);
        for (var i = 0; i < raw.Count; i++)
        {
            var r = raw[i];
            var totalIncl = chosen[i];
            // Sıfır bedelli promosyon satırı: fiyat 0, yine de listele
            var unitIncl = totalIncl > 0 ? Math.Round(totalIncl / r.Qty, 2) : 0m;
            var warning = r.Warning;
            if (respWarning is not null && r.FromNet > 0 && r.FromTotal > 0)
            {
                var tol = Math.Max(0.05m, Math.Round(r.FromTotal * 0.01m, 2));
                if (Math.Abs(r.FromNet - r.FromTotal) > tol)
                    warning ??= $"Net fiyattan hesaplanan tutar ({r.FromNet:N2}) satır tutarından ({r.FromTotal:N2}) farklı; kontrol edin.";
            }
            lines.Add(new InvoiceScanLineDto(
                r.Name, r.Qty, unitIncl, totalIncl,
                Code: r.Code,
                Brand: r.Brand,
                NetUnitPriceExclVat: totalIncl > 0
                    ? Math.Round(totalIncl / r.Qty / (1 + r.Vat / 100m), 2)
                    : (r.NetExcl > 0 ? Math.Round(r.NetExcl, 2) : null),
                VatRate: r.Vat,
                Warning: warning));
        }

        return new InvoiceScanResponse(
            docNo, docDate, lines, provider,
            SupplierName: NullIfEmpty(dto.SupplierName),
            GrandTotal: grand,
            Format: format == InvoiceTextParser.InvoiceFormat.Parcaci ? "parcaci" : "efatura",
            Warning: respWarning);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string? NormalizeDate(string? s)
    {
        if (s is null) return null;
        s = s.Trim();
        // 2026-10-30 → 30.10.2026
        if (s.Length == 10 && s[4] == '-' && s[7] == '-')
            return $"{s[8..10]}.{s[5..7]}.{s[..4]}";
        return s.Replace('-', '.').Replace('/', '.');
    }

    private async Task<string?> CallGeminiPdfAsync(string apiKey, string model, string prompt, string pdfBase64, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(apiKey)) return null;
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
        var body = new
        {
            contents = new[]
            {
                new
                {
                    parts = new object[]
                    {
                        new { text = prompt },
                        new { inline_data = new { mime_type = "application/pdf", data = pdfBase64 } },
                    },
                },
            },
            generationConfig = new { temperature = 0, responseMimeType = "application/json" },
        };
        return await PostGeminiAsync(url, body, ct);
    }

    private async Task<string?> CallGeminiTextAsync(string apiKey, string model, string prompt, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(apiKey)) return null;
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
        var body = new
        {
            contents = new[] { new { parts = new[] { new { text = prompt } } } },
            generationConfig = new { temperature = 0, responseMimeType = "application/json" },
        };
        return await PostGeminiAsync(url, body, ct);
    }

    private async Task<string?> PostGeminiAsync(string url, object body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        using var res = await http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            log.LogWarning("Gemini {Status}: {Body}", (int)res.StatusCode, raw.Length > 400 ? raw[..400] : raw);
            return null;
        }
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts")[0]
            .GetProperty("text")
            .GetString();
    }

    private async Task<string?> CallOpenAiTextAsync(string apiKey, string model, string prompt, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(apiKey)) return null;
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        var body = new
        {
            model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new[]
            {
                new { role = "system", content = "Sen fatura satırı çıkaran bir JSON üreticisisin." },
                new { role = "user", content = prompt },
            },
        };
        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var res = await http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
    }

    private static string StripFences(string s)
    {
        s = s.Trim();
        if (s.StartsWith("```"))
        {
            var i = s.IndexOf('\n');
            s = i >= 0 ? s[(i + 1)..] : s;
            if (s.EndsWith("```")) s = s[..^3];
        }
        return s.Trim();
    }

    private sealed class AiInvoiceDto
    {
        public string? DocumentNo { get; set; }
        public string? DocumentDate { get; set; }
        public string? SupplierName { get; set; }
        public decimal GrandTotalInclVat { get; set; }
        public List<AiLineDto>? Lines { get; set; }
    }

    private sealed class AiLineDto
    {
        public string? Code { get; set; }
        public string? Brand { get; set; }
        public string? Name { get; set; }
        public decimal Quantity { get; set; } = 1;
        public decimal ListUnitPrice { get; set; }
        public decimal NetUnitPriceExclVat { get; set; }
        public decimal VatRate { get; set; } = 20;
        public decimal LineTotalExclVat { get; set; }
        public decimal LineTotalInclVat { get; set; }
        // eski şema uyumu
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
    }
}
