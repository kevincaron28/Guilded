import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { configureQuestionAutomation, configureRecap, deliverRecurringRecap } from "../src/services/recurring-delivery.js";
import { pauseWeeklyQuestion, saveWeeklyQuestion } from "../src/services/weekly-question-store.js";

const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const db = createPrismaClient(value), other = createPrismaClient(value);
const guild = await db.guild.create({ data: { discordId: `recurring-${Date.now()}`, name: "Recurring fixture" } });
const now = new Date("2030-01-01T14:00:00Z"); // Tuesday 09:00 Toronto.
const settings = { timezone: "America/Toronto", weekday: 2, minute: 540, quietStart: 1320, quietEnd: 480 };
try {
  const people = await Promise.all(["race", "pause", "uncertain", "permission"].map(name => db.member.create({ data: { guildId: guild.id, discordUserId: name, displayName: name } })));
  for (const person of people) await configureRecap(db, guild.id, person.id, settings, true);
  const [race, pause, uncertain, permission] = people;
  assert(race && pause && uncertain && permission);
  let sent = 0;
  const input = { authorize: async () => true, send: async () => { sent++; return "message"; } };
  await Promise.all([db, other].map(client => deliverRecurringRecap(client, race.id, input, now)));
  assert.equal(sent, 1, "concurrent workers must send only once");
  await configureRecap(db, guild.id, race.id, settings, false);
  await configureRecap(db, guild.id, race.id, settings, true);
  assert.equal(await deliverRecurringRecap(db, race.id, input, now), "already-handled");
  assert.equal(sent, 1);
  let checks = 0;
  assert.equal(await deliverRecurringRecap(db, pause.id, { ...input, authorize: async () => {
    if (++checks === 2) await configureRecap(other, guild.id, pause.id, settings, false);
    return true;
  } }, now), "cancelled");
  checks = 0;
  assert.equal(await deliverRecurringRecap(db, permission.id, { ...input, authorize: async () => ++checks === 1 }, now), "cancelled");
  assert.equal(sent, 1);
  assert.equal(await deliverRecurringRecap(db, uncertain.id, { ...input, send: async () => { throw new Error("ambiguous timeout"); } }, now), "uncertain");
  assert.equal(await deliverRecurringRecap(db, uncertain.id, input, now), "already-handled");
  assert.equal(sent, 1);
  await assert.rejects(configureRecap(db, "foreign", race.id, settings, true), /unavailable/);
  await assert.rejects(configureRecap(db, guild.id, race.id, { ...settings, minute: 23 * 60 }, true), /quiet/);
  const question = { question: "Which dungeon next?", options: [], mode: "question", timezone: settings.timezone, weekday: 2, minute: 540, channelId: "12345678901234567" };
  await saveWeeklyQuestion(db, guild.id, "officer", question);
  const approved = await configureQuestionAutomation(db, guild.id, "approver", true, { start: 1320, end: 480 });
  assert(approved.automation);
  assert.equal(approved.createdBy, "approver");
  await saveWeeklyQuestion(db, guild.id, "officer", { ...question, question: "Changed question?" });
  assert.equal((await db.weeklyQuestionPlan.findUniqueOrThrow({ where: { guildId: guild.id } })).automation, null);
  await configureQuestionAutomation(db, guild.id, "approver", true, { start: 1320, end: 480 });
  await pauseWeeklyQuestion(db, guild.id, true);
  await pauseWeeklyQuestion(db, guild.id, false);
  assert.equal((await db.weeklyQuestionPlan.findUniqueOrThrow({ where: { guildId: guild.id } })).automation, null, "manual resume must not enable automatic delivery");
  console.log("Recurring delivery concurrent claims, pause/permission races, uncertain-send holds and explicit reapproval passed.");
} finally {
  await db.guild.delete({ where: { id: guild.id } });
  await Promise.all([db.$disconnect(), other.$disconnect()]);
}
