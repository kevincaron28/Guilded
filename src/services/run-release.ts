import type { PrismaClient } from "../generated/prisma/client.js";
import { storeDeviceRuns } from "./companion-device.js";

// Releases runs held for review: the kept runs are stored now, as if their PC had sent them again.

export interface ReleaseResult {
  /** Held runs picked for release. */
  picked: number;
  /** Runs stored by this release. */
  counted: number;
  ambiguous: boolean;
}

const heldBecauseExcluded = (flags: unknown): boolean => Array.isArray(flags) && flags.some((flag) => (flag as { code?: unknown } | null)?.code === "pc-excluded");

/**
 * Releases one held run (its full code or a unique beginning of it), or, with `deviceId`, the runs of that PC on this server
 * that were held because the PC was excluded.
 */
export async function releaseHeldRuns(database: PrismaClient, guildId: string, target: { runRef?: string; deviceId?: string }, now = new Date()): Promise<ReleaseResult> {
  const wanted = (target.runRef ?? "").trim();
  if (!target.deviceId && wanted.length < 4) return { picked: 0, counted: 0, ambiguous: false };
  const where = target.deviceId ? { guildId, deviceId: target.deviceId, status: "held" } : { guildId, status: "held", runRef: { startsWith: wanted } };
  const rows = await database.dungeonRunWitness.findMany({ where, select: { id: true, runRef: true, deviceId: true, payload: true, flags: true }, take: 500 });
  const exact = target.deviceId ? [] : rows.filter((row) => row.runRef === wanted);
  const picked = target.deviceId ? rows.filter((row) => heldBecauseExcluded(row.flags)) : exact.length ? exact : rows;
  if (!target.deviceId && picked.length > 1) return { picked: 0, counted: 0, ambiguous: true };
  let counted = 0;
  for (const deviceId of [...new Set(picked.map((row) => row.deviceId))]) {
    const withPayload = picked.filter((row) => row.deviceId === deviceId && row.payload);
    if (!withPayload.length) continue;
    await database.dungeonRunWitness.updateMany({ where: { id: { in: withPayload.map((row) => row.id) } }, data: { status: "pending", reason: "released" } });
    const characterKeys = (await database.deviceCharacter.findMany({ where: { deviceId }, select: { nameKey: true } })).map((row) => row.nameKey);
    const done = await database.$transaction((tx) => storeDeviceRuns(tx, guildId, withPayload.map((row) => row.payload), now, { deviceId, characterKeys }), { timeout: 60_000, maxWait: 15_000 });
    counted += done.stored;
  }
  return { picked: picked.length, counted, ambiguous: false };
}
