import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { editionCalendarInventory, initializationPreview, initializeEmptyEditionCalendars, INITIAL_EDITIONS } from "../src/services/initialize-edition-calendars.js";
import { addCalendarMonths } from "../src/services/official-periods.js";
import { readRuleSnapshot } from "../src/services/public-score.js";
import { ensureQuarterlyCalendar } from "../src/services/official-seasons.js";
import { withEdition } from "../src/services/edition-context.js";

const value = process.env["TEST_DATABASE_URL"];
const url = new URL(value ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const db = createPrismaClient(value), other = createPrismaClient(value);
const before = initializationPreview(await editionCalendarInventory(db));
assert(before.rows.every(r => Object.entries(r).every(([k, v]) => k === "edition" || v === 0)), "Run this fixture before other edition fixtures");
const forever = await db.officialSeason.findMany({ where: { gameEdition: "forever" } });
let fixtureGuild: string | undefined;
let fixtureRun: string | undefined;
try {
  let acquired!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const writer = other.$transaction(async tx => {
    // A writer has begun but its evidence is not yet visible to the inventory.
    await tx.$executeRaw`LOCK TABLE "AddonImport" IN ROW EXCLUSIVE MODE`;
    acquired();
    await finish;
  }, { timeout: 15_000 });
  try { await ready; await assert.rejects(() => initializeEmptyEditionCalendars(db, before.sha256), /lock|55P03/i); }
  finally { release(); await writer; }
  assert.equal(await db.officialSeason.count({ where: { gameEdition: { in: [...INITIAL_EDITIONS] } } }), 0);

  const guild = await db.guild.create({ data: { discordId: `calendar-init-${Date.now()}`, name: "Calendar fixture", gameEdition: "retail" } });
  fixtureGuild = guild.id;
  const pending = await db.addonImport.create({ data: { guildId: guild.id, source: "fixture", checksum: "fixture", status: "PREVIEWED", createdBy: "fixture", payload: { dungeonRuns: [{ state: "UNVALIDATED" }] } } });
  await assert.rejects(() => initializeEmptyEditionCalendars(db, before.sha256), /Inventory changed/);
  async function rejectCurrent(reason: RegExp) {
    const preview = initializationPreview(await editionCalendarInventory(db));
    await assert.rejects(() => initializeEmptyEditionCalendars(db, preview.sha256), reason);
  }
  await rejectCurrent(/Preserving existing retail imports/);
  assert(await db.addonImport.findUnique({ where: { id: pending.id } }));
  await db.addonImport.delete({ where: { id: pending.id } });
  const run = await db.publicRun.create({ data: { gameEdition: "retail", runKey: "calendar-init-fixture", runRef: "fixture", instanceId: 1,
    dungeonName: "Fixture", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: new Date("2026-01-01T00:10:00Z"), durationSec: 600,
    season: "fixture", source: "personal", status: "DISPUTED" } });
  fixtureRun = run.id;
  await rejectCurrent(/Preserving existing retail publicRuns/);
  await db.publicRun.delete({ where: { id: run.id } }); fixtureRun = undefined;
  await db.guild.delete({ where: { id: guild.id } }); fixtureGuild = undefined;

  const preview = initializationPreview(await editionCalendarInventory(db));
  const result = await initializeEmptyEditionCalendars(db, preview.sha256);
  assert.equal(result.receipts.length, 4);
  for (const receipt of result.receipts) {
    const saved = await db.officialSeason.findUniqueOrThrow({ where: { id: receipt.id } });
    const snapshot = readRuleSnapshot(saved.rules)!;
    assert(snapshot);
    assert.equal(snapshot.calendar?.guildedActivation, saved.startsAt.toISOString());
    assert.equal(snapshot.calendar?.region, "NA");
    assert.equal(saved.startsAt.toISOString(), result.activation);
    if (receipt.edition === "classic-era") assert.equal(receipt.endsAt, addCalendarMonths(saved.startsAt).toISOString());
    else assert.equal(receipt.endsAt, null);
  }
  await rejectCurrent(/Preserving existing classic-era calendars/);
  const eraEnd = new Date(result.receipts.find(r => r.edition === "classic-era")!.endsAt!);
  assert.equal(await withEdition("classic-era", () => ensureQuarterlyCalendar(db, new Date(eraEnd.getTime() + 1000))), 1);
  assert.equal(await withEdition("classic-era", () => ensureQuarterlyCalendar(db, new Date(eraEnd.getTime() + 1000))), 0);
  assert.deepEqual(await db.officialSeason.findMany({ where: { gameEdition: "forever" } }), forever);
  console.log("Empty-edition initialization: pending/concurrent/disputed evidence refused, atomic activation and calendar-month recurrence verified.");
} finally {
  if (fixtureRun) await db.publicRun.delete({ where: { id: fixtureRun } });
  if (fixtureGuild) await db.guild.delete({ where: { id: fixtureGuild } });
  // Initial inventory was empty; only this fixture could create these rows.
  await db.officialSeason.deleteMany({ where: { gameEdition: { in: [...INITIAL_EDITIONS] }, createdBy: { in: ["owner-authorized-2026-10-30", "guilded-quarterly"] } } });
  await db.$disconnect(); await other.$disconnect();
}
