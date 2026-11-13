import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { Anomaly } from "./run-plausibility.js";

// The review list for officers and the owner: runs the server flagged, and runs it is holding back. Shown only in officer replies.
// A device (install) can be excluded: its runs are then refused.

type Db = Pick<PrismaClient, "dungeonRun" | "dungeonRunWitness" | "companionDevice">;

export interface AnomalyRow { runRef: string; dungeon: string; endedAt: Date | null; characters: string[]; flags: Anomaly[]; device: string | null; witnesses: number }

const asFlags = (value: unknown): Anomaly[] => (Array.isArray(value) ? value : []).flatMap((entry) => {
  const flag = entry as { code?: unknown; detail?: unknown } | null;
  return flag && typeof flag.code === "string" ? [{ code: flag.code, detail: typeof flag.detail === "string" ? flag.detail : "" }] : [];
});

/** Short, copyable device reference shown to officers (the first 8 characters of the install id). */
export const deviceShortId = (id: string): string => id.slice(-8);

export async function anomalyReport(database: Db, guildId: string, limit = 15): Promise<AnomalyRow[]> {
  const runs = await database.dungeonRun.findMany({
    where: { guildId, anomalies: { not: Prisma.DbNull }, valid: true },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, runRef: true, dungeonName: true, endedAt: true, anomalies: true, witnessCount: true, players: { select: { character: true }, take: 5 } }
  });
  if (!runs.length) return [];
  const witnesses = await database.dungeonRunWitness.findMany({ where: { guildId, runId: { in: runs.map((run) => run.id) }, status: "stored" }, select: { runId: true, deviceId: true }, take: 200 });
  const deviceOf = new Map(witnesses.flatMap((row) => (row.runId ? [[row.runId, row.deviceId] as const] : [])));
  return runs.map((run) => ({ runRef: run.runRef, dungeon: run.dungeonName, endedAt: run.endedAt, characters: run.players.map((player) => player.character), flags: asFlags(run.anomalies),
    device: deviceOf.has(run.id) ? deviceShortId(deviceOf.get(run.id)!) : null, witnesses: run.witnessCount }));
}

export interface HeldRow { runRef: string; instanceId: number; endedAt: Date | null; device: string; flags: Anomaly[]; firstSeenAt: Date }

/** Runs held for review: never imported, never told to the member. */
export async function heldReport(database: Db, guildId: string, limit = 15): Promise<HeldRow[]> {
  const rows = await database.dungeonRunWitness.findMany({ where: { guildId, status: "held" }, orderBy: { firstSeenAt: "desc" }, take: limit,
    select: { runRef: true, instanceId: true, endedAt: true, deviceId: true, flags: true, firstSeenAt: true } });
  return rows.map((row) => ({ runRef: row.runRef, instanceId: row.instanceId, endedAt: row.endedAt, device: deviceShortId(row.deviceId), flags: asFlags(row.flags), firstSeenAt: row.firstSeenAt }));
}

/** Lets a held run through: its next upload is judged without the hold. False when no such held run exists. */
export async function releaseHeld(database: Db, guildId: string, runRef: string): Promise<boolean> {
  const done = await database.dungeonRunWitness.updateMany({ where: { guildId, runRef, status: "held" }, data: { status: "pending", reason: "released" } });
  return done.count > 0;
}

export function describeHeld(rows: readonly HeldRow[]): string {
  if (!rows.length) return "";
  return `**Held for review** (the member sees nothing; release one with \`run:\` and its code):\n${rows.map((row) => `\`${row.runRef.slice(0, 24)}\` · PC \`${row.device}\`${row.endedAt ? ` · <t:${Math.floor(row.endedAt.getTime() / 1000)}:d>` : ""}\n${row.flags.map((flag) => `- ${flag.detail || flag.code}`).join("\n")}`).join("\n\n")}`;
}

export function describeAnomalies(rows: readonly AnomalyRow[]): string {
  if (!rows.length) return "No dungeon run was flagged.";
  const lines = rows.map((row) => `**${row.dungeon}** ${row.endedAt ? `<t:${Math.floor(row.endedAt.getTime() / 1000)}:d>` : ""} · ${row.characters.slice(0, 3).join(", ")} · \`${row.runRef.slice(0, 24)}\`${row.device ? ` · PC \`${row.device}\`` : ""}${row.witnesses > 1 ? ` · confirmed by ${row.witnesses}` : ""}\n${row.flags.map((flag) => `- ${flag.detail || flag.code}`).join("\n")}`);
  return `Flagged runs (they count). Stop one with \`/officer dungeon invalidate\`, or exclude a PC with \`/officer dungeon device\`.\n\n${lines.join("\n\n")}`;
}

/** Excludes or restores the PC whose reference ends with `short`, among the PCs that sent runs to this server. Returns false when none matches. */
export async function setDeviceExcluded(database: Db, guildId: string, short: string, excluded: boolean, reason: string, now = new Date()): Promise<boolean> {
  const suffix = short.trim().toLowerCase();
  if (!/^[a-z0-9]{4,}$/.test(suffix)) return false;
  const witnesses = await database.dungeonRunWitness.findMany({ where: { guildId }, distinct: ["deviceId"], select: { deviceId: true }, take: 2000 });
  const match = witnesses.map((row) => row.deviceId).filter((id) => id.toLowerCase().endsWith(suffix));
  if (match.length !== 1) return false;
  await database.companionDevice.update({ where: { id: match[0]! }, data: excluded ? { excludedAt: now, excludedReason: reason.slice(0, 200) } : { excludedAt: null, excludedReason: null } });
  return true;
}
