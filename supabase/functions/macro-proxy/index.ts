/// <reference lib="deno.ns" />
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/json.ts";

function getEnv(name: string, fallback?: string): string {
  const v = Deno.env.get(name);
  if (v && v.length) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env: ${name}`);
}

async function binancePrice(symbol: string) {
  const base = getEnv("BINANCE_BASE_URL", "https://api.binance.com");
  const url = `${base}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`Binance price failed: ${r.status} ${t}`);
  return JSON.parse(t);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { action, params } = (await req.json().catch(() => ({}))) as { action?: string; params?: any };
    const a = String(action || "");

    if (a === "pingProvider") return json({ ok: true, provider: "binance" });
    if (a === "getServerTime") {
      const base = getEnv("BINANCE_BASE_URL", "https://api.binance.com");
      const r = await fetch(`${base}/api/v3/time`);
      return json(await r.json());
    }

    if (a === "getMarketStatus") {
      // Crypto is effectively 24/7
      return json({ market: "CRIPTO", status: "OPEN", note: "Crypto 24/7" });
    }

    if (a === "getUSDBRL") {
      // Use USDTBRL as proxy for USD/BRL
      const p = await binancePrice("USDTBRL");
      return json({ pair: "USDTBRL", price: p?.price });
    }

    if (a === "getBTCUSD") {
      const p = await binancePrice("BTCUSDT");
      return json({ pair: "BTCUSDT", price: p?.price });
    }

    if (a === "getETHUSD") {
      const p = await binancePrice("ETHUSDT");
      return json({ pair: "ETHUSDT", price: p?.price });
    }

    if (a === "getMarketSnapshot") {
      const filter = String(params?.filter || "TUDO");
      const out: Record<string, unknown> = { filter, market: "CRIPTO" };
      out.USDTBRL = await binancePrice("USDTBRL");
      out.BTCUSDT = await binancePrice("BTCUSDT");
      out.ETHUSDT = await binancePrice("ETHUSDT");
      return json(out);
    }

    return json({ error: `Unknown action: ${a}` }, 400);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
