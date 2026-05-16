import type { NextApiRequest, NextApiResponse } from "next";

import type { ExtractProductResponse } from "@/lib/buyma/types";
import { findProductExtractor, getSupportedProductSites, parseProductUrl } from "@/lib/product-extractors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExtractProductResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST만 지원합니다." });
  }

  const url = typeof req.body?.url === "string" ? req.body.url : "";
  const parsedUrl = parseProductUrl(url);

  if (!parsedUrl) {
    return res.status(400).json({
      ok: false,
      error: `지원하는 상품 URL을 입력해주세요. 지원 사이트: ${getSupportedProductSites().join(", ")}`,
    });
  }

  const extractor = findProductExtractor(parsedUrl);
  if (!extractor) {
    return res.status(400).json({
      ok: false,
      error: `지원하는 상품 URL을 입력해주세요. 지원 사이트: ${getSupportedProductSites().join(", ")}`,
    });
  }

  try {
    const product = await extractor.extract(parsedUrl);

    return res.status(200).json({ ok: true, product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "상품 정보를 수집하지 못했습니다.";
    return res.status(502).json({ ok: false, error: message });
  }
}
