import { createHmac, timingSafeEqual } from "node:crypto";

export type ApprovalAction = "approve" | "reject";

function getApprovalSecret() {
  const secret = process.env.APPROVAL_ACTION_SECRET;

  if (!secret) {
    throw new Error("Missing APPROVAL_ACTION_SECRET");
  }

  return secret;
}

export function createApprovalToken(userId: string, email: string, action: ApprovalAction) {
  return createHmac("sha256", getApprovalSecret())
    .update(`${userId}:${email}:${action}`)
    .digest("hex");
}

export function verifyApprovalToken(
  userId: string,
  email: string,
  action: ApprovalAction,
  token: string,
) {
  const expected = createApprovalToken(userId, email, action);
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);

  return (
    expectedBuffer.length === tokenBuffer.length &&
    timingSafeEqual(expectedBuffer, tokenBuffer)
  );
}

