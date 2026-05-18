export type BuymaCompetitorPriceItem = {
  title: string;
  price: number;
  shopper: string;
  brand?: string;
  itemUrl?: string;
};

export type BuymaCompetitorPriceResponse =
  | {
      ok: true;
      searchUrl: string;
      checkedAt: string;
      results: BuymaCompetitorPriceItem[];
    }
  | { ok: false; error: string };

export type BuymaCompetitorPriceComparisonInput = {
  results: BuymaCompetitorPriceItem[];
  ownerName: string;
  ownPrice: number;
  title?: string;
  modelNumber?: string;
  searchKeyword?: string;
};

const SHOPPER_LABELS = new Set([
  "PERSONAL SHOPPER",
  "PREMIUM PERSONAL SHOPPER",
  "SHOP",
]);

const SKIP_TITLE_LINES = new Set([
  "商品情報を編集",
  "タイムセール",
  "関税負担なし",
  "返品補償",
  "スピード配送",
]);

export function normalizeBuymaShopperName(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function compareBuymaCompetitorPrices({
  results,
  ownerName,
  ownPrice,
  title,
  modelNumber,
  searchKeyword,
}: BuymaCompetitorPriceComparisonInput) {
  const ownerKey = normalizeBuymaShopperName(ownerName);
  const ownResult =
    results.find(
      (item) =>
        normalizeBuymaShopperName(item.shopper) === ownerKey &&
        isMatchingBuymaProduct(item, { title, modelNumber, searchKeyword }),
    ) ??
    results.find((item) => normalizeBuymaShopperName(item.shopper) === ownerKey);
  const referencePrice = ownResult?.price ?? ownPrice;
  const lowerCompetitors = referencePrice
    ? results.filter(
        (item) =>
          normalizeBuymaShopperName(item.shopper) !== ownerKey &&
          item.price < referencePrice &&
          isMatchingBuymaProduct(item, { title, modelNumber, searchKeyword }),
      )
    : [];

  return {
    ownResult,
    referencePrice,
    lowerCompetitors,
  };
}

export function parseBuymaSearchResults(html: string, baseUrl: string): BuymaCompetitorPriceItem[] {
  const text = htmlToText(html);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const items: BuymaCompetitorPriceItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const price = parseYenPrice(lines[index]);
    if (!price) continue;

    const shopperInfo = findShopper(lines, index + 1);
    if (!shopperInfo) continue;

    const title = findTitle(lines, index);
    if (!title) continue;

    const brand = findBrand(lines, index + 1, shopperInfo.labelIndex);
    const itemUrl = findNearbyItemUrl(html, title, baseUrl);
    items.push({ title, price, shopper: shopperInfo.name, brand, itemUrl });
  }

  return dedupeItems(items).slice(0, 80);
}

export function buildBuymaSearchUrl(keyword: string) {
  const normalized = normalizeBuymaSearchKeyword(keyword);
  if (!normalized) return "";

  return `https://www.buyma.com/r/${encodeURIComponent(normalized)}/`;
}

