import type { NextApiRequest, NextApiResponse } from "next";

import {
  fetchBuymaCompetitorPrices,
  type BuymaCompetitorPriceResponse,
} from "@/lib/buyma/competitor-prices";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BuymaCompetitorPriceResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST method only." });
  }

  const data = await fetchBuymaCompetitorPrices({
    searchUrl: typeof req.body?.searchUrl === "string" ? req.body.searchUrl : "",
    keyword: typeof req.body?.keyword === "string" ? req.body.keyword : "",
  });

  return res.status(data.ok ? 200 : 400).json(data);
}
