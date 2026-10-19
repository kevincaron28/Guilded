import { EmbedBuilder } from "discord.js";
import type { Lang } from "../i18n.js";
import { BETA_DUNGEONS } from "./dungeon-beta-preset.js";
import { DEFAULT_DUNGEON_BRACKETS, DEFAULT_OVERLEVEL_PENALTY } from "./dungeon-november-rules.js";
import { novemberDungeonCatalog } from "./dungeon-november-catalog.js";

// PROVISIONAL all-level plan (owner request, 18 October 2026): a starting point
// until real launch runs replace it. Never season rules: it has no map IDs,
// encounter evidence or difficulty, so it cannot create or activate a season.
// "beta": level range from the Forever beta client and the guild's beta design
// target (src/services/dungeon-beta-preset.ts), clipped to the bracket.
// "estimate": the usual Classic range, or the catalog's order for new dungeons.
export type PlanSource = "beta" | "estimate";
// mapKey: the map ID (and Scarlet wing) real beta-client runs reported; absent when none has been seen.
export interface PlannedRoute { id: string; bracket: string; min: number; max: number; minutes: number; source: PlanSource; mapKey?: string }

const beta = (id: string, key: string, bracket: string, min?: number, max?: number): PlannedRoute => {
  const d = BETA_DUNGEONS.find(b => b.key === key)!;
  return { id, bracket, min: min ?? d.min, max: max ?? d.max, minutes: d.minutes, source: "beta", mapKey: d.key };
};
const guess = (id: string, bracket: string, min: number, max: number, minutes: number, mapKey?: string): PlannedRoute =>
  ({ id, bracket, min, max, minutes, source: "estimate", ...(mapKey ? { mapKey } : {}) });

export const BRACKET_PLAN: PlannedRoute[] = [
  beta("ragefire-chasm", "389", "15-29", 15),
  beta("hall-of-thanes", "3065", "15-29", 15),
  beta("wailing-caverns", "43", "15-29"),
  beta("ruins-of-lordaeron", "2999", "15-29"),
  beta("deadmines", "36", "15-29"),
  beta("shadowfang-keep", "33", "15-29", 20, 29),
  beta("stockade", "34", "15-29", 24, 29),
  beta("blackfathom-deeps", "48", "15-29", 24, 29),
  beta("excavation-wetlands", "2998", "15-29", 26, 29),
  beta("scarlet-graveyard", "189:graveyard", "15-29", 26, 29),
  beta("city-of-dalaran", "2959", "30-44", 30, 36),
  beta("gnomeregan", "90", "30-44", 30, 38),
  beta("razorfen-kraul", "47", "30-44", 30, 38),
  beta("scarlet-library", "189:library", "30-44", 30, 36),
  guess("scarlet-armory", "30-44", 32, 42, 25, "189:armory"),
  guess("drowned-city", "30-44", 34, 42, 35),
  guess("scarlet-cathedral", "30-44", 35, 44, 25, "189:cathedral"),
  beta("razorfen-downs", "129", "30-44", 35, 44),
  guess("kroldok-stronghold", "30-44", 38, 44, 35),
  beta("uldaman", "70", "30-44", 38, 44),
  guess("zulfarrak", "45-59", 45, 54, 40),
  guess("maraudon", "45-59", 46, 55, 50),
  guess("alcaz-prison", "45-59", 48, 56, 35),
  guess("sunken-temple", "45-59", 50, 59, 45),
  guess("blackrock-depths", "60", 60, 60, 50),
  guess("dire-maul-east", "60", 60, 60, 25),
  guess("blackmaw-hold", "60", 60, 60, 35),
  guess("lower-blackrock-spire", "60", 60, 60, 45),
  guess("dire-maul-north", "60", 60, 60, 30),
  guess("dire-maul-west", "60", 60, 60, 35),
  guess("scholomance", "60", 60, 60, 45),
  guess("shapers-terrace", "60", 60, 60, 35),
  guess("stratholme-main", "60", 60, 60, 40),
  guess("stratholme-service", "60", 60, 60, 35)
];

/** Problems with the plan against the default brackets; empty when it could fill a version 6 season. */
export function bracketPlanProblems(plan = BRACKET_PLAN, brackets: readonly { key: string; min: number; max: number; bestCount: number }[] = DEFAULT_DUNGEON_BRACKETS): string[] {
  const names = new Set(novemberDungeonCatalog().routes.map(r => r.id));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of plan) {
    const b = brackets.find(x => x.key === r.bracket);
    if (!names.has(r.id)) problems.push(`${r.id}: not in the November catalog`);
    if (seen.has(r.id)) problems.push(`${r.id}: listed twice`);
    if (!b || r.min < b.min || r.max > b.max || r.min > r.max) problems.push(`${r.id}: ${r.min}-${r.max} is not inside bracket ${r.bracket}`);
    if (!Number.isInteger(r.minutes) || r.minutes < 5 || r.minutes > 120) problems.push(`${r.id}: target out of range`);
    seen.add(r.id);
  }
  for (const b of brackets) {
    const count = plan.filter(r => r.bracket === b.key).length;
    if (count < b.bestCount) problems.push(`bracket ${b.key}: ${count} routes for best ${b.bestCount}`);
  }
  return problems;
}

export function bracketPlanEmbed(lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const names = new Map(novemberDungeonCatalog().routes.map(r => [r.id, r.name]));
  const p = DEFAULT_OVERLEVEL_PENALTY;
  return new EmbedBuilder().setColor(0x8b5cf6)
    .setTitle(fr ? "Tous niveaux · plan provisoire" : "All levels · provisional plan")
    .setDescription(fr
      ? `Recommandations en attendant de vrais chronos du lancement; rien n'est activé. Plage = niveaux admis pour la cote; cible = temps pour 200 points. Au-dessus de la plage : −${p.percentPerLevel} % par niveau, jusqu’à ${p.maxLevels} niveaux; au-delà : 0. * = estimation (sinon données bêta).`
      : `Recommendations until real launch timings replace them; nothing is activated. Range = levels allowed for rating; target = time for 200 points. Above the range: −${p.percentPerLevel}% per level, up to ${p.maxLevels} levels; beyond: 0. * = estimate (otherwise beta data).`)
    .addFields(DEFAULT_DUNGEON_BRACKETS.map(b => ({
      name: `${b.min === b.max ? `${fr ? "Niveau" : "Level"} ${b.min}` : `${fr ? "Niveaux" : "Levels"} ${b.min}–${b.max}`} · ${fr ? `${b.bestCount} meilleurs` : `best ${b.bestCount}`}`,
      value: BRACKET_PLAN.filter(r => r.bracket === b.key)
        .map(r => `${names.get(r.id) ?? r.id}${r.source === "estimate" ? "*" : ""} · ${r.min === r.max ? r.min : `${r.min}–${r.max}`} · ${r.minutes} min`).join("\n").slice(0, 1024)
    })))
    .setFooter({ text: fr ? "Provisoire · 18 octobre 2026 · aucune activation" : "Provisional · October 18, 2026 · not activated" });
}
