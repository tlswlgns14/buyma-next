import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  compareBuymaCompetitorPrices,
  fetchBuymaCompetitorPrices,
  type BuymaCompetitorPriceItem,
} from "@/lib/buyma/competitor-prices";

const DEFAULT_OWNER_NAME = "sonokoro";
const CHECK_INTERVAL_HOURS = 24;
const MAX_BATCH_LIMIT = 50;

type CompetitorPriceProductRow = {
  id: string;
  user_id: string;
  buyma_product_id: string;
  buyma_url: string;
  title: string;
  brand: string;
  model_number: string;
  own_price: number;
  search_keyword: string;
  search_url: string;
};

type CompetitorPriceSettingRow = {
  user_id: string;
  owner_name: string;
};

type BatchResult = {
  id: string;
  ok: boolean;
  error?: string;
};

export async function runCompetitorPriceBatch(input: {
  userId?: string;
  limit?: number;
}) {
  const supabase = getSupabaseAdmin();
  const limit = clampBatchLimit(input.limit);
  let query = supabase
    .from("competitor_price_products")
    .select(
      "id,user_id,buyma_product_id,buyma_url,title,brand,model_number,own_price,search_keyword,search_url",
    )
    .eq("status", "active")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  const { data: products, error } = await query;

  if (error) {
    throw error;
  }

  const rows = (products ?? []) as CompetitorPriceProductRow[];
  const ownerNames = await loadOwnerNames(rows.map((row) => row.user_id));
  const results: BatchResult[] = [];

  for (const row of rows) {
    const result = await checkAndSaveProduct(row, ownerNames.get(row.user_id) ?? DEFAULT_OWNER_NAME);
    results.push(result);

    if (rows.indexOf(row) < rows.length - 1) {
      await delay(1200);
    }
  }

  return {
    checked: results.length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

async function loadOwnerNames(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);
  const ownerNames = new Map<string, string>();
  if (!uniqueUserIds.length) return ownerNames;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("competitor_price_settings")
    .select("user_id,owner_name")
    .in("user_id", uniqueUserIds);

  ((data ?? []) as CompetitorPriceSettingRow[]).forEach((row) => {
    if (row.owner_name.trim()) {
      ownerNames.set(row.user_id, row.owner_name.trim());
    }
  });

  return ownerNames;
}

async function checkAndSaveProduct(row: CompetitorPriceProductRow, ownerName: string): Promise<BatchResult> {
  const checkedAt = new Date().toISOString();
  const nextCheckAt = new Date(Date.now() + CHECK_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();
  const keyword = row.search_keyword || row.title;
  const data = await fetchBuymaCompetitorPrices({
    searchUrl: row.search_url,
    keyword,
  });
  const supabase = getSupabaseAdmin();

  if (!data.ok) {
    await supabase
      .from("competitor_price_products")
      .update({
        error: data.error,
        last_checked_at: checkedAt,
        next_check_at: nextCheckAt,
      })
      .eq("id", row.id);

    return { id: row.id, ok: false, error: data.error };
  }

  const { referencePrice, lowerCompetitors } = compareBuymaCompetitorPrices({
    results: data.results,
    ownerName,
    ownPrice: row.own_price,
    title: row.title,
    modelNumber: row.model_number,
    searchKeyword: keyword,
  });

  const errorMessage = data.results.length ? null : "검색 결과에서 가격을 찾지 못했습니다.";
  const { error } = await supabase
    .from("competitor_price_products")
    .update({
      last_checked_at: data.checkedAt,
      last_search_url: data.searchUrl,
      reference_price: referencePrice,
      lower_competitors: lowerCompetitors satisfies BuymaCompetitorPriceItem[],
      last_results: data.results,
      error: errorMessage,
      next_check_at: nextCheckAt,
    })
    .eq("id", row.id);

  if (error) {
    return { id: row.id, ok: false, error: error.message };
  }

  return { id: row.id, ok: true };
}

function clampBatchLimit(limit: number | undefined) {
  if (!limit || !Number.isFinite(limit)) return 25;
  return Math.max(1, Math.min(Math.floor(limit), MAX_BATCH_LIMIT));
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
