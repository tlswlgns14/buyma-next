import { findBuymaBrand } from "@/lib/buyma/brands";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type AderApiResponse = Record<string, unknown>;
type AderProductData = Record<string, unknown>;
type AderSizeGuide = Record<string, unknown>;
type AderTranslation = Record<string, unknown>;
type AderColorProduct = {
  api: AderApiResponse;
  data: AderProductData;
  sizeGuide: AderSizeGuide;
  color: string;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const ADER_CDN = "https://d31flwjaqugbgy.cloudfront.net/s3-cloud-bucket-ader-user";
const ADER_LOGO = "https://d31flwjaqugbgy.cloudfront.net/common/ader_logo.svg";

export const adererrorExtractor: ProductExtractor = {
  site: "adererror.com",
  supports: (url) => url.hostname === "adererror.com" || url.hostname.endsWith(".adererror.com"),
  extract: extractAdererrorProduct,
};

async function extractAdererrorProduct(url: URL): Promise<ProductDraft> {
  const productId = extractProductId(url);
  if (!productId) throw new Error("ADERERROR 상품 번호를 찾지 못했습니다. URL을 확인해주세요.");

  const headerIdx = url.searchParams.get("header_idx") || "";
  const api = await fetchAderProduct(productId, headerIdx, url.toString());
  const colorProducts = await fetchAderColorProducts(api, productId, headerIdx, url);
  const data = asRecord(api.data) ?? {};
  const sizeGuide = asRecord(asArray(api.sizeguide)[0]) ?? {};
  const translations = parseTranslations(data.translation_by_country);
  const kr = asRecord(translations.KR) ?? {};
  const buymaBrand = findBuymaBrand("ADERERROR");
  const title = cleanText(kr.NAME) || cleanText(data.product_name);
  const colors = unique(colorProducts.map((product) => product.color));
  const sizes = unique(colorProducts.flatMap((product) => extractSizes(product.data)));
  const optionStockMap = buildOptionStockMap(colorProducts);
  const sizeMeasurements = parseSizeGuideMeasurements(sizeGuide);
  const price = parsePrice(kr.SALES_PRICE || kr.PRICE || data.sales_price || data.price);
  const images = unique(colorProducts.flatMap((product) => extractImages(product.data))).slice(0, 20);
  const descriptionKo = buildDescription(data, kr, sizeGuide);
  const productCode = cleanText(data.product_idx) || productId;
  const modelNumber = cleanText(data.product_code);

  if (!title && images.length === 0) {
    throw new Error("ADERERROR 상품 정보를 찾지 못했습니다. URL을 확인해주세요.");
  }

  return {
    site: "adererror.com",
    sourceUrl: url.toString(),
    titleKo: title,
    title,
    titleEn: title,
    brand: buymaBrand?.name || "ADERERROR",
    brandDisplayName: buymaBrand?.displayName || "ADERERROR",
    brandId: buymaBrand?.id || "6815",
    brandLogo: ADER_LOGO,
    price,
    colors,
    sizes: unique([...sizes, ...Object.keys(sizeMeasurements)]),
    images,
    productCode,
    modelNumber,
    descriptionKo,
    description: "",
    stockStatus: resolveOverallStockStatus(optionStockMap, cleanText(data.stock_status)),
    optionStockMap,
    ...(Object.keys(sizeMeasurements).length ? { sizeMeasurements } : {}),
    extractedAt: new Date().toISOString(),
  };
}

async function fetchAderProduct(productId: string, headerIdx: string, referer: string): Promise<AderApiResponse> {
  const body = new URLSearchParams({ product_idx: productId });
  if (headerIdx) body.set("header_idx", headerIdx);

  const response = await fetch("https://adererror.com/_api/goods/detail/get", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
      country: "KR",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`ADERERROR API request failed (${response.status}).`);
  }

  const json = (await response.json()) as AderApiResponse;
  if (Number(json.code) !== 200) {
    throw new Error(cleanText(json.msg) || "ADERERROR API 응답이 올바르지 않습니다.");
  }

  return json;
}

