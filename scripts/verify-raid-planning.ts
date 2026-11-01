import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { parsePlan, raidPlanningStore } from "../src/services/raid-planning.js";
const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const db = createPrismaClient(value);
const guildId = "release-planning", raidId = "release-planning-raid";
try {
  if (process.argv.includes("--restored")) {
    assert.equal(await db.raidPlanRevision.count({ where: { raidId } }), 3);
    assert.equal(await db.raidSupplyPledge.count({ where: { revision: { raidId } } }), 1);
    const latest = await db.raidPlanRevision.findFirstOrThrow({ where: { raidId }, orderBy: { revision: "desc" } });
    assert.equal(latest.active, false);
  } else {
    await db.guild.create({ data: { id: guildId, discordId: "planning-discord", name: "Planning fixture" } });
    await db.member.create({ data: { id: "planning-member", guildId, discordUserId: "member", displayName: "Member" } });
    await db.raid.create({ data: { id: raidId, guildId, title: "Planning raid", scheduledAt: new Date(), signupChannelId: "channel", createdBy: "officer" } });
    const access = { guilds: async () => [], authorize: async () => ({ id: guildId, name: "Fixture", edition: "forever" }) };
    const officer = { ...access, authorize: async (user: string) => user === "officer" ? access.authorize() : null };
    const client = { isReady: () => true, guilds: { fetch: async () => ({ members: { fetch: async () => ({}) }, channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => true }) }) } }) } };
    const store = raidPlanningStore(db, access as never, officer as never, client as never);
    const payload = parsePlan("SUPPLIES", { summary: "Voluntary", items: "Food | 2 | 5" }, new Date());
    await assert.rejects(store.publish("member", guildId, raidId, "SUPPLIES", 0, payload, true), /access/);
    const results = await Promise.allSettled([store.publish("officer", guildId, raidId, "SUPPLIES", 0, payload, true), store.publish("officer", guildId, raidId, "SUPPLIES", 0, payload, true)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const first = await db.raidPlanRevision.findFirstOrThrow({ where: { raidId } });
    await store.pledge("member", guildId, raidId, first.id, 0, 10, 4);
    await store.pledge("member", guildId, raidId, first.id, 0, 8, 3);
    assert.equal(await db.raidSupplyPledge.count({ where: { revisionId: first.id } }), 1);
    const second = await store.publish("officer", guildId, raidId, "SUPPLIES", 1, payload, true);
    await assert.rejects(store.pledge("member", guildId, raidId, first.id, 0, 4, 0), /stale/);
    assert.equal(await db.raidSupplyPledge.count({ where: { revisionId: second.id } }), 0);
    await store.publish("officer", guildId, raidId, "SUPPLIES", 2, payload, false);
    assert.equal((await store.load("member", guildId, raidId, "SUPPLIES"))?.current, null);
    assert.equal(await db.epgpTransaction.count({ where: { guildId } }), 0);
    assert.equal(await db.auditLog.count({ where: { guildId } }), 3);
  }
  console.log("Approved raid planning concurrency, voluntary pledges and retained history verified.");
} finally { await db.$disconnect(); }
