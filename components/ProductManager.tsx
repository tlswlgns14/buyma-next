import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  DEFAULT_BUYMA_SETTINGS,
} from "@/lib/buyma/data";
import {
  BUYMA_CATEGORIES,
  BUYMA_COLOR_SYSTEMS,
  BUYMA_SEASONS,
  BUYMA_SIZES,
  BUYMA_THEMES,
} from "@/lib/buyma/id-data";
import { getKoreanCategoryLabel, sortSeasonOptionsDescending } from "@/lib/buyma/select-options";
import { BUYMA_BRAND_OPTIONS, findBuymaBrand } from "@/lib/buyma/brands";
import type { BuymaBrandOption } from "@/lib/buyma/brands";
import { getJapaneseBrandDescription } from "@/lib/buyma/brand-descriptions";
import { getBuymaCsvProductSourceIndexes, generateBuymaCsvBundle } from "@/lib/buyma/csv";
import {
  getBuymaCategoryGender,
  getPairedBuymaCategoryId,
  isValidBuymaCategoryId,
} from "@/lib/buyma/categories";
import {
  clearStoredProducts,
  clearStoredSettings,
  loadStoredSettings,
  normalizeBuymaSettings,
} from "@/lib/buyma/storage";
import type {
  BuymaDescriptionPlacement,
  BuymaSettings,
  BuymaShippingMethod,
  ColorSizeRow,
  ExtractProductResponse,
  ProductDraft,
  StockStatus,
} from "@/lib/buyma/types";
import { createZipBlob } from "@/lib/buyma/zip";
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
  splitColorSizeSupplementFromDescription,
} from "@/lib/buyma/text";

type ToolTab = "edit" | "editor" | "settings";
type EditorTemplate = "basic" | "lucky" | "lucky2" | "northface" | "northfaceWhiteLabel";
type CsvTableKey = "items" | "colorSizes";
type CsvCellEdits = Record<string, string>;
const EDITOR_DESIGN_SIZE = 800;
const EDITOR_CANVAS_SIZE = 1300;
const EDITOR_CANVAS_SCALE = EDITOR_CANVAS_SIZE / EDITOR_DESIGN_SIZE;
const EDITOR_INITIAL_IMAGE_MAX_SIZE = 640;
const EDITOR_LUCKY_HEADER_HEIGHT = 112;
const EDITOR_LUCKY_LEFT_WIDTH = 330;
type EditorPlacedImage = {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  removeBackground: boolean;
  clipToLuckyRightCell?: boolean;
};
type EditorDragTarget =
  | { type: "logo"; offsetX: number; offsetY: number }
  | { type: "text"; offsetX: number; offsetY: number }
  | { type: "placed"; index: number; offsetX: number; offsetY: number }
  | {
      type: "placed-resize";
      index: number;
      startX: number;
      startY: number;
      aspectRatio: number;
    };
type BuymaSizeOption = { id: string; name: string; label: string };
type ProductDirtyFields = Partial<Record<keyof ProductDraft, true>>;
type SizeSupplementMismatch = {
  missingInSupplement: string[];
  missingInDetail: string[];
  missingInDetailByColor: Array<{ color: string; sizes: string[] }>;
};

const IMAGE_UPLOAD_CONCURRENCY = 4;
const IMAGE_UPLOAD_BATCH_SIZE = 5;
const IMAGE_UPLOAD_RETRY_COUNT = 2;
const IMAGE_UPLOAD_RETRY_DELAY_MS = 1500;
const BUYMA_TITLE_MAX_LENGTH = 60;

const BUYMA_CATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  "4116": "여성 패션/모자 > 해트",
  "4117": "여성 패션/모자 > 캡",
  "4207": "남성 패션/모자 > 해트",
  "4208": "남성 패션/모자 > 캡",
};

const BUYMA_SEASON_OPTIONS = sortSeasonOptionsDescending(BUYMA_SEASONS);
const BUYMA_CATEGORY_SEARCH_OPTIONS = BUYMA_CATEGORIES.map((category) => {
  const label = BUYMA_CATEGORY_LABEL_OVERRIDES[category.id] ?? getKoreanCategoryLabel(category.label);
  const display = formatCategoryDisplay(label);
  return {
    id: category.id,
    label,
    display,
    searchText: `${category.id} ${label} ${display}`.toLowerCase(),
  };
});

function normalizeShippingMethodSelectValue(
  value: string | undefined,
  options: BuymaShippingMethod[],
) {
  const text = value?.trim();
  if (!text) return options[0]?.id ?? "";
  return normalizeShippingMethodOptionId(text);
}

function normalizeShippingMethodOptionId(value: string) {
  const text = value.trim();
  if (!text) return "";
  return /^J/i.test(text) ? `J${text.slice(1)}` : `J${text}`;
}

function getShippingMethodDisplayId(value: string) {
  return normalizeShippingMethodOptionId(value).replace(/^J/i, "");
}

function formatShippingMethodOptionLabel(method: BuymaShippingMethod) {
  const id = normalizeShippingMethodOptionId(method.id);
  const displayId = getShippingMethodDisplayId(id);
  const labelText = method.label.trim();
  const displayLabel = labelText.replace(new RegExp(`^${id}\\b`, "i"), displayId);
  if (!displayLabel || displayLabel === id || displayLabel === displayId) return displayId;
  return displayLabel.startsWith(displayId) ? displayLabel : `${displayId} ${displayLabel}`;
}

function getShippingMethodOptions(settings: BuymaSettings) {
  const options = new Map<string, BuymaShippingMethod>();
  (settings.shippingMethods ?? []).forEach((method) => {
    const id = normalizeShippingMethodOptionId(method.id);
    if (!id) return;
    options.set(id, { id, label: formatShippingMethodOptionLabel({ ...method, id }) });
  });
  return [...options.values()];
}

function getStatusTone(status: string) {
  if (/완료|성공|반영|추가|삭제|저장/.test(status)) return "success";
  if (/오류|실패|못했습니다|없습니다|입력하세요|먼저/.test(status)) return "warning";
  if (/중|시작|준비/.test(status)) return "working";
  return "default";
}

function getKrwPerJpyRate(exchangeRate: number) {
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return 0;
  return Math.round((1 / exchangeRate) * 100) / 100;
}

function getJpyPerKrwRate(krwPerJpyRate: number) {
  if (!Number.isFinite(krwPerJpyRate) || krwPerJpyRate <= 0) return 0;
  return Math.round((1 / krwPerJpyRate) * 1000000) / 1000000;
}

