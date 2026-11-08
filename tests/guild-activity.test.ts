import { describe, expect, it, vi } from "vitest";
import { activityCard, activityChannelId, activityEmbed, activityRows, cappedPoints, loadActivity, WEIGHTS, weightsText, type ActivityData } from "../src/services/guild-activity.js";
import { scoreCardPng } from "../src/services/score-card.js";

const now = new Date("2026-11-12T20:00:00Z"); // Thursday; the reset week began Tuesday 10 Nov 15:00 UTC
const at = (iso: string) => new Date(iso);

describe("guild activity points", () => {
  it("caps duel and battleground points per member per reset week", () => {
    const many = Array.from({ length: 30 }, () => ({ memberId: "m1", win: true, at: at("2026-11-11T10:00:00Z") }));
    const lastWeek = [{ memberId: "m1", win: false, at: at("2026-11-09T10:00:00Z") }];
    expect(cappedPoints([...many, ...lastWeek], WEIGHTS.duelWin, WEIGHTS.duelLoss, WEIGHTS.duelWeekCap).get("m1")).toBe(WEIGHTS.duelWeekCap + WEIGHTS.duelLoss);
  });

  it("adds dungeons, duels and battlegrounds, sorted by total", () => {
    const rows = activityRows({
      dungeons: new Map([["m1", 120], ["m2", 50], ["m4", -10]]),
      duels: [{ memberId: "m2", win: true, at: now }, { memberId: "m3", win: false, at: now }],
      battlegrounds: [{ memberId: "m2", win: true, at: now }, { memberId: "m2", win: false, at: now }],
      names: new Map([["m1", "Alda Stone"], ["m2", "Bren Vale"], ["m3", "Cyra"]])
    });
    expect(rows.map(row => [row.name, row.dungeons, row.duels, row.battlegrounds, row.total])).toEqual([
      ["Alda Stone", 120, 0, 0, 120], ["Bren Vale", 50, 5, 35, 90], ["Cyra", 0, 2, 0, 2]]);
  });

  it("states the weights in both languages", () => {
    expect(weightsText("en")).toContain("Battleground: 15 a game, +5 a win (max 300/week)");
    expect(weightsText("fr")).toContain("Duel : 5 gagné, 2 perdu (max 100/sem.)");
  });

  it("posts in the dungeon leaderboard channel, else the duel ladder channel", () => {
    expect(activityChannelId({ dungeonLeaderboardChannelId: "d", duelBoardChannelId: "x" })).toBe("d");
    expect(activityChannelId({ dungeonLeaderboardChannelId: null, duelBoardChannelId: "x" })).toBe("x");
    expect(activityChannelId({})).toBeNull();
  });
});

describe("guild activity card", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ memberId: `m${i}`, name: `Player ${i}`, dungeons: 300 - i * 5, duels: i % 4 * 5, battlegrounds: i % 3 * 15, total: 0 }))
    .map(row => ({ ...row, total: row.dungeons + row.duels + row.battlegrounds }));
  const season: ActivityData = { view: "season", label: "Season 1", since: now, rows };
  const week: ActivityData = { view: "week", label: "This week", since: now, rows: rows.slice(0, 4) };

  it("draws the top 25 with the total in gold and the arrows", async () => {
    const card = activityCard(season, "en", new Map(), now, new Map<string, number | "new">([["m0", 2], ["m1", "new"]]));
    expect(card.ladder!.columns.map(column => column.label)).toEqual(["Dungeons", "Duels", "BGs", "Total", "24h"]);
    expect(card.ladder!.boards[0]!.rows).toHaveLength(25);
    expect(card.ladder!.boards[0]!.rows[0]).toMatchObject({ rank: 1, name: "Player 0", values: ["300", "0", "0", "300", ""], move: 2 });
    expect(card.footer).toBe(weightsText("en"));
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);

  it("leaves the arrows out on the first day and labels a week view", () => {
    const card = activityCard(week, "fr", new Map(), now, null);
    expect(card.ladder!.columns.map(column => column.label)).toEqual(["Donjons", "Duels", "CdB", "Total"]);
    expect(card.subtitle).toBe("Cette semaine · 4 membres actifs");
  });

  it("keeps the week and season podiums in the embed with a plain footer", () => {
    const embed = activityEmbed(week, season, "en", "guild-activity.png").toJSON();
    expect(embed.fields!.map(field => field.name)).toEqual(["This week", "Season 1"]);
    expect(embed.fields![1]!.value.split("\n")).toHaveLength(3);
    expect(embed.footer!.text).toBe(weightsText("en"));
    expect(activityEmbed({ ...week, rows: [] }, { ...season, rows: [] }, "fr").toJSON().fields![0]!.value).toBe("Rien encore.");
  });
});

describe("loading activity", () => {
  function db() {
    return {
      dungeonSeason: { findFirst: vi.fn(async () => ({ id: "s1", name: "Season 1", startsAt: at("2026-11-04T23:00:00Z") })) },
      dungeonPointTransaction: { groupBy: vi.fn(async () => [{ memberId: "m1", _sum: { amount: 100 } }]) },
      duelResult: { findMany: vi.fn(async () => [{ winnerId: "m1", loserId: "m2", endedAt: now, winner: { status: "ACTIVE" }, loser: { status: "LEFT" } }]) },
      battlegroundReport: { findMany: vi.fn(async () => [{ memberId: "m2", outcome: "loss", endedAt: now }]) },
      member: { findMany: vi.fn(async () => [{ id: "m1", displayName: "kev", characters: [{ name: "Alda", displayName: null }] }, { id: "m2", displayName: "bren", characters: [] }]) }
    };
  }

  it("uses the active dungeon season and leaves departed duel partners out", async () => {
    const store = db();
    const data = await loadActivity(store as never, "g1", "forever", "season", "en", now);
    expect(data.label).toBe("Season 1");
    expect(store.dungeonPointTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ seasonId: "s1" }) }));
    expect(data.rows.map(row => [row.name, row.total])).toEqual([["Alda", 105], ["bren", 15]]);
  });

  it("starts the week at the Tuesday reset", async () => {
    const store = db();
    const data = await loadActivity(store as never, "g1", "forever", "week", "fr", now);
    expect(data.since.toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(data.label).toBe("Cette semaine");
    expect(store.dungeonSeason.findFirst).not.toHaveBeenCalled();
  });
});
