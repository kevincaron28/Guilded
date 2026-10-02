import type { PrismaClient, RaidAttendanceStatus, RaidSeason } from "@prisma/client";
import { toCsv } from "./exports.js";
import { attendanceRate } from "./merit.js";
import { localParts, zonedTime } from "./raid-time.js";

// A raid attendance season is a date range (RaidSeason). Everything here is derived from the
// raids inside it, so nothing has to be backfilled when a season is created after the fact.

// "UNRECORDED": expected at the raid (signed up, or a main of its core) with no attendance entry.
// It is never counted as an absence. null: not concerned by that raid.
export type SeasonCell = RaidAttendanceStatus | "UNRECORDED" | null;

export interface SeasonRaid { id: string; title: string; scheduledAt: Date; coreId: string | null; coreName: string | null }
export interface SeasonTotals { present: number; late: number; benched: number; absent: number; unrecorded: number; rate: number | null }
export interface SeasonRow extends SeasonTotals { memberId: string; name: string; discordUserId: string; cells: SeasonCell[] }
export interface SeasonAttendance { raids: SeasonRaid[]; rows: SeasonRow[] }

type Db = Pick<PrismaClient, "raid">;
type SeasonDb = Pick<PrismaClient, "raidSeason">;

// Rate over the raids someone recorded: Present and Benched 1, Late 0.5 (as /character who).
// null when nothing was recorded for them.
export function seasonTotals(cells: readonly SeasonCell[]): SeasonTotals {
  const count = (status: SeasonCell) => cells.filter((cell) => cell === status).length;
  const recorded = cells.filter((cell): cell is RaidAttendanceStatus => cell !== null && cell !== "UNRECORDED");
  return {
    present: count("PRESENT"), late: count("LATE"), benched: count("BENCHED"), absent: count("ABSENT"), unrecorded: count("UNRECORDED"),
    rate: recorded.length ? attendanceRate(recorded, recorded.length) : null
  };
}

