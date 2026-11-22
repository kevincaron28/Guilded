import type { PrismaClient, RaidAttendanceStatus, RaidSeason } from "../generated/prisma/client.js";
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

/** One guild's result. `blockedBy` is set (with `discordId` and `language`) when nothing was created because an officer's open-ended season is still running. */
export interface OfficialRaidRotation { guildId: string; season: string; ended: string | null; blockedBy?: string; discordId?: string; language?: string }

/**
 * The official rotation's raid step (owner decision, 16 November 2026: everything seasonal changes season together). For every guild that
 * already uses raid seasons (it has at least one RaidSeason: the safest signal that its officers track attendance by season; guilds that
 * never made one get nothing new) it starts an attendance season named after the official season ("Season 2" / "Saison 2" in the guild's
 * language) from the official start, and closes the previous one only when that was an automatic one too. A season an officer started by hand
 * is never closed or renamed; if one started after the official start, or one already has the name, nothing is created. There is no raid
 * scoring here: this only gives the attendance report a date range that matches the rest. Idempotent: one automatic season per official number.
 * Official season 1 is not created (the seasons officers made before it stay as they are).
 */
export async function rotateRaidSeasons(database: Pick<PrismaClient, "raidSeason" | "guildSettings" | "$transaction">, official: { number: number; start: Date }, now: Date,
  allows: (discordId: string) => boolean, edition: string): Promise<OfficialRaidRotation[]> {
  if (official.number < 2 || official.start.getTime() > now.getTime()) return [];
  const users = await database.raidSeason.findMany({ where: { guild: { gameEdition: edition } }, distinct: ["guildId"], select: { guildId: true, guild: { select: { discordId: true } } } });
  const rotated: OfficialRaidRotation[] = [];
  for (const row of users) {
    if (!allows(row.guild.discordId)) continue;
    const language = (await database.guildSettings.findUnique({ where: { guildId: row.guildId }, select: { language: true } }))?.language;
    const name = `${language === "fr" ? "Saison" : "Season"} ${official.number}`;
    try {
      const result = await database.$transaction(async (tx) => {
        if (await tx.raidSeason.findFirst({ where: { guildId: row.guildId, officialSeasonNumber: official.number }, select: { id: true } })) return null;
        if (await findSeason(tx, row.guildId, name)) return null;
        const latest = await tx.raidSeason.findFirst({ where: { guildId: row.guildId }, orderBy: { startsAt: "desc" } });
        if (latest && latest.startsAt.getTime() >= official.start.getTime()) return null;
        // An officer's open-ended season would overlap the automatic one (raids would count in both): leave it alone and tell the officers.
        if (latest && latest.officialSeasonNumber === null && (!latest.endsAt || latest.endsAt.getTime() > official.start.getTime())) return { blockedBy: latest.name as string | undefined, ended: null as string | null };
        let ended: string | null = null;
        if (latest && latest.officialSeasonNumber !== null && (!latest.endsAt || latest.endsAt.getTime() > official.start.getTime())) {
          await tx.raidSeason.update({ where: { id: latest.id }, data: { endsAt: official.start } });
          ended = latest.name;
        }
        await tx.raidSeason.create({ data: { guildId: row.guildId, name, startsAt: official.start, officialSeasonNumber: official.number, createdBy: "Guilded" } });
        return { ended, blockedBy: undefined };
      });
      if (result?.blockedBy) rotated.push({ guildId: row.guildId, season: name, ended: null, blockedBy: result.blockedBy, discordId: row.guild.discordId, language: language ?? "en" });
      else if (result) rotated.push({ guildId: row.guildId, season: name, ended: result.ended });
    } catch (error) { console.error(`Raid season rotation failed for guild ${row.guildId}`, error); }
  }
  return rotated;
}

/** The officer-log notice for an open officer season that blocks the automatic one. */
export function openOfficerSeasonNotice(lang: string, officerSeason: string, season: string): string {
  return lang === "fr"
    ? `La saison de raid « ${officerSeason} » est toujours ouverte, alors la présence de ${season} n'a pas démarré automatiquement. Ferme-la avec la commande /lead season pour démarrer ${season} automatiquement, ou continue à l'utiliser.`
    : `The raid season "${officerSeason}" is still open, so ${season} attendance did not start automatically. Close it with the /lead season command to start ${season} attendance automatically, or keep using it.`;
}

const noticed = new Set<string>();
export const resetRaidSeasonNotices = () => noticed.clear();

/** Posts the notice once per guild and official season (remembered for the life of the process; the rotation tick calls it every few minutes). */
export async function announceBlockedRaidSeasons(rows: readonly OfficialRaidRotation[], number: number, post: (discordId: string, text: string) => Promise<void>): Promise<number> {
  let sent = 0;
  for (const row of rows) {
    if (!row.blockedBy || !row.discordId) continue;
    const key = `${row.guildId}:${number}`;
    if (noticed.has(key)) continue;
    noticed.add(key);
    try { await post(row.discordId, openOfficerSeasonNotice(row.language ?? "en", row.blockedBy, row.season)); sent++; }
    catch (error) { console.error(`Raid season notice failed for guild ${row.guildId}`, error); }
  }
  return sent;
}
