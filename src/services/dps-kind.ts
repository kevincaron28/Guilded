import type { RaidRole } from "../generated/prisma/client.js";
import { WOW_SPECIALIZATIONS, canonicalSpecialization, type WowClass, type WowSpecialization } from "../wow-specializations.js";
import { canonicalClass } from "./character-display.js";

// Melee or ranged damage, worked out from the class and spec the addon records (or the spec a
// player picked for one raid). Survival Hunters are melee on Retail only; every other spec plays
// the same way in each WoW edition. A tank or healer spec signed up as DPS falls back to the
// class's usual damage spec, and Druids and Shamans without a known spec stay unknown.

export type DpsKind = "MELEE" | "RANGED";
export const DPS_KINDS: readonly DpsKind[] = ["MELEE", "RANGED"];
export type SpecRole = "TANK" | "HEALER" | DpsKind;

const TANKS = new Set(["Warrior:Protection", "Paladin:Protection", "Druid:Guardian", "Death Knight:Blood", "Monk:Brewmaster", "Demon Hunter:Vengeance"]);
const HEALERS = new Set(["Paladin:Holy", "Priest:Discipline", "Priest:Holy", "Shaman:Restoration", "Druid:Restoration", "Monk:Mistweaver", "Evoker:Preservation"]);
const RANGED_SPECS = new Set(["Hunter:Beast Mastery", "Hunter:Marksmanship", "Priest:Shadow", "Shaman:Elemental", "Mage:Arcane", "Mage:Fire", "Mage:Frost",
  "Warlock:Affliction", "Warlock:Demonology", "Warlock:Destruction", "Druid:Balance", "Demon Hunter:Devourer", "Evoker:Devastation", "Evoker:Augmentation"]);
// The class's damage kind when its spec is unknown or not a damage spec.
const CLASS_KIND: Partial<Record<WowClass, DpsKind>> = {
  Warrior: "MELEE", Paladin: "MELEE", Rogue: "MELEE", "Death Knight": "MELEE", Monk: "MELEE", "Demon Hunter": "MELEE",
  Hunter: "RANGED", Priest: "RANGED", Mage: "RANGED", Warlock: "RANGED", Evoker: "RANGED"
};

/** What a spec does in a group: tank, healer, melee or ranged damage. */
export function specRole(spec: WowSpecialization): SpecRole {
  if (TANKS.has(spec.key)) return "TANK";
  if (HEALERS.has(spec.key)) return "HEALER";
  if (spec.key === "Hunter:Survival") return "RANGED";
  return RANGED_SPECS.has(spec.key) ? "RANGED" : "MELEE";
}

/** Melee or ranged for a DPS player, or null when it cannot be told (no class, or a Druid/Shaman with no spec). */
export function dpsKind(className: string | null | undefined, spec: string | null | undefined): DpsKind | null {
  const name = canonicalClass(className);
  if (!name) return null;
  const known = canonicalSpecialization(name, spec);
  const role = known ? specRole(known) : null;
  if (role === "MELEE" || role === "RANGED") return role;
  return CLASS_KIND[name] ?? null;
}

/** The specs of a class that fit a raid role, for the "Playing a different spec?" menu. */
export function specsForRole(className: string | null | undefined, role: RaidRole): WowSpecialization[] {
  const name = canonicalClass(className);
  if (!name) return [];
  return WOW_SPECIALIZATIONS.filter(spec => spec.className === name && forever(spec)
    && (role === "DPS" ? ["MELEE", "RANGED"].includes(specRole(spec)) : specRole(spec) === role));
}

// WoW Forever uses the Classic talent trees: the rogue tree is Combat (not Outlaw), there is no Guardian
// druid tree, and Demon Hunters and Evokers do not exist (the class list is checked by the caller).
function forever(spec: WowSpecialization): boolean {
  return !["Rogue:Outlaw", "Demon Hunter:Devourer", "Evoker:Augmentation", "Druid:Guardian"].includes(spec.key);
}

/** The spec that counts for a signup: the one picked for this raid, else the character's own. */
export const signupSpec = (signup: { spec?: string | null }, character?: { spec?: string | null } | null) => signup.spec?.trim() || character?.spec || null;
