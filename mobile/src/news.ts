// Headlines and links only (GET /news/headlines.json). The app never shows or keeps article text.

export interface Headline { title: string; url: string; publishedAt: string | null }
export interface News { source: string; sourceUrl: string; enabled: boolean; items: Headline[] }

export const BLIZZARD_NEWS_URL = "https://news.blizzard.com/en-us/world-of-warcraft";

const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): string | null => typeof v === "string" && v ? v : null;

/** Only https links to Wowhead are kept, so a bad answer can never make the app open another site. */
export function safeNewsUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)wowhead\.com$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

export function parseNews(body: unknown): News {
  const data = obj(body);
  if (!data || !Array.isArray(data.items)) throw new Error("The news answer was not understood.");
  return {
    source: text(data.source) ?? "Wowhead", sourceUrl: safeNewsUrl(data.sourceUrl) ?? "https://www.wowhead.com/news", enabled: data.enabled !== false,
    items: data.items.flatMap((raw): Headline[] => {
      const item = obj(raw), title = text(item?.title), url = safeNewsUrl(item?.url);
      return item && title && url ? [{ title: title.slice(0, 200), url, publishedAt: text(item.publishedAt) }] : [];
    })
  };
}

/** "3 h ago" / "il y a 3 h" / "2 d ago", from the headline's date. */
export function ago(publishedAt: string | null, now: number, lang: "en" | "fr"): string {
  const at = publishedAt ? Date.parse(publishedAt) : NaN;
  if (!Number.isFinite(at) || at > now) return "";
  const minutes = Math.floor((now - at) / 60000);
  const [n, unit] = minutes < 60 ? [Math.max(minutes, 1), "min"] : minutes < 1440 ? [Math.floor(minutes / 60), "h"] : [Math.floor(minutes / 1440), lang === "fr" ? "j" : "d"];
  return lang === "fr" ? `il y a ${n} ${unit}` : `${n} ${unit} ago`;
}
