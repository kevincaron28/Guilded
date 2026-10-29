import { canonicalSpecialization, type WowClass } from "../wow-specializations.js";

// Whether a DPS player fights in melee or at range, from their class and (when needed) spec.
// Shown under the DPS count on the raid signup and core roster cards ("4 melee · 3 ranged"),
// so an officer sees the balance at a glance. Unknown means the spec is needed and not known.

export type DpsRange = "MELEE" | "RANGED";

// Every DPS spec of these classes is the same kind.
const ALWAYS: Partial<Record<WowClass, DpsRange>> = {
  Warrior: "MELEE", Paladin: "MELEE", Rogue: "MELEE", "Death Knight": "MELEE", Monk: "MELEE",
  Mage: "RANGED", Warlock: "RANGED", Priest: "RANGED", Evoker: "RANGED"
};
const BY_SPEC: Record<string, DpsRange> = {
  "Shaman:Enhancement": "MELEE", "Shaman:Elemental": "RANGED",
  "Druid:Feral": "MELEE", "Druid:Balance": "RANGED",
  "Demon Hunter:Havoc": "MELEE", "Demon Hunter:Devourer": "RANGED",
  "Hunter:Beast Mastery": "RANGED", "Hunter:Marksmanship": "RANGED"
};

/** MELEE, RANGED or null (not a known class, or a hybrid whose spec is unknown). Survival hunters
 * fight in melee only in Retail; in Classic editions they shoot like the other hunters. */
export function dpsRange(character: { className?: string | null; spec?: string | null } | null | undefined, edition?: string | null): DpsRange | null {
  const className = character?.className as WowClass | undefined;
  if (!className) return null;
  const always = ALWAYS[className];
  if (always) return always;
  const spec = canonicalSpecialization(className, character?.spec);
  if (spec?.key === "Hunter:Survival") return edition === "retail" ? "MELEE" : "RANGED";
  if (spec) return BY_SPEC[spec.key] ?? null;
  // A hunter is ranged whatever the spec, except Retail Survival.
  return className === "Hunter" && edition !== "retail" ? "RANGED" : null;
}

/** "⚔️ 4 melee · 🏹 3 ranged · ❔ 1 unknown spec", or "" when there is no DPS. */
export function dpsSplitLine(characters: ({ className?: string | null; spec?: string | null } | null | undefined)[], lang: "en" | "fr", edition?: string | null): string {
  if (!characters.length) return "";
  const counts = { MELEE: 0, RANGED: 0, unknown: 0 };
  for (const character of characters) counts[dpsRange(character, edition) ?? "unknown"]++;
  const fr = lang === "fr";
  return [
    counts.MELEE ? `⚔️ ${counts.MELEE} ${fr ? "mêlée" : "melee"}` : "",
    counts.RANGED ? `🏹 ${counts.RANGED} ${fr ? "distance" : "ranged"}` : "",
    counts.unknown ? `❔ ${counts.unknown} ${fr ? (counts.unknown === 1 ? "spé inconnue" : "spés inconnues") : "unknown spec"}` : ""
  ].filter(Boolean).join(" · ");
}