// Who was where, raid by raid: one row per member, one cell per completed raid of the window
// (oldest first). `until` is exclusive; test raids are left out.
export async function seasonAttendance(database: Db, guildId: string, window: { from: Date; until?: Date | null; coreId?: string | null }): Promise<SeasonAttendance> {
  const person = { select: { displayName: true, discordUserId: true } };
  const raids = await database.raid.findMany({
    where: {
      guildId, status: "COMPLETED", isTest: false, ...(window.coreId ? { coreId: window.coreId } : {}),
      scheduledAt: { gte: window.from, ...(window.until ? { lt: window.until } : {}) }
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      attendance: { select: { memberId: true, status: true, member: person } },
      signups: { where: { status: { not: "CANCELLED" } }, select: { memberId: true, member: person } },
      core: { select: { name: true, members: { where: { bench: false, trial: false }, select: { memberId: true, addedAt: true, member: person } } } }
    }
  });
  const members = new Map<string, { name: string; discordUserId: string; cells: SeasonCell[] }>();
  const cellOf = (memberId: string, member: { displayName: string; discordUserId: string }) => {
    const entry = members.get(memberId) ?? { name: member.displayName, discordUserId: member.discordUserId, cells: raids.map(() => null) };
    members.set(memberId, entry);
    return entry.cells;
  };
  raids.forEach((raid, index) => {
    // A main is expected only at raids after they joined the core.
    for (const spot of raid.core?.members ?? []) if (spot.addedAt.getTime() <= raid.scheduledAt.getTime()) cellOf(spot.memberId, spot.member)[index] = "UNRECORDED";
    for (const signup of raid.signups) cellOf(signup.memberId, signup.member)[index] = "UNRECORDED";
    for (const row of raid.attendance) cellOf(row.memberId, row.member)[index] = row.status;
  });
  return {
    raids: raids.map((raid) => ({ id: raid.id, title: raid.title, scheduledAt: raid.scheduledAt, coreId: raid.coreId, coreName: raid.core?.name ?? null })),
    rows: [...members.entries()].map(([memberId, entry]) => ({ memberId, ...entry, ...seasonTotals(entry.cells) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

// The same data, one part per raid core (raids with no core last); members who were not
// concerned by any raid of a part are left out of it.
export function splitByCore(data: SeasonAttendance): { coreName: string | null; data: SeasonAttendance }[] {
  const keys = [...new Set(data.raids.map((raid) => raid.coreId))];
  return keys.map((coreId) => {
    const kept = data.raids.map((raid, index) => (raid.coreId === coreId ? index : -1)).filter((index) => index >= 0);
    const rows = data.rows.map((row) => { const cells = kept.map((index) => row.cells[index] ?? null); return { ...row, cells, ...seasonTotals(cells) }; })
      .filter((row) => row.cells.some((cell) => cell !== null));
    return { coreName: data.raids[kept[0]!]!.coreName, data: { raids: kept.map((index) => data.raids[index]!), rows } };
  }).sort((a, b) => (a.coreName === null ? 1 : b.coreName === null ? -1 : a.coreName.localeCompare(b.coreName)));
}

const LETTER: Record<string, string> = { PRESENT: "P", LATE: "L", BENCHED: "B", ABSENT: "A", UNRECORDED: "?" };

// The grid for a spreadsheet: one line per member, one column per raid (date in guild time).
export function seasonCsv(data: SeasonAttendance, timeZone: string): string {
  const day = (date: Date) => { const p = localParts(date, timeZone); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
  return toCsv(
    ["member", "rate_percent", "present", "late", "benched", "absent", "unrecorded", ...data.raids.map((raid) => `${day(raid.scheduledAt)} ${raid.title}`)],
    data.rows.map((row) => [row.name, row.rate === null ? "" : Math.round(row.rate * 100), row.present, row.late, row.benched, row.absent, row.unrecorded,
      ...row.cells.map((cell) => (cell ? LETTER[cell] : ""))])
  );
}

// "2026-09-01" → that day at midnight in the guild's timezone.
export function parseSeasonStart(input: string, timeZone: string): Date {
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? zonedTime(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, timeZone) : null;
  const shown = date ? localParts(date, timeZone) : null;
  if (!date || !shown || shown.month !== Number(match![2]) || shown.day !== Number(match![3])) throw new Error(`I couldn't read "${input}" as a date. Use YYYY-MM-DD, e.g. 2026-09-01.`);
  return date;
}

// The season a moment falls in (the running one by default).
export function seasonAt(database: SeasonDb, guildId: string, at = new Date()): Promise<RaidSeason | null> {
  return database.raidSeason.findFirst({
    where: { guildId, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
    orderBy: { startsAt: "desc" }
  });
}

export function findSeason(database: SeasonDb, guildId: string, value: string): Promise<RaidSeason | null> {
  return database.raidSeason.findFirst({ where: { guildId, OR: [{ id: value }, { name: { equals: value.trim(), mode: "insensitive" } }] } });
}

// Starts a season and closes the one before it at the same moment, so seasons never overlap.
export async function startSeason(
  database: Pick<PrismaClient, "$transaction">, input: { guildId: string; name: string; startsAt: Date; createdBy: string }, now = new Date()
): Promise<RaidSeason> {
  const name = input.name.trim();
  if (!name) throw new Error("A season needs a name.");
  if (input.startsAt.getTime() > now.getTime()) throw new Error("A season starts today or in the past.");
  return database.$transaction(async (tx) => {
    if (await findSeason(tx, input.guildId, name)) throw new Error(`There is already a season named "${name}".`);
    const latest = await tx.raidSeason.findFirst({ where: { guildId: input.guildId }, orderBy: { startsAt: "desc" } });
    if (latest && input.startsAt.getTime() <= latest.startsAt.getTime()) throw new Error(`A new season must start after "${latest.name}" started.`);
    if (latest && (!latest.endsAt || latest.endsAt.getTime() > input.startsAt.getTime())) {
      await tx.raidSeason.update({ where: { id: latest.id }, data: { endsAt: input.startsAt } });
    }
    return tx.raidSeason.create({ data: { guildId: input.guildId, name, startsAt: input.startsAt, createdBy: input.createdBy } });
  });
}
