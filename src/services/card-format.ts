import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";

/** The time zone guild settings fall back to (GuildSettings.timezone defaults to it too). */
export const DEFAULT_CARD_TIME_ZONE = "America/Toronto";

const valid = (zone: string | null | undefined): zone is string => {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
};
const locale = (lang: Lang) => (lang === "fr" ? "fr-CA" : "en-US");
const safeZone = (zone: string | null | undefined) => (valid(zone) ? zone : DEFAULT_CARD_TIME_ZONE);

/** "13 nov. 2026" (French) / "Nov 13, 2026" (English), the day as the guild's own calendar shows it. */
export function cardDate(date: Date, lang: Lang, timeZone?: string | null): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: safeZone(timeZone), day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** "10 h 05" / "10:05 AM" in the guild's time zone. */
export function cardTime(date: Date, lang: Lang, timeZone?: string | null): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: safeZone(timeZone), hour: "numeric", minute: "2-digit" }).format(date);
}

/** "13 nov. 2026, 10 h 05" / "Nov 13, 2026, 10:05 AM". */
export function cardDateTime(date: Date, lang: Lang, timeZone?: string | null): string {
  return `${cardDate(date, lang, timeZone)}, ${cardTime(date, lang, timeZone)}`;
}

/** The guild's configured time zone (guild settings), or the default when none is set or the lookup fails. */
export async function loadCardTimeZone(database: Pick<PrismaClient, "guildSettings">, guildId: string): Promise<string> {
  try {
    const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { timezone: true } });
    return safeZone(settings?.timezone);
  } catch { return DEFAULT_CARD_TIME_ZONE; }
}

/** The one footer for boards and cards built from what members' addons report (ladders, world PvP, weekly card, weekly records). */
export const reportedFooter = (lang: Lang): string => lang === "fr" ? "Rapporté par les addons des membres · aucun point" : "Reported by members' addons · no points";
