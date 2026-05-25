import type { NextApiRequest, NextApiResponse } from "next";

import { runCompetitorPriceBatch } from "@/lib/buyma/competitor-price-job";
import { canUseCompetitorPrices } from "@/lib/competitor-price-access";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type BatchResponse =
  | {
      ok: true;
      checked: number;
      failed: number;
    }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BatchResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST method only." });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
    }

    if (!(await canUseCompetitorPrices(supabase, data.user.id))) {
      return res.status(403).json({ ok: false, error: "No competitor price access." });
    }

    const limit = typeof req.body?.limit === "number" ? req.body.limit : undefined;
    const productIds = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id): id is string => typeof id === "string")
      : undefined;
    const result = await runCompetitorPriceBatch({
      userId: data.user.id,
      limit,
      productIds,
    });

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

function getBearerToken(req: NextApiRequest) {
  const header = req.headers.authorization;
  if (!header) return "";

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}
