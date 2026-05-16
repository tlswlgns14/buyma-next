import { findBuymaBrand } from "@/lib/buyma/brands";
import { stripMusinsaDescriptionNoise } from "@/lib/buyma/description";
import { BUYMA_SEASONS } from "@/lib/buyma/id-data";
import type { ProductDraft, StockStatus } from "@/lib/buyma/types";
import { cleanText, convertColorToEnglish, extractBrand, extractModelNumber, parsePrice } from "@/lib/buyma/text";
import type { ProductExtractor } from "./types";

type MusinsaOptionKind = "color" | "size";

type MusinsaInventoryTarget = {
  optionItemNo: string;
  optionValueNos: string[];
  stockKeys: string[];
};

type MusinsaSizeMeasurements = Record<string, Record<string, string>>;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

const MUSINSA_COLOR_ID_MAP: Record<string, string> = {
  "1": "WHITE",
  "2": "BLACK",
  "3": "GRAY",
  "4": "BROWN",
  "5": "BEIGE",
  "6": "GREEN",
  "7": "BLUE",
  "8": "PURPLE",
  "9": "YELLOW",
  "10": "PINK",
  "11": "RED",
  "12": "ORANGE",
  "13": "SILVER",
  "14": "GOLD",
  "15": "MULTI",
  "16": "BLUE",
  "23": "IVORY",
  "24": "GRAY",
  "25": "GRAY",
  "26": "BEIGE",
  "28": "BEIGE",
  "29": "BEIGE",
  "30": "GREEN",
  "31": "GREEN",
  "32": "GREEN",
  "34": "GREEN",
  "35": "GREEN",
  "36": "NAVY",
  "37": "BLUE",
  "39": "PURPLE",
  "44": "YELLOW",
  "45": "PINK",
  "48": "PINK",
  "49": "RED",
  "51": "RED",
  "56": "GOLD",
  "57": "BLUE",
  "58": "BLUE",
  "59": "BLUE",
  "60": "BLACK",
  "72": "BROWN",
  "73": "PINK",
  "74": "ORANGE",
  "75": "ORANGE",
  "76": "ORANGE",
  "77": "BEIGE",
  "78": "YELLOW",
  "79": "GREEN",
  "80": "BLUE",
  "81": "NAVY",
  "82": "BROWN",
  "83": "BROWN",
  "84": "BEIGE",
  "85": "CLEAR",
  "100": "RED",
  "101": "PINK",
  "102": "ORANGE",
  "103": "ORANGE",
  "104": "GOLD",
  "105": "BROWN",
  "106": "PURPLE",
  "107": "BEIGE",
  "108": "IVORY",
  "109": "SILVER",
  "110": "GOLD",
  "111": "MULTI",
  "200": "RED",
  "201": "RED",
  "202": "GOLD",
  "203": "PURPLE",
  "204": "PINK",
  "205": "ORANGE",
  "206": "ORANGE",
  "207": "BEIGE",
  "208": "CLEAR",
  "209": "MULTI",
};

const IMAGE_VALUE_KEYS = [
  "goodsImages",
  "images",
  "productImages",
  "imageList",
  "gallery",
  "goodsImageList",
  "thumbnailImageUrl",
  "imageUrl",
  "mainImage",
  "goodsImage",
  "representImage",
  "originUrl",
  "imageSource",
];

const BRAND_LOGO_VALUE_KEYS = [
  "brandLogo",
  "brandLogoUrl",
  "brandLogoImage",
  "brandLogoImageUrl",
  "brandImage",
  "brandImageUrl",
  "brandIcon",
  "brandIconUrl",
  "logo",
  "logoUrl",
  "logoImage",
  "logoImageUrl",
  "imageUrl",
];

const MUSINSA_SIZE_MEASUREMENT_OVERRIDES: Record<string, MusinsaSizeMeasurements> = {
  "5994466": {
    "090": { "着丈": "69", "肩幅": "48.5", "胸囲": "114", "袖丈": "61", "裾周り": "110", "袖周り": "24" },
    "095": { "着丈": "71", "肩幅": "50.5", "胸囲": "119", "袖丈": "62", "裾周り": "115", "袖周り": "25" },
    "100": { "着丈": "73", "肩幅": "52.5", "胸囲": "124", "袖丈": "63", "裾周り": "120", "袖周り": "26" },
    "105": { "着丈": "75", "肩幅": "54.5", "胸囲": "129", "袖丈": "64.5", "裾周り": "125", "袖周り": "27" },
    "110": { "着丈": "77", "肩幅": "56.5", "胸囲": "134", "袖丈": "66", "裾周り": "130", "袖周り": "28" },
    "115": { "着丈": "77", "肩幅": "58.5", "胸囲": "139", "袖丈": "67.5", "裾周り": "135", "袖周り": "29" },
  },
  NJ2GS00B: {
    "090": { "着丈": "69", "肩幅": "48.5", "胸囲": "114", "袖丈": "61", "裾周り": "110", "袖周り": "24" },
    "095": { "着丈": "71", "肩幅": "50.5", "胸囲": "119", "袖丈": "62", "裾周り": "115", "袖周り": "25" },
    "100": { "着丈": "73", "肩幅": "52.5", "胸囲": "124", "袖丈": "63", "裾周り": "120", "袖周り": "26" },
    "105": { "着丈": "75", "肩幅": "54.5", "胸囲": "129", "袖丈": "64.5", "裾周り": "125", "袖周り": "27" },
    "110": { "着丈": "77", "肩幅": "56.5", "胸囲": "134", "袖丈": "66", "裾周り": "130", "袖周り": "28" },
    "115": { "着丈": "77", "肩幅": "58.5", "胸囲": "139", "袖丈": "67.5", "裾周り": "135", "袖周り": "29" },
  },
  NJ3LS02J: {
    "090": { "着丈": "69", "肩幅": "53", "胸囲": "120", "袖丈": "59.5", "すそ周り": "115" },
    "095": { "着丈": "71", "肩幅": "55", "胸囲": "125", "袖丈": "60.5", "すそ周り": "120" },
    "100": { "着丈": "73", "肩幅": "57", "胸囲": "130", "袖丈": "61.5", "すそ周り": "125" },
    "105": { "着丈": "75", "肩幅": "59", "胸囲": "135", "袖丈": "63", "すそ周り": "130" },
    "110": { "着丈": "77", "肩幅": "61", "胸囲": "140", "袖丈": "64.5", "すそ周り": "135" },
    "115": { "着丈": "79", "肩幅": "63", "胸囲": "145", "袖丈": "66", "すそ周り": "140" },
  },
};

const DESCRIPTION_KEYS = [
  "description",
  "goodsDescription",
  "content",
  "contents",
  "goodsContents",
  "goodsContent",
  "goodsDetail",
  "goodsDetailDescription",
  "detailContent",
  "detailContents",
  "detailDescription",
  "detailHtml",
  "goodsDetailContent",
  "mobileDetailContent",
  "pcDetailContent",
  "mobileDescription",
  "pcDescription",
  "summary",
  "overview",
];

const BRAND_DESCRIPTION_KEYS = [
  "memo",
  "brandDescription",
  "brandDesc",
  "brandIntroduction",
  "brandIntro",
  "brandStory",
  "brandContent",
  "brandContents",
  "brandSummary",
  "brandMemo",
  "brandMessage",
];

const SEASON_KEYS = [
  "season",
  "seasonName",
  "seasonCode",
  "seasonCd",
  "goodsSeason",
  "goodsSeasonName",
  "goodsSeasonCode",
  "productSeason",
  "productSeasonName",
  "displaySeasonName",
  "displaySeason",
];

const SEASON_YEAR_KEYS = [
  "seasonYear",
  "goodsSeasonYear",
  "productSeasonYear",
  "year",
];

const SEASON_TYPE_KEYS = [
  "seasonType",
  "seasonKind",
  "seasonGroup",
  "seasonDisplay",
];

export const musinsaExtractor: ProductExtractor = {
  site: "musinsa.com",
  supports: (url) => url.hostname.includes("musinsa.com"),
  extract: extractMusinsaProduct,
};

