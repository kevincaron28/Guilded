import { characterKey } from "../../companion/character-identity.mjs";
import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { readDungeonIntegrity, readPlayerIntegrity, type PlayerIntegrity } from "./dungeon-integrity.js";

export interface ObservationReport {
  observer: string; startedAt: number; endedAt: number;
  players: { character: string; realm: string; integrity?: unknown }[];
}
const identity = (name: string, realm: string, edition: string) => characterKey(name, realm, edition);

/** Only comparable server-clock intervals, never addition/max of aggregate seconds. */
export function intervalUnion(intervals: [number, number][], from: number, to: number): [number, number][] {
  const result: [number, number][] = [];
  for (const [a, b] of intervals.filter(([a,b]) => Number.isInteger(a) && Number.isInteger(b) && a >= from && b <= to && a < b).sort((a,b)=>a[0]-b[0] || a[1]-b[1])) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a,b]);
  }
  return result;
}

export function observationReport(value: unknown, players: ObservationReport["players"], from: number, to: number, edition: string): ObservationReport | null {
  const run = readDungeonIntegrity(value);
  if (!run?.observer || !Number.isInteger(from) || !Number.isInteger(to) || to <= from || to-from > 14400
    || !players.some(p=>identity(p.character,p.realm,edition)===identity(run.observer!,"",edition))) return null;
  return { observer: run.observer, startedAt: from, endedAt: to, players };
}

/** A self report is preferred for that player; it is client evidence, not anti-cheat proof.
 * Retain source labels in the derived result. Relays of one observer never add witnesses.
 */
export function reconcileParticipation(reports: ObservationReport[], player: {character:string;realm:string}, from: number, to: number, edition: string):
  (PlayerIntegrity & { observers: string[]; basis: "self" | "local" }) | null {
  const id = identity(player.character,player.realm,edition);
  const comparable = reports.filter(r=>Math.abs(r.startedAt-from)<=30 && Math.abs(r.endedAt-to)<=30);
  const sources = comparable.flatMap(report => {
    const p = report.players.find(p=>identity(p.character,p.realm,edition)===id), seen = readPlayerIntegrity(p?.integrity);
    if (!seen?.knownIntervals) return [];
    const intervals = intervalUnion(seen.knownIntervals,report.startedAt,report.endedAt);
    const known = intervals.reduce((sum,[a,b])=>sum+b-a,0);
    // A malformed source is retained by ingestion but cannot supply derived credit.
    if (known !== seen.knownSec || seen.knownSec+seen.unknownSec > report.endedAt-report.startedAt) return [];
    return [{report,seen,intervals,self:identity(report.observer,"",edition)===id}];
  });
  const selected = sources.some(s=>s.self) ? sources.filter(s=>s.self) : sources;
  if (!selected.length) return null;
  const intervals = intervalUnion(selected.flatMap(s=>s.intervals),from,to).slice(0,64);
  const knownSec = intervals.reduce((sum,[a,b])=>sum+b-a,0);
  const roles = new Set(selected.map(s=>dungeonRole(s.seen.lockedRole)).filter(Boolean));
  const mixedRole = selected.some(s=>s.seen.mixedRole) || roles.size > 1;
  const role = !mixedRole && roles.size===1 ? [...roles][0]! : undefined;
  return { knownSec, unknownSec:to-from-knownSec, knownIntervals:intervals,
    ...(role ? {lockedRole:role as "TANK"|"HEALER"|"DPS"} : {}), mixedRole,
    observers:[...new Set(selected.map(s=>identity(s.report.observer,"",edition)))].sort(), basis:selected[0]!.self?"self":"local" };
}
