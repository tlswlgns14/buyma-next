import type { NextApiRequest, NextApiResponse } from "next";

import { normalizeBuymaSettings } from "@/lib/buyma/storage";
import type { BuymaSettings } from "@/lib/buyma/types";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type SettingsResponse =
  | {
      ok: true;
      settings: BuymaSettings;
      exists: boolean;
    }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SettingsResponse>,
) {
  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "GET or PUT method only." });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Login is required." });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return res.status(401).json({ ok: false, error: "Login is required." });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("buyma_settings")
        .select("settings")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return res.status(200).json({
        ok: true,
        settings: normalizeBuymaSettings(
          (data?.settings ?? {}) as Partial<BuymaSettings>,
        ),
        exists: Boolean(data),
      });
    }

    const settings = normalizeBuymaSettings(
      (req.body?.settings ?? {}) as Partial<BuymaSettings>,
    );
    const { error } = await supabase
      .from("buyma_settings")
      .upsert(
        {
          user_id: userData.user.id,
          settings,
        },
        { onConflict: "user_id" },
      );

    if (error) {
      throw error;
    }

    return res.status(200).json({ ok: true, settings, exists: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Settings save failed.",
    });
  }
}

function getBearerToken(req: NextApiRequest) {
  const header = req.headers.authorization;
  if (!header) return "";

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}
