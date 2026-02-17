/// <reference lib="deno.ns" />
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/json.ts";
import { parseRss } from "../_shared/rss.ts";

type Article = {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  snippet?: string;
};

function uniqByUrl(items: Article[]) {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const it of items) {
    const u = it.url || it.title;
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }
  return out;
}

async function fetchCoinDeskRss(): Promise<Article[]> {
  // CoinDesk RSS feeds
  const urls = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml",
  ];

  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
      const txt = await r.text();
      if (!r.ok) continue;
      const items = parseRss(txt, "CoinDesk").map((x) => ({
        title: x.title,
        url: x.url,
        source: "CoinDesk",
        publishedAt: x.publishedAt,
        snippet: x.snippet,
      }));
      if (items.length) return items;
    } catch {
      // try next
    }
  }
  return [];
}

async function fetchGdelt(q: string, max: number): Promise<Article[]> {
  const query = q?.trim() || "crypto OR bitcoin OR ethereum";
  const maxrecords = Math.max(1, Math.min(50, max || 10));
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=${maxrecords}&sourcelang=english`;
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`GDELT failed: ${r.status} ${t}`);
  const data = JSON.parse(t);
  const arts = Array.isArray(data?.articles) ? data.articles : [];
  return arts.map((a: any) => ({
    title: String(a?.title || ""),
    url: String(a?.url || ""),
    source: String(a?.sourceCountry || a?.sourceCollection || a?.domain || "GDELT"),
    publishedAt: a?.seendate || a?.sourceCreatedAt || undefined,
    snippet: a?.excerpt ? String(a.excerpt).slice(0, 220) : undefined,
  })).filter((x: Article) => x.title && x.url);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { action, params } = (await req.json().catch(() => ({}))) as { action?: string; params?: any };
    const a = String(action || "");

    if (a !== "getLatest") return json({ error: `Unknown action: ${a}` }, 400);

    const source = String(params?.source || "both").toLowerCase(); // coindesk | gdelt | both
    const q = String(params?.q || "crypto OR bitcoin OR ethereum");
    const limit = Math.max(1, Math.min(30, Number(params?.limit || 10)));

    const out: Article[] = [];

    if (source === "coindesk" || source === "both") {
      const cd = await fetchCoinDeskRss();
      out.push(...cd);
    }

    if (source === "gdelt" || source === "both") {
      const gd = await fetchGdelt(q, limit);
      out.push(...gd);
    }

    const articles = uniqByUrl(out).slice(0, limit);

    return json({ provider: source, q, count: articles.length, articles });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
