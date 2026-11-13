import type { PrismaClient } from "../generated/prisma/client.js";
import { bracketedVerdict, levelRecorded, presentEnough } from "./dungeon-rating.js";
import { leniencyOf, validBracketedRules } from "./dungeon-november-rules.js";
import { withIntegrityWindow } from "./dungeon-integrity.js";

// Why a dungeon board is empty (9.1.1). It walks every stored run of the guild through the same rules the board's rating
// uses (dungeon-rating.ts `dungeonRating` query + `calculateDungeonRating`) and names the first thing that keeps the run
// off the board, so an officer reads "12 runs received, 9 not ranked: ..." instead of an unexplained "No points yet".
// Read only. The wording is meant for members, so it avoids table and column names.

type Db = Pick<PrismaClient, "dungeonRun" | "dungeonSeason">;
type SeasonRow = { id: string; name: string; startsAt: Date; endsAt: Date | null; ratingRules: unknown; status: string };

export interface DiagnosedRun {
  id: string; runRef: string; dungeonName: string; seasonId: string | null; valid: boolean; invalidReason: string | null; state: string;
  completedBy: string | null; durationSec: number | null; startedAt: Date | null; endedAt: Date | null; createdAt: Date;
  instanceId: number; difficultyId: number; competitionData: unknown;
  players: { character: string; memberId: string | null; presentSec: number; inGuild: boolean; member: { guildId: string } | null }[];
}

export interface BoardDiagnosis {
  season: { id: string; name: string } | null;
  received: number;
  counted: number;
  /** First reason -> number of runs, most common first. */
  reasons: { reason: string; runs: number }[];
}

/** The first reason this run is not on the season's board, or null when at least one player of it is rated. Pure. */
export function whyNotOnBoard(run: DiagnosedRun, season: SeasonRow, guildId: string, seasons: ReadonlyMap<string, string> = new Map()): string | null {
  if (!run.valid) return `rejected by the bot (${run.invalidReason ?? "invalid"})`;
  if (run.runRef.startsWith("SIM-")) return "a simulation run";
  if (run.state !== "COMPLETED") return "not completed (left early or no final boss)";
  if (run.completedBy !== "final boss") return "the final boss kill was not detected";
  if (!run.durationSec || run.durationSec <= 0) return "no duration";
  if (run.seasonId !== season.id) return `stored under ${seasons.get(run.seasonId ?? "") ?? "another season"}`;
  if (!run.startedAt || run.startedAt < season.startsAt) return `started before ${season.name} began`;
  if (season.endsAt && (!run.endedAt || run.endedAt >= season.endsAt)) return `ended after ${season.name} ended`;
  const evidence = { instanceId: run.instanceId, difficultyId: run.difficultyId, durationSec: run.durationSec, completedBy: run.completedBy, startedAt: run.startedAt,
    endedAt: run.endedAt, createdAt: run.createdAt, competitionData: run.competitionData, runRef: run.runRef,
    players: run.players.map(p => ({ character: p.character, memberId: p.memberId, presentSec: p.presentSec, role: null as string | null, inGuild: p.inGuild, member: null })) };
  const bracketed = validBracketedRules(season.ratingRules);
  const rules = bracketed ? withIntegrityWindow(season.ratingRules as never, season.startsAt, season.endsAt) as import("./dungeon-november-rules.js").BracketedRules : null;
  if (rules) {
    const verdict = bracketedVerdict(evidence as never, rules);
    if (verdict.reason) return verdict.reason === "Dungeon route unknown" ? "the dungeon route could not be identified (map or difficulty not in the season rules)" : verdict.reason.charAt(0).toLowerCase() + verdict.reason.slice(1);
  }
  const presence = rules ? leniencyOf(rules).presence : 0.8;
  const present = run.players.filter(p => presentEnough(p.presentSec, run.durationSec!, presence));
  if (!present.length) return `nobody was in the run for ${Math.round(presence * 100)}% of its time`;
  const rated = present.filter(p => (p.memberId && p.member?.guildId === guildId) || (!p.memberId && p.inGuild));
  if (!rated.length) return "no player is linked to a member of this server (link characters with the companion or /guilded verify)";
  if (rules && !rated.some(p => levelRecorded(evidence as never, p.character))) return "no player's level was recorded in the run";
  return null;
}

/** Pure part of the diagnosis, so tests and the script share it. */
export function diagnoseRuns(runs: DiagnosedRun[], season: SeasonRow | null, guildId: string, seasons: ReadonlyMap<string, string> = new Map()): BoardDiagnosis {
  const reasons = new Map<string, number>();
  let counted = 0;
  for (const run of runs) {
    const why = season ? whyNotOnBoard(run, season, guildId, seasons) : "no season is running";
    if (why === null) counted++; else reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  return { season: season ? { id: season.id, name: season.name } : null, received: runs.length, counted,
    reasons: [...reasons].map(([reason, count]) => ({ reason, runs: count })).sort((a, b) => b.runs - a.runs || a.reason.localeCompare(b.reason)) };
}

export async function diagnoseDungeonBoard(database: Db, guildId: string, limit = 500): Promise<BoardDiagnosis> {
  const season = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  const runs = await database.dungeonRun.findMany({ where: { guildId }, orderBy: { endedAt: "desc" }, take: limit,
    select: { id: true, runRef: true, dungeonName: true, seasonId: true, valid: true, invalidReason: true, state: true, completedBy: true, durationSec: true,
      startedAt: true, endedAt: true, createdAt: true, instanceId: true, difficultyId: true, competitionData: true,
      players: { select: { character: true, memberId: true, presentSec: true, inGuild: true, member: { select: { guildId: true } } } } } });
  const names = new Map((await database.dungeonSeason.findMany({ where: { guildId }, select: { id: true, name: true } })).map(s => [s.id, s.name] as const));
  return diagnoseRuns(runs as DiagnosedRun[], season, guildId, names);
}

/** The line under an empty board (English or French), or null when the board has scores to show. */
export function emptyBoardNote(diagnosis: BoardDiagnosis, lang: "en" | "fr"): string | null {
  if (diagnosis.counted > 0) return null;
  const fr = lang === "fr";
  if (!diagnosis.received) return fr
    ? "Aucun parcours reçu pour l'instant. Le compagnon Guilded doit tourner sur un PC avec l'addon (la connexion Discord est facultative), puis /reload ou déconnexion en jeu après le donjon."
    : "No dungeon run has reached the bot yet. The Guilded Companion must be running on a PC with the addon (signing in with Discord is optional), then /reload or log out in game after the dungeon.";
  const top = diagnosis.reasons.slice(0, 3).map(item => `${item.runs} × ${item.reason}`).join("; ");
  return fr
    ? `Aucun parcours classé : ${diagnosis.received} reçu(s), aucun ne compte (${top}). Détail : /dungeon-admin audit why:true.`
    : `No ranked run yet: ${diagnosis.received} received, none counted (${top}). Details: /dungeon-admin audit why:true.`;
}

export function boardDiagnosisReport(guildName: string, diagnosis: BoardDiagnosis): string {
  return [`${guildName}: season ${diagnosis.season?.name ?? "(none active)"}, ${diagnosis.received} run(s) received, ${diagnosis.counted} on the board.`,
    ...diagnosis.reasons.map(item => `  ${String(item.runs).padStart(3)} × ${item.reason}`)].join("\n");
}
