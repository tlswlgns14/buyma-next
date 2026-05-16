import type { NextApiRequest, NextApiResponse } from "next";

type ExchangeRateResponse =
  | { ok: true; rate: number; base: "KRW"; target: "JPY"; date: string; source: string }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExchangeRateResponse>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "GET method only." });
  }

  try {
    const result = await fetchKrwToJpyRate();
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch exchange rate.";
    return res.status(502).json({ ok: false, error: message });
  }
}

async function fetchKrwToJpyRate(): Promise<Extract<ExchangeRateResponse, { ok: true }>> {
  const primary = await fetch("https://api.frankfurter.app/latest?from=KRW&to=JPY");
  if (primary.ok) {
    const data = (await primary.json()) as { date?: string; rates?: { JPY?: number } };
    if (data.rates?.JPY && data.rates.JPY > 0) {
      return {
        ok: true,
        rate: roundRate(data.rates.JPY),
        base: "KRW",
        target: "JPY",
        date: data.date || new Date().toISOString().slice(0, 10),
        source: "frankfurter",
      };
    }
  }

  const fallback = await fetch("https://open.er-api.com/v6/latest/KRW");
  if (fallback.ok) {
    const data = (await fallback.json()) as {
      time_last_update_utc?: string;
      rates?: { JPY?: number };
    };
    if (data.rates?.JPY && data.rates.JPY > 0) {
      return {
        ok: true,
        rate: roundRate(data.rates.JPY),
        base: "KRW",
        target: "JPY",
        date: data.time_last_update_utc
          ? new Date(data.time_last_update_utc).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        source: "open.er-api",
      };
    }
  }

  throw new Error("KRW to JPY rate was not available.");
}

function roundRate(rate: number) {
  return Math.round(rate * 1000000) / 1000000;
}
