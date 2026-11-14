import type { PrismaClient } from "../generated/prisma/client.js";
import { saveRunReceipts } from "./dungeon-import.js";
import { storeDeviceRuns } from "./companion-device.js";

// Releases runs held for review: the kept runs are stored now, as if their PC had sent them again.

export interface ReleaseResult {
  /** Held rows picked for release. */
  picked: number;
  /** Runs stored by this release. */
  counted: number;
  /** Picked rows that had no kept copy: they count when their PC sends the run again. */
  noCopy: number;
  /** The run was already counted (another PC's copy stored it). */
  already: boolean;
  ambiguous: boolean;
}

const heldBecauseExcluded = (flags: unknown): boolean => Array.isArray(flags) && flags.some((flag) => (flag as { code?: unknown } | null)?.code === "pc-excluded");
const NONE: ReleaseResult = { picked: 0, counted: 0, noCopy: 0, already: false, ambiguous: false };

/**
 * Releases one held run (its full code or a unique beginning; every PC's held row of that run), or, with `deviceId`, the runs of that
 * PC on this server that were held because the PC was excluded.
 */
export async function releaseHeldRuns(database: PrismaClient, guildId: string, target: { runRef?: string; deviceId?: string }, now = new Date()): Promise<ReleaseResult> {
  const wanted = (target.runRef ?? "").trim();
  if (!target.deviceId && wanted.length < 4) return NONE;
  const where = target.deviceId ? { guildId, deviceId: target.deviceId, status: "held" } : { guildId, status: "held", runRef: { startsWith: wanted } };
  const rows = await database.dungeonRunWitness.findMany({ where, select: { id: true, runRef: true, deviceId: true, payload: true, flags: true }, take: 500 });
  let picked: typeof rows;
  if (target.deviceId) picked = rows.filter((row) => heldBecauseExcluded(row.flags));
  else {
    const refs = [...new Set(rows.map((row) => row.runRef))];
    if (refs.length > 1 && !refs.includes(wanted)) return { ...NONE, ambiguous: true };
    picked = rows.filter((row) => row.runRef === (refs.includes(wanted) ? wanted : refs[0]));
  }
  let counted = 0, noCopy = 0, stored = 0;
  for (const deviceId of [...new Set(picked.map((row) => row.deviceId))]) {
    const mine = picked.filter((row) => row.deviceId === deviceId);
    const withCopy = mine.filter((row) => row.payload);
    const without = mine.filter((row) => !row.payload);
    const characterKeys = (await database.deviceCharacter.findMany({ where: { deviceId }, select: { nameKey: true } })).map((row) => row.nameKey);
    await database.$transaction(async (tx) => {
      await tx.dungeonRunWitness.updateMany({ where: { id: { in: mine.map((row) => row.id) } }, data: { status: "pending", reason: "released" } });
      // Without a kept copy the PC is asked to send the run again.
      if (without.length) await saveRunReceipts(tx, guildId, without.map((row) => ({ runRef: row.runRef, outcome: "retry" as const, reason: "Counts when sent again", runId: null, fresh: true })), now);
      if (withCopy.length) {
        counted += (await storeDeviceRuns(tx, guildId, withCopy.map((row) => row.payload), now, { deviceId, characterKeys })).stored;
        stored += await tx.dungeonRunWitness.count({ where: { id: { in: withCopy.map((row) => row.id) }, status: "stored" } });
      }
    }, { timeout: 60_000, maxWait: 15_000 });
    noCopy += without.length;
  }
  return { picked: picked.length, counted, noCopy, already: counted === 0 && stored > 0, ambiguous: false };
}
