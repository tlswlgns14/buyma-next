import { findBuymaBrand } from "@/lib/buyma/brands";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type JsonLdProduct = Record<string, unknown>;
type Cafe24OptionStock = Record<string, unknown>;
type SizeGuideData = {
  measurements: Record<string, Record<string, string>>;
  description: string;
};
type SaturMeasurementContext = "top" | "bottom" | "skirt" | "onepiece" | "unknown";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

export const saturExtractor: ProductExtractor = {
  site: "satur.co.kr",
  supports: (url) => url.hostname === "satur.co.kr" || url.hostname === "www.satur.co.kr",
  extract: extractSaturProduct,
};

async function extractSaturProduct(url: URL): Promise<ProductDraft> {
  const html = await fetchHtml(url.toString());
  const jsonLd = extractJsonLdProduct(html);
  const optionStock = extractOptionStockData(html);
  const productNo = extractProductNo(url, html);
  const title =
    cleanText(jsonLd?.name) ||
    extractCafe24Variable(html, "product_name") ||
    cleanPageTitle(extractMeta(html, "description") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const buymaBrand = findBuymaBrand("SATUR");
  const price = parsePrice(firstOfferValue(jsonLd, "price") || extractCafe24Variable(html, "product_price"));
  const colors = resolveColors(title);
  const optionSizes = extractSizesFromOptionStock(optionStock);
  const offerSizes = extractSizesFromOffers(jsonLd, title);
  const sizeGuide = parseSizeGuide(extractSaturTabBlock(html, 1), title);
  const sizes = unique([...optionSizes, ...offerSizes, ...Object.keys(sizeGuide.measurements)]);
  const optionStockMap = buildOptionStockMap(optionStock, colors);
  const stockStatus = resolveOverallStockStatus(optionStockMap);
  const images = extractProductImages(html, jsonLd, url);
  const brandLogo = extractBrandLogo(html, url);
  const descriptionKo = joinDescriptionBlocks(
    normalizeTextBlock(jsonLd?.description),
    extractFabricLine(extractSaturTabBlock(html, 2)),
    sizeGuide.description,
  );

  if (!title && images.length === 0) {
    throw new Error("SATUR 상품 정보를 찾지 못했습니다. URL을 확인해주세요.");
  }

  return {
    site: "satur.co.kr",
    sourceUrl: url.toString(),
    titleKo: title,
    title,
    titleEn: title,
    brand: buymaBrand?.name || "SATUR",
    brandDisplayName: buymaBrand?.displayName || "SATUR(セター)",
    brandId: buymaBrand?.id || "17507",
    price,
    colors,
    sizes,
    images,
    brandLogo,
    productCode: productNo,
    descriptionKo,
    description: "",
    stockStatus,
    optionStockMap,
    ...(Object.keys(sizeGuide.measurements).length ? { sizeMeasurements: sizeGuide.measurements } : {}),
    extractedAt: new Date().toISOString(),
  };
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`SATUR 페이지 요청에 실패했습니다. (${response.status})`);
  }
  return response.text();
}

function extractJsonLdProduct(html: string): JsonLdProduct | null {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(script[1]));
      const product = findJsonLdProduct(parsed);
      if (product) return product;
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return null;
}

function findJsonLdProduct(value: unknown): JsonLdProduct | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLdProduct(item);
      if (found) return found;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((entry) => cleanText(entry).toLowerCase() === "product")) return record;

  return findJsonLdProduct(record["@graph"]);
}

function extractOptionStockData(html: string): Record<string, Cafe24OptionStock> {
  const raw = extractCafe24Variable(html, "option_stock_data");
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return asOptionStockMap(parsed);
  } catch {
    return {};
  }
}

function asOptionStockMap(value: unknown): Record<string, Cafe24OptionStock> {
  const record = asRecord(value);
  if (!record) return {};

  const result: Record<string, Cafe24OptionStock> = {};
  Object.entries(record).forEach(([key, option]) => {
    const optionRecord = asRecord(option);
    if (optionRecord) result[key] = optionRecord;
  });
  return result;
}

function extractCafe24Variable(html: string, name: string) {
  const pattern = new RegExp(`(?:var\\s+)?${escapeRegExp(name)}\\s*=\\s*(['"])([\\s\\S]*?)\\1\\s*;`, "i");
  const match = html.match(pattern);
  if (!match) return "";

  return decodeJsString(match[2], match[1]);
}

