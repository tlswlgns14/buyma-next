import type { SupabaseClient } from "@supabase/supabase-js";

type CompetitorPriceAccessRow = {
  id: string;
  can_use_competitor_prices: boolean | null;
};

export async function canUseCompetitorPrices(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("users")
    .select("can_use_competitor_prices")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(
    (data as Pick<CompetitorPriceAccessRow, "can_use_competitor_prices"> | null)
      ?.can_use_competitor_prices,
  );
}

export async function loadCompetitorPriceUserIds(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("can_use_competitor_prices", true);

  if (error) {
    throw error;
  }

  return ((data ?? []) as Pick<CompetitorPriceAccessRow, "id">[]).map(
    (row) => row.id,
  );
}
