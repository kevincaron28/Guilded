import { characterId } from "./public-score.js";
import { cleanCharacterName, displayCharacterName, fullNameBook } from "./character-display.js";
import { PUBLIC_LIMITS } from "./public-runs.js";
import type { LeaderPlayer, LeaderRun } from "./public-leaderboard.js";

// One run, one row; one player, one name (website leaderboards, 9.0.1).
// - Older uploads name a Forever character by its first name ("Hulke") while newer ones and the
//   other party members' copies use "Hulke Hogan". Every player is read as the canonical
//   character (displayCharacterName with a book of the full names the runs themselves show), so a
//   party never lists a person twice and the character board has one row per person.
// - Each party member's addon can report the same clear under its own run id (an observer copy).
//   Copies of the same dungeon whose time windows overlap, whose length and finish agree as the
//   upload check does (PUBLIC_LIMITS) and whose parties overlap are read as one run.
// Nothing is rewritten in the database: this is a read-time view, so a wrong merge is undone by
// changing this file.

const SAME_RUN_LOOKBACK = 25;
const forever = (run: LeaderRun) => (run.gameEdition ?? "forever") === "forever";

/** Richer of two reports of the same player: the first one's values, gaps filled from the second. */
function mergePlayer(a: LeaderPlayer, b: LeaderPlayer): LeaderPlayer {
  const aliases = [...new Set([...(a.aliases ?? []), ...(b.aliases ?? [])])];
  const presentSec = a.presentSec == null && b.presentSec == null ? null : Math.max(a.presentSec ?? 0, b.presentSec ?? 0);
  return { ...a, className: a.className ?? b.className, role: a.role ?? b.role, level: a.level ?? b.level, minLevel: a.minLevel ?? b.minLevel ?? null,
    presentSec, ...(a.integrity === undefined && b.integrity !== undefined ? { integrity: b.integrity } : {}), ...(aliases.length ? { aliases } : {}) };
}

function dedupePlayers(players: LeaderPlayer[]): LeaderPlayer[] {
  const byId = new Map<string, LeaderPlayer>();
  for (const player of players) {
    const id = characterId(player);
    const old = byId.get(id);
    byId.set(id, old ? mergePlayer(old, player) : player);
  }
  return [...byId.values()];
}

/** Every run read with canonical player names and no repeated player. Other editions are left as stored. */
export function canonicalPlayers(runs: LeaderRun[]): LeaderRun[] {
  const names: { name: string }[] = [];
  for (const run of runs) {
    if (!forever(run)) continue;
    for (const player of run.players) for (const name of [player.character, player.displayName]) {
      const cleaned = name ? cleanCharacterName(name, player.realm) : "";
      if (cleaned.includes(" ")) names.push({ name: cleaned });
    }
  }
  const book = fullNameBook(names);
  return runs.map((run) => {
    if (!forever(run)) return { ...run, players: dedupePlayers(run.players) };
    const players = run.players.map((player): LeaderPlayer => {
      const full = displayCharacterName({ name: player.character, displayName: player.displayName ?? null, realm: player.realm }, book);
      const aliases = [...new Set([...(player.aliases ?? []), ...(player.character.toLowerCase() === full.toLowerCase() ? [] : [player.character.toLowerCase()])])];
      return { ...player, character: full, displayName: full, ...(aliases.length ? { aliases } : {}) };
    });
    return { ...run, players: dedupePlayers(players) };
  });
}

/** Whether two canonical runs are copies of one clear: same dungeon, overlapping windows, one finish, one party. */
export function sameRun(a: LeaderRun, b: LeaderRun): boolean {
  if ((a.gameEdition ?? "forever") !== (b.gameEdition ?? "forever") || a.instanceId !== b.instanceId || a.difficultyId !== b.difficultyId) return false;
  if (a.routeKey && b.routeKey && a.routeKey !== b.routeKey) return false;
  if (!!a.challenge !== !!b.challenge) return false;
  if (Math.abs(a.durationSec - b.durationSec) > PUBLIC_LIMITS.agreeDurationSec || Math.abs(a.endedAt.getTime() - b.endedAt.getTime()) > PUBLIC_LIMITS.agreeEndSec * 1000) return false;
  const endA = a.endedAt.getTime(), endB = b.endedAt.getTime();
  const overlap = Math.min(endA, endB) - Math.max(endA - a.durationSec * 1000, endB - b.durationSec * 1000);
  // Two clears by one party cannot overlap in time, so a window that truly overlaps is one clear.
  if (overlap < 0.5 * Math.min(a.durationSec, b.durationSec) * 1000) return false;
  const mine = new Set(a.players.map(characterId));
  const shared = b.players.filter((player) => mine.has(characterId(player))).length;
  return shared / Math.max(a.players.length, b.players.length, 1) >= PUBLIC_LIMITS.agreePlayers;
}

const better = (a: LeaderRun, b: LeaderRun) =>
  Number(!!b.evidence) - Number(!!a.evidence) || b.confirmations - a.confirmations || b.players.length - a.players.length || a.runId.localeCompare(b.runId);

function mergeGroup(group: LeaderRun[]): LeaderRun {
  if (group.length === 1) return group[0]!;
  const [primary, ...rest] = [...group].sort(better) as [LeaderRun, ...LeaderRun[]];
  const players = dedupePlayers([...primary.players, ...rest.flatMap((run) => run.players)]);
  // Each copy is another party member's own report of the clear.
  return { ...primary, players, confirmations: group.reduce((sum, run) => sum + run.confirmations, 0), mergedIds: group.map((run) => run.runId).sort() };
}

/** Runs that are copies of one clear become one run (the best report, every player once). Order follows the first copy. */
export function mergeCopies(runs: LeaderRun[]): LeaderRun[] {
  const buckets = new Map<string, { run: LeaderRun; index: number }[]>();
  runs.forEach((run, index) => {
    const bucket = `${run.gameEdition ?? "forever"}:${run.instanceId}:${run.difficultyId}`;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), { run, index }]);
  });
  const merged: { run: LeaderRun; index: number }[] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.run.endedAt.getTime() - b.run.endedAt.getTime() || a.run.runId.localeCompare(b.run.runId));
    const groups: { runs: LeaderRun[]; index: number }[] = [];
    for (const { run, index } of bucket) {
      const target = groups.slice(-SAME_RUN_LOOKBACK).reverse().find((group) => group.runs.some((other) => sameRun(other, run)));
      if (target) { target.runs.push(run); target.index = Math.min(target.index, index); } else groups.push({ runs: [run], index });
    }
    for (const group of groups) merged.push({ run: mergeGroup(group.runs), index: group.index });
  }
  return merged.sort((a, b) => a.index - b.index).map((entry) => entry.run);
}

/** The read-time view of the public runs: canonical names, no repeated player, one row per clear. */
export function normalizeLeaderRuns(runs: LeaderRun[]): LeaderRun[] {
  return mergeCopies(canonicalPlayers(runs));
}
