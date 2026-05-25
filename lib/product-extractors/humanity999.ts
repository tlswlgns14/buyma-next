import { findBuymaBrand } from "@/lib/buyma/brands";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, getColorSystemId, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type JsonLdProduct = Record<string, unknown>;
type Cafe24OptionStock = Record<string, unknown>;
type ProductPageData = {
  html: string;
  sourceUrl: string;
  title: string;
  price: number;
  colors: string[];
  sizes: string[];
  images: string[];
  optionStockMap: Record<string, StockStatus>;
  stockStatus: StockStatus;
  sizeMeasurements: Record<string, Record<string, string>>;
  sizeDescription: string;
  descriptionKo: string;
  productCode: string;
  brandLogo: string;
  variantUrls: string[];
};
type MeasurementContext = "top" | "bottom" | "skirt" | "onepiece" | "unknown";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const BRAND_NAME = "999HUMANITY";
const BRAND_ID = "19648";
const BRAND_DISPLAY_NAME = "999HUMANITY(999ヒューマニティ)";
const BRAND_LOGO = "https://999humanity.kr/images/999humanity.png";

export const humanity999Extractor: ProductExtractor = {
  site: "999humanity.kr",
  supports: (url) => url.hostname === "999humanity.kr" || url.hostname === "www.999humanity.kr",
  extract: extract999HumanityProduct,
};

async function extract999HumanityProduct(url: URL): Promise<ProductDraft> {
  const main = await extractProductPage(url);
  const variantUrls = main.variantUrls.filter((variantUrl) => normalizeUrl(variantUrl) !== normalizeUrl(url.toString())).slice(0, 12);
  const variants = (
    await Promise.all(
      variantUrls.map(async (variantUrl) => {
        try {
          return await extractProductPage(new URL(variantUrl));
        } catch {
          return null;
        }
      }),
    )
  ).filter((page): page is ProductPageData => Boolean(page));
  const pages = [main, ...variants];
  const buymaBrand = findBuymaBrand(BRAND_NAME);
  const colors = unique(pages.flatMap((page) => page.colors)).filter(Boolean);
  const sizes = unique([...pages.flatMap((page) => page.sizes), ...Object.keys(main.sizeMeasurements)]).filter(Boolean);
  const optionStockMap = mergeStockMaps(pages.map((page) => page.optionStockMap));
  const images = unique(pages.flatMap((page) => page.images)).slice(0, 50);

  if (!main.title && images.length === 0) {
    throw new Error("999HUMANITY product information could not be found. Please check the URL.");
  }

  return {
    site: "999humanity.kr",
    sourceUrl: url.toString(),
    titleKo: main.title,
    title: main.title,
    titleEn: main.title,
    brand: buymaBrand?.name || BRAND_NAME,
    brandDisplayName: buymaBrand?.displayName || BRAND_DISPLAY_NAME,
    brandId: buymaBrand?.id || BRAND_ID,
    price: main.price,
    colors,
    sizes,
    images,
    brandLogo: main.brandLogo,
    productCode: main.productCode,
    descriptionKo: main.descriptionKo,
    description: "",
    stockStatus: resolveOverallStockStatus(optionStockMap),
    optionStockMap,
    colorSystemMap: Object.fromEntries(colors.map((color) => [color, getColorSystemId(color)])),
    ...(Object.keys(main.sizeMeasurements).length ? { sizeMeasurements: main.sizeMeasurements } : {}),
    extractedAt: new Date().toISOString(),
  };
}

