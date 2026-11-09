import type { PrismaClient } from "../generated/prisma/client.js";

// Housekeeping for data that only grows. Every companion upload stores the whole export, and an
// officer's export repeats the guild's gear checks; left alone, both make the database and the
// daily backup (held in memory while it is written) larger every week. Points, loot history and
// raids are never touched here.

const DAY_MS = 86_400_000;
export const RETENTION = {
  // An applied export was already turned into ledger rows and keeps only a small summary (its raw
  // payload is dropped when it is applied); the row stays for duplicate detection by checksum.
  appliedImportDays: 14,
  // Never applied (waiting for /import apply): kept with its full payload, then dropped.
  pendingImportDays: 30,
  // ...and at most this many per guild, once older than pendingOverflowDays.
  pendingImportsPerGuild: 25,
  pendingOverflowDays: 2,
  // Gear checks: the newest one per character is always kept; older ones this long.
  snapshotDays: 45,
  errorReportDays: 90
};

type Db = Pick<PrismaClient, "addonImport" | "errorReport" | "$executeRaw">;

export async function runRetention(database: Db, now = new Date()): Promise<{ imports: number; snapshots: number; errors: number }> {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const imports = await database.addonImport.deleteMany({
    where: { OR: [
      { status: "APPLIED", createdAt: { lt: before(RETENTION.appliedImportDays) } },
      { status: { not: "APPLIED" }, createdAt: { lt: before(RETENTION.pendingImportDays) } }
    ] }
  });
  // Not yet applied: only the newest pendingImportsPerGuild per guild are kept (the /import apply
  // autocomplete lists 25 anyway), and only once they are a couple of days old.
  const overflow = await database.$executeRaw`
    DELETE FROM "AddonImport" WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id", "createdAt", row_number() OVER (PARTITION BY "guildId" ORDER BY "createdAt" DESC) AS rank
        FROM "AddonImport" WHERE "status" <> 'APPLIED') ranked
      WHERE rank > ${RETENTION.pendingImportsPerGuild} AND "createdAt" < ${before(RETENTION.pendingOverflowDays)})`;
  // Applied rows written before payloads were compacted on apply: drop the raw payload, keep the summary.
  await database.$executeRaw`
    UPDATE "AddonImport"
    SET "payload" = jsonb_build_object('compacted', true, 'source', "source", 'exportedAt', "payload"->'exportedAt', 'gameEdition', "payload"->'gameEdition')
    WHERE "status" = 'APPLIED' AND ("payload"->>'compacted') IS NULL`;
  // Items, consumables and findings go with their snapshot (ON DELETE CASCADE).
  const snapshots = await database.$executeRaw`
    DELETE FROM "InspectedCharacterSnapshot" old
    WHERE old."inspectedAt" < ${before(RETENTION.snapshotDays)}
      AND EXISTS (SELECT 1 FROM "InspectedCharacterSnapshot" newer
                  WHERE newer."characterId" = old."characterId" AND newer."inspectedAt" > old."inspectedAt")`;
  const errors = await database.errorReport.deleteMany({ where: { createdAt: { lt: before(RETENTION.errorReportDays) } } });
  await database.$executeRaw`DELETE FROM "AiDailyUsage" WHERE "day" < ${before(90).toISOString().slice(0, 10)}`;
  // Completed deliveries need cleanup every few hours, not a DELETE every minute.
  await database.$executeRaw`DELETE FROM "DiscordJob" WHERE "status" = 'DONE' AND "deliveredAt" < ${before(30)}`;
  // Expired availability is immediately hidden by reads; purge rows every six hours.
  await database.$executeRaw`DELETE FROM "WebAvailability" WHERE "expiresAt" <= ${now}`;
  return { imports: imports.count + overflow, snapshots, errors: errors.count };
}