async function fetchAderColorProducts(
  currentApi: AderApiResponse,
  productId: string,
  headerIdx: string,
  sourceUrl: URL,
): Promise<AderColorProduct[]> {
  const currentData = asRecord(currentApi.data) ?? {};
  const currentProductId = cleanText(currentData.product_idx) || productId;
  const variantIds = extractColorProductIds(currentData);
  const productIds = unique([currentProductId, ...variantIds.filter((id) => id !== currentProductId)]);
  const apis = await Promise.all(
    productIds.map(async (id) => {
      if (id === currentProductId) return currentApi;
      try {
        return await fetchAderProduct(id, headerIdx, buildAderReferer(sourceUrl, id));
      } catch {
        return null;
      }
    }),
  );

  const products = apis
    .filter((api): api is AderApiResponse => Boolean(api))
    .map((api) => {
      const data = asRecord(api.data) ?? {};
      return {
        api,
        data,
        sizeGuide: asRecord(asArray(api.sizeguide)[0]) ?? {},
        color: normalizeAderColor(data.color),
      };
    })
    .filter((product) => Object.keys(product.data).length > 0);

  if (products.length) return products;
  return [{
    api: currentApi,
    data: currentData,
    sizeGuide: asRecord(asArray(currentApi.sizeguide)[0]) ?? {},
    color: normalizeAderColor(currentData.color),
  }];
}

function normalizeAderColor(value: unknown) {
  const color = convertColorToEnglish(cleanText(value));
  if (color === "NOIR") return "BLACK";
  return color;
}

function extractColorProductIds(data: AderProductData) {
  return unique(
    asArray(data.product_color)
      .map(asRecord)
      .filter(isRecord)
      .map((color) => cleanText(color.product_idx)),
  );
}

function buildAderReferer(sourceUrl: URL, productId: string) {
  const referer = new URL(sourceUrl.toString());
  referer.pathname = `/kr/shop/${productId}`;
  return referer.toString();
}

function extractProductId(url: URL) {
  const pathId = url.pathname.match(/\/shop\/(\d+)/)?.[1];
  return cleanText(pathId || url.searchParams.get("product_idx"));
}

