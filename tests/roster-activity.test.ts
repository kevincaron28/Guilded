import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { attachRosterActivity, participationCounts } from "../src/services/roster-activity.js";
import { filterRoster, rosterFilters, rosterCsv } from "../src/services/roster-dashboard.js";
import type { RosterSnapshot } from "../src/services/roster-dashboard-store.js";

const now = new Date("2026-10-26T12:00:00Z");
const snapshot: RosterSnapshot = { guild: { id: "g-era", name: "Guild", edition: "classic-era" }, truncated: false,
  characters: ["member-a", "member-a", "member-b", "member-c", null].map((memberId, i) => ({ memberId, key: String(i), name: `Name ${i}`, realm: "Realm", isMain: true,
    className: "Mage", race: null, level: 60, professions: [], refreshedAt: now })) };
it("uses actual participation dates in this guild, excludes future/test/invalid events, and counts alts once", async () => {
  const raid = vi.fn(async () => [{ memberId: "member-a" }]);
  const dungeon = vi.fn(async (arg) => arg.where.run.endedAt.gte.getTime() === now.getTime() - 7 * 86_400_000 ? [] : [{ memberId: "member-b" }]);
  const db = { raidAttendance: { groupBy: raid }, dungeonRunPlayer: { groupBy: dungeon } };
  const result = await attachRosterActivity(db as unknown as PrismaClient, snapshot, now);
  expect(participationCounts(result.characters)).toEqual({ linked: 3, seven: 1, thirty: 2 });
  expect(result.characters[4]?.participation).toBeNull();
  expect(raid).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["PRESENT", "LATE"] }, member: { guildId: "g-era", status: "ACTIVE", isTest: false }, raid: { guildId: "g-era", isTest: false, status: "COMPLETED", startedAt: { gte: new Date("2026-10-19T12:00:00Z"), lte: now }, endedAt: { lte: now } } }) }));
  expect(dungeon).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inGuild: true, run: { guildId: "g-era", state: "COMPLETED", valid: true, endedAt: { gte: new Date("2026-09-26T12:00:00Z"), lte: now } } }) }));
  expect(filterRoster(result.characters, rosterFilters(new URLSearchParams("activity=7"))).map(r => r.key)).toEqual(["0", "1"]);
  expect(filterRoster(result.characters, rosterFilters(new URLSearchParams("activity=30"))).map(r => r.key)).toEqual(["0", "1", "2"]);
  expect(filterRoster(result.characters, rosterFilters(new URLSearchParams("activity=none"))).map(r => r.key)).toEqual(["3"]);
  expect(filterRoster(result.characters, rosterFilters(new URLSearchParams("activity=unknown"))).map(r => r.key)).toEqual(["4"]);
  expect(rosterCsv(result.characters).toString()).toContain("member_participation_7d,member_participation_30d");
});
it("does not treat fresh roster imports as activity and does not query an empty member list", async () => {
  const db = { raidAttendance: { groupBy: vi.fn() }, dungeonRunPlayer: { groupBy: vi.fn() } };
  const result = await attachRosterActivity(db as unknown as PrismaClient, { ...snapshot, characters: [snapshot.characters[4]!] }, now);
  expect(result.characters[0]?.participation).toBeNull();
  expect(db.raidAttendance.groupBy).not.toHaveBeenCalled();
  expect(filterRoster(snapshot.characters, rosterFilters(new URLSearchParams("activity=7")))).toEqual([]);
  expect(() => rosterFilters(new URLSearchParams("activity=inactive"))).toThrow();
});
