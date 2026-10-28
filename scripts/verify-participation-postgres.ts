import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createParticipationService } from "../src/services/participation.js";
import { createCommunityService } from "../src/services/community.js";
import { participationRules } from "../src/services/participation-rules.js";

// Called only by the existing guarded disposable-local PostgreSQL rehearsal.
export async function verifyParticipationPostgres(database: PrismaClient, guildId: string) {
  const community = createCommunityService(database), service = createParticipationService(database);
  const season = await community.startSeason(guildId, { name: "Release participation season", game: "DISCORD", channelId: "social", audienceRoleId: null, actorId: "officer" });
  const cfg = await service.configure(guildId, season.id, true, participationRules.parse({ textChannels: ["social"], voiceChannels: ["voice"] }));
  const at = new Date("2030-01-01T16:00:00Z");
  const message = { userId: "social-member", channelId: "social", messageId: "social-one", hash: "hash-one", contentAvailable: true, at, revision: cfg.revision };
  const attempts = await Promise.all([1, 2, 3].map(() => service.message(guildId, season.id, message)));
  assert.equal(attempts.filter(Boolean).length, 1);
  await Promise.all([1, 2, 3].map(index => service.message(guildId, season.id, { ...message, messageId: `social-concurrent-${index}`, hash: `hash-${index}` })));
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, reference: { startsWith: "participation:message:" } } }), 1);
  for (let index = 1; index < 12; index++) await service.message(guildId, season.id, { ...message, messageId: `social-${index}`, hash: `next-${index}`, at: new Date(at.getTime() + index * 300_000) });
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, reference: { startsWith: "participation:message:" } } }), 10);
  const reaction = { userId: "social-member", reactorId: "reactor", channelId: "social", messageId: "social-one", at, revision: cfg.revision };
  assert.equal((await Promise.all([1, 2, 3].map(() => service.reaction(guildId, season.id, reaction)))).filter(Boolean).length, 1);
  await service.reaction(guildId, season.id, { ...reaction, messageId: "social-two" });
  assert.equal(await service.reaction(guildId, season.id, { ...reaction, messageId: "social-three" }), false);
  await Promise.all(["a", "b", "c", "d"].map(reactorId => service.reaction(guildId, season.id, { ...reaction, reactorId })));
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, reference: { startsWith: "participation:reaction:social-one:" } } }), 3);
  await database.communityParticipationDay.create({ data: { seasonId: season.id, userId: "voice-member", day: "2030-01-01", voiceMs: 239 * 60_000 + 30_000, voicePoints: 30 } });
  await database.communityPoint.create({ data: { seasonId: season.id, userId: "voice-member", amount: 30, kind: "AWARD", reference: "participation:voice:voice-member:2030-01-01:30", reason: "Voice fixture", actorId: "Guilded", createdAt: at } });
  const end = new Date(at.getTime() + 60_000);
  await Promise.all([1, 2, 3].map(() => service.voice(guildId, season.id, "voice-member", at, end, cfg.revision)));
  const day = await database.communityParticipationDay.findUniqueOrThrow({ where: { seasonId_userId_day: { seasonId: season.id, userId: "voice-member", day: "2030-01-01" } } });
  assert.equal(day.voiceMs, 240 * 60_000);
  assert.equal(day.voicePoints, 32);
  assert.equal(await service.voice(guildId, season.id, "voice-member", end, new Date(end.getTime() + 60_000), cfg.revision), 0);
  assert.equal((await database.communityPoint.aggregate({ where: { seasonId: season.id, userId: "voice-member" }, _sum: { amount: true } }))._sum.amount, 32);
  // The owner's two-hour profile keeps the same 32-point maximum. Concurrent
  // checkpoints at its last block must award exactly once at the selected rate.
  const fast = await service.configure(guildId, season.id, true, participationRules.parse({ ...participationRules.parse(cfg.rules), voiceDailyMinutes: 120, voiceBlockPoints: 4 }));
  await database.communityParticipationDay.create({ data: { seasonId: season.id, userId: "fast-voice", day: "2030-01-01", voiceMs: 119 * 60_000 + 30_000, voicePoints: 28 } });
  const fastAwards = await Promise.all([1, 2, 3].map(() => service.voice(guildId, season.id, "fast-voice", at, end, fast.revision)));
  assert.equal(fastAwards.reduce((sum, value) => sum + value, 0), 4);
  const fastDay = await database.communityParticipationDay.findUniqueOrThrow({ where: { seasonId_userId_day: { seasonId: season.id, userId: "fast-voice", day: "2030-01-01" } } });
  assert.equal(fastDay.voiceMs, 120 * 60_000);
  assert.equal(fastDay.voicePoints, 32);
  assert.equal(await service.voice(guildId, season.id, "fast-voice", end, new Date(end.getTime() + 60_000), fast.revision), 0);
  // Restore the fixture's rules and revision for the remaining stale-settings checks.
  await database.communityParticipationConfig.update({ where: { seasonId: season.id }, data: { rules: participationRules.parse(cfg.rules), revision: cfg.revision } });
  const nomination = await service.nominate(guildId, season.id, "helper", "nominator", "Release helper fixture", at);
  await assert.rejects(service.review(guildId, season.id, nomination.id, "nominator", true, "Self review", at));
  await assert.rejects(community.endSeason(guildId, season.id), /nominations/);
  await Promise.all([1, 2, 3].map(() => service.review(guildId, season.id, nomination.id, "officer", true, "Verified", at)));
  const helper = await database.communityPoint.findFirstOrThrow({ where: { seasonId: season.id, reference: `participation:helper:${nomination.id}` } });
  assert.equal(helper.amount, 15);
  await Promise.all([1, 2].map(() => service.reverse(guildId, season.id, helper.id, "officer", "Correction", at)));
  assert.equal((await database.communityPoint.aggregate({ where: { seasonId: season.id, userId: "helper" }, _sum: { amount: true } }))._sum.amount, 0);
  await Promise.all([1, 2].map(() => service.deleteMessage(guildId, season.id, "social-one", at)));
  assert.equal(await service.reaction(guildId, season.id, { ...reaction, reactorId: "late" }), false);
  await service.deleteMessage(guildId, season.id, "delayed", at);
  assert.equal(await service.message(guildId, season.id, { ...message, userId: "late", messageId: "delayed" }), false);
  const peer = await database.guild.create({ data: { name: "Participation peer", discordId: "release-test-social-peer" } });
  assert.equal(await service.message(peer.id, season.id, { ...message, messageId: "cross-guild" }), false);
  await assert.rejects(service.reverse(peer.id, season.id, helper.id, "officer", "Cross guild", at));
  await database.guild.delete({ where: { id: peer.id } });
  // Force ledger failure inside a real transaction: the daily counter must roll back.
  const broken = { $transaction: (work: (tx: unknown) => Promise<unknown>) => database.$transaction(async tx => work(new Proxy(tx, { get(target, property) {
    if (property === "communityPoint") return { ...target.communityPoint, findUnique: target.communityPoint.findUnique.bind(target.communityPoint), create: async () => { throw new Error("Forced participation ledger failure"); } };
    return Reflect.get(target, property);
  } }))) } as unknown as PrismaClient;
  await assert.rejects(createParticipationService(broken).message(guildId, season.id, { ...message, userId: "rollback", messageId: "rollback" }), /Forced participation ledger/);
  assert.equal(await database.communityParticipationDay.count({ where: { seasonId: season.id, userId: "rollback" } }), 0);
  await community.endSeason(guildId, season.id);
  await assert.rejects(service.reverse(guildId, season.id, helper.id, "officer", "Frozen", at));
  await verifyParticipationSummaryPostgres(database);
}