function parseTranslations(value: unknown): Record<string, AderTranslation> {
  const text = cleanText(value);
  if (!text) return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    const record = asRecord(parsed);
    if (!record) return {};

    return Object.fromEntries(
      Object.entries(record).flatMap(([country, translation]) => {
        const translationRecord = asRecord(translation);
        return translationRecord ? [[country, translationRecord]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function extractSizes(data: AderProductData) {
  return unique(
    asArray(data.product_size)
      .map(asRecord)
      .filter(isRecord)
      .map((size) => cleanSizeName(size.option_name))
      .filter(isLikelySizeName),
  );
}

function buildOptionStockMap(products: AderColorProduct[]) {
  const map: Record<string, StockStatus> = {};
  const colors = unique(products.map((product) => product.color));
  const sizes = unique(products.flatMap((product) => extractSizes(product.data)));
  const hasMultipleColors = colors.length > 1;

  products.forEach((product) => {
    const color = product.color;
    const productSizes = new Set<string>();

    asArray(product.data.product_size)
      .map(asRecord)
      .filter(isRecord)
      .forEach((option) => {
        const size = cleanSizeName(option.option_name);
        if (!isLikelySizeName(size)) return;

        productSizes.add(size);
        const stock = getStockStatus(option.stock_status);
        if (!hasMultipleColors) map[`|${size.toUpperCase()}`] = stock;
        if (!color) return;
        map[`${color}|${size.toUpperCase()}`] = stock;
        map[`${color}|${size}`] = stock;
      });

    if (!color) return;
    const colorStock = resolveOverallStockStatusForValues([...productSizes].map((size) => map[`${color}|${size.toUpperCase()}`]));
    if (colorStock) map[color] = colorStock;
    sizes
      .filter((size) => !productSizes.has(size))
      .forEach((size) => {
        map[`${color}|${size.toUpperCase()}`] = "0";
        map[`${color}|${size}`] = "0";
      });
  });

  return map;
}

function getStockStatus(value: unknown): StockStatus {
  const status = cleanText(value).toUpperCase();
  if (status === "STSO" || status === "STSC") return "0";
  return "1";
}

function resolveOverallStockStatus(optionStockMap: Record<string, StockStatus>, stockStatus: string): StockStatus {
  const values = Object.values(optionStockMap);
  if (values.length) return values.some((stock) => stock === "1") ? "1" : "0";
  return getStockStatus(stockStatus);
}

function resolveOverallStockStatusForValues(values: Array<StockStatus | undefined>): StockStatus | "" {
  const stocks = values.filter((value): value is StockStatus => value === "0" || value === "1");
  if (!stocks.length) return "";
  return stocks.some((stock) => stock === "1") ? "1" : "0";
}

function extractImages(data: AderProductData) {
  return unique(
    asArray(data.img_main)
      .map(asRecord)
      .filter(isRecord)
      .map((image) => resolveImageUrl(cleanText(image.img_url) || cleanText(image.img_location)))
      .filter(Boolean),
  ).slice(0, 20);
}

function resolveImageUrl(value: string) {
  const src = value.replace(/\\\//g, "/").trim();
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${ADER_CDN}${src}`;
  return `${ADER_CDN}/${src}`;
}

function buildDescription(data: AderProductData, kr: AderTranslation, sizeGuide: AderSizeGuide) {
  return joinBlocks(
    buildSizeGuideDescription(sizeGuide),
    buildLabeledBlock("소재 정보", normalizeTextBlock(kr.MATERIAL)),
    buildLabeledBlock("제품 정보", joinBlocks(cleanText(data.product_code), normalizeTextBlock(kr.DETAIL))),
    buildLabeledBlock("취급안내", joinBlocks(normalizeTextBlock(kr.CARE), normalizeTextBlock(kr.OLD_CARE))),
  );
}

function buildSizeGuideDescription(sizeGuide: AderSizeGuide) {
  const dimensions = asRecord(sizeGuide.dimensions);
  const optionSizeText = normalizeTextBlock(sizeGuide.option_size_txt);
  if (!dimensions) {
    return buildLabeledBlock(
      "사이즈 가이드",
      joinBlocks(normalizeTextBlock(sizeGuide.size_guide_top), optionSizeText),
    );
  }

  const lines = [normalizeTextBlock(sizeGuide.size_guide_top), "사이즈 가이드"].filter(Boolean);
  if (optionSizeText) lines.push(optionSizeText);
  Object.entries(dimensions).forEach(([size, rawItems]) => {
    const items = asArray(rawItems).map(asRecord).filter(isRecord);
    if (!items.length) return;

    lines.push(`${cleanSizeName(size)} SIZE`);
    items.forEach((item) => {
      const title = cleanText(item.title);
      const value = formatMeasurementWithUnit(item.value);
      if (title && value) lines.push(`${title} ${value}`);
    });
  });

  const bottom = normalizeTextBlock(sizeGuide.size_guide_bottom);
  if (bottom) lines.push(bottom);
  return lines.join("\n");
}

function parseSizeGuideMeasurements(sizeGuide: AderSizeGuide) {
  const dimensions = asRecord(sizeGuide.dimensions);
  if (!dimensions) return parseOptionSizeTextMeasurements(sizeGuide.option_size_txt);

  const measurements: Record<string, Record<string, string>> = {};
  Object.entries(dimensions).forEach(([size, rawItems]) => {
    const sizeName = cleanSizeName(size);
    if (!isLikelySizeName(sizeName)) return;

    const row: Record<string, string> = {};
    asArray(rawItems)
      .map(asRecord)
      .filter(isRecord)
      .forEach((item) => {
        const mapping = normalizeMeasurementKey(cleanText(item.title));
        if (!mapping) return;

        const value = formatMeasurementValue(item.value, mapping.multiplier);
        if (value) row[mapping.key] = value;
      });

    if (Object.keys(row).length) measurements[sizeName] = row;
  });

  return measurements;
}

function parseOptionSizeTextMeasurements(value: unknown) {
  const lines = normalizeTextBlock(value).split("\n").map(cleanText).filter(Boolean);
  if (lines.length < 2) return {};

  const size = cleanSizeName(lines[0]);
  if (!isLikelySizeName(size)) return {};

  const row: Record<string, string> = {};
  lines.slice(1).forEach((line) => {
    const match = line.match(/^(.+?)\s*(-?\d+(?:\.\d+)?)\s*(?:cm|mm)?$/i);
    if (!match) return;

    const mapping = normalizeMeasurementKey(match[1]);
    if (!mapping) return;

    const measurementValue = formatMeasurementValue(match[2], mapping.multiplier);
    if (measurementValue) row[mapping.key] = measurementValue;
  });

  return Object.keys(row).length ? { [size]: row } : {};
}

function normalizeMeasurementKey(value: string): { key: string; multiplier?: number } | null {
  const key = cleanText(value).replace(/\s+/g, "").toLowerCase();
  if (!key) return null;

  if (["너비", "가로", "width"].includes(key)) return { key: "幅" };
  if (["높이", "세로", "height"].includes(key)) return { key: "高さ" };
  if (["폭", "깊이", "마치", "depth", "widthdepth"].includes(key)) return { key: "マチ" };
  if (["핸들", "핸들높이", "손잡이", "손잡이높이", "handle", "handleheight"].includes(key)) return { key: "持ち手" };
  if (["총장", "총기장", "총길이", "기장", "옷길이", "length"].includes(key)) return { key: "length" };
  if (["가슴단면", "가슴너비", "가슴폭", "품", "chestwidth", "pit-to-pit"].includes(key)) return { key: "chest", multiplier: 2 };
  if (["가슴둘레", "가슴", "chest", "bust"].includes(key)) return { key: "chest" };
  if (["어깨너비", "어깨넓이", "어깨단면", "어깨", "shoulder", "shoulderwidth"].includes(key)) return { key: "shoulder" };
  if (["소매장", "소매길이", "소매기장", "소매", "sleeve", "sleevelength"].includes(key)) return { key: "sleevelength" };
  if (["허리단면", "허리너비", "허리폭", "허리둘레", "허리", "waist", "waistwidth"].includes(key)) return { key: "waist" };
  if (["엉덩이단면", "엉덩이너비", "엉덩이폭", "엉덩이둘레", "엉덩이", "힙", "힙단면", "hip", "hips"].includes(key)) return { key: "hips" };
  if (["밑위", "앞밑위", "rise", "riselength", "frontrise", "crotch"].includes(key)) return { key: "rise" };
  if (["밑아래", "밑아래길이", "인심", "inseam"].includes(key)) return { key: "inseam" };
  if (["허벅지단면", "허벅지너비", "허벅지폭", "허벅지둘레", "허벅지", "thigh", "thighwidth", "tight"].includes(key)) return { key: "thighwidth" };
  if (["밑단", "밑단단면", "밑단너비", "밑단폭", "hem", "hemwidth", "bottomwidth", "legopening"].includes(key)) return { key: "hemwidth" };
  if (["스커트장", "스커트길이", "스커트丈", "skirtlength"].includes(key)) return { key: "length" };
  return null;
}

function formatMeasurementValue(value: unknown, multiplier = 1) {
  const numeric = Number(cleanText(value).replace(/cm$/i, ""));
  if (!Number.isFinite(numeric)) return "";
  const result = numeric * multiplier;
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(1)));
}

function formatMeasurementWithUnit(value: unknown) {
  const text = cleanText(value);
  if (!text) return "";
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text}cm` : text;
}

function buildLabeledBlock(label: string, content: string) {
  const text = cleanText(content);
  return text ? `${label}\n${content.trim()}` : "";
}

function normalizeTextBlock(value: unknown) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinBlocks(...blocks: string[]) {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

function cleanSizeName(value: unknown) {
  const size = cleanText(value).toUpperCase().replace(/\s+/g, " ");
  if (/^(?:OS|O\/S|ONE|ONE SIZE|ONESIZE|FREE SIZE|FREE-SIZE)$/.test(size)) return "FREE";
  return size;
}

function isLikelySizeName(value: unknown) {
  const size = cleanSizeName(value);
  return Boolean(size) && size.length <= 16 && !/^(SIZE|COLOR|OPTION|SELECT)$/.test(size);
}

function decodeHtmlEntities(value: string) {
  return value
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

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return Boolean(value);
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}
