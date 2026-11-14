import type { PrismaClient } from "../generated/prisma/client.js";
import { storeDeviceRuns } from "./companion-device.js";

// Lets runs held for review through: the kept runs are stored now, as if their PC had sent them again.

export interface ReleaseResult { released: number; counted: number; ambiguous: boolean }

/** Releases one held run (by its full code or a unique beginning of it) or every held run of one PC on this server. */
export async function releaseHeldRuns(database: PrismaClient, guildId: string, target: { runRef?: string; deviceId?: string }, now = new Date()): Promise<ReleaseResult> {
  const where = target.deviceId ? { guildId, deviceId: target.deviceId, status: "held" } : { guildId, status: "held", runRef: { startsWith: (target.runRef ?? "").trim() } };
  if (!target.deviceId && (target.runRef ?? "").trim().length < 4) return { released: 0, counted: 0, ambiguous: false };
  const rows = await database.dungeonRunWitness.findMany({ where, select: { id: true, runRef: true, deviceId: true, payload: true }, take: 200 });
  const exact = target.runRef ? rows.filter((row) => row.runRef === target.runRef?.trim()) : [];
  const picked = exact.length ? exact : rows;
  if (!target.deviceId && picked.length > 1) return { released: 0, counted: 0, ambiguous: true };
  let counted = 0;
  for (const deviceId of [...new Set(picked.map((row) => row.deviceId))]) {
    const mine = picked.filter((row) => row.deviceId === deviceId);
    await database.dungeonRunWitness.updateMany({ where: { id: { in: mine.map((row) => row.id) } }, data: { status: "pending", reason: "released" } });
    const payloads = mine.flatMap((row) => row.payload ? [row.payload] : []);
    if (!payloads.length) continue;
    const characterKeys = (await database.deviceCharacter.findMany({ where: { deviceId }, select: { nameKey: true } })).map((row) => row.nameKey);
    const done = await database.$transaction((tx) => storeDeviceRuns(tx, guildId, payloads, now, { deviceId, characterKeys }), { timeout: 60_000, maxWait: 15_000 });
    counted += done.stored;
  }
  return { released: picked.length, counted, ambiguous: false };
}
