import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { createBattleground } from "../src/services/battleground-organization.js";
import { manageSession, respondToSession, runTeamSchedules, setTeamMember, updateTeamSchedule } from "../src/services/activity-core.js";

const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const db = createPrismaClient(value), other = createPrismaClient(value);
const guild = await db.guild.create({ data: { discordId: `bg-${Date.now()}`, name: "BG fixture", gameEdition: "retail" } });
const now = new Date("2030-01-01T12:00:00Z");
const plan = { version: 1, edition: "retail", realmType: "normal", mode: "blitz", map: "Random", minLevel: 90, maxLevel: 90, faction: "Alliance" };
const confirmation = { normalRealm: true, faction: "Alliance" };
try {
  const session = await createBattleground(db, guild.id, { name: "BG duo", plan, channelId: "private", startsAt: new Date("2030-01-01T13:00:00Z"), tanks: 0, healers: 1, dps: 1, durationMinutes: 120 }, now);
  const members = await Promise.all(Array.from({ length: 4 }, (_, n) => db.member.create({ data: {
    guildId: guild.id, discordUserId: `bg-${n}`, displayName: `BG ${n}`, characters: { create: {
      guildId: guild.id, gameEdition: "retail", name: `BG${n}`, realm: "Test", className: "PRIEST", level: 90,
    } },
  }, include: { characters: true } })));
  const first = members[0]!;
  await assert.rejects(respondToSession(db, guild.id, session.id, first.id, "CONFIRMED", "DPS", first.characters[0]!.id, now), /Confirm normal/);
  await assert.rejects(respondToSession(db, guild.id, session.id, first.id, "CONFIRMED", "DPS", members[1]!.characters[0]!.id, now, confirmation));
  await assert.rejects(setTeamMember(db, guild.id, session.coreId, first.id, "DPS", false, first.characters[0]!.id), /join themselves/);
  await assert.rejects(updateTeamSchedule(db, guild.id, session.coreId, "tue 20h", "UTC", 120), /one-off/);
  // Independent connections compete for one DPS slot. The team lock serializes
  // allocation; repeated self-signups keep a single durable response per member.
  await Promise.all(members.map((member, n) => respondToSession(n % 2 ? db : other, guild.id, session.id, member.id,
    "CONFIRMED", n === 0 ? "HEALER" : "DPS", member.characters[0]!.id, now, confirmation)));
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, status: "CONFIRMED" } }), 2);
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, status: "WAITLISTED" } }), 2);
  const selected = await db.activityResponse.findFirstOrThrow({ where: { sessionId: session.id, status: "CONFIRMED", role: "DPS" } });
  await respondToSession(db, guild.id, session.id, selected.memberId, "ABSENT", null, null, now);
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, status: "CONFIRMED" } }), 2);
  await runTeamSchedules(db, guild.id, error => { throw error; }, now);
  assert.equal(await db.discordJob.count({ where: { guildId: guild.id } }), 0);
  assert.equal(await db.activitySession.count({ where: { coreId: session.coreId } }), 1);
  // A changed/deleted linked identity is rechecked at start.
  await db.character.update({ where: { id: first.characters[0]!.id }, data: { level: 89 } });
  await assert.rejects(manageSession(db, guild.id, session.id, "start", null, now), /level/);
  await db.character.update({ where: { id: first.characters[0]!.id }, data: { level: 90 } });
  await manageSession(db, guild.id, session.id, "start", null, now);
  await assert.rejects(respondToSession(db, guild.id, session.id, selected.memberId, "CONFIRMED", "DPS", null, now, confirmation), /closed/);
  assert.equal(await db.discordJob.count({ where: { guildId: guild.id } }), 0);
  assert.equal(await db.raid.count({ where: { guildId: guild.id } }), 0);
  assert.equal(await db.epgpTransaction.count({ where: { guildId: guild.id } }), 0);
  const draft = await createBattleground(db, guild.id, { name: "Unverified rated", plan: { ...plan, mode: "rated" }, channelId: "private", startsAt: new Date("2030-01-01T13:00:00Z"), tanks: 0, healers: 1, dps: 4, durationMinutes: 120 }, now);
  await assert.rejects(manageSession(db, guild.id, draft.id, "start", null, now), /Planning only/);
  console.log("BG migration, concurrent signup/waitlist, identity revalidation and no-publication boundaries passed.");
} finally {
  await db.guild.delete({ where: { id: guild.id } });
  await Promise.all([db.$disconnect(), other.$disconnect()]);
}
