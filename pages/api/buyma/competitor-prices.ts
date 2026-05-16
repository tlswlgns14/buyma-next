import type { NextApiRequest, NextApiResponse } from "next";

import {
  buildBuymaSearchUrl,
  parseBuymaSearchResults,
  validatePublicBuymaUrl,
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

  const rawSearchUrl = typeof req.body?.searchUrl === "string" ? req.body.searchUrl.trim() : "";
  const keyword = typeof req.body?.keyword === "string" ? req.body.keyword.trim() : "";
  const searchUrl = rawSearchUrl ? validatePublicBuymaUrl(rawSearchUrl) : validatePublicBuymaUrl(buildBuymaSearchUrl(keyword));

  if (!searchUrl) {
    return res.status(400).json({
      ok: false,
      error: "BUYMA 공개 검색 URL 또는 검색어를 입력해 주세요.",
    });
  }

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BuymaPriceChecker/1.0)",
        "Accept-Language": "ja,en;q=0.8,ko;q=0.7",
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `BUYMA 검색 결과를 가져오지 못했습니다. (${response.status})`,
      });
    }

    const html = await response.text();
    const results = parseBuymaSearchResults(html, searchUrl);

    return res.status(200).json({
      ok: true,
      searchUrl,
      checkedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BUYMA 가격 확인에 실패했습니다.";
    return res.status(502).json({ ok: false, error: message });
  }
}