function decodeJsString(value: string, quote: string) {
  let decoded = value;
  if (quote === "'") decoded = decoded.replace(/\\'/g, "'");
  if (quote === '"') decoded = decoded.replace(/\\"/g, '"');
  return decoded
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function extractProductNo(url: URL, html: string) {
  return (
    cleanText(url.searchParams.get("product_no")) ||
    extractCafe24Variable(html, "iProductNo") ||
    cleanText(url.pathname.match(/\/(\d+)(?:\/|$)/)?.[1]) ||
    cleanText(html.match(/content_ids:\s*\[['"](\d+)['"]\]/i)?.[1])
  );
}

function resolveColors(title: string) {
  const suffixColor = title.match(/\s-\s([^-/]+)$/)?.[1] || "";
  const bracketColor = title.match(/\(([^()]+)\)\s*$/)?.[1] || "";
  return unique(
    (suffixColor || bracketColor)
      .split(/[,/|]/)
      .map((color) => cleanText(color))
      .map(convertColorToEnglish)
      .filter(isUsefulColor),
  );
}

function extractSizesFromOptionStock(optionStock: Record<string, Cafe24OptionStock>) {
  return unique(
    Object.values(optionStock)
      .flatMap((option) => [
        cleanText(option.option_value),
        ...asArray(option.option_value_orginal).map(cleanText),
      ])
      .map(cleanSizeName)
      .filter(isLikelySizeName),
  );
}

function extractSizesFromOffers(jsonLd: JsonLdProduct | null, title: string) {
  return unique(
    asArray(jsonLd?.offers)
      .map((offer) => asRecord(offer))
      .filter((offer): offer is Record<string, unknown> => Boolean(offer))
      .map((offer) => extractSizeFromOfferName(cleanText(offer.name), title))
      .filter(isLikelySizeName),
  );
}

function extractSizeFromOfferName(name: string, title: string) {
  if (!name) return "";
  const suffix = name.startsWith(title) ? name.slice(title.length) : name.split(/\s+/).at(-1) || "";
  return cleanSizeName(suffix);
}

function buildOptionStockMap(optionStock: Record<string, Cafe24OptionStock>, colors: string[]) {
  const map: Record<string, StockStatus> = {};

  Object.values(optionStock).forEach((option) => {
    const size = cleanSizeName(cleanText(option.option_value) || cleanText(asArray(option.option_value_orginal)[0]));
    if (!isLikelySizeName(size)) return;

    const stock = getOptionStockStatus(option);
    map[`|${size.toUpperCase()}`] = stock;
    colors.forEach((color) => {
      map[`${color}|${size.toUpperCase()}`] = stock;
      map[`${color}|${size}`] = stock;
    });
  });

  return map;
}

function getOptionStockStatus(option: Cafe24OptionStock): StockStatus {
  const isSelling = cleanText(option.is_selling).toUpperCase();
  const isDisplay = cleanText(option.is_display).toUpperCase();
  const isAutoSoldout = cleanText(option.is_auto_soldout).toUpperCase();
  const stockNumber = Number(cleanText(option.stock_number));

  if (isSelling === "F" || isDisplay === "F" || isAutoSoldout === "T") return "0";
  if (Number.isFinite(stockNumber) && stockNumber <= 0) return "0";
  return "1";
}

function resolveOverallStockStatus(optionStockMap: Record<string, StockStatus>): StockStatus {
  const values = Object.values(optionStockMap);
  if (values.length === 0) return "1";
  return values.some((stock) => stock === "1") ? "1" : "0";
}

function extractSaturTabBlock(html: string, index: number) {
  return Array.from(html.matchAll(/<ol\b[^>]*class=["'][^"']*\btab_info\b[^"']*["'][^>]*>([\s\S]*?)<\/ol>/gi))
    .map((match) => match[1])[index] || "";
}

function parseSizeGuide(sizeGuideHtml: string, title: string): SizeGuideData {
  const measurements: Record<string, Record<string, string>> = {};
  const descriptionLines: string[] = [];
  const text = normalizeTextBlock(sizeGuideHtml);

  text.split("\n").forEach((line) => {
    const match = line.match(/^([A-Z0-9]+)\s*-\s*(.+)$/i);
    if (!match) return;

    const size = cleanSizeName(match[1]);
    if (!isLikelySizeName(size)) return;

    const row: Record<string, string> = {};
    const rawDescriptionParts = match[2].split("/").map(cleanText).filter(Boolean);
    const context = resolveMeasurementContext(`${title} ${match[2]}`);
    match[2].split("/").forEach((part) => {
      const measurement = parseMeasurementPart(part, context);
      if (!measurement) return;
      row[measurement.key] = measurement.value;
    });

    if (Object.keys(row).length) measurements[size] = row;
    if (rawDescriptionParts.length) descriptionLines.push(`${size} - ${rawDescriptionParts.join(" / ")}`);
  });

  return {
    measurements,
    description: descriptionLines.length ? ["사이즈 상세", ...descriptionLines].join("\n") : "",
  };
}

function resolveMeasurementContext(value: string): SaturMeasurementContext {
  const text = cleanText(value);
  if (/스커트|치마|skirt/i.test(text)) return "skirt";
  if (/원피스|드레스|one\s*piece|dress/i.test(text)) return "onepiece";
  if (/어깨|가슴|소매|암홀/.test(text)) return "top";
  if (/허리|엉덩이|힙|밑위|밑아래|인심|허벅지/.test(text)) return "bottom";
  return "unknown";
}

function parseMeasurementPart(value: string, context: SaturMeasurementContext) {
  const match = cleanText(value).match(/^(.+?)\s*(-?\d+(?:\.\d+)?)\s*(?:cm)?$/i);
  if (!match) return null;

  const mapping = resolveSaturMeasurementKey(match[1], context);
  if (!mapping) return null;

  return {
    key: mapping.key,
    label: mapping.label,
    value: formatMeasurementValue(match[2], mapping.multiplier),
  };
}

function resolveSaturMeasurementKey(
  value: string,
  context: SaturMeasurementContext,
): { key: string; label: string; multiplier?: number } | null {
  const label = cleanText(value).replace(/\s+/g, "");
  if (["스커트장", "스커트길이", "스커트丈", "치마기장", "치마길이"].includes(label)) return { key: "スカート丈", label: "스커트丈" };
  if (["총장", "총기장", "총길이", "기장"].includes(label) && context === "skirt") return { key: "スカート丈", label: "스커트丈" };
  if (["총장", "총기장", "총길이", "기장"].includes(label) && context !== "bottom") return { key: "着丈", label: "총장" };
  if (["너비", "가로", "폭가로"].includes(label)) return { key: "幅", label: "너비" };
  if (["높이", "세로"].includes(label)) return { key: "高さ", label: "높이" };
  if (["폭", "깊이", "마치"].includes(label)) return { key: "マチ", label: "폭" };
  if (["핸들", "핸들높이", "손잡이", "손잡이높이"].includes(label)) return { key: "持ち手", label: "핸들 높이" };
  if (["볼너비", "발볼", "발볼너비"].includes(label)) return { key: "足幅", label: "볼 너비" };
  if (["굽높이", "굽", "힐높이"].includes(label)) return { key: "ヒール高", label: "굽 높이" };
  if (["어깨", "어깨너비", "어깨넓이", "어깨단면"].includes(label)) return { key: "肩幅", label: "어깨" };
  if (["가슴", "가슴단면", "가슴너비", "가슴폭", "품", "품단면"].includes(label)) {
    return { key: "胸囲", label: "가슴둘레", multiplier: 2 };
  }
  if (["가슴둘레"].includes(label)) return { key: "胸囲", label: "가슴둘레" };
  if (["소매", "소매장", "소매길이", "팔길이"].includes(label)) return { key: "袖丈", label: "소매장" };
  if (["허리", "허리단면", "허리너비", "허리폭"].includes(label)) return { key: "ウエスト", label: "허리둘레" };
  if (["허리둘레"].includes(label)) return { key: "ウエスト", label: "허리둘레" };
  if (["엉덩이", "힙", "힙단면", "엉덩이단면", "엉덩이너비", "엉덩이폭"].includes(label)) return { key: "ヒップ", label: "엉덩이둘레" };
  if (["엉덩이둘레", "힙둘레"].includes(label)) return { key: "ヒップ", label: "엉덩이둘레" };
  if (["밑위", "앞밑위"].includes(label)) return { key: "股上", label: "밑위" };
  if (["밑아래", "밑아래길이", "인심"].includes(label)) return { key: "股下", label: "밑아래" };
  if (["허벅지", "허벅지단면", "허벅지너비", "허벅지폭"].includes(label)) return { key: "もも周り", label: "허벅지둘레" };
  if (["허벅지둘레"].includes(label)) return { key: "もも周り", label: "허벅지둘레" };
  if (["밑단", "밑단단면", "밑단너비", "밑단폭"].includes(label) && context !== "top") return { key: "すそ周り", label: "밑단둘레" };
  if (["밑단둘레"].includes(label)) return { key: "すそ周り", label: "밑단둘레" };
  return null;
}

function formatMeasurementValue(value: string, multiplier = 1) {
  const numeric = Number(cleanText(value).replace(/cm$/i, ""));
  if (!Number.isFinite(numeric)) return value;
  const result = numeric * multiplier;
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(1)));
}

function extractFabricLine(infoHtml: string) {
  const text = normalizeTextBlock(infoHtml);
  return text.split("\n").find((line) => /^Fabric\s*:/i.test(line)) || "";
}

function extractProductImages(html: string, jsonLd: JsonLdProduct | null, baseUrl: URL) {
  const jsonImageCandidates = [
    ...asArray(jsonLd?.image),
    ...asArray(firstOfferValue(jsonLd, "image")),
  ];
  const htmlImageCandidates = [
    extractMeta(html, "og:image"),
    ...extractHtmlImageSources(html),
  ];
  const imageCandidates = jsonImageCandidates.length ? jsonImageCandidates : htmlImageCandidates;

  return unique(
    imageCandidates
      .map((src) => resolveUrl(cleanText(src), baseUrl))
      .filter(isProductImageUrl)
      .map(preferLargeProductImage),
  ).slice(0, 20);
}

function extractBrandLogo(html: string, baseUrl: URL) {
  const logo = extractHtmlImages(html).find((image) => {
    const alt = cleanText(image.alt).toLowerCase();
    const src = image.src.toLowerCase();
    return alt.includes("logo") || alt.includes("로고") || src.includes("saturlogo");
  });

  return logo ? resolveUrl(logo.src, baseUrl) : "";
}

function extractHtmlImageSources(html: string) {
  return extractHtmlImages(html).map((image) => image.src);
}

function extractHtmlImages(html: string) {
  return Array.from(html.matchAll(/<img\b([^>]*)>/gi))
    .map((match) => {
      const attrs = match[1];
      return {
        src: extractHtmlAttribute(attrs, "src") || extractHtmlAttribute(attrs, "ec-data-src"),
        alt: extractHtmlAttribute(attrs, "alt"),
      };
    })
    .filter((image) => image.src);
}

function extractHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : "";
}

function isProductImageUrl(value: string) {
  const src = value.toLowerCase();
  if (!src) return false;
  if (src.includes("img.echosting.cafe24.com")) return false;
  if (src.includes("btn_") || src.includes("basket") || src.includes("qrcode")) return false;
  if (src.includes("/category/editor/")) return false;
  return src.includes("/web/product/");
}

function preferLargeProductImage(value: string) {
  return value
    .replace("/web/product/small/", "/web/product/big/")
    .replace("/web/product/extra/small/", "/web/product/extra/big/");
}

function resolveUrl(value: string, baseUrl: URL) {
  if (!value) return "";
  const cleanValue = value.replace(/\\\//g, "/").trim();
  const embeddedAbsoluteUrl = cleanValue.match(/https?:\/\/.+$/i)?.[0];
  if (embeddedAbsoluteUrl) return embeddedAbsoluteUrl;
  if (cleanValue.startsWith("//")) return `${baseUrl.protocol}${cleanValue}`;
  try {
    return new URL(cleanValue, baseUrl).toString();
  } catch {
    return "";
  }
}

function firstOfferValue(jsonLd: JsonLdProduct | null, key: string) {
  const offers = asArray(jsonLd?.offers);
  for (const offer of offers) {
    const record = asRecord(offer);
    const value = record?.[key];
    if (value) return value;
  }
  return "";
}

function extractMeta(html: string, property: string) {
  const escaped = escapeRegExp(property);
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }

  return "";
}

function normalizeTextBlock(value: unknown) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinDescriptionBlocks(...blocks: string[]) {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

function cleanPageTitle(value = "") {
  return cleanText(decodeHtmlEntities(value).replace(/\s*SATUR\s*\|\s*세터\s*\|\s*/i, ""));
}

function cleanSizeName(value: string) {
  const size = cleanText(value)
    .replace(/\[[^\]]*품절[^\]]*\]/g, "")
    .replace(/품절/g, "")
    .replace(/^[\s:|/-]+|[\s:|/-]+$/g, "")
    .toUpperCase();
  const compact = size.replace(/[\s-]+/g, "");
  if (/^(?:OS|O\/S|ONE|ONESIZE|ONE\(SIZE\)|OS\(ONESIZE\)|O\/S\(ONESIZE\)|FREE|FREESIZE|FREE\(SIZE\)|FREE\(ONESIZE\))$/.test(compact)) return "FREE";
  return size;
}

function isLikelySizeName(value: string) {
  const size = cleanSizeName(value);
  return Boolean(size) && size.length <= 16 && !/^(SIZE|COLOR|OPTION|SELECT|필수)$/.test(size);
}

function isUsefulColor(value: string) {
  return Boolean(value) && !/^(FREE|SIZE|COLOR|OPTION|SELECT)$/i.test(value);
}

function decodeHtmlEntities(value: string) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
