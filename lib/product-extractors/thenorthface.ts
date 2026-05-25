import { findBuymaBrand } from "@/lib/buyma/brands";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, getColorSystemId, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type NorthFaceOption = {
  type?: string;
  allowedValues?: Array<{
    id?: number | string;
    value?: string;
    friendlyName?: string;
    displayValue?: string;
  }>;
};
type NorthFaceSku = {
  quantity?: number;
  isSoldOut?: boolean;
  selectedOptions?: Array<number | string>;
};
type MeasurementContext = "top" | "bottom" | "skirt" | "onepiece" | "unknown";
type SizeGuideData = {
  description: string;
  measurements: Record<string, Record<string, string>>;
  labels: string[];
};
type ProductPageData = {
  html: string;
  sourceUrl: string;
  title: string;
  titleKo: string;
  productCode: string;
  price: number;
  colors: string[];
  sizes: string[];
  images: string[];
  optionStockMap: Record<string, StockStatus>;
  stockStatus: StockStatus;
  descriptionKo: string;
  categoryText: string;
  sizeGuide: SizeGuideData;
  variantUrls: string[];
  isWhiteLabel: boolean;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const ASSET_ORIGIN = "https://image.thenorthfacekorea.co.kr";
const NORMAL_LOGO = `${ASSET_ORIGIN}/cmsstatic/theme/3/TNF_logo_black_3.svg`;
const WHITE_LABEL_LOGO = `${ASSET_ORIGIN}/cmsstatic/theme/54/whitelabel_logo_pc.svg`;
const WHITE_LABEL_MODEL_ID = "2222";
const WHITE_LABEL_MODEL_MEMO = "WHITE LABEL(ホワイトレーベル)";
const BRAND_FALLBACK = {
  id: "594",
  name: "THE NORTH FACE",
  displayName: "THE NORTH FACE(ザノースフェイス)",
};

export const thenorthfaceExtractor: ProductExtractor = {
  site: "thenorthfacekorea.co.kr",
  supports: (url) => url.hostname === "thenorthfacekorea.co.kr" || url.hostname === "www.thenorthfacekorea.co.kr",
  extract: extractThenorthfaceProduct,
};

async function extractThenorthfaceProduct(url: URL): Promise<ProductDraft> {
  const main = await extractProductPage(url);
  const variantUrls = main.variantUrls.filter((variantUrl) => normalizeUrl(variantUrl) !== normalizeUrl(url.toString())).slice(0, 12);
  const variantPages = (
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
  const pages = [main, ...variantPages];
  const buymaBrand = findBuymaBrand("THE NORTH FACE");
  const colors = unique(pages.flatMap((page) => page.colors)).filter(Boolean);
  const sizes = unique([
    ...pages.flatMap((page) => page.sizes),
    ...Object.keys(main.sizeGuide.measurements),
  ]).filter(Boolean);
  const images = unique(pages.flatMap((page) => page.images)).slice(0, 50);
  const optionStockMap = mergeStockMaps(pages.map((page) => page.optionStockMap));
  const stockStatus = resolveOverallStockStatus(Object.keys(optionStockMap).length ? optionStockMap : { default: main.stockStatus });
  const context = resolveMeasurementContext(main);
  const sizeMeasurements = context === "unknown" ? {} : main.sizeGuide.measurements;
  const brandLogos = unique([NORMAL_LOGO, WHITE_LABEL_LOGO]);

  if (!main.title && images.length === 0) {
    throw new Error("THE NORTH FACE product information could not be found. Please check the URL.");
  }

  return {
    site: "thenorthfacekorea.co.kr",
    sourceUrl: url.toString(),
    titleKo: main.titleKo || main.title,
    title: main.title,
    titleEn: main.title,
    brand: buymaBrand?.name || BRAND_FALLBACK.name,
    brandDisplayName: buymaBrand?.displayName || BRAND_FALLBACK.displayName,
    brandId: buymaBrand?.id || BRAND_FALLBACK.id,
    price: main.price,
    colors,
    sizes,
    images,
    brandLogo: main.isWhiteLabel ? WHITE_LABEL_LOGO : NORMAL_LOGO,
    brandLogos,
    productCode: main.productCode,
    modelNumber: main.productCode,
    ...(main.isWhiteLabel ? { brandModelNumber2: WHITE_LABEL_MODEL_ID, brandModelMemo2: WHITE_LABEL_MODEL_MEMO } : {}),
    descriptionKo: main.descriptionKo,
    description: "",
    stockStatus,
    optionStockMap,
    colorSystemMap: Object.fromEntries(colors.map((color) => [color, getColorSystemId(color)])),
    ...(Object.keys(sizeMeasurements).length ? { sizeMeasurements } : {}),
    extractedAt: new Date().toISOString(),
  };
}

async function extractProductPage(url: URL): Promise<ProductPageData> {
  const html = await fetchHtml(url.toString());
  const title = extractProductTitle(html);
  const titleKo = extractKoreanProductTitle(html);
  const productCode = extractProductCode(url, html);
  const price = parsePrice(
    extractHtmlAttributeBySelector(html, /<strong\b[^>]*data-price=["']([^"']*)["'][^>]*>/i) ||
      extractMeta(html, "product:price:amount") ||
      extractMeta(html, "og:price:amount"),
  );
  const options = extractJsonAttribute<NorthFaceOption[]>(html, "data-product-options", []);
  const skus = extractJsonAttribute<NorthFaceSku[]>(html, "data-sku-data", []);
  const optionValues = resolveOptionValues(options);
  const colors = unique([...extractOptionColors(optionValues), ...extractSwatchColors(html)].map(normalizeColorName)).filter(Boolean);
  const sizes = unique([...extractOptionSizes(optionValues), ...extractInputSizes(html)]).filter(Boolean);
  const optionStockMap = buildOptionStockMap(skus, optionValues, colors);
  const images = extractProductImages(html, url);
  const productDescription = extractProductDescription(html);
  const categoryText = extractCategoryText(html);
  const sizeGuide = parseSizeGuide(html, `${title} ${titleKo} ${categoryText}`);
  const isWhiteLabel = /화이트라벨|white\s*label/i.test(categoryText + " " + html.match(/uriii=["']([^"']*)["']/i)?.[1]);
  const descriptionKo = joinDescriptionBlocks(productDescription, sizeGuide.description);

  return {
    html,
    sourceUrl: url.toString(),
    title,
    titleKo,
    productCode,
    price,
    colors,
    sizes,
    images,
    optionStockMap,
    stockStatus: resolveOverallStockStatus(optionStockMap),
    descriptionKo,
    categoryText,
    sizeGuide,
    variantUrls: extractVariantUrls(html, url),
    isWhiteLabel,
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
    throw new Error(`THE NORTH FACE page request failed (${response.status}).`);
  }
  return response.text();
}

function resolveOptionValues(options: NorthFaceOption[]) {
  const colors = new Map<string, string>();
  const sizes = new Map<string, string>();

  options.forEach((option) => {
    const target = cleanText(option.type).toUpperCase() === "COLOR" ? colors : cleanText(option.type).toUpperCase() === "SIZE" ? sizes : null;
    if (!target) return;
    option.allowedValues?.forEach((value) => {
      const id = cleanText(value.id);
      const name = cleanText(value.friendlyName) || cleanText(value.displayValue) || cleanText(value.value);
      if (id && name) target.set(id, name);
    });
  });

  return { colors, sizes };
}

function extractOptionColors(optionValues: { colors: Map<string, string> }) {
  return [...optionValues.colors.values()];
}

function extractOptionSizes(optionValues: { sizes: Map<string, string> }) {
  return [...optionValues.sizes.values()].map(cleanSizeName).filter(isLikelySizeName);
}

function buildOptionStockMap(
  skus: NorthFaceSku[],
  optionValues: { colors: Map<string, string>; sizes: Map<string, string> },
  fallbackColors: string[],
) {
  const map: Record<string, StockStatus> = {};

  skus.forEach((sku) => {
    const selected = sku.selectedOptions?.map((value) => cleanText(value)) ?? [];
    const color = normalizeColorName(selected.map((id) => optionValues.colors.get(id)).find(Boolean) || fallbackColors[0] || "");
    const size = cleanSizeName(selected.map((id) => optionValues.sizes.get(id)).find(Boolean) || "");
    const stock: StockStatus = sku.isSoldOut || Number(sku.quantity ?? 0) <= 0 ? "0" : "1";

    if (color && size) {
      map[`${color}|${size.toUpperCase()}`] = stock;
      map[`${color}|${size}`] = stock;
    }
    if (size) map[`|${size.toUpperCase()}`] = stock;
    if (color && !size) map[color] = stock;
  });

  return map;
}

function parseSizeGuide(html: string, contextText: string): SizeGuideData {
  const table = Array.from(html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi))
    .map((match) => match[1])
    .find((value) => /치수항목|실측사이즈|사이즈|SIZE/i.test(stripTags(value)));
  if (!table) return { description: "", measurements: {}, labels: [] };

  const headers = Array.from(table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((match) => normalizeTextBlock(match[1]));
  const rows = Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((rowMatch) =>
      Array.from(rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cellMatch) =>
        normalizeTextBlock(cellMatch[1]),
      ),
    )
    .filter((row) => row.length > 1);
  const sizeHeaders = headers.slice(1).map(cleanSizeName).filter(isLikelySizeName);
  if (!sizeHeaders.length || !rows.length) return { description: "", measurements: {}, labels: [] };

  const rawRows = rows.map((cells) => ({
    label: cleanText(cells[0]),
    values: cells.slice(1).map((value) => cleanText(value)),
  }));
  const context = resolveMeasurementContextFromText(contextText, rawRows.map((row) => row.label));
  const measurements: Record<string, Record<string, string>> = {};
  sizeHeaders.forEach((size, sizeIndex) => {
    const measurementRow: Record<string, string> = {};
    rawRows.forEach((row) => {
      const value = formatMeasurementValue(row.values[sizeIndex]);
      if (!value) return;
      const mapping = normalizeMeasurementLabel(row.label, context);
      if (mapping) measurementRow[mapping] = value;
    });
    if (Object.keys(measurementRow).length) measurements[size] = measurementRow;
  });

  const lines = ["사이즈 가이드"];
  sizeHeaders.forEach((size, sizeIndex) => {
    lines.push(size);
    rawRows.forEach((row) => {
      const value = formatSizeGuideDescriptionValue(row.values[sizeIndex]);
      if (row.label && value) lines.push(`${row.label} ${value}`);
    });
  });

  return {
    description: lines.length > 1 ? lines.join("\n") : "",
    measurements,
    labels: rawRows.map((row) => row.label),
  };
}

function resolveMeasurementContext(page: ProductPageData): MeasurementContext {
  return resolveMeasurementContextFromText(
    `${page.title} ${page.titleKo} ${page.categoryText}`,
    page.sizeGuide.labels,
  );
}

function resolveMeasurementContextFromText(value: string, labels: string[]): MeasurementContext {
  const text = cleanText(value).toLowerCase();
  const specificText = text.replace(/스커트\s*\/\s*원피스/gi, " ");
  const labelText = labels.join(" ");
  if (/원피스|드레스|one\s*piece|dress/i.test(specificText)) return "onepiece";
  if (/스커트|치마|skirt/i.test(specificText)) return "skirt";
  if (/스커트\s*\/\s*원피스/i.test(text)) {
    if (/어깨|가슴|소매/.test(labelText)) return "onepiece";
    return "skirt";
  }
  if (/어깨|가슴|소매/.test(labelText) || /상의|자켓|조끼|티셔츠|후디|셔츠|아노락|맨투맨|jacket|vest|tee|shirt|hoodie|anorak/i.test(text)) {
    return "top";
  }
  if (/허리|엉덩이|힙|밑위|밑아래|인심|허벅지/.test(labelText) || /하의|팬츠|바지|쇼츠|반바지|레깅스|pants|shorts|leggings/i.test(text)) {
    return "bottom";
  }
  return "unknown";
}

function normalizeMeasurementLabel(labelValue: string, context: MeasurementContext) {
  const label = cleanText(labelValue).replace(/\s+/g, "").toLowerCase();
  const isLength = ["총장", "총기장", "총길이", "총길이cm", "기장", "길이", "총길이(cm)", "length"].includes(label);

  if (context === "skirt") {
    if (["허리", "허리둘레", "허리단면", "waist"].includes(label)) return "ウエスト";
    if (["엉덩이", "엉덩이둘레", "힙", "힙둘레", "hip", "hips"].includes(label)) return "ヒップ";
    if (isLength || ["스커트장", "스커트길이", "치마기장", "치마길이"].includes(label)) return "スカート丈";
    return "";
  }

  if (context === "bottom") {
    if (["허리", "허리둘레", "허리단면", "waist"].includes(label)) return "ウエスト";
    if (["엉덩이", "엉덩이둘레", "힙", "힙둘레", "hip", "hips"].includes(label)) return "ヒップ";
    if (["앞밑위", "밑위", "rise", "frontrise"].includes(label)) return "股上";
    if (["밑아래", "인심", "inseam"].includes(label)) return "股下";
    if (["허벅지", "허벅지둘레", "허벅지단면", "thigh"].includes(label)) return "もも周り";
    if (["밑단", "밑단둘레", "밑단단면", "hem"].includes(label)) return "すそ周り";
    return "";
  }

  if (context === "top" || context === "onepiece") {
    if (isLength) return "着丈";
    if (["어깨", "어깨너비", "어깨단면", "shoulder", "shoulderwidth"].includes(label)) return "肩幅";
    if (["가슴", "가슴둘레", "chest", "bust"].includes(label)) return "胸囲";
    if (["소매", "소매길이", "sleeve", "sleevelength"].includes(label)) return "袖丈";
  }

  if (context === "onepiece") {
    if (["허리", "허리둘레", "허리단면", "waist"].includes(label)) return "ウエスト";
    if (["엉덩이", "엉덩이둘레", "힙", "힙둘레", "hip", "hips"].includes(label)) return "ヒップ";
  }

  return "";
}

function extractProductTitle(html: string) {
  return (
    decodeHtmlEntities(html.match(/<(?:h1|p)\b[^>]*class=["'][^"']*product-name[^"']*["'][^>]*data-name=["']([^"']*)["']/i)?.[1]) ||
    normalizeTextBlock(html.match(/<h1\b[^>]*class=["'][^"']*product-name[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]) ||
    cleanPageTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  );
}

function extractKoreanProductTitle(html: string) {
  return decodeHtmlEntities(html.match(/data-kor-name=["']([^"']*)["']/i)?.[1]) || "";
}

function extractProductCode(url: URL, html: string) {
  return (
    cleanText(html.match(/data-model=["']([^"']+)["']/i)?.[1]) ||
    cleanText(html.match(/model\s*:\s*['"]([^'"]+)['"]/i)?.[1]) ||
    cleanText(html.match(/privateId\s*:\s*([^,\s}]+)/i)?.[1]) ||
    cleanText(url.pathname.split("/").filter(Boolean).at(-1))
  );
}

function extractProductDescription(html: string) {
  const section = html.match(/<div\b[^>]*id=["']product-info["'][^>]*>([\s\S]*?)<div\b[^>]*id=["']product-review["']/i)?.[1] || "";
  const desktop = section.match(/<div\b[^>]*class=["'][^"']*display-small-up[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || section;
  return normalizeTextBlock(desktop);
}

function extractCategoryText(html: string) {
  const moduleProduct = decodeHtmlEntities(html.match(/data-module-product=["']([^"']*)["']/i)?.[1] || "");
  const productInfo = Array.from(html.matchAll(/\b(cate[LSM]Nm)\s*:\s*'([^']*)'/gi)).map((match) => match[2]);
  const breadcrumbs = Array.from(html.matchAll(/class=["'][^"']*breadcrumb-element[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)).map((match) =>
    normalizeTextBlock(match[1]),
  );
  return cleanText([moduleProduct, ...productInfo, ...breadcrumbs].join(" "));
}

function extractProductImages(html: string, baseUrl: URL) {
  const candidates = [
    extractMeta(html, "og:image"),
    ...Array.from(html.matchAll(/\bdata-product-image=["']([^"']+)["']/gi)).map((match) => match[1]),
    ...Array.from(html.matchAll(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["'][^>]*>/gi)).map((match) => match[1]),
  ];
  return unique(candidates.map((src) => resolveAssetUrl(src, baseUrl)).filter(isProductImageUrl)).slice(0, 25);
}

function extractVariantUrls(html: string, baseUrl: URL) {
  const blocks = Array.from(html.matchAll(/<div\b[^>]*class=["'][^"']*variation-color[^"']*["'][^>]*>[\s\S]*?<\/div>/gi)).map((match) => match[0]);
  return unique(
    blocks
      .map((block) => extractHtmlAttribute(block, "href"))
      .filter((href) => href && !/^javascript:/i.test(href))
      .map((href) => resolveUrl(href, baseUrl)),
  );
}

function extractSwatchColors(html: string) {
  return Array.from(html.matchAll(/\bdata-color=["']([^"']+)["']/gi)).map((match) => match[1]);
}

function extractInputSizes(html: string) {
  return Array.from(html.matchAll(/\bdata-attributename=["']size["'][^>]*data-friendly-name=["']([^"']+)["']/gi)).map((match) =>
    cleanSizeName(decodeHtmlEntities(match[1])),
  );
}

function extractJsonAttribute<T>(html: string, attr: string, fallback: T): T {
  const match = html.match(new RegExp(`${escapeRegExp(attr)}=["']([\\s\\S]*?)["']`, "i"));
  if (!match) return fallback;
  try {
    return JSON.parse(decodeHtmlEntities(match[1])) as T;
  } catch {
    return fallback;
  }
}

function resolveAssetUrl(value: string, baseUrl: URL) {
  const resolved = resolveUrl(value, baseUrl).replace(/\?(browse|thumbnail)=?$/i, "");
  try {
    const url = new URL(resolved);
    if (url.pathname.startsWith("/cmsstatic/")) {
      return `${ASSET_ORIGIN}${url.pathname}`;
    }
    return url.toString();
  } catch {
    return resolved;
  }
}

function resolveUrl(value: string, baseUrl: URL) {
  const src = cleanText(decodeHtmlEntities(value));
  if (!src) return "";
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/cmsstatic/")) return `${ASSET_ORIGIN}${src}`;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return src;
  }
}

function isProductImageUrl(value: string) {
  const src = value.toLowerCase();
  if (!src) return false;
  if (src.includes("qrcode") || src.includes("icon") || src.includes("logo")) return false;
  return src.includes("/cmsstatic/product/");
}

function normalizeColorName(value: string) {
  return convertColorToEnglish(cleanText(decodeHtmlEntities(value)).replace(/\s+/g, "_"));
}

function cleanSizeName(value: string) {
  const size = cleanText(decodeHtmlEntities(value)).toUpperCase().replace(/\s+/g, "");
  if (/^(?:OS|O\/S|ONE|ONESIZE|ONE\(SIZE\)|OS\(ONESIZE\)|O\/S\(ONESIZE\)|FREE|FREESIZE|FREE\(SIZE\)|FREE\(ONESIZE\))$/.test(size)) return "FREE";
  return size;
}

function isLikelySizeName(value: string) {
  const text = cleanText(value);
  if (!text) return false;
  if (text.length > 30) return false;
  return /^(?:FREE|ONE|ONE\s*SIZE|OS|XS|S|M|L|XL|XXL|XXXL|\d{2,3}(?:\([A-Z0-9]+\))?|\d+(?:\.\d+)?[A-Z]*)$/i.test(text);
}

function formatSizeGuideDescriptionValue(value: string) {
  const text = formatMeasurementValue(value);
  if (!text || /cm$/i.test(text)) return text;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return `${text}cm`;
  return text;
}

function formatMeasurementValue(value: string) {
  const text = cleanText(value).replace(/cm$/i, "");
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return cleanText(value);
  return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(1)));
}

function resolveOverallStockStatus(optionStockMap: Record<string, StockStatus>): StockStatus {
  const values = Object.values(optionStockMap);
  if (!values.length) return "1";
  return values.some((value) => value === "1") ? "1" : "0";
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

function extractMeta(html: string, name: string) {
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1]);
  }
  return "";
}

function extractHtmlAttributeBySelector(html: string, pattern: RegExp) {
  return decodeHtmlEntities(html.match(pattern)?.[1] || "");
}

function extractHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : "";
}

function cleanPageTitle(value: unknown) {
  return cleanText(decodeHtmlEntities(value)).replace(/\s*-\s*노스페이스.*$/i, "");
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

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