async function extractProductPage(url: URL): Promise<ProductPageData> {
  const html = await fetchHtml(url.toString());
  const jsonLd = extractJsonLdProduct(html);
  const optionStock = extractOptionStockData(html);
  const title =
    cleanText(jsonLd?.name) ||
    extractCafe24Variable(html, "product_name") ||
    cleanPageTitle(extractMeta(html, "og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const color = extractColorFromTitle(title);
  const colors = color ? [color] : [];
  const optionSizes = extractSizesFromOptionStock(optionStock);
  const offerSizes = extractSizesFromOffers(jsonLd, title);
  const sizeGuide = parseSizeGuide(html, title);
  const sizes = unique([...optionSizes, ...offerSizes, ...Object.keys(sizeGuide.measurements)]);
  const optionStockMap = buildOptionStockMap(optionStock, colors);
  const price = parsePrice(firstOfferValue(jsonLd, "price") || extractCafe24Variable(html, "product_price"));
  const descriptionKo = joinDescriptionBlocks(
    normalizeTextBlock(jsonLd?.description),
    extractAdditionalInfoBlock(html, "Product Details"),
    extractAdditionalInfoBlock(html, "Fabric & Care"),
    sizeGuide.description,
  );
  const brandLogo = extractHeaderBrandLogo(html, url) || BRAND_LOGO;

  return {
    html,
    sourceUrl: url.toString(),
    title,
    price,
    colors,
    sizes,
    images: extractProductImages(html, jsonLd, url),
    optionStockMap,
    stockStatus: resolveOverallStockStatus(optionStockMap),
    sizeMeasurements: sizeGuide.measurements,
    sizeDescription: sizeGuide.description,
    descriptionKo,
    productCode: extractProductNo(url, html),
    brandLogo,
    variantUrls: extractVariantUrls(html, url, title),
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
    throw new Error(`999HUMANITY page request failed (${response.status}).`);
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

function extractColorFromTitle(title: string) {
  const color = title.match(/\(([^()]+)\)\s*$/)?.[1] || "";
  return color ? convertColorToEnglish(color) : "";
}

function extractBaseProductName(title: string) {
  return cleanText(title).replace(/\s*\([^()]+\)\s*$/, "").toUpperCase();
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

function parseSizeGuide(html: string, title: string) {
  const sizeBlock = extractAdditionalInfoBlockHtml(html, "Size Measurement");
  const rows = parseHtmlTableRows(sizeBlock);
  if (rows.length < 2) return { measurements: {}, description: "" };

  const sizes = rows[0].slice(1).map(cleanSizeName).filter(isLikelySizeName);
  const measurementRows = rows.slice(1).map((cells) => ({
    label: cleanText(cells[0]),
    values: cells.slice(1).map(cleanText),
  }));
  const context = resolveMeasurementContext(`${title} ${measurementRows.map((row) => row.label).join(" ")}`);
  const measurements: Record<string, Record<string, string>> = {};

  sizes.forEach((size, sizeIndex) => {
    const row: Record<string, string> = {};
    measurementRows.forEach((measurement) => {
      const value = cleanText(measurement.values[sizeIndex]);
      if (!value) return;
      const mapping = normalizeMeasurementLabel(measurement.label, context);
      if (!mapping) return;
      row[mapping.key] = formatMeasurementValue(value, mapping.multiplier);
    });
    if (Object.keys(row).length && context !== "unknown") measurements[size] = row;
  });

  const lines = ["Size Measurement"];
  sizes.forEach((size, sizeIndex) => {
    lines.push(size);
    measurementRows.forEach((measurement) => {
      const value = formatSizeDescriptionValue(measurement.values[sizeIndex]);
      if (measurement.label && value) lines.push(`${measurement.label} ${value}`);
    });
  });

  return {
    measurements,
    description: lines.length > 1 ? lines.join("\n") : "",
  };
}

function resolveMeasurementContext(value: string): MeasurementContext {
  const text = cleanText(value);
  if (/skirt|스커트|치마/i.test(text)) return "skirt";
  if (/one\s*piece|dress|원피스|드레스/i.test(text)) return "onepiece";
  if (/shoulder|chest|sleeve|top|tee|shirt|jacket|어깨|가슴|소매/i.test(text)) return "top";
  if (/waist|hip|rise|inseam|thigh|pants|shorts|허리|엉덩이|밑위|밑아래|허벅지/i.test(text)) return "bottom";
  return "unknown";
}

function normalizeMeasurementLabel(value: string, context: MeasurementContext): { key: string; multiplier?: number } | null {
  const text = cleanText(value).toLowerCase();
  if (/length/.test(text)) {
    if (context === "skirt") return { key: "スカート丈" };
    if (context !== "bottom") return { key: "着丈" };
  }
  if (/shoulder/.test(text)) return { key: "肩幅" };
  if (/chest|bust/.test(text)) return { key: "胸囲", multiplier: 2 };
  if (/sleeve/.test(text)) return { key: "袖丈" };
  if (/waist/.test(text)) return { key: "ウエスト" };
  if (/hip/.test(text)) return { key: "ヒップ" };
  if (/rise/.test(text)) return { key: "股上" };
  if (/inseam/.test(text)) return { key: "股下" };
  if (/thigh/.test(text)) return { key: "もも周り" };
  if (/hem/.test(text) && context !== "top") return { key: "すそ周り" };
  return null;
}

function extractAdditionalInfoBlock(html: string, label: string) {
  return normalizeTextBlock(extractAdditionalInfoBlockHtml(html, label));
}

function extractAdditionalInfoBlockHtml(html: string, label: string) {
  const labelPattern = escapeRegExp(label).replace(/&/g, "(?:&|&amp;|&#38;)");
  const match = html.match(new RegExp(`<a[^>]*>\\s*<span>\\s*${labelPattern}\\s*<\\/span>[\\s\\S]*?<div[^>]*class=["'][^"']*addinfo-box[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"));
  return match?.[1] || "";
}

function extractHeaderBrandLogo(html: string, baseUrl: URL) {
  const logoBlock = html.match(/<div\b[^>]*class=["'][^"']*\blogo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  const imageLogo = logoBlock.match(/<img\b([^>]*)>/i)?.[1];
  const imageSrc = imageLogo ? extractHtmlAttribute(imageLogo, "src") : "";
  if (imageSrc) return resolveUrl(imageSrc, baseUrl);

  const svg = logoBlock.match(/(<svg\b[\s\S]*?<\/svg>)/i)?.[1];
  if (!svg) return "";

  const normalizedSvg = decodeHtmlEntities(svg)
    .replace(/\bviewbox=/i, "viewBox=")
    .replace(/<path\b(?![^>]*\bfill=)/gi, '<path fill="#111"')
    .replace(/<svg\b(?![^>]*\bxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizedSvg)}`;
}

function parseHtmlTableRows(html: string) {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((rowMatch) =>
      Array.from(rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((cellMatch) => normalizeTextBlock(cellMatch[1])),
    )
    .filter((row) => row.length > 0);
}

function extractVariantUrls(html: string, baseUrl: URL, title: string) {
  const baseName = extractBaseProductName(title);
  if (!baseName) return [];

  return unique(
    Array.from(html.matchAll(/<p\b[^>]*class=["']name["'][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi))
      .map((match) => ({
        href: extractHtmlAttribute(match[1], "href"),
        title: normalizeTextBlock(match[2]),
      }))
      .filter((item) => item.href && extractBaseProductName(item.title) === baseName)
      .map((item) => resolveUrl(item.href, baseUrl)),
  );
}

function extractProductImages(html: string, jsonLd: JsonLdProduct | null, baseUrl: URL) {
  const jsonImages = [
    ...asArray(jsonLd?.image),
    ...asArray(firstOfferValue(jsonLd, "image")),
  ];
  const htmlImages = [
    extractMeta(html, "og:image"),
    ...extractHtmlImageSources(html),
  ];
  const candidates = jsonImages.length ? jsonImages : htmlImages;

  return unique(
    candidates
      .map((src) => resolveUrl(cleanText(src), baseUrl))
      .filter(isProductImageUrl)
      .map(preferLargeProductImage),
  ).slice(0, 20);
}

function extractHtmlImageSources(html: string) {
  return Array.from(html.matchAll(/<img\b([^>]*)>/gi))
    .map((match) => extractHtmlAttribute(match[1], "src") || extractHtmlAttribute(match[1], "ec-data-src"))
    .filter(Boolean);
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
    .replace("/web/product/medium/", "/web/product/big/")
    .replace("/web/product/extra/small/", "/web/product/extra/big/");
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

function resolveUrl(value: string, baseUrl: URL) {
  if (!value) return "";
  const cleanValue = decodeHtmlEntities(value).replace(/\\\//g, "/").trim();
  const embeddedAbsoluteUrl = cleanValue.match(/https?:\/\/.+$/i)?.[0];
  if (embeddedAbsoluteUrl) return embeddedAbsoluteUrl;
  if (cleanValue.startsWith("//")) return `${baseUrl.protocol}${cleanValue}`;
  try {
    return new URL(cleanValue, baseUrl).toString();
  } catch {
    return "";
  }
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function cleanPageTitle(value: unknown) {
  return cleanText(decodeHtmlEntities(value)).replace(/\s*-\s*999.*$/i, "");
}

function cleanSizeName(value: string) {
  const size = cleanText(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
  if (/^(?:OS|O\/S|ONE|ONESIZE|ONE\(SIZE\)|OS\(ONESIZE\)|O\/S\(ONESIZE\)|FREE|FREESIZE|FREE\(SIZE\)|FREE\(ONESIZE\))$/.test(size)) return "FREE";
  return size;
}

function isLikelySizeName(value: string) {
  const text = cleanText(value);
  if (!text || text.length > 30) return false;
  return /^(?:FREE|ONE|ONE\s*SIZE|OS|XS|S|M|L|XL|XXL|XXXL|\d+\([A-Z0-9]+\)|\d{1,3}|[A-Z0-9./+-]{1,12})$/i.test(text);
}

function formatSizeDescriptionValue(value: string) {
  const text = formatMeasurementValue(value);
  if (!text || /cm$/i.test(text)) return text;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return `${text}cm`;
  return text;
}

function formatMeasurementValue(value: string, multiplier = 1) {
  const numeric = Number(cleanText(value).replace(/cm$/i, ""));
  if (!Number.isFinite(numeric)) return cleanText(value);
  const result = numeric * multiplier;
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(1)));
}

function resolveOverallStockStatus(optionStockMap: Record<string, StockStatus>): StockStatus {
  const values = Object.values(optionStockMap);
  if (values.length === 0) return "1";
  return values.some((stock) => stock === "1") ? "1" : "0";
}

function mergeStockMaps(maps: Array<Record<string, StockStatus>>) {
  return Object.assign({}, ...maps);
}

function joinDescriptionBlocks(...blocks: string[]) {
  return blocks.map((block) => normalizeTextBlock(block)).filter(Boolean).join("\n\n");
}

function normalizeTextBlock(value: unknown) {
  return stripTags(String(value ?? ""))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

function decodeHtmlEntities(value: unknown) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
