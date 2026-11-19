import type { Lang } from "../i18n";
import type { RaidBoard } from "../publicApi";

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
} as const;

/** "9 December" / "9 décembre" from the server's `opensAt` (UTC). Falls back to the launch date the server announced. */
export function raidOpenDate(opensAt: string | null, lang: Lang): string {
  const at = opensAt ? new Date(opensAt) : new Date(Date.UTC(2026, 11, 9));
  const date = Number.isNaN(at.getTime()) ? new Date(Date.UTC(2026, 11, 9)) : at;
  return `${date.getUTCDate()} ${MONTHS[lang][date.getUTCMonth()]}`;
}

/** What the Raids section shows: the "opens 9 December" note before any kill, a plain empty note after the opening, else the boards. */
export function raidsView(board: RaidBoard): "opens" | "none" | "boards" {
  if (board.guilds.length > 0) return "boards";
  return board.open ? "none" : "opens";
}

