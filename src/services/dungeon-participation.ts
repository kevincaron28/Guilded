import { competitionReason, ratingDungeonKey, type LevelBand } from "./dungeon-rating.js";
import { resolveNovemberRoute, type NovemberRoute } from "./dungeon-november-rules.js";

// Version 5 and 6 rules both freeze routes; only the routes matter here.
type RouteRules = { routes: NovemberRoute[] };

export interface ParticipationRun {
  instanceId: number;
  difficultyId: number;
  durationSec: number | null;
  completedBy: string | null;
  competitionData: unknown;
  startedAt?: Date | null;
  endedAt?: Date | null;
  players: { character: string; memberId: string | null; presentSec: number }[];
}

export function participationDungeonKey(run: ParticipationRun, rules?: RouteRules): string {
  if (rules) return resolveNovemberRoute(run, rules).key;
  return ratingDungeonKey({ ...run, players: run.players.map(p => ({ ...p, member: null })) });
}

export function participationRecordEligible(run: ParticipationRun, band: LevelBand | undefined, rules?: RouteRules): boolean {
  if (rules && resolveNovemberRoute(run, rules).reason) return false;
  return run.completedBy === "final boss" && !!run.durationSec && run.durationSec > 0
    && run.players.some(p => p.memberId && p.presentSec >= run.durationSec! * 0.5)
    && (rules !== undefined || participationDungeonKey(run) !== "189")
    && competitionReason({ ...run, players: run.players.map(p => ({ ...p, member: null })) }, band) === undefined;
}

// Presence is observed for the whole run; a participant history is not a party-size check.
export function participationMode(run: ParticipationRun, character: string, band: LevelBand | undefined, rules?: RouteRules): "none" | "completion" | "helper" | "full" {
  if (rules && (run.completedBy !== "final boss" || resolveNovemberRoute(run, rules).reason)) return "none";
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
  return participationRecordEligible(run, band, rules) ? "full" : "completion";
}
