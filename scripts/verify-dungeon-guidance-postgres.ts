// Existing disposable schema only; no migrations, Discord clients or live services.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../src/database.js";
import type { Prisma } from "@prisma/client";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { addonDungeonBoard } from "../src/services/dungeon-stats.js";
import { dungeonRating } from "../src/services/dungeon-rating.js";
const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local test database required.");
const db = createPrismaClient(url.toString());
const discordId = `guidance-test-${randomUUID()}`;
try {
  const guild = await db.guild.create({ data: { discordId, name: "Guidance test" } });
  const member = await db.member.create({ data: { guildId: guild.id, discordUserId: "fixture", displayName: "Tester" } });
  const rules = provisionalSeasonRules().rules;
  const season = await db.dungeonSeason.create({ data: { guildId: guild.id, name: "Guidance test", status: "ACTIVE", startsAt: new Date("2026-10-01T00:00:00Z"), ratingRules: rules as unknown as Prisma.InputJsonValue } });
  for (const [i, seconds, role] of [[0, 2400, "TANK"], [1, 2000, "HEALER"], [2, 1800, null]] as const) {
    const endedAt = new Date(Date.parse("2026-10-22T12:00:00Z") + i * 3600000);
    await db.dungeonRun.create({ data: { guildId: guild.id, seasonId: season.id, runRef: `guidance-${i}`, instanceId: 36, dungeonName: "Deadmines",
      difficultyId: 0, protocolVersion: 1, state: "COMPLETED", valid: true, completedBy: "final boss", durationSec: seconds,
      startedAt: new Date(endedAt.getTime() - seconds * 1000), endedAt,
      competitionData: { players: [{ name: "Tester", level: 20, minLevel: 20 }], encounters: [], gameBuild: "fixture", startTrigger: "first combat" },
      players: { create: { character: "Tester", memberId: member.id, role, presentSec: seconds, inGuild: true } } } });
  }
  const board = (await addonDungeonBoard(db, guild.id, new Date("2026-10-23T00:00:00Z")))!;
  const profile = board.profiles[0]!;
  assert.equal(profile.points, 267);
  assert.deepEqual(profile.roles?.map(r => [r.role, r.points]), [["TANK", 200], ["HEALER", 240], ["DAMAGER", 0]]);
  assert.ok(profile.guidance?.routes.find(r => r.key === "36")?.next);
  const frozen = await dungeonRating(db, guild.id, season, null, true);
  await db.dungeonSeason.update({ where: { id: season.id }, data: { status: "ENDED", endsAt: new Date("2026-10-23T00:00:00Z"), finalRating: frozen as unknown as Prisma.InputJsonValue } });
  await db.dungeonRun.updateMany({ where: { guildId: guild.id }, data: { valid: false } });
  const archive = (await addonDungeonBoard(db, guild.id))!;
  assert.equal(archive.profiles[0]?.points, 267);
  assert.deepEqual(archive.profiles[0]?.roles?.map(r => [r.role, r.points]), [["TANK", 200], ["HEALER", 240], ["DAMAGER", 0]]);
  assert.equal(archive.profiles[0]?.guidance, null);
  console.log("Dungeon guidance: real database role filtering, scenario feed and immutable archived role totals passed.");
} finally {
  await db.guild.deleteMany({ where: { discordId } });
  await db.$disconnect();
}