async function extractMusinsaProduct(url: URL): Promise<ProductDraft> {
  const productId =
    url.pathname.match(/\/(?:products|app\/goods)\/(\d+)/)?.[1] ||
    url.searchParams.get("goodsNo") ||
    "";

  const html = await fetchHtml(url.toString(), "https://www.musinsa.com/");
  const jsonLd = extractJsonLdProduct(html);
  const nextData = extractNextDataProduct(html);
  const musinsaState = extractMusinsaStateProduct(html);
  const apiProductData = productId ? await getMusinsaProductApiData(productId, url.toString()) : null;
  const productData = mergeRecords(musinsaState, nextData, apiProductData);
  const brandInfo = asRecord(productData?.brandInfo);
  const brandRecord = asRecord(productData?.brand);
  const titleKo =
    cleanText(productData?.goodsNm) ||
    cleanText(productData?.goodsName) ||
    cleanText(productData?.productName) ||
    cleanMusinsaPageTitle(cleanText(jsonLd?.name)) ||
    cleanMusinsaPageTitle(cleanText(extractMeta(html, "og:title"))) ||
    cleanMusinsaPageTitle(cleanText(html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]));
  const titleEn =
    cleanText(productData?.goodsNmEng) ||
    extractEnglishPhrase(titleKo) ||
    extractEnglishPhrase(cleanMusinsaPageTitle(cleanText(jsonLd?.name))) ||
    extractEnglishPhrase(cleanMusinsaPageTitle(cleanText(extractMeta(html, "og:title"))));
  const productTitle = titleEn || titleKo;
  const detectedBrand =
    cleanText(asRecord(jsonLd?.brand)?.name) ||
    cleanText(brandInfo?.brandEnglishName) ||
    cleanText(brandInfo?.brandName) ||
    cleanText(productData?.brandName) ||
    cleanText(brandRecord?.name) ||
    (typeof productData?.brand === "string" ? cleanText(productData.brand) : "") ||
    extractBrand(productTitle || titleKo);
  const buymaBrand = findBuymaBrand(detectedBrand);
  const brand = buymaBrand?.displayName || detectedBrand;
  const brandDisplayName =
    buymaBrand?.displayName ||
    cleanText(brandInfo?.brandEnglishName) ||
    cleanText(brandInfo?.brandName) ||
    brand;
  const images = resolveMusinsaProductImages(productData, apiProductData, jsonLd, html, url);
  const price = resolveMusinsaPrice(productData, jsonLd);
  const modelNumber =
    extractKnownStyleCode(
      [
        productTitle,
        titleKo,
        titleEn,
        cleanMusinsaPageTitle(cleanText(jsonLd?.name)),
        cleanMusinsaPageTitle(cleanText(extractMeta(html, "og:title"))),
      ],
      productId,
    ) ||
    resolveMusinsaModelNumber(productData, productId) ||
    extractModelNumberFromHtml(html, productId) ||
    cleanModelNumber(extractModelNumber(productTitle || titleKo), productId);
  const apiOptions = productId ? await getMusinsaOptions(productId, url.toString()) : { colors: [], sizes: [], optionStockMap: {} };
  const apiSizeMeasurements = productId ? await getMusinsaActualSizeMeasurements(productId, url.toString()) : {};
  const rawSizeMeasurements = hasMusinsaSizeMeasurements(apiSizeMeasurements)
    ? apiSizeMeasurements
    : await resolveMusinsaFallbackSizeMeasurements(productId, modelNumber, productData, apiProductData, url, apiOptions.sizes);
  const musinsaCategoryText = cleanText([
    jsonLd?.category,
    productData?.categoryName,
    productData?.category,
    ...findNestedValuesByKeys(productData, ["categoryName", "categoryDisplayName", "category"]),
  ].join(" "));
  const category = mapMusinsaCategoryToBuymaId(musinsaCategoryText) || cleanText(jsonLd?.category || productData?.categoryName);
  const normalizedSizeOptions = normalizeMusinsaApparelSizeOptions(apiOptions, rawSizeMeasurements, musinsaCategoryText, category);
  const sizeMeasurements = normalizedSizeOptions.sizeMeasurements;
  const measurementSizes = Object.keys(sizeMeasurements);
  const colors = resolveMusinsaColors(productData, normalizedSizeOptions.colors, [titleKo, titleEn, productTitle]);
  const sizes = unique(
    [
      ...(normalizedSizeOptions.sizes.length
        ? normalizedSizeOptions.sizes
        : extractOptionValues(productData, ["size", "sizes", "sizeName"]).filter(isValidSizeName)),
      ...measurementSizes,
    ],
  );
  const season = resolveMusinsaSeason(productData, apiProductData, html, [titleKo, titleEn, productTitle]);
  const stockStatus = resolveProductStockStatus(productData, apiProductData, normalizedSizeOptions.optionStockMap);
  const brandDescriptionKo = resolveMusinsaBrandDescription(productData, apiProductData);
  const brandLogo = resolveMusinsaBrandLogo(productData, apiProductData, html, url);

  if (!titleKo && images.length === 0) {
    throw new Error("무신사 상품 정보를 찾지 못했습니다. URL을 확인해주세요.");
  }

  return {
    site: "musinsa.com",
    sourceUrl: url.toString(),
    titleKo,
    title: productTitle,
    titleEn,
    brand,
    brandDisplayName,
    brandId: buymaBrand?.id || "0",
    price,
    category,
    season,
    colors,
    sizes,
    images,
    brandLogo,
    productCode: productId || cleanText(productData?.goodsNo || productData?.productId),
    modelNumber,
    descriptionKo: brandDescriptionKo,
    description: "",
    stockStatus,
    optionStockMap: normalizedSizeOptions.optionStockMap,
    ...(measurementSizes.length ? { sizeMeasurements } : {}),
    extractedAt: new Date().toISOString(),
  };
}

async function getMusinsaOptions(productId: string, referer: string) {
  try {
    const response = await fetch(`https://goods-detail.musinsa.com/api2/goods/${productId}/options`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: referer,
        Origin: "https://www.musinsa.com",
        Accept: "application/json",
      },
    });
    if (!response.ok) return { colors: [], sizes: [], optionStockMap: {} };

    const json = (await response.json()) as Record<string, unknown>;
    const parsed = parseMusinsaOptions(json);
    await mergeMusinsaPrioritizedInventoryStocks(productId, referer, parsed.inventoryTargets, parsed.optionStockMap);

    return {
      colors: parsed.colors,
      sizes: parsed.sizes,
      optionStockMap: parsed.optionStockMap,
    };
  } catch {
    return { colors: [], sizes: [], optionStockMap: {} };
  }
}

async function mergeMusinsaPrioritizedInventoryStocks(
  productId: string,
  referer: string,
  inventoryTargets: MusinsaInventoryTarget[],
  optionStockMap: Record<string, StockStatus>,
) {
  const optionValueNos = unique(inventoryTargets.flatMap((target) => target.optionValueNos))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (optionValueNos.length === 0) return;

  try {
    const response = await fetch(`https://goods-detail.musinsa.com/api2/goods/${productId}/options/v2/prioritized-inventories`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Referer: referer,
        Origin: "https://www.musinsa.com",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ optionValueNos }),
    });
    if (!response.ok) return;

    const json = (await response.json()) as Record<string, unknown>;
    const inventoryItems = Array.isArray(json.data) ? json.data.map(asRecord).filter(isRecord) : [];
    const targetByOptionItemNo = new Map(inventoryTargets.map((target) => [target.optionItemNo, target]));

    inventoryItems.forEach((item) => {
      const optionItemNo = cleanText(item.productVariantId || item.optionItemNo || item.goodsOptionItemNo);
      const target = targetByOptionItemNo.get(optionItemNo);
      if (!target) return;

      const stock = isSoldOutOption(item) ? "0" : "1";
      target.stockKeys.forEach((key) => setOptionStock(optionStockMap, key, stock));
    });
  } catch {
    // Keep the option API stock fallback when Musinsa inventory lookup is unavailable.
  }
}

async function getMusinsaProductApiData(productId: string, referer: string) {
  const endpoints = [
    `https://goods-detail.musinsa.com/api2/goods/${productId}`,
    `https://goods-detail.musinsa.com/api/v1/goods/${productId}`,
    `https://www.musinsa.com/api/v1/goods/${productId}`,
    `https://www.musinsa.com/api/goods/${productId}`,
    `https://www.musinsa.com/api2/goods/${productId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: referer,
          Origin: "https://www.musinsa.com",
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;

      const json = (await response.json()) as unknown;
      const data = asRecord(asRecord(json)?.data);
      const record = mergeRecords(data, findLikelyProductRecord(json), asRecord(json));
      if (record) return record;
    } catch {
      // Try the next Musinsa endpoint.
    }
  }

  return null;
}

async function getMusinsaActualSizeMeasurements(productId: string, referer: string) {
  try {
    const response = await fetch(`https://goods-detail.musinsa.com/api2/goods/${productId}/actual-size`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: referer,
        Origin: "https://www.musinsa.com",
        Accept: "application/json",
      },
    });
    if (!response.ok) return {};

    const json = (await response.json()) as Record<string, unknown>;
    return parseMusinsaActualSizeMeasurements(json);
  } catch {
    return {};
  }
}

function parseMusinsaActualSizeMeasurements(json: Record<string, unknown>) {
  const data = asRecord(json.data);
  const sizes = Array.isArray(data?.sizes) ? data.sizes.map(asRecord).filter(isRecord) : [];
  const measurements: Record<string, Record<string, string>> = {};

  sizes.forEach((sizeRow) => {
    const sizeName = cleanText(sizeRow.name || sizeRow.sizeName || sizeRow.size).toUpperCase();
    if (!sizeName) return;

    const row: Record<string, string> = {};
    const items = Array.isArray(sizeRow.items) ? sizeRow.items.map(asRecord).filter(isRecord) : [];
    items.forEach((item) => {
      const name = cleanText(item.name || item.itemName || item.label || item.title);
      const value = cleanText(item.value || item.sizeValue || item.actualValue);
      setMusinsaMeasurementValue(row, name, value);
    });

    Object.entries(sizeRow).forEach(([key, value]) => {
      if (["name", "sizeName", "size", "items"].includes(key)) return;
      setMusinsaMeasurementValue(row, key, cleanText(value));
    });

    if (Object.keys(row).length) measurements[sizeName] = row;
  });

  return measurements;
}

function hasMusinsaSizeMeasurements(sizeMeasurements: MusinsaSizeMeasurements) {
  return Object.values(sizeMeasurements).some((row) => Object.keys(row).length > 0);
}

async function resolveMusinsaFallbackSizeMeasurements(
  productId: string,
  modelNumber: string,
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  baseUrl: URL,
  optionSizes: string[],
) {
  const candidates = [
    parseMusinsaTextSizeMeasurements(productData?.goodsContents),
    parseMusinsaTextSizeMeasurements(apiProductData?.goodsContents),
    findMusinsaSizeMeasurementOverride(productId, modelNumber),
  ];

  const parsed = candidates.find(hasMusinsaSizeMeasurements);
  if (parsed) return parsed;

  return await parseMusinsaImageSizeMeasurements(productData, apiProductData, baseUrl, optionSizes);
}

