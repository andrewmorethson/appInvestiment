/// <reference lib="deno.ns" />
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/json.ts";

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

async function getFearGreed() {
  const r = await fetch("https://api.alternative.me/fng/?limit=1&format=json");
  const t = await r.text();
  if (!r.ok) throw new Error(`FNG failed: ${r.status} ${t}`);
  const data = JSON.parse(t);
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const value = item ? Number(item.value) : NaN;
  const cls = item?.value_classification || "";
  const ts = item?.timestamp ? Number(item.timestamp) : null;
  return { value, classification: cls, timestamp: ts };
}

function scoreFromFng(value: number): number {
  // MVP: map 0..100 into 0..4 (higher greed => higher score)
  if (!isFinite(value)) return 2;
  const s = (value / 100) * 4;
  return Math.round(clamp(s, 0, 4) * 100) / 100;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { action, params } = (await req.json().catch(() => ({}))) as { action?: string; params?: any };
    const a = String(action || "");

    if (a === "getFearAndGreed") {
      const fg = await getFearGreed();
      return json({ provider: "alternative.me", ...fg });
    }

    if (a === "getSentimentScore") {
      const symbol = String(params?.symbol || "BTC");
      const fg = await getFearGreed();
      const score = scoreFromFng(fg.value);
      return json({ provider: "alternative.me", symbol, score, fearGreed: fg });
    }

    return json({ error: `Unknown action: ${a}` }, 400);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
