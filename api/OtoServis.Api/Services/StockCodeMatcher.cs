using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using OtoServis.Api.Models;

namespace OtoServis.Api.Services;

/// <summary>
/// Tedarikçi faturalarındaki firma ön ekli stok kodlarını (F-APS 14, FBI-280275, BOS-09864B7029,
/// BSG 75-305-049, MANDO MOF4612) normalize edip mevcut stok kayıtlarıyla eşleştirir.
/// Ön ek listesi sabit değildir: kodun başındaki yalnızca-harf segmentler sırayla soyulur ve
/// tedarikçi için daha önce onaylanmış alias'lardan öğrenilen ön ekler önceliklidir.
/// </summary>
public static class StockCodeMatcher
{
    /// <summary>SQL'deki code_norm ile aynı ayırıcı kümesi (boşluk - _ . / \).</summary>
    private static readonly Regex SeparatorRx = new(@"[\s\-_./\\]+", RegexOptions.Compiled);
    private static readonly Regex NameTokenRx = new(@"[\p{L}\p{N}]+", RegexOptions.Compiled);

    private static readonly HashSet<string> NameStopWords = new(StringComparer.Ordinal)
    {
        "VE", "ILE", "İLE", "ADET", "AD", "TK", "TAKIM", "SET", "SOL", "SAG", "SAĞ", "ON", "ÖN", "ARKA",
        "ALT", "UST", "ÜST", "STD", "TL", "MM", "LT", "ML",
    };

    /// <summary>TR-duyarsız BÜYÜK; ayırıcılar kaldırılmış: "F-APS 14" → "FAPS14". SQL code_norm ile birebir.</summary>
    public static string Canonical(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var up = UpperInvariantTr(raw);
        return SeparatorRx.Replace(up, "");
    }

    /// <summary>Ayırıcıları tek boşluğa indirir, BÜYÜK: "F-I-APS 14" → "F I APS 14".</summary>
    public static string[] Segments(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        var up = UpperInvariantTr(raw.Trim());
        return SeparatorRx.Split(up).Where(s => s.Length > 0).ToArray();
    }

