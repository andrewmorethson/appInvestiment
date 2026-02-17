export type RssItem = {
  title: string;
  url: string;
  publishedAt?: string;
  source?: string;
  snippet?: string;
};

function text(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

export function parseRss(xmlText: string, sourceName: string): RssItem[] {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const items = Array.from(doc.querySelectorAll("item"));
  return items.map((it) => {
    const title = text(it.querySelector("title"));
    const link = text(it.querySelector("link"));
    const pubDate = text(it.querySelector("pubDate"));
    const desc = text(it.querySelector("description"));
    return {
      title,
      url: link,
      publishedAt: pubDate || undefined,
      source: sourceName,
      snippet: desc ? desc.replace(/<[^>]*>/g, "").slice(0, 220) : undefined,
    };
  });
}
