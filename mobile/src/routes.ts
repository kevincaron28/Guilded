import { APP_LINK_ORIGINS } from "./links";

export type GuildSection = "characters" | "reserves" | "wishlist" | "raids" | "alerts" | "map";
export interface MobileRoute { section: GuildSection; guildDiscordId?: string; raidId?: string }
const sections: GuildSection[] = ["characters", "reserves", "wishlist", "raids", "alerts", "map"];

/** App links carry destinations, never credentials or untrusted external URLs. */
export function mobileRoute(url: string): MobileRoute | null {
  try {
    const parsed = new URL(url);
    let section: string;
    if (parsed.protocol === "guilded:") section = parsed.hostname || parsed.pathname.replace(/^\//, "");
    else if (APP_LINK_ORIGINS.includes(parsed.origin) && parsed.pathname.startsWith("/app/")) section = parsed.pathname.slice(5).split("/")[0] ?? "";
    else return null;
    if (!sections.includes(section as GuildSection)) return null;
    const guild = parsed.searchParams.get("guild");
    const raid = parsed.searchParams.get("raidId");
    return { section: section as GuildSection, ...(guild && /^\d{5,30}$/.test(guild) ? { guildDiscordId: guild } : {}), ...(raid && raid.length <= 200 ? { raidId: raid } : {}) };
  } catch { return null; }
}

export function notificationRoute(data: unknown): MobileRoute | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.guildDiscordId !== "string" || !/^\d{5,30}$/.test(row.guildDiscordId)) return null;
  // A guildmate's call for help (0.6.0) opens the guild map, where the call is listed.
  if (row.type === "help") return { section: "map", guildDiscordId: row.guildDiscordId };
  if (row.type !== "raid") return null;
  return { section: "raids", guildDiscordId: row.guildDiscordId, ...(typeof row.raidId === "string" && row.raidId.length <= 200 ? { raidId: row.raidId } : {}) };
}

export type TabName = "guild" | "stats" | "me" | "alerts" | "news";
export type GuildPart = "roster" | "map" | "raids";
/** Where a destination lands: the tab, and for the Guild tab which part. Wishlist lives in Me; raids open on the Raids part. */
export function routeTarget(route: MobileRoute): { tab: TabName; part?: GuildPart } {
  switch (route.section) {
    case "alerts": return { tab: "alerts" };
    case "wishlist": return { tab: "me" };
    case "raids": return { tab: "guild", part: "raids" };
    case "map": return { tab: "guild", part: "map" };
    default: return { tab: "guild", part: "roster" };
  }
}

/** What Android Back does: from a tab other than the home tab it goes home; on the home tab it leaves the app (null = let the system handle it). */
export function backTarget(current: TabName, home: TabName): TabName | null {
  return current === home ? null : home;
}
