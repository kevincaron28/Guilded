import { fullNameOf } from "./forever-names.js";

// Link to Blizzard's WoW Forever armory (docs/FOREVER_ARMORY.md). A plain link only: nothing is fetched,
// scraped or called, and other editions get no link. The page is Blizzard's, so it may move; links fail softly.

const REGIONS = new Set(["us", "eu", "kr", "tw"]);
const BASE = "https://worldofwarcraft.blizzard.com/en-us/forever";

export interface ArmoryCharacter { name: string; displayName?: string | null; gameEdition?: string | null }

const region = (value: string | undefined) => (value && REGIONS.has(value.toLowerCase()) ? value.toLowerCase() : "us");

/**
 * The armory page for a Forever character, or null for any other edition.
 * A full "First Last" name maps to the character page; a lone first name (old 8.4 rows) uses the display
 * name when it extends it, and anything else (one word, accents, apostrophes) goes to the armory search.
 */
export function armoryUrl(character: ArmoryCharacter, regionCode?: string): string | null {
  if ((character.gameEdition ?? "forever") !== "forever") return null;
  const where = `${BASE}/${region(regionCode)}/armory`;
  const trimmed = character.name.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const full = trimmed.includes(" ") ? trimmed : fullNameOf({ name: trimmed, displayName: character.displayName ?? null }) ?? trimmed;
  if (/^[A-Za-z]+( [A-Za-z]+)+$/.test(full)) return `${where}/character/${full.toLowerCase().replace(/ /g, "-")}`;
  return `${where}?q=${encodeURIComponent(full).replace(/%20/g, "+")}`;
}

/** The same link as a Discord masked link, or "" when there is none. Angle brackets stop Discord adding a preview. */
export function armoryMarkdown(character: ArmoryCharacter, label = "Armory", regionCode?: string): string {
  const url = armoryUrl(character, regionCode);
  return url ? `[${label}](<${url}>)` : "";
}

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The same link as a small HTML anchor for the website, preceded by a space, or "" when there is none. */
export function armoryAnchor(character: ArmoryCharacter, t: (en: string, fr: string) => string, regionCode?: string): string {
  const url = armoryUrl(character, regionCode);
  return url ? ` <a class="muted" href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${t("Armory", "Armurerie")}</a>` : "";
}
