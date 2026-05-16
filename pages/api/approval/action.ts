import type { NextApiRequest, NextApiResponse } from "next";

import { type ApprovalAction, verifyApprovalToken } from "@/lib/approval";
import { DEFAULT_ACCESS_DAYS } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function isApprovalAction(action: string): action is ApprovalAction {
  return action === "approve" || action === "reject";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = String(req.query.uid ?? "");
  const email = String(req.query.email ?? "");
  const action = String(req.query.action ?? "");
  const token = String(req.query.token ?? "");

  if (!userId || !email || !isApprovalAction(action) || !token) {
    res.status(400).send("잘못된 승인 링크입니다.");
    return;
  }

  if (!verifyApprovalToken(userId, email, action, token)) {
    res.status(403).send("승인 링크가 유효하지 않습니다.");
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const approvalStatus = action === "approve" ? "approved" : "rejected";
    const approvedAt = action === "approve" ? new Date() : null;
    const accessExpiresAt = approvedAt
      ? new Date(
          approvedAt.getTime() + DEFAULT_ACCESS_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null;
    const update = {
      approval_status: approvalStatus,
      approved_at: approvedAt?.toISOString() ?? null,
      ...(accessExpiresAt ? { access_expires_at: accessExpiresAt } : {}),
    };
    const { error } = await supabaseAdmin
      .from("users")
      .update(update)
      .eq("id", userId)
      .eq("email", email);

    if (error) {
      throw error;
    }

    res.status(200).send(
      action === "approve"
        ? "회원 가입을 승인했습니다."
        : "회원 가입을 거절했습니다.",
    );
  } catch (error) {
    res
      .status(500)
      .send(error instanceof Error ? error.message : "승인 처리에 실패했습니다.");
  }
}
