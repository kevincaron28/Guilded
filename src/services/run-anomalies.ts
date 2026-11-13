import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { Anomaly } from "./run-plausibility.js";

// The anomaly report for officers and the owner (docs/plans/SINGLE_WITNESS_2026-11-13.md). A run with a plausibility flag still
// counts (one witness is enough); the report names it, the PC that sent it and why it looks unlikely, so a person decides.
// A device (install) can be excluded: its runs are then refused, and the ones it already sent are listed for the officer tools.

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

export function describeAnomalies(rows: readonly AnomalyRow[]): string {
  if (!rows.length) return "No dungeon run was flagged. (One witness is enough for a run to count; a flag only means it looks unlikely.)";
  const lines = rows.map((row) => `**${row.dungeon}** ${row.endedAt ? `<t:${Math.floor(row.endedAt.getTime() / 1000)}:d>` : ""} · ${row.characters.slice(0, 3).join(", ")} · \`${row.runRef.slice(0, 24)}\`${row.device ? ` · PC \`${row.device}\`` : ""}${row.witnesses > 1 ? ` · confirmed by ${row.witnesses}` : ""}\n${row.flags.map((flag) => `- ${flag.detail || flag.code}`).join("\n")}`);
  return `Runs the bot flagged as unlikely. They still count; nothing is held. Stop one with \`/officer dungeon invalidate\`, or exclude a PC with \`/officer dungeon device\`.\n\n${lines.join("\n\n")}`;
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
