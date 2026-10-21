import type { PrismaClient } from "../generated/prisma/client.js";
import { priority } from "./epgp.js";

// CSV exports for officers who live in spreadsheets (/officer export): standings, the EPGP
// ledger, loot, attendance and the roster, always for one guild. RFC 4180: values with a comma,
// quote or line break are quoted, quotes doubled, rows end with CRLF. csvBuffer adds the UTF-8
// byte-order mark Excel needs to show accents.

export type ExportKind = "standings" | "ledger" | "loot" | "attendance" | "roster";
export const EXPORT_KINDS: ExportKind[] = ["standings", "ledger", "loot", "attendance", "roster"];
type Cell = string | number | boolean | Date | null | undefined;

// Cells that start with = + - @ are prefixed so a spreadsheet never treats
// player-typed text as a formula.
export function csvCell(value: Cell): string {
  let text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The file to attach: UTF-8 with a byte-order mark, so Excel reads accents correctly. */
export function csvBuffer(csv: string): Buffer {
  return Buffer.from(`\uFEFF${csv}`, "utf8");
}

type Db = Pick<PrismaClient, "member" | "raidAttendance" | "lootAward" | "epgpTransaction" | "raidCore" | "guildSettings">;
const LIMIT = 20_000;

// One row per member and point pool (the guild pool, then each core with its own pool), best PR first.
async function standings(database: Db, guildId: string): Promise<Cell[][]> {
  const [members, sums, cores, settings] = await Promise.all([
    database.member.findMany({ where: { guildId, status: "ACTIVE", isTest: false }, include: { characters: true }, orderBy: { displayName: "asc" } }),
    database.epgpTransaction.groupBy({ by: ["memberId", "coreId"], where: { guildId }, _sum: { epAmount: true, gpAmount: true } }),
    database.raidCore.findMany({ where: { guildId, separatePool: true }, orderBy: { name: "asc" } }),
    database.guildSettings.findUnique({ where: { guildId } })
  ]);
  const pools = [{ id: null as string | null, name: "Guild pool", baseGp: settings?.baseGp ?? 0 },
    ...cores.map((core) => ({ id: core.id as string | null, name: core.name, baseGp: core.baseGp ?? settings?.baseGp ?? 0 }))];
  const sum = new Map(sums.map((row) => [`${row.memberId}|${row.coreId ?? ""}`, row._sum]));
  return pools.flatMap((pool) => members
    .map((member) => {
      const total = sum.get(`${member.id}|${pool.id ?? ""}`);
      const ep = total?.epAmount ?? 0;
      const gp = total?.gpAmount ?? 0;
      return { member, ep, gp, pr: priority(ep, gp, pool.baseGp), touched: total !== undefined };
    })
    // A core pool lists only the members who have points in it; the guild pool lists everyone.
    .filter((row) => pool.id === null || row.touched)
    .sort((a, b) => b.pr - a.pr || a.member.displayName.localeCompare(b.member.displayName))
    .map((row, index) => [pool.name, index + 1, row.member.displayName, row.member.characters.find((c) => c.isMain)?.name ?? row.member.characters[0]?.name ?? "",
      row.ep, row.gp, row.pr.toFixed(3)]));
}

export async function buildExport(database: Db, guildId: string, kind: ExportKind): Promise<{ filename: string; csv: string; rows: number }> {
  if (kind === "standings") {
    const rows = await standings(database, guildId);
    return { filename: "standings.csv", rows: rows.length, csv: toCsv(["pool", "rank", "member", "main", "ep", "gp", "pr"], rows) };
  }
  if (kind === "roster") {
    const members = await database.member.findMany({
      where: { guildId, status: "ACTIVE", isTest: false }, include: { characters: true }, orderBy: { displayName: "asc" }
    });
    const rows = members.flatMap((member) => member.characters.length
      ? member.characters.map((c) => [member.displayName, c.name, c.realm, c.className, c.spec, c.level, c.race, c.isMain, c.lastSeenAt])
      : [[member.displayName, "", "", "", "", "", "", "", ""]]);
    return { filename: "roster.csv", rows: rows.length, csv: toCsv(["member", "character", "realm", "class", "spec", "level", "race", "main", "last_seen"], rows) };
  }
  if (kind === "attendance") {
    const records = await database.raidAttendance.findMany({
      where: { raid: { guildId, isTest: false } }, include: { raid: true, member: true }, orderBy: { raid: { scheduledAt: "desc" } }, take: LIMIT
    });
    const rows = records.map((r) => [r.raid.title, r.raid.scheduledAt, r.member.displayName, r.status, r.notes]);
    return { filename: "attendance.csv", rows: rows.length, csv: toCsv(["raid", "date", "member", "status", "notes"], rows) };
  }
  if (kind === "loot") {
    const awards = await database.lootAward.findMany({ where: { guildId }, include: { member: true }, orderBy: { awardedAt: "desc" }, take: LIMIT });
    const rows = awards.map((a) => [a.awardedAt, a.member.displayName, a.itemName, a.amount, a.bossName, a.epBefore, a.gpBefore]);
    return { filename: "loot.csv", rows: rows.length, csv: toCsv(["date", "winner", "item", "gp", "boss", "ep_before", "gp_before"], rows) };
  }
  const [entries, cores] = await Promise.all([
    database.epgpTransaction.findMany({ where: { guildId }, include: { member: true }, orderBy: { createdAt: "desc" }, take: LIMIT }),
    database.raidCore.findMany({ where: { guildId } })
  ]);
  const coreName = new Map(cores.map((core) => [core.id, core.name]));
  const rows = entries.map((e) => [e.createdAt, e.member.displayName, e.coreId ? coreName.get(e.coreId) ?? "" : "Guild pool", e.type, e.epAmount, e.gpAmount, e.reason, e.id]);
  return { filename: "epgp-ledger.csv", rows: rows.length, csv: toCsv(["date", "member", "pool", "type", "ep", "gp", "reason", "entry_id"], rows) };
}
