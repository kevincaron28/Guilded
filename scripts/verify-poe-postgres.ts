import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createPoeMappingService } from "../src/services/poe-mapping.js";

// Included in the existing disposable-local migration/concurrency/restore gate.
export async function verifyPoePostgres(database: PrismaClient, guildId: string) {
  const member = await database.member.create({ data: { guildId, discordUserId: "release-poe-member", displayName: "PoE Ann" } });
  const service = createPoeMappingService(database);
  const payload = { guildDiscordId: "release-test-guild", visits: [{ runRef: "c".repeat(64), character: "ReleasePoeAnn", league: "Release PoE league", mode: "STANDARD", areaId: "MapSteppe", areaLevel: 80, startedAt: "2030-01-01T12:00:00Z", endedAt: "2030-01-01T12:05:00Z", endReason: "AREA_CHANGED" }] };
  const now = new Date("2030-01-02T00:00:00Z");
  await assert.rejects(service.ingest(guildId, member.id, payload, now), /disabled/);
  await database.guildSettings.upsert({ where: { guildId }, create: { guildId, poeTrackingEnabled: true }, update: { poeTrackingEnabled: true } });
  const results = await Promise.all([1, 2, 3].map(() => service.ingest(guildId, member.id, payload, now)));
  assert.equal(results.reduce((sum, result) => sum + result.inserted, 0), 1);
  assert.equal(await database.poeMapVisit.count({ where: { guildId, memberId: member.id } }), 1);
  assert.equal((await service.summary(guildId, "Release PoE league", "STANDARD", 7, undefined, now))[0]?.seconds, 300);
  assert.deepEqual(await service.summary(guildId, "Release PoE league", "HARDCORE", 7, undefined, now), []);
  const peer = await database.guild.create({ data: { discordId: "release-test-poe-peer", name: "PoE peer", settings: { create: { poeTrackingEnabled: true } } } });
  await assert.rejects(service.ingest(peer.id, member.id, payload, now), /not active/);
  assert.deepEqual(await service.recent(peer.id, member.id), []);
  const peerMember = await database.member.create({ data: { guildId: peer.id, discordUserId: "release-poe-peer-member", displayName: "Peer" } });
  await service.ingest(peer.id, peerMember.id, payload, now);
  await database.guildSettings.update({ where: { guildId: peer.id }, data: { dataResetAt: now } });
  assert.equal((await service.ingest(peer.id, peerMember.id, payload, now)).excludedByReset, 1);
  await database.guild.delete({ where: { id: peer.id } });
  assert.equal(await database.poeMapVisit.count({ where: { guildId: peer.id } }), 0);
  assert.equal(await database.poeMapVisit.count({ where: { guildId } }), 1);
  // Real PostgreSQL must group portal entries while retaining legacy visits.
  const instanceRef = "d".repeat(64);
  const base = payload.visits[0]!;
  await service.ingest(guildId, member.id, { ...payload, visits: [
    { ...base, runRef: "e".repeat(64), instanceRef },
    { ...base, runRef: "f".repeat(64), instanceRef, league: "release poe LEAGUE" }
  ] }, now);
  const summary = (await service.summary(guildId, "RELEASE POE LEAGUE", "STANDARD", 7, member.id, now))[0]!;
  assert.equal(summary.maps, 2); // one legacy visit + one instance entered twice
  assert.equal(summary.visits, 3);
  assert.equal(summary.seconds, 900);
  assert.equal((await service.recent(guildId, member.id, "release poe league")).length, 3);
  assert.ok((await service.leagueChoices(guildId, "RELEASE POE")).some(choice => choice.value === base.league));
  await assert.rejects(database.poeMapVisit.updateMany({ where: { guildId, memberId: member.id }, data: { instanceRef: "invalid-reference" } }));
}
