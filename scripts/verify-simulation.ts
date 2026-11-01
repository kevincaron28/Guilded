// Runs only against the disposable local release database.
import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { cleanupTestRaids, finishTestRaid, startTestRaid } from "../src/services/simulation.js";
import { applyRaidEpProposal } from "../src/services/ep-award.js";
const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const database = createPrismaClient(value);
const guild = await database.guild.create({ data: { discordId: `simulation-${Date.now()}`, name: "Simulation fixture",
  settings: { create: { coreLootOnly: true } } } });
try {
  const real = await database.member.create({ data: { guildId: guild.id, discordUserId: "real", displayName: "Real member" } });
  const realCore = await database.raidCore.create({ data: { guildId: guild.id, name: "Real core", separatePool: true } });
  const result = await startTestRaid(database, { guildId: guild.id, createdBy: "simulation-check", officerMemberId: real.id, realm: "ReleaseTest", raiders: 10, startsInMinutes: 70 });
  const pool = `sim-core:${result.raid.id}`;
  assert.equal((await database.raid.findUniqueOrThrow({ where: { id: result.raid.id } })).coreId, pool);
  await database.raidSignup.create({ data: { raidId: result.raid.id, memberId: real.id, role: "DPS", status: "SIGNED_UP" } });
  // A manually recorded real member must also be excluded from test EP.
  await database.raidAttendance.create({ data: { raidId: result.raid.id, memberId: real.id, status: "PRESENT", recordedBy: "simulation-check" } });
  await finishTestRaid(database, { guildId: guild.id, raidId: result.raid.id, officerId: "simulation-check", realm: "ReleaseTest", viaAddon: false });
  const awarded = await applyRaidEpProposal(database, guild.id, result.raid.id, "simulation-check");
  assert.ok(awarded.created > 0);
  assert.equal(await database.epgpTransaction.count({ where: { memberId: real.id } }), 0);
  assert.equal(await database.epgpTransaction.count({ where: { guildId: guild.id, coreId: null } }), 0);
  assert.ok(await database.epgpTransaction.count({ where: { guildId: guild.id, coreId: pool } }));
  await cleanupTestRaids(database, guild.id);
  assert.equal(await database.raidCore.count({ where: { id: pool } }), 0);
  assert.equal(await database.raidCore.count({ where: { id: realCore.id } }), 1);
  assert.equal(await database.member.count({ where: { id: real.id } }), 1);
  assert.equal(await database.epgpTransaction.count({ where: { guildId: guild.id } }), 0);
  console.log("Simulation rehearsal: per-core awards, real-member exclusion and cleanup passed.");
} finally {
  await database.guild.delete({ where: { id: guild.id } });
  await database.$disconnect();
}