function findMusinsaSizeMeasurementOverride(productId: string, modelNumber: string) {
  const keys = [
    cleanText(productId),
    cleanText(modelNumber).toUpperCase(),
  ].filter(Boolean);

  for (const key of keys) {
    const measurements = MUSINSA_SIZE_MEASUREMENT_OVERRIDES[key];
    if (measurements) return measurements;
  }

  return {};
}

function parseMusinsaTextSizeMeasurements(value: unknown): MusinsaSizeMeasurements {
  const text = htmlToText(cleanText(value));
  if (!text || !/실측|사이즈|총장|어깨|가슴|소매/.test(text)) return {};

  const measurements: MusinsaSizeMeasurements = {};
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  lines.forEach((line) => {
    const rowMatch = line.match(/^(\d{2,3}|[A-Z]{1,4}|[2-6]XL)\s*(?:\(([A-Z0-9]+)\))?\s+((?:\d+(?:\.\d+)?\s+){3,}\d+(?:\.\d+)?)/i);
    if (!rowMatch) return;

    const size = cleanText(rowMatch[1]);
    const values = rowMatch[3].trim().split(/\s+/);
    if (values.length < 4) return;

    measurements[size] = {
      "着丈": values[1] || values[0],
      "胸囲": values[2],
      "肩幅": values[4] || "",
      "袖丈": values[5] || values[3],
      "すそ周り": values[3] || "",
    };
  });

  return measurements;
}

async function parseMusinsaImageSizeMeasurements(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  baseUrl: URL,
  optionSizes: string[],
): Promise<MusinsaSizeMeasurements> {
  if (!optionSizes.length) return {};

  const imageUrls = getMusinsaDetailImageUrls(productData, apiProductData, baseUrl).slice(0, 2);
  if (!imageUrls.length) return {};

  try {
    return await parseMusinsaImageSizeMeasurementsWithOcr(imageUrls, optionSizes, Date.now() + 25000);
  } catch {
    return {};
  }
}

function getMusinsaDetailImageUrls(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  baseUrl: URL,
) {
  const htmlValues = [
    productData?.goodsContents,
    apiProductData?.goodsContents,
    productData?.detailContent,
    apiProductData?.detailContent,
    productData?.description,
    apiProductData?.description,
  ];
  const ignored = /notice|footer|delivery|exchange|return|care|banner|official|logo|공식|배송|교환/i;

  const imagesWithAlt = htmlValues.flatMap((value) =>
    extractDetailImageUrlsFromImgTags(cleanText(value), baseUrl, ignored),
  );
  const imagesFromHtml = htmlValues.flatMap((value) => extractImageUrlsFromHtml(cleanText(value), baseUrl));
  const candidates = imagesWithAlt.length ? imagesWithAlt : imagesFromHtml;

  return unique(candidates)
    .filter((url) => isMusinsaDetailImageUrl(url) && !ignored.test(url));
}

function isMusinsaDetailImageUrl(value: string) {
  const src = value.toLowerCase();
  return /^https?:\/\//.test(src) && /\.(?:jpg|jpeg|png|webp)$/i.test(src);
}

function extractDetailImageUrlsFromImgTags(html: string, baseUrl: URL, ignored: RegExp) {
  const source = decodeHtml(html)
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");

  return [...source.matchAll(/<img\b[^>]*>/gi)].flatMap((match) => {
    const tag = match[0];
    if (ignored.test(tag)) return [];

    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "";
    const normalized = normalizeUrl(src.startsWith("//") ? `https:${src}` : src, baseUrl);
    return normalized ? [normalized] : [];
  });
}

async function parseMusinsaImageSizeMeasurementsWithOcr(
  imageUrls: string[],
  optionSizes: string[],
  deadline: number,
): Promise<MusinsaSizeMeasurements> {
  const { createWorker, PSM } = await import("tesseract.js");
  const sharp = (await import("sharp")).default;
  const worker = await createWorker("kor+eng");
  let bestMeasurements: MusinsaSizeMeasurements = {};
  let bestScore = 0;

  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });

    for (const imageUrl of imageUrls) {
      if (Date.now() > deadline) return hasUsefulMusinsaOcrMeasurements(bestMeasurements) ? bestMeasurements : {};
      const response = await fetch(imageUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) continue;

      const source = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(source).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0) continue;

      for (const region of getMusinsaOcrCropRegions(width, height)) {
        if (Date.now() > deadline) return hasUsefulMusinsaOcrMeasurements(bestMeasurements) ? bestMeasurements : {};
        const image = await sharp(source)
          .extract(region)
          .grayscale()
          .normalize()
          .sharpen()
          .resize({ width: Math.min(2200, region.width * 2), withoutEnlargement: false })
          .png()
          .toBuffer();
        const result = await worker.recognize(image);
        if (Date.now() > deadline) return hasUsefulMusinsaOcrMeasurements(bestMeasurements) ? bestMeasurements : {};
        const measurements = parseMusinsaOcrSizeMeasurements(cleanOcrText(result.data.text), optionSizes);
        const score = scoreMusinsaOcrMeasurements(measurements);
        if (score > bestScore) {
          bestMeasurements = measurements;
          bestScore = score;
        }
        if (bestScore >= Math.min(optionSizes.length, 6) * 4) return bestMeasurements;
      }
    }
  } finally {
    await worker.terminate();
  }

  return hasUsefulMusinsaOcrMeasurements(bestMeasurements) ? bestMeasurements : {};
}

function hasUsefulMusinsaOcrMeasurements(sizeMeasurements: MusinsaSizeMeasurements) {
  const rows = Object.values(sizeMeasurements);
  if (rows.length === 0) return false;

  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  return headers.size >= 2;
}

function scoreMusinsaOcrMeasurements(sizeMeasurements: MusinsaSizeMeasurements) {
  const valuesByHeader: Record<string, number[]> = {};
  let score = 0;

  Object.values(sizeMeasurements).forEach((row) => {
    Object.entries(row).forEach(([header, rawValue]) => {
      const value = Number(cleanText(rawValue));
      if (!Number.isFinite(value)) return;
      score += 1;
      valuesByHeader[header] = [...(valuesByHeader[header] ?? []), value];

      if (header === "肩幅" && (value < 20 || value > 90)) score -= 6;
      if (header === "袖丈" && (value < 5 || value > 100)) score -= 4;
      if (header === "着丈" && (value < 20 || value > 150)) score -= 4;
      if (header === "胸囲" && (value < 40 || value > 220)) score -= 4;
      if (header === "すそ周り" && (value < 30 || value > 220)) score -= 4;
    });
  });

  Object.values(valuesByHeader).forEach((values) => {
    values.forEach((value, index) => {
      const previous = values[index - 1];
      if (previous === undefined) return;
      if (value + 2 < previous) score -= 4;
      if (Math.abs(value - previous) > 35) score -= 4;
    });
  });

  return score;
}

function getMusinsaOcrCropRegions(width: number, height: number) {
  const regions: Array<{ left: number; top: number; width: number; height: number }> = [];
  const add = (top: number, cropHeight: number) => {
    if (top >= height) return;
    const boundedTop = Math.max(0, Math.min(top, height - 1));
    const boundedHeight = Math.max(1, Math.min(cropHeight, height - boundedTop));
    const key = `${boundedTop}:${boundedHeight}`;
    if (regions.some((region) => `${region.top}:${region.height}` === key)) return;
    regions.push({ left: 0, top: boundedTop, width, height: boundedHeight });
  };

  add(height - 1600, 1600);
  add(height - 1200, 1200);
  add(height - 900, 900);
  for (let top = 0; top < height; top += 600) add(top, 900);
  for (let top = 0; top < height; top += 1400) add(top, 1400);

  return regions;
}

function cleanOcrText(value: string) {
  return cleanText(value)
    .replace(/[|_=—–…]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseMusinsaOcrSizeMeasurements(text: string, optionSizes: string[]): MusinsaSizeMeasurements {
  if (!text || optionSizes.length === 0) return {};

  const rows = [
    { label: "전체길이", patterns: [/전체\s*길이|총\s*길이|총장|앞\s*기장|기장/i] },
    { label: "가슴둘레", patterns: [/가슴\s*둘레|가슴\s*단면|가슴\s*툴레|가습\s*들레|슴\s*둘레/i] },
    { label: "밑단둘레", patterns: [/밑단\s*둘레|밑단\s*단면|밑단\s*툴레|일단\s*둘레|단\s*둘레/i] },
    { label: "어깨너비", patterns: [/어깨\s*너비|어깨\s*넓이|어써\s*너비/i] },
    { label: "소매길이", patterns: [/소매\s*길이|소매기장/i] },
    { label: "소매둘레", patterns: [/소매\s*둘레|소매\s*툴레|매\s*둘레/i] },
    { label: "허리둘레", patterns: [/허리\s*둘레|허리\s*단면/i] },
    { label: "엉덩이둘레", patterns: [/엉덩이\s*둘레|힙\s*둘레/i] },
    { label: "밑위", patterns: [/밑위/i] },
  ];
  const hitByLabel = new Map<string, { index: number; label: string }>();
  rows.forEach((row) => {
    row.patterns.forEach((pattern) => {
      findOcrPatternMatches(text, pattern).forEach((index) => {
        const current = hitByLabel.get(row.label);
        if (!current || index > current.index) hitByLabel.set(row.label, { index, label: row.label });
      });
    });
  });
  const hits = [...hitByLabel.values()].sort((a, b) => a.index - b.index);

  let bestMeasurements: MusinsaSizeMeasurements = {};
  let bestScore = 0;
  const maxSizeCount = Math.min(optionSizes.length, 12);
  const minSizeCount = maxSizeCount > 4 ? Math.max(3, maxSizeCount - 2) : 3;

  for (let sizeCount = maxSizeCount; sizeCount >= minSizeCount; sizeCount -= 1) {
    const sizes = optionSizes.slice(0, sizeCount);
    const measurements: MusinsaSizeMeasurements = {};

    hits.forEach((hit, index) => {
      const next = hits[index + 1]?.index ?? text.length;
      const values = extractMeasurementNumbers(text.slice(hit.index, next), sizeCount);
      if (values.length !== sizeCount) return;

      values.forEach((value, sizeIndex) => {
        const size = sizes[sizeIndex];
        if (!size) return;
        const row = measurements[size] ?? {};
        setMusinsaMeasurementValue(row, hit.label, value);
        if (Object.keys(row).length) measurements[size] = row;
      });
    });

    const score = scoreMusinsaOcrMeasurements(measurements);
    if (score > bestScore) {
      bestMeasurements = measurements;
      bestScore = score;
    }
  }

  return bestMeasurements;
}

function findOcrPatternMatches(text: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].flatMap((match) =>
    match.index === undefined ? [] : [match.index],
  );
}

function extractMeasurementNumbers(segment: string, sizeCount: number) {
  const numbers = [...segment.matchAll(/\d+(?:\.\d+)?|[nm][o0s5]/gi)]
    .map((match) => normalizeOcrMeasurementNumber(match[0]))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 300);

  if (numbers.length < sizeCount) return [];
  return fixOcrMeasurementSequence(numbers.slice(0, sizeCount)).map(formatMusinsaMeasurementNumber);
}

