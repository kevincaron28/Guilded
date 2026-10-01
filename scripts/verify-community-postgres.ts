import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createCommunityService } from "../src/services/community.js";

// Called only by the existing disposable-local PostgreSQL release gate.
export async function verifyCommunityPostgres(database: PrismaClient, guildId: string) {
  const service = createCommunityService(database);
  const now = new Date("2030-01-01T12:00:00Z");
  const endsAt = new Date("2030-01-02T12:00:00Z");
  const season = await service.startSeason(guildId, { name: "Release community season", game: "DISCORD", channelId: "community-channel", audienceRoleId: null, actorId: "officer" });
  await assert.rejects(service.startSeason(guildId, { name: "Duplicate", game: "DISCORD", channelId: "community-channel", audienceRoleId: null, actorId: "officer" }));
  const challenge = await service.create(guildId, season.id, { kind: "CHALLENGE", title: "Release community challenge", rules: { instructions: "Complete and submit evidence", points: 100 }, endsAt, actorId: "officer" }, now);
  await service.submit(guildId, challenge.id, "player-a", "https://example.com/proof-a", now);
  await assert.rejects(service.review(guildId, challenge.id, "player-a", "player-a", "APPROVE", "Self review"));
  await Promise.all([1, 2, 3].map(() => service.review(guildId, challenge.id, "player-a", "officer", "APPROVE", "Reviewed")));
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, kind: "AWARD" } }), 1);
  const lotteryRules = { mode: "POINTS", prize: "Cosmetic prize", cost: 30, currency: "points", realm: "", winners: 1, maxTickets: 10 };
  const first = await service.create(guildId, season.id, { kind: "LOTTERY", title: "Release community points draw", rules: lotteryRules, endsAt, actorId: "officer" }, now);
  const second = await service.create(guildId, season.id, { kind: "LOTTERY", title: "Competing wallet spend", rules: lotteryRules, endsAt, actorId: "officer" }, now);
  const spends = await Promise.allSettled([service.enterLottery(guildId, first.id, "player-a", 2, now), service.enterLottery(guildId, second.id, "player-a", 2, now)]);
  assert.equal(spends.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, kind: "SPEND" } }), 1);
  const winnerActivity = spends[0]!.status === "fulfilled" ? first : second;
  await Promise.all([1, 2, 3].map(() => service.enterLottery(guildId, winnerActivity.id, "player-a", 2, now)));
  assert.equal((await service.board(guildId, season.id))[0]!.balance, 40);
  assert.equal((await service.board(guildId, season.id))[0]!.points, 100);
  await Promise.all([first, second].map(row => service.close(guildId, row.id, true, now)));
  assert.equal((await service.board(guildId, season.id))[0]!.balance, 100);
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, kind: "REFUND" } }), 1);

  const wow = await service.startSeason(guildId, { name: "Release WoW community season", game: "WOW", channelId: "wow-community", audienceRoleId: "wow-role", actorId: "officer" });
  const paid = await service.create(guildId, wow.id, { kind: "LOTTERY", title: "Release community gold draw", rules: { ...lotteryRules, mode: "WOW_GOLD", currency: "gold", realm: "Test realm / Alliance", winners: 2 }, endsAt, actorId: "officer" }, now);
  await service.enterLottery(guildId, paid.id, "player-a", 2, now);
  await service.enterLottery(guildId, paid.id, "unpaid", 10, now);
  await assert.rejects(service.confirmPayment(guildId, paid.id, "player-a", "player-a", "Self-confirm", now));
  await Promise.all([1, 2, 3].map(() => service.confirmPayment(guildId, paid.id, "player-a", "officer", "60 gold trade confirmed", now)));
  const draws = await Promise.all([1, 2, 3].map(() => service.close(guildId, paid.id, false, endsAt)));
  for (const draw of draws) assert.deepEqual((draw.result as { winners: string[] }).winners, ["player-a"]);
  assert.deepEqual(draws[0]!.result, draws[1]!.result);
  assert.equal(await database.discordJob.count({ where: { guildId, key: `community:${paid.id}` } }), 1);
  await assert.rejects(service.confirmPayment(guildId, paid.id, "unpaid", "officer", "Too late", endsAt));

  const event = await service.create(guildId, season.id, { kind: "EVENT", title: "Release gaming night", rules: { capacity: 1, points: 10 }, startsAt: new Date("2030-01-01T14:00:00Z"), endsAt, actorId: "officer" }, now);
  const signups = await Promise.all(["player-a", "player-b"].map(user => service.signup(guildId, event.id, user, "JOINED", now)));
  assert.equal(signups.filter(row => row.status === "JOINED").length, 1);
  assert.equal(signups.filter(row => row.status === "WAITLISTED").length, 1);
  const joined = signups.find(row => row.status === "JOINED")!;
  const waiting = signups.find(row => row.status === "WAITLISTED")!;
  await service.signup(guildId, event.id, joined.userId, "ABSENT", now);
  assert.equal((await database.communityEntry.findUniqueOrThrow({ where: { id: waiting.id } })).status, "JOINED");
  const eventTime = new Date("2030-01-01T14:30:00Z");
  await Promise.all([1, 2].map(() => service.attendance(guildId, event.id, waiting.userId, "officer", eventTime)));
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, reference: `attendance:${event.id}:${waiting.userId}` } }), 1);
  await service.close(guildId, event.id, false, eventTime);
  const quiz = await service.create(guildId, season.id, { kind: "QUIZ", title: "Release quiz", rules: { choices: ["A", "B", "C", "D"], correct: 2, points: 20 }, endsAt, actorId: "officer" }, now);
  await assert.rejects(service.answerQuiz(guildId, quiz.id, "officer", 2, now));
  await Promise.all([2, 2, 2].map(choice => service.answerQuiz(guildId, quiz.id, "player-a", choice, now)));
  assert.equal(await database.communityPoint.count({ where: { reference: `quiz:${quiz.id}:player-a` } }), 1);
  const rolls = await Promise.all([1, 2, 3].map(() => service.dice(guildId, season.id, "player-a", "2030-01-01", now)));
  assert.ok(rolls.every(row => row.evidence === rolls[0]!.evidence));
  assert.equal(await database.communityPoint.count({ where: { reference: "dice:2030-01-01:player-a" } }), 1);
  await service.close(guildId, quiz.id, false, endsAt);
  await service.close(guildId, challenge.id, false, endsAt);
  await service.review(guildId, challenge.id, "player-a", "officer", "REVERSE", "Correction retained in ledger");
  assert.equal(await database.communityPoint.count({ where: { reference: `claim:${challenge.id}:player-a:REVERSE` } }), 1);
  const peer = await database.guild.create({ data: { discordId: "release-test-community-peer", name: "Peer community" } });
  await assert.rejects(service.enterLottery(peer.id, paid.id, "player-a", 1, now));
  await assert.rejects(service.board(peer.id, season.id));
  await assert.rejects(service.endSeason(peer.id, season.id));
  const peerSeason = await service.startSeason(peer.id, { name: "Peer season", game: "DISCORD", channelId: "peer-channel", audienceRoleId: null, actorId: "peer-officer" });
  const peerDraw = await service.create(peer.id, peerSeason.id, { kind: "LOTTERY", title: "Peer draw", rules: { ...lotteryRules, mode: "FREE", cost: 0, maxTickets: 1 }, endsAt, actorId: "peer-officer" }, now);
  await service.enterLottery(peer.id, peerDraw.id, "peer-player", 1, now);

  // Force outbox failure inside a real transaction: points and tickets both roll back.
  const rollbackDraw = await service.create(guildId, season.id, { kind: "LOTTERY", title: "Queue rollback test", rules: { ...lotteryRules, cost: 1 }, endsAt, actorId: "officer" }, now);
  const broken = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => database.$transaction(async tx => {
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property === "discordJob") return { upsert: async () => { throw new Error("Forced outbox failure"); } };
          return Reflect.get(target, property);
        },
      });
      return work(wrapped);
    }),
  } as unknown as PrismaClient;
  await assert.rejects(createCommunityService(broken).enterLottery(guildId, rollbackDraw.id, "player-a", 1, now), /Forced outbox failure/);
  assert.equal(await database.communityEntry.count({ where: { activityId: rollbackDraw.id } }), 0);
  assert.equal(await database.communityPoint.count({ where: { reference: `lottery:${rollbackDraw.id}:player-a` } }), 0);
  await service.close(guildId, rollbackDraw.id, true, now);
  const final = await service.endSeason(guildId, season.id);
  assert.ok(Array.isArray(final.finalStandings));
  await assert.rejects(service.dice(guildId, season.id, "player-a", "2030-01-02", now));
  await database.guild.delete({ where: { id: peer.id } });
  assert.equal(await database.communitySeason.count({ where: { guildId: peer.id } }), 0);
  assert.equal(await database.communityEntry.count({ where: { activityId: peerDraw.id } }), 0);
  assert.equal(await database.communitySeason.count({ where: { id: season.id } }), 1);
}
