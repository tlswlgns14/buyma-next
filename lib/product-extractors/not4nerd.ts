import { findBuymaBrand } from "@/lib/buyma/brands";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, getColorSystemId, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type JsonLdProduct = Record<string, unknown>;
type Cafe24OptionStock = Record<string, unknown>;
type ProductPageData = {
  title: string;
  price: number;
  colors: string[];
  sizes: string[];
  images: string[];
  brandLogo: string;
  optionStockMap: Record<string, StockStatus>;
  sizeMeasurements: Record<string, Record<string, string>>;
  descriptionKo: string;
  productCode: string;
  variantUrls: string[];
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const BRAND_NAME = "NOT4NERD";
const BRAND_ID = "17693";
const BRAND_DISPLAY_NAME = "NOT4NERD(ノットフォーナード)";

export const not4nerdExtractor: ProductExtractor = {
  site: "not4nerd.net",
  supports: (url) => url.hostname === "not4nerd.net" || url.hostname === "www.not4nerd.net",
  extract: extractNot4nerdProduct,
};

async function extractNot4nerdProduct(url: URL): Promise<ProductDraft> {
  const main = await extractProductPage(url);
  const variantUrls = main.variantUrls
    .filter((variantUrl) => normalizeUrl(variantUrl) !== normalizeUrl(url.toString()))
    .slice(0, 12);
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
  const sizes = unique([
    ...pages.flatMap((page) => page.sizes),
    ...Object.keys(main.sizeMeasurements),
  ]).filter(Boolean);
  const optionStockMap = buildMergedOptionStockMap(pages, colors, sizes);
  const images = unique(pages.flatMap((page) => page.images)).slice(0, 50);
  const title = colors.length > 1 ? stripTitleColorSuffix(main.title) : main.title;

  if (!main.title && images.length === 0) {
    throw new Error("NOT4NERD product information could not be found. Please check the URL.");
  }

  return {
    site: "not4nerd.net",
    sourceUrl: url.toString(),
    titleKo: title,
    title,
    titleEn: title,
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
  const sizeGuide = parseSizeGuide(html);
  const optionSizes = extractSizesFromOptionStock(optionStock);
  const offerSizes = extractSizesFromOffers(jsonLd, title);
  const sizes = unique([...optionSizes, ...offerSizes, ...Object.keys(sizeGuide.measurements)]);
  const optionStockMap = buildOptionStockMap(optionStock, colors);
  const price = parsePrice(firstOfferValue(jsonLd, "price") || extractCafe24Variable(html, "product_price"));
  const details = extractProductDetails(html);
  const descriptionKo = joinDescriptionBlocks(details, sizeGuide.description);

  return {
    title,
    price,
    colors,
    sizes,
    images: extractProductImages(html, jsonLd, url),
    brandLogo: extractBrandLogo(html, url),
    optionStockMap,
    sizeMeasurements: sizeGuide.measurements,
    descriptionKo,
    productCode: extractProductNo(url, html),
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
    throw new Error(`NOT4NERD page request failed (${response.status}).`);
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
  const suffixColor = cleanText(title.match(/\s-\s([^-/]+)$/)?.[1] || "");
  return suffixColor ? convertColorToEnglish(suffixColor) : "";
}

function stripTitleColorSuffix(title: string) {
  return cleanText(title).replace(/\s+-\s+[^-]+$/, "").trim();
}

function extractBaseProductName(title: string) {
  return cleanText(title)
    .replace(/\s*,\s*NOT4NERD\s*$/i, "")
    .replace(/\s+-\s+[^-]+$/, "")
    .toUpperCase();
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

  colors.forEach((color) => {
    const colorStocks = Object.entries(map)
      .filter(([key]) => key.startsWith(`${color}|`))
      .map(([, stock]) => stock);
    if (colorStocks.length) map[color] = colorStocks.some((stock) => stock === "1") ? "1" : "0";
  });

  return map;
}

function buildMergedOptionStockMap(pages: ProductPageData[], colors: string[], sizes: string[]) {
  const map = Object.assign({}, ...pages.map((page) => page.optionStockMap));

  pages.forEach((page) => {
    page.colors.forEach((color) => {
      sizes.forEach((size) => {
        const upperSize = size.toUpperCase();
        if (!map[`${color}|${upperSize}`] && !map[`${color}|${size}`]) {
          map[`${color}|${upperSize}`] = "0";
          map[`${color}|${size}`] = "0";
        }
      });
    });
  });

  colors.forEach((color) => {
    const colorStocks = sizes
      .map((size) => map[`${color}|${size.toUpperCase()}`] || map[`${color}|${size}`])
      .filter((stock): stock is StockStatus => stock === "0" || stock === "1" || stock === "2");
    if (colorStocks.length) map[color] = colorStocks.some((stock) => stock === "1" || stock === "2") ? "1" : "0";
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

function parseSizeGuide(html: string) {
  const text = extractTextBetweenLabels(html, "SIZE GUIDE", ["SHIPPING & RETURNS", "WITH ITEM", "REVIEW", "Q&A"]);
  const measurements: Record<string, Record<string, string>> = {};
  const descriptionLines: string[] = [];
  let currentSize = "";

  text.split("\n").forEach((line) => {
    const normalizedLine = removeInvisibleChars(cleanText(line));
    if (!normalizedLine) return;

    const size = cleanSizeName(normalizedLine.match(/^([A-Z0-9][A-Z0-9./+-]{0,12})\s+Size$/i)?.[1] || "");
    if (isLikelySizeName(size)) {
      currentSize = size;
      if (!measurements[currentSize]) measurements[currentSize] = {};
      descriptionLines.push(`${currentSize} Size`);
      return;
    }

    if (!currentSize) return;

    const rawParts = normalizedLine.split("/").map(cleanText).filter(Boolean);
    rawParts.forEach((part) => {
      const measurement = parseMeasurementPart(part);
      if (!measurement) return;
      measurements[currentSize][measurement.key] = measurement.value;
    });
    if (rawParts.length) descriptionLines.push(rawParts.join(" / "));
  });

  return {
    measurements: Object.fromEntries(Object.entries(measurements).filter(([, values]) => Object.keys(values).length)),
    description: descriptionLines.length ? ["Size Guide", ...descriptionLines].join("\n") : "",
  };
}

function parseMeasurementPart(value: string) {
  const match = removeInvisibleChars(cleanText(value)).match(/^([A-Z][A-Z\s]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?:cm)?$/i);
  if (!match) return null;

  const mapping = normalizeMeasurementKey(match[1]);
  if (!mapping) return null;

  return {
    key: mapping.key,
    value: formatMeasurementValue(match[2], mapping.multiplier),
  };
}

function normalizeMeasurementKey(value: string): { key: string; multiplier?: number } | null {
  const key = cleanText(value).replace(/\s+/g, " ").toUpperCase();
  if (key === "LENGTH" || key === "TOTAL LENGTH") return { key: "length" };
  if (key === "SHOULDER" || key === "SHOULDER WIDTH") return { key: "shoulder" };
  if (key === "CHEST" || key === "BUST") return { key: "chest", multiplier: 2 };
  if (key === "ARM" || key === "SLEEVE" || key === "SLEEVE LENGTH") return { key: "sleevelength" };
  if (key === "WAIST" || key === "WAIST WIDTH") return { key: "waist" };
  if (key === "HIP" || key === "HIPS") return { key: "hips" };
  if (key === "TIGHT" || key === "THIGH" || key === "THIGH WIDTH") return { key: "thighwidth" };
  if (key === "CROTCH" || key === "RISE" || key === "RISE LENGTH" || key === "FRONT RISE") return { key: "rise" };
  if (key === "INSEAM") return { key: "inseam" };
  if (key === "BOTTOM HEM" || key === "HEM" || key === "HEM WIDTH" || key === "BOTTOM WIDTH") return { key: "hemwidth" };
  if (key === "HEAD" || key === "HEAD SIZE") return { key: "頭周り" };
  if (key === "CAP" || key === "BRIM" || key === "VISOR") return { key: "つば" };
  if (key === "HEIGHT") return { key: "高さ" };
  if (key === "WIDTH") return { key: "幅" };
  return null;
}

function extractProductDetails(html: string) {
  const text = extractTextBetweenLabels(html, "DETAILS", ["SIZE GUIDE", "SHIPPING & RETURNS", "WITH ITEM", "REVIEW", "Q&A"]);
  const lines = text
    .split("\n")
    .map(cleanText)
    .filter((line) => line && !/^DETAILS$/i.test(line) && !/^SIZE GUIDE$/i.test(line));
  return lines.length ? ["Details", ...lines].join("\n") : "";
}

function extractTextBetweenLabels(html: string, startLabel: string, endLabels: string[]) {
  const text = normalizeTextBlock(html);
  const startMatch = new RegExp(escapeRegExp(startLabel), "i").exec(text);
  if (!startMatch) return "";
  const start = startMatch.index;
  const endCandidates = endLabels
    .map((label) => {
      const match = new RegExp(escapeRegExp(label), "i").exec(text.slice(start + startLabel.length));
      return match ? start + startLabel.length + match.index : -1;
    })
    .filter((index) => index > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : Math.min(text.length, start + 6000);
  return text.slice(start, end).trim();
}

function extractVariantUrls(html: string, baseUrl: URL, title: string) {
  const baseName = extractBaseProductName(title);
  if (!baseName) return [];

  return unique(
    Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi))
      .map((match) => {
        const href = extractHtmlAttribute(match[1], "href");
        const linkText = normalizeTextBlock(match[2]);
        const imageAlt = Array.from(match[2].matchAll(/<img\b([^>]*)>/gi))
          .map((imageMatch) => cleanText(extractHtmlAttribute(imageMatch[1], "alt")))
          .find(Boolean) || "";
        return {
          href,
          title: linkText || imageAlt,
        };
      })
      .filter((item) => item.href && extractBaseProductName(item.title) === baseName)
      .map((item) => resolveUrl(item.href, baseUrl))
      .filter((variantUrl) => normalizeUrl(variantUrl) !== normalizeUrl(baseUrl.toString())),
  );
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
  const images = extractHtmlImages(html);
  const preferredLogo = images.find((image) => image.src.includes("/NOT4NERD/not4nerd_logo"));
  const fallbackLogo = images.find((image) => {
    const src = image.src.toLowerCase();
    const alt = cleanText(image.alt).toLowerCase();
    return src.includes("logo") || alt.includes("logo") || alt.includes("로고");
  });
  return resolveUrl(preferredLogo?.src || fallbackLogo?.src || "", baseUrl);
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
  const decodedSrc = decodeURIComponentSafe(src);
  if (!src) return false;
  if (src.includes("img.echosting.cafe24.com")) return false;
  if (src.includes("btn_") || src.includes("basket") || src.includes("qrcode")) return false;
  if (src.includes("logo") || src.includes("/not4nerd/")) return false;
  if (decodedSrc.includes("저작권") || src.includes("copyright")) return false;
  if (src.includes("/category/editor/")) return false;
  if (src.includes("/web/upload/images/")) return false;
  return src.includes("/web/product/") || /not4nerd\.net\/(?:\d{2}[a-z]{2}|archive)\//i.test(src);
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
  return cleanText(decodeHtmlEntities(value)).replace(/\s*-\s*NOT4NERD\s*$/i, "");
}

function cleanSizeName(value: string) {
  const size = cleanText(value)
    .replace(/\bF\s+REE\b/i, "FREE")
    .replace(/^[\s:|/-]+|[\s:|/-]+$/g, "")
    .toUpperCase();
  const compact = size.replace(/[\s-]+/g, "");
  if (/^(?:F|OS|O\/S|ONE|ONESIZE|ONE\(SIZE\)|OS\(ONESIZE\)|O\/S\(ONESIZE\)|FREE|FREESIZE|FREE\(SIZE\)|FREE\(ONESIZE\))$/.test(compact)) return "FREE";
  return size;
}

function isLikelySizeName(value: string) {
  const size = cleanSizeName(value);
  return Boolean(size) && size.length <= 16 && !/^(SIZE|COLOR|OPTION|SELECT|필수|DETAILS|GUIDE)$/.test(size);
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
  return values.some((stock) => stock === "1" || stock === "2") ? "1" : "0";
}

function normalizeTextBlock(value: unknown) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " / ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .join("\n")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeInvisibleChars(value: string) {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function joinDescriptionBlocks(...blocks: string[]) {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

function decodeHtmlEntities(value: unknown) {
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

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
