// Read-only: how many rows of each table that has a wowId column carry an id, and how many do not.
// Counts only (no names, no Discord ids). Run on the owner's PC: npx tsx scripts/character-id-coverage.ts
// Safety: one read-only session, one cheap COUNT per table, run one after the other.
import { prisma } from "../src/database.js";

const TABLES = ["Character", "UnclaimedCharacter", "GuildRosterEntry", "DeviceCharacter", "DungeonRunPlayer", "PublicRunPlayer"] as const;

await prisma.$executeRawUnsafe("SET default_transaction_read_only = on");
await prisma.$executeRawUnsafe("SET statement_timeout = 20000");
console.log("table".padEnd(22), "with id".padStart(10), "without".padStart(10), "share".padStart(7));
for (const table of TABLES) {
  // Table names come from the constant list above, never from input.
  const rows = await prisma.$queryRawUnsafe<{ withId: bigint; without: bigint }[]>(
    `SELECT COUNT("wowId") AS "withId", COUNT(*) - COUNT("wowId") AS "without" FROM "${table}"`);
  const withId = Number(rows[0]?.withId ?? 0), without = Number(rows[0]?.without ?? 0), total = withId + without;
  console.log(table.padEnd(22), String(withId).padStart(10), String(without).padStart(10), (total ? `${Math.round((withId / total) * 100)}%` : "-").padStart(7));
}
await prisma.$disconnect();
