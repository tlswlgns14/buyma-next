import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    responseLimit: "8mb",
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET만 지원합니다." });
  }

  const url = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!url) return res.status(400).json({ error: "이미지 URL이 필요합니다." });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "올바른 이미지 URL이 아닙니다." });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: "HTTP 이미지 URL만 지원합니다." });
  }

  try {
    const response = await fetch(parsedUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "이미지를 가져오지 못했습니다." });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return res.status(415).json({ error: "이미지 응답이 아닙니다." });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(buffer);
  } catch {
    return res.status(502).json({ error: "이미지를 가져오지 못했습니다." });
  }
}
