import { competitionReason, ratingDungeonKey, type LevelBand } from "./dungeon-rating.js";

export interface ParticipationRun {
  instanceId: number;
  difficultyId: number;
  durationSec: number | null;
  completedBy: string | null;
  competitionData: unknown;
  players: { character: string; memberId: string | null; presentSec: number }[];
}

export function participationDungeonKey(run: ParticipationRun): string {
  return ratingDungeonKey({ ...run, players: run.players.map(p => ({ ...p, member: null })) });
}

export function participationRecordEligible(run: ParticipationRun, band: LevelBand | undefined): boolean {
  return run.completedBy === "final boss" && !!run.durationSec && run.durationSec > 0
    && run.players.some(p => p.memberId && p.presentSec >= run.durationSec! * 0.5)
    && participationDungeonKey(run) !== "189"
    && competitionReason({ ...run, players: run.players.map(p => ({ ...p, member: null })) }, band) === undefined;
}

// Presence is observed for the whole run; a participant history is not a party-size check.
export function participationMode(run: ParticipationRun, character: string, band: LevelBand | undefined): "none" | "completion" | "helper" | "full" {
  const player = run.players.find(p => p.character === character);
  if (!player || !run.durationSec || run.durationSec <= 0 || !Number.isFinite(player.presentSec) || player.presentSec < run.durationSec * 0.5) return "none";
  const levels = (run.competitionData as { players?: { name: string; level: number | null; minLevel: number | null }[] } | null)?.players;
  const level = Array.isArray(levels) ? levels.find(p => p.name === character)?.level : undefined;
  if (band && Number.isInteger(level) && level! > band.max) {
    const helping = run.players.some(p => p.memberId && p.presentSec >= run.durationSec! * 0.5 && levels?.some(l =>
      l.name === p.character && Number.isInteger(l.level) && Number.isInteger(l.minLevel)
      && l.minLevel! >= band.min && l.minLevel! <= l.level! && l.level! <= band.max));
    return helping ? "helper" : "none";
  }
  return participationRecordEligible(run, band) ? "full" : "completion";
}
