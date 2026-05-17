import { findBuymaBrand } from "@/lib/buyma/brands";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type JsonLdProduct = Record<string, unknown>;
type Cafe24OptionStock = Record<string, unknown>;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

export const sansangearExtractor: ProductExtractor = {
  site: "sansangear.com",
  supports: (url) => url.hostname === "sansangear.com" || url.hostname.endsWith(".sansangear.com"),
  extract: extractSansangearProduct,
};

async function extractSansangearProduct(url: URL): Promise<ProductDraft> {
  const html = await fetchHtml(url.toString());
  const jsonLd = extractJsonLdProduct(html);
  const optionStock = extractOptionStockData(html);
  const productNo = extractProductNo(url, html);
  const title =
    cleanText(jsonLd?.name) ||
    extractCafe24Variable(html, "product_name") ||
    cleanPageTitle(extractMeta(html, "og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const buymaBrand = findBuymaBrand("San San Gear");
  const price = parsePrice(firstOfferValue(jsonLd, "price") || extractCafe24Variable(html, "product_price"));
  const colors = resolveColors(title);
  const sizeGuideHtml = extractTabContent(html, "SIZE GUIDE");
  const sizeMeasurements = parseSizeGuideMeasurements(sizeGuideHtml);
  const optionSizes = extractSizesFromOptionStock(optionStock);
  const sizes = unique([...optionSizes, ...Object.keys(sizeMeasurements)]);
  const optionStockMap = buildOptionStockMap(optionStock, colors);
  const stockStatus = resolveOverallStockStatus(optionStockMap);
  const images = extractProductImages(html, jsonLd, url);
  const brandLogo = extractBrandLogo(html, url);
  const descriptionKo = joinDescriptionBlocks(
    normalizeTextBlock(extractTabContent(html, "DETAILS")),
    buildSizeGuideDescription(sizeGuideHtml),
  );

  if (!title && images.length === 0) {
    throw new Error("Sansan Gear product information could not be found. Please check the URL.");
  }

  return {
    site: "sansangear.com",
    sourceUrl: url.toString(),
    titleKo: title,
    title,
    titleEn: title,
    brand: buymaBrand?.name || "San San Gear",
    brandDisplayName: buymaBrand?.displayName || "San San Gear",
    brandId: buymaBrand?.id || "0",
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
    ...(Object.keys(sizeMeasurements).length ? { sizeMeasurements } : {}),
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
    throw new Error(`Sansan Gear page request failed (${response.status}).`);
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
    cleanText(html.match(/content_ids:\s*\[['"](\d+)['"]\]/i)?.[1])
  );
}

function resolveColors(title: string) {
  const bracketColor = title.match(/\[([^\]]+)\]/)?.[1] || "";
  return unique(
    bracketColor
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

function extractTabContent(html: string, label: string) {
  const escaped = escapeRegExp(label);
  const match = html.match(new RegExp(`<a[^>]*>\\s*${escaped}\\s*<\\/a>\\s*<ol[^>]*>([\\s\\S]*?)<\\/ol>`, "i"));
  return match?.[1] || "";
}

function parseSizeGuideMeasurements(sizeGuideHtml: string) {
  const rows = parseHtmlTableRows(sizeGuideHtml);
  if (rows.length < 2) return {};

  const headers = rows[0].map(normalizeSizeGuideHeader);
  const measurements: Record<string, Record<string, string>> = {};

  rows.slice(1).forEach((cells) => {
    const size = cleanSizeName(cells[0]);
    if (!isLikelySizeName(size)) return;

    const row: Record<string, string> = {};
    headers.slice(1).forEach((header, headerIndex) => {
      const value = cleanText(cells[headerIndex + 1]);
      if (!value || !header) return;

      const mapping = normalizeMeasurementKey(header);
      if (!mapping) return;
      row[mapping.key] = formatMeasurementValue(value, mapping.multiplier);
    });

    if (Object.keys(row).length) measurements[size] = row;
  });

  return measurements;
}

function buildSizeGuideDescription(sizeGuideHtml: string) {
  const rows = parseHtmlTableRows(sizeGuideHtml);
  if (rows.length < 2) return "";

  const headers = rows[0].map((header) => cleanText(header));
  const lines = ["SIZE GUIDE"];
  rows.slice(1).forEach((cells) => {
    const size = cleanSizeName(cells[0]);
    if (!isLikelySizeName(size)) return;

    lines.push(`${size} SIZE`);
    headers.slice(1).forEach((header, headerIndex) => {
      const value = cleanText(cells[headerIndex + 1]);
      if (!header || !value) return;
      lines.push(`${header} ${formatSizeGuideDescriptionValue(value)}`);
    });
  });

  return lines.length > 1 ? lines.join("\n") : "";
}

function formatSizeGuideDescriptionValue(value: string) {
  const text = cleanText(value);
  if (!text || /cm$/i.test(text) || !/^\d+(?:\.\d+)?$/.test(text)) return text;
  return `${text}cm`;
}

function parseHtmlTableRows(html: string) {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((rowMatch) =>
      Array.from(rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((cellMatch) => normalizeTextBlock(cellMatch[1])),
    )
    .filter((row) => row.length > 0);
}

function normalizeSizeGuideHeader(value: string) {
  return cleanText(value).replace(/\s+/g, " ").toUpperCase();
}

function normalizeMeasurementKey(value: string): { key: string; multiplier?: number } | null {
  const key = cleanText(value).replace(/\s+/g, " ").toUpperCase();
  if (key === "WIDTH") return { key: "頭周り", multiplier: 2 };
  if (key === "HEIGHT") return { key: "高さ" };
  if (key === "BRIM" || key === "VISOR") return { key: "つば" };
  if (key === "LENGTH" || key === "TOTAL LENGTH") return { key: "length" };
  if (key === "SHOULDER" || key === "SHOULDER WIDTH") return { key: "shoulder" };
  if (key === "CHEST" || key === "BUST") return { key: "chest", multiplier: 2 };
  if (key === "SLEEVE" || key === "SLEEVE LENGTH") return { key: "sleevelength" };
  if (key === "WAIST" || key === "WAIST WIDTH") return { key: "waist" };
  if (key === "HIP" || key === "HIPS") return { key: "hips" };
  if (key === "HEM" || key === "HEM WIDE" || key === "HEM WIDTH" || key === "BOTTOM WIDTH") return { key: "hemwidth" };
  if (key === "THIGH" || key === "THIGH WIDTH" || key === "TIGHT") return { key: "thighwidth" };
  if (key === "RISE" || key === "RISE LENGTH" || key === "FRONT RISE" || key === "CROTCH") return { key: "rise" };
  if (key === "INSEAM") return { key: "inseam" };
  return null;
}

function formatMeasurementValue(value: string, multiplier = 1) {
  const numeric = Number(cleanText(value).replace(/cm$/i, ""));
  if (!Number.isFinite(numeric)) return value;
  const result = numeric * multiplier;
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(1)));
}

function extractProductImages(html: string, jsonLd: JsonLdProduct | null, baseUrl: URL) {
  const imageCandidates = [
    ...asArray(jsonLd?.image),
    ...asArray(firstOfferValue(jsonLd, "image")),
    extractMeta(html, "og:image"),
    ...extractHtmlImageSources(html),
  ];

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
    return alt.includes("logo") || alt.includes("로고") || src.includes("/web/upload/images/logo");
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
        src: extractHtmlAttribute(attrs, "src"),
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
  if (src.includes("/web/upload/images/")) return false;
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

function normalizeTextBlock(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r/g, "\n")
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
  return cleanText(decodeHtmlEntities(value).replace(/\s*-\s*SAN SAN GEAR\s*$/i, ""));
}

function cleanSizeName(value: string) {
  const size = cleanText(value)
    .replace(/^[\s:|/-]+|[\s:|/-]+$/g, "")
    .toUpperCase();
  if (/^(?:OS|O\/S|ONE|ONE SIZE|ONESIZE|FREE SIZE|FREE-SIZE)$/.test(size)) return "FREE";
  return size;
}

function isLikelySizeName(value: string) {
  const size = cleanSizeName(value);
  return Boolean(size) && size.length <= 16 && !/^(SIZE|COLOR|OPTION|SELECT|필수|ACC)$/.test(size);
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
