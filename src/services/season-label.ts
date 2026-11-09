import type { Lang } from "../i18n.js";

/**
 * A stored season name as a board shows it. Seasons the bot creates are named "Season 1", "Season 2 — November 2026"…
 * in English; a French board reads "Saison 1". A name an officer typed in another form is shown as written. The stored
 * name never changes (it keys rank history and archives), only what members read.
 */
export function seasonLabel(name: string, lang: Lang | "en" | "fr"): string {
  if (lang !== "fr") return name;
  return name.replace(/^Season(\s+\d+)/i, "Saison$1")
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, month => MONTHS_FR[month]!);
}
const MONTHS_FR: Record<string, string> = { January: "janvier", February: "février", March: "mars", April: "avril", May: "mai", June: "juin", July: "juillet",
  August: "août", September: "septembre", October: "octobre", November: "novembre", December: "décembre" };
