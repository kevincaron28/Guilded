export type GuildSection = "characters" | "reserves" | "wishlist" | "raids" | "alerts";
export interface MobileRoute { section: GuildSection; guildDiscordId?: string; raidId?: string }
const sections: GuildSection[] = ["characters", "reserves", "wishlist", "raids", "alerts"];

/** App links carry destinations, never credentials or untrusted external URLs. */
export function mobileRoute(url: string): MobileRoute | null {
  try {
    const parsed = new URL(url);
    let section: string;
    if (parsed.protocol === "guilded:") section = parsed.hostname || parsed.pathname.replace(/^\//, "");
    else if (parsed.origin === "https://guilded.kcaron.top" && parsed.pathname.startsWith("/app/")) section = parsed.pathname.slice(5).split("/")[0] ?? "";
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
  if (row.type !== "raid" || typeof row.guildDiscordId !== "string" || !/^\d{5,30}$/.test(row.guildDiscordId)) return null;
  return { section: "raids", guildDiscordId: row.guildDiscordId, ...(typeof row.raidId === "string" && row.raidId.length <= 200 ? { raidId: row.raidId } : {}) };
}
