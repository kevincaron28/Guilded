import type { AiLevel } from "./tcg-ai.js";
import type { ClassKey, DeckList, MatchState } from "./tcg-engine-types.js";
import { createMatch, START_HEALTH } from "./tcg-engine.js";

// Guilded Clash PvE dungeon gauntlet (docs/plans/APP_TCG_GAME.md section 4.1): five AI bosses, each with a Zone that is
// already in play when the match starts and extra Health. Everything here is data, so balance patches are data-only.
// The decks are frozen lists (checked legal by tests) generated from the tuned-deck builder in tcg-sim.ts.

export interface BossReward { dust: number; packs: number }
export interface Boss {
  id: string;
  name: string;
  /** Original name and lore: no real dungeon, raid or boss names (design section 3.4). */
  flavour: string;
  cls: ClassKey;
  level: AiLevel;
  /** The Zone card that is in play from the first turn (the boss owns it). */
  zone: string;
  /** Boss starting and maximum Health (the player has START_HEALTH; scaled down with it on 10 November 2026). */
  health: number;
  deck: readonly string[];
  reward: BossReward;
}

export const GAUNTLET: readonly Boss[] = [
  {
    id: "boss-1", name: "The Emberdeep Brute", flavour: "He found the chasm warm and decided to stay.", cls: "warrior", level: "easy", zone: "133", health: 16,
    deck: ["001", "001", "002", "002", "003", "003", "004", "004", "005", "005", "006", "006", "007", "007", "008", "008", "009", "009", "111", "111", "118", "118", "131", "131"],
    reward: { dust: 20, packs: 0 }
  },
  {
    id: "boss-2", name: "Matron of Briar Hollow", flavour: "Gentle as thorns, and just as patient.", cls: "druid", level: "normal", zone: "135", health: 18,
    deck: ["089", "089", "090", "091", "092", "093", "093", "094", "096", "096", "097", "098", "098", "099", "100", "107", "108", "108", "113", "116", "117", "121", "125", "133"],
    reward: { dust: 30, packs: 0 }
  },
  {
    id: "boss-3", name: "The Echo Seer", flavour: "Say it once. She will say it twice.", cls: "mage", level: "normal", zone: "136", health: 20,
    deck: ["067", "067", "068", "069", "070", "071", "072", "073", "074", "075", "077", "102", "107", "115", "116", "117", "117", "121", "124", "124", "125", "125", "130", "133"],
    reward: { dust: 40, packs: 0 }
  },
  {
    id: "boss-4", name: "Warlord of the Ashfall", flavour: "You cannot see him. You can only smell him.", cls: "warlock", level: "hard", zone: "137", health: 22,
    deck: ["078", "079", "080", "081", "082", "082", "083", "084", "085", "085", "086", "087", "088", "107", "109", "115", "116", "117", "120", "120", "121", "125", "125", "133"],
    reward: { dust: 60, packs: 1 }
  },
  {
    id: "boss-5", name: "Warden of the Cairn", flavour: "The kings are watching. So is she.", cls: "paladin", level: "hard", zone: "138", health: 24,
    deck: ["012", "012", "013", "014", "014", "015", "015", "016", "018", "018", "019", "019", "020", "020", "021", "107", "110", "117", "117", "121", "123", "125", "125", "133"],
    reward: { dust: 80, packs: 2 }
  }
];

/** Starts a boss match: the player is seat 0, the boss seat 1 with its Zone in play and its Health. */
export function createGauntletMatch(seed: number, player: DeckList, boss: Boss): MatchState {
  return createMatch(seed, player, { cls: boss.cls, cards: [...boss.deck] }, { zone: { card: boss.zone, owner: 1 }, hp: [START_HEALTH, boss.health] });
}

/** Total reward for clearing the first `defeated` bosses of a run. */
export function runReward(defeated: number, featured = false): BossReward {
  const total = { dust: 0, packs: 0 };
  for (const boss of GAUNTLET.slice(0, defeated)) { total.dust += boss.reward.dust; total.packs += boss.reward.packs; }
  if (featured) { total.dust *= 2; if (defeated >= GAUNTLET.length) total.packs += 1; }
  return total;
}

/** The weekly featured run: which week of the year-long rotation it is (weeks since 2026-11-02, a Monday) and what changes. */
export function featuredRun(now: Date): { week: number; boss: Boss; note: string } {
  const week = Math.max(0, Math.floor((now.getTime() - Date.UTC(2026, 10, 2)) / (7 * 86_400_000)));
  const boss = GAUNTLET[week % GAUNTLET.length]!;
  return { week, boss, note: `Featured: double dust for this run, and a bonus pack for clearing all five. This week's spotlight boss is ${boss.name}.` };
}
