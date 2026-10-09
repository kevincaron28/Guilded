import type { PrismaClient } from "@prisma/client";

// Housekeeping for data that only grows. Every companion upload stores the whole export, and an
// officer's export repeats the guild's gear checks; left alone, both make the database and the
// daily backup (held in memory while it is written) larger every week. Points, loot history and
// raids are never touched here.

const DAY_MS = 86_400_000;
export const RETENTION = {
  // An applied export was already turned into ledger rows; a newer upload replaces it anyway.
  appliedImportDays: 30,
  // Never applied (waiting for /import apply): kept longer, then dropped.
  pendingImportDays: 90,
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
  // Items, consumables and findings go with their snapshot (ON DELETE CASCADE).
  const snapshots = await database.$executeRaw`
    DELETE FROM "InspectedCharacterSnapshot" old
    WHERE old."inspectedAt" < ${before(RETENTION.snapshotDays)}
      AND EXISTS (SELECT 1 FROM "InspectedCharacterSnapshot" newer
                  WHERE newer."characterId" = old."characterId" AND newer."inspectedAt" > old."inspectedAt")`;
  const errors = await database.errorReport.deleteMany({ where: { createdAt: { lt: before(RETENTION.errorReportDays) } } });
  await database.$executeRaw`DELETE FROM "AiDailyUsage" WHERE "day" < ${before(90).toISOString().slice(0, 10)}`;
  return { imports: imports.count, snapshots, errors: errors.count };
}
