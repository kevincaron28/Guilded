import type { WclFightDetails, WclReport } from "../integrations/warcraftlogs.js";
import { findCharacter } from "./character-match.js";

// What the Warcraft Logs data says about raid night, for officers only:
//   * who was in the log versus who was marked present (and who is not linked to anyone)
//   * how often each player came to a boss pull with a flask and food, and how often they died
// Deliberately no damage, healing or parse numbers.

export interface PlayerCheck { name: string; pulls: number; flaskPulls: number; foodPulls: number; deaths: number; }
export interface WclDetails { pulls: number; players: PlayerCheck[]; }

// Flask, phial and elixir buffs count as "flasked"; the Well Fed buff counts as "fed".
const FLASK = /\b(flask|phial|elixir)\b/i;
const FOOD = /well[ -]fed/i;
export const isFlaskBuff = (name: string) => FLASK.test(name);
export const isFoodBuff = (name: string) => FOOD.test(name);

export function buildDetails(report: Pick<WclReport, "actors">, raw: WclFightDetails): WclDetails {
  const nameOf = new Map((report.actors ?? []).map((actor) => [actor.id, actor.name]));
  const rows = new Map<string, PlayerCheck>();
  const row = (name: string) => {
    const existing = rows.get(name) ?? { name, pulls: 0, flaskPulls: 0, foodPulls: 0, deaths: 0 };
    rows.set(name, existing);
    return existing;
  };
  const pullIds = new Set<number>();
  for (const info of raw.combatants) {
    const name = nameOf.get(info.actorId);
    if (!name) continue;
    pullIds.add(info.fight);
    const entry = row(name);
    entry.pulls++;
    if (info.auras.some(isFlaskBuff)) entry.flaskPulls++;
    if (info.auras.some(isFoodBuff)) entry.foodPulls++;
  }
  for (const death of raw.deaths) row(death.name).deaths++;
  return { pulls: pullIds.size, players: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export interface AttendanceCheck {
  presentCount: number;
  inLogNotPresent: string[];
  presentNotInLog: string[];
  unlinked: string[];
  epMissing: boolean;
}

export interface CheckInput {
  logPlayers: string[];
  characters: { name: string; realm: string; memberId: string; memberName: string }[];
  attendance: { memberId: string; memberName: string; status: string }[];
  epPaidMemberIds: ReadonlySet<string>;
}

// Compares the log's player list with the raid's recorded attendance.
export function compareAttendance(input: CheckInput): AttendanceCheck {
  const credited = new Set(["PRESENT", "LATE", "BENCHED"]);
  const present = new Map(input.attendance.filter((row) => credited.has(row.status)).map((row) => [row.memberId, row]));
  const inLog = new Map<string, string>(); // memberId -> the character name seen in the log
  const unlinked: string[] = [];
  for (const name of input.logPlayers) {
    const character = findCharacter(input.characters, name, "");
    if (character) inLog.set(character.memberId, character.memberName);
    else unlinked.push(name);
  }
  const attendanceById = new Map(input.attendance.map((row) => [row.memberId, row]));
  const sorted = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
  return {
    presentCount: present.size,
    inLogNotPresent: sorted([...inLog].filter(([memberId]) => !present.has(memberId)).map(([memberId, memberName]) => {
      const row = attendanceById.get(memberId);
      return row ? `${memberName} (marked ${row.status.toLowerCase()})` : memberName;
    })),
    // Bench players are expected to be missing from the log.
    presentNotInLog: sorted([...present.values()].filter((row) => row.status !== "BENCHED" && !inLog.has(row.memberId)).map((row) => row.memberName)),
    unlinked: sorted(unlinked),
    epMissing: present.size > 0 && ![...present.keys()].some((memberId) => input.epPaidMemberIds.has(memberId))
  };
}

const cap = (names: string[], max = 12) => names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} … +${names.length - max}`;

// The officer-only text: attendance mismatches first, then flasks, food and deaths.
export function formatOfficerCheck(input: { title: string; attendance: AttendanceCheck | null; details: WclDetails | null }): string {
  const lines: string[] = [`🔎 **${input.title}**: check for officers`];
  const { attendance, details } = input;
  if (attendance) {
    lines.push("**Attendance against the log**");
    if (attendance.inLogNotPresent.length) lines.push(`• In the log, not credited: ${cap(attendance.inLogNotPresent)}`);
    if (attendance.presentNotInLog.length) lines.push(`• Credited, not in the log: ${cap(attendance.presentNotInLog)}`);
    if (attendance.unlinked.length) lines.push(`• In the log but not linked to a Discord member (no credit possible): ${cap(attendance.unlinked)}`);
    if (attendance.epMissing) lines.push("• No EP has been awarded for this raid yet (`/lead end`, then approve the EP).");
    if (!attendance.inLogNotPresent.length && !attendance.presentNotInLog.length && !attendance.unlinked.length && !attendance.epMissing) {
      lines.push(`• All ${attendance.presentCount} credited players match the log.`);
    }
  } else {
    lines.push("Not linked to a raid, so attendance was not compared. Link it with `/lead wcl-report raid:<id>`.");
  }
  if (details && details.pulls > 0) {
    const short = (pick: (p: PlayerCheck) => number) => details.players
      .filter((p) => p.pulls > 0 && pick(p) < p.pulls)
      .sort((a, b) => (b.pulls - pick(b)) - (a.pulls - pick(a)) || a.name.localeCompare(b.name))
      .map((p) => `${p.name} (${pick(p)}/${p.pulls})`);
    const noFlask = short((p) => p.flaskPulls);
    const noFood = short((p) => p.foodPulls);
    const dead = details.players.filter((p) => p.deaths > 0).sort((a, b) => b.deaths - a.deaths || a.name.localeCompare(b.name)).map((p) => `${p.name} (${p.deaths})`);
    lines.push(`**Consumables at ${details.pulls} boss pull${details.pulls === 1 ? "" : "s"}** (flask or elixir, and food, active when the pull started)`);
    lines.push(noFlask.length ? `• Missing a flask: ${cap(noFlask)}` : "• Everyone was flasked on every pull.");
    lines.push(noFood.length ? `• Missing food: ${cap(noFood)}` : "• Everyone was fed on every pull.");
    if (dead.length) lines.push(`**Deaths in boss fights:** ${cap(dead, 10)}`);
  } else if (details) {
    lines.push("No boss pulls in this log, so no consumable check.");
  }
  return lines.join("\n").slice(0, 1900);
}
