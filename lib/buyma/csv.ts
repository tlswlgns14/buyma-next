import { MEASUREMENT_HEADERS } from "./data";
import { BUYMA_SIZES, BUYMA_SIZE_DETAILS } from "./id-data";
import { findBuymaBrand } from "./brands";
import { getJapaneseBrandDescription } from "./brand-descriptions";
import type { BuymaDescriptionPlacement, BuymaSettings, ColorSizeRow, CsvBundle, ProductDraft, StockStatus } from "./types";
import {
  calculateSellingPrice,
  cleanText,
  convertColorToEnglish,
  extractBrand,
  getColorSystemId,
  makeSku,
  normalizeStockStatus,
  sanitizeForCsv,
  splitListInput,
  truncateByByteLength,
} from "./text";

const DEFAULT_KOREA_AREA_CODE = "2002003";
const DEFAULT_SEOUL_CITY_CODE = "001";
const DEFAULT_SHIPPING_METHOD_ID = "1064891";
const DEFAULT_SHOP_NAME = "公式オンラインショップ";
const SHIPPING_METHOD_IDS = new Set(["1064891", "1072560"]);

const ITEMS_HEADERS = [
  "商品ID",
  "商品管理番号",
  "コントロール",
  "公開ステータス",
  "商品名",
  "ブランド",
  "ブランド名",
  "モデル",
  "カテゴリ",
  "シーズン",
  "テーマ",
  "単価",
  "買付可数量",
  "購入期限",
  "参考価格/通常出品価格",
  "参考価格",
  "商品コメント",
  "色サイズ補足",
  "タグ",
  "配送方法",
  "買付エリア",
  "買付都市",
  "買付ショップ",
  "発送エリア",
  "発送都市",
  "関税込み",
  "出品メモ",
  ...Array.from({ length: 20 }, (_, index) => `商品イメージ${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => [
    `ブランド型番${index + 1}`,
    `ブランド型番識別メモ${index + 1}`,
  ]).flat(),
  ...Array.from({ length: 15 }, (_, index) => [
    `買付先名${index + 1}`,
    `買付先URL${index + 1}`,
    `買付先説明${index + 1}`,
  ]).flat(),
];

const ITEM_DESCRIPTION_COLUMN_INDEX = ITEMS_HEADERS.indexOf("商品コメント");

const COLOR_SIZE_MEASUREMENT_HEADERS = [
  "着丈",
  "肩幅",
  "胸囲",
  "袖丈",
  "ウエスト",
  "ヒップ",
  "総丈",
  "幅",
  "股上",
  "股下",
  "もも周り",
  "すそ周り",
  "スカート丈",
  "トップ",
  "アンダー",
  "高さ",
  "ヒール高",
  "つつ周り",
  "足幅",
  "マチ",
  "持ち手",
  "ストラップ",
  "奥行",
  "縦",
  "横",
  "厚み",
  "長さ",
  "トップ縦",
  "トップ横",
  "円周",
  "手首周り",
  "文字盤縦",
  "文字盤横",
  "フレーム縦",
  "フレーム横",
  "レンズ縦",
  "レンズ横",
  "テンプル",
  "全長",
  "最大幅",
  "頭周り",
  "つば",
  "直径",
];

const MEASUREMENT_HEADERS_BY_CATEGORY = BUYMA_SIZE_DETAILS.reduce((map, detail) => {
  if (!isSupportedMeasurementGroup(detail.groupName)) return map;
  const categoryId = cleanText(detail.categoryId);
  const name = cleanText(detail.name);
  if (!categoryId || !name) return map;
  const headers = map.get(categoryId) ?? new Set<string>();
  headers.add(name);
  map.set(categoryId, headers);
  return map;
}, new Map<string, Set<string>>());

const SKIRT_LENGTH_HEADERS = new Set(["スカート丈"]);

const COLORSIZES_HEADERS = [
  "商品ID",
  "商品管理番号",
  "商品名",
  "並び順",
  "サイズ名称",
  "サイズ単位",
  "検索用サイズ",
  "色名称",
  "色系統",
  "在庫ステータス",
  "手元に在庫あり数量",
  "色サイズリプレイス",
  ...COLOR_SIZE_MEASUREMENT_HEADERS,
];

export function generateBuymaCsvBundle(
  products: ProductDraft[],
  settings: BuymaSettings,
): CsvBundle {
  return {
    itemsCsv: generateItemsCsv(products, settings),
    colorSizesCsv: generateColorSizesCsv(products, settings),
  };
}

export function generateItemsCsv(products: ProductDraft[], settings: BuymaSettings) {
  const rows = products.map((product, index) => {
    const sku = resolveSku(product, index);
    const title = truncateBuymaTitle(normalizeBuymaTitle(product, settings.productTitlePrefix));
    const sellingPrice = resolveSellingPrice(product, settings);
    const description = buildDescription(product, settings.productDescriptionPrefix, settings.productDescriptionPlacement);
    const imageSlots = getImageSlots(product, index);
    const brandInfo = findBuymaBrand(product.brand || product.brandDisplayName || title);
    const brandId = product.brandId ? product.brandId : brandInfo?.id || "0";
    const brandName = product.brand || product.brandDisplayName || brandInfo?.displayName || "";
    const purchaseQuantity = product.purchaseQuantity || "100";
    const referencePrice = Math.round(product.referencePrice ?? settings.defaultReferencePrice ?? 0);

    return [
      product.buymaProductId || "",
      sku,
      product.control || "下書き",
      product.publicStatus || "下書き",
      title,
      brandId,
      brandName,
      "",
      resolveCategory(product.category),
      product.season || "",
      product.theme || "184",
      sellingPrice,
      purchaseQuantity,
      product.purchaseDeadline || getPurchaseDeadline(product.extractedAt),
      referencePrice,
      referencePrice,
      truncateByByteLength(description, 3000),
      "",
      "",
      resolveShippingMethod(product.shippingMethod, settings),
      resolveAreaCode(product.purchaseArea),
      resolveCityCode(product.purchaseCity),
      product.purchaseShop || DEFAULT_SHOP_NAME,
      resolveAreaCode(product.shippingArea),
      resolveCityCode(product.shippingCity),
      product.taxIncluded || "1",
      product.listingMemo || "",
      ...imageSlots,
      product.modelNumber || product.productCode || "",
      product.brandModelMemo1 || "",
      product.brandModelNumber2 || "",
      product.brandModelMemo2 || "",
      product.brandModelNumber3 || "",
      product.brandModelMemo3 || "",
      product.brandModelNumber4 || "",
      product.brandModelMemo4 || "",
      product.brandModelNumber5 || "",
      product.brandModelMemo5 || "",
      product.brandModelNumber6 || "",
      product.brandModelMemo6 || "",
      product.brandModelNumber7 || "",
      product.brandModelMemo7 || "",
      product.brandModelNumber8 || "",
      product.brandModelMemo8 || "",
      product.brandModelNumber9 || "",
      product.brandModelMemo9 || "",
      product.brandModelNumber10 || "",
      product.brandModelMemo10 || "",
      product.purchaseName1 || product.purchaseShop || DEFAULT_SHOP_NAME,
      product.purchaseUrl1 || product.sourceUrl || "",
      product.purchaseSourceDescription1 || "",
      product.purchaseName2 || "",
      product.purchaseUrl2 || "",
      product.purchaseSourceDescription2 || "",
      product.purchaseName3 || "",
      product.purchaseUrl3 || "",
      product.purchaseSourceDescription3 || "",
      product.purchaseName4 || "",
      product.purchaseUrl4 || "",
      product.purchaseSourceDescription4 || "",
      product.purchaseName5 || "",
      product.purchaseUrl5 || "",
      product.purchaseSourceDescription5 || "",
      product.purchaseName6 || "",
      product.purchaseUrl6 || "",
      product.purchaseSourceDescription6 || "",
      product.purchaseName7 || "",
      product.purchaseUrl7 || "",
      product.purchaseSourceDescription7 || "",
      product.purchaseName8 || "",
      product.purchaseUrl8 || "",
      product.purchaseSourceDescription8 || "",
      product.purchaseName9 || "",
      product.purchaseUrl9 || "",
      product.purchaseSourceDescription9 || "",
      product.purchaseName10 || "",
      product.purchaseUrl10 || "",
      product.purchaseSourceDescription10 || "",
      product.purchaseName11 || "",
      product.purchaseUrl11 || "",
      product.purchaseSourceDescription11 || "",
      product.purchaseName12 || "",
      product.purchaseUrl12 || "",
      product.purchaseSourceDescription12 || "",
      product.purchaseName13 || "",
      product.purchaseUrl13 || "",
      product.purchaseSourceDescription13 || "",
      product.purchaseName14 || "",
      product.purchaseUrl14 || "",
      product.purchaseSourceDescription14 || "",
      product.purchaseName15 || "",
      product.purchaseUrl15 || "",
      product.purchaseSourceDescription15 || "",
    ];
  });

  return toCsv([ITEMS_HEADERS, ...rows], new Set([ITEM_DESCRIPTION_COLUMN_INDEX]));
}

export function generateColorSizesCsv(products: ProductDraft[], settings: BuymaSettings) {
  const customColors = splitListInput(settings.customColors);
  const customSizes = splitListInput(settings.customSizes);
  const rows: Array<Array<string | number>> = [];

  products.forEach((product, index) => {
    const sku = resolveSku(product, index);
    const title = truncateBuymaTitle(normalizeBuymaTitle(product, settings.productTitlePrefix));
    const tableRows = getColorSizeRows(product, customColors, customSizes);
    const colorSortMap = new Map<string, number>();

    tableRows.forEach((row) => {
      const normalizedStock = normalizeStockStatus(row.stock);
      const colorName = convertColorToEnglish(row.color);
      const colorSystemId = row.colorSystemId || getColorSystemId(row.color) || product.colorSystemId || "";
      const onHandQuantity = normalizedStock === "2" ? "1" : "0";
      const sortOrder = colorSortMap.get(colorName) ?? 1;
      colorSortMap.set(colorName, sortOrder + 1);

      const sizeLabel = cleanText(row.size).toUpperCase() || "FREE";
      const searchSizeId = row.sizeTypeId || resolveSizeTypeId(product.category, row.size) || "0";

      rows.push([
        product.buymaProductId || "",
        sku,
        title,
        sortOrder,
        sizeLabel,
        "",
        searchSizeId,
        colorName,
        colorSystemId,
        normalizedStock,
        onHandQuantity,
        "",
        ...getMeasurementValues(product, row.size),
      ]);
    });
  });

  return toCsv([COLORSIZES_HEADERS, ...rows]);
}

function resolveSellingPrice(product: ProductDraft, settings: BuymaSettings) {
  return (
    product.sellingPrice ||
    calculateSellingPrice(product.price, settings.marginRate, settings.exchangeRate)
  );
}

function resolveAreaCode(value: unknown) {
  const text = cleanText(value);
  if (!text || text === "韓国" || text === DEFAULT_SHIPPING_METHOD_ID) return DEFAULT_KOREA_AREA_CODE;
  return text;
}

function resolveCityCode(value: unknown) {
  const text = cleanText(value);
  if (!text || text === DEFAULT_KOREA_AREA_CODE) return DEFAULT_SEOUL_CITY_CODE;
  if (/^\d+$/.test(text)) return text.padStart(3, "0");
  return text;
}

function resolveShippingMethod(value: unknown, settings: BuymaSettings) {
  const text = cleanText(value);
  const shippingMethodId = text.replace(/^J/i, "");
  return getConfiguredShippingMethodIds(settings).has(shippingMethodId) ? shippingMethodId : DEFAULT_SHIPPING_METHOD_ID;
}

function getConfiguredShippingMethodIds(settings: BuymaSettings) {
  const ids = new Set(SHIPPING_METHOD_IDS);
  (settings.shippingMethods ?? []).forEach((method) => {
    const id = cleanText(method.id).replace(/^J/i, "");
    if (id) ids.add(id);
  });
  return ids;
}

function resolveCategory(value: unknown) {
  return cleanText(value);
}

function resolveSizeTypeId(categoryId: unknown, size: unknown) {
  const category = cleanText(categoryId);
  const normalizedSize = normalizeSizeName(size);
  if (!category || !normalizedSize) return "";

  const matched = BUYMA_SIZES.find(
    (entry) => entry.categoryId === category && normalizeSizeName(entry.name) === normalizedSize,
  );
  return matched?.id ?? "";
}

function normalizeSizeName(value: unknown) {
  const size = cleanText(value).toUpperCase().replace(/\s+/g, "");
  if (!size) return "";
  if (["XXS", "XS"].includes(size)) return "XS以下";
  if (["XL", "XXL", "XXXL", "2XL", "3XL", "4XL"].includes(size)) return "XL以上";
  return size;
}

function resolveSku(product: ProductDraft, index: number) {
  return product.skuNumber || makeSku(index, product.productCode);
}

function normalizeBuymaTitle(product: ProductDraft, prefix = "") {
  if (product.titleManuallyEdited) {
    return normalizeTitlePart(product.title) || "Fashion Item";
  }

  const titlePrefix = normalizeTitlePart(prefix);
  const source = normalizeTitlePart(product.translatedTitle || product.titleEn || product.title || product.titleKo);
  const brand = resolveTitleBrand(product, source);
  const bracketedBrand = brand ? `【${brand}】` : "";
  const colors = resolveTitleColors(product);
  const colorSuffix = colors.length > 1 ? `(${colors.length}colors)` : colors[0] ? `(${colors[0]})` : "";
  const strippedTitle = stripBrandFromTitle(source, brand);
  const productName =
    stripTitlePrefix(stripTrailingColor(strippedTitle, colors), titlePrefix) ||
    stripTitlePrefix(strippedTitle, titlePrefix) ||
    "Fashion Item";

  return joinTitleParts(bracketedBrand, titlePrefix, productName, colorSuffix);
}

function truncateBuymaTitle(title: string) {
  const suffixMatch = title.match(/\s\((?:\d+colors|[^()]+)\)$/i);
  if (!suffixMatch) return truncateByByteLength(title, 60);

  const suffix = suffixMatch[0];
  const head = title.slice(0, -suffix.length).trim();
  const maxHeadBytes = Math.max(0, 60 - byteLength(suffix));
  const truncatedHead = truncateByByteLength(head, maxHeadBytes).trim();
  return `${truncatedHead}${suffix}`;
}

function byteLength(value: string) {
  return [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
}

function resolveTitleBrand(product: ProductDraft, sourceTitle: string) {
  return normalizeTitlePart(product.brand) || normalizeTitlePart(extractBracketBrand(sourceTitle)) || normalizeTitlePart(extractBrand(sourceTitle));
}

function stripBrandFromTitle(title: string, brand: string) {
  if (!title) return title;
  if (!brand) {
    return title.replace(new RegExp(`^[\\[【][^\\]】]+[\\]】]\\s*`), "").trim();
  }
  const escapedBrand = escapeRegExp(brand);

  return title
    .replace(new RegExp(`^[\\[【]?${escapedBrand}[\\]】]?\\s*[-_:|]*\\s*`, "i"), "")
    .replace(new RegExp(`^[\\[【][^\\]】]+[\\]】]\\s*`), "")
    .trim();
}

function stripTrailingColor(title: string, colors: string[]) {
  let result = title.replace(/\s*\(\d+colors\)\s*$/i, "").trim();
  colors.forEach((color) => {
    if (!color) return;
    const escapedColor = escapeRegExp(color);
    result = result
      .replace(new RegExp(`\\s*\\(${escapedColor}\\)\\s*$`, "i"), "")
      .replace(new RegExp(`\\s+${escapedColor}\\s*$`, "i"), "")
      .trim();
  });
  return result;
}

function stripTitlePrefix(title: string, prefix: string) {
  if (!title || !prefix) return title;
  const escapedPrefix = escapeRegExp(prefix);
  return title.replace(new RegExp(`^${escapedPrefix}\\s+`, "i"), "").trim();
}

function resolveTitleColors(product: ProductDraft) {
  const colorCandidates = [
    ...(product.colors ?? []),
    ...(product.sizeTableData?.map((row) => row.color) ?? []),
  ].flatMap((color) => splitListInput(color));
  const explicitColors = uniqueTextList(colorCandidates.map(convertColorToEnglish))
    .filter((color) => color && color !== "FREE" && color !== "ONE SIZE");
  if (explicitColors.length) return explicitColors;

  const titleColor = extractColorFromTitle(product.title || product.titleKo || product.titleEn || "");
  return titleColor ? [convertColorToEnglish(titleColor)] : [];
}

function extractColorFromTitle(title: string) {
  const normalized = normalizeTitlePart(title);
  const parenMatch = normalized.match(/\(([^()]{2,30})\)\s*$/);
  if (parenMatch?.[1] && !/\d+\s*colors?/i.test(parenMatch[1])) return parenMatch[1];

  const matches = normalized.match(/\b(BLACK|WHITE|CREAM|IVORY|BEIGE|BROWN|GRAY|GREY|NAVY|BLUE|GREEN|RED|PINK|YELLOW|PURPLE|MINT|KHAKI|ORANGE|SILVER|GOLD)\b/gi);
  return matches?.at(-1) ?? "";
}

function extractBracketBrand(title: string) {
  return title.match(/[【\[]([^】\]]+)[】\]]/)?.[1] ?? "";
}

function joinTitleParts(...parts: Array<string | undefined>) {
  return parts
    .map((part) => normalizeTitlePart(part))
    .filter(Boolean)
    .join(" ");
}

function normalizeTitlePart(value: unknown) {
  return cleanText(value)
    .replace(/[_/|]+/g, " ")
    .replace(/\s*[-:]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTextList(values: string[]) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDescription(product: ProductDraft, descriptionPrefix = "", placement: BuymaDescriptionPlacement = "before") {
  return applyDescriptionPrefix(
    getJapaneseBrandDescription(product) || product.description || "",
    descriptionPrefix,
    placement,
  );
}

function applyDescriptionPrefix(
  description: string,
  prefix = "",
  placement: BuymaDescriptionPlacement = "before",
) {
  const cleanPrefix = String(prefix ?? "").trim();
  const cleanDescription = String(description ?? "").trim();
  if (!cleanPrefix) return cleanDescription;
  if (!cleanDescription) return cleanPrefix;
  const descriptionWithoutPrefix = removeDescriptionAffix(cleanDescription, cleanPrefix);
  if (!descriptionWithoutPrefix) return cleanPrefix;
  if (placement === "after") {
    return `${descriptionWithoutPrefix}\n${cleanPrefix}`;
  }
  return `${cleanPrefix}\n${descriptionWithoutPrefix}`;
}

function removeDescriptionAffix(description: string, affix: string) {
  if (description === affix) return "";
  if (description.startsWith(`${affix}\n`)) return description.slice(affix.length).trim();
  if (description.endsWith(`\n${affix}`)) return description.slice(0, -affix.length).trim();
  return description;
}

function getColorSizeRows(
  product: ProductDraft,
  customColors: string[],
  customSizes: string[],
): ColorSizeRow[] {
  if (product.sizeTableData?.length) {
    return product.sizeTableData;
  }

  const colors = customColors.length ? customColors : product.colors;
  const sizes = customSizes.length ? customSizes : product.sizes;
  const resolvedColors = colors.length ? colors : ["FREE"];
  const resolvedSizes = sizes.length ? sizes : ["FREE"];

  return resolvedColors.flatMap((color) =>
    resolvedSizes.map((size) => ({
      color,
      colorSystemId:
        product.colorSystemMap?.[color] || getColorSystemId(color) || product.colorSystemId || "",
      size,
      sizeTypeId: resolveSizeTypeId(product.category, size),
      stock: findStockStatus(product, color, size),
    })),
  );
}

function findStockStatus(product: ProductDraft, color: string, size: string): StockStatus {
  const keys = [
    `${color}|${size.toUpperCase()}`,
    `${color}|${size}`,
    `|${size.toUpperCase()}`,
    color,
  ];

  for (const source of [product.stockData, product.optionStockMap]) {
    if (!source) continue;
    const foundKey = keys.find((key) => source[key]);
    if (foundKey) return normalizeStockStatus(source[foundKey]) as StockStatus;
  }

  return normalizeStockStatus(product.stockStatus) as StockStatus;
}

function getMeasurementValues(product: ProductDraft, size: string) {
  const allowedHeaders = getAllowedMeasurementHeaders(product.category);
  if (!allowedHeaders) {
    return COLOR_SIZE_MEASUREMENT_HEADERS.map(() => "");
  }

  const measurements = product.sizeMeasurements ?? {};
  const exact = measurements[size.toUpperCase()] || measurements[size] || findMeasurementRow(measurements, size) || {};
  const normalized = normalizeMeasurementValues(exact);

  return COLOR_SIZE_MEASUREMENT_HEADERS.map((header) => {
    if (!allowedHeaders.has(header)) return "";
    return getNormalizedMeasurementValue(normalized, header);
  });
}

function isSupportedMeasurementGroup(groupName: unknown) {
  return /^(?:トップス|ボトムス|ワンピース)/.test(cleanText(groupName));
}

function getAllowedMeasurementHeaders(categoryId: unknown) {
  return MEASUREMENT_HEADERS_BY_CATEGORY.get(cleanText(categoryId));
}

function getNormalizedMeasurementValue(normalized: Record<string, string>, header: string) {
  if (SKIRT_LENGTH_HEADERS.has(header)) return normalized[header] || normalized["着丈"] || "";
  return normalized[header] || normalized[`${header} `] || "";
}

function findMeasurementRow(
  measurements: Record<string, Record<string, string>>,
  size: string,
) {
  const normalizedSize = normalizeSizeKey(size);
  if (!normalizedSize) return undefined;

  return Object.entries(measurements).find(([key]) => normalizeSizeKey(key) === normalizedSize)?.[1];
}

function normalizeSizeKey(value: unknown) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeMeasurementValues(values: Record<string, string>) {
  const normalized: Record<string, string> = {};

  MEASUREMENT_HEADERS.forEach((header) => {
    const value = normalizeCsvMeasurementValue(values[header]);
    if (value && !isBlankMeasurementValue(value)) normalized[header] = value;
  });

  Object.entries(values).forEach(([key, rawValue]) => {
    const mapping = resolveMeasurementHeader(key);
    if (!mapping) return;

    const mappedValue = mapping.multiplier === 2
      ? multiplyMeasurementValue(rawValue, mapping.multiplier)
      : cleanText(rawValue);
    const value = normalizeCsvMeasurementValue(mappedValue);
    if (value && !isBlankMeasurementValue(value) && !normalized[mapping.header]) {
      normalized[mapping.header] = value;
    }
  });

  return normalized;
}

function isBlankMeasurementValue(value: unknown) {
  return /^(?:null|undefined|-)?$/i.test(cleanText(value));
}

function normalizeCsvMeasurementValue(value: unknown) {
  const text = cleanText(value).replace(/cm$/i, "").trim();
  if (!text || isBlankMeasurementValue(text)) return "";
  const numberMatch = text.match(/^\d+(?:\.\d+)?$/);
  return numberMatch ? formatMeasurementNumber(Number(text)) : "";
}

function resolveMeasurementHeader(key: string): { header: string; multiplier?: number } | null {
  const label = cleanText(key).replace(/\s+/g, "").toLowerCase();
  if (!label) return null;

  if (["着丈", "총장", "총기장", "총길이", "옷길이", "기장", "length"].includes(label)) {
    return { header: "着丈" };
  }
  if (["肩幅", "어깨너비", "어깨넓이", "어깨단면", "어깨", "shoulder", "shoulderwidth"].includes(label)) {
    return { header: "肩幅" };
  }
  if (["가슴단면", "가슴너비", "가슴폭", "품", "품단면", "단면가슴", "chestwidth", "pittopit", "pit-to-pit"].includes(label)) {
    return { header: "胸囲", multiplier: 2 };
  }
  if (["胸囲", "가슴둘레", "가슴", "chest", "bust"].includes(label)) {
    return { header: "胸囲" };
  }
  if (["袖丈", "소매길이", "소매", "팔길이", "sleeve", "sleevelength"].includes(label)) {
    return { header: "袖丈" };
  }
  if (["ウエスト", "허리단면", "허리너비", "허리폭", "허리둘레", "허리", "waist", "waistwidth"].includes(label)) {
    return { header: "ウエスト" };
  }
  if (["ヒップ", "엉덩이단면", "엉덩이너비", "엉덩이폭", "엉덩이둘레", "엉덩이", "힙", "힙단면", "hip", "hips"].includes(label)) {
    return { header: "ヒップ" };
  }
  if (["股上", "밑위", "앞밑위", "rise", "riselength", "frontrise", "crotch"].includes(label)) {
    return { header: "股上" };
  }
  if (["股下", "밑아래", "밑아래길이", "인심", "inseam"].includes(label)) {
    return { header: "股下" };
  }
  if (["すそ周り", "裾周り", "밑단", "밑단단면", "밑단너비", "밑단폭", "hem", "hemwidth", "bottomwidth", "legopening"].includes(label)) {
    return { header: "すそ周り" };
  }
  if (["もも周り", "허벅지단면", "허벅지너비", "허벅지폭", "허벅지둘레", "허벅지", "thigh", "thighwidth", "tight"].includes(label)) {
    return { header: "もも周り" };
  }

  return null;
}

function multiplyMeasurementValue(value: unknown, multiplier: number) {
  const text = cleanText(value).replace(/cm$/i, "").trim();
  if (!text) return "";

  const rangeMatch = text.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    return `${formatMeasurementNumber(Number(rangeMatch[1]) * multiplier)}-${formatMeasurementNumber(Number(rangeMatch[2]) * multiplier)}`;
  }

  const numberMatch = text.match(/^\d+(?:\.\d+)?$/);
  if (!numberMatch) return text;

  return formatMeasurementNumber(Number(text) * multiplier);
}

function formatMeasurementNumber(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function getImageSlots(product: ProductDraft, _productIndex: number) {
  const uploaded = product.uploadedImageUrls ?? [];
  const originals = (product.images ?? []).filter((image) => image && image !== product.editedImage);
  const slots = uploaded.some(Boolean) ? uploaded : originals;

  return Array.from({ length: 20 }, (_, index) => slots[index] ?? "");
}

function getPurchaseDeadline(baseDate?: string) {
  const date = baseDate ? new Date(baseDate) : new Date();
  if (Number.isNaN(date.getTime())) return getPurchaseDeadline();
  date.setDate(date.getDate() + 89);
  return date.toISOString().slice(0, 10);
}

function toCsv(rows: Array<Array<string | number>>, preserveNewlineColumns = new Set<number>()) {
  return rows
    .map((row) =>
      row
        .map((value, columnIndex) => {
          if (columnIndex === 0 && cleanText(value) === "") return "";
          return sanitizeCsvValue(value, preserveNewlineColumns.has(columnIndex));
        })
        .join(","),
    )
    .join("\r\n");
}

function sanitizeCsvValue(value: unknown, preserveNewlines = false) {
  if (!preserveNewlines) return sanitizeForCsv(value);

  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") return "";
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
