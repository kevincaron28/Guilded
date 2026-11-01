import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { battlegroundHistory, battlegroundStats, correctBattlegroundReport, importBattlegroundReports, setBattlegroundConsent } from "../src/services/battleground-records.js";
import { createAddonImportService } from "../src/services/addon-import.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";

const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const db = createPrismaClient(value), other = createPrismaClient(value);
const guild = await db.guild.create({ data: { discordId: `bg-records-${Date.now()}`, name: "BG records fixture", gameEdition: "forever" } });
const now = new Date("2030-01-01T14:00:00Z"), start = new Date("2030-01-01T00:00:00Z");
try {
  const people = await Promise.all(["One", "Two", "Three"].map(name => db.member.create({ data: {
    guildId: guild.id, discordUserId: name, displayName: name,
    characters: { create: { guildId: guild.id, gameEdition: "forever", name, realm: "Forever", className: "Mage" } }
  }, include: { characters: true } })));
  const [one, two, three] = people; assert(one && two && three);
  for (const person of people) await setBattlegroundConsent(db, guild.id, person.id, { capture: true, guildStats: true }, start);
  const report = { version: 1, reportId: "match-report-001", adapter: "forever-postmatch-v1", edition: "forever",
    character: "One", realm: "Forever", realmType: "normal", mode: "casual", mapId: 489, bracket: "60",
    endedAt: now.getTime() / 1000 - 60, durationSeconds: 600, outcome: "win", presence: "complete", reloaded: false,
    postmatch: true, consent: true, premadeNonce: "unique-match-nonce-001" };
  const ingest = (client: typeof db, member: string, rows: unknown[]) => client.$transaction(tx => importBattlegroundReports(tx, guild.id, member, rows, now));
  const raced = await Promise.all([db, other].map(client => ingest(client, one.id, [report])));
  assert.equal(raced.reduce((sum, r) => sum + r.recorded, 0), 1, "concurrent replay inserts once");
  assert.equal(await db.battlegroundReport.count({ where: { guildId: guild.id } }), 1);
  assert.equal((await ingest(db, two.id, [report])).rejected, 1, "reporter cannot claim other character");
  await ingest(db, two.id, [{ ...report, character: "Two", reportId: "match-report-002" }]);
  const pair = await db.battlegroundReport.findMany({ where: { guildId: guild.id } });
  assert.equal(pair.length, 2); assert(pair.every(r => r.corroborated && r.status === "PROVISIONAL"));
  const scope = { edition: "forever", mode: "casual", bracket: "60", startsAt: start, endsAt: now };
  let stats = await battlegroundStats(db, guild.id, scope);
  assert.equal(stats.participations, 2); assert.equal(stats.wins, 2); assert.equal(stats.verifiedMatches, null);
  await setBattlegroundConsent(other, guild.id, two.id, { capture: true, guildStats: false }, now);
  assert.equal((await battlegroundStats(db, guild.id, scope)).participations, 1, "revoked stats consent applies immediately");
  await setBattlegroundConsent(other, guild.id, two.id, { capture: false, guildStats: false }, now);
  await ingest(db, three.id, [{ ...report, character: "Three", reportId: "match-report-003" }]);
  assert.equal((await db.battlegroundReport.findFirstOrThrow({ where: { guildId: guild.id, memberId: two.id } })).corroborated, false,
    "a new peer must not recorroborate a revoked participant");
  await ingest(db, one.id, [{ ...report, outcome: "loss" }]);
  assert((await db.battlegroundReport.findMany({ where: { guildId: guild.id } })).every(r => r.status === "CONFLICT"));
  assert.equal((await battlegroundStats(db, guild.id, scope)).participations, 0);
  await correctBattlegroundReport(db, guild.id, one.id, report.reportId, "Fixture correction");
  await ingest(db, one.id, [report]);
  assert.equal((await battlegroundHistory(db, guild.id, one.id, report.reportId))[0]?.status, "WITHDRAWN");
  await assert.rejects(correctBattlegroundReport(db, guild.id, two.id, report.reportId, "Not mine"));
  await setBattlegroundConsent(db, guild.id, one.id, { capture: false, guildStats: false }, now);
  assert.equal((await ingest(other, one.id, [{ ...report, reportId: "match-report-003" }])).rejected, 1);
  stats = await battlegroundStats(db, guild.id, scope); assert.equal(stats.winRate, null);
  // Staging must acquire the same consent lock before reading and persisting.
  await setBattlegroundConsent(db, guild.id, one.id, { capture: true, guildStats: false }, start);
  const staging: { pending?: ReturnType<ReturnType<typeof createAddonImportService>["record"]> } = {};
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guild.id}, 0))`;
    await tx.battlegroundConsent.update({ where: { memberId: one.id }, data: { capture: false, guildStats: false } });
    staging.pending = createAddonImportService(other).record(guild.id, parseAddonSnapshot({ source: "BG fixture", gameEdition: "forever",
      exportedAt: now.toISOString(), battlegroundReports: [report] }), "bg-staging-race", one.discordUserId, one.id);
  });
  assert(staging.pending); const stagedRow = await staging.pending;
  assert.deepEqual((stagedRow.payload as { battlegroundReports: unknown[] }).battlegroundReports, []);
  console.log("BG concurrent replay, own-character consent, provisional corroboration/conflicts, scoped statistics and withdrawal passed.");
} finally {
  await db.guild.delete({ where: { id: guild.id } });
  await Promise.all([db.$disconnect(), other.$disconnect()]);
}
