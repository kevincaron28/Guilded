import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { queueGameEvents, saveOfficialEvent } from "../src/services/game-events.js";
import { deliverDiscordJob } from "../src/services/discord-jobs.js";

export async function verifyGameEventsPostgres(database: PrismaClient, guildId: string) {
  assert.equal((await database.officialGameEvent.findUniqueOrThrow({ where: { id: "poe2-full-release" } })).startsAt, null);
  assert.equal(await database.gameEventBoard.count(), 0); // migration never opts guilds in
  await database.officialGameEvent.deleteMany({ where: { id: "release-test-event" } });
  const now = new Date();
  const input = { id: "release-test-event", game: "POE2", region: "GLOBAL", titleEn: "Release test", titleFr: "Test de sortie", sourceUrl: "https://www.pathofexile.com/forum/view-thread/3999366", dateLabelEn: "", dateLabelFr: "", state: "SCHEDULED", startsAt: new Date(now.getTime() + 60 * 60_000) };
  await saveOfficialEvent(database, input, "release-test", now);
  const board = await database.gameEventBoard.create({ data: { guildId, channelId: "release-test-events", enabled: true, games: ["POE2"], region: "NA", poeRoleId: "opt-in-role", poeReminders: [60], poeRemindersEnabledAt: new Date(now.getTime() - 1000) } });
  await Promise.all([1, 2, 3].map(() => queueGameEvents(database, { guildId }, now)));
  const jobs = await database.discordJob.findMany({ where: { guildId, kind: "GAME_EVENT_REMINDER" } });
  assert.equal(jobs.length, 1);
  let sends = 0;
  await Promise.all([1, 2].map(() => deliverDiscordJob(database, jobs[0]!.id, async () => { sends++; })));
  assert.equal(sends, 1);
  await queueGameEvents(database, { guildId }, now);
  assert.equal((await database.discordJob.findUniqueOrThrow({ where: { id: jobs[0]!.id } })).status, "DONE");
  await saveOfficialEvent(database, { ...input, titleEn: "Copy edit" }, "release-test", now);
  assert.equal((await database.officialGameEvent.findUniqueOrThrow({ where: { id: input.id } })).scheduleVersion, 1);
  await saveOfficialEvent(database, { ...input, state: "POSTPONED", startsAt: null }, "release-test", now);
  await queueGameEvents(database, { guildId }, now);
  assert.equal(await database.discordJob.count({ where: { guildId, kind: "GAME_EVENT_REMINDER" } }), 1);
  await saveOfficialEvent(database, { ...input, startsAt: new Date(input.startsAt.getTime() + 1000) }, "release-test", now);
  await queueGameEvents(database, { guildId }, new Date(now.getTime() + 1000));
  assert.equal(await database.discordJob.count({ where: { guildId, kind: "GAME_EVENT_REMINDER" } }), 2);
  await assert.rejects(database.gameEventBoard.create({ data: { guildId, channelId: board.channelId, games: ["POE2"], region: "NA" } }), (error: unknown) => (error as { code: string }).code === "P2002");
  await assert.rejects(database.$executeRaw`UPDATE "OfficialGameEvent" SET "state" = 'TBA' WHERE "id" = ${input.id}`);
  await database.gameEventBoard.update({ where: { id: board.id }, data: { enabled: false } });
}

export async function verifyGameEventsRestored(database: PrismaClient) {
  const event = await database.officialGameEvent.findUniqueOrThrow({ where: { id: "release-test-event" } });
  assert.equal(event.scheduleVersion, 3);
  const board = await database.gameEventBoard.findFirstOrThrow({ where: { channelId: "release-test-events" } });
  assert.equal(board.enabled, false);
  const jobs = await database.discordJob.findMany({ where: { guildId: board.guildId, kind: "GAME_EVENT_REMINDER" } });
  assert.equal(jobs.length, 2);
  assert.equal(jobs.filter(job => job.status === "DONE").length, 1);
  let sends = 0;
  await deliverDiscordJob(database, jobs.find(job => job.status === "DONE")!.id, async () => { sends++; });
  assert.equal(sends, 0);
}
