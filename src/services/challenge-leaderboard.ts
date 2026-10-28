import { readChallenge, type ChallengeEvidence } from "./challenge-evidence.js";

export interface ChallengeRun {
  gameEdition?: string; runId: string; instanceId: number; difficultyId: number; dungeonName: string;
  durationSec: number; endedAt: Date; challenge?: unknown;
  evidence?: { completedBy: string | null } | null;
  players: { character: string; realm: string; presentSec?: number | null }[];
}
export interface ChallengeRank<T extends ChallengeRun> {
  group: string; run: T; player: T["players"][number]; challenge: ChallengeEvidence;
}
/** One best in-time key per character, dungeon and affix set. No invented rating points. */
export function rankChallenges<T extends ChallengeRun>(runs: T[], keep: (player: T["players"][number], run: T) => boolean = () => true, overtime = false): ChallengeRank<T>[] {
  const best = new Map<string, ChallengeRank<T>>();
  for (const run of runs) {
    const c = readChallenge(run.challenge);
    if (run.gameEdition !== "retail" || run.difficultyId !== 8 || run.evidence?.completedBy !== "challenge objectives"
      || run.runId.startsWith("SIM-") || !c || c.level < 2 || !c.onTime && !overtime || c.practiceRun || !c.eligibleForScore
      || c.durationMs > c.timeLimitSec * 1000 * (overtime ? 1.4 : 1)
      || c.onTime !== (c.durationMs <= c.timeLimitSec * 1000) || !Number.isFinite(run.durationSec) || run.durationSec < 180) continue;
    const group = `${c.mapId}/${c.affixIds.join(",")}`;
    for (const player of run.players) {
      if (!keep(player, run) || !player.character.trim() || (player.presentSec ?? 0) < run.durationSec * 0.8) continue;
      const id = JSON.stringify([group, player.character.toLowerCase(), player.realm.toLowerCase()]);
      const previous = best.get(id);
      const entry = { group, run, player, challenge: c };
      if (!previous || compare(entry, previous) < 0) best.set(id, entry);
    }
  }
  return [...best.values()].sort((a, b) => a.group.localeCompare(b.group) || compare(a, b)
    || a.player.character.localeCompare(b.player.character) || a.player.realm.localeCompare(b.player.realm));
}
function compare(a: ChallengeRank<ChallengeRun>, b: ChallengeRank<ChallengeRun>): number {
  return b.challenge.level - a.challenge.level || a.challenge.durationMs - b.challenge.durationMs
    || a.run.endedAt.getTime() - b.run.endedAt.getTime() || a.run.runId.localeCompare(b.run.runId);
}
export function challengeClock(milliseconds: number): string {
  return `${Math.floor(milliseconds / 60000)}:${(Math.floor(milliseconds / 1000) % 60).toString().padStart(2, "0")}.${(milliseconds % 1000).toString().padStart(3, "0")}`;
}
