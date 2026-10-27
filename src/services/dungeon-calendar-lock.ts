import type { Prisma } from "../generated/prisma/client.js";
import { currentEdition } from "./edition-context.js";

/** Calendar writers never acquire guild locks. Readers may already hold one;
 * taking the shared calendar lock before touching dungeon rows avoids inversion.
 * All locks live only for the surrounding database transaction. */
export async function lockDungeonCalendar(tx: Partial<Pick<Prisma.TransactionClient, "$executeRaw">>, exclusive = false, edition = currentEdition()) {
  if (!tx.$executeRaw) return; // In-memory read/test adapters have no concurrent database.
  const key = `dungeon-calendar:${edition}`;
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}
