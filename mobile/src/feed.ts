import type { Lang } from "./i18n";

// The guild activity feed (GET /api/v1/me/guild-feed?guild=<discord id>, phone app 0.6.0): joins, departures, rank changes,
// guild bank gifts and raid kills, newest first. Server: src/services/mobile-guild-feed.ts.

export type FeedKind = "join" | "leave" | "removed" | "promote" | "demote" | "donation" | "raidKill";
export interface FeedItem { kind: FeedKind; at: string; actor: string; target?: string; rank?: string; item?: string; count?: number; copper?: number; boss?: string; instance?: string }
export interface Feed { days: number; items: FeedItem[] }

const KINDS = new Set<FeedKind>(["join", "leave", "removed", "promote", "demote", "donation", "raidKill"]);
const str = (v: unknown, max = 80): string | undefined => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const num = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

/** Row by row: an unknown kind (a newer server) or a malformed row is left out, never the feed. */
export function parseFeed(body: unknown): Feed {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const items = (Array.isArray(data.items) ? data.items : []).flatMap((raw): FeedItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const kind = row.kind as FeedKind;
    const actor = str(row.actor);
    const at = str(row.at, 40);
    if (!KINDS.has(kind) || !actor || !at || Number.isNaN(Date.parse(at))) return [];
    const item: FeedItem = { kind, at, actor };
    const target = str(row.target), rank = str(row.rank, 40), name = str(row.item, 100), boss = str(row.boss), instance = str(row.instance);
    const count = num(row.count), copper = num(row.copper);
    if (target) item.target = target;
    if (rank) item.rank = rank;
    if (name) item.item = name;
    if (count !== undefined) item.count = count;
    if (copper !== undefined) item.copper = copper;
    if (boss) item.boss = boss;
    if (instance) item.instance = instance;
    return [item];
  });
  return { days: num(data.days) ?? 14, items };
}

/** Gold, silver and copper the way the game writes them: 12g 30s, 5s 20c. */
export function money(copper: number): string {
  const g = Math.floor(copper / 10_000), s = Math.floor((copper % 10_000) / 100), c = Math.floor(copper % 100);
  return [g ? `${g}g` : "", s ? `${s}s` : "", c || (!g && !s) ? `${c}c` : ""].filter(Boolean).join(" ");
}

/** One line per event, in the member's language. */
export function feedLine(item: FeedItem, lang: Lang): string {
  const fr = lang === "fr";
  switch (item.kind) {
    case "join": return fr ? `${item.actor} a rejoint la guilde` : `${item.actor} joined the guild`;
    case "leave": return fr ? `${item.actor} a quitté la guilde` : `${item.actor} left the guild`;
    case "removed": return fr ? `${item.target ?? "?"} a été retiré de la guilde par ${item.actor}` : `${item.actor} removed ${item.target ?? "?"} from the guild`;
    case "promote": return fr ? `${item.target ?? "?"} est promu ${item.rank ?? ""}`.trim() + ` (${item.actor})` : `${item.actor} promoted ${item.target ?? "?"}${item.rank ? ` to ${item.rank}` : ""}`;
    case "demote": return fr ? `${item.target ?? "?"} passe ${item.rank ?? ""}`.trim() + ` (${item.actor})` : `${item.actor} demoted ${item.target ?? "?"}${item.rank ? ` to ${item.rank}` : ""}`;
    case "donation": {
      const gift = item.copper !== undefined ? money(item.copper) : `${item.count && item.count > 1 ? `${item.count} × ` : ""}${item.item ?? "?"}`;
      return fr ? `${item.actor} a donné ${gift} à la banque de guilde` : `${item.actor} gave ${gift} to the guild bank`;
    }
    case "raidKill": return fr ? `Victoire sur ${item.boss ?? item.actor}${item.instance ? ` (${item.instance})` : ""}` : `${item.boss ?? item.actor} defeated${item.instance ? ` (${item.instance})` : ""}`;
  }
}

/** Groups the feed by local day, newest day first. */
export function byDay(items: FeedItem[], lang: Lang): { day: string; items: FeedItem[] }[] {
  const groups: { day: string; items: FeedItem[] }[] = [];
  const format = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" });
  for (const item of items) {
    const day = format.format(new Date(item.at));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item); else groups.push({ day, items: [item] });
  }
  return groups;
}
