import { z } from "zod";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";

// Planning metadata is immutable for a session. Unknown queue rules never become
// permission to queue a raid-sized roster. No capture or statistics consent here.
export const battlegroundPlanSchema = z.object({
  version: z.literal(1),
  edition: z.enum(GAME_EDITIONS),
  realmType: z.literal("normal"),
  mode: z.enum(["casual", "rated", "blitz"]),
  map: z.string().trim().min(2).max(70),
  minLevel: z.number().int().min(10).max(90),
  maxLevel: z.number().int().min(10).max(90),
  faction: z.enum(["Alliance", "Horde"]),
}).strict().refine(p => p.minLevel <= p.maxLevel, "Invalid level bracket");
export type BattlegroundPlan = z.infer<typeof battlegroundPlanSchema>;
export function readBattlegroundPlan(value: unknown): BattlegroundPlan | null {
  return value == null ? null : battlegroundPlanSchema.parse(value);
}

export function battlegroundQueuePolicy(plan: BattlegroundPlan) {
  // Blizzard's published Blitz rules permit solo/duo, with a healer in a duo.
  // This is the queue-party size, not the eight-person match team capacity.
  // https://worldofwarcraft.blizzard.com/en-gb/news/24119590
  if (plan.edition === "retail" && plan.mode === "blitz") {
    return { review: "blitz-duo-2026-10-30", partyLimit: 2, healerRequired: true } as const;
  }
  return null;
}

export function validateBattlegroundSlots(plan: BattlegroundPlan, slots: { tanks: number; healers: number; dps: number }) {
  const counts = Object.values(slots);
  // Five is a product limit for an UNVERIFIED planning lobby, not a claimed
  // legal queue limit. Starting these sessions stays blocked below.
  const policy = battlegroundQueuePolicy(plan);
  const total = counts.reduce((a, b) => a + b, 0);
  if (counts.some(n => !Number.isInteger(n) || n < 0) || total < 2 || total > (policy?.partyLimit ?? 5)) {
    throw new Error("Invalid BG party size / Taille du groupe JcJ invalide.");
  }
  if (policy?.healerRequired && slots.healers < 1) throw new Error("Blitz duo needs a healer / Le duo Blitz exige un soigneur.");
}

export function assertBattlegroundCharacter(plan: BattlegroundPlan, character: { gameEdition: string; level: number | null }) {
  if (character.gameEdition !== plan.edition || character.level == null || character.level < plan.minLevel || character.level > plan.maxLevel) {
    throw new Error("Character edition/level does not fit / Édition ou niveau du personnage incompatible.");
  }
}

export function assertBattlegroundStart(plan: BattlegroundPlan, lineup: { role: string }[]) {
  const policy = battlegroundQueuePolicy(plan);
  if (!policy) throw new Error("Planning only: queue rules await verification / Planification : règles de file à vérifier.");
  if (!lineup.length || lineup.length > policy.partyLimit || (lineup.length > 1 && !lineup.some(p => p.role === "HEALER"))) {
    throw new Error("Blitz requires solo or duo with a healer / Blitz exige solo ou duo avec soigneur.");
  }
}

export function battlegroundDescription(plan: BattlegroundPlan, fr: boolean) {
  const policy = battlegroundQueuePolicy(plan);
  return `${plan.edition} · ${plan.mode} · ${plan.map} · ${plan.minLevel}–${plan.maxLevel} · ${plan.faction}\n`
    + (policy ? (fr ? "File : solo ou duo avec soigneur. Vérifiez votre admissibilité en jeu." : "Queue: solo or duo with a healer. Check eligibility in game.")
      : (fr ? "Planification seulement — règles de file non vérifiées; démarrage bloqué." : "Planning only — queue rules unverified; starting is blocked."))
    + "\n" + (fr ? "Faction et royaume normal à confirmer en jeu. Aucune capture ni statistique activée." : "Confirm faction and normal realm in game. Capture and statistics are off.");
}