function normalizeOcrMeasurementNumber(value: string) {
  if (/^[nm][o0]$/i.test(value)) return 110;
  if (/^[nm][s5]$/i.test(value)) return 115;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  if (numeric > 200 && /^\d{3}$/.test(value)) return numeric / 10;
  return numeric;
}

function fixOcrMeasurementSequence(values: number[]) {
  const fixed: number[] = [];

  values.forEach((value, index) => {
    const previous = fixed[index - 1];
    const next = values[index + 1];

    if (previous !== undefined && next !== undefined && value < 10 && previous + 2 === next) {
      fixed.push(previous + 1);
      return;
    }

    if (previous !== undefined && next !== undefined && value === 0 && previous + 10 === next) {
      fixed.push(previous + 5);
      return;
    }

    if (previous !== undefined && value < previous && value <= 50) {
      let adjusted = value;
      while (adjusted < previous && adjusted + 100 <= 300) adjusted += 100;
      fixed.push(adjusted);
      return;
    }

    if (
      previous !== undefined &&
      next !== undefined &&
      previous < next &&
      value > next + 5
    ) {
      fixed.push((previous + next) / 2);
      return;
    }

    fixed.push(value);
  });

  return fixed;
}

function normalizeMusinsaApparelSizeOptions(
  options: { colors: string[]; sizes: string[]; optionStockMap: Record<string, StockStatus> },
  sizeMeasurements: Record<string, Record<string, string>>,
  _categoryText: string,
  _buymaCategoryId: string,
) {
  return { ...options, sizeMeasurements };
}

function shouldNormalizeKoreanApparelSizeCodes(sizes: string[], categoryText: string, buymaCategoryId: string) {
  if (!sizes.length || !sizes.every(isKoreanApparelSizeCode)) return false;
  if (isMusinsaShoeCategory(categoryText, buymaCategoryId)) return false;
  return true;
}

function isKoreanApparelSizeCode(value: unknown) {
  const size = cleanText(value).replace(/^0+/, "");
  if (!/^\d{2,3}$/.test(size)) return false;
  const numeric = Number(size);
  return numeric >= 80 && numeric <= 130 && numeric % 5 === 0;
}

function normalizeKoreanApparelSizeCode(value: unknown) {
  const numeric = Number(cleanText(value).replace(/^0+/, ""));
  const mapped: Record<number, string> = {
    80: "XXS",
    85: "XS",
    90: "S",
    95: "M",
    100: "L",
    105: "XL",
    110: "2XL",
    115: "3XL",
    120: "4XL",
    125: "5XL",
    130: "6XL",
  };
  return mapped[numeric] || cleanText(value).toUpperCase();
}

function normalizeMusinsaStockSizeKeys(optionStockMap: Record<string, StockStatus>) {
  const normalized: Record<string, StockStatus> = {};

  Object.entries(optionStockMap).forEach(([key, stock]) => {
    setOptionStock(normalized, normalizeMusinsaStockSizeKey(key), stock);
  });

  return normalized;
}

function normalizeMusinsaStockSizeKey(key: string) {
  const [color, size] = key.split("|");
  if (size === undefined) return key;
  return `${color}|${isKoreanApparelSizeCode(size) ? normalizeKoreanApparelSizeCode(size) : size}`;
}

function normalizeMusinsaMeasurementSizeKeys(sizeMeasurements: Record<string, Record<string, string>>) {
  const normalized: Record<string, Record<string, string>> = {};

  Object.entries(sizeMeasurements).forEach(([size, measurements]) => {
    const nextSize = isKoreanApparelSizeCode(size) ? normalizeKoreanApparelSizeCode(size) : size;
    normalized[nextSize] = measurements;
  });

  return normalized;
}

function isMusinsaShoeCategory(categoryText: string, buymaCategoryId: string) {
  return /신발|슈즈|스니커|sneaker|shoes?|boots?|sandals?/i.test(categoryText) || ["3081", "3321"].includes(buymaCategoryId);
}

function setMusinsaMeasurementValue(row: Record<string, string>, label: string, value: string) {
  const mapping = resolveMusinsaMeasurementHeader(label);
  if (!mapping || isBlankMusinsaMeasurementValue(value)) return;

  const normalizedValue = mapping.multiplier === 2
    ? multiplyMusinsaMeasurementValue(value, mapping.multiplier)
    : normalizeMusinsaMeasurementValue(value);
  if (normalizedValue && !row[mapping.header]) row[mapping.header] = normalizedValue;
}

function isBlankMusinsaMeasurementValue(value: unknown) {
  return /^(?:null|undefined|-)?$/i.test(cleanText(value));
}

function resolveMusinsaMeasurementHeader(label: string): { header: string; multiplier?: number } | null {
  const normalized = cleanText(label).replace(/\s+/g, "").toLowerCase();
  if (!normalized) return null;

  if (["着丈", "전체길이", "총장", "총기장", "총길이", "옷길이", "기장", "length"].includes(normalized)) {
    return { header: "着丈" };
  }
  if (["肩幅", "어깨너비", "어깨넓이", "어깨폭", "어깨단면", "어깨", "shoulder", "shoulderwidth"].includes(normalized)) {
    return { header: "肩幅" };
  }
  if (["가슴단면", "가슴너비", "가슴폭", "품", "품단면", "단면가슴", "chestwidth", "pittopit", "pit-to-pit"].includes(normalized)) {
    return { header: "胸囲", multiplier: 2 };
  }
  if (["胸囲", "가슴둘레", "가슴", "흉위", "chest", "bust"].includes(normalized)) {
    return { header: "胸囲" };
  }
  if (["袖丈", "소매길이", "소매기장", "소매", "팔길이", "sleeve", "sleevelength"].includes(normalized)) {
    return { header: "袖丈" };
  }
  if (["ウエスト", "허리단면", "허리너비", "허리폭", "허리둘레", "허리", "waist", "waistwidth"].includes(normalized)) {
    return { header: "ウエスト" };
  }
  if (["ヒップ", "엉덩이단면", "엉덩이너비", "엉덩이폭", "엉덩이둘레", "엉덩이", "힙", "힙단면", "hip", "hips"].includes(normalized)) {
    return { header: "ヒップ" };
  }
  if (["股上", "밑위", "앞밑위", "rise", "frontrise"].includes(normalized)) {
    return { header: "股上" };
  }
  if (["すそ周り", "裾周り", "밑단", "밑단둘레", "밑단단면", "밑단너비", "밑단폭", "hem", "hemwidth", "legopening"].includes(normalized)) {
    return { header: "すそ周り" };
  }
  if (["手首周り", "소매둘레", "소매단면", "소매통", "袖口", "cuff"].includes(normalized)) {
    return { header: "手首周り" };
  }
  if (["もも周り", "허벅지단면", "허벅지너비", "허벅지폭", "허벅지둘레", "허벅지", "thigh", "thighwidth"].includes(normalized)) {
    return { header: "もも周り" };
  }
  if (["頭周り", "머리둘레", "머리둘래", "머리둘레cm", "headcircumference", "headsize"].includes(normalized)) {
    return { header: "頭周り" };
  }
  if (["高さ", "깊이", "모자깊이", "깊이감", "height", "depth", "capdepth"].includes(normalized)) {
    return { header: "高さ" };
  }
  if (["つば", "챙길이", "챙", "챙길이cm", "brim", "brimlength", "visor"].includes(normalized)) {
    return { header: "つば" };
  }

  return null;
}

function normalizeMusinsaMeasurementValue(value: unknown) {
  const text = cleanText(value).replace(/cm$/i, "").trim();
  const numberMatch = text.match(/^\d+(?:\.\d+)?$/);
  return numberMatch ? formatMusinsaMeasurementNumber(Number(text)) : text;
}

function multiplyMusinsaMeasurementValue(value: unknown, multiplier: number) {
  const text = cleanText(value).replace(/cm$/i, "").trim();
  if (!text) return "";

  const numberMatch = text.match(/^\d+(?:\.\d+)?$/);
  if (!numberMatch) return text;

  return formatMusinsaMeasurementNumber(Number(text) * multiplier);
}

