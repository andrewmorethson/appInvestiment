/// <reference lib="deno.ns" />
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/json.ts";
import { hmacSha256Hex } from "../_shared/hmac.ts";

type Body = { action?: string; params?: Record<string, unknown> };

function getEnv(name: string, fallback?: string): string {
  const v = Deno.env.get(name);
  if (v && v.length) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env: ${name}`);
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

async function binancePublic(path: string, params: Record<string, unknown> = {}) {
  const base = getEnv("BINANCE_BASE_URL", "https://api.binance.com");
  const url = `${base}${path}${Object.keys(params).length ? `?${qs(params)}` : ""}`;
  const r = await fetch(url);
  const t = await r.text();
  let data: unknown;
  try { data = t ? JSON.parse(t) : null; } catch { data = { raw: t }; }
  if (!r.ok) throw new Error(`Binance public ${path} failed: ${r.status} ${t}`);
  return data;
}

async function binanceSigned(method: "GET"|"POST"|"DELETE", path: string, params: Record<string, unknown> = {}) {
  const base = getEnv("BINANCE_BASE_URL", "https://api.binance.com");
  const apiKey = getEnv("BINANCE_API_KEY");
  const secret = getEnv("BINANCE_API_SECRET");

  const timestamp = Date.now();
  const recvWindow = 5000;
  const qParams = { ...params, timestamp, recvWindow };
  const query = qs(qParams);
  const signature = await hmacSha256Hex(secret, query);

  const url = `${base}${path}?${query}&signature=${signature}`;
  const r = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const t = await r.text();
  let data: unknown;
  try { data = t ? JSON.parse(t) : null; } catch { data = { raw: t }; }
  if (!r.ok) throw new Error(`Binance signed ${path} failed: ${r.status} ${t}`);
  return data;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const action = String(body.action || "");
    const p = (body.params || {}) as Record<string, unknown>;

    // Public
    if (action === "ping") return json(await binancePublic("/api/v3/ping"));
    if (action === "getServerTime") return json(await binancePublic("/api/v3/time"));
    if (action === "getExchangeInfo") return json(await binancePublic("/api/v3/exchangeInfo", p));
    if (action === "getPrice") return json(await binancePublic("/api/v3/ticker/price", p));
    if (action === "getAvgPrice") return json(await binancePublic("/api/v3/avgPrice", p));
    if (action === "get24hTickerStats") return json(await binancePublic("/api/v3/ticker/24hr", p));
    if (action === "getOrderBook") return json(await binancePublic("/api/v3/depth", p));
    if (action === "getKlines") return json(await binancePublic("/api/v3/klines", p));

    // Signed
    if (action === "getAccountInfo") return json(await binanceSigned("GET", "/api/v3/account", p));
    if (action === "getOpenOrders") return json(await binanceSigned("GET", "/api/v3/openOrders", p));
    if (action === "getAllOrders") return json(await binanceSigned("GET", "/api/v3/allOrders", p));
    if (action === "getMyTrades") return json(await binanceSigned("GET", "/api/v3/myTrades", p));
    if (action === "getOrder") return json(await binanceSigned("GET", "/api/v3/order", p));
    if (action === "cancelOrder") return json(await binanceSigned("DELETE", "/api/v3/order", p));
    if (action === "cancelAllOpenOrders") return json(await binanceSigned("DELETE", "/api/v3/openOrders", p));
    if (action === "createOrder") return json(await binanceSigned("POST", "/api/v3/order", p));

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
