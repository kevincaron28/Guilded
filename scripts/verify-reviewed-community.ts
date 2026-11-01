// Called only by the guarded disposable-local PostgreSQL rehearsal.
import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { deliverGroupWatch, saveGroupWatch, type WatchEvent } from "../src/services/group-watch.js";
import { actOnWeeklyQuestion, reviewWeeklyQuestion, saveWeeklyQuestion } from "../src/services/weekly-question-store.js";

const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const database = createPrismaClient(value);
const now = new Date("2026-10-30T22:00:00Z");
const guild = await database.guild.create({ data: { discordId: `reviewed-community-${Date.now()}`, name: "Review fixture", settings: { create: { targetedAlertsEnabled: true, targetedAlertsChannelId: "123456789012345678" } } } });
try {
  const member = await database.member.create({ data: { guildId: guild.id, discordUserId: "reviewed-member", displayName: "Review member" } });
  await saveGroupWatch(database, guild.id, member.id, { optedIn: true, timezone: "UTC", createdAt: "2026-10-30T12:00:00Z", expiresAt: "2026-11-01T12:00:00Z",
    weekdays: [0, 1, 2, 3, 4, 5, 6], available: { start: 20 * 60, end: 23 * 60 }, quiet: { start: 0, end: 8 * 60 }, types: ["vacancy"] }, ["HEALER"]);
  const event: WatchEvent = { key: "vacancy:test", type: "vacancy", startsAt: new Date("2026-10-30T22:30:00Z"), expiresAt: new Date("2026-10-30T22:30:00Z"),
    open: true, hasVacancy: true, channelId: "123456789012345678", messageId: "existing-post", title: "Fixture", excludedMemberIds: [],
    group: { kind: "DUNGEON", minLevel: null, maxLevel: null, rolesNeeded: ["HEALER"], leaderDiscordId: "leader" } };
  let notifications = 0;
  const results = await Promise.all(Array.from({ length: 4 }, () => deliverGroupWatch(database, { guildId: guild.id, memberId: member.id, eventKey: event.key,
    loadEvent: async () => event, access: async () => true, send: async () => { notifications++; return "notification"; } }, now)));
  assert.equal(results.filter(result => result === "sent").length, 1);
  assert.equal(notifications, 1);
  assert.equal(await database.targetedAlertAttempt.count({ where: { guildId: guild.id } }), 1);
  // A different event still shares the same locked cooldown budget.
  const next = { ...event, key: "vacancy:second" };
  assert.equal(await deliverGroupWatch(database, { guildId: guild.id, memberId: member.id, eventKey: next.key,
    loadEvent: async () => next, access: async () => true, send: async () => { throw new Error("must not send"); } }, now), "suppressed");

  await saveWeeklyQuestion(database, guild.id, "officer", { question: "Which activity?", options: ["Dungeon", "Raid"], mode: "button-poll", timezone: "UTC", weekday: 5, minute: 1200, channelId: event.channelId });
  const reviews = await Promise.all([reviewWeeklyQuestion(database, guild.id, "officer", now), reviewWeeklyQuestion(database, guild.id, "officer", now)]);
  let posts = 0;
  const posted = await Promise.all(reviews.map(review => actOnWeeklyQuestion(database, { reviewId: review.review.id, guildId: guild.id, actorId: "officer", action: "post",
    authorize: async () => true, send: async () => { posts++; throw new Error("simulated uncertain result"); } }, now)));
  assert.equal(posts, 1); assert.equal(posted.filter(result => result === "uncertain").length, 1);
  assert.equal(await database.weeklyQuestionOccurrence.count({ where: { guildId: guild.id, status: "UNCERTAIN" } }), 1);
  assert.equal(await database.poll.count({ where: { guildId: guild.id } }), 1);
  const retry = await actOnWeeklyQuestion(database, { reviewId: reviews[0]!.review.id, guildId: guild.id, actorId: "officer", action: "post", authorize: async () => true,
    send: async () => { throw new Error("must not retry"); } }, now);
  assert.equal(retry, "already-handled");
  console.log("Reviewed community PostgreSQL concurrency, deduplication and uncertain-delivery checks passed; no Discord calls.");
} finally {
  await database.guild.delete({ where: { id: guild.id } });
  await database.$disconnect();
}