async function verifyParticipationSummaryPostgres(database: PrismaClient) {
  const guild = await database.guild.create({ data: { name: "Summary fixture", discordId: "release-summary" } });
  const foreign = await database.guild.create({ data: { name: "Foreign summary fixture", discordId: "release-summary-foreign" } });
  try {
    const community = createCommunityService(database), service = createParticipationService(database);
    const options = { name: "Summary season", game: "DISCORD", channelId: "social", audienceRoleId: null, actorId: "officer" };
    const season = await community.startSeason(guild.id, options);
    const other = await community.startSeason(foreign.id, options);
    const now = new Date("2030-01-08T16:00:00Z"), old = new Date("2030-01-01T16:00:00Z"), weekStart = new Date("2030-01-07T05:00:00Z");
    const empty = await service.summary(guild.id, season.id, "member", now);
    assert.deepEqual([empty.points, empty.participants, empty.helpers], [0, 0, []]);
    const point = (id: string, userId: string, amount: number, reference: string, createdAt = now, kind = "AWARD", seasonId = season.id) =>
      ({ id, seasonId, userId, amount, kind, reference, createdAt, reason: "Summary fixture", actorId: "officer" });
    await database.communityPoint.createMany({ data: [
      point("summary-member-old", "member", 100, "activity:member-old", old),
      point("summary-member-week", "member", 1, "participation:message:member-week", weekStart),
      point("summary-member-spend", "member", -500, "spend:fixture", now, "SPEND"),
      point("summary-helper-old", "summary-helper-a", 15, "participation:helper:old", old),
      point("summary-helper-week", "summary-helper-a", 45, "participation:helper:week"),
      point("summary-helper-reverse", "summary-helper-a", -15, "participation:reverse:summary-helper-old", now, "REVERSAL"),
      // A reversal must not classify a different season's award as this season's helper credit.
      point("summary-foreign-helper", "summary-helper-a", 200, "participation:helper:foreign", old, "AWARD", other.id),
      point("summary-foreign-reverse", "summary-helper-a", -15, "participation:reverse:summary-foreign-helper", now, "REVERSAL"),
      point("summary-foreign-member", "member", 10_000, "activity:foreign", now, "AWARD", other.id),
      ...["b", "c", "d", "e", "f", "g", "h"].map(key => point(`summary-helper-${key}`, `summary-helper-${key}`, 15, `participation:helper:${key}`)),
      point("summary-cancel", "cancelled", 1, "participation:message:cancel"),
      point("summary-cancel-reverse", "cancelled", -1, "participation:reverse:summary-cancel", now, "REVERSAL"),
      point("summary-old-only", "old-only", 5, "activity:old-only", old),
      point("summary-future", "future-only", 1, "activity:future", new Date(now.getTime() + 1)),
      point("summary-activity", "activity-only", 5, "activity:week"),
      ...Array.from({ length: 1_000 }, (_, index) => point(`summary-history-${index}`, "historical", 1, `activity:history-${index}`, old))
    ] });
    const result = await service.summary(guild.id, season.id, "member", now);
    assert.equal(result.points, 101);
    assert.equal(result.participants, 10);
    assert.deepEqual(result.helpers, [["summary-helper-a", 30], ["summary-helper-b", 15], ["summary-helper-c", 15], ["summary-helper-d", 15], ["summary-helper-e", 15]]);
    assert.equal((await service.summary(guild.id, season.id, "missing", now)).points, 0);
    await assert.rejects(service.summary(foreign.id, season.id, "member", now), /Season not found/);
  } finally {
    await database.guild.delete({ where: { id: guild.id } });
    await database.guild.delete({ where: { id: foreign.id } });
  }
}