function formatMusinsaMeasurementNumber(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function parseMusinsaOptions(json: Record<string, unknown>) {
  const colors = new Set<string>();
  const sizes = new Set<string>();
  const optionStockMap: Record<string, StockStatus> = {};
  const colorValueMap = new Map<string, string>();
  const sizeValueMap = new Map<string, string>();
  const optionKindByNo = new Map<string, MusinsaOptionKind>();
  const data = asRecord(json.data);
  const basicOptions = Array.isArray(data?.basic) ? data.basic : [];

  basicOptions.map(asRecord).filter(isRecord).forEach((option) => {
    const optionValues = Array.isArray(option.optionValues) ? option.optionValues : [];
    const kind = getMusinsaOptionKind(option, optionValues);
    const target = kind === "color" ? colors : kind === "size" ? sizes : null;

    if (!target || !kind) return;
    getOptionValueIds(option).forEach((id) => optionKindByNo.set(id, kind));
    optionValues.map(asRecord).filter(isRecord).forEach((value) => {
      const text = extractOptionValueName(value);
      if (text && !asRecord(value)?.isDeleted && (target === colors || isValidSizeName(text))) target.add(normalizeOptionText(text, kind));
      if (!text) return;

      const valueMap = target === colors ? colorValueMap : sizeValueMap;
      const normalizedText = normalizeOptionText(text, kind);
      getOptionValueIds(value).forEach((id) => valueMap.set(id, normalizedText));
      const stock = isSoldOutOption(value) ? "0" : "1";
      if (target === colors) setOptionStock(optionStockMap, normalizedText, stock);
      if (target === sizes) setOptionStock(optionStockMap, `|${normalizedText.toUpperCase()}`, stock);
    });
  });

  collectMusinsaOptionStocks(data, colors, sizes, optionStockMap, colorValueMap, sizeValueMap, optionKindByNo);
  const inventoryTargets = extractMusinsaInventoryTargets(data, colorValueMap, sizeValueMap, optionKindByNo);

  return { colors: [...colors], sizes: [...sizes], optionStockMap, inventoryTargets };
}

function getMusinsaOptionKind(option: Record<string, unknown>, optionValues: unknown[]): MusinsaOptionKind | null {
  const name = cleanText(option.name || option.optionName || option.displayName).toLowerCase();
  const namedKind = getMusinsaOptionKindFromName(name);
  if (namedKind) return namedKind;

  const values = optionValues.map(asRecord).filter(isRecord);
  if (values.some((value) => value.color || value.colorCode || value.rgb || value.imageUrl)) return "color";

  const valueNames = values.map(extractOptionValueName).filter(Boolean);
  if (valueNames.length > 0 && valueNames.every(isLikelySizeName)) return "size";
  if (valueNames.length > 0 && valueNames.some(isLikelyColorName)) return "color";

  return null;
}

function getMusinsaOptionKindFromName(name: string): MusinsaOptionKind | null {
  if (/color|colour|컬러|색상|색깔|색/.test(name)) return "color";
  if (/size|사이즈|치수/.test(name)) return "size";
  return null;
}

function normalizeOptionText(value: string, kind: MusinsaOptionKind) {
  const text = cleanText(value);
  return kind === "size" ? text.toUpperCase() : text;
}

function collectMusinsaOptionStocks(
  value: unknown,
  colors: Set<string>,
  sizes: Set<string>,
  optionStockMap: Record<string, StockStatus>,
  colorValueMap: Map<string, string>,
  sizeValueMap: Map<string, string>,
  optionKindByNo: Map<string, MusinsaOptionKind>,
  depth = 0,
) {
  if (!value || depth > 8) return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectMusinsaOptionStocks(item, colors, sizes, optionStockMap, colorValueMap, sizeValueMap, optionKindByNo, depth + 1));
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  const optionItemValues = extractOptionItemValues(record, optionKindByNo, colorValueMap, sizeValueMap);
  const optionLike = isOptionLikeRecord(record);
  const color = optionItemValues.color || extractMusinsaColorFromRecord(record) || (optionLike ? extractOptionText(record, [
    "color",
    "colorName",
    "colorNm",
    "optionValue1",
    "optionValueName1",
    "optionValueNm1",
    "managedOptionValue1",
    "optionName1",
    "displayValue1",
    "value1",
  ], colorValueMap) : "");
  const size = optionItemValues.size || (optionLike ? extractOptionText(record, [
    "size",
    "sizeName",
    "sizeNm",
    "optionValue2",
    "optionValueName2",
    "optionValueNm2",
    "managedOptionValue2",
    "optionName2",
    "displayValue2",
    "value2",
  ], sizeValueMap).toUpperCase() : "");
  const stock = isSoldOutOption(record) ? "0" : "1";

  if (color) colors.add(color);
  if (size && isValidSizeName(size)) sizes.add(size);
  if (color && size) setOptionStock(optionStockMap, `${color}|${size}`, stock);
  if (color) setOptionStock(optionStockMap, color, stock);
  if (size) setOptionStock(optionStockMap, `|${size}`, stock);

  Object.values(record).forEach((nested) => {
    if (nested && typeof nested === "object") {
      collectMusinsaOptionStocks(nested, colors, sizes, optionStockMap, colorValueMap, sizeValueMap, optionKindByNo, depth + 1);
    }
  });
}

function extractMusinsaInventoryTargets(
  data: Record<string, unknown> | null,
  colorValueMap: Map<string, string>,
  sizeValueMap: Map<string, string>,
  optionKindByNo: Map<string, MusinsaOptionKind>,
): MusinsaInventoryTarget[] {
  const optionItems = Array.isArray(data?.optionItems) ? data.optionItems.map(asRecord).filter(isRecord) : [];

  return optionItems.flatMap((optionItem) => {
    const optionItemNo = cleanText(optionItem.no || optionItem.optionItemNo || optionItem.goodsOptionItemNo);
    const optionValueNos = getOptionValueIdsByKeys(optionItem, ["optionValueNos", "optionValueNo", "optionValueIds", "optionValueId"]);
    if (!optionItemNo || optionValueNos.length === 0) return [];

    const optionItemValues = extractOptionItemValues(optionItem, optionKindByNo, colorValueMap, sizeValueMap);
    const color = optionItemValues.color || extractMusinsaColorFromRecord(optionItem);
    const size = optionItemValues.size;
    const stockKeys = getOptionStockKeys(color, size);
    if (stockKeys.length === 0) return [];

    return [{ optionItemNo, optionValueNos, stockKeys }];
  });
}

function getOptionStockKeys(color: string, size: string) {
  const keys = [];
  if (color && size) keys.push(`${color}|${size}`);
  if (size) keys.push(`|${size}`);
  if (color && !size) keys.push(color);
  return keys;
}

function extractMusinsaColorFromRecord(record: Record<string, unknown>) {
  const colorItems = Array.isArray(record.colors) ? record.colors.map(asRecord).filter(isRecord) : [];

  for (const colorItem of colorItems) {
    const mapped = mapMusinsaColorId(colorItem.colorCode || colorItem.colorId || colorItem.id);
    if (mapped) return mapped;
  }

  return mapMusinsaColorId(record.colorCode || record.colorId);
}

function mapMusinsaColorId(value: unknown) {
  const colorId = cleanText(value);
  return MUSINSA_COLOR_ID_MAP[colorId] ?? "";
}

function extractOptionItemValues(
  record: Record<string, unknown>,
  optionKindByNo: Map<string, MusinsaOptionKind>,
  colorValueMap: Map<string, string>,
  sizeValueMap: Map<string, string>,
) {
  let color = "";
  let size = "";
  const optionValues = Array.isArray(record.optionValues) ? record.optionValues.map(asRecord).filter(isRecord) : [];

  optionValues.forEach((optionValue) => {
    const kind =
      getMusinsaOptionKindFromName(cleanText(optionValue.optionName || optionValue.name).toLowerCase()) ||
      getOptionValueIds(optionValue).map((id) => optionKindByNo.get(id)).find(Boolean);
    const text = extractOptionValueName(optionValue);
    if (!kind || !text) return;
    if (kind === "color") color = normalizeOptionText(text, kind);
    if (kind === "size") size = normalizeOptionText(text, kind);
  });

  getOptionValueIdsByKeys(record, ["optionValueNos", "optionValueNo", "optionValueIds", "optionValueId"]).forEach((id) => {
    if (!color && colorValueMap.has(id)) color = colorValueMap.get(id) || "";
    if (!size && sizeValueMap.has(id)) size = (sizeValueMap.get(id) || "").toUpperCase();
  });

  return { color, size };
}

function setOptionStock(optionStockMap: Record<string, StockStatus>, key: string, stock: StockStatus) {
  if (!key) return;
  if (stock === "0" || !optionStockMap[key]) optionStockMap[key] = stock;
}

function extractOptionText(record: Record<string, unknown>, keys: string[], valueMap: Map<string, string>) {
  for (const key of keys) {
    const value = cleanOptionScalar(record[key]);
    const mapped = valueMap.get(value);
    if (mapped) return mapped;
    if (isLikelyOptionValueIdKey(key, value)) continue;
    if (value && value.length < 50 && !isIgnoredOptionName(value)) return value;
  }

  for (const id of getOptionValueIdsByKeys(record, keys)) {
    const mapped = valueMap.get(id);
    if (mapped) return mapped;
  }

  return "";
}

function isLikelyOptionValueIdKey(key: string, value: string) {
  return /^(optionValue|managedOptionValue|value)[12]$/i.test(key) && /^\d{1,2}$/.test(value);
}

function extractOptionValueName(record: Record<string, unknown>) {
  const preferredKeys = ["name", "displayName", "label", "valueName", "optionValueName", "optionValueNm"];
  for (const key of preferredKeys) {
    const value = cleanOptionScalar(record[key]);
    if (value && !isIgnoredOptionName(value)) return value;
  }

  const code = cleanOptionScalar(record.code);
  return code && !/^\d{1,2}$/.test(code) ? code : "";
}

function cleanOptionScalar(value: unknown) {
  if (typeof value === "boolean") return "";
  if (value && typeof value === "object") return "";
  const text = cleanText(value);
  if (!text || /^(true|false|null|undefined)$/i.test(text)) return "";
  return text;
}

