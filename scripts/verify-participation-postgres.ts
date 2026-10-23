import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
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
}