    public static string UpperInvariantTr(string s)
    {
        // Türkçe i/ı dönüşümünü kontrollü yap; kodlarda İ→I, ı→I, sonra invariant upper
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            sb.Append(ch switch
            {
                'i' or 'ı' or 'İ' => 'I',
                'ş' => 'Ş', 'ğ' => 'Ğ', 'ü' => 'Ü', 'ö' => 'Ö', 'ç' => 'Ç',
                _ => char.ToUpperInvariant(ch),
            });
        }
        return sb.ToString();
    }

    private static bool IsAlphaOnly(string seg) => seg.Length > 0 && seg.All(char.IsLetter);
    private static bool HasDigit(string seg) => seg.Any(char.IsDigit);

    /// <summary>
    /// Ham koddan aday üretici kodları (canonical) ve orijinal biçimli öneri üretir.
    /// Sıra: ham kod → öğrenilmiş prefix soyulmuş → marka soyulmuş → baştaki harf segmentleri soyulmuş (1..n).
    /// </summary>
    public static CodeCandidates Candidates(string? rawCode, string? brand = null, IEnumerable<string>? learnedPrefixes = null)
    {
        var raw = (rawCode ?? "").Trim();
        var segs = Segments(raw);
        if (segs.Length == 0) return new CodeCandidates("", [], null, null);

        var rawCanon = string.Concat(segs);
        // Canon, Prefix (canonical, soyulan kısım), ForSuggest (öneri olarak kullanılabilir mi)
        var ordered = new List<(string Canon, string? Prefix, bool ForSuggest)> { (rawCanon, null, true) };

        // 1) Öğrenilmiş ön ekler (canonical, ör. "FBI", "FI", "F") — tedarikçi onaylı, güvenilir
        if (learnedPrefixes is not null)
        {
            foreach (var p in learnedPrefixes.Where(p => !string.IsNullOrEmpty(p)).Distinct().OrderByDescending(p => p.Length))
            {
                if (rawCanon.Length > p.Length && rawCanon.StartsWith(p, StringComparison.Ordinal))
                {
                    var rest = rawCanon[p.Length..];
                    if (IsValidRest(rest)) ordered.Add((rest, p, true));
                }
            }
        }

        // 2) Marka kodun başındaysa at (MANDO MOF4612 → MOF4612, BANDO 6PK1025 → 6PK1025)
        var brandCanon = Canonical(brand);
        if (brandCanon.Length >= 2 && rawCanon.Length > brandCanon.Length && rawCanon.StartsWith(brandCanon, StringComparison.Ordinal))
        {
            var rest = rawCanon[brandCanon.Length..];
            if (IsValidRest(rest)) ordered.Add((rest, brandCanon, true));
        }

        // 3) Baştaki yalnızca-harf segmentleri sırayla soy: F-I-APS 14 → I-APS 14 → APS 14
        //    Öneri kuralı: 1–2 harfli segment her zaman ön ek sayılır (F, C, I, FI);
        //    3+ harfli segment (FBI, BOS, BSG, APS, ROT) yalnızca kalan ≥5 karakterse ön ek sayılır
        //    (FBI-280275 → 280275 evet; APS 14 → "14" hayır; ROT 1234 → hayır).
        var prefix = new StringBuilder();
        var suggestChain = true;
        for (var i = 0; i < segs.Length - 1; i++)
        {
            var seg = segs[i];
            if (!IsAlphaOnly(seg) || seg.Length > 6) break;
            prefix.Append(seg);
            var restCanon = string.Concat(segs[(i + 1)..]);
            if (!IsValidRest(restCanon)) break;
            // 3+ harfli segment (APS, ROT, AKS) yalnızca kalan ≥5 ise ön ek sayılır.
            // FBI-280275 → 280275 evet; APS 14 / AKS 1234 → hayır (yanlış ürün eşleşmesin).
            if (seg.Length > 2 && restCanon.Length < 5)
            {
                suggestChain = false;
                continue;
            }
            ordered.Add((restCanon, prefix.ToString(), suggestChain));
        }

        // 4) Tek segment bitişik ("FAPS14"): baştaki 1-2 harfi soyma — yalnızca eşleştirme adayı, öneri değil
        if (segs.Length == 1 && rawCanon.Length >= 6)
        {
            var m = Regex.Match(rawCanon, @"^(\p{L}{1,2}?)(\p{L}{2,}\p{N}.*)$");
            if (m.Success) ordered.Add((m.Groups[2].Value, m.Groups[1].Value, false));
        }

        var distinct = ordered
            .GroupBy(o => o.Canon)
            .Select(g => (g.Key, g.First().Prefix, ForSuggest: g.Any(x => x.ForSuggest)))
            .ToList();

        // Önerilen üretici kodu: öneriye uygun en derin soyma; orijinal ayırıcılar korunur ("75-305-049")
        var suggested = distinct.LastOrDefault(d => d.ForSuggest);
        if (suggested.Key is null) suggested = distinct[0];
        var display = suggested.Prefix is null ? raw : DisplayAfterPrefix(raw, suggested.Prefix.Length);

        return new CodeCandidates(
            rawCanon,
            distinct.Select(d => d.Key).ToList(),
            display,
            suggested.Prefix);
    }

    private static bool IsValidRest(string rest) =>
        rest.Length >= 3 && HasDigit(rest) && (rest.Length >= 4 || rest.Any(char.IsLetter));

    /// <summary>Ham kodun başından n adet harf/rakam atlayıp kalanı (orijinal ayırıcılarıyla) döndürür.</summary>
    private static string DisplayAfterPrefix(string raw, int alnumToSkip)
    {
        var skipped = 0;
        var i = 0;
        for (; i < raw.Length && skipped < alnumToSkip; i++)
            if (char.IsLetterOrDigit(raw[i])) skipped++;
        var rest = raw[i..].TrimStart(' ', '-', '_', '.', '/', '\\').Trim();
        return rest.Length > 0 ? rest : raw;
    }

    /// <summary>Ürün adı token kümesi (benzerlik için).</summary>
    public static HashSet<string> NameTokens(string? name)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(name)) return set;
        var up = UpperInvariantTr(name);
        foreach (Match m in NameTokenRx.Matches(up))
        {
            var t = m.Value;
            if (t.Length < 2 || NameStopWords.Contains(t)) continue;
            set.Add(t);
        }
        return set;
    }

    public static int NameSimilarity(HashSet<string> a, HashSet<string> b)
    {
        if (a.Count == 0 || b.Count == 0) return 0;
        var inter = a.Count(b.Contains);
        if (inter == 0) return 0;
        var union = a.Count + b.Count - inter;
        var jaccard = (double)inter / union;
        // model/marka tokenleri (rakam içeren: K9K, 6PK1025, W201) ekstra ağırlık
        var modelHits = a.Where(t => t.Any(char.IsDigit)).Count(b.Contains);
        var score = jaccard * 60 + Math.Min(10, modelHits * 5);
        return (int)Math.Round(Math.Min(70, score));
    }

    public sealed record CodeCandidates(
        string RawCanonical,
        IReadOnlyList<string> Canonicals,
        string? SuggestedManufacturerCode,
        string? StrippedPrefix);

    /* ------------------------------------------------------------------ */
    /* DB tabanlı skorlama                                                  */
    /* ------------------------------------------------------------------ */

    private sealed class StockRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public string? CodeNorm { get; set; }
        public int Quantity { get; set; }
        public decimal Price { get; set; }
    }

    private sealed class AliasRow
    {
        public Guid StockProductId { get; set; }
        public Guid? SupplierId { get; set; }
        public string RawCodeNorm { get; set; } = "";
        public string? ManufacturerCodeNorm { get; set; }
        public string? PrefixNorm { get; set; }
    }

    public static async Task<IReadOnlyList<MatchLineResultDto>> MatchAsync(
        SqlConnection conn,
        Guid shopId,
        Guid? supplierId,
        IReadOnlyList<MatchLineRequest> lines)
    {
        var stocks = (await conn.QueryAsync<StockRow>(
            @"SELECT id AS Id, name AS Name, code AS Code, code_norm AS CodeNorm, quantity AS Quantity, price AS Price
              FROM dbo.stock_products WHERE shop_id=@shopId AND is_active=1",
            new { shopId })).ToList();

        var aliases = (await conn.QueryAsync<AliasRow>(
            @"SELECT a.stock_product_id AS StockProductId, a.supplier_id AS SupplierId,
                     a.raw_code_norm AS RawCodeNorm, a.manufacturer_code_norm AS ManufacturerCodeNorm, a.prefix_norm AS PrefixNorm
              FROM dbo.stock_code_aliases a
              JOIN dbo.stock_products p ON p.id = a.stock_product_id AND p.is_active = 1
              WHERE a.shop_id=@shopId",
            new { shopId })).ToList();

        var stockById = stocks.ToDictionary(s => s.Id);
        var byCodeNorm = stocks.Where(s => !string.IsNullOrEmpty(s.CodeNorm))
            .GroupBy(s => s.CodeNorm!)
            .ToDictionary(g => g.Key, g => g.ToList());
        var learnedPrefixes = aliases
            .Where(a => supplierId is null || a.SupplierId == supplierId)
            .Select(a => a.PrefixNorm)
            .Where(p => !string.IsNullOrEmpty(p))
            .Select(p => p!)
            .Distinct()
            .ToList();
        var stockTokens = stocks.ToDictionary(s => s.Id, s => NameTokens(s.Name));

        var results = new List<MatchLineResultDto>(lines.Count);
        foreach (var line in lines)
        {
            var cands = Candidates(line.RawCode, line.Brand, learnedPrefixes);
            var scored = new Dictionary<Guid, (int Score, string Reason)>();

            void Add(Guid id, int score, string reason)
            {
                if (!stockById.ContainsKey(id)) return;
                if (!scored.TryGetValue(id, out var cur) || cur.Score < score)
                    scored[id] = (score, reason);
            }

            if (cands.RawCanonical.Length > 0)
            {
                // 1) Alias: aynı tedarikçi + aynı ham kod → kesin
                foreach (var a in aliases.Where(a => a.RawCodeNorm == cands.RawCanonical))
                    Add(a.StockProductId, a.SupplierId == supplierId ? 100 : 92, "Daha önce eşleştirildi");

                // 2) Stok kodu adaylardan biriyle birebir
                foreach (var c in cands.Canonicals)
                {
                    if (byCodeNorm.TryGetValue(c, out var hits))
                        foreach (var s in hits) Add(s.Id, c == cands.RawCanonical ? 96 : 94, "Stok kodu eşleşti");
                    foreach (var a in aliases.Where(a => a.ManufacturerCodeNorm == c))
                        Add(a.StockProductId, 90, "Üretici kodu daha önce eşleşti");
                }

                // 3) Sonek: stok kodu adayla bitiyor / aday stok koduyla bitiyor (≥4 kar.)
                foreach (var c in cands.Canonicals.Where(c => c.Length >= 4))
                {
                    foreach (var s in stocks)
                    {
                        var sn = s.CodeNorm;
                        if (string.IsNullOrEmpty(sn) || sn.Length < 4) continue;
                        if (sn == c) continue;
                        if (sn.EndsWith(c, StringComparison.Ordinal) || c.EndsWith(sn, StringComparison.Ordinal))
                            Add(s.Id, 80, "Kod sonek eşleşmesi");
                    }
                }
            }

            // 4) Ad benzerliği (yardımcı)
            var lineTokens = NameTokens(line.Name);
            if (!string.IsNullOrEmpty(line.Brand)) lineTokens.Add(UpperInvariantTr(line.Brand));
            if (lineTokens.Count > 0)
            {
                foreach (var s in stocks)
                {
                    var sim = NameSimilarity(lineTokens, stockTokens[s.Id]);
                    if (sim >= 35)
                    {
                        if (scored.TryGetValue(s.Id, out var cur))
                        {
                            // kod eşleşmesine ad desteği: küçük bonus (üst sınır 99)
                            scored[s.Id] = (Math.Min(99, cur.Score + (sim >= 50 ? 2 : 0)), cur.Reason);
                        }
                        else
                        {
                            Add(s.Id, sim, "Benzer ürün adı");
                        }
                    }
                }
            }

            var ordered = scored
                .Select(kv => (Stock: stockById[kv.Key], kv.Value.Score, kv.Value.Reason))
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.Stock.Name)
                .Take(8)
                .ToList();

            string status;
            var top = ordered.FirstOrDefault();
            var strong = ordered.Where(x => x.Score >= 90).ToList();
            if (strong.Count == 1) status = "exact";
            else if (strong.Count > 1) status = "multiple";
            else if (top.Stock is not null && top.Score >= 60) status = "suggested";
            else if (top.Stock is not null && ordered.Count(x => x.Score >= 60) > 1) status = "multiple";
            else status = "none";

            results.Add(new MatchLineResultDto(
                line.Index,
                string.IsNullOrWhiteSpace(line.RawCode) ? null : line.RawCode.Trim(),
                cands.SuggestedManufacturerCode,
                status,
                ordered.Select(x => new MatchCandidateDto(
                    x.Stock.Id, x.Stock.Name, x.Stock.Code, x.Stock.Quantity, x.Stock.Price, x.Score, x.Reason)).ToList()));
        }

        return results;
    }

    /// <summary>
    /// PDF kodunu ürüne alias olarak kaydeder (varsa dokunmaz). Tedarikçi ön ekini öğrenmek için
    /// prefix_norm = ham canonical kodun, üretici canonical kodundan önceki kısmı.
    /// </summary>
    public static async Task UpsertAliasAsync(
        SqlConnection conn,
        System.Data.IDbTransaction? tx,
        Guid shopId,
        Guid stockProductId,
        Guid? supplierId,
        string rawCode,
        string? manufacturerCode,
        string? brand,
        Guid? userId,
        string source = "pdf")
    {
        rawCode = rawCode.Trim();
        if (rawCode.Length == 0) return;
        var rawCanon = Canonical(rawCode);
        if (rawCanon.Length == 0) return;
        var mfrCanon = Canonical(manufacturerCode);
        if (mfrCanon.Length == 0) mfrCanon = rawCanon;
        string? prefix = null;
        if (rawCanon.Length > mfrCanon.Length && rawCanon.EndsWith(mfrCanon, StringComparison.Ordinal))
            prefix = rawCanon[..^mfrCanon.Length];

        await conn.ExecuteAsync(
            @"IF NOT EXISTS (
                  SELECT 1 FROM dbo.stock_code_aliases
                  WHERE shop_id=@shopId AND raw_code_norm=@rawCanon
                    AND ((supplier_id IS NULL AND @supplierId IS NULL) OR supplier_id=@supplierId))
              INSERT INTO dbo.stock_code_aliases
                  (id, shop_id, stock_product_id, supplier_id, raw_code, raw_code_norm, manufacturer_code_norm, prefix_norm, brand, source, created_by)
              VALUES
                  (NEWID(), @shopId, @stockProductId, @supplierId, @rawCode, @rawCanon, @mfrCanon, @prefix, @brand, @source, @userId)",
            new
            {
                shopId, stockProductId, supplierId,
                rawCode = rawCode.Length > 80 ? rawCode[..80] : rawCode,
                rawCanon = rawCanon.Length > 80 ? rawCanon[..80] : rawCanon,
                mfrCanon = mfrCanon.Length > 80 ? mfrCanon[..80] : mfrCanon,
                prefix = prefix is { Length: > 40 } ? prefix[..40] : prefix,
                brand = string.IsNullOrWhiteSpace(brand) ? null : (brand.Trim().Length > 60 ? brand.Trim()[..60] : brand.Trim()),
                source, userId,
            }, tx);
    }
}
