import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { tx, type Lang } from "../i18n.js";
import type { Anomaly } from "./run-plausibility.js";

// The review list for officers and the owner: flagged runs and runs held for review. Shown only in officer replies.

type Db = Pick<PrismaClient, "dungeonRun" | "dungeonRunWitness" | "companionDevice">;

export interface AnomalyRow { runRef: string; dungeon: string; endedAt: Date | null; characters: string[]; flags: Anomaly[]; device: string | null; witnesses: number }
export interface HeldRow { runRef: string; instanceId: number; endedAt: Date | null; device: string; flags: Anomaly[]; firstSeenAt: Date }

const asFlags = (value: unknown): Anomaly[] => (Array.isArray(value) ? value : []).flatMap((entry) => {
  const flag = entry as { code?: unknown; detail?: unknown } | null;
  return flag && typeof flag.code === "string" ? [{ code: flag.code, detail: typeof flag.detail === "string" ? flag.detail : "" }] : [];
});

/** Short, copyable device reference shown to officers (the last 8 characters of the install id). */
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

/** Runs held for review: not imported yet. */
export async function heldReport(database: Db, guildId: string, limit = 15): Promise<HeldRow[]> {
  const rows = await database.dungeonRunWitness.findMany({ where: { guildId, status: "held" }, orderBy: { firstSeenAt: "desc" }, take: limit,
    select: { runRef: true, instanceId: true, endedAt: true, deviceId: true, flags: true, firstSeenAt: true } });
  return rows.map((row) => ({ runRef: row.runRef, instanceId: row.instanceId, endedAt: row.endedAt, device: deviceShortId(row.deviceId), flags: asFlags(row.flags), firstSeenAt: row.firstSeenAt }));
}

export function describeHeld(rows: readonly HeldRow[], lang: Lang = "en"): string {
  if (!rows.length) return "";
  const lines = rows.map((row) => `\`${row.runRef}\` · ${tx(lang, "PC")} \`${row.device}\`${row.endedAt ? ` · <t:${Math.floor(row.endedAt.getTime() / 1000)}:d>` : ""}\n${row.flags.map((flag) => `- ${flag.detail || flag.code}`).join("\n")}`);
  return `**${tx(lang, "Held for review")}** (${tx(lang, "release one with `run:` and its code")}):\n${lines.join("\n\n")}`;
}

export function describeAnomalies(rows: readonly AnomalyRow[], lang: Lang = "en"): string {
  if (!rows.length) return tx(lang, "No dungeon run was flagged.");
  const lines = rows.map((row) => `**${row.dungeon}** ${row.endedAt ? `<t:${Math.floor(row.endedAt.getTime() / 1000)}:d>` : ""} · ${row.characters.slice(0, 3).join(", ")} · \`${row.runRef}\`${row.device ? ` · ${tx(lang, "PC")} \`${row.device}\`` : ""}${row.witnesses > 1 ? ` · ${tx(lang, "confirmed by {n}", { n: row.witnesses })}` : ""}\n${row.flags.map((flag) => `- ${flag.detail || flag.code}`).join("\n")}`);
  return `${tx(lang, "Flagged runs. Stop one with `/officer dungeon invalidate`, or exclude a PC with `/officer dungeon flagged` and `pc:`.")}\n\n${lines.join("\n\n")}`;
}

/**
 * Excludes or restores the PC whose reference ends with `short`, for this server only, among the PCs that sent runs here.
 * Returns the PC's id, or null when no single PC matches.
 */
export async function setDeviceExcluded(database: Db, guildId: string, short: string, excluded: boolean): Promise<string | null> {
  const suffix = short.trim().toLowerCase();
  if (!/^[a-z0-9]{4,}$/.test(suffix)) return null;
  const witnesses = await database.dungeonRunWitness.findMany({ where: { guildId }, distinct: ["deviceId"], select: { deviceId: true }, take: 2000 });
  const match = witnesses.map((row) => row.deviceId).filter((id) => id.toLowerCase().endsWith(suffix));
  if (match.length !== 1) return null;
  const id = match[0]!;
  const device = await database.companionDevice.findUnique({ where: { id }, select: { excludedGuilds: true } });
  const current = device?.excludedGuilds ?? [];
  const next = excluded ? [...new Set([...current, guildId])] : current.filter((entry) => entry !== guildId);
  await database.companionDevice.update({ where: { id }, data: { excludedGuilds: next } });
  return id;
}