export function validatePublicBuymaUrl(value: string) {
  let url: URL;

  try {
    url = value.startsWith("/") ? new URL(value, "https://www.buyma.com") : new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "www.buyma.com" && hostname !== "buyma.com") return null;

  const blockedPrefixes = [
    "/login/",
    "/my/",
    "/mypage/",
    "/cart/",
    "/payment/",
    "/reg/",
    "/register/",
    "/inquiry/",
    "/buycnf/",
    "/itemdetails/",
  ];
  if (blockedPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return null;

  if (!url.pathname.startsWith("/r/") && !url.pathname.startsWith("/brand/")) return null;

  return url.toString();
}

export async function fetchBuymaCompetitorPrices(input: {
  searchUrl?: string;
  keyword?: string;
}): Promise<BuymaCompetitorPriceResponse> {
  const rawSearchUrl = input.searchUrl?.trim() ?? "";
  const keyword = input.keyword?.trim() ?? "";
  const searchUrl = rawSearchUrl ? validatePublicBuymaUrl(rawSearchUrl) : validatePublicBuymaUrl(buildBuymaSearchUrl(keyword));

  if (!searchUrl) {
    return {
      ok: false,
      error: "BUYMA 검색 URL 또는 검색어를 입력해 주세요.",
    };
  }

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BuymaPriceChecker/1.0)",
        "Accept-Language": "ja,en;q=0.8,ko;q=0.7",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `BUYMA 검색 결과를 가져오지 못했습니다. (${response.status})`,
      };
    }

    const html = await response.text();
    const results = parseBuymaSearchResults(html, searchUrl);

    return {
      ok: true,
      searchUrl,
      checkedAt: new Date().toISOString(),
      results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "BUYMA 가격 확인에 실패했습니다.";
    return { ok: false, error: message };
  }
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "\n")
      .replace(/<(br|li|p|div|section|article|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "\n")
      .replace(/\u00a0/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function parseYenPrice(value: string) {
  const match = value.match(/¥\s*([\d,]+)/);
  if (!match) return null;

  const price = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(price) && price > 0 ? price : null;
}

function findShopper(lines: string[], startIndex: number) {
  const endIndex = Math.min(lines.length, startIndex + 18);

  for (let index = startIndex; index < endIndex; index += 1) {
    if (!SHOPPER_LABELS.has(lines[index])) continue;

    const name = lines[index + 1]?.trim();
    if (name) return { labelIndex: index, name };
  }

  return null;
}

function findTitle(lines: string[], priceIndex: number) {
  for (let index = priceIndex - 1; index >= Math.max(0, priceIndex - 8); index -= 1) {
    const line = lines[index];
    if (!line || SKIP_TITLE_LINES.has(line)) continue;
    if (line.startsWith("¥")) continue;
    if (/^\d+%OFF/.test(line)) continue;
    return line;
  }

  return "";
}

function findBrand(lines: string[], startIndex: number, shopperLabelIndex: number) {
  for (let index = shopperLabelIndex - 1; index >= startIndex; index -= 1) {
    const line = lines[index];
    if (!line || line.includes("送料込") || line.includes("OFF")) continue;
    if (SKIP_TITLE_LINES.has(line)) continue;
    return line;
  }

  return undefined;
}

function findNearbyItemUrl(html: string, title: string, baseUrl: string) {
  const titleIndex = html.indexOf(title);
  if (titleIndex < 0) return undefined;

  const chunk = html.slice(Math.max(0, titleIndex - 1200), titleIndex + 1200);
  const hrefMatches = [...chunk.matchAll(/href=["']([^"']*\/item\/\d+\/[^"']*)["']/gi)];
  const href = hrefMatches.at(-1)?.[1];
  if (!href) return undefined;

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function dedupeItems(items: BuymaCompetitorPriceItem[]) {
  const seen = new Set<string>();
  const deduped: BuymaCompetitorPriceItem[] = [];

  items.forEach((item) => {
    const key = `${item.title}|${item.price}|${normalizeBuymaShopperName(item.shopper)}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });

  return deduped;
}

function isMatchingBuymaProduct(
  item: BuymaCompetitorPriceItem,
  target: Pick<BuymaCompetitorPriceComparisonInput, "title" | "modelNumber" | "searchKeyword">,
) {
  const candidateText = normalizeComparableText([item.title, item.brand].filter(Boolean).join(" "));
  const modelNumber = normalizeModelNumberForMatch(target.modelNumber ?? "");
  const candidateModelText = candidateText.replace(/\s+/g, "");

  if (modelNumber && candidateModelText.includes(modelNumber)) return true;

  const brandTokens = new Set(tokenizeComparableText(target.searchKeyword ?? "").filter(isBrandLikeToken));
  const targetTokens = tokenizeComparableText(target.title ?? target.searchKeyword ?? "")
    .filter((token) => !brandTokens.has(token))
    .filter(isProductToken);
  const candidateTokens = new Set(tokenizeComparableText([item.title, item.brand].filter(Boolean).join(" ")));

  if (!targetTokens.length) return true;

  return targetTokens.every((token) => candidateTokens.has(token));
}

function normalizeComparableText(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/【|】|\[|\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBuymaSearchKeyword(value: string) {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/【|】|\[|\]/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/[\/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeComparableText(value: string) {
  return normalizeComparableText(value).split(" ").filter(Boolean);
}

function normalizeModelNumberForMatch(value: string) {
  const normalized = normalizeComparableText(value).replace(/\s+/g, "");
  return normalized.length >= 3 && normalized !== "0" ? normalized : "";
}

function isProductToken(token: string) {
  if (token.length < 2) return false;
  if (/^\d+$/.test(token)) return false;
  if (/^\d+colors?$/.test(token)) return false;
  return !PRODUCT_MATCH_STOP_WORDS.has(token);
}

function isBrandLikeToken(token: string) {
  return /\d/.test(token) || token.length >= 8;
}

const PRODUCT_MATCH_STOP_WORDS = new Set([
  "color",
  "colors",
  "colour",
  "colours",
  "正規品",
  "送料込",
  "追跡",
  "追跡付",
  "関税込",
  "日本未入荷",
  "unisex",
  "men",
  "mens",
  "women",
  "womens",
]);
