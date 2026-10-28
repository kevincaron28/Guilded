import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { startSeason, invalidateRun } from "../src/services/dungeon-admin.js";
import { createDungeonRatingRules, dungeonRating, hasDungeonRating, DUNGEON_RATING_RULES } from "../src/services/dungeon-rating.js";
import { publicRules } from "../src/services/public-score.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { records } from "../src/services/dungeon-stats.js";
import { bestEightBetaRules } from "../src/services/dungeon-beta-preset.js";
import { weekStart } from "../src/services/dungeon-rules.js";

export async function verifyDungeonRatingPostgres(db: PrismaClient, guildId: string, memberId: string) {
  const season = await db.dungeonSeason.findFirstOrThrow({ where: { guildId, status: "ACTIVE" } });
  // Exercise legacy archives separately from the new time-rating season below.
  await db.dungeonSeason.update({ where: { id: season.id }, data: { ratingRules: DUNGEON_RATING_RULES } });
  season.ratingRules = DUNGEON_RATING_RULES;
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
  assert.deepEqual(summary.results.map(run => run.playerDetails?.[0]?.ratingGain), [0, 100, 100, 100, 0, 0, 0]);
  assert.deepEqual((await dungeonRating(db, guildId, season)).map(row => [row.character, row.points]), [["RatingMain", 200], ["RatingAlt", 100]]);
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

  await db.guildSettings.update({ where: { guildId }, data: { dungeonConfig: { targets: { "36": 1200 }, levelBands: { "36": { min: 15, max: 25, difficultyId: 1 } } } } });
  const shared = (await startSeason(db, guildId, "Shared rules verification")).season;
  assert.deepEqual(shared.ratingRules, publicRules(), "stored guild overrides cannot change a new season's shared rules");
  // Explicit historical presets keep archive/import coverage without relying on
  // the removed officer-setting path. These fixtures never touch a live database.
  const speed = (await startSeason(db, guildId, "Speed rating verification", shared.id, undefined,
    createDungeonRatingRules({ "36": 1200 }, 3, { "36": { min: 15, max: 25, difficultyId: 1 } }))).season;
  // Changing stored legacy configuration must not change this season's fixed target.
  await db.guildSettings.update({ where: { guildId }, data: { dungeonConfig: { targets: { "36": 600 } } } });
  const speedStart = Math.ceil(speed.startsAt.getTime() / 1000) + 1;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    await importDungeonRuns(tx, guildId, [input("rating-speed", 36, 0, {
      startedAt: speedStart, endedAt: speedStart + 1020,
      players: [{ character: "RatingAlt", realm: "ReleaseTest", inGuild: true, presentSec: 1020, deaths: 5, minLevel: 20, level: 20 }]
    })], characters, "release-test", null, new Date((speedStart + 1021) * 1000));
  });
  const result = (await dungeonRating(db, guildId, speed))[0];
  assert.equal(result?.points, 235);
  assert.equal(result?.details?.[0]?.targetSec, 1200);
  await startSeason(db, guildId, "After speed verification", speed.id);
  const frozen = await db.dungeonSeason.findUniqueOrThrow({ where: { id: speed.id } });
  await invalidateRun(db, guildId, "rating-speed", "after archive", "release-test");
  assert.equal((await dungeonRating(db, guildId, frozen, 36))[0]?.points, 235);

  const band = { min: 15, max: 25, difficultyId: 1 };
  const fair = (await startSeason(db, guildId, "Participation verification", undefined, undefined,
    createDungeonRatingRules({ "189:graveyard": 1800, "189:library": 1800 }, 3,
      { "189:graveyard": band, "189:library": band }))).season;
  // Fixed position within a future weekly window: a rehearsal run near Tuesday
  // 15:00 UTC must not accidentally place the two clears on opposite resets.
  const fairStart = Math.ceil((weekStart(fair.startsAt).getTime()+8*86400000)/1000);
  const fairInput = (id: string, boss: string, offset: number, level = 20) => input(id, 189, 0, {
    startedAt: fairStart + offset, endedAt: fairStart + offset + 1000,
    players: [
      { character: "RatingMain", realm: "ReleaseTest", inGuild: true, presentSec: 1000, deaths: 0, minLevel: level, level },
      { character: "RatingAlt", realm: "ReleaseTest", inGuild: true, presentSec: 700, deaths: 0, minLevel: 20, level: 20 }
    ], encounters: [{ id: 1, name: boss, success: true, at: fairStart + offset + 1000 }]
  });
  const participation = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    return importDungeonRuns(tx, guildId, [fairInput("fair-carry", "Bloodmage Thalnos", 0, 30),
      fairInput("fair-graveyard", "Bloodmage Thalnos", 2000), fairInput("fair-library", "Arcanist Doan", 4000)],
    characters, "release-test", null, new Date((fairStart + 6000) * 1000));
  }, { timeout: 20000 });
  assert.equal(participation.results[0]?.points, 50, "one account gets completion only for a carry");
  assert.equal(participation.results[1]?.previousGuildBest, null, "the carry is not a record baseline");
  assert.equal(participation.results[1]?.points, 48, "second clear rounds the combined 95-point award once");
  assert.equal(participation.results[2]?.points, 120, "a separate wing has a fresh account counter");
  assert.deepEqual((await records(db, guildId, null)).map(row => row.dungeonName),
    ["Scarlet Monastery: graveyard", "Scarlet Monastery: library"]);
  const before = await db.dungeonPointTransaction.count({ where: { seasonId: fair.id } });
  await db.$transaction(tx => importDungeonRuns(tx, guildId, [fairInput("fair-library", "Arcanist Doan", 4000)],
    characters, "release-test", null, new Date((fairStart + 6000) * 1000)));
  assert.equal(await db.dungeonPointTransaction.count({ where: { seasonId: fair.id } }), before, "repeat upload is idempotent");

  const originalLedger = await db.dungeonPointTransaction.findMany({ where: { guildId }, orderBy: { id: "asc" } });
  const bestEight = (await startSeason(db, guildId, "Best eight verification", fair.id, undefined, bestEightBetaRules())).season;
  assert.deepEqual(await db.dungeonPointTransaction.findMany({ where: { guildId }, orderBy: { id: "asc" } }), originalLedger,
    "rotating the beta must not rewrite earned transactions");
  const bestStart = Math.ceil(bestEight.startsAt.getTime() / 1000) + 1;
  const catalog = bestEightBetaRules().catalog;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    await importDungeonRuns(tx, guildId, catalog.map((d, i) => input(`best8-${i}`, d.instanceId, 0, {
      difficultyId: 0, startedAt: bestStart + i * 4000, endedAt: bestStart + i * 4000 + d.targetSec,
      players: [{ character: "RatingMain", realm: "ReleaseTest", inGuild: true, presentSec: d.targetSec, level: 30, minLevel: 30 }],
      encounters: [{ id: i + 1, success: true, name: d.dungeonKey === "189:graveyard" ? "Bloodmage Thalnos"
        : d.dungeonKey === "189:library" ? "Arcanist Doan" : "Boss", startedAt: bestStart + i * 4000 + 1, at: bestStart + i * 4000 + 31 }]
    })), characters, "release-test", null, new Date((bestStart + 50000) * 1000));
  }, { timeout: 30000 });
  const eightRows = await dungeonRating(db, guildId, bestEight);
  assert.equal(eightRows[0]?.points, 1600);
  assert.equal(eightRows[0]?.details?.length, 11);
  assert.equal(eightRows[0]?.details?.filter(d => d.counted).length, 8);
  await startSeason(db, guildId, "After best eight verification", bestEight.id);
  const eightArchive = await db.dungeonSeason.findUniqueOrThrow({ where: { id: bestEight.id } });
  assert.deepEqual(await dungeonRating(db, guildId, eightArchive), eightRows);
  await invalidateRun(db, guildId, "best8-0", "archive must remain frozen", "release-test");
  assert.deepEqual(await dungeonRating(db, guildId, eightArchive), eightRows);
}

export async function verifyDungeonRatingRestored(db: PrismaClient) {
  const season = await db.dungeonSeason.findFirstOrThrow({ where: { name: "Next release season" } });
  assert.ok(hasDungeonRating(season.ratingRules));
  assert.equal(season.status, "ENDED");
  assert.equal((await dungeonRating(db, season.guildId, season))[0]?.points, 100);
  const speed = await db.dungeonSeason.findFirstOrThrow({ where: { name: "Speed rating verification" } });
  assert.equal((await dungeonRating(db, speed.guildId, speed, 36))[0]?.details?.[0]?.targetSec, 1200);
  assert.equal((await dungeonRating(db, speed.guildId, speed))[0]?.points, 235);
  const eight = await db.dungeonSeason.findFirstOrThrow({ where: { name: "Best eight verification" } });
  const restored = await dungeonRating(db, eight.guildId, eight);
  assert.equal(restored[0]?.points, 1600);
  assert.equal(restored[0]?.details?.length, 11);
  assert.equal(restored[0]?.details?.filter(d => d.counted).length, 8);
}