function getOptionValueIds(record: Record<string, unknown>) {
  return getOptionValueIdsByKeys(record, [
    "no",
    "id",
    "code",
    "value",
    "optionValueNo",
    "optionValueId",
    "managedOptionValueNo",
    "managedOptionValueId",
  ]);
}

function getOptionValueIdsByKeys(record: Record<string, unknown>, keys: string[]) {
  const keySet = new Set(keys.map(normalizeObjectKey));
  return Object.entries(record)
    .filter(([key]) => keySet.has(normalizeObjectKey(key)) || /optionvalue(?:no|id|code)?[12]$/i.test(key))
    .flatMap(([, value]) => Array.isArray(value) ? value.map(cleanOptionScalar) : [cleanOptionScalar(value)])
    .filter(Boolean);
}

function isIgnoredOptionName(value: string) {
  return /my\s*size|사이즈\s*추천|추천\s*사이즈/i.test(value);
}

function isValidSizeName(value: string) {
  const size = cleanText(value).toUpperCase();
  return isLikelySizeName(size) && size !== "FREE SIZE";
}

function isLikelySizeName(value: string) {
  const size = cleanText(value).toUpperCase().replace(/\s+/g, "");
  if (!size || isIgnoredOptionName(size) || isLikelyColorName(size)) return false;
  return /^(XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-6]XL)(?:\(\d{2,3}\))?$/.test(size) ||
    /^(XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL)(?:\/?(?:XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL))+$/.test(size) ||
    /^(OS|F|FREE|ONESIZE|ONE)(?:\([A-Z0-9]+\))?$/.test(size) ||
    /^\d\([A-Z0-9]+\)$/.test(size) ||
    /^\d{2,3}(?:\([A-Z0-9]+\))?$/.test(size) ||
    /^\d{2,3}(?:CM|MM)$/.test(size);
}

function isLikelyColorName(value: string) {
  const color = cleanText(value).toUpperCase().replace(/[^A-Z0-9가-힣]/g, "");
  return /^(BLACK|BLK|BK|BKS|WHITE|WHT|WH|IVORY|CREAM|GRAY|GREY|CHARCOAL|BROWN|BEIGE|GREEN|KHAKI|BLUE|NAVY|PURPLE|YELLOW|PINK|RED|ORANGE|SILVER|GOLD|CLEAR|MULTI|블랙|검정|검정색|화이트|흰색|아이보리|크림|그레이|회색|차콜|브라운|갈색|베이지|그린|초록|카키|블루|파랑|네이비|남색|퍼플|보라|옐로우|노랑|핑크|분홍|레드|빨강|오렌지|주황|실버|은색|골드|금색|투명|멀티)$/.test(color);
}

function isValidColorName(value: string) {
  const color = cleanText(value).toUpperCase();
  if (!color || /^(W|M|F|WOMEN|WOMAN|MEN|MAN|여성|남성|공용|UNISEX)$/.test(color)) return false;
  return isLikelyColorName(color) || isLikelyColorName(convertColorToEnglish(color));
}

function extractColorsFromText(values: unknown[]) {
  const text = values.map(cleanText).join(" ");
  const matches = text.match(/\b(BLACK|BLK|BK|BKS|WHITE|WHT|WH|IVORY|CREAM|GRAY|GREY|CHARCOAL|BROWN|BEIGE|GREEN|KHAKI|BLUE|NAVY|PURPLE|YELLOW|PINK|RED|ORANGE|SILVER|GOLD|CLEAR|MULTI)\b/gi) ?? [];
  return matches.map(convertColorToEnglish);
}

function resolveMusinsaColors(
  productData: Record<string, unknown> | null,
  apiColors: string[],
  titleValues: unknown[],
) {
  const normalizedApiColors = unique(apiColors.filter(isValidColorName).map(convertColorToEnglish));
  const titleColors = unique(extractColorsFromText(titleValues).filter(isValidColorName).map(convertColorToEnglish));

  if (normalizedApiColors.length === 1 && titleColors.length === 1) return titleColors;
  if (normalizedApiColors.length > 0) return normalizedApiColors;

  return unique([
    ...extractOptionValues(productData, ["color", "colors", "colorName"]),
    ...titleColors,
  ].filter(isValidColorName).map(convertColorToEnglish));
}

function isOptionLikeRecord(record: Record<string, unknown>) {
  return Object.keys(record).some((key) =>
    /option|stock|sold|remain|inventory|quantity|buyable|orderable|available|disabled|enable|status/i.test(key),
  );
}

function isSoldOutOption(record: Record<string, unknown>) {
  return (
    record.soldOut === true ||
    record.isSoldOut === true ||
    record.isSoldout === true ||
    record.outOfStock === true ||
    record.activated === false ||
    record.active === false ||
    record.isDeleted === true ||
    record.disabled === true ||
    record.enable === false ||
    record.enabled === false ||
    record.buyable === false ||
    record.orderable === false ||
    record.buyPossible === false ||
    record.purchasable === false ||
    isSoldOutStatus(record.status) ||
    isSoldOutStatus(record.saleStatus) ||
    isSoldOutStatus(record.stockStatus) ||
    isSoldOutStatus(record.displayStatus) ||
    isZeroStockValue(record.remainCount) ||
    isZeroStockValue(record.remainQty) ||
    isZeroStockValue(record.quantity) ||
    isZeroStockValue(record.stock) ||
    isZeroStockValue(record.stockCount) ||
    isZeroStockValue(record.inventoryCount) ||
    isZeroStockValue(record.stockQuantity) ||
    isZeroStockValue(record.availableStock) ||
    isZeroStockValue(record.managedStock) ||
    isZeroStockValue(record.outletStock)
  );
}

function isSoldOutStatus(value: unknown) {
  return /SOLD_OUT|OUT_OF_STOCK|STOP|HIDDEN/i.test(cleanText(value));
}

function isZeroStockValue(value: unknown) {
  if (value === undefined || value === null || value === "") return false;
  return Number(value) === 0;
}

function resolveMusinsaPrice(
  productData: Record<string, unknown> | null,
  jsonLd: Record<string, unknown> | null,
) {
  const offers = asRecord(jsonLd?.offers);
  const goodsPrice = asRecord(productData?.goodsPrice);
  const candidates = [
    productData?.salePrice,
    productData?.sellingPrice,
    productData?.discountPrice,
    typeof productData?.goodsPrice === "object" ? goodsPrice?.salePrice : productData?.goodsPrice,
    goodsPrice?.couponPrice,
    goodsPrice?.normalPrice,
    productData?.normalPrice,
    productData?.price,
    offers?.price,
    offers?.lowPrice,
  ];

  for (const candidate of candidates) {
    const price = parsePrice(candidate);
    if (price > 0) return price;
  }

  return 0;
}

function resolveMusinsaModelNumber(productData: Record<string, unknown> | null, productId = "") {
  const trustedModelKeys = [
    "styleCode",
    "articleNumber",
    "styleNumber",
    "styleNo",
    "modelNumber",
    "goodsCode",
    "itemCode",
    "productCode",
  ];
  const weakModelKeys = [
    "code",
    "sku",
  ];
  const nestedModelKeys = trustedModelKeys.filter((key) => key !== "productCode");

  for (const key of trustedModelKeys) {
    const value = cleanModelNumber(productData?.[key], productId);
    if (value) return value;
  }

  const nested = findNestedModelNumber(productData, nestedModelKeys, productId);
  const nestedModel = cleanModelNumber(nested, productId);
  if (nestedModel) return nestedModel;

  for (const key of weakModelKeys) {
    const value = cleanModelNumber(productData?.[key], productId);
    if (value && looksLikeStyleCode(value)) return value;
  }

  return "";
}

function findNestedModelNumber(value: unknown, keys: string[], productId = "", depth = 0): unknown {
  if (depth > 7) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedModelNumber(item, keys, productId, depth + 1);
      if (found) return found;
    }
    return "";
  }

  const record = asRecord(value);
  if (!record) return "";

  for (const key of keys) {
    if (key in record) {
      const found = cleanModelNumber(record[key], productId);
      if (found) return found;
    }
  }

  for (const nested of Object.values(record)) {
    const found = findNestedModelNumber(nested, keys, productId, depth + 1);
    if (found) return found;
  }

  return "";
}

function cleanModelNumber(value: unknown, productId = "") {
  const text = cleanText(value);
  if (!text || text.length < 2 || text.length > 40) return "";
  if (productId && text === productId) return "";
  if (/^\d+$/.test(text)) return "";
  if (!/[A-Z0-9]/i.test(text)) return "";
  return text;
}

function extractKnownStyleCode(values: unknown[], productId = "") {
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;

    const patterns = [
      /\b[A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*-[A-Z0-9][A-Z0-9-]{1,}\b/i,
      /\b[A-Z0-9]{2,}[-_][A-Z0-9_-]{2,}\b/i,
    ];

    for (const pattern of patterns) {
      const found = cleanModelNumber(text.match(pattern)?.[0], productId);
      if (found) return found;
    }
  }

  return "";
}

function looksLikeStyleCode(value: string) {
  return /[A-Z]/i.test(value) && /\d/.test(value);
}

function resolveMusinsaSeason(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  html: string,
  titleCandidates: unknown[],
) {
  const candidates = [
    ...buildSeasonCandidates(productData),
    ...buildSeasonCandidates(apiProductData),
    ...SEASON_KEYS.flatMap((key) => [productData?.[key], apiProductData?.[key]]),
    ...findNestedValuesByKeys(productData, SEASON_KEYS),
    ...findNestedValuesByKeys(apiProductData, SEASON_KEYS),
    ...titleCandidates,
    extractSeasonFromHtml(html),
  ];

  for (const candidate of candidates) {
    const seasonId = mapSeasonToBuymaId(candidate);
    if (seasonId) return seasonId;
  }

  return "";
}

