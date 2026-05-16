import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import {
  normalizeBuymaShopperName,
  type BuymaCompetitorPriceItem,
  type BuymaCompetitorPriceResponse,
} from "@/lib/buyma/competitor-prices";

type TrackedStatus = "active" | "paused" | "missing" | "ended";

type TrackedBuymaProduct = {
  id: string;
  buymaProductId: string;
  buymaUrl: string;
  title: string;
  brand: string;
  modelNumber: string;
  ownPrice: number;
  searchKeyword: string;
  searchUrl: string;
  status: TrackedStatus;
  lastCheckedAt?: string;
  lastSearchUrl?: string;
  referencePrice?: number;
  lowerCompetitors?: BuymaCompetitorPriceItem[];
  lastResults?: BuymaCompetitorPriceItem[];
  error?: string;
};

const STORAGE_KEY = "buyma-next:competitor-price-products";
const OWNER_STORAGE_KEY = "buyma-next:competitor-price-owner";

export default function CompetitorPriceChecker() {
  const [products, setProducts] = useState<TrackedBuymaProduct[]>([]);
  const [ownerName, setOwnerName] = useState("sonokoro");
  const [pastedCsv, setPastedCsv] = useState("");
  const [status, setStatus] = useState("CSV를 업로드하거나 붙여넣어 주세요.");
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());

  const activeProducts = useMemo(
    () => products.filter((product) => product.status === "active"),
    [products],
  );
  const alertProducts = useMemo(
    () => products.filter((product) => product.lowerCompetitors?.length),
    [products],
  );
  const checkedProducts = useMemo(
    () => products.filter((product) => product.lastCheckedAt),
    [products],
  );

  useEffect(() => {
    setProducts(loadStoredProducts());
    const storedOwner = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (storedOwner?.trim()) setOwnerName(storedOwner.trim());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    window.localStorage.setItem(OWNER_STORAGE_KEY, ownerName);
  }, [ownerName]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await readFileText(file);
      importProducts(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "파일을 읽지 못했습니다.";
      setStatus(message);
    }
  }

  function handlePasteImport() {
    importProducts(pastedCsv);
  }

  function importProducts(text: string) {
    const imported = parseProductsFromCsv(text);
    if (!imported.length) {
      setStatus("가져올 상품을 찾지 못했습니다. 헤더와 가격 컬럼을 확인해 주세요.");
      return;
    }

    setProducts((current) => mergeImportedProducts(current, imported));
    setStatus(`${imported.length.toLocaleString()}개 상품을 동기화했습니다.`);
    setPastedCsv("");
  }

  async function checkProduct(product: TrackedBuymaProduct) {
    const keyword = product.searchKeyword || product.title;
    if (!product.searchUrl && !keyword) {
      updateProduct(product.id, { error: "검색 URL 또는 검색어가 없습니다." });
      return;
    }

    setCheckingIds((current) => new Set(current).add(product.id));
    updateProduct(product.id, { error: undefined });

    try {
      const response = await fetch("/api/buyma/competitor-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchUrl: product.searchUrl,
          keyword,
        }),
      });
      const data = (await response.json()) as BuymaCompetitorPriceResponse;

      if (!response.ok || !data.ok) {
        updateProduct(product.id, {
          error: data.ok ? "가격 확인에 실패했습니다." : data.error,
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }

      const ownerKey = normalizeBuymaShopperName(ownerName);
      const ownResult = data.results.find((item) => normalizeBuymaShopperName(item.shopper) === ownerKey);
      const referencePrice = ownResult?.price ?? product.ownPrice;
      const lowerCompetitors = referencePrice
        ? data.results.filter(
            (item) =>
              normalizeBuymaShopperName(item.shopper) !== ownerKey &&
              item.price < referencePrice,
          )
        : [];

      updateProduct(product.id, {
        lastCheckedAt: data.checkedAt,
        lastSearchUrl: data.searchUrl,
        referencePrice,
        lowerCompetitors,
        lastResults: data.results,
        error: data.results.length ? undefined : "검색 결과에서 가격을 찾지 못했습니다.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "가격 확인에 실패했습니다.";
      updateProduct(product.id, { error: message, lastCheckedAt: new Date().toISOString() });
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(product.id);
        return next;
      });
    }
  }

  async function checkAllActiveProducts() {
    if (!activeProducts.length) {
      setStatus("추적중인 상품이 없습니다.");
      return;
    }

    setStatus(`${activeProducts.length.toLocaleString()}개 상품 가격 확인을 시작했습니다.`);
    for (let index = 0; index < activeProducts.length; index += 1) {
      const product = activeProducts[index];
      setStatus(`가격 확인 중 ${index + 1}/${activeProducts.length}: ${product.title || product.buymaProductId}`);
      await checkProduct(product);
      if (index < activeProducts.length - 1) await delay(1100);
    }
    setStatus("가격 확인이 완료되었습니다.");
  }

  function updateProduct(id: string, patch: Partial<TrackedBuymaProduct>) {
    setProducts((current) =>
      current.map((product) => (product.id === id ? { ...product, ...patch } : product)),
    );
  }

  function removeProduct(id: string) {
    setProducts((current) => current.filter((product) => product.id !== id));
  }

  function downloadSampleCsv() {
    const content = [
      "buyma_product_id,buyma_url,title,brand,model_number,own_price,search_keyword,search_url",
      "123456789,https://www.buyma.com/item/123456789/,HATCHINGROOM Abstract H Tee,HATCHINGROOM,,10100,HATCHINGROOM Abstract H Tee,",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "buyma-competitor-price-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-black/10 bg-white p-5 shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-[#151515] px-4 text-sm font-extrabold text-white transition hover:bg-black">
                CSV 업로드
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={(event) => void handleFileChange(event)}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                onClick={handlePasteImport}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-4 text-sm font-extrabold text-[#151515] transition hover:border-black/30"
              >
                붙여넣기 반영
              </button>
              <button
                type="button"
                onClick={downloadSampleCsv}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-4 text-sm font-extrabold text-[#151515] transition hover:border-black/30"
              >
                샘플 CSV
              </button>
            </div>

            <textarea
              value={pastedCsv}
              onChange={(event) => setPastedCsv(event.target.value)}
              placeholder="buyma_product_id,buyma_url,title,own_price,search_keyword,search_url"
              className="mt-4 min-h-[130px] w-full resize-y rounded-lg border border-black/10 bg-[#fbfaf7] px-4 py-3 text-sm font-semibold text-[#151515] outline-none transition placeholder:text-[#9a9388] focus:border-[#2d73ff]"
            />
          </div>

          <div className="grid content-start gap-3 rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <label className="grid gap-1 text-sm font-extrabold text-[#151515]">
              내 쇼퍼명
              <input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                className="min-h-10 rounded-lg border border-black/10 bg-white px-3 text-sm font-bold outline-none transition focus:border-[#2d73ff]"
              />
            </label>
            <button
              type="button"
              disabled={!activeProducts.length || checkingIds.size > 0}
              onClick={() => void checkAllActiveProducts()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2d73ff] px-4 text-sm font-extrabold text-white transition hover:bg-[#1e5ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              전체 가격 확인
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-extrabold text-[#6c655b]">
          <span className="rounded-full bg-[#f1eee6] px-3 py-1.5">전체 {products.length.toLocaleString()}</span>
          <span className="rounded-full bg-[#f1eee6] px-3 py-1.5">추적중 {activeProducts.length.toLocaleString()}</span>
          <span className="rounded-full bg-[#fff1e6] px-3 py-1.5 text-[#b95600]">낮은 가격 {alertProducts.length.toLocaleString()}</span>
          <span className="rounded-full bg-[#eef3ff] px-3 py-1.5 text-[#2d73ff]">확인완료 {checkedProducts.length.toLocaleString()}</span>
        </div>
        <p className="mt-3 text-sm font-bold text-[#6c655b]">{status}</p>
      </section>

      <section className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
            <thead className="bg-[#f1eee6] text-xs font-extrabold text-[#6c655b]">
              <tr>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">상품</th>
                <th className="px-4 py-3">내 가격</th>
                <th className="px-4 py-3">최저 경쟁가</th>
                <th className="px-4 py-3">검색 기준</th>
                <th className="px-4 py-3">마지막 확인</th>
                <th className="px-4 py-3">관리</th>
              </tr>
            </thead>
            <tbody>
              {products.length ? (
                products.map((product) => {
                  const lowerCompetitor = product.lowerCompetitors?.[0];
                  const isChecking = checkingIds.has(product.id);

                  return (
                    <tr key={product.id} className="border-t border-black/10 align-top">
                      <td className="px-4 py-4">
                        <select
                          value={product.status}
                          onChange={(event) =>
                            updateProduct(product.id, { status: event.target.value as TrackedStatus })
                          }
                          className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs font-extrabold outline-none"
                        >
                          <option value="active">추적중</option>
                          <option value="paused">일시중지</option>
                          <option value="missing">파일누락</option>
                          <option value="ended">종료</option>
                        </select>
                      </td>
                      <td className="max-w-[360px] px-4 py-4">
                        <div className="font-extrabold text-[#151515]">{product.title || product.buymaProductId || "제목 없음"}</div>
                        <div className="mt-1 text-xs font-bold text-[#6c655b]">
                          {[product.brand, product.modelNumber, product.buymaProductId].filter(Boolean).join(" · ")}
                        </div>
                        {product.error && <div className="mt-2 text-xs font-bold text-[#c43b2f]">{product.error}</div>}
                      </td>
                      <td className="px-4 py-4 font-extrabold">
                        {formatYen(product.referencePrice || product.ownPrice)}
                      </td>
                      <td className="px-4 py-4">
                        {lowerCompetitor ? (
                          <div>
                            <div className="font-extrabold text-[#c43b2f]">{formatYen(lowerCompetitor.price)}</div>
                            <div className="mt-1 text-xs font-bold text-[#6c655b]">{lowerCompetitor.shopper}</div>
                          </div>
                        ) : (
                          <span className="font-bold text-[#6c655b]">-</span>
                        )}
                      </td>
                      <td className="max-w-[280px] px-4 py-4">
                        <div className="truncate font-bold text-[#151515]">{product.searchKeyword || product.title}</div>
                        {(product.lastSearchUrl || product.searchUrl || product.buymaUrl) && (
                          <a
                            href={product.lastSearchUrl || product.searchUrl || product.buymaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-xs font-extrabold text-[#2d73ff] hover:underline"
                          >
                            BUYMA 열기
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs font-bold text-[#6c655b]">
                        {product.lastCheckedAt ? formatDateTime(product.lastCheckedAt) : "-"}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isChecking}
                            onClick={() => void checkProduct(product)}
                            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-black/15 bg-white px-3 text-xs font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isChecking ? "확인중" : "확인"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeProduct(product.id)}
                            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-black/15 bg-white px-3 text-xs font-extrabold text-[#c43b2f] transition hover:border-[#c43b2f]"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm font-bold text-[#6c655b]">
                    등록된 추적 상품이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function loadStoredProducts() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackedBuymaProduct[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readFileText(file: File) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;

  try {
    return new TextDecoder("shift_jis").decode(buffer);
  } catch {
    return utf8;
  }
}

function parseProductsFromCsv(text: string) {
  const rows = parseDelimitedRows(text.trim().replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const products: TrackedBuymaProduct[] = [];

  rows.slice(1).forEach((row, index) => {
    const buymaProductId = getCell(row, headers, ["buymaProductId", "productId", "itemId"]);
    const buymaUrl = getCell(row, headers, ["buymaUrl", "url", "itemUrl"]);
    const title = getCell(row, headers, ["title", "productName", "name"]);
    const brand = getCell(row, headers, ["brand"]);
    const modelNumber = getCell(row, headers, ["modelNumber", "model"]);
    const ownPrice = parseNumber(getCell(row, headers, ["ownPrice", "price", "sellingPrice"]));
    const searchKeyword = getCell(row, headers, ["searchKeyword", "keyword"]);
    const searchUrl = getCell(row, headers, ["searchUrl"]);

    if (!buymaProductId && !buymaUrl && !title) return;

    products.push({
      id: makeProductKey({ buymaProductId, buymaUrl, title }, index),
      buymaProductId,
      buymaUrl,
      title,
      brand,
      modelNumber,
      ownPrice,
      searchKeyword: searchKeyword || buildDefaultKeyword(brand, modelNumber, title),
      searchUrl,
      status: "active",
    });
  });

  return products;
}

function parseDelimitedRows(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
}

function normalizeHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_()[\]{}]/g, "");
  if (["buymaproductid", "productid", "itemid", "상품번호", "상품id", "商品id"].includes(normalized)) return "buymaProductId";
  if (["buymaurl", "url", "itemurl", "상품url", "商品url"].includes(normalized)) return "buymaUrl";
  if (["title", "productname", "name", "상품명", "商品名"].includes(normalized)) return "title";
  if (["brand", "브랜드", "ブランド"].includes(normalized)) return "brand";
  if (["modelnumber", "model", "모델번호", "品番", "型番"].includes(normalized)) return "modelNumber";
  if (["ownprice", "price", "sellingprice", "판매가", "가격", "出品価格", "価格"].includes(normalized)) return "ownPrice";
  if (["searchkeyword", "keyword", "검색어"].includes(normalized)) return "searchKeyword";
  if (["searchurl", "검색url"].includes(normalized)) return "searchUrl";
  if (normalized.includes("商品id") || normalized.includes("商品番号")) return "buymaProductId";
  if (normalized.includes("url")) return normalized.includes("search") || normalized.includes("검색") ? "searchUrl" : "buymaUrl";
  if (normalized.includes("商品名") || normalized.includes("상품명")) return "title";
  if (normalized.includes("ブランド") || normalized.includes("브랜드")) return "brand";
  if (normalized.includes("品番") || normalized.includes("型番") || normalized.includes("모델")) return "modelNumber";
  if (normalized.includes("価格") || normalized.includes("price") || normalized.includes("가격") || normalized.includes("판매가")) return "ownPrice";
  if (normalized.includes("keyword") || normalized.includes("검색어")) return "searchKeyword";
  return normalized;
}

function getCell(row: string[], headers: string[], keys: string[]) {
  const index = headers.findIndex((header) => keys.includes(header));
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function parseNumber(value: string) {
  const number = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function mergeImportedProducts(
  current: TrackedBuymaProduct[],
  imported: TrackedBuymaProduct[],
): TrackedBuymaProduct[] {
  const currentMap = new Map(current.map((product) => [getMergeKey(product), product]));
  const importedKeys = new Set(imported.map(getMergeKey));
  const merged = imported.map((product) => {
    const existing = currentMap.get(getMergeKey(product));
    return existing
      ? {
          ...existing,
          ...product,
          id: existing.id,
          status: (existing.status === "ended" ? "ended" : "active") as TrackedStatus,
          lastCheckedAt: existing.lastCheckedAt,
          lastSearchUrl: existing.lastSearchUrl,
          referencePrice: existing.referencePrice,
          lowerCompetitors: existing.lowerCompetitors,
          lastResults: existing.lastResults,
          error: existing.error,
        }
      : product;
  });
  const missing: TrackedBuymaProduct[] = current
    .filter((product) => !importedKeys.has(getMergeKey(product)))
    .map((product) => (product.status === "active" ? { ...product, status: "missing" as const } : product));

  return [...merged, ...missing];
}

function makeProductKey(
  product: Pick<TrackedBuymaProduct, "buymaProductId" | "buymaUrl" | "title">,
  index: number,
) {
  return getMergeKey(product) || `row-${Date.now()}-${index}`;
}

function getMergeKey(product: Pick<TrackedBuymaProduct, "buymaProductId" | "buymaUrl" | "title">) {
  return product.buymaProductId || product.buymaUrl || product.title;
}

function buildDefaultKeyword(brand: string, modelNumber: string, title: string) {
  return [brand, modelNumber].filter(Boolean).join(" ") || title;
}

function formatYen(value: number | undefined) {
  if (!value) return "-";
  return `¥${value.toLocaleString("ja-JP")}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
