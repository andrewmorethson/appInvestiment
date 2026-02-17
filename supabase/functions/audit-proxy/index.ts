/// <reference lib="deno.ns" />
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/json.ts";

type Body = {
  action?: "append" | "list";
  params?: Record<string, unknown>;
};

const rateWindow = new Map<string, { resetAt: number; count: number }>();

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function envOptional(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

function restHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim();
  if (ip) return ip;
  return "unknown";
}

function enforceOrigin(req: Request): Response | null {
  const allowed = envOptional("AUDIT_ALLOWED_ORIGINS");
  if (!allowed) return null;
  const allowSet = new Set(
    allowed.split(",").map((x) => x.trim()).filter(Boolean),
  );
  const origin = String(req.headers.get("origin") || "").trim();
  if (!origin || !allowSet.has(origin)) {
    return json({ error: "Origin not allowed" }, 403);
  }
  return null;
}

function enforceAuditToken(req: Request): Response | null {
  const expected = env("AUDIT_PROXY_TOKEN");
  const provided = String(req.headers.get("x-audit-token") || "").trim();
  if (!provided || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

function enforceRateLimit(req: Request): Response | null {
  const maxPerMin = Math.max(10, Number(envOptional("AUDIT_RATE_LIMIT_PER_MIN") || 120));
  const key = `${getClientIp(req)}|${String(req.headers.get("origin") || "-")}`;
  const now = Date.now();
  const rec = rateWindow.get(key);
  if (!rec || now >= rec.resetAt) {
    rateWindow.set(key, { resetAt: now + 60_000, count: 1 });
    return null;
  }
  if (rec.count >= maxPerMin) {
    return json({ error: "Rate limit exceeded" }, 429);
  }
  rec.count += 1;
  return null;
}

async function appendEvents(runId: string, events: unknown[]) {
  const url = `${env("SUPABASE_URL")}/rest/v1/audit_events`;
  const rows = events.map((ev) => ({
    run_id: runId,
    event_type: String((ev as any)?.eventType || "UNKNOWN"),
    payload: (ev as any)?.payload || {},
    raw: String((ev as any)?.raw || ""),
    ts_ms: Number((ev as any)?.ts || Date.now()),
  }));

  const r = await fetch(url, {
    method: "POST",
    headers: {
      ...restHeaders(),
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`insert failed: ${r.status} ${await r.text()}`);
}

async function listEvents(runId: string, limit: number) {
  const q = new URLSearchParams();
  q.set("run_id", `eq.${runId}`);
  q.set("order", "ts_ms.asc");
  q.set("limit", String(limit));
  const url = `${env("SUPABASE_URL")}/rest/v1/audit_events?${q.toString()}`;

  const r = await fetch(url, { headers: restHeaders() });
  if (!r.ok) throw new Error(`select failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const method = String(req.method || "").toUpperCase();
    if (method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    const badOrigin = enforceOrigin(req);
    if (badOrigin) return badOrigin;
    const badToken = enforceAuditToken(req);
    if (badToken) return badToken;
    const badRate = enforceRateLimit(req);
    if (badRate) return badRate;

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action || "append";
    const params = (body.params || {}) as Record<string, unknown>;
    const runId = String(params.runId || "").trim();
    if (!runId) return json({ error: "runId is required" }, 400);

    if (action === "append") {
      const events = Array.isArray(params.events) ? params.events : [];
      if (!events.length) return json({ ok: true, inserted: 0 });
      await appendEvents(runId, events);
      return json({ ok: true, inserted: events.length });
    }

    if (action === "list") {
      const limit = Math.max(1, Math.min(5000, Number(params.limit || 1000)));
      const rows = await listEvents(runId, limit);
      return json({ ok: true, runId, count: rows.length, rows });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