function buildSeasonCandidates(record: Record<string, unknown> | null) {
  if (!record) return [];
  const years = [
    ...SEASON_YEAR_KEYS.map((key) => record[key]),
    ...findNestedValuesByKeys(record, SEASON_YEAR_KEYS),
  ].map(firstSeasonPart).filter(Boolean);
  const types = [
    ...SEASON_TYPE_KEYS.map((key) => record[key]),
    ...SEASON_KEYS.map((key) => record[key]),
    ...findNestedValuesByKeys(record, [...SEASON_TYPE_KEYS, ...SEASON_KEYS]),
  ].map(firstSeasonPart).filter(Boolean);

  return years.flatMap((year) => types.map((type) => `${year}${type}`));
}

function extractSeasonFromHtml(html: string) {
  const text = decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+/g, " ");
  return (
    text.match(/(?:시즌|SEASON|season)\s*[:：]?\s*((?:19|20)\d{2}(?:[-\s]?\d{2,4})?\s*(?:SS|S\/S|AW|A\/W|FW|F\/W|Cruise)?)/i)?.[1] ||
    text.match(/\b((?:19|20)\d{2}(?:[-\s]?\d{2,4})?\s*(?:SS|S\/S|AW|A\/W|FW|F\/W|Cruise))\b/i)?.[1] ||
    ""
  );
}

function mapSeasonToBuymaId(value: unknown) {
  const normalized = normalizeSeasonText(value);
  if (!normalized) return "";

  const exact = BUYMA_SEASONS.find((season) => normalizeSeasonText(season.label) === normalized);
  if (exact) return exact.id;

  const match = normalized.match(/((?:19|20)\d{2})(?:[-\s]?((?:19|20)?\d{2}))?\s*(SS|AW|FW|CRUISE)?/);
  if (!match) return "";

  const startYear = match[1];
  const endYearRaw = match[2] || "";
  const type = match[3] === "FW" ? "AW" : match[3] || "";
  const endYear = endYearRaw.length === 2 ? `${startYear.slice(0, 2)}${endYearRaw}` : endYearRaw;
  const matched = BUYMA_SEASONS.find((season) => {
    const label = normalizeSeasonText(season.label);
    if (!label.includes(startYear)) return false;
    if (endYear && !label.includes(endYear)) return false;
    if (type && !label.includes(type)) return false;
    return true;
  });

  return matched?.id ?? "";
}

function mapMusinsaCategoryToBuymaId(value: unknown) {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";

  const isMen = /남성|mens?|man\b/.test(text);
  const gendered = (womenId: string, menId: string) => (isMen ? menId : womenId);

  if (/스니커|sneaker/.test(text)) return gendered("3081", "3321");
  if (/후드|후디|파카|hood/.test(text)) return gendered("3005", "3264");
  if (/스웨트|맨투맨|sweat/.test(text)) return gendered("3006", "3265");
  if (/셔츠|shirt|블라우스/.test(text)) return gendered("3007", "3263");
  if (/티셔츠|t-?shirt|긴소매|반소매|슬리브리스|상의/.test(text)) return gendered("3001", "3260");
  if (/데님|청바지|jean/.test(text)) return gendered("3024", "3281");
  if (/쇼츠|반바지|short/.test(text)) return gendered("3023", "3282");
  if (/팬츠|바지|pants|trouser/.test(text)) return gendered("3022", "3285");
  if (/스커트|skirt/.test(text)) return "3020";
  if (/원피스|dress/.test(text)) return "3040";
  if (/셋업|setup|set up/.test(text)) return "4103";
  if (/다운/.test(text)) return gendered("3062", "3302");
  if (/코트|coat/.test(text)) return gendered("3060", "3300");
  if (/재킷|자켓|jacket/.test(text)) return gendered("3061", "3301");

  return "";
}

function resolveProductStockStatus(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  optionStockMap: Record<string, StockStatus>,
): StockStatus {
  if (
    isSoldOutOption(productData ?? {}) ||
    isSoldOutOption(apiProductData ?? {})
  ) {
    return "0";
  }

  const stockValues = Object.values(optionStockMap);
  if (stockValues.length > 0 && stockValues.every((stock) => stock === "0")) return "0";

  return "1";
}

function normalizeSeasonText(value: unknown) {
  return cleanText(value)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/SPRING\s*\/?\s*SUMMER|S\/S/gi, "SS")
    .replace(/FALL\s*\/?\s*WINTER|AUTUMN\s*\/?\s*WINTER|F\/W|A\/W/gi, "AW")
    .replace(/\s+/g, "")
    .replace(/CRUISE/gi, "CRUISE")
    .toUpperCase();
}

function extractModelNumberFromHtml(html: string, productId = "") {
  const text = decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+/g, " ");
  const labelPatterns = [
    /(?:품번|상품코드|品番)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,39})/i,
    /\b(?:style|article)\s*[:：#]\s*([A-Za-z0-9][A-Za-z0-9_-]{2,39})/i,
  ];

  for (const pattern of labelPatterns) {
    const found = cleanModelNumber(text.match(pattern)?.[1], productId);
    if (found) return found;
  }

  return "";
}

async function fetchHtml(url: string, referer: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: referer,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) throw new Error(`상품 페이지 요청 오류: ${response.status}`);
  return response.text();
}

function extractJsonLdProduct(html: string) {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const script of scripts) {
    const raw = decodeHtml(script[1]);
    try {
      const parsed = JSON.parse(raw) as unknown;
      const product = findProductJsonLd(parsed);
      if (product) return product;
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return null;
}

function findProductJsonLd(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductJsonLd(item);
      if (found) return found;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  if (record["@type"] === "Product") return record;
  const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [];
  return findProductJsonLd(graph);
}

function extractNextDataProduct(html: string) {
  const raw = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeHtml(raw)) as unknown;
    return findLikelyProductRecord(parsed);
  } catch {
    return null;
  }
}

function extractMusinsaStateProduct(html: string) {
  const raw = html.match(/window\.__MSS__\.product\.state\s*=\s*(\{[\s\S]*?\});/i)?.[1];
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeRecords(...records: Array<Record<string, unknown> | null>) {
  const merged: Record<string, unknown> = {};
  records.filter(isRecord).forEach((record) => Object.assign(merged, record));
  return Object.keys(merged).length ? merged : null;
}

function findLikelyProductRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLikelyProductRecord(item);
      if (found) return found;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const productKeys = ["goodsName", "productName", "goodsNo", "sellingPrice", "salePrice"];
  if (productKeys.some((key) => key in record)) return record;

  for (const nested of Object.values(record)) {
    const found = findLikelyProductRecord(nested);
    if (found) return found;
  }

  return null;
}

function extractOptionValues(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return [];
  const values: string[] = [];
  const keySet = new Set(keys.map(normalizeObjectKey));

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === "string" || typeof value === "number") {
      const text = cleanOptionScalar(value);
      if (text) values.push(text);
      return;
    }

    const nested = asRecord(value);
    if (!nested) return;

    for (const [key, nestedValue] of Object.entries(nested)) {
      if (keySet.has(normalizeObjectKey(key))) {
        if (Array.isArray(nestedValue)) nestedValue.forEach(visit);
        else {
          const text = cleanOptionScalar(nestedValue);
          if (text) values.push(text);
        }
      } else if (typeof nestedValue === "object") {
        visit(nestedValue);
      }
    }
  }

  visit(record);
  return values.filter((value) => value.length > 0 && value.length < 40 && !/^(true|false)$/i.test(value));
}

function normalizeImageList(value: unknown, baseUrl: URL) {
  return flattenValues(value)
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return cleanText(record?.imageUrl || record?.url || record?.src || record?.originUrl || record?.imageSource);
    })
    .map((imageUrl) => normalizeUrl(imageUrl, baseUrl))
    .filter(Boolean);
}

function resolveMusinsaProductImages(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  jsonLd: Record<string, unknown> | null,
  html: string,
  baseUrl: URL,
) {
  const mainImages = unique([
    ...normalizeImageList(productData?.thumbnailImageUrl, baseUrl),
    ...normalizeImageList(apiProductData?.thumbnailImageUrl, baseUrl),
    ...normalizeImageList(productData?.mainImage, baseUrl),
    ...normalizeImageList(apiProductData?.mainImage, baseUrl),
    ...normalizeImageList(productData?.goodsImage, baseUrl),
    ...normalizeImageList(apiProductData?.goodsImage, baseUrl),
    ...normalizeImageList(productData?.representImage, baseUrl),
    ...normalizeImageList(apiProductData?.representImage, baseUrl),
    ...normalizeImageList(jsonLd?.image, baseUrl).slice(0, 1),
    ...normalizeImageList(extractMeta(html, "og:image"), baseUrl),
  ]).filter(isGalleryImageUrl);

  const subImages = unique([
    ...normalizeImageList(productData?.goodsImages, baseUrl),
    ...normalizeImageList(apiProductData?.goodsImages, baseUrl),
    ...normalizeImageList(productData?.images, baseUrl),
    ...normalizeImageList(apiProductData?.images, baseUrl),
    ...normalizeImageList(productData?.productImages, baseUrl),
    ...normalizeImageList(apiProductData?.productImages, baseUrl),
    ...normalizeImageList(productData?.imageList, baseUrl),
    ...normalizeImageList(apiProductData?.imageList, baseUrl),
    ...normalizeImageList(productData?.gallery, baseUrl),
    ...normalizeImageList(apiProductData?.gallery, baseUrl),
    ...normalizeImageList(productData?.goodsImageList, baseUrl),
    ...normalizeImageList(apiProductData?.goodsImageList, baseUrl),
  ]).filter(isMusinsaProductImageUrl);

  const productImages = unique([...mainImages, ...subImages]).filter(isGalleryImageUrl);
  if (productImages.length > 0) return productImages.slice(0, 20);

  return unique([
    ...normalizeImageList(findNestedValuesByKeys(productData, IMAGE_VALUE_KEYS), baseUrl),
    ...normalizeImageList(findNestedValuesByKeys(apiProductData, IMAGE_VALUE_KEYS), baseUrl),
    ...extractImageUrlsFromHtml(html, baseUrl),
  ]).filter(isGalleryImageUrl).slice(0, 1);
}

