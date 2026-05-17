import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  normalizeBuymaShopperName,
  type BuymaCompetitorPriceItem,
  type BuymaCompetitorPriceResponse,
} from "@/lib/buyma/competitor-prices";
import { supabase } from "@/lib/supabase";

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

type CompetitorPriceProductRow = {
  id: string;
  merge_key: string;
  buyma_product_id: string | null;
  buyma_url: string | null;
  title: string | null;
  brand: string | null;
  model_number: string | null;
  own_price: number | null;
  search_keyword: string | null;
  search_url: string | null;
  status: TrackedStatus;
  last_checked_at: string | null;
  last_search_url: string | null;
  reference_price: number | null;
  lower_competitors: unknown;
  last_results: unknown;
  error: string | null;
};

const DEFAULT_OWNER_NAME = "sonokoro";
const BATCH_LIMIT = 50;

export default function CompetitorPriceChecker() {
  const { authUser, session } = useAuth();
  const userId = authUser?.id ?? "";
  const [products, setProducts] = useState<TrackedBuymaProduct[]>([]);
  const [ownerName, setOwnerName] = useState(DEFAULT_OWNER_NAME);
  const [pastedCsv, setPastedCsv] = useState("");
  const [status, setStatus] = useState("CSV를 업로드하거나 붙여넣어 주세요.");
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());
  const [checkingBatch, setCheckingBatch] = useState(false);
  const [trackingLoaded, setTrackingLoaded] = useState(false);

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

  const loadTrackingData = useCallback(async () => {
    if (!userId) return;

    setTrackingLoaded(false);

    const [{ data: setting, error: settingError }, { data: rows, error: productError }] =
      await Promise.all([
        supabase
          .from("competitor_price_settings")
          .select("owner_name")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("competitor_price_products")
          .select(
            "id,merge_key,buyma_product_id,buyma_url,title,brand,model_number,own_price,search_keyword,search_url,status,last_checked_at,last_search_url,reference_price,lower_competitors,last_results,error",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
      ]);

    if (settingError || productError) {
      setStatus("경쟁가격 추적 데이터를 불러오지 못했습니다. Supabase 마이그레이션 적용 여부를 확인해 주세요.");
      setTrackingLoaded(true);
      return;
    }

    if (setting?.owner_name?.trim()) {
      setOwnerName(setting.owner_name.trim());
    }

    setProducts(((rows ?? []) as CompetitorPriceProductRow[]).map(rowToProduct));
    setStatus("추적 데이터를 불러왔습니다.");
    setTrackingLoaded(true);
  }, [userId]);

  useEffect(() => {
    void Promise.resolve().then(loadTrackingData);
  }, [loadTrackingData]);

  useEffect(() => {
    if (!userId || !trackingLoaded) return;

    const timer = window.setTimeout(() => {
      void saveOwnerName(userId, ownerName);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [userId, ownerName, trackingLoaded]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await readFileText(file);
      await importProducts(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "파일을 읽지 못했습니다.";
      setStatus(message);
    }
  }

  async function handlePasteImport() {
    await importProducts(pastedCsv);
  }

  async function importProducts(text: string) {
    if (!userId) {
      setStatus("로그인이 필요합니다.");
      return;
    }

    const imported = parseProductsFromCsv(text);
    if (!imported.length) {
      setStatus("가져올 상품을 찾지 못했습니다. 헤더와 가격 컬럼을 확인해 주세요.");
      return;
    }

    const merged = mergeImportedProducts(products, imported);
    setProducts(merged);
    await saveProductList(userId, merged);
    await loadTrackingData();
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
      setStatus("추적 중인 상품이 없습니다.");
      return;
    }

    if (!session?.access_token) {
      setStatus("로그인이 필요합니다.");
      return;
    }

    setCheckingBatch(true);
    setStatus(`서버에서 최대 ${BATCH_LIMIT}개 상품의 가격 확인을 시작했습니다.`);

    try {
      const response = await fetch("/api/buyma/competitor-price-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ limit: BATCH_LIMIT }),
      });
      const data = (await response.json()) as
        | { ok: true; checked: number; failed: number }
        | { ok: false; error: string };

      if (!response.ok || !data.ok) {
        setStatus(data.ok ? "가격 확인에 실패했습니다." : data.error);
        return;
      }

      await loadTrackingData();
      setStatus(`${data.checked.toLocaleString()}개 확인 완료, 실패 ${data.failed.toLocaleString()}개입니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "가격 확인에 실패했습니다.";
      setStatus(message);
    } finally {
      setCheckingBatch(false);
    }
  }

  function updateProduct(id: string, patch: Partial<TrackedBuymaProduct>) {
    const currentProduct = products.find((product) => product.id === id);
    const nextProduct = currentProduct ? { ...currentProduct, ...patch } : null;

    setProducts((current) =>
      current.map((product) => (product.id === id ? { ...product, ...patch } : product)),
    );

    if (userId && nextProduct) {
      void saveProductPatch(userId, id, patch);
    }
  }

  function removeProduct(id: string) {
    setProducts((current) => current.filter((product) => product.id !== id));

    if (userId) {
      void supabase
        .from("competitor_price_products")
        .delete()
        .eq("user_id", userId)
        .eq("id", id);
    }
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
                onClick={() => void handlePasteImport()}
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
              disabled={!activeProducts.length || checkingBatch || checkingIds.size > 0}
              onClick={() => void checkAllActiveProducts()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2d73ff] px-4 text-sm font-extrabold text-white transition hover:bg-[#1e5ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checkingBatch ? "확인 중" : "서버 가격 확인"}
            </button>
            <p className="text-xs font-bold leading-5 text-[#6c655b]">
              무료 플랜 안정성을 위해 한 번에 최대 {BATCH_LIMIT}개씩 확인합니다.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-extrabold text-[#6c655b]">
          <span className="rounded-full bg-[#f1eee6] px-3 py-1.5">전체 {products.length.toLocaleString()}</span>
          <span className="rounded-full bg-[#f1eee6] px-3 py-1.5">추적중 {activeProducts.length.toLocaleString()}</span>
          <span className="rounded-full bg-[#fff1e6] px-3 py-1.5 text-[#b95600]">더 낮은 가격 {alertProducts.length.toLocaleString()}</span>
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
                            disabled={isChecking || checkingBatch}
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

async function saveOwnerName(userId: string, ownerName: string) {
  await supabase
    .from("competitor_price_settings")
    .upsert(
      {
        user_id: userId,
        owner_name: ownerName.trim() || DEFAULT_OWNER_NAME,
      },
      { onConflict: "user_id" },
    );
}

async function saveProductList(userId: string, products: TrackedBuymaProduct[]) {
  const rows = products.map((product) => productToUpsertRow(userId, product));
  const { error } = await supabase
    .from("competitor_price_products")
    .upsert(rows, { onConflict: "user_id,merge_key" });

  if (error) {
    throw error;
  }
}

async function saveProductPatch(
  userId: string,
  productId: string,
  patch: Partial<TrackedBuymaProduct>,
) {
  const rowPatch = productPatchToRowPatch(patch);
  if (!Object.keys(rowPatch).length) return;

  await supabase
    .from("competitor_price_products")
    .update(rowPatch)
    .eq("user_id", userId)
    .eq("id", productId);
}

function rowToProduct(row: CompetitorPriceProductRow): TrackedBuymaProduct {
  return {
    id: row.id,
    buymaProductId: row.buyma_product_id ?? "",
    buymaUrl: row.buyma_url ?? "",
    title: row.title ?? "",
    brand: row.brand ?? "",
    modelNumber: row.model_number ?? "",
    ownPrice: row.own_price ?? 0,
    searchKeyword: row.search_keyword ?? "",
    searchUrl: row.search_url ?? "",
    status: row.status,
    lastCheckedAt: row.last_checked_at ?? undefined,
    lastSearchUrl: row.last_search_url ?? undefined,
    referencePrice: row.reference_price ?? undefined,
    lowerCompetitors: toCompetitorItems(row.lower_competitors),
    lastResults: toCompetitorItems(row.last_results),
    error: row.error ?? undefined,
  };
}

function productToUpsertRow(userId: string, product: TrackedBuymaProduct) {
  return {
    user_id: userId,
    merge_key: getMergeKey(product) || product.id,
    buyma_product_id: product.buymaProductId,
    buyma_url: product.buymaUrl,
    title: product.title,
    brand: product.brand,
    model_number: product.modelNumber,
    own_price: product.ownPrice,
    search_keyword: product.searchKeyword,
    search_url: product.searchUrl,
    status: product.status,
    last_checked_at: product.lastCheckedAt ?? null,
    last_search_url: product.lastSearchUrl ?? null,
    reference_price: product.referencePrice ?? null,
    lower_competitors: product.lowerCompetitors ?? [],
    last_results: product.lastResults ?? [],
    error: product.error ?? null,
  };
}

function productPatchToRowPatch(patch: Partial<TrackedBuymaProduct>) {
  const row: Record<string, unknown> = {};

  if ("buymaProductId" in patch) row.buyma_product_id = patch.buymaProductId ?? "";
  if ("buymaUrl" in patch) row.buyma_url = patch.buymaUrl ?? "";
  if ("title" in patch) row.title = patch.title ?? "";
  if ("brand" in patch) row.brand = patch.brand ?? "";
  if ("modelNumber" in patch) row.model_number = patch.modelNumber ?? "";
  if ("ownPrice" in patch) row.own_price = patch.ownPrice ?? 0;
  if ("searchKeyword" in patch) row.search_keyword = patch.searchKeyword ?? "";
  if ("searchUrl" in patch) row.search_url = patch.searchUrl ?? "";
  if ("status" in patch) row.status = patch.status ?? "active";
  if ("lastCheckedAt" in patch) row.last_checked_at = patch.lastCheckedAt ?? null;
  if ("lastSearchUrl" in patch) row.last_search_url = patch.lastSearchUrl ?? null;
  if ("referencePrice" in patch) row.reference_price = patch.referencePrice ?? null;
  if ("lowerCompetitors" in patch) row.lower_competitors = patch.lowerCompetitors ?? [];
  if ("lastResults" in patch) row.last_results = patch.lastResults ?? [];
  if ("error" in patch) row.error = patch.error ?? null;

  return row;
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
    const buymaUrl = getCell(row, headers, ["buymaUrl", "url", "itemUrl"]) || buildBuymaItemUrl(buymaProductId);
    const title = getCell(row, headers, ["title", "productName", "name"]);
    const brand = getCell(row, headers, ["brandName"]) || getCell(row, headers, ["brand"]);
    const modelNumber = normalizeModelNumber(
      getFirstCell(row, headers, [
        "brandProductNumber1",
        "brandProductNumber2",
        "brandProductNumber3",
        "brandProductNumber4",
        "brandProductNumber5",
        "brandProductNumber6",
        "brandProductNumber7",
        "brandProductNumber8",
        "brandProductNumber9",
        "brandProductNumber10",
        "brandProductNumber",
        "modelNumber",
        "model",
      ]),
    );
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
  const trimmed = value.trim();
  const brandProductMatch = trimmed.match(/^ブランド品番(\d+)$/);
  if (brandProductMatch) return `brandProductNumber${brandProductMatch[1]}`;
  if (trimmed === "商品ID") return "buymaProductId";
  if (trimmed === "商品名") return "title";
  if (trimmed === "ブランド名") return "brandName";
  if (trimmed === "ブランド") return "brand";
  if (trimmed === "モデル") return "model";
  if (trimmed === "単価") return "ownPrice";
  if (trimmed === "商品管理番号") return "modelNumber";

  const normalized = value.trim().toLowerCase().replace(/[\s_()[\]{}]/g, "");

  if (normalized === "商品id") return "buymaProductId";
  if (normalized === "商品名") return "title";
  if (normalized === "ブランド名") return "brandName";
  if (normalized === "ブランド") return "brand";
  if (normalized === "モデル") return "model";
  if (normalized === "単価") return "ownPrice";
  if (normalized === "ブランド品番1") return "brandProductNumber";
  if (normalized === "商品管理番号") return "modelNumber";

  if (["buymaproductid", "productid", "itemid", "상품번호", "상품id", "아이템id"].includes(normalized)) return "buymaProductId";
  if (["buymaurl", "url", "itemurl", "상품url", "아이템url"].includes(normalized)) return "buymaUrl";
  if (["title", "productname", "name", "상품명", "아이템명"].includes(normalized)) return "title";
  if (["brand", "브랜드"].includes(normalized)) return "brand";
  if (["modelnumber", "model", "모델번호", "품번", "모델"].includes(normalized)) return "modelNumber";
  if (["ownprice", "price", "sellingprice", "판매가", "가격"].includes(normalized)) return "ownPrice";
  if (["searchkeyword", "keyword", "검색어"].includes(normalized)) return "searchKeyword";
  if (["searchurl", "검색url"].includes(normalized)) return "searchUrl";
  if (normalized.includes("url")) return normalized.includes("search") || normalized.includes("검색") ? "searchUrl" : "buymaUrl";
  if (normalized.includes("상품명") || normalized.includes("아이템명")) return "title";
  if (normalized.includes("브랜드")) return "brand";
  if (normalized.includes("품번") || normalized.includes("모델")) return "modelNumber";
  if (normalized.includes("price") || normalized.includes("가격") || normalized.includes("판매가")) return "ownPrice";
  if (normalized.includes("keyword") || normalized.includes("검색어")) return "searchKeyword";

  return normalized;
}

function getCell(row: string[], headers: string[], keys: string[]) {
  const index = headers.findIndex((header) => keys.includes(header));
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function getFirstCell(row: string[], headers: string[], keys: string[]) {
  for (const key of keys) {
    const value = getCell(row, headers, [key]);
    if (value) return value;
  }

  return "";
}

function parseNumber(value: string) {
  const number = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeModelNumber(value: string) {
  const normalized = value.trim();
  return normalized === "0" ? "" : normalized;
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
  return dedupeKeywordParts([brand, modelNumber, title]).join(" ");
}

function buildBuymaItemUrl(buymaProductId: string) {
  const normalized = buymaProductId.trim();
  return /^\d+$/.test(normalized) ? `https://www.buyma.com/item/${normalized}/` : "";
}

function dedupeKeywordParts(parts: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  parts.forEach((part) => {
    const normalized = normalizeKeywordPart(part);
    if (!normalized) return;

    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });

  return result;
}

function normalizeKeywordPart(value: string) {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/【|】|\[|\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCompetitorItems(value: unknown): BuymaCompetitorPriceItem[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is BuymaCompetitorPriceItem => {
    if (!item || typeof item !== "object") return false;

    const candidate = item as BuymaCompetitorPriceItem;
    return (
      typeof candidate.title === "string" &&
      typeof candidate.price === "number" &&
      typeof candidate.shopper === "string"
    );
  });
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
