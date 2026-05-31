import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  buildBuymaSearchUrl,
  compareBuymaCompetitorPrices,
  type BuymaCompetitorPriceItem,
  type BuymaCompetitorPriceResponse,
} from "@/lib/buyma/competitor-prices";
import { supabase } from "@/lib/supabase";

type TrackedStatus = "active" | "paused" | "missing" | "ended";
type SortMode = "action" | "csv" | "csvReverse" | "unchecked" | "oldestChecked" | "title";
type ProductFilterMode = "all" | "unchecked" | "checked" | "lower" | "noLower" | "error" | "empty" | "missing";
type ManualReviewFilterMode = "all" | "pending" | "reviewed" | "recheck";
type ManualReviewSortMode = "csv" | "csvReverse" | "title" | "oldestReviewed";
type CompetitorPageSize = 10 | 30 | 50 | 100 | 300 | 500 | "all";
type ManualReviewListPageSize = 10 | 30 | 50 | 100 | 300 | 500 | "all";
type ManualReviewStatus = "pending" | "reviewed" | "recheck";

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
  createdAt?: string;
  csvOrder?: number;
  csvImportedAt?: string;
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
  created_at: string | null;
  csv_order: number | null;
  csv_imported_at: string | null;
};

type ManualPriceReviewBatchRow = {
  id: string;
  name: string | null;
  source_filename: string | null;
  created_at: string | null;
};

type ManualPriceReviewItemRow = {
  id: string;
  batch_id: string;
  merge_key: string;
  buyma_product_id: string | null;
  buyma_url: string | null;
  title: string | null;
  brand: string | null;
  model_number: string | null;
  own_price: number | null;
  search_keyword: string | null;
  search_url: string | null;
  manual_lowest_price: number | null;
  manual_update_price: number | null;
  review_status: ManualReviewStatus;
  reviewed_at: string | null;
  recheck_requested_at: string | null;
  exported_at: string | null;
  created_at: string | null;
  csv_order: number | null;
  csv_imported_at: string | null;
};

type CsvImportFailure = {
  rowNumber: number;
  reason: string;
  rawValue: string;
};

const DEFAULT_OWNER_NAME = "sonokoro";
const BATCH_LIMIT = 50;
const PAGE_SIZE_OPTIONS = [10, 30, 50, 100, 300, 500, "all"] as const;
const UNCHECKED_MAX_PAGE_SIZE = 50;
const PRODUCT_SELECT_COLUMNS =
  "id,merge_key,buyma_product_id,buyma_url,title,brand,model_number,own_price,search_keyword,search_url,status,last_checked_at,last_search_url,reference_price,lower_competitors,last_results,error,created_at,csv_order,csv_imported_at";
const PRODUCT_SELECT_COLUMNS_LEGACY =
  "id,merge_key,buyma_product_id,buyma_url,title,brand,model_number,own_price,search_keyword,search_url,status,last_checked_at,last_search_url,reference_price,lower_competitors,last_results,error,created_at";
const MANUAL_REVIEW_ITEM_SELECT_COLUMNS =
  "id,batch_id,merge_key,buyma_product_id,buyma_url,title,brand,model_number,own_price,search_keyword,search_url,manual_lowest_price,manual_update_price,review_status,reviewed_at,recheck_requested_at,exported_at,created_at,csv_order,csv_imported_at";

type CompetitorPriceCheckerProps = {
  mode?: "checker" | "manual-review";
};

