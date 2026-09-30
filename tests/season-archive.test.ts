import { expect, it, vi } from "vitest";
import { finalRows, seasonArchive, seasonRows } from "../src/services/season-archive.js";

it("uses frozen final standings rather than later ledger totals or renamed members", async () => {
  const rows = [{ memberId: "m", name: "Original name", points: 100 }];
  expect(await seasonRows({} as never, "guild", { id: "past", finalStandings: rows })).toEqual(rows);
  expect(finalRows([{ memberId: "m", name: "Name", points: "100" }])).toBeNull();
});
it("pages archives beyond Discord's 25-option menu and scopes every query to the guild", async () => {
  const find = vi.fn(async () => [{ id: "season-31", name: "Earlier season", status: "ENDED", startsAt: new Date("2026-01-01"), finalStandings: [] }]);
  const db = { dungeonSeason: { count: vi.fn(async () => 41), findMany: find } };
  const page = await seasonArchive(db as never, "guild", 4);
  expect(page.pages).toBe(5);
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild" }, skip: 30, take: 10 }));
  expect(page.text).toContain("season-31");
});
it("shows all tied champions and does not invent finals for older seasons", async () => {
  const db = { dungeonSeason: { count: async () => 2, findMany: async () => [
    { id: "new", name: "New", startsAt: new Date(), finalStandings: [{ memberId: "a", name: "Ann", points: 100 }, { memberId: "b", name: "Bob", points: 100 }, { memberId: "c", name: "Cy", points: 20 }] },
    { id: "old", name: "Old", startsAt: new Date(), finalStandings: null }
  ] }, dungeonAchievement: { findMany: async () => [{ member: { displayName: "Previous winner" } }] } };
  const page = await seasonArchive(db as never, "guild", 1, true);
  expect(page.text).toContain("Ann (100), Bob (100)");
  expect(page.text).not.toContain("Cy (20)");
  expect(page.text).toContain("Previous winner · legacy");
});
