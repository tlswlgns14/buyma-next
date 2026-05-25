import type { NextApiRequest, NextApiResponse } from "next";

import {
  fetchBuymaCompetitorPrices,
  type BuymaCompetitorPriceResponse,
} from "@/lib/buyma/competitor-prices";
import { canUseCompetitorPrices } from "@/lib/competitor-price-access";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BuymaCompetitorPriceResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST method only." });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Login is required." });
  }

  const supabase = getSupabaseAdmin();
  const { data: userData, error } = await supabase.auth.getUser(token);

  if (error || !userData.user) {
    return res.status(401).json({ ok: false, error: "Login is required." });
  }

  if (!(await canUseCompetitorPrices(supabase, userData.user.id))) {
    return res.status(403).json({ ok: false, error: "No competitor price access." });
  }

  const priceData = await fetchBuymaCompetitorPrices({
    searchUrl: typeof req.body?.searchUrl === "string" ? req.body.searchUrl : "",
    keyword: typeof req.body?.keyword === "string" ? req.body.keyword : "",
  });

  return res.status(priceData.ok ? 200 : 400).json(priceData);
}

function getBearerToken(req: NextApiRequest) {
  const header = req.headers.authorization;
  if (!header) return "";

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}
