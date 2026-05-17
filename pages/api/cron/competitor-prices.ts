import type { NextApiRequest, NextApiResponse } from "next";

import { runCompetitorPriceBatch } from "@/lib/buyma/competitor-price-job";

type CronResponse =
  | {
      ok: true;
      checked: number;
      failed: number;
    }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CronResponse>,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "GET or POST method only." });
  }

  const secret = process.env.COMPETITOR_PRICE_CRON_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ ok: false, error: "Cron secret is not configured." });
  }

  if (getCronSecret(req) !== secret) {
    return res.status(401).json({ ok: false, error: "Invalid cron secret." });
  }

  try {
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await runCompetitorPriceBatch({ limit: rawLimit });

    return res.status(200).json({
      ok: true,
      checked: result.checked,
      failed: result.failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "가격 확인에 실패했습니다.";
    return res.status(500).json({ ok: false, error: message });
  }
}

function getCronSecret(req: NextApiRequest) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerSecret = req.headers["x-cron-secret"];
  return bearer || (Array.isArray(headerSecret) ? headerSecret[0] : headerSecret) || "";
}
