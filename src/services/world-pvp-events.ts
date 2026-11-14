import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { weekKeyOf } from "./world-pvp.js";

// Open-world kills and deaths with their place, from the 9.3.2 addon through the companion (feature "pvp-events"). Row by row: a malformed
// row is left out, never failing the upload. The enemy's name is not part of it. Public on the pages of guilds that publish (docs/WORLD_PVP.md).

export const PVP_EVENTS_FEATURE = "pvp-events";
export const PVP_EVENTS_MAX = 500;
const KEEP_DAYS = 35;
/** Most events kept for one member (server-side only; nothing is said to the member about it). */
export const PVP_EVENTS_PER_MEMBER = 2000;

const eventSchema = z.object({
  k: z.enum(["kill", "death"]),
  t: z.number().int().min(1_600_000_000).max(4_000_000_000),
  m: z.number().int().min(1).max(100_000),
  s: z.number().int().min(1).max(2_147_483_647),
  x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(),
  a: z.literal(1).optional()
});
export interface PvpEventRow { kind: "kill" | "death"; at: Date; mapId: number; x: number | null; y: number | null; approx: boolean; eventId: number }

/** Pure: the valid rows of an upload (at most PVP_EVENTS_MAX, none from the future), position only when both coordinates are given. */
export function parsePvpEvents(value: unknown, now = new Date()): PvpEventRow[] {
  const rows: PvpEventRow[] = [];
  const limit = Math.floor(now.getTime() / 1000) + 3600;
  for (const raw of Array.isArray(value) ? value.slice(0, PVP_EVENTS_MAX) : []) {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.t > limit) continue;
    const e = parsed.data, placed = e.x !== undefined && e.y !== undefined;
    rows.push({ kind: e.k, at: new Date(e.t * 1000), mapId: e.m, x: placed ? e.x! : null, y: placed ? e.y! : null, approx: placed && e.a === 1, eventId: e.s });
  }
  return rows;
}

type EventDb = Pick<PrismaClient, "worldPvpEvent" | "$transaction">;
/** Stores the rows (a resent upload changes nothing) and forgets what is older than five weeks. At the per-member cap the member's OLDEST rows make room for the new ones.
 *  Count, insert and trim run in one transaction under a per-member advisory lock, so two uploads of the same member never overshoot the cap. Returns how many rows were new. */
export async function applyPvpEvents(db: EventDb, guildId: string, memberId: string, rows: readonly PvpEventRow[], now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  const fresh = rows.filter((row) => row.at >= cutoff);
  if (!fresh.length) return 0;
  return db.$transaction(async (tx) => {
    // $executeRaw, not $queryRaw: the lock function returns void, which a row-reading call cannot decode (P2010 on production, 14 November 2026).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"pvp-events:" + memberId}))`;
    await tx.worldPvpEvent.deleteMany({ where: { guildId, memberId, at: { lt: cutoff } } });
    const created = await tx.worldPvpEvent.createMany({
      data: fresh.map((row) => ({ guildId, memberId, weekKey: weekKeyOf(row.at), kind: row.kind, at: row.at, mapId: row.mapId, x: row.x, y: row.y, approx: row.approx, eventId: row.eventId })),
      skipDuplicates: true
    });
    const excess = (await tx.worldPvpEvent.count({ where: { memberId } })) - PVP_EVENTS_PER_MEMBER;
    if (excess > 0) {
      const oldest = await tx.worldPvpEvent.findMany({ where: { memberId }, orderBy: [{ at: "asc" }, { id: "asc" }], take: excess, select: { id: true } });
      if (oldest.length) await tx.worldPvpEvent.deleteMany({ where: { id: { in: oldest.map((row) => row.id) } } });
    }
    return created.count;
  });
}

const PURGE_BATCH = 5_000;
/** Daily job: everything older than five weeks goes, for every member (an inactive member's rows too), in batches so one huge delete never holds the table. */
export async function purgeOldPvpEvents(db: Pick<PrismaClient, "worldPvpEvent">, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  let total = 0;
  for (let i = 0; i < 1_000; i++) {
    const ids = await db.worldPvpEvent.findMany({ where: { at: { lt: cutoff } }, select: { id: true }, take: PURGE_BATCH });
    if (!ids.length) break;
    total += (await db.worldPvpEvent.deleteMany({ where: { id: { in: ids.map((row) => row.id) } } })).count;
    if (ids.length < PURGE_BATCH) break;
  }
  return total;
}