export default function CompetitorPriceChecker({ mode = "checker" }: CompetitorPriceCheckerProps) {
  const { authUser, session } = useAuth();
  const isManualReviewMode = mode === "manual-review";
  const userId = authUser?.id ?? "";
  const [products, setProducts] = useState<TrackedBuymaProduct[]>([]);
  const [ownerName, setOwnerName] = useState(DEFAULT_OWNER_NAME);
  const [status, setStatus] = useState("CSV를 업로드해 주세요.");
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());
  const [checkingBatch, setCheckingBatch] = useState(false);
  const [trackingLoaded, setTrackingLoaded] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("csvReverse");
  const [pageSize, setPageSize] = useState<CompetitorPageSize>(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterMode, setFilterMode] = useState<ProductFilterMode>("all");
  const [manualReviewFilterMode, setManualReviewFilterMode] = useState<ManualReviewFilterMode>("all");
  const [manualReviewSortMode, setManualReviewSortMode] = useState<ManualReviewSortMode>("csvReverse");
  const [manualReviewProductSearch, setManualReviewProductSearch] = useState("");
  const [manualReviewListPageSize, setManualReviewListPageSize] = useState<ManualReviewListPageSize>(50);
  const [manualReviewListPage, setManualReviewListPage] = useState(1);
  const [manualReviewListOpen, setManualReviewListOpen] = useState(true);
  const manualReviewFileInputRef = useRef<HTMLInputElement | null>(null);
  const [manualReviewUploading, setManualReviewUploading] = useState(false);
  const [productNameSearch, setProductNameSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [manualReviewImportedProducts, setManualReviewImportedProducts] = useState<TrackedBuymaProduct[]>([]);
  const [manualReviewBatchId, setManualReviewBatchId] = useState("");
  const [manualReviewBatchName, setManualReviewBatchName] = useState("");
  const [manualReviewBatchCreatedAt, setManualReviewBatchCreatedAt] = useState("");
  const [manualPriceEdits, setManualPriceEdits] = useState<Record<string, string>>({});
  const [manualReviewProductId, setManualReviewProductId] = useState("");
  const [manualLowestPrices, setManualLowestPrices] = useState<Record<string, string>>({});
  const [manualReviewedIds, setManualReviewedIds] = useState<Set<string>>(() => new Set());
  const [manualReviewedAt, setManualReviewedAt] = useState<Record<string, string>>({});
  const [manualRecheckIds, setManualRecheckIds] = useState<Set<string>>(() => new Set());
  const [manualRecheckRequestedAt, setManualRecheckRequestedAt] = useState<Record<string, string>>({});
  const [selectedManualReviewProductIds, setSelectedManualReviewProductIds] = useState<Set<string>>(() => new Set());
  const [csvImportFailures, setCsvImportFailures] = useState<CsvImportFailure[]>([]);

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
  const visibleProducts = useMemo(
    () => filterTrackedProducts(products, filterMode, productNameSearch),
    [filterMode, productNameSearch, products],
  );
  const sortedProducts = useMemo(
    () => sortTrackedProducts(visibleProducts, sortMode),
    [sortMode, visibleProducts],
  );
  const totalPages =
    pageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const currentPageProducts = useMemo(
    () => {
      if (pageSize === "all") return sortedProducts;
      return sortedProducts.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);
    },
    [pageSize, safeCurrentPage, sortedProducts],
  );
  const pageStart = sortedProducts.length
    ? pageSize === "all"
      ? 1
      : (safeCurrentPage - 1) * pageSize + 1
    : 0;
  const pageEnd =
    pageSize === "all"
      ? sortedProducts.length
      : Math.min(safeCurrentPage * pageSize, sortedProducts.length);
  const selectedProducts = useMemo(
    () => products.filter((product) => selectedProductIds.has(product.id)),
    [products, selectedProductIds],
  );
  const manualReviewSourceProducts = manualReviewImportedProducts;
  const manualReviewedProducts = useMemo(
    () => manualReviewSourceProducts.filter((product) => manualReviewedIds.has(product.id)),
    [manualReviewSourceProducts, manualReviewedIds],
  );
  const manualRemainingProducts = useMemo(
    () => manualReviewSourceProducts.filter((product) => !manualReviewedIds.has(product.id) && !manualRecheckIds.has(product.id)),
    [manualRecheckIds, manualReviewSourceProducts, manualReviewedIds],
  );
  const manualRecheckProducts = useMemo(
    () => manualReviewSourceProducts.filter((product) => manualRecheckIds.has(product.id)),
    [manualRecheckIds, manualReviewSourceProducts],
  );
  const manualReviewBaseProducts = useMemo(
    () =>
      sortManualReviewProducts(
        filterManualReviewSearch(manualReviewSourceProducts, manualReviewProductSearch),
        manualReviewSortMode,
        manualReviewedAt,
      ),
    [manualReviewProductSearch, manualReviewSortMode, manualReviewSourceProducts, manualReviewedAt],
  );
  const manualReviewProducts = useMemo(
    () => filterManualReviewProducts(manualReviewBaseProducts, manualReviewFilterMode, manualReviewedIds, manualRecheckIds),
    [manualRecheckIds, manualReviewBaseProducts, manualReviewFilterMode, manualReviewedIds],
  );
  const manualReviewIndex = manualReviewProducts.findIndex((product) => product.id === manualReviewProductId);
  const manualReviewProduct = manualReviewIndex >= 0 ? manualReviewProducts[manualReviewIndex] : manualReviewProducts[0];
  const manualReviewPosition = manualReviewProduct
    ? Math.max(0, manualReviewProducts.findIndex((product) => product.id === manualReviewProduct.id)) + 1
    : 0;
  const manualReviewListTotalPages =
    manualReviewListPageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(manualReviewProducts.length / manualReviewListPageSize));
  const safeManualReviewListPage = Math.min(Math.max(1, manualReviewListPage), manualReviewListTotalPages);
  const manualReviewListProducts = useMemo(() => {
    if (manualReviewListPageSize === "all") return manualReviewProducts;
    const start = (safeManualReviewListPage - 1) * manualReviewListPageSize;
    return manualReviewProducts.slice(start, start + manualReviewListPageSize);
  }, [manualReviewListPageSize, manualReviewProducts, safeManualReviewListPage]);
  const manualReviewListStart = manualReviewProducts.length
    ? manualReviewListPageSize === "all"
      ? 1
      : (safeManualReviewListPage - 1) * manualReviewListPageSize + 1
    : 0;
  const manualReviewListEnd =
    manualReviewListPageSize === "all"
      ? manualReviewProducts.length
      : Math.min(safeManualReviewListPage * manualReviewListPageSize, manualReviewProducts.length);
  const selectedManualReviewProducts = useMemo(
    () => manualReviewSourceProducts.filter((product) => selectedManualReviewProductIds.has(product.id)),
    [manualReviewSourceProducts, selectedManualReviewProductIds],
  );
  const selectedManualReviewReviewedProducts = useMemo(
    () => selectedManualReviewProducts.filter((product) => manualReviewedIds.has(product.id)),
    [manualReviewedIds, selectedManualReviewProducts],
  );
  const manualReviewSelectedCsvCount = useMemo(
    () => countPriceUpdateCsvRows(selectedManualReviewReviewedProducts, manualPriceEdits, true),
    [manualPriceEdits, selectedManualReviewReviewedProducts],
  );
  const manualReviewListSelectedCount = manualReviewListProducts.filter((product) => selectedManualReviewProductIds.has(product.id)).length;
  const isManualReviewCurrentPageAllSelected = Boolean(manualReviewListProducts.length) && manualReviewListSelectedCount === manualReviewListProducts.length;
  const manualReviewLowestPrice = manualReviewProduct ? manualLowestPrices[manualReviewProduct.id] ?? "" : "";
  const manualReviewSuggestedPrice = manualReviewProduct
    ? getManualReviewPriceEditValue(manualReviewProduct, manualPriceEdits)
    : "";
  const manualReviewUploadPrice = getPositiveIntegerPrice(manualReviewSuggestedPrice);
  const isManualReviewUploadPriceInvalid =
    Boolean(manualReviewProduct) && manualReviewUploadPrice === null;
  const manualReviewPriceDiff = manualReviewProduct && manualReviewUploadPrice !== null
    ? manualReviewUploadPrice - manualReviewProduct.ownPrice
    : 0;
  const manualReviewProductStatus = manualReviewProduct
    ? getManualReviewStatus(
        manualReviewedIds.has(manualReviewProduct.id),
        manualRecheckIds.has(manualReviewProduct.id),
      )
    : null;
  const manualReviewUrl = manualReviewProduct ? getBuymaReviewUrl(manualReviewProduct) : "";
  const manualReviewBatchLabel = manualReviewBatchName
    ? `${manualReviewBatchCreatedAt ? `${formatDateTime(manualReviewBatchCreatedAt)} ` : ""}${getManualReviewBatchFilename(manualReviewBatchName)}`
    : "";
  const priceUpdateCsvLabel = `선택 ${selectedProducts.length.toLocaleString()}개 CSV`;
  const selectedCheckLabel = `선택 ${selectedProducts.length.toLocaleString()}개 확인`;
  const selectedDeleteLabel = `선택 ${selectedProducts.length.toLocaleString()}개 삭제`;
  const currentPageSelectedCount = currentPageProducts.filter((product) => selectedProductIds.has(product.id)).length;
  const isCurrentPageAllSelected = Boolean(currentPageProducts.length) && currentPageSelectedCount === currentPageProducts.length;

  function resetSelectionForListChange() {
    setSelectedProductIds(new Set());
  }

  function resetManualReviewSelectionForListChange() {
    setSelectedManualReviewProductIds(new Set());
  }

  const applyManualReviewRows = useCallback((rows: ManualPriceReviewItemRow[], batch?: ManualPriceReviewBatchRow | null) => {
    const products = rows.map(manualReviewRowToProduct);
    setManualReviewImportedProducts(products);
    setManualReviewBatchId(batch?.id ?? rows[0]?.batch_id ?? "");
    setManualReviewBatchName(batch?.name?.trim() || batch?.source_filename?.trim() || "");
    setManualReviewBatchCreatedAt(batch?.created_at ?? "");
    setManualReviewProductId("");
    setManualLowestPrices(getManualLowestPriceMap(rows));
    setManualPriceEdits(getManualUpdatePriceMap(rows));
    setManualReviewedIds(getManualStatusIds(rows, "reviewed"));
    setManualReviewedAt(getManualDateMap(rows, "reviewed_at"));
    setManualRecheckIds(getManualStatusIds(rows, "recheck"));
    setManualRecheckRequestedAt(getManualDateMap(rows, "recheck_requested_at"));
    setSelectedManualReviewProductIds(new Set());
    setManualReviewListPage(1);
  }, []);

  const loadTrackingData = useCallback(async () => {
    if (!userId) return;

    if (isManualReviewMode) {
      setTrackingLoaded(false);

      const { data: batch, error: batchError } = await supabase
        .from("manual_price_review_batches")
        .select("id,name,source_filename,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (batchError) {
        setStatus("수동검토 데이터를 불러오지 못했습니다. Supabase 마이그레이션 적용 여부를 확인해 주세요.");
        setTrackingLoaded(true);
        return;
      }

      if (!batch) {
        applyManualReviewRows([], null);
        setStatus("BUYMA CSV를 업로드해 수동검토 목록을 가져와 주세요.");
        setTrackingLoaded(true);
        return;
      }

      const { data: rows, error: itemError } = await supabase
        .from("manual_price_review_items")
        .select(MANUAL_REVIEW_ITEM_SELECT_COLUMNS)
        .eq("user_id", userId)
        .eq("batch_id", (batch as ManualPriceReviewBatchRow).id)
        .order("csv_order", { ascending: true });

      if (itemError) {
        setStatus(`수동검토 상품을 불러오지 못했습니다: ${itemError.message}`);
        setTrackingLoaded(true);
        return;
      }

      applyManualReviewRows((rows ?? []) as ManualPriceReviewItemRow[], batch as ManualPriceReviewBatchRow);
      setStatus("수동검토 데이터를 불러왔습니다.");
      setTrackingLoaded(true);
      return;
    }

    setTrackingLoaded(false);

    const [{ data: setting, error: settingError }, productResult] =
      await Promise.all([
        supabase
          .from("competitor_price_settings")
          .select("owner_name")
          .eq("user_id", userId)
          .maybeSingle(),
        loadProductRows(userId),
      ]);
    const { rows, error: productError } = productResult;

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
  }, [applyManualReviewRows, isManualReviewMode, userId]);

  useEffect(() => {
    void Promise.resolve().then(loadTrackingData);
  }, [loadTrackingData]);

  useEffect(() => {
    if (!userId || !trackingLoaded || isManualReviewMode) return;

    const timer = window.setTimeout(() => {
      void saveOwnerName(userId, ownerName);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [isManualReviewMode, userId, ownerName, trackingLoaded]);

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

  async function handleManualReviewFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!userId) {
      setStatus("로그인이 필요합니다.");
      return;
    }

    let createdBatchId = "";
    setManualReviewUploading(true);
    setStatus(`수동검토 CSV 업로드 중입니다: ${file.name}`);
    try {
      const text = await readFileText(file);
      const importResult = parseProductsFromCsv(text, { requireBuymaProductId: true });
      if (!importResult.products.length) {
        setCsvImportFailures(importResult.failures);
        setStatus(
          `수동검토 CSV에서 가져올 상품을 찾지 못했습니다. 기존 수동검토 목록은 유지합니다. 총 ${importResult.totalRows.toLocaleString()}행 중 실패 ${importResult.failedRows.toLocaleString()}행입니다.`,
        );
        return;
      }

      const csvImportedAt = new Date().toISOString();
      const orderedProducts = importResult.products.map((product, index) => ({
        ...product,
        csvOrder: index + 1,
        csvImportedAt,
      }));
      const uniqueImport = dedupeManualReviewImportedProducts(orderedProducts);

      const previousBatchId = manualReviewBatchId;
      const batch = await createManualReviewBatch(userId, file.name);
      createdBatchId = batch.id;
      const { data: existingRows, error: existingError } = await supabase
        .from("manual_price_review_items")
        .select(MANUAL_REVIEW_ITEM_SELECT_COLUMNS)
        .eq("user_id", userId)
        .eq("batch_id", previousBatchId || batch.id);

      if (existingError) {
        throw existingError;
      }

      const existingManualRows = (existingRows ?? []) as ManualPriceReviewItemRow[];
      const rowsToInsert = mergeManualReviewImportRows(
        userId,
        batch.id,
        uniqueImport.products,
        existingManualRows,
      );

      const { data: savedRows, error: itemError } = await supabase
        .from("manual_price_review_items")
        .insert(rowsToInsert)
        .select(MANUAL_REVIEW_ITEM_SELECT_COLUMNS);

      if (itemError) {
        throw itemError;
      }

      const { data: mergedRows, error: mergedRowsError } = await supabase
        .from("manual_price_review_items")
        .select(MANUAL_REVIEW_ITEM_SELECT_COLUMNS)
        .eq("user_id", userId)
        .eq("batch_id", batch.id)
        .order("csv_order", { ascending: true });

      if (mergedRowsError) {
        throw mergedRowsError;
      }

      const finalRows = (mergedRows ?? savedRows ?? []) as ManualPriceReviewItemRow[];
      let previousBatchDeleteMessage = "";
      if (previousBatchId && previousBatchId !== batch.id) {
        const { error: previousBatchDeleteError } = await supabase
          .from("manual_price_review_batches")
          .delete()
          .eq("user_id", userId)
          .eq("id", previousBatchId);

        if (previousBatchDeleteError) {
          previousBatchDeleteMessage = ` 이전 목록 삭제 실패: ${previousBatchDeleteError.message}`;
        }
      }
      applyManualReviewRows(finalRows, batch);
      createdBatchId = "";
      setManualReviewFilterMode("all");
      setManualReviewProductSearch("");
      setCsvImportFailures(importResult.failures);
      const duplicateMessage = uniqueImport.duplicateCount
        ? ` 중복 상품ID ${uniqueImport.duplicateCount.toLocaleString()}개는 제외했습니다.`
        : "";
      setStatus(
        `수동검토 CSV ${importResult.totalRows.toLocaleString()}행 중 ${uniqueImport.products.length.toLocaleString()}개 상품을 반영했습니다. 최종 목록 ${finalRows.length.toLocaleString()}개, 실패 ${importResult.failedRows.toLocaleString()}행입니다.${duplicateMessage}${previousBatchDeleteMessage}`,
      );
    } catch (error) {
      if (createdBatchId) {
        await supabase
          .from("manual_price_review_batches")
          .delete()
          .eq("user_id", userId)
          .eq("id", createdBatchId);
      }
      const message = error instanceof Error ? error.message : "수동검토 CSV를 읽지 못했습니다.";
      setStatus(message);
    } finally {
      setManualReviewUploading(false);
    }
  }

  async function importProducts(text: string) {
    if (!userId) {
      setStatus("로그인이 필요합니다.");
      return;
    }

    const importResult = parseProductsFromCsv(text);
    if (!importResult.products.length) {
      setCsvImportFailures(importResult.failures);
      setStatus(
        `가져올 상품을 찾지 못했습니다. 총 ${importResult.totalRows.toLocaleString()}행 중 실패 ${importResult.failedRows.toLocaleString()}행입니다. 헤더와 가격 컬럼을 확인해 주세요.`,
      );
      return;
    }

    const csvImportedAt = new Date().toISOString();
    const orderedImported = importResult.products.map((product, index) => ({
      ...product,
      csvOrder: index + 1,
      csvImportedAt,
    }));
    const merged = mergeImportedProducts(products, orderedImported);

    try {
      await saveProductList(userId, merged);
      setProducts(merged);
      await loadTrackingData();
      setCsvImportFailures(importResult.failures);
      setStatus(
        `CSV ${importResult.totalRows.toLocaleString()}행 중 ${importResult.products.length.toLocaleString()}개 상품을 동기화했습니다. 실패 ${importResult.failedRows.toLocaleString()}행입니다.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "CSV 저장에 실패했습니다.";
      setCsvImportFailures([
        {
          rowNumber: 0,
          reason: `DB 저장 실패: ${message}`,
          rawValue: `전체 ${importResult.totalRows.toLocaleString()}행`,
        },
      ]);
      setStatus(
        `CSV 저장에 실패했습니다. 저장 0개, 실패 ${importResult.totalRows.toLocaleString()}행입니다. ${message}`,
      );
    }
  }

  async function checkProduct(product: TrackedBuymaProduct, options?: { silent?: boolean }) {
    const keyword = product.searchKeyword || product.title;
    const productLabel = getProductLabel(product);
    if (!product.searchUrl && !keyword) {
      updateProduct(product.id, { error: "검색 URL 또는 검색어가 없습니다." });
      if (!options?.silent) {
        setStatus(`${productLabel} 확인 실패: 검색 URL 또는 검색어가 없습니다.`);
      }
      return;
    }

    setCheckingIds((current) => new Set(current).add(product.id));
    updateProduct(product.id, { error: undefined });
    if (!options?.silent) {
      setStatus(`${productLabel} 가격 확인 중입니다.`);
    }

    try {
      const response = await fetch("/api/buyma/competitor-prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          searchUrl: product.searchUrl,
          keyword,
        }),
      });
      const data = (await response.json()) as BuymaCompetitorPriceResponse;

      if (!response.ok || !data.ok) {
        const message = data.ok ? "가격 확인에 실패했습니다." : data.error;
        updateProduct(product.id, {
          error: message,
          lastCheckedAt: new Date().toISOString(),
        });
        if (!options?.silent) {
          setStatus(`${productLabel} 확인 실패: ${message}`);
        }
        return;
      }

      const { referencePrice, lowerCompetitors } = compareBuymaCompetitorPrices({
        results: data.results,
        ownerName,
        ownPrice: product.ownPrice,
        title: product.title,
        modelNumber: product.modelNumber,
        searchKeyword: keyword,
      });

      updateProduct(product.id, {
        lastCheckedAt: data.checkedAt,
        lastSearchUrl: data.searchUrl,
        referencePrice,
        lowerCompetitors,
        lastResults: data.results,
        error: data.results.length ? undefined : "검색 결과에서 가격을 찾지 못했습니다.",
      });
      if (!options?.silent) {
        setStatus(`${productLabel} 확인 완료${filterMode === "unchecked" ? " - 미확인만 보기에서는 확인된 상품이 목록에서 빠집니다." : ""}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "가격 확인에 실패했습니다.";
      updateProduct(product.id, { error: message, lastCheckedAt: new Date().toISOString() });
      if (!options?.silent) {
        setStatus(`${productLabel} 확인 실패: ${message}`);
      }
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(product.id);
        return next;
      });
      setSelectedProductIds((current) => {
        if (!current.has(product.id)) return current;
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

  async function checkSelectedProducts() {
    const targets = selectedProducts;
    if (!targets.length) {
      setStatus("확인할 상품을 선택해 주세요.");
      return;
    }

    if (!session?.access_token) {
      setStatus("로그인이 필요합니다.");
      return;
    }

    const targetIds = targets.slice(0, BATCH_LIMIT).map((product) => product.id);
    const cappedMessage =
      targets.length > BATCH_LIMIT
        ? ` 선택 ${targets.length.toLocaleString()}개 중 최대 ${BATCH_LIMIT}개만 확인합니다.`
        : "";

    setCheckingBatch(true);
    setStatus(`서버에서 선택 상품 ${targetIds.length.toLocaleString()}개 가격 확인을 시작했습니다.${cappedMessage}`);

    try {
      const response = await fetch("/api/buyma/competitor-price-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ limit: BATCH_LIMIT, ids: targetIds }),
      });
      const data = (await response.json()) as
        | { ok: true; checked: number; failed: number }
        | { ok: false; error: string };

      if (!response.ok || !data.ok) {
        setStatus(data.ok ? "선택 상품 확인에 실패했습니다." : data.error);
        return;
      }

      await loadTrackingData();
      setSelectedProductIds(new Set());
      setStatus(
        `선택 상품 ${data.checked.toLocaleString()}개 확인 완료, 실패 ${data.failed.toLocaleString()}개입니다.${cappedMessage}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "선택 상품 확인에 실패했습니다.";
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

  async function saveManualReviewItemPatch(productId: string, patch: Record<string, unknown>) {
    if (!userId || !productId || !Object.keys(patch).length) return false;

    const { error } = await supabase
      .from("manual_price_review_items")
      .update(patch)
      .eq("user_id", userId)
      .eq("id", productId);

    if (error) {
      setStatus(`수동검토 저장에 실패했습니다: ${error.message}`);
      return false;
    }

    return true;
  }

  async function removeAllManualReviewProducts() {
    if (!userId || !manualReviewBatchId || !manualReviewSourceProducts.length) return;

    const confirmed = window.confirm(
      `현재 수동가격검토 목록 ${manualReviewSourceProducts.length.toLocaleString()}개를 전체 삭제할까요?\n\n검토상태, 확인한 최저 경쟁가, 업로드 예정가도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return;

    setStatus("수동가격검토 목록 전체 삭제 중입니다.");

    const { error } = await supabase
      .from("manual_price_review_batches")
      .delete()
      .eq("user_id", userId)
      .eq("id", manualReviewBatchId);

    if (error) {
      setStatus(`수동가격검토 전체 삭제에 실패했습니다: ${error.message}`);
      return;
    }

    applyManualReviewRows([], null);
    setCsvImportFailures([]);
    setStatus(`수동가격검토 목록 ${manualReviewSourceProducts.length.toLocaleString()}개를 삭제했습니다.`);
  }

  function removeProduct(id: string) {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    const confirmed = window.confirm(`${getProductLabel(product)} 상품을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
    if (!confirmed) return;

    setProducts((current) => current.filter((product) => product.id !== id));
    setSelectedProductIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

    if (userId) {
      void supabase
        .from("competitor_price_products")
        .delete()
        .eq("user_id", userId)
        .eq("id", id);
    }
  }

  async function removeSelectedProducts() {
    if (!userId || !selectedProducts.length) return;
    const ids = selectedProducts.map((product) => product.id);
    const confirmed = window.confirm(`선택한 ${ids.length.toLocaleString()}개 상품을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
    if (!confirmed) return;

    const previousProducts = products;
    const previousSelectedIds = selectedProductIds;
    setProducts((current) => current.filter((product) => !ids.includes(product.id)));
    setSelectedProductIds(new Set());
    setStatus("선택 삭제 중입니다.");

    const { error } = await supabase
      .from("competitor_price_products")
      .delete()
      .eq("user_id", userId)
      .in("id", ids);

    if (error) {
      setProducts(previousProducts);
      setSelectedProductIds(previousSelectedIds);
      setStatus(`선택 삭제에 실패했습니다: ${error.message}`);
      return;
    }

    setStatus(`선택한 ${ids.length.toLocaleString()}개 상품을 삭제했습니다.`);
  }

  function toggleProductSelection(id: string, checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleCurrentPageSelection(checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      currentPageProducts.forEach((product) => {
        if (checked) {
          next.add(product.id);
        } else {
          next.delete(product.id);
        }
      });
      return next;
    });
  }

  function updatePriceEdit(productId: string, value: string) {
    const numericValue = value.replace(/[^\d]/g, "");

    setPriceEdits((current) => {
      const next = { ...current };
      next[productId] = numericValue;
      return next;
    });
  }

  function toggleManualReviewSelection(id: string, checked: boolean) {
    setSelectedManualReviewProductIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleCurrentManualReviewPageSelection(checked: boolean) {
    setSelectedManualReviewProductIds((current) => {
      const next = new Set(current);
      manualReviewListProducts.forEach((product) => {
        if (checked) {
          next.add(product.id);
        } else {
          next.delete(product.id);
        }
      });
      return next;
    });
  }

  async function updateManualPriceEdit(productId: string, value: string) {
    const numericValue = value.replace(/[^\d]/g, "");
    const previousValue = manualPriceEdits[productId];
    const numericPrice = Number(numericValue);

    setManualPriceEdits((current) => {
      const next = { ...current };
      next[productId] = numericValue;
      return next;
    });

    if (!numericValue || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      return;
    }

    const saved = await saveManualReviewItemPatch(productId, {
      manual_update_price: Math.floor(numericPrice),
    });
    if (!saved) {
      setManualPriceEdits((current) => {
        const next = { ...current };
        if (previousValue === undefined) {
          delete next[productId];
        } else {
          next[productId] = previousValue;
        }
        return next;
      });
    }
  }

  async function updateManualLowestPrice(product: TrackedBuymaProduct, value: string) {
    const numericValue = value.replace(/[^\d]/g, "");
    const previousValue = manualLowestPrices[product.id];

    setManualLowestPrices((current) => ({
      ...current,
      [product.id]: numericValue,
    }));
    const saved = await saveManualReviewItemPatch(product.id, {
      manual_lowest_price: numericValue ? Number(numericValue) : null,
    });
    if (!saved) {
      setManualLowestPrices((current) => {
        const next = { ...current };
        if (previousValue === undefined) {
          delete next[product.id];
        } else {
          next[product.id] = previousValue;
        }
        return next;
      });
      return;
    }

    const lowestPrice = Number(numericValue);
    if (Number.isFinite(lowestPrice) && lowestPrice > 0) {
      await updateManualPriceEdit(product.id, String(Math.max(1, lowestPrice - 10)));
    }
  }

  function downloadPriceUpdateCsv() {
    downloadPriceUpdateCsvForTargets({
      targets: selectedProducts,
      emptyMessage: "가격수정 CSV로 다운로드할 상품을 선택해 주세요.",
      scopeLabel: "선택 상품 기준",
    });
  }

  function downloadManualReviewCsv() {
    downloadPriceUpdateCsvForTargets({
      targets: selectedManualReviewReviewedProducts,
      candidateCount: selectedManualReviewProducts.length,
      emptyMessage: "선택한 상품 중 검토완료 상품이 없습니다.",
      editedPrices: manualPriceEdits,
      scopeLabel: "선택한 검토완료 기준",
      reviewOnly: true,
      requirePriceChange: true,
      onDownloaded: markManualReviewExported,
    });
  }

  function downloadPriceUpdateCsvForTargets({
    targets,
    emptyMessage,
    editedPrices = priceEdits,
    scopeLabel,
    candidateCount = targets.length,
    reviewOnly = false,
    requirePriceChange = false,
    onDownloaded,
  }: {
    targets: TrackedBuymaProduct[];
    emptyMessage: string;
    editedPrices?: Record<string, string>;
    scopeLabel: string;
    candidateCount?: number;
    reviewOnly?: boolean;
    requirePriceChange?: boolean;
    onDownloaded?: (products: TrackedBuymaProduct[]) => void;
  }) {
    if (!targets.length) {
      setStatus(emptyMessage);
      return;
    }

    let skippedUnchangedCount = 0;
    const csvRows = targets.flatMap((product) => {
      const productId = product.buymaProductId.trim();
      const price = getExportPrice(product, editedPrices[product.id]);

      if (!productId || !price) return [];
      if (requirePriceChange && !hasExportPriceChange(product, price)) {
        skippedUnchangedCount += 1;
        return [];
      }
      return [{ product, row: [productId, "公開", "出品中", String(price)] }];
    });
    const rows = csvRows.map((item) => item.row);

    if (!rows.length) {
      if (requirePriceChange && skippedUnchangedCount > 0) {
        setStatus("가격이 변경된 검토완료 상품이 없습니다. 업로드 예정가가 바이마 현재가와 다른 상품만 다운로드됩니다.");
        return;
      }
      setStatus("다운로드할 BUYMA 상품ID와 가격이 있는 상품이 없습니다.");
      return;
    }

    const excludedCount = Math.max(0, candidateCount - rows.length);
    const unchangedText = requirePriceChange
      ? `\n가격 미변경 제외: ${skippedUnchangedCount.toLocaleString()}개`
      : "";
    let conditionText = reviewOnly
      ? "검토완료 상태이며 BUYMA 상품ID와 가격이 있는 상품만 CSV에 포함됩니다."
      : "BUYMA 상품ID와 가격이 있는 상품만 CSV에 포함됩니다.";
    conditionText = `${unchangedText}${conditionText}`;
    const confirmed = window.confirm(
      `${scopeLabel} 가격수정 CSV를 다운로드합니다.\n\n다운로드 대상: ${rows.length.toLocaleString()}개\n제외됨: ${excludedCount.toLocaleString()}개\n\n${conditionText}\n\n계속 다운로드할까요?`,
    );
    if (!confirmed) return;

    const content = "\uFEFF" + toCsvContent([["商品ID", "コントロール", "公開ステータス", "単価"], ...rows]);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `buyma_price_update_${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setStatus(`${rows.length.toLocaleString()}개 상품 가격수정 CSV를 다운로드했습니다.`);
    onDownloaded?.(csvRows.map((item) => item.product));
  }

  function markManualReviewExported(exportedProducts: TrackedBuymaProduct[]) {
    if (!userId || !exportedProducts.length) return;

    const exportedAt = new Date().toISOString();
    void supabase
      .from("manual_price_review_items")
      .update({ exported_at: exportedAt })
      .eq("user_id", userId)
      .in("id", exportedProducts.map((product) => product.id))
      .then(({ error }) => {
        if (error) {
          setStatus(`CSV 내보냄 기록 저장에 실패했습니다: ${error.message}`);
        }
      });
  }

  function moveManualReview(offset: number) {
    if (!manualReviewProducts.length) return;

    const currentIndex = manualReviewProduct
      ? Math.max(0, manualReviewProducts.findIndex((product) => product.id === manualReviewProduct.id))
      : 0;
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), manualReviewProducts.length - 1);
    const nextProduct = manualReviewProducts[nextIndex];
    setManualReviewProductId(nextProduct.id);
  }

  async function completeManualReview(product: TrackedBuymaProduct) {
    const manualUpdatePrice = getPositiveIntegerPrice(getManualReviewPriceEditValue(product, manualPriceEdits));
    if (manualUpdatePrice === null) {
      setManualReviewProductId(product.id);
      setStatus(`${getProductLabel(product)} 업로드 예정가는 1엔 이상 입력해야 검토완료로 저장할 수 있습니다.`);
      return false;
    }

    const reviewedAt = new Date().toISOString();
    const saved = await saveManualReviewItemPatch(product.id, {
      manual_update_price: manualUpdatePrice,
      review_status: "reviewed",
      reviewed_at: reviewedAt,
      recheck_requested_at: null,
    });
    if (!saved) return false;

    setManualReviewedIds((current) => {
      const next = new Set(current);
      next.add(product.id);
      return next;
    });
    setManualRecheckIds((current) => {
      const next = new Set(current);
      next.delete(product.id);
      return next;
    });
    setManualReviewedAt((current) => ({
      ...current,
      [product.id]: reviewedAt,
    }));
    setStatus(`${getProductLabel(product)} 수동 검토를 완료했습니다.`);
    return true;
  }

  async function requestManualRecheck(product: TrackedBuymaProduct) {
    const recheckRequestedAt = new Date().toISOString();
    const saved = await saveManualReviewItemPatch(product.id, {
      review_status: "recheck",
      reviewed_at: null,
      recheck_requested_at: recheckRequestedAt,
    });
    if (!saved) return;

    setManualReviewedIds((current) => {
      const next = new Set(current);
      next.delete(product.id);
      return next;
    });
    setManualRecheckIds((current) => {
      const next = new Set(current);
      next.add(product.id);
      return next;
    });
    setManualRecheckRequestedAt((current) => ({
      ...current,
      [product.id]: recheckRequestedAt,
    }));
    setManualReviewedAt((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setManualReviewProductId(product.id);
    setStatus(`${getProductLabel(product)} 상품을 재검토 필요로 표시했습니다.`);
  }

  async function saveManualReviewAndNext(product: TrackedBuymaProduct) {
    const saved = await completeManualReview(product);
    if (!saved) return;

    const currentIndex = manualReviewProducts.findIndex((item) => item.id === product.id);
    const nextReviewedIds = new Set(manualReviewedIds);
    nextReviewedIds.add(product.id);
    const nextProduct =
      manualReviewProducts.slice(Math.max(currentIndex + 1, 0)).find((item) => !nextReviewedIds.has(item.id)) ??
      manualReviewProducts.slice(0, Math.max(currentIndex, 0)).find((item) => !nextReviewedIds.has(item.id));

    if (nextProduct) {
      setManualReviewProductId(nextProduct.id);
    }
  }

  function openBuymaReviewUrl(product: TrackedBuymaProduct) {
    const url = getBuymaReviewUrl(product);
    if (!url) {
      setStatus(`${getProductLabel(product)} BUYMA 검색 링크가 없습니다.`);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function downloadSampleCsv() {
    const content = [
      "商品ID,商品名,ブランド名,単価,ブランド品番1,検索キーワード,検索URL",
      "123456789,HATCHINGROOM Abstract H Tee,HATCHINGROOM,10100,HR-HT-001,,",
      "123456790,SATUR Teo Denim Blouson Jacket,SATUR,24630,,,",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "buyma-items-competitor-price-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadImportFailureCsv() {
    if (!csvImportFailures.length) return;

    const rows = csvImportFailures.map((failure) => [
      formatImportFailureRowNumber(failure.rowNumber),
      failure.reason,
      failure.rawValue,
    ]);
    const content = "\uFEFF" + toCsvContent([["행", "실패이유", "원본값"], ...rows]);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `buyma_import_failures_${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (isManualReviewMode) {
    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
          <div className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={manualReviewFileInputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={(event) => void handleManualReviewFileChange(event)}
                className="sr-only"
              />
              <button
                type="button"
                disabled={!trackingLoaded || manualReviewUploading}
                onClick={() => {
                  if (manualReviewFileInputRef.current) {
                    manualReviewFileInputRef.current.value = "";
                    manualReviewFileInputRef.current.click();
                  }
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#151515] px-4 text-sm font-extrabold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {manualReviewUploading ? "업로드 중" : "BUYMA CSV 업로드"}
              </button>
              <button
                type="button"
                disabled={!manualReviewSourceProducts.length}
                onClick={() => void removeAllManualReviewProducts()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#c43b2f]/25 bg-white px-4 text-sm font-extrabold text-[#c43b2f] transition hover:border-[#c43b2f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                전체 삭제
              </button>
            </div>

            <p className="mt-4 text-xs font-bold leading-5 text-[#6c655b]">
              BUYMA CSV 파일만 업로드할 수 있습니다. 업로드가 실패하면 기존 목록은 변경하지 않습니다.
            </p>
            {manualReviewBatchLabel ? (
              <p className="mt-3 text-xs font-extrabold text-[#6c655b]">
                현재 묶음 {manualReviewBatchLabel}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-extrabold text-[#6c655b]">
              <span className="rounded-full bg-[#eef3ff] px-3 py-1.5 text-[#2d73ff]">
                현재 보기 {manualReviewProducts.length.toLocaleString()}개
              </span>
              <span className="rounded-full bg-[#e9f8ef] px-3 py-1.5 text-[#24784c]">
                전체 검토완료 {manualReviewedProducts.length.toLocaleString()}개
              </span>
              <span className="rounded-full bg-white px-3 py-1.5">
                전체 검토대기 {manualRemainingProducts.length.toLocaleString()}개
              </span>
              <span className="rounded-full bg-[#fff6e8] px-3 py-1.5 text-[#9a5c00]">
                재검토 필요 {manualRecheckProducts.length.toLocaleString()}개
              </span>
            </div>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-black/10 bg-white p-4 shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-[#151515]">현재 작업상품</h2>
            </div>
          </div>

          {manualReviewProduct ? (
            <div className="grid gap-4 rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex min-h-8 w-fit items-center rounded-lg bg-[#151515] px-3 text-sm font-extrabold text-white">
                    현재 {manualReviewPosition.toLocaleString()} / 전체 {manualReviewProducts.length.toLocaleString()}
                  </div>
                  <div className="mt-1 break-words text-base font-extrabold text-[#151515]">
                    {manualReviewProduct.title || manualReviewProduct.buymaProductId || "제목 없음"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-[#6c655b]">
                    {manualReviewProduct.brand ? <span>브랜드 {manualReviewProduct.brand}</span> : null}
                    {manualReviewProduct.modelNumber ? <span>모델번호 {manualReviewProduct.modelNumber}</span> : null}
                    {manualReviewProduct.buymaProductId ? <span>상품ID {manualReviewProduct.buymaProductId}</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-extrabold">
                    {manualReviewProductStatus ? (
                      <StatusPill tone={manualReviewProductStatus.tone} label={manualReviewProductStatus.label} />
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!manualReviewUrl}
                    onClick={() => openBuymaReviewUrl(manualReviewProduct)}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#2d73ff]/25 bg-white px-3 text-sm font-extrabold text-[#2d73ff] transition hover:border-[#2d73ff] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    BUYMA 열기
                  </button>
                  <button
                    type="button"
                    disabled={manualReviewPosition <= 1}
                    onClick={() => moveManualReview(-1)}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-black/15 bg-white px-3 text-sm font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    이전 상품
                  </button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-lg border border-[#2d73ff]/25 bg-[#eef3ff] px-4 py-3">
                  <div className="text-xs font-extrabold text-[#2d73ff]">바이마 현재가</div>
                  <div className="mt-1 text-2xl font-extrabold text-[#174bb8]">{formatYen(manualReviewProduct.ownPrice)}</div>
                </div>
                <div className="rounded-lg border border-[#2f9d62]/20 bg-[#e9f8ef] px-3 py-2">
                  <div className="text-[11px] font-extrabold text-[#24784c]">업로드 예정가</div>
                  <div className={`mt-1 text-lg font-extrabold ${isManualReviewUploadPriceInvalid ? "text-[#c43b2f]" : "text-[#24784c]"}`}>
                    {manualReviewUploadPrice === null ? "미입력" : formatYen(manualReviewUploadPrice)}
                  </div>
                </div>
                <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                  <div className="text-[11px] font-extrabold text-[#6c655b]">변경금액</div>
                  {manualReviewUploadPrice === null ? (
                    <div className="mt-1 text-lg font-extrabold text-[#c43b2f]">미입력</div>
                  ) : manualReviewPriceDiff ? (
                    <div className={`mt-1 text-lg font-extrabold ${manualReviewPriceDiff < 0 ? "text-[#2d73ff]" : "text-[#9a5c00]"}`}>
                      {manualReviewPriceDiff > 0 ? "+" : ""}{formatYen(manualReviewPriceDiff)}
                    </div>
                  ) : (
                    <div className="mt-1 text-lg font-extrabold text-[#8a8378]">변경 없음</div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_560px] xl:grid-cols-[minmax(0,1fr)_560px_180px] xl:items-start">
                <label className="grid grid-rows-[16px_40px_16px] gap-1 text-xs font-extrabold text-[#6c655b]">
                  <span className="leading-4">검색기준</span>
                  <div className="min-h-10 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-bold text-[#151515]">
                    {manualReviewProduct.searchKeyword || manualReviewProduct.title || "-"}
                  </div>
                  <span className="min-h-4" aria-hidden="true" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2 sm:gap-x-5">
                  <label className="grid grid-rows-[16px_40px_16px] gap-1 text-xs font-extrabold text-[#6c655b]">
                    <span className="leading-4">확인한 최저 경쟁가</span>
                    <input
                    value={manualReviewLowestPrice}
                    onChange={(event) => void updateManualLowestPrice(manualReviewProduct, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void saveManualReviewAndNext(manualReviewProduct);
                      }
                    }}
                    inputMode="numeric"
                    placeholder="예: 18900"
                      className="min-h-10 rounded-lg border border-black/10 bg-white px-3 text-sm font-extrabold text-[#151515] outline-none transition placeholder:text-[#aaa39a] focus:border-[#2d73ff]"
                    />
                    <span className="min-h-4" aria-hidden="true" />
                  </label>
                  <label className="grid grid-rows-[16px_40px_16px] gap-1 text-xs font-extrabold text-[#6c655b]">
                    <span className="leading-4">업로드 예정가</span>
                    <input
                    value={manualReviewSuggestedPrice}
                    onChange={(event) => void updateManualPriceEdit(manualReviewProduct.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void saveManualReviewAndNext(manualReviewProduct);
                      }
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-invalid={isManualReviewUploadPriceInvalid}
                      className={`min-h-10 rounded-lg border bg-white px-3 text-sm font-extrabold text-[#151515] outline-none transition ${
                        isManualReviewUploadPriceInvalid
                          ? "border-[#c43b2f] focus:border-[#c43b2f]"
                          : "border-black/10 focus:border-[#2d73ff]"
                      }`}
                    />
                    {isManualReviewUploadPriceInvalid ? (
                      <span className="min-h-4 text-[11px] font-extrabold leading-4 text-[#c43b2f]">
                        1엔 이상 숫자로 입력
                      </span>
                    ) : (
                      <span className="min-h-4" aria-hidden="true" />
                    )}
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void saveManualReviewAndNext(manualReviewProduct)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#2f9d62] px-4 text-sm font-extrabold text-white transition hover:bg-[#24784c] xl:mt-5"
                >
                  저장하고 다음
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4 text-sm font-bold text-[#6c655b]">
              BUYMA CSV를 업로드하거나 현재 보기 조건을 변경해 주세요.
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-lg border border-black/10 bg-white p-3 shadow-[0_10px_32px_rgba(61,48,35,0.06)]">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="manual-review-filter-mode">
              보기
              <select
                id="manual-review-filter-mode"
                value={manualReviewFilterMode}
                onChange={(event) => {
                  setManualReviewFilterMode(event.target.value as ManualReviewFilterMode);
                  resetManualReviewSelectionForListChange();
                  setManualReviewListPage(1);
                }}
                className="min-h-10 min-w-[140px] rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition focus:border-[#2d73ff]"
              >
                <option value="all">전체</option>
                <option value="pending">검토대기</option>
                <option value="reviewed">검토완료</option>
                <option value="recheck">재검토 필요</option>
              </select>
            </label>
            <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="manual-review-product-search">
              검색
              <input
                id="manual-review-product-search"
                value={manualReviewProductSearch}
                onChange={(event) => {
                  setManualReviewProductSearch(event.target.value);
                  resetManualReviewSelectionForListChange();
                  setManualReviewListPage(1);
                }}
                placeholder="상품명 또는 상품번호 검색"
                className="min-h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition placeholder:text-[#9a9388] focus:border-[#2d73ff]"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="manual-review-sort-mode">
                정렬
                <select
                  id="manual-review-sort-mode"
                  value={manualReviewSortMode}
                  onChange={(event) => {
                    setManualReviewSortMode(event.target.value as ManualReviewSortMode);
                    setManualReviewProductId("");
                    resetManualReviewSelectionForListChange();
                    setManualReviewListPage(1);
                  }}
                  className="min-h-10 min-w-[140px] rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition focus:border-[#2d73ff]"
                >
                  <option value="csv">CSV 순서</option>
                  <option value="csvReverse">CSV 역순</option>
                  <option value="title">상품명순</option>
                  <option value="oldestReviewed">검토완료일 오래된순</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="manual-review-page-size">
                표시
                <select
                  id="manual-review-page-size"
                  value={String(manualReviewListPageSize)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setManualReviewListPageSize(value === "all" ? "all" : (Number(value) as ManualReviewListPageSize));
                    resetManualReviewSelectionForListChange();
                    setManualReviewListPage(1);
                  }}
                  className="min-h-10 min-w-[110px] rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition focus:border-[#2d73ff]"
                >
                  <option value="10">10개 보기</option>
                  <option value="30">30개 보기</option>
                  <option value="50">50개 보기</option>
                  <option value="100">100개 보기</option>
                  <option value="300">300개 보기</option>
                  <option value="500">500개 보기</option>
                  <option value="all">전체 보기</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-[#6c655b]">
                선택 {selectedManualReviewProducts.length.toLocaleString()}개
              </span>
              <div className="flex min-h-10 items-center rounded-lg border border-[#2d73ff]/20 bg-[#eef3ff] px-3 text-xs font-extrabold text-[#2d73ff]">
                선택한 상품 중 가격이 변경된 검토완료 상품만 CSV에 포함됩니다.
              </div>
              <button
                type="button"
                disabled={!selectedManualReviewProducts.length}
                onClick={downloadManualReviewCsv}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#2d73ff]/25 bg-white px-4 text-sm font-extrabold text-[#2d73ff] transition hover:border-[#2d73ff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                선택 검토완료 CSV {manualReviewSelectedCsvCount.toLocaleString()}개
              </button>
            </div>
          </div>
        </section>

        {manualReviewProducts.length ? (
          <section className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-[#fbfaf7] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setManualReviewListOpen((open) => !open)}
                  className="inline-flex min-h-8 items-center justify-center rounded-lg border border-black/15 bg-white px-3 text-sm font-extrabold text-[#151515] transition hover:border-black/30"
                >
                  {manualReviewListOpen ? "검토 목록 접기" : "검토 목록 펼치기"}
                </button>
                {manualReviewListOpen ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#6c655b]">
                    <span>
                      {manualReviewListStart.toLocaleString()}-{manualReviewListEnd.toLocaleString()} / {manualReviewProducts.length.toLocaleString()}개
                    </span>
                    <button
                      type="button"
                      disabled={safeManualReviewListPage <= 1}
                      onClick={() => setManualReviewListPage((page) => Math.max(1, page - 1))}
                      className="inline-flex min-h-8 items-center justify-center rounded-lg border border-black/15 bg-white px-2 text-xs font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      이전
                    </button>
                    <span>
                      {safeManualReviewListPage.toLocaleString()} / {manualReviewListTotalPages.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      disabled={safeManualReviewListPage >= manualReviewListTotalPages}
                      onClick={() => setManualReviewListPage((page) => Math.min(manualReviewListTotalPages, page + 1))}
                      className="inline-flex min-h-8 items-center justify-center rounded-lg border border-black/15 bg-white px-2 text-xs font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      다음
                    </button>
                  </div>
                ) : null}
              </div>
              {manualReviewListOpen ? (
              <div className="max-h-[620px] overflow-auto">
                <table className="min-w-[1080px] w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white text-xs font-extrabold text-[#6c655b] shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                    <tr>
                      <th className="w-16 px-4 py-3">No</th>
                      <th className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isManualReviewCurrentPageAllSelected}
                          disabled={!manualReviewListProducts.length}
                          onChange={(event) => toggleCurrentManualReviewPageSelection(event.target.checked)}
                          aria-label="현재 수동검토 페이지 전체 선택"
                          className="h-4 w-4 rounded border-black/20"
                        />
                      </th>
                      <th className="px-4 py-3">상품</th>
                      <th className="px-4 py-3">상태</th>
                      <th className="px-4 py-3">바이마 현재가</th>
                      <th className="px-4 py-3">업로드 예정가</th>
                      <th className="px-4 py-3">검토완료일</th>
                      <th className="px-4 py-3 text-right">작업</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10 bg-white">
                    {manualReviewListProducts.map((product, index) => {
                      const isReviewed = manualReviewedIds.has(product.id);
                      const isRecheck = manualRecheckIds.has(product.id);
                      const isCurrent = product.id === manualReviewProduct?.id;
                      const manualUpdatePrice = getManualReviewPriceEditValue(product, manualPriceEdits);
                      const uploadPrice = getPositiveIntegerPrice(manualUpdatePrice);
                      const hasPriceChange = uploadPrice !== null && hasExportPriceChange(product, uploadPrice);
                      const reviewStatus = getManualReviewStatus(isReviewed, isRecheck);
                      const rowNumber = manualReviewProducts.length - (manualReviewListStart + index - 1);
                      return (
                        <tr key={product.id} className={isCurrent ? "bg-[#eef3ff]" : undefined}>
                          <td className="px-4 py-3 align-top text-xs font-extrabold text-[#8a8378]">
                            {rowNumber.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <input
                              type="checkbox"
                              checked={selectedManualReviewProductIds.has(product.id)}
                              onChange={(event) => toggleManualReviewSelection(product.id, event.target.checked)}
                              aria-label={`${getProductLabel(product)} 선택`}
                              className="h-4 w-4 rounded border-black/20"
                            />
                          </td>
                          <td className="min-w-[420px] px-4 py-3 align-top">
                            <div className="font-extrabold text-[#151515]">{product.title || product.buymaProductId || "제목 없음"}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-[#6c655b]">
                              {product.brand ? <span>브랜드 {product.brand}</span> : null}
                              {product.modelNumber ? <span>모델번호 {product.modelNumber}</span> : null}
                              {product.buymaProductId ? <span>상품ID {product.buymaProductId}</span> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <StatusPill tone={reviewStatus.tone} label={reviewStatus.label} />
                          </td>
                          <td className="px-4 py-3 align-top font-extrabold text-[#174bb8]">{formatYen(product.ownPrice)}</td>
                          <td className="px-4 py-3 align-top">
                            {uploadPrice === null ? (
                              <span className="font-bold text-[#c43b2f]">미입력</span>
                            ) : hasPriceChange ? (
                              <span className="font-extrabold text-[#2d73ff]">{formatYen(uploadPrice)}</span>
                            ) : (
                              <span className="font-bold text-[#8a8378]">변경 없음</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-xs font-bold text-[#6c655b]">
                            {isRecheck && manualRecheckRequestedAt[product.id]
                              ? formatDateTime(manualRecheckRequestedAt[product.id])
                              : manualReviewedAt[product.id]
                                ? formatDateTime(manualReviewedAt[product.id])
                                : "-"}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setManualReviewProductId(product.id)}
                                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-black/15 bg-white px-3 text-xs font-extrabold text-[#151515] transition hover:border-black/30"
                              >
                                보기
                              </button>
                              {isReviewed ? (
                                <button
                                  type="button"
                                  onClick={() => void requestManualRecheck(product)}
                                  className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[#d78b1f]/25 bg-white px-3 text-xs font-extrabold text-[#9a5c00] transition hover:border-[#d78b1f]"
                                >
                                  재검토로 변경
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void completeManualReview(product)}
                                  className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[#2f9d62]/25 bg-white px-3 text-xs font-extrabold text-[#24784c] transition hover:border-[#2f9d62]"
                                >
                                  검토완료로 변경
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              ) : null}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
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
                onClick={downloadSampleCsv}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-4 text-sm font-extrabold text-[#151515] transition hover:border-black/30"
              >
                샘플 CSV
              </button>
            </div>

            <p className="mt-4 text-xs font-bold leading-5 text-[#6c655b]">
              CSV 파일만 업로드할 수 있습니다. 업로드가 실패하면 기존 목록은 변경하지 않습니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-extrabold text-[#6c655b]">
              <span className="rounded-full bg-white px-3 py-1.5">전체 {products.length.toLocaleString()}</span>
              <span className="rounded-full bg-white px-3 py-1.5">추적중 {activeProducts.length.toLocaleString()}</span>
              <span className="rounded-full bg-[#fff1e6] px-3 py-1.5 text-[#b95600]">더 낮은 가격 {alertProducts.length.toLocaleString()}</span>
              <span className="rounded-full bg-[#eef3ff] px-3 py-1.5 text-[#2d73ff]">확인완료 {checkedProducts.length.toLocaleString()}</span>
            </div>
            <p className="mt-3 text-sm font-bold text-[#6c655b]">{status}</p>
            {csvImportFailures.length ? (
              <div className="mt-4 grid gap-2 text-xs font-bold text-[#6c655b]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>최근 업로드 실패 {csvImportFailures.length.toLocaleString()}건</span>
                  <button
                    type="button"
                    onClick={downloadImportFailureCsv}
                    className="inline-flex min-h-8 items-center justify-center rounded-lg border border-black/15 bg-white px-3 text-xs font-extrabold text-[#151515] transition hover:border-black/30"
                  >
                    실패내역 CSV
                  </button>
                </div>
                <ul className="grid gap-1">
                  {csvImportFailures.slice(0, 10).map((failure, index) => (
                    <li key={`${failure.rowNumber}-${index}`}>
                      {formatImportFailureRowNumber(failure.rowNumber)}행 - {failure.reason}
                    </li>
                  ))}
                </ul>
                {csvImportFailures.length > 10 ? (
                  <div>나머지 {(csvImportFailures.length - 10).toLocaleString()}건은 실패내역 CSV에서 확인할 수 있습니다.</div>
                ) : null}
              </div>
            ) : null}
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
      </section>

      <div className="grid gap-3 rounded-lg border border-black/10 bg-white p-3 shadow-[0_10px_32px_rgba(61,48,35,0.06)]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="competitor-filter-mode">
            보기
            <select
              id="competitor-filter-mode"
              value={filterMode}
              onChange={(event) => {
                const nextFilterMode = event.target.value as ProductFilterMode;
                setFilterMode(nextFilterMode);
                if (
                  nextFilterMode === "unchecked" &&
                  (pageSize === "all" || pageSize > UNCHECKED_MAX_PAGE_SIZE)
                ) {
                  setPageSize(UNCHECKED_MAX_PAGE_SIZE);
                }
                resetSelectionForListChange();
                setCurrentPage(1);
              }}
              className="min-h-10 min-w-[140px] rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition focus:border-[#2d73ff]"
            >
              <option value="all">전체보기</option>
              <option value="unchecked">미확인만 보기</option>
              <option value="checked">확인만 보기</option>
              <option value="lower">낮은 가격 있음</option>
              <option value="noLower">낮은 가격 없음</option>
              <option value="error">오류만 보기</option>
              <option value="empty">검색결과 없음</option>
              <option value="missing">파일누락만 보기</option>
            </select>
          </label>
          <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="competitor-product-search">
            검색
            <input
              id="competitor-product-search"
              value={productNameSearch}
              onChange={(event) => {
                setProductNameSearch(event.target.value);
                resetSelectionForListChange();
                setCurrentPage(1);
              }}
              placeholder="상품명 또는 상품번호 검색"
              className="min-h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition placeholder:text-[#9a9388] focus:border-[#2d73ff]"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-black/10 bg-[#fbfaf7] px-3 text-xs font-extrabold text-[#6c655b]">
              {pageStart.toLocaleString()}-{pageEnd.toLocaleString()} / {sortedProducts.length.toLocaleString()}
              {selectedProducts.length ? ` · 선택 ${selectedProducts.length.toLocaleString()}` : ""}
            </div>
            <label className="grid gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="competitor-sort-mode">
              정렬
              <select
                id="competitor-sort-mode"
                value={sortMode}
                onChange={(event) => {
                  setSortMode(event.target.value as SortMode);
                  resetSelectionForListChange();
                  setCurrentPage(1);
                }}
                className="min-h-10 min-w-[140px] rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition focus:border-[#2d73ff]"
              >
                <option value="action">조치 필요순</option>
                <option value="csv">CSV 순서</option>
                <option value="csvReverse">CSV 역순</option>
                <option value="unchecked">미확인 우선</option>
                <option value="oldestChecked">오래된 확인순</option>
                <option value="title">상품명순</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-extrabold text-[#6c655b]" htmlFor="competitor-page-size">
              표시
              <select
                id="competitor-page-size"
                value={String(pageSize)}
                onChange={(event) => {
                  const value = event.target.value;
                  setPageSize(value === "all" ? "all" : (Number(value) as CompetitorPageSize));
                  resetSelectionForListChange();
                  setCurrentPage(1);
                }}
                className="min-h-10 min-w-[110px] rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-[#151515] outline-none transition focus:border-[#2d73ff]"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option
                    key={option}
                    value={option}
                    disabled={filterMode === "unchecked" && (option === "all" || option > UNCHECKED_MAX_PAGE_SIZE)}
                  >
                    {option === "all" ? "전체 보기" : `${option}개 보기`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-[#fbfaf7] p-2">
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-[#6c655b]">
              선택 {selectedProducts.length.toLocaleString()}개
            </span>
            <button
              type="button"
              disabled={!selectedProducts.length || checkingBatch || checkingIds.size > 0}
              onClick={() => void checkSelectedProducts()}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#2d73ff]/25 bg-white px-3 text-sm font-extrabold text-[#2d73ff] transition hover:border-[#2d73ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedCheckLabel}
            </button>
            <button
              type="button"
              disabled={!selectedProducts.length || checkingBatch}
              onClick={downloadPriceUpdateCsv}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#2f9d62]/25 bg-white px-3 text-sm font-extrabold text-[#24784c] transition hover:border-[#2f9d62] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {priceUpdateCsvLabel}
            </button>
            <button
              type="button"
              disabled={!selectedProducts.length || checkingBatch}
              onClick={() => void removeSelectedProducts()}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#c43b2f]/25 bg-white px-3 text-sm font-extrabold text-[#c43b2f] transition hover:border-[#c43b2f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedDeleteLabel}
            </button>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_16px_48px_rgba(61,48,35,0.08)]">
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full min-w-[1380px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#f1eee6] text-xs font-extrabold text-[#6c655b] shadow-[0_1px_0_rgba(0,0,0,0.1)]">
              <tr>
                <th className="w-16 px-4 py-3">No</th>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isCurrentPageAllSelected}
                    disabled={!currentPageProducts.length}
                    onChange={(event) => toggleCurrentPageSelection(event.target.checked)}
                    aria-label="현재 페이지 전체 선택"
                    className="h-4 w-4 rounded border-black/20"
                  />
                </th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">상품</th>
                <th className="px-4 py-3">내 가격</th>
                <th className="px-4 py-3">최저 경쟁가</th>
                <th className="px-4 py-3">수정가</th>
                <th className="px-4 py-3">검색 기준</th>
                <th className="px-4 py-3">마지막 확인</th>
                <th className="px-4 py-3">관리</th>
              </tr>
            </thead>
            <tbody>
              {currentPageProducts.length ? (
                currentPageProducts.map((product, index) => {
                  const priceStatus = getPriceStatus(product);
                  const isChecking = checkingIds.has(product.id);
                  const rowNumber =
                    pageSize === "all"
                      ? sortedProducts.length - index
                      : sortedProducts.length - ((safeCurrentPage - 1) * pageSize + index);

                  return (
                    <tr key={product.id} className="border-t border-black/10 align-top">
                      <td className="px-4 py-4 text-xs font-extrabold text-[#8a8378]">
                        {rowNumber.toLocaleString()}
                      </td>
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.has(product.id)}
                          onChange={(event) => toggleProductSelection(product.id, event.target.checked)}
                          aria-label={`${product.title || product.buymaProductId || "상품"} 선택`}
                          className="h-4 w-4 rounded border-black/20"
                        />
                      </td>
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
                      <td className="px-4 py-4">
                        <div className="font-extrabold">{formatYen(product.ownPrice)}</div>
                        {hasDetectedPriceMismatch(product) ? (
                          <div className="mt-1 text-xs font-bold text-[#b95600]">
                            감지 {formatYen(product.referencePrice)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        {priceStatus.kind === "lower" ? (
                          <div>
                            <div className="font-extrabold text-[#c43b2f]">{formatYen(priceStatus.lowerCompetitor.price)}</div>
                            <div className="mt-1 text-xs font-bold text-[#6c655b]">{priceStatus.lowerCompetitor.shopper}</div>
                          </div>
                        ) : priceStatus.kind === "ok" ? (
                          <StatusPill tone="ok" label="낮은 가격 없음" />
                        ) : priceStatus.kind === "unchecked" ? (
                          <StatusPill tone="muted" label="미확인" />
                        ) : priceStatus.kind === "empty" ? (
                          <StatusPill tone="warning" label="검색결과 없음" />
                        ) : (
                          <StatusPill tone="danger" label="오류" />
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <input
                          value={getPriceEditValue(product, priceEdits)}
                          onChange={(event) => updatePriceEdit(product.id, event.target.value)}
                          inputMode="numeric"
                          placeholder={String(getDefaultEditPrice(product) || product.referencePrice || product.ownPrice || "")}
                          aria-label={`${product.title || product.buymaProductId || "상품"} 수정가`}
                          className="min-h-9 w-28 rounded-lg border border-black/10 bg-white px-3 text-sm font-extrabold text-[#151515] outline-none transition placeholder:text-[#aaa39a] focus:border-[#2d73ff]"
                        />
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
                  <td colSpan={10} className="px-4 py-12 text-center text-sm font-bold text-[#6c655b]">
                    {getEmptyMessage(filterMode)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={safeCurrentPage <= 1}
          onClick={() => {
            resetSelectionForListChange();
            setCurrentPage((page) => Math.max(1, page - 1));
          }}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-sm font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-45"
        >
          이전
        </button>
        <span className="min-h-10 rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-extrabold text-[#151515]">
          {safeCurrentPage.toLocaleString()} / {totalPages.toLocaleString()}
        </span>
        <button
          type="button"
          disabled={safeCurrentPage >= totalPages}
          onClick={() => {
            resetSelectionForListChange();
            setCurrentPage((page) => Math.min(totalPages, page + 1));
          }}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-sm font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-45"
        >
          다음
        </button>
      </div>

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

async function loadProductRows(userId: string) {
  const result = await supabase
    .from("competitor_price_products")
    .select(PRODUCT_SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (!result.error) {
    return { rows: result.data ?? [], error: null };
  }

  const fallback = await supabase
    .from("competitor_price_products")
    .select(PRODUCT_SELECT_COLUMNS_LEGACY)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return {
    rows: fallback.data ?? [],
    error: fallback.error,
  };
}

async function saveProductList(userId: string, products: TrackedBuymaProduct[]) {
  const rows = products.map((product) => productToUpsertRow(userId, product));
  const result = await supabase
    .from("competitor_price_products")
    .upsert(rows, { onConflict: "user_id,merge_key" });

  if (!result.error) {
    return;
  }

  const legacyRows = rows.map(({ csv_order, csv_imported_at, ...row }) => row);
  const { error } = await supabase
    .from("competitor_price_products")
    .upsert(legacyRows, { onConflict: "user_id,merge_key" });

  if (error) throw error;
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

async function createManualReviewBatch(
  userId: string,
  filename: string,
): Promise<ManualPriceReviewBatchRow> {
  const batchName = `${new Date().toISOString().slice(0, 10)} ${filename}`;
  const { data, error } = await supabase
    .from("manual_price_review_batches")
    .insert({
      user_id: userId,
      name: batchName,
      source_filename: filename,
    })
    .select("id,name,source_filename,created_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "수동검토 배치를 만들지 못했습니다.");
  }

  return data as ManualPriceReviewBatchRow;
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
    createdAt: row.created_at ?? undefined,
    csvOrder: row.csv_order ?? undefined,
    csvImportedAt: row.csv_imported_at ?? undefined,
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
    csv_order: product.csvOrder ?? null,
    csv_imported_at: product.csvImportedAt ?? null,
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

function manualReviewRowToProduct(row: ManualPriceReviewItemRow): TrackedBuymaProduct {
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
    status: "active",
    createdAt: row.created_at ?? undefined,
    csvOrder: row.csv_order ?? undefined,
    csvImportedAt: row.csv_imported_at ?? undefined,
  };
}

function productToManualReviewInsertRow(
  userId: string,
  batchId: string,
  product: TrackedBuymaProduct,
) {
  return {
    user_id: userId,
    batch_id: batchId,
    merge_key: getMergeKey(product) || product.id,
    buyma_product_id: product.buymaProductId,
    buyma_url: product.buymaUrl,
    title: product.title,
    brand: product.brand,
    model_number: product.modelNumber,
    own_price: product.ownPrice,
    search_keyword: product.searchKeyword,
    search_url: product.searchUrl,
    manual_update_price: product.ownPrice || null,
    review_status: "pending",
    csv_order: product.csvOrder ?? null,
    csv_imported_at: product.csvImportedAt ?? null,
  };
}

function mergeManualReviewImportRows(
  userId: string,
  batchId: string,
  importedProducts: TrackedBuymaProduct[],
  existingRows: ManualPriceReviewItemRow[],
) {
  const existingMap = new Map<string, ManualPriceReviewItemRow>();
  existingRows.forEach((row) => {
    existingMap.set(getManualReviewRowMergeKey(row), row);
    existingMap.set(row.merge_key, row);
  });

  return importedProducts.map((product) => {
    const mergeKey = getMergeKey(product) || product.id;
    const existing = existingMap.get(mergeKey);
    if (!existing) {
      return productToManualReviewInsertRow(userId, batchId, product);
    }

    const shouldRecheck = shouldRecheckManualReviewItem(existing, product);
    const recheckRequestedAt = shouldRecheck ? new Date().toISOString() : existing.recheck_requested_at;

    return {
      user_id: userId,
      batch_id: batchId,
      merge_key: mergeKey,
      buyma_product_id: product.buymaProductId,
      buyma_url: product.buymaUrl,
      title: product.title,
      brand: product.brand,
      model_number: product.modelNumber,
      own_price: product.ownPrice,
      search_keyword: product.searchKeyword,
      search_url: product.searchUrl,
      manual_lowest_price: existing.manual_lowest_price,
      manual_update_price: getMergedManualUpdatePrice(existing, product, shouldRecheck),
      review_status: shouldRecheck ? "recheck" : existing.review_status,
      reviewed_at: shouldRecheck ? null : existing.reviewed_at,
      recheck_requested_at: recheckRequestedAt,
      exported_at: shouldRecheck ? null : existing.exported_at,
      csv_order: product.csvOrder ?? null,
      csv_imported_at: product.csvImportedAt ?? null,
    };
  });
}

function dedupeManualReviewImportedProducts(products: TrackedBuymaProduct[]) {
  const seenKeys = new Set<string>();
  const uniqueProducts: TrackedBuymaProduct[] = [];
  let duplicateCount = 0;

  products.forEach((product) => {
    const mergeKey = getMergeKey(product) || product.id;
    if (seenKeys.has(mergeKey)) {
      duplicateCount += 1;
      return;
    }

    seenKeys.add(mergeKey);
    uniqueProducts.push(product);
  });

  return {
    products: uniqueProducts,
    duplicateCount,
  };
}

function getMergedManualUpdatePrice(
  existing: ManualPriceReviewItemRow,
  imported: TrackedBuymaProduct,
  shouldRecheck: boolean,
) {
  if (existing.review_status === "reviewed" && shouldRecheck) {
    return existing.manual_update_price ?? existing.own_price ?? imported.ownPrice ?? null;
  }

  const existingUpdatePrice = existing.manual_update_price ?? 0;
  const existingOwnPrice = existing.own_price ?? 0;
  const wasDefaultUpdatePrice = !existingUpdatePrice || existingUpdatePrice === existingOwnPrice;

  if (wasDefaultUpdatePrice) {
    return imported.ownPrice || null;
  }

  return existingUpdatePrice;
}

function getManualReviewRowMergeKey(row: ManualPriceReviewItemRow) {
  return row.buyma_product_id || row.buyma_url || row.title || row.merge_key;
}

function shouldRecheckManualReviewItem(
  existing: ManualPriceReviewItemRow,
  imported: TrackedBuymaProduct,
) {
  if (existing.review_status !== "reviewed") return false;
  if ((existing.search_url ?? "") !== imported.searchUrl) return true;

  if (existing.manual_update_price && existing.manual_update_price > 0) {
    return existing.manual_update_price !== imported.ownPrice;
  }

  return existing.own_price !== imported.ownPrice;
}

function getManualLowestPriceMap(rows: ManualPriceReviewItemRow[]) {
  const result: Record<string, string> = {};
  rows.forEach((row) => {
    if (row.manual_lowest_price) result[row.id] = String(row.manual_lowest_price);
  });
  return result;
}

function getManualUpdatePriceMap(rows: ManualPriceReviewItemRow[]) {
  const result: Record<string, string> = {};
  rows.forEach((row) => {
    const updatePrice = row.manual_update_price ?? row.own_price;
    if (updatePrice) result[row.id] = String(updatePrice);
  });
  return result;
}

function getManualReviewPriceEditValue(
  product: TrackedBuymaProduct,
  priceEdits: Record<string, string>,
) {
  if (Object.prototype.hasOwnProperty.call(priceEdits, product.id)) {
    return priceEdits[product.id] ?? "";
  }

  return product.ownPrice ? String(product.ownPrice) : "";
}

function getManualStatusIds(rows: ManualPriceReviewItemRow[], status: ManualReviewStatus) {
  return new Set(rows.filter((row) => row.review_status === status).map((row) => row.id));
}

function getManualDateMap(
  rows: ManualPriceReviewItemRow[],
  key: "reviewed_at" | "recheck_requested_at",
) {
  const result: Record<string, string> = {};
  rows.forEach((row) => {
    const value = row[key];
    if (value) result[row.id] = value;
  });
  return result;
}

function filterManualReviewSearch(products: TrackedBuymaProduct[], productSearch: string) {
  const search = productSearch.trim().toLowerCase();
  if (!search) return products;

  return products.filter((product) =>
    [product.title, product.buymaProductId].some((value) =>
      value.toLowerCase().includes(search),
    ),
  );
}

function filterManualReviewProducts(
  products: TrackedBuymaProduct[],
  filterMode: ManualReviewFilterMode,
  reviewedIds: Set<string>,
  recheckIds: Set<string>,
) {
  return products.filter((product) => {
    const isReviewed = reviewedIds.has(product.id);
    const isRecheck = recheckIds.has(product.id);
    if (filterMode === "pending") return !isReviewed && !isRecheck;
    if (filterMode === "reviewed") return isReviewed;
    if (filterMode === "recheck") return isRecheck;
    return true;
  });
}

function getManualReviewStatus(isReviewed: boolean, isRecheck: boolean) {
  if (isRecheck) return { label: "재검토 필요", tone: "warning" as const };
  if (isReviewed) return { label: "검토완료", tone: "ok" as const };
  return { label: "검토대기", tone: "muted" as const };
}

function sortManualReviewProducts(
  products: TrackedBuymaProduct[],
  sortMode: ManualReviewSortMode,
  reviewedAt: Record<string, string>,
) {
  return [...products].sort((a, b) => {
    switch (sortMode) {
      case "csvReverse":
        return compareDateDesc(a.csvImportedAt, b.csvImportedAt) || compareNumberDesc(a.csvOrder, b.csvOrder) || compareTitle(a, b);
      case "title":
        return compareTitle(a, b);
      case "oldestReviewed":
        return compareManualReviewedAtAsc(a, b, reviewedAt) || compareTitle(a, b);
      case "csv":
      default:
        return compareDateDesc(a.csvImportedAt, b.csvImportedAt) || compareNumberAsc(a.csvOrder, b.csvOrder) || compareTitle(a, b);
    }
  });
}

function compareManualReviewedAtAsc(
  a: TrackedBuymaProduct,
  b: TrackedBuymaProduct,
  reviewedAt: Record<string, string>,
) {
  return getOptionalTime(reviewedAt[a.id]) - getOptionalTime(reviewedAt[b.id]);
}

function filterTrackedProducts(
  products: TrackedBuymaProduct[],
  filterMode: ProductFilterMode,
  productNameSearch: string,
) {
  const search = productNameSearch.trim().toLowerCase();

  return products.filter((product) => {
    if (filterMode === "unchecked" && product.lastCheckedAt) return false;
    if (filterMode === "checked" && !product.lastCheckedAt) return false;
    if (filterMode === "lower" && !product.lowerCompetitors?.length) return false;
    if (filterMode === "error" && (!product.error || product.lastResults?.length === 0)) return false;
    if (filterMode === "empty" && (!product.error || product.lastResults?.length !== 0)) return false;
    if (filterMode === "missing" && product.status !== "missing") return false;
    if (
      filterMode === "noLower" &&
      (!product.lastCheckedAt || product.error || product.lowerCompetitors?.length)
    ) {
      return false;
    }
    if (
      search &&
      ![product.title, product.buymaProductId].some((value) =>
        value.toLowerCase().includes(search),
      )
    ) {
      return false;
    }
    return true;
  });
}

function getProductLabel(product: TrackedBuymaProduct) {
  return product.title || product.buymaProductId || "상품";
}

function getBuymaReviewUrl(product: TrackedBuymaProduct) {
  return (
    product.lastSearchUrl ||
    product.searchUrl ||
    (product.searchKeyword ? buildBuymaSearchUrl(product.searchKeyword) : "") ||
    (product.title ? buildBuymaSearchUrl(product.title) : "") ||
    product.buymaUrl
  );
}

function getEmptyMessage(filterMode: ProductFilterMode) {
  if (filterMode === "unchecked") return "미확인 상품이 없습니다.";
  if (filterMode === "checked") return "확인된 상품이 없습니다.";
  if (filterMode === "lower") return "낮은 가격이 있는 상품이 없습니다.";
  if (filterMode === "noLower") return "낮은 가격이 없는 상품이 없습니다.";
  if (filterMode === "error") return "오류가 있는 상품이 없습니다.";
  if (filterMode === "empty") return "검색결과 없는 상품이 없습니다.";
  if (filterMode === "missing") return "파일누락 상품이 없습니다.";
  return "등록된 추적 상품이 없습니다.";
}

function sortTrackedProducts(products: TrackedBuymaProduct[], sortMode: SortMode) {
  return [...products].sort((a, b) => {
    switch (sortMode) {
      case "csv":
        return compareDateDesc(a.csvImportedAt, b.csvImportedAt) || compareNumberAsc(a.csvOrder, b.csvOrder) || compareTitle(a, b);
      case "csvReverse":
        return compareDateDesc(a.csvImportedAt, b.csvImportedAt) || compareNumberDesc(a.csvOrder, b.csvOrder) || compareTitle(a, b);
      case "unchecked":
        return compareUnchecked(a, b) || compareDateDesc(a.createdAt, b.createdAt) || compareTitle(a, b);
      case "oldestChecked":
        return compareCheckedAtAsc(a, b) || compareDateDesc(a.createdAt, b.createdAt) || compareTitle(a, b);
      case "title":
        return compareTitle(a, b);
      case "action":
      default:
        return (
          compareLowerCompetitors(a, b) ||
          compareStatus(a, b) ||
          compareUnchecked(a, b) ||
          compareCheckedAtAsc(a, b) ||
          compareDateDesc(a.createdAt, b.createdAt) ||
          compareTitle(a, b)
        );
    }
  });
}

function compareLowerCompetitors(a: TrackedBuymaProduct, b: TrackedBuymaProduct) {
  return Number(Boolean(b.lowerCompetitors?.length)) - Number(Boolean(a.lowerCompetitors?.length));
}

function compareStatus(a: TrackedBuymaProduct, b: TrackedBuymaProduct) {
  const rank: Record<TrackedStatus, number> = {
    active: 0,
    missing: 1,
    paused: 2,
    ended: 3,
  };

  return rank[a.status] - rank[b.status];
}

function compareUnchecked(a: TrackedBuymaProduct, b: TrackedBuymaProduct) {
  return Number(Boolean(a.lastCheckedAt)) - Number(Boolean(b.lastCheckedAt));
}

function compareCheckedAtAsc(a: TrackedBuymaProduct, b: TrackedBuymaProduct) {
  return getCheckedTimeForSort(a.lastCheckedAt) - getCheckedTimeForSort(b.lastCheckedAt);
}

function compareDateDesc(a: string | undefined, b: string | undefined) {
  return getTime(b) - getTime(a);
}

function compareNumberAsc(a: number | undefined, b: number | undefined) {
  return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
}

function compareNumberDesc(a: number | undefined, b: number | undefined) {
  return (b ?? Number.MIN_SAFE_INTEGER) - (a ?? Number.MIN_SAFE_INTEGER);
}

function compareTitle(a: TrackedBuymaProduct, b: TrackedBuymaProduct) {
  return (a.title || a.buymaProductId).localeCompare(b.title || b.buymaProductId, "ko");
}

function getTime(value: string | undefined) {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getCheckedTimeForSort(value: string | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function getOptionalTime(value: string | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function getExportPrice(product: TrackedBuymaProduct, editedPrice: string | undefined) {
  const price =
    editedPrice === undefined
      ? Number(getDefaultEditPrice(product) || product.referencePrice || product.ownPrice)
      : Number(editedPrice);
  return getPositiveIntegerPrice(price) ?? 0;
}

function hasExportPriceChange(product: TrackedBuymaProduct, exportPrice: number) {
  const currentPrice = Number(product.ownPrice);
  return Number.isFinite(currentPrice) && currentPrice > 0 && Math.floor(currentPrice) !== exportPrice;
}

function getPositiveIntegerPrice(value: string | number | null | undefined) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? Math.floor(price) : null;
}

function countPriceUpdateCsvRows(
  products: TrackedBuymaProduct[],
  editedPrices: Record<string, string>,
  requirePriceChange = false,
) {
  return products.reduce((count, product) => {
    const productId = product.buymaProductId.trim();
    const price = getExportPrice(product, editedPrices[product.id]);

    if (!productId || !price) return count;
    if (requirePriceChange && !hasExportPriceChange(product, price)) return count;
    return count + 1;
  }, 0);
}

function getPriceEditValue(product: TrackedBuymaProduct, priceEdits: Record<string, string>) {
  if (Object.prototype.hasOwnProperty.call(priceEdits, product.id)) {
    return priceEdits[product.id] ?? "";
  }

  const defaultPrice = getDefaultEditPrice(product);
  return defaultPrice ? String(defaultPrice) : "";
}

function getDefaultEditPrice(product: TrackedBuymaProduct) {
  const lowerPrice = product.lowerCompetitors?.[0]?.price;
  if (!lowerPrice) return 0;
  return Math.max(1, lowerPrice - 10);
}

function hasDetectedPriceMismatch(product: TrackedBuymaProduct) {
  return Boolean(product.referencePrice && product.referencePrice !== product.ownPrice);
}

function formatImportFailureRowNumber(rowNumber: number) {
  return rowNumber > 0 ? String(rowNumber) : "전체";
}

function toCsvContent(rows: string[][]) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function escapeCsvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

type PriceStatus =
  | { kind: "lower"; lowerCompetitor: BuymaCompetitorPriceItem }
  | { kind: "ok" }
  | { kind: "unchecked" }
  | { kind: "empty" }
  | { kind: "error" };

function getPriceStatus(product: TrackedBuymaProduct): PriceStatus {
  const lowerCompetitor = product.lowerCompetitors?.[0];
  if (lowerCompetitor) return { kind: "lower", lowerCompetitor };
  if (!product.lastCheckedAt) return { kind: "unchecked" };
  if (product.error) {
    return product.lastResults?.length === 0 ? { kind: "empty" } : { kind: "error" };
  }

  return { kind: "ok" };
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "muted" | "warning" | "danger";
}) {
  const classNameByTone = {
    ok: "border-[#2f9d62]/20 bg-[#ecf8f0] text-[#24784c]",
    muted: "border-black/10 bg-[#f1eee6] text-[#6c655b]",
    warning: "border-[#d78b1f]/20 bg-[#fff6e8] text-[#9a5c00]",
    danger: "border-[#c43b2f]/20 bg-[#fff0ee] text-[#c43b2f]",
  };

  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-extrabold ${classNameByTone[tone]}`}>
      {label}
    </span>
  );
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

function parseProductsFromCsv(
  text: string,
  options: { requireBuymaProductId?: boolean } = {},
) {
  const rows = parseDelimitedRows(text.trim().replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    return {
      products: [],
      totalRows: 0,
      failedRows: 0,
      failures: [],
    };
  }

  const headers = rows[0].map(normalizeHeader);
  const products: TrackedBuymaProduct[] = [];
  const seenKeys = new Set<string>();
  const failures: CsvImportFailure[] = [];
  const dataRows = rows.slice(1);

  dataRows.forEach((row, index) => {
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

    if (options.requireBuymaProductId && !buymaProductId) {
      failures.push({
        rowNumber: index + 2,
        reason: "BUYMA 상품ID가 없어 수동검토 목록에 넣을 수 없습니다.",
        rawValue: row.join(" | "),
      });
      return;
    }

    if (!buymaProductId && !buymaUrl && !title) {
      failures.push({
        rowNumber: index + 2,
        reason: "상품ID, BUYMA URL, 상품명이 모두 비어 있습니다.",
        rawValue: row.join(" | "),
      });
      return;
    }

    const product = {
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
    } satisfies TrackedBuymaProduct;
    const mergeKey = getMergeKey(product);

    if (seenKeys.has(mergeKey)) {
      failures.push({
        rowNumber: index + 2,
        reason: "같은 CSV 안에 동일 상품이 중복되어 있습니다.",
        rawValue: row.join(" | "),
      });
      return;
    }

    seenKeys.add(mergeKey);
    products.push(product);
  });

  return {
    products,
    totalRows: dataRows.length,
    failedRows: failures.length,
    failures,
  };
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
    if (!existing) return product;

    const shouldRecheck = hasComparisonInputChanged(existing, product);
    return {
      ...existing,
      ...product,
      id: existing.id,
      status: (existing.status === "ended" ? "ended" : "active") as TrackedStatus,
      lastCheckedAt: shouldRecheck ? undefined : existing.lastCheckedAt,
      lastSearchUrl: shouldRecheck ? undefined : existing.lastSearchUrl,
      referencePrice: shouldRecheck ? undefined : existing.referencePrice,
      lowerCompetitors: shouldRecheck ? [] : existing.lowerCompetitors,
      lastResults: shouldRecheck ? [] : existing.lastResults,
      error: shouldRecheck ? undefined : existing.error,
    };
  });
  const missing: TrackedBuymaProduct[] = current
    .filter((product) => !importedKeys.has(getMergeKey(product)))
    .map((product) => (product.status === "active" ? { ...product, status: "missing" as const } : product));

  return [...merged, ...missing];
}

function hasComparisonInputChanged(
  existing: TrackedBuymaProduct,
  imported: TrackedBuymaProduct,
) {
  return existing.ownPrice !== imported.ownPrice || existing.searchUrl !== imported.searchUrl;
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
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/[\/\\|]+/g, " ")
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

function getManualReviewBatchFilename(value: string) {
  return value.replace(/^\d{4}-\d{2}-\d{2}\s+/, "").trim();
}