export default function ProductManager() {
  const { authUser, session } = useAuth();
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [csvProducts, setCsvProducts] = useState<Array<ProductDraft | null>>([]);
  const [settings, setSettings] = useState<BuymaSettings>(() => DEFAULT_BUYMA_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOwnerId, setSettingsOwnerId] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [activeTab, setActiveTab] = useState<ToolTab>("edit");
  const [csvPreviewOpen, setCsvPreviewOpen] = useState(true);
  const [urlsInput, setUrlsInput] = useState("");
  const [status, setStatus] = useState("상품 URL을 입력하세요.");
  const [isScraping, setIsScraping] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [manualProductFields, setManualProductFields] = useState<Record<number, ProductDirtyFields>>({});
  const [currentCsvRowIndexes, setCurrentCsvRowIndexes] = useState<number[]>([]);
  const [currentProductsCollected, setCurrentProductsCollected] = useState(false);
  const [collectionAlert, setCollectionAlert] = useState("");
  const [csvEdits, setCsvEdits] = useState<Record<CsvTableKey, CsvCellEdits>>({ items: {}, colorSizes: {} });

  const activeProduct = activeIndex >= 0 ? products[activeIndex] ?? null : null;
  const collectedCsvRows = useMemo(() => getCollectedCsvProductRows(csvProducts), [csvProducts]);
  const collectedCsvProducts = useMemo(() => collectedCsvRows.map(({ product }) => product), [collectedCsvRows]);
  const csvItemSourceIndexes = useMemo(
    () => getBuymaCsvProductSourceIndexes(collectedCsvProducts),
    [collectedCsvProducts],
  );
  const shippingMethodOptions = useMemo(() => getShippingMethodOptions(settings), [settings]);
  const csvBundle = useMemo(
    () => generateBuymaCsvBundle(collectedCsvProducts, settings),
    [collectedCsvProducts, settings],
  );
  const editedCsvBundle = useMemo(
    () => applyCsvEditsToBundle(csvBundle, csvEdits),
    [csvBundle, csvEdits],
  );
  const csvPreviewCounts = useMemo(
    () => ({
      items: countCsvDataRows(editedCsvBundle.itemsCsv),
      colorSizes: countCsvDataRows(editedCsvBundle.colorSizesCsv),
    }),
    [editedCsvBundle],
  );
  const statusTone = getStatusTone(status);
  const urlCount = getUrls(urlsInput).length;
  const pendingCollectionCount = products.length && !currentProductsCollected ? products.length : 0;

  useEffect(() => {
    clearStoredProducts();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadUserSettings() {
      if (!authUser?.id) {
        setSettingsLoaded(false);
        setSettingsOwnerId("");
        return;
      }

      setSettingsLoaded(false);
      setSettingsOwnerId("");

      if (!session?.access_token) {
        return;
      }

      let data:
        | { ok: true; settings: BuymaSettings; exists: boolean }
        | { ok: false; error: string };

      try {
        const response = await fetch("/api/buyma/settings", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        data = (await response.json()) as
          | { ok: true; settings: BuymaSettings; exists: boolean }
          | { ok: false; error: string };

        if (!response.ok) {
          throw new Error(data.ok ? "설정을 불러오지 못했습니다." : data.error);
        }

        if (!data.ok) {
          throw new Error(data.error);
        }
      } catch (error) {
        if (!cancelled) {
          setSettings(normalizeBuymaSettings({}));
          setSettingsOwnerId(authUser.id);
          setSettingsLoaded(true);
          setStatus(error instanceof Error ? error.message : "설정을 불러오지 못했습니다.");
        }
        return;
      }

      if (cancelled) return;

      setSettings(
        data.exists ? data.settings : loadStoredSettings(),
      );
      clearStoredSettings();
      setSettingsOwnerId(authUser.id);
      setSettingsLoaded(true);
    }

    void loadUserSettings();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, session?.access_token]);

  useEffect(() => {
    if (!settingsLoaded || !authUser?.id || !session?.access_token || settingsOwnerId !== authUser.id) return;

    const timeout = window.setTimeout(() => {
      void fetch("/api/buyma/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ settings }),
      }).then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          setStatus(body?.error ?? "설정 저장에 실패했습니다.");
        }
      }).catch((error) => {
        setStatus(error instanceof Error ? error.message : "설정 저장에 실패했습니다.");
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [authUser?.id, session?.access_token, settings, settingsLoaded, settingsOwnerId]);

  useEffect(() => {
    let cancelled = false;

    async function loadTodayExchangeRate() {
      if (!settingsLoaded || !authUser?.id || settingsOwnerId !== authUser.id) return;

      try {
        const response = await fetch("/api/exchange-rate");
        const data = (await response.json()) as
          | { ok: true; rate: number; date: string }
          | { ok: false; error?: string };
        if (cancelled || !response.ok || !data.ok || !Number.isFinite(data.rate)) return;

        setSettings((current) => ({
          ...current,
          exchangeRate: data.rate,
        }));
        setStatus(`오늘 환율 적용 완료: 1 JPY = ${getKrwPerJpyRate(data.rate)} KRW (${data.date})`);
      } catch {
        if (!cancelled) setStatus("오늘 환율을 가져오지 못했습니다. 설정의 환율값을 사용합니다.");
      }
    }

    void loadTodayExchangeRate();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, settingsLoaded, settingsOwnerId]);

  async function scrapeUrls() {
    const parsedUrls = getUrls(urlsInput);
    const existingUrlKeys = new Set(
      getCollectedCsvProducts(csvProducts)
        .map((product) => normalizeUrlKey(product.sourceUrl))
        .filter(Boolean),
    );
    const seenUrlKeys = new Set<string>();
    const urls = parsedUrls.filter((url) => {
      const key = normalizeUrlKey(url);
      if (!key) return true;
      if (existingUrlKeys.has(key) || seenUrlKeys.has(key)) return false;
      seenUrlKeys.add(key);
      return true;
    });
    const skippedUrlCount = parsedUrls.length - urls.length;

    if (urls.length === 0) {
      setStatus(skippedUrlCount > 0 ? "이미 CSV에 있는 URL이라 수집을 건너뛰었습니다." : "수집할 URL을 입력하세요.");
      return;
    }

    setIsScraping(true);
    setStatus(`수집 시작: ${urls.length}개 URL${skippedUrlCount > 0 ? `, 중복 ${skippedUrlCount}개 건너뜀` : ""}`);

    const collected: ProductDraft[] = [];
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      const skuNumber = makeSku(index, "");
      setStatus(`수집 중 ${index + 1}/${urls.length}: ${url}`);

      try {
        const response = await fetch("/api/products/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const result = (await response.json()) as ExtractProductResponse;
        if (result.ok) {
          setStatus(`상품명 영어 변환 중 ${index + 1}/${urls.length}: ${url}`);
          const englishProduct = await ensureEnglishProductTitle(result.product, settings.productTitlePrefix);
          setStatus(`상세내용 정리 중 ${index + 1}/${urls.length}: ${url}`);
          const describedProduct = await ensureJapaneseProductDescription(
            englishProduct,
            settings.productDescriptionPrefix,
            settings.productDescriptionPlacement,
          );
          collected.push({
            ...describedProduct,
            sellingPrice: describedProduct.sellingPrice ?? 0,
            skuNumber: describedProduct.skuNumber || skuNumber,
          });
        } else {
          collected.push({ ...makeFailedProduct(url, result.error), skuNumber });
        }
      } catch (error) {
        collected.push(
          { ...makeFailedProduct(url, error instanceof Error ? error.message : "수집 실패"), skuNumber },
        );
      }
    }

    setProducts(collected);
    setManualProductFields({});
    setCurrentCsvRowIndexes([]);
    setCurrentProductsCollected(false);
    setActiveIndex(collected.length ? 0 : -1);
    setActiveTab("edit");
    setCsvPreviewOpen(true);
    setIsScraping(false);
    setStatus(`수집 완료: ${collected.length}개 상품`);
  }

  async function collectCsvData() {
    if (products.length === 0) {
      setStatus("정보 취합할 상품이 없습니다. 상단 검색에서 상품을 먼저 수집하세요.");
      return;
    }

    const missingRequiredProduct = await findProductCollectionValidationIssue(products);
    if (missingRequiredProduct) {
      const message = `${missingRequiredProduct.index + 1}번 상품의 ${missingRequiredProduct.fields.join(", ")}을(를) 확인해주세요.`;
      setActiveIndex(missingRequiredProduct.index);
      setCollectionAlert(message);
      setStatus(message);
      return;
    }

    setIsCollecting(true);
    try {
      const refreshedProducts = [...products];
      const nextManualProductFields = { ...manualProductFields };
      const normalizedProducts: ProductDraft[] = [];

      for (let index = 0; index < products.length; index += 1) {
        const product = products[index];
        const dirtyFields = manualProductFields[index] ?? {};

        const refreshedProduct = await refreshProductForCollection(
          product,
          dirtyFields,
          index,
          products.length,
          setStatus,
          settings.productDescriptionPrefix,
          settings.productDescriptionPlacement,
        );
        const normalizedProduct = normalizeProduct(refreshedProduct, settings, index);
        refreshedProducts[index] = normalizedProduct;
        normalizedProducts.push(normalizedProduct);
        delete nextManualProductFields[index];
      }

      const shouldAppendUnisexVariant = shouldAppendCurrentProductsAsUnisexVariant(
        products,
        manualProductFields,
        currentCsvRowIndexes,
      );
      const csvProductsToMerge = shouldAppendUnisexVariant
        ? applyUnisexVariantSku(normalizedProducts, csvProducts)
        : normalizedProducts;
      if (shouldAppendUnisexVariant) {
        csvProductsToMerge.forEach((product, index) => {
          refreshedProducts[index] = product;
        });
      }
      const removedCurrentCsvRowIndexes = shouldAppendUnisexVariant
        ? []
        : getRemovedCurrentCsvRowIndexes(currentCsvRowIndexes, csvProductsToMerge.length);
      const nextCsvProducts = mergeCurrentProductsIntoCsvProducts(
        csvProducts,
        csvProductsToMerge,
        currentCsvRowIndexes,
        shouldAppendUnisexVariant,
      );
      const nextCurrentCsvRowIndexes = getCurrentCsvRowIndexesAfterMerge(
        csvProducts.length,
        csvProductsToMerge.length,
        currentCsvRowIndexes,
        shouldAppendUnisexVariant,
      );

      setProducts(refreshedProducts);
      setCsvProducts(nextCsvProducts);
      if (removedCurrentCsvRowIndexes.length > 0) {
        setCsvEdits((current) => ({
          items: shiftCsvEditsAfterRowDeletes(current.items, removedCurrentCsvRowIndexes),
          colorSizes: {},
        }));
      }
      setCurrentCsvRowIndexes(nextCurrentCsvRowIndexes);
      setCurrentProductsCollected(true);
      setManualProductFields(nextManualProductFields);
      setCsvPreviewOpen(true);
      const nextCsvItemCount = getBuymaCsvProductSourceIndexes(getCollectedCsvProducts(nextCsvProducts)).length;
      setStatus(`정보 취합 완료: 현재 상품 ${normalizedProducts.length}개 반영, 총 ${nextCsvItemCount}개 상품이 CSV 데이터에 반영됐습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "정보 취합 중 오류가 발생했습니다.");
    } finally {
      setIsCollecting(false);
    }
  }

  function updateActiveProduct(patch: Partial<ProductDraft>) {
    if (!activeProduct) return;
    const nextPatch = Object.hasOwn(patch, "title") && !Object.hasOwn(patch, "titleManuallyEdited")
      ? { ...patch, titleManuallyEdited: true }
      : patch;
    setCurrentProductsCollected(false);
    setManualProductFields((current) => ({
      ...current,
      [activeIndex]: {
        ...(current[activeIndex] ?? {}),
        ...Object.fromEntries(Object.keys(nextPatch).map((key) => [key, true])),
      },
    }));
    setProducts((current) =>
      current.map((product, index) =>
        index === activeIndex ? { ...product, ...nextPatch } : product,
      ),
    );
  }

  function updateSettings(patch: Partial<BuymaSettings>) {
    if (products.length) setCurrentProductsCollected(false);
    setSettings((current) => {
      const nextSettings = { ...current, ...patch };
      return nextSettings;
    });
  }

  function updateCsvCell(table: CsvTableKey, rowIndex: number, cellIndex: number, value: string) {
    const baseCsv = table === "items" ? csvBundle.itemsCsv : csvBundle.colorSizesCsv;
    const baseRows = csvToRows(baseCsv);
    const baseValue = baseRows[rowIndex + 1]?.[cellIndex] ?? "";
    const key = getCsvEditKey(rowIndex, cellIndex);

    setCsvEdits((current) => {
      const tableEdits = { ...current[table] };
      if (value === baseValue) delete tableEdits[key];
      else tableEdits[key] = value;
      return { ...current, [table]: tableEdits };
    });
  }

  function clearAll() {
    setProducts([]);
    setCsvProducts([]);
    setActiveIndex(-1);
    setUrlsInput("");
    setCsvPreviewOpen(true);
    setManualProductFields({});
    setCurrentCsvRowIndexes([]);
    setCurrentProductsCollected(false);
    setCsvEdits({ items: {}, colorSizes: {} });
    setStatus("정보를 초기화했습니다.");
  }

  function deleteCsvProduct(rowIndex: number) {
    const sourceRowIndex = csvItemSourceIndexes[rowIndex] ?? rowIndex;
    const target = collectedCsvRows[sourceRowIndex];
    if (!target) return;

    const productTitle = target.product.title || `${rowIndex + 1}번째 상품`;
    const deletedItemRowIndexes = csvItemSourceIndexes
      .map((sourceIndex, itemRowIndex) => sourceIndex === sourceRowIndex ? itemRowIndex : -1)
      .filter((itemRowIndex) => itemRowIndex >= 0);

    setCsvProducts((current) => current.filter((_, index) => index !== target.index));
    setCsvEdits((current) => ({
      items: shiftCsvEditsAfterRowDeletes(current.items, deletedItemRowIndexes),
      colorSizes: {},
    }));
    setCurrentCsvRowIndexes((current) => current
      .filter((index) => index !== target.index)
      .map((index) => (index > target.index ? index - 1 : index)));
    if (currentCsvRowIndexes.includes(target.index)) setCurrentProductsCollected(false);
    setStatus(`CSV에서 삭제했습니다: ${productTitle}`);
  }

  async function translateActiveProduct(target: "en" | "ja") {
    if (!activeProduct) return;
    const source = activeProduct.titleKo || activeProduct.title;
    if (!source) return;

    setStatus(target === "en" ? "영문 상품명 번역 중..." : "일문 상품명 번역 중...");
    try {
      const translated = await translateText(source, target);
      if (target === "en") {
        updateActiveProduct({
          titleEn: translated,
          title: formatCollectedTitleWithBrand(activeProduct, translated, settings.productTitlePrefix),
          titleManuallyEdited: false,
        });
      } else {
        updateActiveProduct({ translatedTitle: translated, title: translated, titleManuallyEdited: false });
      }
      setStatus("번역을 반영했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "번역에 실패했습니다.");
    }
  }

  async function downloadZip() {
    if (collectedCsvProducts.length === 0) {
      setStatus("CSV 다운로드 전에 정보 취합을 먼저 눌러주세요.");
      return;
    }
    if (pendingCollectionCount > 0) {
      setStatus(`CSV 다운로드 전에 정보 취합을 눌러 신규/수정 상품 ${pendingCollectionCount}개를 반영해주세요.`);
      return;
    }

    setIsDownloading(true);
    setStatus("CSV 생성 중...");

    try {
      let exportProducts: ProductDraft[] = collectedCsvProducts.map((product, index) => ({
        ...product,
        skuNumber: product.skuNumber || makeSku(index, product.productCode),
      }));
      const hasEditedImage = exportProducts.some(hasProductEditedImage);

      if (hasEditedImage && !settings.enableImageUpload) {
        throw new Error("편집 메인이미지는 BUYMA CSV에 URL로 등록해야 합니다. 설정에서 이미지 업로드 사용을 켜고 다시 다운로드하세요.");
      }

      if (settings.enableImageUpload) {
        exportProducts = await uploadAllProductImages(exportProducts, settings, setStatus);
        setCsvProducts(exportProducts);
      }
      const missingEditedImageUploadIndex = findMissingEditedImageUploadIndex(exportProducts);
      if (missingEditedImageUploadIndex >= 0) {
        throw new Error(`${missingEditedImageUploadIndex + 1}번 상품의 편집 메인이미지 업로드에 실패했습니다. 이미지 업로드 설정을 확인한 뒤 다시 다운로드하세요.`);
      }

      const bundle = applyCsvEditsToBundle(generateBuymaCsvBundle(exportProducts, settings), csvEdits);
      const files = [
        { name: "items.csv", content: bundle.itemsCsv },
        { name: "colorsizes.csv", content: bundle.colorSizesCsv },
      ];

      const zipBlob = createZipBlob(files);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      triggerDownload(zipBlob, `buyma_bulk_${date}.zip`);
      setStatus(`ZIP 다운로드 완료: ${getBuymaCsvProductSourceIndexes(exportProducts).length}개 상품`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ZIP 생성 중 오류가 발생했습니다.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="buyma-extension">
      <div className="buyma-app">
        <div className="buyma-top-bar">
          <span className="buyma-app-title">상품수집 → BUYMA</span>
          <div className="buyma-top-tabs">
            <TabButton active={activeTab === "edit"} onClick={() => setActiveTab("edit")}>상품편집</TabButton>
            <TabButton active={activeTab === "editor"} onClick={() => setActiveTab("editor")}>이미지편집</TabButton>
            <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>설정</TabButton>
          </div>
        </div>

        {activeTab === "edit" && (
          <div className="buyma-panel buyma-url-search-panel">
            <div className="buyma-panel-body compact">
              <div className="buyma-bulk-bar">
                <textarea
                  rows={2}
                  value={urlsInput}
                  onChange={(event) => setUrlsInput(event.target.value)}
                  placeholder={"상품 URL 입력\nhttps://www.musinsa.com/products/3927285"}
                />
                <span>{urlCount}개 URL</span>
                <button className="buyma-btn buyma-btn-green" disabled={isScraping} onClick={() => void scrapeUrls()}>
                  {isScraping ? "수집 중..." : "검색"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={`buyma-tab-panel ${activeTab === "edit" ? "active" : ""}`}>
          <p className={`buyma-site-check ${statusTone}`}>{status}</p>

          <div className="buyma-panel-grid">
            <BasicInfoPanel
              product={activeProduct}
              settings={settings}
              shippingMethodOptions={shippingMethodOptions}
              onChange={updateActiveProduct}
              onTranslate={translateActiveProduct}
              isCollecting={isCollecting}
              isScraping={isScraping}
              isDownloading={isDownloading}
              onCollect={() => void collectCsvData()}
              onClear={clearAll}
              onDownload={() => void downloadZip()}
            />
            <ColorSizePanel product={activeProduct} onChange={updateActiveProduct} />
            <MainImagePanel product={activeProduct} onCreate={() => setActiveTab("editor")} />
          </div>
        </div>

        <div className={`buyma-tab-panel buyma-editor-tab-panel ${activeTab === "editor" ? "active" : ""}`}>
          <ImageEditorPanel
            product={activeProduct}
            onSave={(editedImage) => {
              if (!activeProduct) return;
              updateActiveProduct({
                editedImage,
                images: removeEditedImageFromImages(activeProduct.images, activeProduct.editedImage, editedImage),
                uploadedImageUrls: undefined,
              });
              setStatus("편집 이미지를 상품에 저장했습니다.");
            }}
          />
        </div>

        <div className={`buyma-tab-panel ${activeTab === "settings" ? "active" : ""}`}>
          <SettingsPanel settings={settings} onChange={updateSettings} setStatus={setStatus} />
        </div>

        {!csvPreviewOpen && activeTab === "edit" && (
          <div className="buyma-csv-preview-open-bar">
            <span>CSV 미리보기가 닫혀 있습니다.</span>
            <button className="buyma-btn buyma-btn-orange" onClick={() => setCsvPreviewOpen(true)}>
              CSV 미리보기 열기
            </button>
          </div>
        )}

        {csvPreviewOpen && activeTab === "edit" && (
          <div className="buyma-csv-preview-section">
            <div className="buyma-panel">
              <div className="buyma-panel-header buyma-csv-preview-header">
                CSV 미리보기
                <button className="buyma-btn buyma-btn-sm buyma-btn-red" onClick={() => setCsvPreviewOpen(false)}>
                  닫기
                </button>
              </div>
              <div className="buyma-panel-body compact">
                <div className="buyma-csv-preview-stack">
                  <section className="buyma-csv-preview-block">
                    <div className="buyma-csv-preview-title">
                      <span>업로드 데이터 상세</span>
                      <span>취합건수 : {csvPreviewCounts.items}건</span>
                    </div>
                    <CsvTable
                      csv={editedCsvBundle.itemsCsv}
                      edits={csvEdits.items}
                      onCellChange={(rowIndex, cellIndex, value) => updateCsvCell("items", rowIndex, cellIndex, value)}
                      renderRowAction={(rowIndex) => (
                        <button className="buyma-btn buyma-btn-sm buyma-btn-red buyma-csv-delete-btn" onClick={() => deleteCsvProduct(rowIndex)}>
                          삭제
                        </button>
                      )}
                    />
                  </section>
                  <section className="buyma-csv-preview-block">
                    <div className="buyma-csv-preview-title">
                      <span>사이즈 업로드</span>
                      <span>건수 : {csvPreviewCounts.colorSizes}건</span>
                    </div>
                    <CsvTable
                      csv={editedCsvBundle.colorSizesCsv}
                      edits={csvEdits.colorSizes}
                      onCellChange={(rowIndex, cellIndex, value) => updateCsvCell("colorSizes", rowIndex, cellIndex, value)}
                    />
                  </section>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="buyma-bottom-bar">
          <div className="buyma-bottom-left">
            <label className="buyma-chk"><input type="checkbox" defaultChecked /> 상품명</label>
            <label className="buyma-chk"><input type="checkbox" defaultChecked /> 상품상세</label>
          </div>
        </div>
        {collectionAlert ? (
          <CollectionRequiredModal message={collectionAlert} onClose={() => setCollectionAlert("")} />
        ) : null}
      </div>
    </div>
  );
}

function BasicInfoPanel({
  product,
  settings,
  shippingMethodOptions,
  onChange,
  onTranslate,
  isCollecting,
  isScraping,
  isDownloading,
  onCollect,
  onClear,
  onDownload,
}: {
  product: ProductDraft | null;
  settings: BuymaSettings;
  shippingMethodOptions: BuymaShippingMethod[];
  onChange: (patch: Partial<ProductDraft>) => void;
  onTranslate: (target: "en" | "ja") => Promise<void>;
  isCollecting: boolean;
  isScraping: boolean;
  isDownloading: boolean;
  onCollect: () => void;
  onClear: () => void;
  onDownload: () => void;
}) {
  const images = useMemo(() => product?.images ?? [], [product?.images]);
  const imageKey = useMemo(() => images.join("\n"), [images]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] ?? images[0] ?? "";
  const addImageInputRef = useRef<HTMLInputElement | null>(null);
  const [isImageManagerOpen, setIsImageManagerOpen] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const hasCategory = isValidBuymaCategory(product?.category);
  const hasSeason = isValidBuymaSeason(product?.season);
  const hasSellingPrice = !product || isValidSellingPrice(product.sellingPrice);
  const hasBrandName = !product || isRequiredText(product.brand);
  const hasBrandId = !product || isValidBuymaBrandId(product.brandId);
  const hasModelNumber = !product || isRequiredText(getModelNumberInputValue(product));
  const titleLength = countBuymaTitleCharacters(product?.title);
  const titleOverLimit = Math.max(0, titleLength - BUYMA_TITLE_MAX_LENGTH);
  const hasTitle = !product || isRequiredText(product.title);
  const titleInvalid = !hasTitle || titleOverLimit > 0;
  const hasBrokenImages = brokenImages.size > 0;
  const sizeSupplementMismatch = getSizeSupplementMismatch(product);
  const hasSizeSupplementMismatch = hasSizeSupplementMismatchIssue(sizeSupplementMismatch);

  useEffect(() => {
    let cancelled = false;

    if (!images.length) {
      void Promise.resolve().then(() => {
        if (!cancelled) setBrokenImages((current) => current.size ? new Set() : current);
      });
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(images.map((src) => checkImageLoadable(src).then((isLoadable) => ({ src, isLoadable })))).then((results) => {
      if (cancelled) return;
      setBrokenImages(new Set(results.filter((result) => !result.isLoadable).map((result) => result.src)));
    });

    return () => {
      cancelled = true;
    };
  }, [imageKey, images]);

  function markPreviewImageBroken(src: string) {
    if (!src) return;
    setBrokenImages((current) => {
      if (current.has(src)) return current;
      const next = new Set(current);
      next.add(src);
      return next;
    });
  }

  function markPreviewImageLoaded(src: string) {
    if (!src) return;
    setBrokenImages((current) => {
      if (!current.has(src)) return current;
      const next = new Set(current);
      next.delete(src);
      return next;
    });
  }

  function handlePreviewImageError(src: string) {
    markPreviewImageBroken(src);
  }

  function handlePreviewImageLoad(src: string) {
    markPreviewImageLoaded(src);
  }

  function updateImages(nextImages: string[]) {
    const nextImageSet = new Set(nextImages);
    const removedImages = images.filter((image) => image && !image.startsWith("data:") && !nextImageSet.has(image));
    onChange({
      images: nextImages,
      removedImageUrls: uniqueTextList([...(product?.removedImageUrls ?? []), ...removedImages]),
      uploadedImageUrls: undefined,
    });
    setSelectedImageIndex((current) => Math.max(0, Math.min(current, nextImages.length - 1)));
  }

  function deleteSelectedImage() {
    if (!selectedImage) {
      window.alert("삭제할 이미지를 선택해주세요.");
      return;
    }

    if (!window.confirm("선택한 이미지를 삭제하시겠습니까?")) return;

    const nextImages = images.filter((_, index) => index !== selectedImageIndex);
    updateImages(nextImages);
    setSelectedImageIndex(Math.max(0, Math.min(selectedImageIndex, nextImages.length - 1)));
  }

  async function addManualImages(files: FileList | null) {
    const addedImages = await readFiles(files);
    if (!addedImages.length) return;
    updateImages([...images, ...addedImages]);
  }

  function addBrandLogoImage() {
    const logos = Array.from(
      new Set([...(product?.brandLogos ?? []), product?.brandLogo ?? ""].map((logo) => logo.trim()).filter(Boolean)),
    );
    if (!logos.length) {
      window.alert("가져올 제품 로고 이미지가 없습니다.");
      return;
    }
    const firstExistingIndex = images.findIndex((image) => logos.includes(image));
    const newLogos = logos.filter((logo) => !images.includes(logo));
    if (!newLogos.length) {
      if (firstExistingIndex >= 0) setSelectedImageIndex(firstExistingIndex);
      return;
    }
    updateImages([...images, ...newLogos]);
    setSelectedImageIndex(images.length);
  }

  return (
    <div className="buyma-panel">
      <div className="buyma-panel-header">기본정보</div>
      <div className="buyma-panel-body">
        <div className="buyma-form-row">
          <label>상품명</label>
          <div className="buyma-form-row-inner">
            <button className="buyma-btn buyma-btn-sm buyma-btn-blue" disabled={!product} onClick={() => void onTranslate("ja")}>JP</button>
            <BrandManualPicker
              disabled={!product}
              value={product?.brandId ?? ""}
              onSelect={(brand) => onChange({ brand: brand.name, brandDisplayName: brand.displayName, brandId: brand.id })}
            />
          </div>
        </div>
        <input
          className={titleInvalid ? "buyma-required-red" : ""}
          type="text"
          value={product?.title ?? ""}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="English product name"
        />
        {titleOverLimit ? (
          <div className="buyma-title-limit-warning">
            상품명 60자 초과: {titleOverLimit}자 초과
          </div>
        ) : null}
        <div className="buyma-form-grid col3">
          <Field label="브랜드명">
            <input
              className={hasBrandName ? "" : "buyma-required-red"}
              value={product?.brand ?? ""}
              onChange={(event) => onChange({ brand: event.target.value })}
              placeholder="Brand"
            />
          </Field>
          <Field label="브랜드 ID">
            <input
              className={hasBrandId ? "" : "buyma-required-red"}
              value={product?.brandId ?? "0"}
              onChange={(event) => onChange({ brandId: event.target.value })}
            />
          </Field>
          <Field label="구입가격">
            <input
              type="number"
              value={product?.price || 0}
              onChange={(event) => onChange({ price: Number(event.target.value) || 0 })}
            />
          </Field>
        </div>

        <div className="buyma-form-grid col3">
          <Field label="참고가격">
            <input
              type="number"
              value={product?.referencePrice ?? settings.defaultReferencePrice ?? 0}
              onChange={(event) => onChange({ referencePrice: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field label="구입기한">
            <input
              type="date"
              value={product?.purchaseDeadline ?? getDefaultDeadline(product?.extractedAt)}
              onChange={(event) => onChange({ purchaseDeadline: event.target.value })}
            />
          </Field>
          <Field label="구입가능 수">
            <input
              type="number"
              value={product?.purchaseQuantity ?? 100}
              onChange={(event) => onChange({ purchaseQuantity: Number(event.target.value) || 0 })}
            />
          </Field>
        </div>

        <div className="buyma-form-grid col3">
          <Field label="상품ID(商品ID)">
            <input value={product?.buymaProductId ?? ""} onChange={(event) => onChange({ buymaProductId: event.target.value })} placeholder="신규 등록은 빈값 가능" />
          </Field>
          <Field label="상품관리번호">
            <input value={product?.skuNumber ?? ""} onChange={(event) => onChange({ skuNumber: event.target.value })} placeholder="상품 수집 시 자동 생성" />
          </Field>
          <Field label="품번">
            <input
              className={hasModelNumber ? "" : "buyma-required-red"}
              value={getModelNumberInputValue(product)}
              onChange={(event) => onChange({ modelNumber: event.target.value })}
            />
          </Field>
        </div>

        <div className="buyma-form-grid col3">
          <Field label="컨트롤(コントロール)">
            <select
              value={product?.control ?? "下書き"}
              onChange={(event) => onChange({ control: event.target.value, publicStatus: event.target.value })}
            >
              <option value="下書き">초안(下書き)</option>
              <option value="公開">공개(公開)</option>
            </select>
          </Field>
        </div>

        <div className="buyma-form-grid col3">
          <Field label="매입지역(買付エリア)">
            <input disabled value={product?.purchaseArea ?? "2002003"} onChange={(event) => onChange({ purchaseArea: event.target.value })} placeholder="매입지역(買付エリア)" />
          </Field>
          <Field label="매입도시(買付都市)">
            <input disabled value={normalizeBuymaCityInput(product?.purchaseCity)} onChange={(event) => onChange({ purchaseCity: normalizeBuymaCityInput(event.target.value) })} placeholder="매입도시(買付都市)" />
          </Field>
          <Field label="매입샵(買付ショップ)">
            <input value={product?.purchaseShop ?? "公式オンラインショップ"} onChange={(event) => onChange({ purchaseShop: event.target.value })} placeholder="매입샵(買付ショップ)" />
          </Field>
          <Field label="발송지역(発送エリア)">
            <input disabled value={product?.shippingArea ?? "2002003"} onChange={(event) => onChange({ shippingArea: event.target.value })} placeholder="발송지역(発送エリア)" />
          </Field>
          <Field label="발송도시(発送都市)">
            <input disabled value={normalizeBuymaCityInput(product?.shippingCity)} onChange={(event) => onChange({ shippingCity: normalizeBuymaCityInput(event.target.value) })} placeholder="발송도시(発送都市)" />
          </Field>
          <Field label="배송방법(配送方法)">
            <select value={normalizeShippingMethodSelectValue(product?.shippingMethod, shippingMethodOptions)} onChange={(event) => onChange({ shippingMethod: event.target.value })}>
              {shippingMethodOptions.length ? null : <option value="">배송방법을 설정하세요</option>}
              {shippingMethodOptions.map((method) => (
                <option key={method.id} value={method.id}>{method.label}</option>
              ))}
            </select>
          </Field>
          <Field label="관세포함(関税込み)">
            <input value={product?.taxIncluded ?? "1"} onChange={(event) => onChange({ taxIncluded: event.target.value })} placeholder="관세포함(関税込み)" />
          </Field>
        </div>

        <div className="buyma-form-grid col3">
          <Field label="판매가격(円)">
            <input
              className={hasSellingPrice ? "" : "buyma-required-red"}
              type="number"
              value={product?.sellingPrice ?? 0}
              onChange={(event) => onChange({ sellingPrice: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field label={product?.unisex ? "카테고리 재선택" : "카테고리"}>
            <CategorySearchInput
              value={product?.category ?? ""}
              required={!hasCategory}
              onChange={(category) => onChange(buildCategorySelectionPatch(product, category))}
            />
          </Field>
          <label className="buyma-chk buyma-inline-bottom">
            <input
              type="checkbox"
              checked={Boolean(product?.unisex)}
              onChange={(event) => onChange(event.target.checked ? buildUnisexCategoryPatch(product) : { unisex: false })}
            /> 남녀공용
          </label>
        </div>

        <div className="buyma-form-grid col2">
          <Field label="시즌">
            <select className={hasSeason ? "" : "buyma-required-red"} value={product?.season ?? ""} onChange={(event) => onChange({ season: event.target.value })}>
              <option value="">시즌 선택</option>
              {BUYMA_SEASON_OPTIONS.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}
            </select>
          </Field>
          <Field label="테마">
            <select value={product?.theme ?? "184"} onChange={(event) => onChange({ theme: event.target.value })}>
              {BUYMA_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="buyma-description-supplement-grid">
          <Field label="상세내용">
            <textarea
              className="buyma-description-textarea"
              rows={4}
              value={product?.description ?? ""}
              onChange={(event) => onChange({ description: event.target.value })}
              placeholder="상품 상세 설명"
            />
          </Field>
          <Field label="色サイズ補足">
            <textarea
              className={`buyma-supplement-textarea ${hasSizeSupplementMismatch ? "buyma-required-red" : ""}`}
              rows={4}
              value={product?.colorSizeSupplement ?? ""}
              onChange={(event) => onChange({ colorSizeSupplement: event.target.value })}
              placeholder="색상/사이즈 보충 내용을 입력"
            />
            {hasSizeSupplementMismatch ? (
              <div className="buyma-size-mismatch-warning">
                {formatSizeSupplementMismatchMessage(sizeSupplementMismatch)}
              </div>
            ) : null}
          </Field>
        </div>

        <label>이미지 ({product?.images.length ?? 0})</label>
        <div className="buyma-image-thumbs">
          {product?.images.length ? (
            product.images.slice(0, 12).map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={image} src={image} alt="" />
            ))
          ) : (
            <span className="buyma-no-image">이미지 없음</span>
          )}
        </div>
        <ImageInlineManager
          images={images}
          selectedImageIndex={selectedImageIndex}
          selectedImage={selectedImage}
          brokenImages={brokenImages}
          onImageLoad={handlePreviewImageLoad}
          onImageError={handlePreviewImageError}
          onSelect={setSelectedImageIndex}
          onDeleteSelected={deleteSelectedImage}
          onAdd={() => addImageInputRef.current?.click()}
          onAddLogo={addBrandLogoImage}
          onOpenManager={() => setIsImageManagerOpen(true)}
          hasLogo={Boolean(product?.brandLogo || product?.brandLogos?.length)}
          disabled={!product}
        />
        {hasBrokenImages ? (
          <div className="buyma-image-warning">
            이상한 이미지가 있습니다. 액박 이미지를 삭제하거나 교체해주세요.
          </div>
        ) : null}
        <input
          ref={addImageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addManualImages(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        {isImageManagerOpen ? (
          <ImageManagerModal
            images={images}
            onChange={updateImages}
            onClose={() => setIsImageManagerOpen(false)}
          />
        ) : null}
        <div className="buyma-image-actions">
          <button className="buyma-btn buyma-btn-green" disabled={isCollecting || isScraping} onClick={onCollect}>
            {isCollecting ? "정보 취합 중..." : "정보 취합"}
          </button>
          <button className="buyma-btn buyma-btn-red" onClick={onClear}>정보 초기화</button>
          <button className="buyma-btn buyma-btn-blue" disabled={isDownloading} onClick={onDownload}>
            {isDownloading ? "생성 중..." : "CSV 다운로드"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageInlineManager({
  images,
  selectedImageIndex,
  selectedImage,
  brokenImages,
  onImageLoad,
  onImageError,
  onSelect,
  onDeleteSelected,
  onAdd,
  onAddLogo,
  onOpenManager,
  hasLogo,
  disabled,
}: {
  images: string[];
  selectedImageIndex: number;
  selectedImage: string;
  brokenImages: Set<string>;
  onImageLoad: (src: string) => void;
  onImageError: (src: string) => void;
  onSelect: (index: number) => void;
  onDeleteSelected: () => void;
  onAdd: () => void;
  onAddLogo: () => void;
  onOpenManager: () => void;
  hasLogo: boolean;
  disabled: boolean;
}) {
  const selectedImageBroken = selectedImage ? brokenImages.has(selectedImage) : false;

  return (
    <div className="buyma-inline-image-manager">
      <label>이미지 ({images.length})</label>
      <div className="buyma-image-manager-body">
        <div className={`buyma-image-list ${brokenImages.size ? "buyma-required-red" : ""}`}>
          {images.length ? (
            images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                className={`${index === selectedImageIndex ? "active" : ""} ${brokenImages.has(image) ? "broken" : ""}`}
                onClick={() => onSelect(index)}
              >
                {getImageListLabel(image, index)}
                {brokenImages.has(image) ? " (이미지 오류)" : ""}
              </button>
            ))
          ) : (
            <div className="buyma-no-image">이미지 없음</div>
          )}
        </div>
        <div className={`buyma-image-preview ${selectedImageBroken ? "buyma-required-red" : ""}`}>
          {selectedImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedImage}
              alt=""
              onLoad={() => onImageLoad(selectedImage)}
              onError={() => onImageError(selectedImage)}
            />
          ) : (
            <span className="buyma-no-image">이미지 없음</span>
          )}
          {selectedImageBroken ? <span className="buyma-image-broken-label">이미지 오류</span> : null}
        </div>
      </div>
      <div className="buyma-image-manage-actions">
        <button className="buyma-btn buyma-btn-sm buyma-btn-red" disabled={!images.length} onClick={onDeleteSelected}>
          선택이미지 삭제
        </button>
        <button className="buyma-btn buyma-btn-sm buyma-btn-blue" disabled={disabled} onClick={onAdd}>
          수동이미지 추가
        </button>
        <button className="buyma-btn buyma-btn-sm" disabled={disabled || !hasLogo} onClick={onAddLogo}>
          제품로고 추가
        </button>
        <button className="buyma-btn buyma-btn-sm buyma-btn-orange" disabled={!images.length} onClick={onOpenManager}>
          이미지선택 창
        </button>
      </div>
    </div>
  );
}

function ImageManagerModal({
  images,
  onChange,
  onClose,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  onClose: () => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function deleteImage(index: number) {
    onChange(images.filter((_, imageIndex) => imageIndex !== index));
  }

  function moveImage(toIndex: number) {
    if (dragIndex === null || dragIndex === toIndex) return;
    onChange(moveArrayItem(images, dragIndex, toIndex));
    setDragIndex(null);
  }

  return (
    <div className="buyma-image-modal-backdrop">
      <div className="buyma-image-modal">
        <div className="buyma-image-modal-header">
          <strong>이미지 썸네일 관리</strong>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="buyma-image-modal-body">
          <p>드래그로 순서를 변경하고 X 버튼으로 삭제할 수 있습니다.</p>
          <div className="buyma-image-modal-grid">
            {images.map((image, index) => (
              <div
                key={`${image}-${index}`}
                className="buyma-image-modal-item"
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveImage(index)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" />
                <button type="button" onClick={() => deleteImage(index)}>X</button>
              </div>
            ))}
          </div>
        </div>
        <div className="buyma-image-modal-footer">
          <span>총 {images.length}장</span>
          <div>
            <button className="buyma-btn buyma-btn-blue" onClick={onClose}>확인</button>
            <button className="buyma-btn" onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getImageListLabel(image: string, index: number) {
  if (image.startsWith("data:")) return `manual_image_${index + 1}`;

  try {
    const path = new URL(image).pathname;
    const name = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
    return name || `image_${index + 1}`;
  } catch {
    const name = decodeURIComponent(image.split("?")[0].split("/").filter(Boolean).at(-1) ?? "");
    return name || `image_${index + 1}`;
  }
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  if (!item) return items;
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function ColorSizePanel({
  product,
  onChange,
}: {
  product: ProductDraft | null;
  onChange: (patch: Partial<ProductDraft>) => void;
}) {
  const rows = buildColorSizeRows(product);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const colorRows = getColorDetailRows(product, rows);
  const sizeSupplementMismatch = getSizeSupplementMismatch(product);
  const sizesMissingInSupplement = new Set(sizeSupplementMismatch.missingInSupplement);
  const colorsMissingDetailSizes = new Set(sizeSupplementMismatch.missingInDetailByColor.map((item) => normalizeComparableColor(item.color)));
  const hasSizeMismatch = hasSizeSupplementMismatchIssue(sizeSupplementMismatch);

  function updateRows(nextRows: ColorSizeRow[]) {
    const normalizedRows = nextRows
      .filter((row) => isUsableProductSize(product, row.size))
      .map((row) => ({
        ...row,
        sizeTypeId: row.sizeTypeId || resolveBuymaSizeTypeId(product?.category, row.size),
      }));
    const colorSystemMap: Record<string, string> = {};
    const stockData: Record<string, StockStatus> = {};
    const colors = [...new Set(normalizedRows.map((row) => row.color).filter(Boolean))];
    const sizes = [...new Set(normalizedRows.map((row) => row.size).filter(Boolean))];

    normalizedRows.forEach((row) => {
      if (row.colorSystemId) colorSystemMap[row.color] = row.colorSystemId;
      stockData[`${row.color}|${row.size.toUpperCase()}`] = row.stock;
    });

    onChange({ colors, sizes, sizeTableData: normalizedRows, colorSystemMap, stockData });
  }

  function updateColorSystem(color: string, colorSystemId: string) {
    const nextRows = rows.map((row) => row.color === color ? { ...row, colorSystemId } : row);
    if (nextRows.length) {
      updateRows(nextRows);
      return;
    }

    onChange({
      colorSystemMap: {
        ...(product?.colorSystemMap ?? {}),
        [color]: colorSystemId,
      },
    });
  }

  function updateColorName(currentColor: string, nextColor: string) {
    const color = nextColor;
    if (color === currentColor) return;

    const colorSystemId = getColorSystemId(cleanText(color)) || product?.colorSystemMap?.[currentColor] || "";
    const nextRows = rows.map((row) => row.color === currentColor ? { ...row, color, colorSystemId } : row);

    if (nextRows.length) {
      updateRows(nextRows);
      return;
    }

    const colorSystemMap = { ...(product?.colorSystemMap ?? {}) };
    delete colorSystemMap[currentColor];
    colorSystemMap[color] = colorSystemId;
    onChange({
      colors: (product?.colors ?? []).map((item) => item === currentColor ? color : item),
      colorSystemMap,
    });
  }

  function addColorDetailRow() {
    const existingColors = colorRows.map((row) => row.color);
    let nextColor = "NEW COLOR";
    let count = 1;
    while (existingColors.includes(nextColor)) {
      count += 1;
      nextColor = `NEW COLOR ${count}`;
    }

    const sizes = rows.length ? [...new Set(rows.map((row) => row.size).filter(Boolean))] : ["FREE"];
    updateRows([
      ...rows,
      ...sizes.map((size) => ({
        color: nextColor,
        colorSystemId: "",
        size,
        sizeTypeId: resolveBuymaSizeTypeId(product?.category, size),
        supplement: "",
        stock: "1" as StockStatus,
      })),
    ]);
  }

  function toggleSelectedRow(index: number) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function deleteSelectedRows() {
    if (selectedRows.size === 0) return;
    updateRows(rows.filter((_, index) => !selectedRows.has(index)));
    setSelectedRows(new Set());
  }

  return (
    <div className="buyma-panel">
      <div className="buyma-panel-header buyma-panel-header-yellow">컬러상세</div>
      <div className="buyma-panel-body">
        <div className="buyma-info-note">
          <strong>i Note:</strong><br />
          Buyma에 등록할 색계통과 일치해야 재고관리가 가능합니다.
        </div>
        <div className="buyma-table-toolbar">
          <button className="buyma-btn buyma-btn-sm buyma-btn-green" disabled={!product} onClick={addColorDetailRow}>
            + 컬러추가
          </button>
        </div>
        <div className="buyma-table-wrap buyma-color-detail-wrap">
          <table className="buyma-data-table buyma-color-detail-table">
            <thead>
              <tr>
                <th>색상</th>
                <th>색 계통</th>
              </tr>
            </thead>
            <tbody>
              {colorRows.length ? colorRows.map((row, index) => (
                <tr key={`color-detail-${index}`}>
                  <td>
                    <input
                      className={colorsMissingDetailSizes.has(normalizeComparableColor(row.color)) ? "buyma-required-red" : ""}
                      value={row.color}
                      onChange={(event) => updateColorName(row.color, event.target.value)}
                    />
                  </td>
                  <td>
                    <select value={row.colorSystemId} onChange={(event) => updateColorSystem(row.color, event.target.value)}>
                      {BUYMA_COLOR_SYSTEMS.map((color) => <option key={color.id} value={color.id}>{color.id ? `${color.id} - ${color.label}` : color.label}</option>)}
                    </select>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={2} className="buyma-empty-row">색상 데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="buyma-size-detail-header">사이즈상세</div>
        <div className="buyma-table-toolbar">
          <button className="buyma-btn buyma-btn-sm buyma-btn-red" disabled={selectedRows.size === 0} onClick={deleteSelectedRows}>
            선택사이즈 삭제
          </button>
          <button
            className="buyma-btn buyma-btn-sm buyma-btn-green"
            onClick={() => updateRows([...rows, { color: "FREE", colorSystemId: "", size: "FREE", supplement: "", stock: "1" }])}
          >
            + 행 추가
          </button>
        </div>
        <div className="buyma-table-wrap">
          <table className="buyma-data-table">
            <thead>
              <tr>
                <th></th>
                <th>Color</th>
                <th>색 계통 ID</th>
                <th>Size</th>
                <th>재고상태</th>
                <th>검색용 사이즈</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row, index) => (
                <tr key={`size-detail-${index}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedRows.has(index)}
                      onChange={() => toggleSelectedRow(index)}
                    />
                  </td>
                  <td><input value={row.color} onChange={(event) => updateRows(rows.map((item, rowIndex) => rowIndex === index ? { ...item, color: event.target.value, colorSystemId: getColorSystemId(event.target.value) || item.colorSystemId } : item))} /></td>
                  <td>{row.colorSystemId || "-"}</td>
                  <td>
                    <input
                      className={sizesMissingInSupplement.has(normalizeComparableSize(row.size)) ? "buyma-required-red" : ""}
                      value={row.size}
                      onChange={(event) => updateRows(rows.map((item, rowIndex) => rowIndex === index ? { ...item, size: event.target.value, sizeTypeId: resolveBuymaSizeTypeId(product?.category, event.target.value) } : item))}
                    />
                  </td>
                  <td className={row.stock === "0" ? "buyma-stock-soldout" : undefined}>
                    <select value={row.stock} onChange={(event) => updateRows(rows.map((item, rowIndex) => rowIndex === index ? { ...item, stock: event.target.value as StockStatus } : item))}>
                      <option value="1">구매가능</option>
                      <option value="2">보유재고</option>
                      <option value="0">재고없음</option>
                    </select>
                  </td>
                  <td>
                    <BuymaSearchSizeSelect
                      categoryId={product?.category}
                      size={row.size}
                      value={row.sizeTypeId || resolveBuymaSizeTypeId(product?.category, row.size)}
                      onChange={(sizeTypeId) => updateRows(rows.map((item, rowIndex) => rowIndex === index ? { ...item, sizeTypeId } : item))}
                    />
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="buyma-empty-row">상품을 추가하면 자동으로 채워집니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {hasSizeMismatch ? (
          <div className="buyma-size-mismatch-warning">
            {formatSizeSupplementMismatchMessage(sizeSupplementMismatch)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MainImagePanel({
  product,
  onCreate,
}: {
  product: ProductDraft | null;
  onCreate: () => void;
}) {
  const image = product?.editedImage || product?.images[0] || "";

  return (
    <div className="buyma-panel buyma-main-image-panel">
      <div className="buyma-panel-header">메인 이미지</div>
      <div className="buyma-panel-body center">
        <div className="buyma-main-image-box">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" />
          ) : (
            <span className="buyma-no-image">이미지 없음</span>
          )}
        </div>
        <button className="buyma-btn buyma-btn-blue buyma-main-image-create-btn" type="button" onClick={onCreate}>
          메인이미지 제작
        </button>
      </div>
    </div>
  );
}

function ImageEditorPanel({
  product,
  onSave,
}: {
  product: ProductDraft | null;
  onSave: (editedImage: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragTargetRef = useRef<EditorDragTarget | null>(null);
  const editorImageCacheRef = useRef(new Map<string, Promise<HTMLImageElement | null>>());
  const editorRenderIdRef = useRef(0);
  const placedImageIdRef = useRef(0);
  const [template, setTemplate] = useState<EditorTemplate>("basic");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [transparentBg, setTransparentBg] = useState(false);
  const [logoImage, setLogoImage] = useState("");
  const [uploadedPlacedSources, setUploadedPlacedSources] = useState<string[]>([]);
  const [placedImages, setPlacedImages] = useState<EditorPlacedImage[]>([]);
  const [selectedPlacedIndex, setSelectedPlacedIndex] = useState(0);
  const [transparentImportedImageBg, setTransparentImportedImageBg] = useState(false);
  const [showLogo, setShowLogo] = useState(true);
  const [showText, setShowText] = useState(false);
  const [logoX, setLogoX] = useState(580);
  const [logoY, setLogoY] = useState(50);
  const [logoWidth, setLogoWidth] = useState(150);
  const [logoHeight, setLogoHeight] = useState(70);
  const [titleText, setTitleText] = useState("");
  const [textX, setTextX] = useState(60);
  const [textY, setTextY] = useState(705);
  const [textSize, setTextSize] = useState(34);
  const [textColor, setTextColor] = useState("#111111");

  useEffect(() => {
    const brandText = getEnglishBrandName(product);
    const brandLogo = getProductBrandLogo(product);
    let ignore = false;
    editorImageCacheRef.current.clear();
    editorRenderIdRef.current += 1;

    void Promise.resolve().then(() => {
      if (ignore) return;

      setLogoImage(brandLogo);
      setUploadedPlacedSources([]);
      setPlacedImages([]);
      setSelectedPlacedIndex(0);
      setTitleText(brandText);
      setShowLogo(false);
      setShowText(false);
    });

    return () => {
      ignore = true;
    };
  }, [product]);

  async function renderEditorCanvas({ showSelection = true }: { showSelection?: boolean } = {}) {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const renderId = editorRenderIdRef.current + 1;
    editorRenderIdRef.current = renderId;
    const logo = showLogo ? await loadEditorCanvasImage(logoImage) : null;
    const placedLoaded = await Promise.all(placedImages.map(async (placed) => ({
      placed,
      image: await loadEditorCanvasImage(placed.src),
    })));
    if (showText) await loadEditorFont(textSize);
    if (renderId !== editorRenderIdRef.current) return false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    try {
      ctx.scale(EDITOR_CANVAS_SCALE, EDITOR_CANVAS_SCALE);
      if (!transparentBg) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, EDITOR_DESIGN_SIZE, EDITOR_DESIGN_SIZE);
      }

      if (template === "lucky") {
        renderLuckyTemplate(ctx);
      } else if (template === "lucky2") {
        renderLucky2Template(ctx);
      } else if (template === "northface") {
        renderNorthFaceTemplate(ctx);
      } else if (template === "northfaceWhiteLabel") {
        renderNorthFaceWhiteLabelTemplate(ctx);
      }

      placedLoaded.forEach(({ placed, image }) => {
        if (image) {
          const clipRect = placed.clipToLuckyRightCell ? getLuckyRightCellClipRect(template) : null;
          if (clipRect) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
            ctx.clip();
          }

          drawImageFitWithBackgroundRemoval(
            ctx,
            image,
            placed.x,
            placed.y,
            placed.width,
            placed.height,
            placed.removeBackground,
          );
          if (clipRect) ctx.restore();
          if (showSelection && placedImages[selectedPlacedIndex]?.id === placed.id) {
            drawPlacedImageSelection(ctx, placed);
          }
        }
      });

      if (logo) drawImageFit(ctx, logo, logoX, logoY, logoWidth, logoHeight);

      if (showText) {
        drawEditorText(ctx, titleText, textX, textY, textSize, textColor);
      }
    } finally {
      ctx.restore();
    }

    return true;
  }

  function loadEditorCanvasImage(src: string) {
    if (!src) return Promise.resolve(null);
    const cached = editorImageCacheRef.current.get(src);
    if (cached) return cached;

    const promise = loadCanvasImage(src);
    editorImageCacheRef.current.set(src, promise);
    return promise;
  }

  useEffect(() => {
    void renderEditorCanvas();
  });

  const availablePlacedSources = useMemo(
    () => uniqueTextList([
      ...(product?.images ?? []),
      ...(product?.brandLogos ?? []),
      product?.brandLogo || "",
      ...uploadedPlacedSources,
    ]),
    [product, uploadedPlacedSources],
  );
  const selectedPlacedImage = placedImages[selectedPlacedIndex] ?? null;

  async function addPlacedImage(src: string) {
    const image = await loadEditorCanvasImage(src);
    const frame = getInitialPlacedImageFrame(image);
    placedImageIdRef.current += 1;
    const nextImage: EditorPlacedImage = {
      id: `placed-${placedImageIdRef.current}`,
      src,
      ...frame,
      removeBackground: transparentImportedImageBg,
    };
    setPlacedImages((current) => [...current, nextImage]);
    setSelectedPlacedIndex(placedImages.length);
  }

  async function addPlacedSourceFiles(files: FileList | null) {
    const images = await readFiles(files);
    if (!images.length) return;
    setUploadedPlacedSources((current) => uniqueTextList([...current, ...images]));
  }

  function updateSelectedPlacedImageSize(width: number) {
    setPlacedImages((current) =>
      current.map((image, index) => {
        if (index !== selectedPlacedIndex) return image;
        const aspectRatio = image.width / image.height || 1;
        const nextWidth = Math.max(40, width);
        return {
          ...image,
          width: nextWidth,
          height: Math.max(40, Math.round(nextWidth / aspectRatio)),
        };
      }),
    );
  }

  function updateSelectedPlacedImageWidth(width: number) {
    setPlacedImages((current) =>
      current.map((image, index) =>
        index === selectedPlacedIndex ? { ...image, width: Math.max(40, width) } : image,
      ),
    );
  }

  function updateSelectedPlacedImageHeight(height: number) {
    setPlacedImages((current) =>
      current.map((image, index) =>
        index === selectedPlacedIndex ? { ...image, height: Math.max(40, height) } : image,
      ),
    );
  }

  function updateSelectedPlacedImageBackground(removeBackground: boolean) {
    setPlacedImages((current) =>
      current.map((image, index) =>
        index === selectedPlacedIndex ? { ...image, removeBackground } : image,
      ),
    );
  }

  function updateSelectedPlacedImageClipToLuckyRightCell(clipToLuckyRightCell: boolean) {
    setPlacedImages((current) =>
      current.map((image, index) =>
        index === selectedPlacedIndex ? { ...image, clipToLuckyRightCell } : image,
      ),
    );
  }

  function removePlacedImage() {
    setPlacedImages((current) => current.filter((_, index) => index !== selectedPlacedIndex));
    setSelectedPlacedIndex((current) => Math.max(0, current - 1));
  }

  function selectTemplate(nextTemplate: EditorTemplate) {
    setTemplate(nextTemplate);
    setPlacedImages([]);
    setSelectedPlacedIndex(0);
  }

  function alignLogoAndTextTopCenter() {
    setShowLogo(Boolean(logoImage));
    setShowText(true);
    setLogoWidth(170);
    setLogoHeight(70);
    setLogoX((EDITOR_DESIGN_SIZE - 170) / 2);
    setLogoY(34);
    setTextSize(34);
    setTextX(EDITOR_DESIGN_SIZE / 2 - estimateTextWidth(titleText || getEnglishBrandName(product), 34) / 2);
    setTextY(130);
  }

  function updateLogoSize(width: number) {
    const nextWidth = Math.max(20, width);
    const ratio = logoWidth > 0 ? logoHeight / logoWidth : 70 / 150;
    setLogoWidth(nextWidth);
    setLogoHeight(Math.max(20, Math.round(nextWidth * ratio)));
  }

  function getCanvasPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = EDITOR_DESIGN_SIZE / rect.width;
    const scaleY = EDITOR_DESIGN_SIZE / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function startCanvasDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPointer(event);
    if (!point) return;
    for (let index = placedImages.length - 1; index >= 0; index -= 1) {
      const image = placedImages[index];
      if (isPointInPlacedResizeHandle(point.x, point.y, image)) {
        dragTargetRef.current = {
          type: "placed-resize",
          index,
          startX: image.x,
          startY: image.y,
          aspectRatio: image.width / image.height || 1,
        };
        setSelectedPlacedIndex(index);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (isPointInBox(point.x, point.y, image.x, image.y, image.width, image.height)) {
        dragTargetRef.current = { type: "placed", index, offsetX: point.x - image.x, offsetY: point.y - image.y };
        setSelectedPlacedIndex(index);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (showLogo && isPointInBox(point.x, point.y, logoX, logoY, logoWidth, logoHeight)) {
      dragTargetRef.current = { type: "logo", offsetX: point.x - logoX, offsetY: point.y - logoY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (showText && isPointInBox(point.x, point.y, textX, textY - textSize, Math.max(120, estimateTextWidth(titleText, textSize)), textSize * 2.2)) {
      dragTargetRef.current = { type: "text", offsetX: point.x - textX, offsetY: point.y - textY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function moveCanvasDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const target = dragTargetRef.current;
    const point = getCanvasPointer(event);
    if (!target || !point) return;
    if (target.type === "logo") {
      const nextX = Math.round(point.x - target.offsetX);
      const nextY = Math.round(point.y - target.offsetY);
      setLogoX(nextX);
      setLogoY(nextY);
    } else if (target.type === "text") {
      const nextX = Math.round(point.x - target.offsetX);
      const nextY = Math.round(point.y - target.offsetY);
      setTextX(nextX);
      setTextY(nextY);
    } else if (target.type === "placed-resize") {
      setPlacedImages((current) =>
        current.map((image, index) => {
          if (index !== target.index) return image;
          const minSize = 40;
          const widthFromX = point.x - target.startX;
          const widthFromY = (point.y - target.startY) * target.aspectRatio;
          const nextWidth = Math.max(minSize, Math.round(Math.max(widthFromX, widthFromY)));
          return {
            ...image,
            width: nextWidth,
            height: Math.max(minSize, Math.round(nextWidth / target.aspectRatio)),
          };
        }),
      );
    } else {
      const nextX = Math.round(point.x - target.offsetX);
      const nextY = Math.round(point.y - target.offsetY);
      setPlacedImages((current) =>
        current.map((image, index) =>
          index === target.index ? { ...image, x: nextX, y: nextY } : image,
        ),
      );
    }
  }

  function stopCanvasDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    dragTargetRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
  }

  async function saveCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const rendered = await renderEditorCanvas({ showSelection: false });
      if (!rendered) return;
      onSave(transparentBg ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9));
      void renderEditorCanvas();
    } catch {
      window.alert("외부 이미지 CORS 제한으로 저장할 수 없습니다. 이미지를 파일로 업로드한 뒤 다시 저장하세요.");
      void renderEditorCanvas();
    }
  }

  async function downloadCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const rendered = await renderEditorCanvas({ showSelection: false });
      if (!rendered) return;
      const dataUrl = transparentBg ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.95);
      triggerDownload(dataUrlToBlob(dataUrl), `buyma_main_image.${getDataUrlExtension(dataUrl)}`);
      void renderEditorCanvas();
    } catch {
      window.alert("외부 이미지 CORS 제한으로 다운로드할 수 없습니다. 이미지를 파일로 업로드한 뒤 다시 시도하세요.");
      void renderEditorCanvas();
    }
  }

  return (
    <div className="buyma-editor-layout">
      <div className="buyma-editor-canvas-area">
        <canvas
          ref={canvasRef}
          className="buyma-editor-canvas"
          width={EDITOR_CANVAS_SIZE}
          height={EDITOR_CANVAS_SIZE}
          onPointerDown={startCanvasDrag}
          onPointerMove={moveCanvasDrag}
          onPointerUp={stopCanvasDrag}
          onPointerCancel={stopCanvasDrag}
        />
        <div className="buyma-editor-canvas-actions">
          <button className="buyma-btn buyma-btn-green" disabled={!product} onClick={() => void saveCanvas()}>상품에 저장</button>
          <button className="buyma-btn buyma-btn-blue" onClick={() => void downloadCanvas()}>이미지 다운로드</button>
          <button className="buyma-btn buyma-btn-red buyma-btn-sm" onClick={() => {
            setLogoImage("");
            setUploadedPlacedSources([]);
            setPlacedImages([]);
            setSelectedPlacedIndex(0);
          }}>초기화</button>
        </div>
      </div>
      <div className="buyma-editor-settings">
        <EditorSection label="템플릿">
          <div className="buyma-editor-btn-group">
            {[
              ["basic", "기본형"],
              ["lucky", "럭키 배치"],
              ["lucky2", "럭키 배치2"],
              ["northface", "노스페이스"],
              ["northfaceWhiteLabel", "노스페이스 화이트라벨"],
            ].map(([value, label]) => (
              <button key={value} className={`buyma-editor-tpl-btn ${template === value ? "active" : ""}`} onClick={() => selectTemplate(value as EditorTemplate)}>
                {label}
              </button>
            ))}
          </div>
        </EditorSection>
        <EditorSection label="배경색">
          <label className="buyma-chk"><input type="checkbox" checked={transparentBg} onChange={(event) => setTransparentBg(event.target.checked)} /> 배경 투명</label>
          <label className="buyma-chk"><input type="checkbox" checked={transparentImportedImageBg} onChange={(event) => setTransparentImportedImageBg(event.target.checked)} /> 새 배치 이미지 흰배경 투명 기본값</label>
          <div className="buyma-editor-btn-group">
            {["#ffffff", "#f5f5f5", "#000000"].map((color) => (
              <button key={color} className={`buyma-editor-tpl-btn ${bgColor === color ? "active" : ""}`} onClick={() => setBgColor(color)} style={{ background: color, color: color === "#000000" ? "#fff" : "#111" }}>
                {color}
              </button>
            ))}
            <input type="color" value={bgColor} onChange={(event) => setBgColor(event.target.value)} />
          </div>
        </EditorSection>
        <EditorSection label="로고">
          <div className="buyma-editor-slider-row">
            <span>로고 크기</span>
            <input
              type="range"
              min={40}
              max={420}
              value={logoWidth}
              onChange={(event) => updateLogoSize(Number(event.target.value))}
            />
            <output>{logoWidth}px</output>
            <label className="buyma-chk"><input type="checkbox" checked={showLogo} onChange={(event) => setShowLogo(event.target.checked)} /> 로고 표시</label>
          </div>
          <button className="buyma-editor-tpl-btn" onClick={alignLogoAndTextTopCenter}>로고+텍스트 상단 가운데</button>
          <FileInput onLoad={setLogoImage} />
        </EditorSection>
        <EditorSection label="텍스트">
          <div className="buyma-editor-slider-row">
            <span>텍스트 크기</span>
            <input
              type="range"
              min={10}
              max={120}
              value={textSize}
              onChange={(event) => setTextSize(Number(event.target.value) || 10)}
            />
            <output>{textSize}px</output>
            <label className="buyma-chk"><input type="checkbox" checked={showText} onChange={(event) => setShowText(event.target.checked)} /> 텍스트 표시</label>
          </div>
          <button className="buyma-editor-tpl-btn" onClick={() => setTitleText(getEnglishBrandName(product))}>브랜드명 자동입력</button>
          <input value={titleText} onChange={(event) => setTitleText(event.target.value)} placeholder="English brand name" />
          <div className="buyma-editor-placement-controls">
            <label>색상<input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)} /></label>
          </div>
        </EditorSection>
        <EditorSection label="가져온 이미지 배치">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              void addPlacedSourceFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="buyma-editor-source-grid">
            {availablePlacedSources.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                className="buyma-editor-source-thumb"
                onClick={() => void addPlacedImage(image)}
                title="캔버스에 배치"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" />
              </button>
            ))}
          </div>
          {placedImages.length ? (
            <div className="buyma-editor-layer-list">
              {placedImages.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  className={index === selectedPlacedIndex ? "active" : ""}
                  onClick={() => setSelectedPlacedIndex(index)}
                >
                  배치 {index + 1}
                </button>
              ))}
            </div>
          ) : null}
          {selectedPlacedImage ? (
            <div className="buyma-editor-placement-controls">
              <div className="buyma-editor-slider-row">
                <span>이미지 크기</span>
                <input
                  type="range"
                  min={40}
                  max={760}
                  value={selectedPlacedImage.width}
                  onChange={(event) => updateSelectedPlacedImageSize(Number(event.target.value))}
                />
                <output>{selectedPlacedImage.width}px</output>
              </div>
              <div className="buyma-editor-slider-row">
                <span>가로 크기</span>
                <input
                  type="range"
                  min={40}
                  max={760}
                  value={selectedPlacedImage.width}
                  onChange={(event) => updateSelectedPlacedImageWidth(Number(event.target.value))}
                />
                <output>{selectedPlacedImage.width}px</output>
              </div>
              <div className="buyma-editor-slider-row">
                <span>세로 크기</span>
                <input
                  type="range"
                  min={40}
                  max={760}
                  value={selectedPlacedImage.height}
                  onChange={(event) => updateSelectedPlacedImageHeight(Number(event.target.value))}
                />
                <output>{selectedPlacedImage.height}px</output>
              </div>
              <label className="buyma-chk buyma-editor-full-row">
                <input
                  type="checkbox"
                  checked={selectedPlacedImage.removeBackground}
                  onChange={(event) => updateSelectedPlacedImageBackground(event.target.checked)}
                /> 선택 이미지 흰배경 투명
              </label>
              <label className="buyma-chk buyma-editor-full-row">
                <input
                  type="checkbox"
                  checked={Boolean(selectedPlacedImage.clipToLuckyRightCell)}
                  onChange={(event) => updateSelectedPlacedImageClipToLuckyRightCell(event.target.checked)}
                /> 럭키 오른쪽칸 안으로 자르기
              </label>
              <button className="buyma-editor-tpl-btn" onClick={removePlacedImage}>선택 삭제</button>
            </div>
          ) : null}
        </EditorSection>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  setStatus,
}: {
  settings: BuymaSettings;
  onChange: (patch: Partial<BuymaSettings>) => void;
  setStatus: (status: string) => void;
}) {
  const [imageServerStatus, setImageServerStatus] = useState("");
  const [isTestingImageServer, setIsTestingImageServer] = useState(false);
  const [shippingMethodIdInput, setShippingMethodIdInput] = useState("");
  const [shippingMethodLabelInput, setShippingMethodLabelInput] = useState("");

  function updateImageServerStatus(status: string) {
    setImageServerStatus(status);
    setStatus(status);
  }

  function addShippingMethod() {
    const id = normalizeShippingMethodOptionId(shippingMethodIdInput);
    if (!id) {
      setStatus("배송방법(配送方法) ID를 입력하세요.");
      return;
    }

    const existingIds = new Set(getShippingMethodOptions(settings).map((method) => method.id));
    if (existingIds.has(id)) {
      setStatus(`${getShippingMethodDisplayId(id)} 배송방법(配送方法)은 이미 있습니다.`);
      return;
    }

    const nextMethod = {
      id,
      label: formatShippingMethodOptionLabel({
        id,
        label: shippingMethodLabelInput || id,
      }),
    };
    onChange({ shippingMethods: [...(settings.shippingMethods ?? []), nextMethod] });
    setShippingMethodIdInput("");
    setShippingMethodLabelInput("");
    setStatus(`${getShippingMethodDisplayId(id)} 배송방법(配送方法)을 추가했습니다.`);
  }

  function removeShippingMethod(id: string) {
    onChange({
      shippingMethods: (settings.shippingMethods ?? []).filter(
        (method) => normalizeShippingMethodOptionId(method.id) !== id,
      ),
    });
    setStatus(`${getShippingMethodDisplayId(id)} 배송방법(配送方法)을 삭제했습니다.`);
  }

  async function testImageServer() {
    const imgbbApiKey = cleanText(settings.imgbbApiKey);
    const imageServerUrl = cleanText(settings.imageServerUrl);
    const imageServerApiKey = cleanText(settings.imageServerApiKey);

    if (!imgbbApiKey || !imageServerUrl || !imageServerApiKey) {
      updateImageServerStatus("imgBB API Key, Worker URL, Worker API Key를 입력하세요.");
      return;
    }

    setIsTestingImageServer(true);
    updateImageServerStatus("이미지 서버 연결 테스트 중...");
    try {
      const workerUrl = imageServerUrl.replace(/\/$/, "");
      const health = await fetch(`${workerUrl}/health`);
      if (!health.ok) throw new Error(`Worker HTTP ${health.status}`);

      const authCheck = await fetch(`${workerUrl}/upload-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": imageServerApiKey,
        },
        body: JSON.stringify({
          sku: "connection_test",
          images: [],
          imgbbApiKey,
        }),
      });
      if (!authCheck.ok) throw new Error(`Worker API Key 확인 실패: HTTP ${authCheck.status}`);

      const imgbbUrl = await uploadBase64ToImgbb(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        imgbbApiKey,
        "buyma_connection_test",
      );
      if (!imgbbUrl) throw new Error("imgBB API Key 확인 실패");

      updateImageServerStatus("이미지 서버 연결 확인 완료.");
    } catch (error) {
      updateImageServerStatus(error instanceof Error ? error.message : "이미지 서버 연결 실패");
    } finally {
      setIsTestingImageServer(false);
    }
  }

  return (
    <div className="buyma-settings-grid">
      <div className="buyma-panel">
        <div className="buyma-panel-header">가격 설정</div>
        <div className="buyma-panel-body">
          <div className="buyma-form-grid col2">
            <Field label="마진율 (%)"><input type="number" value={settings.marginRate} onChange={(event) => onChange({ marginRate: Number(event.target.value) || 0 })} /></Field>
            <Field label="환율 (1 JPY→KRW)"><input type="number" step="0.01" value={getKrwPerJpyRate(settings.exchangeRate)} onChange={(event) => onChange({ exchangeRate: getJpyPerKrwRate(Number(event.target.value) || 0) })} /></Field>
            <Field label="기본 참고가격"><input type="number" value={settings.defaultReferencePrice} onChange={(event) => onChange({ defaultReferencePrice: Number(event.target.value) || 0 })} /></Field>
          </div>
        </div>
      </div>
      <div className="buyma-panel">
        <div className="buyma-panel-header">스크래핑 설정</div>
        <div className="buyma-panel-body">
          <div className="buyma-form-grid col2">
            <Field label="상품명 앞 문구"><input value={settings.productTitlePrefix} onChange={(event) => onChange({ productTitlePrefix: event.target.value })} placeholder="예: 韓国人気" /></Field>
            <div className="buyma-description-setting-row">
              <Field label="상세내용 추가 문구"><textarea rows={4} value={settings.productDescriptionPrefix} onChange={(event) => onChange({ productDescriptionPrefix: event.target.value })} placeholder="BUYMA 상세내용에 추가할 문구" /></Field>
              <Field label="상세내용 문구 위치">
                <select value={settings.productDescriptionPlacement} onChange={(event) => onChange({ productDescriptionPlacement: event.target.value as BuymaDescriptionPlacement })}>
                  <option value="before">상세내용 위</option>
                  <option value="after">상세내용 아래</option>
                </select>
              </Field>
            </div>
          </div>
        </div>
      </div>
      <div className="buyma-panel">
        <div className="buyma-panel-header">배송방법(配送方法) 설정</div>
        <div className="buyma-panel-body">
          <div className="buyma-form-grid col2">
            <Field label="배송방법 ID(配送方法 ID)">
              <input value={shippingMethodIdInput} onChange={(event) => setShippingMethodIdInput(event.target.value)} placeholder="예: 1234567" />
            </Field>
            <Field label="표시명">
              <input value={shippingMethodLabelInput} onChange={(event) => setShippingMethodLabelInput(event.target.value)} placeholder="예: 注文完了後 7~14日" />
            </Field>
          </div>
          <button type="button" className="buyma-btn buyma-btn-sm buyma-btn-green" onClick={addShippingMethod}>
            배송방법 추가
          </button>
          {(settings.shippingMethods ?? []).length ? (
            <div className="buyma-shipping-method-list">
              {(settings.shippingMethods ?? []).map((method) => {
                const id = normalizeShippingMethodOptionId(method.id);
                return (
                  <div key={id} className="buyma-shipping-method-item">
                    <span>{formatShippingMethodOptionLabel(method)}</span>
                    <button type="button" className="buyma-btn buyma-btn-sm buyma-btn-red" onClick={() => removeShippingMethod(id)}>
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="buyma-panel">
        <div className="buyma-panel-header">이미지 서버 설정 (imgBB)</div>
        <div className="buyma-panel-body">
          <div className="buyma-info-note">원본 확장프로그램의 Worker + imgBB 업로드 흐름을 사용합니다.</div>
          <Field label="imgBB API Key"><input type="password" value={settings.imgbbApiKey} onChange={(event) => onChange({ imgbbApiKey: event.target.value })} /></Field>
          <Field label="Worker URL"><input value={settings.imageServerUrl} onChange={(event) => onChange({ imageServerUrl: event.target.value })} placeholder="https://buyma-image-worker.your-account.workers.dev" /></Field>
          <Field label="Worker API Key"><input type="password" value={settings.imageServerApiKey} onChange={(event) => onChange({ imageServerApiKey: event.target.value })} /></Field>
          <div className="buyma-form-row">
            <label className="buyma-chk">
              <input type="checkbox" checked={settings.enableImageUpload} onChange={(event) => onChange({ enableImageUpload: event.target.checked })} />
              이미지 업로드 사용
            </label>
            <button
              type="button"
              className="buyma-btn buyma-btn-sm buyma-btn-blue"
              disabled={isTestingImageServer}
              onClick={() => void testImageServer()}
            >
              {isTestingImageServer ? "테스트 중..." : "연결 테스트"}
            </button>
          </div>
          {imageServerStatus ? <div className="buyma-image-server-status">{imageServerStatus}</div> : null}
        </div>
      </div>
    </div>
  );
}

function CollectionRequiredModal({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="buyma-image-modal-backdrop">
      <div className="buyma-alert-modal" role="alertdialog" aria-modal="true" aria-labelledby="collection-required-title">
        <div className="buyma-image-modal-header">
          <strong id="collection-required-title">필수 선택 확인</strong>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="buyma-alert-modal-body">
          <p>{message}</p>
        </div>
        <div className="buyma-image-modal-footer">
          <span />
          <button className="buyma-btn buyma-btn-blue" type="button" onClick={onClose}>확인</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label>{label}</label>
      {children}
    </div>
  );
}

function BrandManualPicker({
  disabled,
  value,
  onSelect,
}: {
  disabled: boolean;
  value: string;
  onSelect: (brand: BuymaBrandOption) => void;
}) {
  const [state, setState] = useState({ value, open: false, search: "" });
  const open = state.value === value ? state.open : false;
  const search = state.value === value ? state.search : "";
  const normalizedSearch = normalizeBrandPickerSearch(search);
  const visibleBrands = BUYMA_BRAND_OPTIONS.filter(
    (brand) => !normalizedSearch || brand.searchText.includes(normalizedSearch),
  ).slice(0, 100);

  function closeMenu() {
    setState({ value, open: false, search: "" });
  }

  function selectBrand(brand: BuymaBrandOption) {
    onSelect(brand);
    setState({ value: brand.id, open: false, search: "" });
  }

  return (
    <div
      className="buyma-brand-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      <button
        type="button"
        className="buyma-btn buyma-btn-sm buyma-btn-orange"
        disabled={disabled}
        onClick={() => setState({ value, open: !open, search })}
      >
        브랜드 수동선택
      </button>
      {open ? (
        <div className="buyma-brand-menu">
          <input
            type="search"
            autoFocus
            value={search}
            placeholder="브랜드명 또는 ID 검색"
            onChange={(event) => setState({ value, open: true, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeMenu();
            }}
          />
          <div className="buyma-brand-options" role="listbox">
            {visibleBrands.length ? (
              visibleBrands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  className={brand.id === value ? "active" : ""}
                  role="option"
                  aria-selected={brand.id === value}
                  onClick={() => selectBrand(brand)}
                >
                  <span>{brand.displayName}</span>
                  <span>{brand.id}</span>
                </button>
              ))
            ) : (
              <div className="buyma-brand-empty">검색 결과 없음</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeBrandPickerSearch(value: string) {
  return cleanText(value)
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function CategorySearchInput({
  value,
  required,
  onChange,
}: {
  value: string;
  required?: boolean;
  onChange: (category: string) => void;
}) {
  const selectedOption = BUYMA_CATEGORY_SEARCH_OPTIONS.find((option) => option.id === value);
  const selectedDisplay = value ? selectedOption?.display ?? "" : "";
  const [state, setState] = useState({ value, open: false, search: "" });
  const open = state.value === value ? state.open : false;
  const search = state.value === value ? state.search : "";
  const normalizedSearch = search.trim().toLowerCase();
  const visibleOptions = BUYMA_CATEGORY_SEARCH_OPTIONS.filter(
    (category) => category.id && (!normalizedSearch || category.searchText.includes(normalizedSearch)),
  );

  function toggleMenu() {
    setState({ value, open: !open, search });
  }

  function closeMenu() {
    setState({ value, open: false, search: "" });
  }

  function selectCategory(categoryId: string) {
    onChange(categoryId);
    setState({ value: categoryId, open: false, search: "" });
  }

  return (
    <div
      className="buyma-category-combo"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      <button
        type="button"
        className={`buyma-category-control ${required ? "buyma-required-red" : ""}`}
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <span>{selectedDisplay || "카테고리 선택"}</span>
        <span className="buyma-category-arrow">▾</span>
      </button>
      {open ? (
        <div className="buyma-category-menu">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(event) => setState({ value, open: true, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeMenu();
            }}
          />
          <div className="buyma-category-options" role="listbox">
            {visibleOptions.length ? (
              visibleOptions.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={category.id === value ? "active" : ""}
                  role="option"
                  aria-selected={category.id === value}
                  onClick={() => selectCategory(category.id)}
                >
                  {category.display}
                </button>
              ))
            ) : (
              <div className="buyma-category-empty">검색 결과 없음</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatCategoryDisplay(label: string) {
  const parts = label.split(" > ");
  if (parts.length < 2) return label;

  const name = parts[parts.length - 1];
  const path = parts.slice(0, -1).join("/");
  return `${name}[${path}]`;
}

function EditorSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="buyma-editor-section">
      <label className="buyma-editor-label">{label}</label>
      {children}
    </div>
  );
}

function FileInput({ onLoad }: { onLoad: (dataUrl: string) => void }) {
  return (
    <input
      type="file"
      accept="image/*"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void readFile(file).then(onLoad);
      }}
    />
  );
}

function removeEditedImageFromImages(images: string[], previousEditedImage?: string, nextEditedImage?: string) {
  const editedImages = new Set([previousEditedImage, nextEditedImage].map((image) => cleanText(image)).filter(Boolean));
  if (!editedImages.size) return images.filter(Boolean);
  return images.filter((image) => image && !editedImages.has(cleanText(image)));
}

function filterRemovedImages(images: string[], removedImageUrls: string[] | undefined, editedImage?: string) {
  const removed = new Set((removedImageUrls ?? []).map((image) => cleanText(image)).filter(Boolean));
  const sourceImages = removeEditedImageFromImages(images, editedImage);
  if (!removed.size) return sourceImages;
  return sourceImages.filter((image) => !removed.has(cleanText(image)));
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`buyma-top-tab ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function CsvTable({
  csv,
  edits,
  onCellChange,
  renderRowAction,
}: {
  csv: string;
  edits?: CsvCellEdits;
  onCellChange?: (rowIndex: number, cellIndex: number, value: string) => void;
  renderRowAction?: (rowIndex: number) => ReactNode;
}) {
  const rows = csvToRows(csv);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const hasRowAction = Boolean(renderRowAction);
  const editable = Boolean(onCellChange);

  return (
    <div className="buyma-csv-table-wrap">
      <table className="buyma-csv-preview-table">
        <thead>
          <tr>
            {hasRowAction && <th className="buyma-csv-action-cell"></th>}
            {headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {body.length ? body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {hasRowAction && <td className="buyma-csv-action-cell">{renderRowAction?.(rowIndex)}</td>}
              {headers.map((_, cellIndex) => {
                const value = edits?.[getCsvEditKey(rowIndex, cellIndex)] ?? row[cellIndex] ?? "";
                return (
                  <td key={cellIndex}>
                    {editable ? (
                      <input
                        className="buyma-csv-cell-input"
                        value={value}
                        onChange={(event) => onCellChange?.(rowIndex, cellIndex, event.target.value)}
                      />
                    ) : value}
                  </td>
                );
              })}
            </tr>
          )) : (
            <tr>
              <td className="buyma-empty-row" colSpan={headers.length + (hasRowAction ? 1 : 0)}>
                CSV 데이터 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BuymaSearchSizeSelect({
  categoryId,
  size,
  value,
  onChange,
}: {
  categoryId?: string;
  size: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = getBuymaSizeOptions(categoryId);
  const resolvedValue = value || resolveBuymaSizeTypeId(categoryId, size);
  const selectedOption = options.find((option) => option.id === resolvedValue);
  const visibleOptions = selectedOption || !resolvedValue
    ? options
    : [{ id: resolvedValue, name: size, label: `${resolvedValue}-${size}` }, ...options];

  return (
    <select value={resolvedValue} onChange={(event) => onChange(event.target.value)}>
      <option value="">-</option>
      {visibleOptions.map((option) => (
        <option key={`${option.id}-${option.name}`} value={option.id}>
          {formatBuymaSizeOption(option.id, option.name)}
        </option>
      ))}
    </select>
  );
}

function buildColorSizeRows(product: ProductDraft | null): ColorSizeRow[] {
  if (!product) return [];
  if (product.sizeTableData?.length) {
    return product.sizeTableData.filter((row) => isUsableProductSize(product, row.size));
  }
  const colors = product.colors.length ? product.colors : ["FREE"];
  const sizes = product.sizes.length ? product.sizes : ["FREE"];

  return colors.flatMap((color) =>
    sizes.map((size) => ({
      color,
      colorSystemId: product.colorSystemMap?.[color] || getColorSystemId(color) || product.colorSystemId || "",
      size,
      sizeTypeId: resolveBuymaSizeTypeId(product.category, size),
      supplement: "",
      stock: findProductStockStatus(product, color, size),
    })),
  );
}

function isUsableProductSize(product: ProductDraft | null, value: unknown) {
  const size = cleanText(value).toUpperCase();
  if (!size || /^(TRUE|FALSE|NULL|UNDEFINED)$/.test(size)) return false;
  const isKnownProductSize = isKnownCollectedSize(product, size);
  const hasAlphaSize = product?.sizes.some((item) => /[A-Z]/i.test(cleanText(item))) ?? false;
  if (/^\d{1,2}$/.test(size) && hasAlphaSize && !isKnownProductSize) return false;
  if (/^\d{1,2}$/.test(size) && product?.category && !resolveBuymaSizeTypeId(product.category, size) && !isKnownProductSize) return false;
  return true;
}

function isKnownCollectedSize(product: ProductDraft | null, size: string) {
  if (!product) return false;
  if (product.sizes.some((item) => cleanText(item).toUpperCase() === size)) return true;
  if (Object.keys(product.sizeMeasurements ?? {}).some((item) => cleanText(item).toUpperCase() === size)) return true;
  return [product.stockData, product.optionStockMap].some((stockMap) =>
    Object.keys(stockMap ?? {}).some((key) => cleanText(key.split("|")[1] ?? "").toUpperCase() === size),
  );
}

function getColorDetailRows(product: ProductDraft | null, rows: ColorSizeRow[]) {
  const colorMap = new Map<string, string>();

  rows.forEach((row) => {
    if (!row.color || colorMap.has(row.color)) return;
    colorMap.set(row.color, row.colorSystemId || getColorSystemId(row.color) || "");
  });

  product?.colors.forEach((color) => {
    if (!color || colorMap.has(color)) return;
    colorMap.set(color, product.colorSystemMap?.[color] || getColorSystemId(color) || product.colorSystemId || "");
  });

  return [...colorMap.entries()].map(([color, colorSystemId]) => ({ color, colorSystemId }));
}

function findProductStockStatus(product: ProductDraft, color: string, size: string): StockStatus {
  const sizeKey = size.toUpperCase();
  const keys = [
    `${color}|${sizeKey}`,
    `${color}|${size}`,
    `|${sizeKey}`,
    color,
  ];

  for (const source of [product.stockData, product.optionStockMap]) {
    if (!source) continue;
    const foundKey = keys.find((key) => source[key]);
    if (foundKey) return normalizeStockStatus(source[foundKey]) as StockStatus;
  }

  return normalizeStockStatus(product.stockStatus) as StockStatus;
}

function getBuymaSizeOptions(categoryId?: string): BuymaSizeOption[] {
  const category = cleanText(categoryId);
  if (!category) return [];

  return BUYMA_SIZES
    .filter((entry) => entry.categoryId === category)
    .map((entry) => ({ id: entry.id, name: entry.name, label: entry.label }));
}

function resolveBuymaSizeTypeId(categoryId: unknown, size: unknown) {
  const category = cleanText(categoryId);
  const normalizedSize = normalizeBuymaSizeName(size);
  if (!category || !normalizedSize) return "";

  const categorySizes = BUYMA_SIZES.filter((entry) => entry.categoryId === category);
  if (!categorySizes.length) return "0";

  const matched = categorySizes.find((entry) => normalizeBuymaSizeName(entry.name) === normalizedSize);
  return matched?.id ?? "0";
}

function normalizeBuymaSizeName(value: unknown) {
  const size = cleanText(value).toUpperCase().replace(/\s+/g, "");
  if (!size) return "";
  if (["XXS", "XS"].includes(size)) return "XS以下";
  if (["XL", "XXL", "XXXL", "2XL", "3XL", "4XL"].includes(size)) return "XL以上";
  return size;
}

function formatBuymaSizeOption(id: string, name: string) {
  const normalized = normalizeBuymaSizeName(name);
  if (normalized === "XS以下") return `${id}-XS以下`;
  if (normalized === "XL以上") return `${id}-XL以上`;
  return `${id}-${name}`;
}

async function uploadAllProductImages(
  products: ProductDraft[],
  settings: BuymaSettings,
  setStatus: (status: string) => void,
) {
  if (!settings.imgbbApiKey || !settings.imageServerUrl || !settings.imageServerApiKey) {
    throw new Error("이미지 업로드 설정을 입력하세요.");
  }

  let completedCount = 0;
  setStatus(`이미지 업로드 준비 중: ${products.length}개 상품`);

  return mapWithConcurrency(
    products.map((product, productIndex) => ({ product, productIndex })),
    IMAGE_UPLOAD_CONCURRENCY,
    async ({ product, productIndex }) => {
      const uploaded = await uploadProductImages(product, productIndex, settings);
      completedCount += 1;
      setStatus(`이미지 업로드 중 ${completedCount}/${products.length}개 완료`);
      return uploaded;
    },
  );
}

function hasProductEditedImage(product: ProductDraft) {
  return Boolean(cleanText(product.editedImage));
}

function findMissingEditedImageUploadIndex(products: ProductDraft[]) {
  return products.findIndex((product) =>
    hasProductEditedImage(product) && !cleanText(product.uploadedImageUrls?.[0]),
  );
}

async function uploadProductImages(
  product: ProductDraft,
  productIndex: number,
  settings: BuymaSettings,
) {
  const sourceImages = product.images
    .filter((image) => image && image !== product.editedImage)
    .slice(0, product.editedImage ? 19 : 20);
  const requiredIndexes = getRequiredUploadedImageIndexes(product, sourceImages);
  if (requiredIndexes.length > 0 && requiredIndexes.every((index) => product.uploadedImageUrls?.[index])) {
    return product;
  }

  const uploadedImageUrls = [...(product.uploadedImageUrls ?? [])];

  if (product.editedImage && !uploadedImageUrls[0]) {
    const editedUrl = await uploadBase64ToImgbb(
      product.editedImage,
      settings.imgbbApiKey,
      `${product.productCode || productIndex}_edited`,
    );
    if (editedUrl) uploadedImageUrls[0] = editedUrl;
  }

  const pendingSourceImages = sourceImages
    .map((url, index) => ({
      url,
      index: product.editedImage ? index + 2 : index + 1,
    }))
    .filter((image) => !uploadedImageUrls[image.index - 1]);

  if (pendingSourceImages.length > 0) {
    const sku = product.skuNumber || product.productCode || `product_${productIndex + 1}`;
    const imageBatches = chunkList(pendingSourceImages, IMAGE_UPLOAD_BATCH_SIZE);

    for (const images of imageBatches) {
      const response = await fetchImageUploadBatch(settings, {
        sku,
        imgbbApiKey: settings.imgbbApiKey,
        images,
      });

    if (!response.ok) throw new Error(`이미지 Worker 오류: HTTP ${response.status}`);
      const data = (await response.json()) as { results?: Array<{ index: number; url?: string }> };
      data.results?.forEach((item) => {
        if (item.url) uploadedImageUrls[item.index - 1] = item.url;
      });
    }
  }

  return { ...product, uploadedImageUrls };
}

async function fetchImageUploadBatch(
  settings: BuymaSettings,
  body: {
    sku: string;
    imgbbApiKey: string;
    images: Array<{ url: string; index: number }>;
  },
) {
  const url = `${settings.imageServerUrl.replace(/\/$/, "")}/upload-batch`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= IMAGE_UPLOAD_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": settings.imageServerApiKey,
        },
        body: JSON.stringify(body),
      });

      if (response.ok || !isRetryableImageUploadStatus(response.status) || attempt === IMAGE_UPLOAD_RETRY_COUNT) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === IMAGE_UPLOAD_RETRY_COUNT) throw error;
    }

    await wait(IMAGE_UPLOAD_RETRY_DELAY_MS * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error("?대?吏 Worker ?붿껌???ㅽ뙣?덉뒿?덈떎.");
}

function isRetryableImageUploadStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function chunkList<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function getRequiredUploadedImageIndexes(product: ProductDraft, sourceImages: string[]) {
  return [
    ...(product.editedImage ? [0] : []),
    ...sourceImages.map((_, index) => product.editedImage ? index + 1 : index),
  ];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function uploadBase64ToImgbb(base64Data: string, apiKey: string, imageName: string) {
  const normalizedApiKey = cleanText(apiKey);
  if (!normalizedApiKey) throw new Error("imgBB API Key가 비어 있습니다.");

  const formData = new FormData();
  formData.append("image", base64Data.includes(",") ? base64Data.split(",").pop() || "" : base64Data);
  formData.append("name", imageName);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(normalizedApiKey)}`, {
    method: "POST",
    body: formData,
  });

  const data = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: { display_url?: string; url?: string };
    error?: { message?: string; code?: number };
  } | null;
  if (!response.ok || !data?.success) {
    throw new Error(`imgBB 업로드 실패: ${formatImgBbError(data, response.status)}`);
  }

  const uploadedUrl = data.data?.display_url || data.data?.url || "";
  if (!uploadedUrl) throw new Error("imgBB 업로드 실패: 응답에 이미지 URL이 없습니다.");
  return uploadedUrl;
}

function formatImgBbError(
  data: { error?: { message?: string; code?: number } } | null,
  status: number,
) {
  const message = cleanText(data?.error?.message);
  const code = data?.error?.code;
  return message ? `${message}${code ? ` (${code})` : ""}` : `HTTP ${status}`;
}

async function ensureEnglishProductTitle(product: ProductDraft, prefix = ""): Promise<ProductDraft> {
  const existingEnglish = cleanText(product.titleEn);
  if (product.site === "thenorthfacekorea.co.kr" && existingEnglish) {
    return { ...product, title: formatCollectedTitleWithBrand(product, existingEnglish, prefix), titleEn: existingEnglish };
  }

  const sourceTitle = cleanText(product.titleKo || product.title);
  if (!sourceTitle) return product;

  try {
    const translated = await translateText(sourceTitle, "en");
    return { ...product, title: formatCollectedTitleWithBrand(product, translated, prefix), titleEn: translated };
  } catch {
    const fallback = existingEnglish || stripKoreanText(product.title || product.titleKo) || "Fashion Item";
    return { ...product, title: formatCollectedTitleWithBrand(product, fallback, prefix), titleEn: fallback };
  }
}

function formatCollectedTitleWithBrand(product: ProductDraft, title: string, prefix = "") {
  const titlePrefix = normalizeTitlePart(prefix);
  const sourceTitle = normalizeTitlePart(title);
  if (!sourceTitle) return sourceTitle;

  const brand = resolveProductTitleBrand(product, sourceTitle);
  const cleanedTitle = removeProductTitleNoise(sourceTitle);
  const rawProductName =
    stripTitlePrefix(stripBrandFromTitle(cleanedTitle, brand), titlePrefix) ||
    stripTitlePrefix(cleanedTitle, titlePrefix) ||
    "Fashion Item";
  const productName =
    product.site === "thenorthfacekorea.co.kr" ? appendProductCodeToTitle(rawProductName, product.productCode) : rawProductName;

  return joinTitleParts(brand ? `[${brand}]` : "", titlePrefix, appendColorCountToTitle(productName, product));
}

async function ensureJapaneseProductDescription(
  product: ProductDraft,
  descriptionPrefix = "",
  placement: BuymaDescriptionPlacement = "before",
): Promise<ProductDraft> {
  const staticDescription = getJapaneseBrandDescription(product);
  const sourceDescription = normalizeDescriptionLines(product.descriptionKo);

  if (shouldKeepRawColorSizeSupplement(product)) {
    return ensureJapaneseProductDescriptionWithRawColorSizeSupplement(
      product,
      sourceDescription,
      staticDescription,
      descriptionPrefix,
      placement,
    );
  }

  if (staticDescription) {
    const extraSourceDescription =
      extractAdditionalDescriptionBlock(sourceDescription) ||
      splitColorSizeSupplementFromDescription(sourceDescription).colorSizeSupplement;
    if (!extraSourceDescription) {
      return applyColorSizeSupplementFromDescription(
        product,
        staticDescription,
        descriptionPrefix,
        placement,
      );
    }

    try {
      const translatedExtra = await translateMultilineText(extraSourceDescription, "ja");
      return applyColorSizeSupplementFromDescription(
        product,
        joinDescriptionBlocks(staticDescription, translatedExtra),
        descriptionPrefix,
        placement,
      );
    } catch {
      return applyColorSizeSupplementFromDescription(
        product,
        joinDescriptionBlocks(staticDescription, extraSourceDescription),
        descriptionPrefix,
        placement,
      );
    }
  }

  if (!sourceDescription) {
    return applyColorSizeSupplementFromDescription(product, "", descriptionPrefix, placement);
  }

  try {
    const translated = await translateMultilineText(sourceDescription, "ja");
    return applyColorSizeSupplementFromDescription(product, translated, descriptionPrefix, placement);
  } catch {
    return applyColorSizeSupplementFromDescription(product, sourceDescription, descriptionPrefix, placement);
  }
}

async function ensureJapaneseProductDescriptionWithRawColorSizeSupplement(
  product: ProductDraft,
  sourceDescription: string,
  staticDescription: string,
  descriptionPrefix = "",
  placement: BuymaDescriptionPlacement = "before",
): Promise<ProductDraft> {
  const separatedSource = splitColorSizeSupplementFromDescription(sourceDescription);
  const productWithRawSupplement = {
    ...product,
    colorSizeSupplement: mergeColorSizeSupplement(product.colorSizeSupplement, separatedSource.colorSizeSupplement),
  };

  if (staticDescription) {
    if (!separatedSource.description) {
      return applyColorSizeSupplementFromDescription(
        productWithRawSupplement,
        staticDescription,
        descriptionPrefix,
        placement,
      );
    }

    try {
      const translatedDescription = await translateMultilineText(separatedSource.description, "ja");
      return applyColorSizeSupplementFromDescription(
        productWithRawSupplement,
        joinDescriptionBlocks(staticDescription, translatedDescription),
        descriptionPrefix,
        placement,
      );
    } catch {
      return applyColorSizeSupplementFromDescription(
        productWithRawSupplement,
        joinDescriptionBlocks(staticDescription, separatedSource.description),
        descriptionPrefix,
        placement,
      );
    }
  }

  if (!separatedSource.description) {
    return applyColorSizeSupplementFromDescription(productWithRawSupplement, "", descriptionPrefix, placement);
  }

  try {
    const translated = await translateMultilineText(separatedSource.description, "ja");
    return applyColorSizeSupplementFromDescription(productWithRawSupplement, translated, descriptionPrefix, placement);
  } catch {
    return applyColorSizeSupplementFromDescription(productWithRawSupplement, separatedSource.description, descriptionPrefix, placement);
  }
}

function shouldKeepRawColorSizeSupplement(product: ProductDraft) {
  return product.site === "not4nerd.net" || product.site === "999humanity.kr" || product.site === "youthisyours.net";
}

function applyColorSizeSupplementFromDescription(
  product: ProductDraft,
  description: string,
  descriptionPrefix = "",
  placement: BuymaDescriptionPlacement = "before",
): ProductDraft {
  const separated = splitColorSizeSupplementFromDescription(description);

  return {
    ...product,
    description: applyDescriptionPrefix(separated.description, descriptionPrefix, placement),
    colorSizeSupplement: mergeColorSizeSupplement(product.colorSizeSupplement, separated.colorSizeSupplement),
  };
}

function mergeColorSizeSupplement(...values: Array<string | undefined>) {
  const blocks = values
    .map((value) => normalizeDescriptionLines(value))
    .filter(Boolean);
  return [...new Set(blocks)].join("\n\n");
}

function extractAdditionalDescriptionBlock(description: string) {
  const marker = "사이즈 상세";
  const index = description.indexOf(marker);
  if (index < 0) return "";
  return description.slice(index).trim();
}

function joinDescriptionBlocks(...blocks: string[]) {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

function getCollectedCsvProducts(products: Array<ProductDraft | null>) {
  return products.filter((product): product is ProductDraft => Boolean(product));
}

function getCollectedCsvProductRows(products: Array<ProductDraft | null>) {
  return products.flatMap((product, index) => (product ? [{ product, index }] : []));
}

function mergeCurrentProductsIntoCsvProducts(
  csvProducts: Array<ProductDraft | null>,
  currentProducts: ProductDraft[],
  currentCsvRowIndexes: number[],
  appendCurrentProducts = false,
) {
  const storedCsvProducts = csvProducts.map((product) => product ? removeEditedImageFromProductImages(product) : product);
  const productsToMerge = currentProducts.map(removeEditedImageFromProductImages);

  if (appendCurrentProducts) {
    return [...storedCsvProducts, ...productsToMerge];
  }

  if (currentCsvRowIndexes.length > productsToMerge.length) {
    const replaceIndexes = currentCsvRowIndexes.slice(0, productsToMerge.length);
    const removeIndexes = new Set(currentCsvRowIndexes.slice(productsToMerge.length));
    const merged = [...storedCsvProducts];

    productsToMerge.forEach((product, index) => {
      merged[replaceIndexes[index]] = product;
    });

    return merged.filter((_, index) => !removeIndexes.has(index));
  }

  if (currentCsvRowIndexes.length === productsToMerge.length) {
    const merged = [...storedCsvProducts];
    productsToMerge.forEach((product, index) => {
      merged[currentCsvRowIndexes[index]] = product;
    });
    return merged;
  }

  return [...storedCsvProducts, ...productsToMerge];
}

function removeEditedImageFromProductImages(product: ProductDraft) {
  const images = removeEditedImageFromImages(product.images, product.editedImage);
  if (images.length === product.images.length && images.every((image, index) => image === product.images[index])) {
    return product;
  }
  return { ...product, images };
}

function getCurrentCsvRowIndexesAfterMerge(
  csvProductCount: number,
  currentProductCount: number,
  currentCsvRowIndexes: number[],
  appendCurrentProducts = false,
) {
  if (appendCurrentProducts) {
    return Array.from({ length: currentProductCount }, (_, index) => csvProductCount + index);
  }

  if (currentCsvRowIndexes.length > currentProductCount) {
    return currentCsvRowIndexes.slice(0, currentProductCount);
  }

  if (currentCsvRowIndexes.length === currentProductCount) return currentCsvRowIndexes;
  return Array.from({ length: currentProductCount }, (_, index) => csvProductCount + index);
}

function getRemovedCurrentCsvRowIndexes(currentCsvRowIndexes: number[], currentProductCount: number) {
  return currentCsvRowIndexes.length > currentProductCount
    ? currentCsvRowIndexes.slice(currentProductCount)
    : [];
}

function shouldAppendCurrentProductsAsUnisexVariant(
  products: ProductDraft[],
  manualProductFields: Record<number, ProductDirtyFields>,
  currentCsvRowIndexes: number[],
) {
  if (products.length !== 1 || currentCsvRowIndexes.length !== 1) return false;

  const product = products[0];
  const dirtyFields = manualProductFields[0] ?? {};
  return Boolean(product?.unisex && dirtyFields.unisex);
}

function applyUnisexVariantSku(
  products: ProductDraft[],
  csvProducts: Array<ProductDraft | null>,
) {
  const existingSkus = new Set(
    getCollectedCsvProducts(csvProducts).map((product) => cleanText(product.skuNumber)).filter(Boolean),
  );

  return products.map((product, index) => {
    const skuNumber = makeUnisexVariantSku(product, index, existingSkus);
    existingSkus.add(skuNumber);
    return { ...product, skuNumber };
  });
}

function makeUnisexVariantSku(
  product: ProductDraft,
  index: number,
  existingSkus: Set<string>,
) {
  const categoryGender = getBuymaCategoryGender(product.category);
  const suffix = categoryGender === "men" ? "M" : categoryGender === "women" ? "W" : "U";
  const currentSku = cleanText(product.skuNumber) || makeSku(index, product.productCode);
  const baseSku = currentSku.replace(/-(?:M|W|U)(?:-\d+)?$/i, "");
  const candidate = `${baseSku}-${suffix}`;

  if (!existingSkus.has(candidate)) return candidate;

  let counter = 2;
  while (existingSkus.has(`${candidate}-${counter}`)) counter += 1;
  return `${candidate}-${counter}`;
}

function countCsvDataRows(csv: string) {
  return Math.max(0, csvToRows(csv).length - 1);
}

function applyCsvEditsToBundle(
  bundle: ReturnType<typeof generateBuymaCsvBundle>,
  edits: Record<CsvTableKey, CsvCellEdits>,
) {
  return {
    itemsCsv: applyCsvEdits(bundle.itemsCsv, edits.items),
    colorSizesCsv: applyCsvEdits(bundle.colorSizesCsv, edits.colorSizes),
  };
}

function applyCsvEdits(csv: string, edits: CsvCellEdits) {
  if (Object.keys(edits).length === 0) return csv;

  const rows = csvToRows(csv);
  const preserveNewlineColumns = getPreserveNewlineColumns(rows[0] ?? []);
  Object.entries(edits).forEach(([key, value]) => {
    const [rowIndex, cellIndex] = parseCsvEditKey(key);
    const targetRowIndex = rowIndex + 1;
    if (!rows[targetRowIndex] || cellIndex < 0) return;
    rows[targetRowIndex][cellIndex] = value;
  });

  return rowsToCsv(rows, preserveNewlineColumns);
}

function getPreserveNewlineColumns(headers: string[]) {
  return new Set(
    ["商品コメント", "色サイズ補足"]
      .map((header) => headers.indexOf(header))
      .filter((index) => index >= 0),
  );
}

function shiftCsvEditsAfterRowDeletes(edits: CsvCellEdits, deletedRowIndexes: number[]) {
  const deletedRows = new Set(deletedRowIndexes);
  const sortedDeletedRows = [...deletedRows].sort((left, right) => left - right);
  const nextEdits: CsvCellEdits = {};

  Object.entries(edits).forEach(([key, value]) => {
    const [rowIndex, cellIndex] = parseCsvEditKey(key);
    if (deletedRows.has(rowIndex)) return;
    const deletedBeforeCount = sortedDeletedRows.filter((deletedRowIndex) => deletedRowIndex < rowIndex).length;
    const nextRowIndex = rowIndex - deletedBeforeCount;
    nextEdits[getCsvEditKey(nextRowIndex, cellIndex)] = value;
  });

  return nextEdits;
}

function getCsvEditKey(rowIndex: number, cellIndex: number) {
  return `${rowIndex}:${cellIndex}`;
}

function parseCsvEditKey(key: string) {
  const [rowIndex, cellIndex] = key.split(":").map((value) => Number.parseInt(value, 10));
  return [Number.isFinite(rowIndex) ? rowIndex : -1, Number.isFinite(cellIndex) ? cellIndex : -1] as const;
}

function csvToRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;

  const pushRow = () => {
    row.push(current);
    if (row.length > 1) rows.push(row);
    row = [];
    current = "";
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      pushRow();
    } else {
      current += char;
    }
  }

  if (current || row.length) pushRow();
  return rows;
}

function rowsToCsv(rows: string[][], preserveNewlineColumns = new Set<number>()) {
  return rows
    .map((row) =>
      row
        .map((value, columnIndex) => sanitizeCsvCell(value, preserveNewlineColumns.has(columnIndex)))
        .join(","),
    )
    .join("\n");
}

function sanitizeCsvCell(value: unknown, preserveNewlines = false) {
  if (!preserveNewlines) return sanitizeForCsv(value);

  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") return "";
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function findProductCollectionValidationIssue(products: ProductDraft[]) {
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const fields: string[] = [];
    const category = cleanText(product.category);
    const season = cleanText(product.season);
    const titleOverLimit = countBuymaTitleCharacters(product.title) > BUYMA_TITLE_MAX_LENGTH;
    const sizeSupplementMismatch = getSizeSupplementMismatch(product);
    const brandConsistencyIssues = getBrandConsistencyIssues(product);

    if (!isRequiredText(product.title)) {
      fields.push("상품명");
    }
    if (!isValidSellingPrice(product.sellingPrice)) {
      fields.push("판매가격");
    }
    if (!isRequiredText(product.brand)) {
      fields.push("브랜드명");
    }
    if (!isValidBuymaBrandId(product.brandId)) {
      fields.push("브랜드 ID");
    }
    if (!isRequiredText(getModelNumberInputValue(product))) {
      fields.push("품번");
    }
    if (!isValidBuymaCategory(category)) {
      fields.push("카테고리");
    }
    if (titleOverLimit) {
      fields.push("상품명 60자 초과");
    }
    if (await hasBrokenProductImage(product.images)) {
      fields.push("이상한 이미지");
    }
    if (hasSizeSupplementMismatchIssue(sizeSupplementMismatch)) {
      fields.push("사이즈상세/色サイズ補足 사이즈 불일치");
    }
    fields.push(...brandConsistencyIssues);
    if (!isValidBuymaSeason(season)) fields.push("시즌");
    if (fields.length) return { index, fields };
  }

  return null;
}

function getBrandConsistencyIssues(product: ProductDraft) {
  const issues: string[] = [];
  const brandText = cleanText(product.brand || product.brandDisplayName);
  const brandId = cleanText(product.brandId);
  const titleBrand = cleanText(extractBracketBrand(product.title));

  if (brandText && brandId && brandId !== "0") {
    const brandById = BUYMA_BRAND_OPTIONS.find((brand) => brand.id === brandId);
    if (!brandById || !doesBrandTextMatchOption(brandText, brandById)) {
      issues.push("브랜드명과 브랜드 ID 불일치");
    }
  }

  if (titleBrand && brandText && !areSameBrandReference(titleBrand, brandText)) {
    issues.push("상품명 [브랜드]와 브랜드명 불일치");
  }

  return issues;
}

function doesBrandTextMatchOption(value: string, brand: BuymaBrandOption) {
  const resolved = findBuymaBrand(value);
  if (resolved) return resolved.id === brand.id;

  const normalized = normalizeBrandComparisonText(value);
  return [brand.name, brand.nameJp, brand.displayName].some(
    (candidate) => normalizeBrandComparisonText(candidate) === normalized,
  );
}

function areSameBrandReference(left: string, right: string) {
  const leftBrand = findBuymaBrand(left);
  const rightBrand = findBuymaBrand(right);
  if (leftBrand && rightBrand) return leftBrand.id === rightBrand.id;

  const normalizedLeft = normalizeBrandComparisonText(left);
  const normalizedRight = normalizeBrandComparisonText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeBrandComparisonText(value: string) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

async function hasBrokenProductImage(images: string[] | undefined) {
  const results = await Promise.all((images ?? []).filter(Boolean).map(checkImageLoadable));
  return results.some((isLoadable) => !isLoadable);
}

function checkImageLoadable(src: string) {
  return new Promise<boolean>((resolve) => {
    if (!src) {
      resolve(false);
      return;
    }
    const image = new Image();
    let settled = false;
    const finish = (isLoadable: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(isLoadable);
    };
    const timeout = window.setTimeout(() => finish(false), 6000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

function isValidSellingPrice(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

function isRequiredText(value: unknown) {
  return Boolean(cleanText(value));
}

function isValidBuymaBrandId(value: unknown) {
  const text = cleanText(value);
  return Boolean(text) && text !== "0";
}

function getModelNumberInputValue(product: ProductDraft | null | undefined) {
  return product?.modelNumber ?? product?.productCode ?? "";
}

function getSizeSupplementMismatch(product: ProductDraft | null | undefined): SizeSupplementMismatch {
  if (!product) return { missingInSupplement: [], missingInDetail: [], missingInDetailByColor: [] };

  const detailRows = buildColorSizeRows(product);
  const detailSizes = getUniqueComparableSizes(detailRows.map((row) => row.size));
  const supplementSizes = extractColorSizeSupplementSizes(product.colorSizeSupplement);

  if (!detailSizes.length && !supplementSizes.length) {
    return { missingInSupplement: [], missingInDetail: [], missingInDetailByColor: [] };
  }

  if (!supplementSizes.length && isSingleOneSizeDetail(detailSizes)) {
    return { missingInSupplement: [], missingInDetail: [], missingInDetailByColor: [] };
  }

  const detailSet = new Set(detailSizes);
  const supplementSet = new Set(supplementSizes);
  const detailGroups = getSizeDetailGroupsByColor(detailRows);
  const missingInDetailByColor = detailGroups.length > 1 ? detailGroups
    .filter((group) => group.sizes.length > 0)
    .map((group) => ({
      color: group.color,
      sizes: supplementSizes.filter((size) => !group.sizes.includes(size)),
    }))
    .filter((group) => group.sizes.length > 0) : [];

  return {
    missingInSupplement: detailSizes.filter((size) => !supplementSet.has(size)),
    missingInDetail: supplementSizes.filter((size) => !detailSet.has(size)),
    missingInDetailByColor,
  };
}

function hasSizeSupplementMismatchIssue(mismatch: SizeSupplementMismatch) {
  return mismatch.missingInSupplement.length > 0 ||
    mismatch.missingInDetail.length > 0 ||
    mismatch.missingInDetailByColor.length > 0;
}

function formatSizeSupplementMismatchMessage(mismatch: SizeSupplementMismatch) {
  const messages: string[] = [];
  if (mismatch.missingInSupplement.length) {
    messages.push(`色サイズ補足에 없는 사이즈: ${mismatch.missingInSupplement.join(", ")}`);
  }
  if (mismatch.missingInDetail.length) {
    messages.push(`사이즈상세에 없는 사이즈: ${mismatch.missingInDetail.join(", ")}`);
  }
  mismatch.missingInDetailByColor.forEach((item) => {
    messages.push(`${item.color}에 없는 사이즈: ${item.sizes.join(", ")}`);
  });
  return messages.join(" / ");
}

function getSizeDetailGroupsByColor(rows: ColorSizeRow[]) {
  const groups = new Map<string, { color: string; sizes: string[] }>();

  rows.forEach((row) => {
    const color = cleanText(row.color) || "FREE";
    const colorKey = normalizeComparableColor(color);
    const size = normalizeComparableSize(row.size);
    if (!colorKey || !isComparableProductSize(size)) return;

    const group = groups.get(colorKey) ?? { color, sizes: [] };
    if (!group.sizes.includes(size)) group.sizes.push(size);
    groups.set(colorKey, group);
  });

  return [...groups.values()];
}

function normalizeComparableColor(value: unknown) {
  return cleanText(value).toUpperCase();
}

function getUniqueComparableSizes(values: Array<unknown>) {
  return uniqueTextList(values.map(normalizeComparableSize).filter(Boolean));
}

function extractColorSizeSupplementSizes(value: unknown) {
  const lines = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);
  const sizes: string[] = [];

  lines.forEach((line) => {
    const explicitSize = line.match(/^(.+?)\s+SIZE$/i)?.[1];
    if (explicitSize) {
      sizes.push(explicitSize);
      return;
    }

    const labeledSize = line.match(/^([A-Z0-9./+-]{1,16})\s*[-:]\s*(?=.*\d)/i)?.[1];
    if (labeledSize) {
      sizes.push(labeledSize);
      return;
    }

    const tabularSize = line.match(/^([A-Z0-9./+-]{1,16})\s+(?:-?\d+(?:\.\d+)?\s*(?:CM|MM)?\s*){2,}$/i)?.[1];
    if (tabularSize) sizes.push(tabularSize);
  });

  return getUniqueComparableSizes(sizes).filter(isComparableProductSize);
}

function normalizeComparableSize(value: unknown) {
  const text = cleanText(value)
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+SIZE$/i, "")
    .trim()
    .toUpperCase();

  if (!text) return "";
  if (/^(FREE SIZE|ONE SIZE|ONESIZE|OS|O\/S)$/.test(text)) return "FREE";
  return text;
}

function isComparableProductSize(value: string) {
  const size = normalizeComparableSize(value);
  if (!size) return false;
  if (/^(SIZE|GUIDE|SIZE GUIDE|LENGTH|TOTAL|CHEST|BUST|WAIST|HIP|HEM|SHOULDER|SLEEVE|ARM|CROTCH|RISE|BOTTOM|THIGH|WIDTH|HEIGHT|COLOR|COLOUR|MODEL)$/.test(size)) {
    return false;
  }
  if (/^\d+(?:\.\d+)?(?:CM|MM)?$/.test(size)) return /^\d{2,3}$/.test(size);
  return /^(FREE|XS|S|M|L|XL|XXL|XXXL|[2-9]XL|[A-Z]{1,4}\d{0,3}|\d{1,3})$/.test(size);
}

function isSingleOneSizeDetail(detailSizes: string[]) {
  return detailSizes.length === 1 && detailSizes[0] === "FREE";
}

function isValidBuymaCategory(category: unknown) {
  return isValidBuymaCategoryId(category);
}

function buildUnisexCategoryPatch(product: ProductDraft | null): Partial<ProductDraft> {
  if (!product) return { unisex: true };

  const category = cleanText(product.category);
  const categoryGender = getBuymaCategoryGender(category);

  return {
    unisex: true,
    category: "",
    ...(categoryGender === "men" ? {
      menCategory: category,
      womenCategory: product.womenCategory || getPairedBuymaCategoryId(category, "women"),
    } : {}),
    ...(categoryGender === "women" ? {
      womenCategory: category,
      menCategory: product.menCategory || getPairedBuymaCategoryId(category, "men"),
    } : {}),
  };
}

function buildCategorySelectionPatch(product: ProductDraft | null, category: string): Partial<ProductDraft> {
  const categoryGender = getBuymaCategoryGender(category);

  return {
    category,
    ...(product?.unisex && categoryGender === "men" ? { menCategory: category } : {}),
    ...(product?.unisex && categoryGender === "women" ? { womenCategory: category } : {}),
  };
}

function isValidBuymaSeason(season: unknown) {
  const seasonId = cleanText(season);
  return Boolean(seasonId && BUYMA_SEASONS.some((item) => item.id === seasonId));
}

const BUYMA_LISTING_FIELD_KEYS: Array<keyof ProductDraft> = [
  "title",
  "titleKo",
  "titleEn",
  "translatedTitle",
  "titleManuallyEdited",
  "buymaProductId",
  "skuNumber",
  "price",
  "sellingPrice",
  "referencePrice",
  "control",
  "publicStatus",
  "category",
  "season",
  "theme",
  "unisex",
  "menCategory",
  "womenCategory",
  "tags",
  "purchaseDeadline",
  "purchaseQuantity",
  "shippingMethod",
  "purchaseArea",
  "purchaseCity",
  "purchaseShop",
  "purchaseName1",
  "purchaseUrl1",
  "purchaseSourceDescription1",
  "purchaseName2",
  "purchaseUrl2",
  "purchaseSourceDescription2",
  "purchaseName3",
  "purchaseUrl3",
  "purchaseSourceDescription3",
  "purchaseName4",
  "purchaseUrl4",
  "purchaseSourceDescription4",
  "purchaseName5",
  "purchaseUrl5",
  "purchaseSourceDescription5",
  "purchaseName6",
  "purchaseUrl6",
  "purchaseSourceDescription6",
  "purchaseName7",
  "purchaseUrl7",
  "purchaseSourceDescription7",
  "purchaseName8",
  "purchaseUrl8",
  "purchaseSourceDescription8",
  "purchaseName9",
  "purchaseUrl9",
  "purchaseSourceDescription9",
  "purchaseName10",
  "purchaseUrl10",
  "purchaseSourceDescription10",
  "purchaseName11",
  "purchaseUrl11",
  "purchaseSourceDescription11",
  "purchaseName12",
  "purchaseUrl12",
  "purchaseSourceDescription12",
  "purchaseName13",
  "purchaseUrl13",
  "purchaseSourceDescription13",
  "purchaseName14",
  "purchaseUrl14",
  "purchaseSourceDescription14",
  "purchaseName15",
  "purchaseUrl15",
  "purchaseSourceDescription15",
  "shippingArea",
  "shippingCity",
  "taxIncluded",
  "listingMemo",
  "colorSizeSupplement",
  "editedImage",
  "removedImageUrls",
  "uploadedImageUrls",
];

const COLOR_SIZE_FIELD_KEYS: Array<keyof ProductDraft> = [
  "colors",
  "sizes",
  "sizeMeasurements",
  "sizeChartHtml",
  "sizeTableData",
  "stockData",
  "optionStockMap",
  "colorSystemId",
  "colorSystemMap",
  "stockStatus",
];

async function refreshProductForCollection(
  product: ProductDraft,
  dirtyFields: ProductDirtyFields,
  index: number,
  total: number,
  setStatus: (status: string) => void,
  productDescriptionPrefix: string,
  productDescriptionPlacement: BuymaDescriptionPlacement,
) {
  const sourceUrl = cleanText(product.sourceUrl);
  if (!sourceUrl || product.site === "unknown") return product;

  setStatus(`최신 옵션/재고 재수집 중 ${index + 1}/${total}: ${sourceUrl}`);

  try {
    const response = await fetch("/api/products/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: sourceUrl }),
    });
    const result = (await response.json()) as ExtractProductResponse;
    if (!response.ok || !result.ok) return product;

    const titledProduct = await ensureEnglishProductTitle(result.product);
    const describedProduct = await ensureJapaneseProductDescription(
      titledProduct,
      productDescriptionPrefix,
      productDescriptionPlacement,
    );
    return mergeRefetchedProduct(product, describedProduct, dirtyFields);
  } catch {
    return product;
  }
}

function mergeRefetchedProduct(
  current: ProductDraft,
  fresh: ProductDraft,
  dirtyFields: ProductDirtyFields,
): ProductDraft {
  const merged: ProductDraft = { ...fresh };

  copyDefinedProductFields(merged, current, BUYMA_LISTING_FIELD_KEYS);
  copyDefinedProductFields(merged, current, Object.keys(dirtyFields) as Array<keyof ProductDraft>);

  if (hasDirtyField(dirtyFields, COLOR_SIZE_FIELD_KEYS)) {
    copyDefinedProductFields(merged, current, COLOR_SIZE_FIELD_KEYS);
  }

  if ((dirtyFields.brand || dirtyFields.brandDisplayName) && !dirtyFields.brandId) {
    const buymaBrand = findBuymaBrand(merged.brand || merged.brandDisplayName || merged.title || merged.titleKo);
    if (buymaBrand) {
      merged.brandDisplayName = buymaBrand.displayName;
      merged.brandId = buymaBrand.id;
    }
  }

  if (!dirtyFields.description) {
    merged.description =
      normalizeDescriptionLines(fresh.description) ||
      normalizeDescriptionLines(current.description) ||
      getJapaneseBrandDescription(merged) ||
      "";
  }

  if (!dirtyFields.description || !dirtyFields.colorSizeSupplement) {
    const separated = splitColorSizeSupplementFromDescription(merged.description);
    if (!dirtyFields.description) merged.description = separated.description;
    if (!dirtyFields.colorSizeSupplement) {
      merged.colorSizeSupplement = mergeColorSizeSupplement(merged.colorSizeSupplement, separated.colorSizeSupplement);
    }
  }

  merged.images = filterRemovedImages(merged.images, merged.removedImageUrls, merged.editedImage);

  return merged;
}

function copyDefinedProductFields(
  target: ProductDraft,
  source: ProductDraft,
  keys: Array<keyof ProductDraft>,
) {
  const writableTarget = target as Record<keyof ProductDraft, ProductDraft[keyof ProductDraft]>;
  keys.forEach((key) => {
    const value = source[key];
    if (value !== undefined) writableTarget[key] = value;
  });
}

function hasDirtyField(dirtyFields: ProductDirtyFields, keys: Array<keyof ProductDraft>) {
  return keys.some((key) => dirtyFields[key]);
}

function normalizeProduct(product: ProductDraft, settings: BuymaSettings, index: number): ProductDraft {
  const brandedProduct = applyBuymaBrand(product);
  const sellingPrice = product.sellingPrice || calculateSellingPrice(product.price, settings.marginRate, settings.exchangeRate);
  const colors = resolveProductTitleColors(brandedProduct);
  const productTitle = product.titleManuallyEdited
    ? normalizeTitlePart(product.title) || buildCollectedProductTitle(brandedProduct, settings.productTitlePrefix)
    : buildCollectedProductTitle(brandedProduct, settings.productTitlePrefix);
  const sizeTableData = buildColorSizeRows({ ...brandedProduct, colors });
  const separatedDescription = splitColorSizeSupplementFromDescription(
    brandedProduct.description || getJapaneseBrandDescription(brandedProduct) || "",
  );

  return {
    ...brandedProduct,
    colors,
    title: productTitle,
    titleEn: product.titleManuallyEdited ? product.titleEn : product.titleEn ? productTitle : product.titleEn,
    control: product.control || "下書き",
    publicStatus: product.publicStatus || "下書き",
    theme: product.theme || "184",
    sellingPrice,
    skuNumber: product.skuNumber || makeSku(index, product.productCode),
    sizeTableData,
    colorSystemMap: Object.fromEntries(
      sizeTableData.map((row) => [row.color, row.colorSystemId || getColorSystemId(row.color)]),
    ),
    colorSizeSupplement: mergeColorSizeSupplement(
      brandedProduct.colorSizeSupplement,
      separatedDescription.colorSizeSupplement,
    ),
    description: applyDescriptionPrefix(
      separatedDescription.description,
      settings.productDescriptionPrefix,
      settings.productDescriptionPlacement,
    ),
  };
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

function normalizeDescriptionLines(value: unknown) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyBuymaBrand(product: ProductDraft): ProductDraft {
  const buymaBrand = findBuymaBrand(product.brand || product.brandDisplayName || product.title || product.titleKo);
  if (!buymaBrand) {
    return {
      ...product,
      brandId: product.brandId || "0",
    };
  }

  return {
    ...product,
    brand: product.brand,
    brandDisplayName: buymaBrand.displayName,
    brandId: product.brandId && product.brandId !== "0" ? product.brandId : buymaBrand.id,
  };
}

function buildCollectedProductTitle(product: ProductDraft, prefix: string) {
  const titlePrefix = normalizeTitlePart(prefix);
  const sourceTitle = normalizeTitlePart(product.translatedTitle || product.titleEn || product.title || product.titleKo);
  const brand = resolveProductTitleBrand(product, sourceTitle);
  const bracketedBrand = brand ? `[${brand}]` : "";
  const cleanedTitle = removeProductTitleNoise(sourceTitle);
  const rawProductName =
    stripTitlePrefix(stripBrandFromTitle(cleanedTitle, brand), titlePrefix) ||
    stripTitlePrefix(cleanedTitle, titlePrefix) ||
    "Fashion Item";
  const productName =
    product.site === "thenorthfacekorea.co.kr" ? appendProductCodeToTitle(rawProductName, product.productCode) : rawProductName;

  return joinTitleParts(bracketedBrand, titlePrefix, appendColorCountToTitle(productName, product));
}

function appendProductCodeToTitle(title: string, productCode: unknown) {
  const code = cleanText(productCode).toUpperCase();
  const sourceTitle = normalizeTitlePart(title);
  if (!sourceTitle || !code) return sourceTitle;
  return new RegExp(`(^|\\s)${escapeRegExp(code)}($|\\s)`, "i").test(sourceTitle) ? sourceTitle : `${sourceTitle} ${code}`;
}

function resolveProductTitleBrand(product: ProductDraft, sourceTitle: string) {
  return normalizeTitlePart(product.brand) || normalizeTitlePart(extractBracketBrand(sourceTitle)) || normalizeTitlePart(extractBrand(sourceTitle));
}

function resolveProductTitleColors(product: ProductDraft) {
  const colorCandidates = [
    ...(product.colors ?? []),
    ...(product.sizeTableData?.map((row) => row.color) ?? []),
  ].flatMap((color) => splitListInput(color));
  const explicitColors = colorCandidates.length ? uniqueTextList(colorCandidates.map(convertColorToEnglish)) : [];
  const usefulColors = explicitColors.filter((color) => color && color !== "FREE" && color !== "ONE SIZE" && !isNoiseColorOption(color));
  if (usefulColors.length) return usefulColors;

  const titleColor = extractColorFromTitle(product.title || product.titleKo || product.titleEn || "");
  return titleColor ? [convertColorToEnglish(titleColor)] : [];
}

function isNoiseColorOption(value: string) {
  return /^(W|M|F|WOMEN|WOMAN|MEN|MAN|여성|남성|공용|UNISEX)$/i.test(cleanText(value));
}

function appendColorCountToTitle(title: string, product: ProductDraft) {
  const colorCount = getProductTitleColorCount(product);
  if (colorCount <= 1 || /\(\d+\s*colors?\)\s*$/i.test(title)) return title;
  return `${title} (${colorCount}colors)`;
}

function getProductTitleColorCount(product: ProductDraft) {
  const colorCandidates = [
    ...(product.colors ?? []),
    ...(product.sizeTableData?.map((row) => row.color) ?? []),
  ].flatMap((color) => splitListInput(color));
  const usefulColors = uniqueTextList(colorCandidates.map(convertColorToEnglish)).filter(
    (color) => color && color !== "FREE" && color !== "ONE SIZE" && !isNoiseColorOption(color),
  );

  return usefulColors.length;
}

function stripBrandFromTitle(title: string, brand: string) {
  if (!title) return title;
  if (!brand) {
    return title.replace(new RegExp(`^[\\[【(][^\\]】)]+[\\]】)]\\s*`), "").trim();
  }
  const escapedBrand = escapeRegExp(brand);

  return title
    .replace(new RegExp(`^[\\[【(]?${escapedBrand}[\\]】)]?\\s*[-_:|]*\\s*`, "i"), "")
    .replace(new RegExp(`^[\\[【(][^\\]】)]+[\\]】)]\\s*`), "")
    .trim();
}

function removeProductTitleNoise(title: string) {
  return normalizeTitlePart(title)
    .replace(/\bSize\s*&\s*Reviews\b/gi, " ")
    .replace(/\bMusinsa\b/gi, " ")
    .replace(/\bTemple\b/gi, " ")
    .replace(/\bReviews?\b/gi, " ")
    .replace(/\bSizes?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTitlePrefix(title: string, prefix: string) {
  if (!title || !prefix) return title;
  const escapedPrefix = escapeRegExp(prefix);
  return title.replace(new RegExp(`^${escapedPrefix}\\s+`, "i"), "").trim();
}

function extractColorFromTitle(title: string) {
  const normalized = normalizeTitlePart(title);
  const parenMatch = normalized.match(/\(([^()]{2,30})\)\s*$/);
  if (parenMatch?.[1] && !/\d+\s*colors?/i.test(parenMatch[1])) return parenMatch[1];

  const matches = normalized.match(/\b(BLACK|WHITE|CREAM|IVORY|BEIGE|BROWN|GRAY|GREY|NAVY|BLUE|GREEN|RED|PINK|YELLOW|PURPLE|MINT|KHAKI|ORANGE|SILVER|GOLD)\b/gi);
  return matches?.at(-1) ?? "";
}

function extractBracketBrand(title: string) {
  return title.match(/[【\[(]([^】\])]+)[】\])]/)?.[1] ?? "";
}

function uniqueTextList(values: string[]) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
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
    .replace(/\s*:\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasKoreanText(value: string) {
  return /[가-힣]/.test(value);
}

function hasLatinText(value: string) {
  return /[A-Za-z]/.test(value);
}

function stripKoreanText(value: string) {
  return cleanText(value)
    .replace(/[가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getEnglishBrandName(product: ProductDraft | null) {
  if (!product) return "";
  const matchedById = BUYMA_BRAND_OPTIONS.find((brand) => brand.id === product.brandId);
  const matchedByName = findBuymaBrand(product.brand || product.brandDisplayName || product.title || product.titleKo);
  const candidates = [
    matchedById?.name,
    matchedByName?.name,
    product.brand,
    product.brandDisplayName?.replace(/\(.+\)$/, ""),
  ];
  return normalizeTitlePart(candidates.find((candidate) => hasLatinText(cleanText(candidate))) || "");
}

function getProductBrandLogo(product: ProductDraft | null) {
  return cleanText(product?.brandLogo || product?.brandLogos?.[0] || "");
}

function drawEditorText(
  ctx: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const cleanTitle = normalizeTitlePart(title);
  if (!cleanTitle) return;

  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px Pretendard, Arial, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const titleLines = wrapCanvasText(ctx, cleanTitle, 420, 2);
  titleLines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * Math.round(size * 1.18));
  });
  ctx.restore();
}

async function loadEditorFont(size: number) {
  if (!("fonts" in document)) return;
  await document.fonts.load(`800 ${size}px Pretendard`);
}

function estimateTextWidth(text: string, size: number) {
  return normalizeTitlePart(text).length * size * 0.58;
}

function isPointInBox(
  pointX: number,
  pointY: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return pointX >= x && pointX <= x + width && pointY >= y && pointY <= y + height;
}

function isPointInPlacedResizeHandle(pointX: number, pointY: number, image: EditorPlacedImage) {
  const size = 22;
  return isPointInBox(pointX, pointY, image.x + image.width - size, image.y + image.height - size, size, size);
}

function drawPlacedImageSelection(ctx: CanvasRenderingContext2D, image: EditorPlacedImage) {
  const handleSize = 18;
  const handleX = image.x + image.width - handleSize;
  const handleY = image.y + image.height - handleSize;

  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(image.x, image.y, image.width, image.height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(handleX, handleY, handleSize, handleSize);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(handleX + 5, handleY + handleSize - 5);
  ctx.lineTo(handleX + handleSize - 5, handleY + 5);
  ctx.stroke();
  ctx.restore();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  while (ctx.measureText(`${clipped[maxLines - 1]}...`).width > maxWidth && clipped[maxLines - 1]) {
    clipped[maxLines - 1] = clipped[maxLines - 1].slice(0, -1).trim();
  }
  clipped[maxLines - 1] = `${clipped[maxLines - 1]}...`;
  return clipped;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeFailedProduct(sourceUrl: string, error: string): ProductDraft {
  return {
    site: "unknown",
    sourceUrl,
    titleKo: "수집 실패",
    title: `수집 실패: ${error}`,
    brand: "",
    price: 0,
    colors: [],
    sizes: [],
    images: [],
    productCode: "",
    description: error,
    stockStatus: "0",
    extractedAt: new Date().toISOString(),
  };
}

function getUrls(value: string) {
  return value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function countBuymaTitleCharacters(value: unknown) {
  return [...cleanText(value)].length;
}

function normalizeUrlKey(value: unknown) {
  const text = cleanText(value);
  if (!text) return "";

  try {
    const url = new URL(text);
    url.hash = "";
    const sortedParams = [...url.searchParams.entries()]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`),
      );
    url.search = "";
    sortedParams.forEach(([key, paramValue]) => {
      url.searchParams.append(key, paramValue);
    });
    return url.toString();
  } catch {
    return text;
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getDefaultDeadline(baseDate?: string) {
  const date = baseDate ? new Date(baseDate) : new Date();
  if (Number.isNaN(date.getTime())) return getDefaultDeadline();
  date.setDate(date.getDate() + 89);
  return date.toISOString().slice(0, 10);
}

function normalizeBuymaCityInput(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "2002003") return "001";
  if (/^\d+$/.test(text)) return text.padStart(3, "0");
  return text;
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

async function translateText(text: string, target: "en" | "ja") {
  const source = /[가-힣]/.test(text) ? "ko" : "auto";
  const response = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`,
  );
  if (!response.ok) throw new Error("번역 API 요청 실패");
  const data = (await response.json()) as Array<Array<Array<string>>>;
  const translated = data[0]?.map((item) => item[0]).join("").trim();
  if (!translated) throw new Error("번역 결과가 없습니다.");
  return translated;
}

async function translateMultilineText(text: string, target: "en" | "ja") {
  const lines = text.replace(/\r/g, "\n").split("\n");
  const translatedLines = await Promise.all(
    lines.map(async (line) => {
      const trimmed = cleanText(line);
      if (target === "ja" && isStandaloneSizeLine(trimmed)) return trimmed;
      return trimmed ? translateText(trimmed, target) : "";
    }),
  );

  return translatedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isStandaloneSizeLine(value: string) {
  return /^(?:FREE|ONE|ONE\s*SIZE|OS|XS|S|M|L|XL|XXL|XXXL|\d+\([A-Z0-9]+\)|\d{1,3}|[A-Z0-9./+-]{1,12})$/i.test(value);
}

async function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function readFiles(files: FileList | null) {
  if (!files) return [];
  return Promise.all(Array.from(files).slice(0, 8).map(readFile));
}

async function loadCanvasImage(src: string) {
  const image = await loadCanvasImageSource(src);
  if (image || !isRemoteImageSrc(src)) return image;
  return loadCanvasImageSource(`/api/image-proxy?url=${encodeURIComponent(src)}`);
}

function loadCanvasImageSource(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function isRemoteImageSrc(src: string) {
  return /^https?:\/\//i.test(src);
}

function getInitialPlacedImageFrame(image: HTMLImageElement | null) {
  if (!image?.width || !image?.height) {
    return {
      x: 80,
      y: 80,
      width: 260,
      height: 260,
    };
  }

  const ratio = Math.min(EDITOR_INITIAL_IMAGE_MAX_SIZE / image.width, EDITOR_INITIAL_IMAGE_MAX_SIZE / image.height);
  const width = Math.round(image.width * ratio);
  const height = Math.round(image.height * ratio);

  return {
    x: Math.round((EDITOR_DESIGN_SIZE - width) / 2),
    y: Math.round((EDITOR_DESIGN_SIZE - height) / 2),
    width,
    height,
  };
}

function drawImageFit(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
) {
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * ratio;
  const height = image.height * ratio;
  ctx.drawImage(image, x + (maxWidth - width) / 2, y + (maxHeight - height) / 2, width, height);
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const ratio = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
}

function renderLuckyTemplate(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 798, 798);
  ctx.beginPath();
  ctx.moveTo(0, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.lineTo(800, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.moveTo(EDITOR_LUCKY_LEFT_WIDTH, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.lineTo(EDITOR_LUCKY_LEFT_WIDTH, 800);
  ctx.stroke();
}

function renderLucky2Template(ctx: CanvasRenderingContext2D) {
  const headerHeight = 112;

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 798, 798);
  ctx.beginPath();
  ctx.moveTo(0, headerHeight);
  ctx.lineTo(800, headerHeight);
  ctx.stroke();
}

function renderNorthFaceTemplate(ctx: CanvasRenderingContext2D) {
  renderNorthFaceBaseTemplate(ctx, "#1B1B1B");
}

function renderNorthFaceWhiteLabelTemplate(ctx: CanvasRenderingContext2D) {
  renderNorthFaceBaseTemplate(ctx, "#F6F6F6");
}

function renderNorthFaceBaseTemplate(ctx: CanvasRenderingContext2D, headerColor: string) {
  ctx.fillStyle = headerColor;
  ctx.fillRect(0, 0, 800, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 798, 798);
  ctx.beginPath();
  ctx.moveTo(0, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.lineTo(800, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.moveTo(EDITOR_LUCKY_LEFT_WIDTH, EDITOR_LUCKY_HEADER_HEIGHT);
  ctx.lineTo(EDITOR_LUCKY_LEFT_WIDTH, 800);
  ctx.stroke();
}

function getLuckyRightCellClipRect(template: EditorTemplate) {
  if (template !== "lucky" && template !== "northface" && template !== "northfaceWhiteLabel") return null;

  const inset = 2;
  return {
    x: EDITOR_LUCKY_LEFT_WIDTH + inset,
    y: EDITOR_LUCKY_HEADER_HEIGHT + inset,
    width: EDITOR_DESIGN_SIZE - EDITOR_LUCKY_LEFT_WIDTH - inset * 2,
    height: EDITOR_DESIGN_SIZE - EDITOR_LUCKY_HEADER_HEIGHT - inset * 2,
  };
}

function drawImageFitWithBackgroundRemoval(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  removeBackground: boolean,
) {
  if (!removeBackground) {
    drawImageFit(ctx, image, x, y, maxWidth, maxHeight);
    return;
  }

  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const targetX = x + (maxWidth - width) / 2;
  const targetY = y + (maxHeight - height) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const tempCtx = canvas.getContext("2d");
  if (!tempCtx) {
    drawImageFit(ctx, image, x, y, maxWidth, maxHeight);
    return;
  }

  tempCtx.drawImage(image, 0, 0, width, height);
  try {
    removeLightBackground(tempCtx, width, height);
    ctx.drawImage(canvas, targetX, targetY);
  } catch {
    drawImageFit(ctx, image, x, y, maxWidth, maxHeight);
  }
}

function drawImageCoverWithBackgroundRemoval(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  removeBackground: boolean,
) {
  if (!removeBackground) {
    drawImageCover(ctx, image, x, y, width, height);
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const tempCtx = canvas.getContext("2d");
  if (!tempCtx) {
    drawImageCover(ctx, image, x, y, width, height);
    return;
  }

  const ratio = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  tempCtx.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
  try {
    removeLightBackground(tempCtx, canvas.width, canvas.height);
    ctx.drawImage(canvas, x, y);
  } catch {
    drawImageCover(ctx, image, x, y, width, height);
  }
}

function removeLightBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luminance > 224 && chroma < 46) {
      data[index + 3] = 0;
    } else if (luminance > 208 && chroma < 58) {
      data[index + 3] = Math.min(data[index + 3], 45);
    } else if (luminance > 192 && chroma < 36) {
      data[index + 3] = Math.min(data[index + 3], 130);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function getDataUrlExtension(dataUrl: string) {
  if (dataUrl.startsWith("data:image/png")) return "png";
  if (dataUrl.startsWith("data:image/webp")) return "webp";
  return "jpg";
}
