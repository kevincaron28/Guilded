import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { launchTimingRules } from "./dungeon-launch-timings.js";
import { snapshotRules } from "./public-score.js";
import { addCalendarMonths, initialOfficialPeriod, PERIOD_REVIEW } from "./official-periods.js";

export const INITIAL_EDITIONS = ["classic-era", "classic-tbc", "classic-mists", "retail"] as const;
type Db = Pick<Prisma.TransactionClient, "guild" | "officialSeason" | "dungeonSeason" | "dungeonRun" | "publicRun" | "publicRunUpload" | "dungeonPointTransaction" | "dungeonAchievement" | "addonImport" | "epgpTransaction" | "dkpTransaction">;
export async function editionCalendarInventory(db: Db) {
  const rows = [];
  for (const edition of INITIAL_EDITIONS) {
    const where = { guild: { gameEdition: edition } };
    // Count all imports, including rejected/empty/pending payloads. Conservative:
    // even malformed evidence requires review rather than assuming it is absent.
    rows.push({ edition, guilds: await db.guild.count({ where: { gameEdition: edition } }),
      calendars: await db.officialSeason.count({ where: { gameEdition: edition } }),
      guildSeasons: await db.dungeonSeason.count({ where }), runs: await db.dungeonRun.count({ where }),
      publicRuns: await db.publicRun.count({ where: { gameEdition: edition } }),
      reporterEvidence: await db.publicRunUpload.count({ where: { run: { gameEdition: edition } } }),
      points: await db.dungeonPointTransaction.count({ where }), achievements: await db.dungeonAchievement.count({ where }),
      imports: await db.addonImport.count({ where }), epgp: await db.epgpTransaction.count({ where }), dkp: await db.dkpTransaction.count({ where }) });
  }
  return rows;
}
export function initializationPreview(rows: Awaited<ReturnType<typeof editionCalendarInventory>>) {
  const policies = INITIAL_EDITIONS.map(edition => ({ edition, rulesSha256: launchTimingRules(edition).sha256, period: PERIOD_REVIEW }));
  return { rows, policies, sha256: createHash("sha256").update(JSON.stringify({ rows, policies })).digest("hex") };
}

/** One explicitly authorized, create-only initialization. Never a history reset.
 * Table NOWAIT locks cover pending imports and unscoped personal uploads as well
 * as the normal calendar advisory locks. An in-flight writer aborts this attempt.
 * New writers wait until commit and therefore cannot race the zero-data check. */
export async function initializeEmptyEditionCalendars(db: PrismaClient, expected: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "Guild", "OfficialSeason", "DungeonSeason", "DungeonRun", "PublicRun", "PublicRunUpload", "DungeonPointTransaction", "DungeonAchievement", "AddonImport", "EpgpTransaction", "DkpTransaction" IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
    for (const edition of INITIAL_EDITIONS) {
      const key = `dungeon-calendar:${edition}`;
      const locked = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
      if (!locked[0]?.locked) throw new Error(`Calendar busy: ${edition}; retry after the active operation completes`);
    }
    const inventory = initializationPreview(await editionCalendarInventory(tx));
    if (inventory.sha256 !== expected) throw new Error("Inventory changed; inspect a new preview");
    for (const row of inventory.rows) for (const [key, count] of Object.entries(row)) {
      if (key !== "edition" && key !== "guilds" && count !== 0) throw new Error(`Preserving existing ${row.edition} ${key}: ${count}`);
    }
    const clock = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const activation = clock[0]!.now;
    const receipts = [];
    for (const edition of INITIAL_EDITIONS) {
      const rules = launchTimingRules(edition).rules;
      const calendar = initialOfficialPeriod(edition, activation);
      const snapshot = { ...snapshotRules(rules, activation), calendar };
      const name = edition === "classic-era" ? "Guilded Era Season 1 (NA)" : `${calendar.title} (NA, partial)`;
      const created = await tx.officialSeason.create({ data: { gameEdition: edition, number: 1, name, startsAt: activation,
        createdBy: "owner-authorized-2026-10-30", rules: snapshot as unknown as Prisma.InputJsonValue } });
      let endsAt: Date | null = null;
      if (edition === "classic-era") {
        endsAt = addCalendarMonths(activation);
        await tx.officialSeason.create({ data: { gameEdition: edition, number: 2, name: "Guilded Era Season 2 (NA)", startsAt: endsAt,
          createdBy: "owner-authorized-2026-10-30", rules: { ...snapshot, calendar: { ...calendar, guildedActivation: endsAt.toISOString() } } as unknown as Prisma.InputJsonValue } });
      }
      receipts.push({ edition, id: created.id, startsAt: activation.toISOString(), endsAt: endsAt?.toISOString() ?? null,
        rulesSha256: launchTimingRules(edition).sha256, calendar });
    }
    return { applied: true, inventory, activation: activation.toISOString(), receipts };
  }, { maxWait: 5_000, timeout: 30_000 });
}
