import type { NextApiRequest, NextApiResponse } from "next";

import { createApprovalToken } from "@/lib/approval";

type ApprovalRequestBody = {
  userId?: string;
  email?: string;
  username?: string;
  phone?: string;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

async function sendApprovalEmail({
  userId,
  email,
  username,
  phone,
  origin,
}: {
  userId: string;
  email: string;
  username: string;
  phone: string;
  origin: string;
}) {
  const resendApiKey = getRequiredEnv("RESEND_API_KEY");
  const notifyEmail = getRequiredEnv("APPROVAL_NOTIFY_EMAIL");
  const fromEmail = getRequiredEnv("APPROVAL_FROM_EMAIL");

  const approveToken = createApprovalToken(userId, email, "approve");
  const rejectToken = createApprovalToken(userId, email, "reject");
  const approveUrl = `${origin}/api/approval/action?uid=${encodeURIComponent(
    userId,
  )}&email=${encodeURIComponent(email)}&action=approve&token=${approveToken}`;
  const rejectUrl = `${origin}/api/approval/action?uid=${encodeURIComponent(
    userId,
  )}&email=${encodeURIComponent(email)}&action=reject&token=${rejectToken}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: notifyEmail,
      subject: `[BUYMA] Approval request - ${email}`,
      html: `
        <h2>BUYMA approval request</h2>
        <p><strong>Name:</strong> ${escapeHtml(username || "-")}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone || "-")}</p>
        <p><strong>User ID:</strong> ${escapeHtml(userId)}</p>
        <p>
          <a href="${approveUrl}">Approve</a>
          &nbsp;|&nbsp;
          <a href="${rejectUrl}">Reject</a>
        </p>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend failed: ${body}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { userId, email, username = "", phone = "" } = req.body as ApprovalRequestBody;

  if (!userId || !email) {
    res.status(400).json({ error: "Missing userId or email" });
    return;
  }

  const origin =
    process.env.APP_BASE_URL ??
    `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;

  try {
    await sendApprovalEmail({
      userId,
      email,
      username,
      phone,
      origin,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Approval email failed",
    });
  }
}
