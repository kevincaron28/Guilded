import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { startSeason, invalidateRun } from "../src/services/dungeon-admin.js";
import { dungeonRating, hasDungeonRating } from "../src/services/dungeon-rating.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";

export async function verifyDungeonRatingPostgres(db: PrismaClient, guildId: string, memberId: string) {
  const season = await db.dungeonSeason.findFirstOrThrow({ where: { guildId, status: "ACTIVE" } });
  assert.ok(hasDungeonRating(season.ratingRules));
  // Start fixtures just after the season boundary; use an explicit importer clock.
  const start = Math.ceil(season.startsAt.getTime() / 1000) + 1;
  const characters = ["RatingMain", "RatingAlt"].map(name => ({ name, realm: "ReleaseTest", memberId }));
  const input = (id: string, instanceId: number, offset: number, extra = {}) => ({
    id, instanceId, name: "Rating fixture", protocolVersion: 1, state: "COMPLETED", difficultyId: 1,
    startedAt: start + offset, endedAt: start + offset + 1000, completedBy: "final boss", reporters: 1,
    players: [{ character: "RatingMain", realm: "ReleaseTest", inGuild: true, presentSec: 1000, deaths: 0 }], ...extra
  });
  const summary = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    return importDungeonRuns(tx, guildId, [input("rating-first", 36, 0), input("rating-repeat", 36, 2000, {
      difficultyId: 2, players: [{ character: "RatingAlt", realm: "ReleaseTest", inGuild: true, presentSec: 1000, deaths: 0 }]
    }), input("rating-second", 33, 4000), input("rating-manual", 34, 6000, { completedBy: "manual" }),
    input("SIM-rating", 35, 8000), input("rating-late", 37, 10000, {
      players: [{ character: "RatingMain", realm: "ReleaseTest", inGuild: true, presentSec: 799, deaths: 0 }]
    }), input("rating-old", 38, -2000)], characters, "release-test", null, new Date((start + 12000) * 1000));
  }, { timeout: 20000 });
  assert.deepEqual(summary.results.map(run => run.playerDetails?.[0]?.ratingGain), [0, 100, 0, 100, 0, 0, 0]);
  assert.equal((await dungeonRating(db, guildId, season))[0]?.points, 200);
  await invalidateRun(db, guildId, "rating-second", "fixture", "release-test");
  assert.equal((await dungeonRating(db, guildId, season))[0]?.points, 100);
  await startSeason(db, guildId, "After rating verification", season.id);
  await assert.rejects(startSeason(db, guildId, "Should not rotate twice", season.id), /changed/);
  const archived = await db.dungeonSeason.findUniqueOrThrow({ where: { id: season.id } });
  assert.equal((await dungeonRating(db, guildId, archived))[0]?.points, 100);
  await invalidateRun(db, guildId, "rating-first", "after archive", "release-test");
  await invalidateRun(db, guildId, "rating-repeat", "after archive", "release-test");
  assert.equal((await dungeonRating(db, guildId, archived))[0]?.points, 100);
  assert.equal(await db.dungeonAchievement.count({ where: { seasonId: season.id, key: `seasonChampion:${season.id}` } }), 1);
}

export async function verifyDungeonRatingRestored(db: PrismaClient) {
  const season = await db.dungeonSeason.findFirstOrThrow({ where: { name: "Next release season" } });
  assert.ok(hasDungeonRating(season.ratingRules));
  assert.equal(season.status, "ENDED");
  assert.equal((await dungeonRating(db, season.guildId, season))[0]?.points, 100);
}