function resolveMusinsaBrandLogo(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  html: string,
  baseUrl: URL,
) {
  const brandInfo = asRecord(productData?.brandInfo) || asRecord(apiProductData?.brandInfo);
  const candidates = unique([
    ...BRAND_LOGO_VALUE_KEYS.flatMap((key) => [
      productData?.[key],
      apiProductData?.[key],
      brandInfo?.[key],
    ]).flatMap((value) => normalizeImageList(value, baseUrl)),
    ...normalizeImageList(findNestedValuesByKeys(productData, BRAND_LOGO_VALUE_KEYS), baseUrl),
    ...normalizeImageList(findNestedValuesByKeys(apiProductData, BRAND_LOGO_VALUE_KEYS), baseUrl),
    ...extractImageUrlsFromHtml(html, baseUrl).filter(isLogoImageUrl),
  ]);

  return candidates.find(isLogoImageUrl) || "";
}

function normalizeUrl(value: string, baseUrl: URL) {
  if (!value) return "";
  try {
    let source = value;
    if (source.startsWith("/images/")) source = `https://image.msscdn.net${source}`;
    let normalized = new URL(source, baseUrl).toString().split("?")[0].split("#")[0];
    if (normalized.includes("msscdn.net") || normalized.includes("musinsa.com")) {
      normalized = normalized.replace(/_(125|250|320|400|500|600|800|1000|1200)\.(?=jpg|jpeg|png|gif|webp)/gi, "_big.");
    }
    return normalized;
  } catch {
    return "";
  }
}

function flattenValues(value: unknown, depth = 0): unknown[] {
  if (!value || depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => flattenValues(item, depth + 1));
  return [value];
}

function findNestedValuesByKeys(value: unknown, keys: string[], depth = 0): unknown[] {
  if (!value || depth > 8) return [];
  if (Array.isArray(value)) return value.flatMap((item) => findNestedValuesByKeys(item, keys, depth + 1));

  const record = asRecord(value);
  if (!record) return [];

  const keySet = new Set(keys.map(normalizeObjectKey));
  const values: unknown[] = [];
  for (const [key, nestedValue] of Object.entries(record)) {
    if (keySet.has(normalizeObjectKey(key))) values.push(nestedValue);
    if (nestedValue && typeof nestedValue === "object") {
      values.push(...findNestedValuesByKeys(nestedValue, keys, depth + 1));
    }
  }

  return values;
}

function normalizeObjectKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractImageUrlsFromHtml(html: string, baseUrl: URL) {
  const source = decodeHtml(html)
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");
  const matches = source.matchAll(/(?:https?:)?\/\/[^"'<>)\s\\]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>)\s\\]*)?/gi);
  return [...matches]
    .map((match) => normalizeUrl(match[0].startsWith("//") ? `https:${match[0]}` : match[0], baseUrl))
    .filter(Boolean);
}

function isGalleryImageUrl(value: string) {
  if (!value || !value.startsWith("http")) return false;
  const src = value.toLowerCase();
  if (
    src.includes("/icon") ||
    src.includes("/logo") ||
    src.includes("/badge") ||
    src.includes("/btn_") ||
    src.includes("/bg_") ||
    src.includes("/arrow") ||
    src.includes("/static/") ||
    src.includes("/assets/") ||
    src.includes("favicon") ||
    src.includes("campaign_service") ||
    src.includes("1x1") ||
    src.includes("spacer") ||
    src.includes(".gif") ||
    src.includes(".svg") ||
    src.includes("loading") ||
    src.includes("placeholder") ||
    src.includes("/_brand/") ||
    src.includes("/_simbols/") ||
    src.includes("/_flag/") ||
    src.includes("/size_type/") ||
    src.includes("/goodsdetail/banner/") ||
    src.includes("/snap/images/") ||
    src.includes("/images/snap/") ||
    src.includes("/images/review/") ||
    src.includes("/images/photo_review/") ||
    src.includes("/images/profile/") ||
    src.includes("/images/avatar/") ||
    src.includes("/images/comment/") ||
    src.includes("/data/estimate/")
  ) {
    return false;
  }

  if (
    (src.includes("msscdn.net") || src.includes("musinsa.com")) &&
    !src.includes("/goods_img/") &&
    !src.includes("/prd_img/")
  ) {
    return false;
  }

  return true;
}

function isMusinsaProductImageUrl(value: string) {
  if (!value || !value.startsWith("http")) return false;
  const src = value.toLowerCase();
  return (src.includes("msscdn.net") || src.includes("musinsa.com")) &&
    (src.includes("/goods_img/") || src.includes("/prd_img/"));
}

function isLogoImageUrl(value: string) {
  if (!value || !value.startsWith("http")) return false;
  const src = value.toLowerCase();
  if (!(src.includes("msscdn.net") || src.includes("musinsa.com"))) return false;
  if (src.includes(".svg") || src.includes(".gif")) return false;
  return src.includes("logo") ||
    src.includes("/brand/") ||
    src.includes("/_brand/") ||
    src.includes("/brand_logo/") ||
    src.includes("/brandlogo/");
}

function resolveMusinsaDescription(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
  jsonLd: Record<string, unknown> | null,
  html: string,
) {
  const brandInfo = asRecord(productData?.brandInfo) || asRecord(apiProductData?.brandInfo);
  const brandDescription = firstMeaningfulString([
    ...BRAND_DESCRIPTION_KEYS.flatMap((key) => [
      productData?.[key],
      apiProductData?.[key],
      brandInfo?.[key],
    ]),
    ...findNestedValuesByKeys(productData, BRAND_DESCRIPTION_KEYS),
    ...findNestedValuesByKeys(apiProductData, BRAND_DESCRIPTION_KEYS),
  ]);
  const productDescription = firstMeaningfulDescription([
    ...DESCRIPTION_KEYS.flatMap((key) => [productData?.[key], apiProductData?.[key]]),
    jsonLd?.description,
    extractDescriptionFromHtml(html),
  ]);

  return productDescription || brandDescription;
}

function resolveMusinsaBrandDescription(
  productData: Record<string, unknown> | null,
  apiProductData: Record<string, unknown> | null,
) {
  const brandInfo = asRecord(productData?.brandInfo) || asRecord(apiProductData?.brandInfo);
  return firstMeaningfulString([
    ...BRAND_DESCRIPTION_KEYS.flatMap((key) => [
      productData?.[key],
      apiProductData?.[key],
      brandInfo?.[key],
    ]),
    ...findNestedValuesByKeys(productData, BRAND_DESCRIPTION_KEYS),
    ...findNestedValuesByKeys(apiProductData, BRAND_DESCRIPTION_KEYS),
  ]);
}

function firstMeaningfulDescription(values: unknown[]) {
  for (const value of values) {
    const text = typeof value === "string" || typeof value === "number" ? cleanText(String(value)) : "";
    if (isImageOnlyDescription(text)) return text;
    if (text && htmlToText(text).length >= 10 && !isNoisyMusinsaDescription(text)) return text;
  }

  return "";
}

function isImageOnlyDescription(value: string) {
  return /<img\b/i.test(value);
}

function isNoisyMusinsaDescription(value: string) {
  const text = htmlToText(value);
  return /쿠폰|첫\s*구매|혜택보기|받으러\s*가기/.test(text);
}

function extractDescriptionFromHtml(html: string) {
  const source = decodeHtml(html)
    .replace(/\\u002F/gi, "/")
    .replace(/\\n/g, "\n");
  const patterns = [
    /"goodsDescription"\s*:\s*"((?:\\"|[^"])*)"/i,
    /"detailContent"\s*:\s*"((?:\\"|[^"])*)"/i,
    /"description"\s*:\s*"((?:\\"|[^"])*)"/i,
  ];

  for (const pattern of patterns) {
    const text = decodeJsonString(pattern.exec(source)?.[1] || "");
    if (text && htmlToText(text).length >= 10) return text;
  }

  return "";
}

function decodeJsonString(value: string) {
  if (!value) return "";
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\u002F/gi, "/");
  }
}

function firstMeaningfulString(values: unknown[]) {
  for (const value of values) {
    const text = typeof value === "string" || typeof value === "number" ? cleanText(String(value)) : "";
    if (text && htmlToText(text).length >= 10) return text;
  }

  return "";
}

function firstSeasonPart(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? cleanText(String(value)) : "";
  if (!text) return "";
  return text.match(/(?:19|20)\d{2}|SS|S\/S|AW|A\/W|FW|F\/W|CRUISE/i)?.[0] ?? text;
}

function extractMeta(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
  return match ? decodeHtml(match[1]) : "";
}

function cleanMusinsaPageTitle(value: string) {
  return cleanText(value)
    .replace(/\s*[-|]\s*(MUSINSA|무신사).*$/i, "")
    .replace(/\s*-\s*.*?셀렉트샵.*$/i, "")
    .trim();
}

function htmlToText(html: string) {
  const text = decodeHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);

  return stripMusinsaDescriptionNoise(text);
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function extractEnglishPhrase(value: string) {
  return cleanText(value.match(/[A-Za-z][A-Za-z0-9\s&.'-]{5,}/)?.[0]);
}

function unique(values: string[]) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}
