// Guilded Clash daily quests and pack progress (docs/plans/APP_TCG_GAME.md section 5). Pure rules; the store applies them.
//
// Three daily quests, each worth one step toward a pack. A win against the AI (Normal or Hard) or a boss is one step too. Three steps
// make one pack, and at most 3 packs a day can come from play, so grinding is bounded. Steps past the daily cap are dropped.

export interface Quest { id: "win1" | "play3" | "spells10" | "zone1"; target: number; en: string; fr: string }

/** The daily board: three quests chosen from four by the UTC day, so it rotates but is the same for everyone. */
export const QUESTS: readonly Quest[] = [
  { id: "win1", target: 1, en: "Win a match", fr: "Gagner un match" },
  { id: "play3", target: 3, en: "Play 3 matches", fr: "Jouer 3 matchs" },
  { id: "spells10", target: 10, en: "Cast 10 spells", fr: "Lancer 10 sorts" },
  { id: "zone1", target: 1, en: "Play a Zone", fr: "Jouer une Zone" }
];

export const STEPS_PER_PACK = 3;
export const MAX_PLAY_PACKS_PER_DAY = 3;
/** A pack the bank cannot hold (it keeps 3) is paid as dust instead. */
export const OVERFLOW_PACK_DUST = 60;
/** A match counts as played once the member took at least this many turns, so opening a match and leaving is not credited. */
export const MIN_TURNS_COUNTED = 2;

export const dayKey = (now: Date): string => now.toISOString().slice(0, 10);

/** The three quests of a day: all four rotate, one is left out per day. */
export function questsOn(day: string): Quest[] {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const skip = ((n % QUESTS.length) + QUESTS.length) % QUESTS.length;
  return QUESTS.filter((_, i) => i !== skip);
}

export interface DailyCounters { played: number; wins: number; spells: number; zones: number; packsEarned: number; questsDone: string[] }
export const emptyDaily = (): DailyCounters => ({ played: 0, wins: 0, spells: 0, zones: 0, packsEarned: 0, questsDone: [] });

export interface FinishedMatch {
  won: boolean;
  /** The member took enough turns for the match to count (MIN_TURNS_COUNTED). */
  counted: boolean;
  /** Wins of this kind count toward packs (AI Normal and Hard, and bosses; Easy only counts for quests). */
  winCounts: boolean;
  spells: number;
  zones: number;
}

export interface ProgressResult { daily: DailyCounters; packProgress: number; packs: number; questsCompleted: string[]; steps: number }

/** Adds a finished match to the day's counters, credits newly completed quests and wins as steps, and turns steps into packs. */
export function settleProgress(day: string, daily: DailyCounters, packProgress: number, match: FinishedMatch): ProgressResult {
  const next: DailyCounters = { ...daily, questsDone: [...daily.questsDone] };
  if (match.counted) { next.played += 1; next.spells += match.spells; next.zones += match.zones; if (match.won) next.wins += 1; }
  const value: Record<Quest["id"], number> = { win1: next.wins, play3: next.played, spells10: next.spells, zone1: next.zones };
  const questsCompleted: string[] = [];
  for (const quest of questsOn(day)) if (!next.questsDone.includes(quest.id) && value[quest.id] >= quest.target) { next.questsDone.push(quest.id); questsCompleted.push(quest.id); }
  let steps = questsCompleted.length + (match.counted && match.won && match.winCounts ? 1 : 0);
  let progress = packProgress, packs = 0;
  const granted = steps;
  for (; steps > 0; steps--) {
    if (next.packsEarned >= MAX_PLAY_PACKS_PER_DAY) break;
    progress += 1;
    if (progress >= STEPS_PER_PACK) { progress = 0; next.packsEarned += 1; packs += 1; }
  }
  return { daily: next, packProgress: progress, packs, questsCompleted, steps: granted };
}
