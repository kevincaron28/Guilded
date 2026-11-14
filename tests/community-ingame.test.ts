import { describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import { boardWindow, breakdownOf, cappedPoints, inGamePoints, INGAME_DIVISOR, loadInGamePoints, mergeStandings, WEIGHTS, worldPvpPoints } from "../src/services/community-ingame.js";
import { communityBoardCard, communityLeaderboardCard, COMMUNITY_BOARD_MARKER, updateCommunityLeaderboard } from "../src/services/community-leaderboard.js";
import { splitSuffix } from "../src/services/community-ranking-display.js";
import { retiredActivityNotice } from "../src/services/activity-retire.js";

// 14 November 2026: the guild activity ladder is part of the community leaderboard (docs/plans/COMMUNITY_LEADERBOARD_MERGE_2026-11-14.md).
const monday = new Date("2026-11-09T12:00:00Z"); // inside the reset week that began Tue 3 Nov 15:00 UTC
const ev = (memberId: string, win: boolean, at = monday) => ({ memberId, win, at });

describe("in-game points of the community board", () => {
  it("keeps the old values and caps, then counts one fifth", () => {
    expect(INGAME_DIVISOR).toBe(5);
    // 25 duel wins in one reset week: 125 raw, capped at 100.
    expect(cappedPoints(Array.from({ length: 25 }, () => ev("m", true)), WEIGHTS.duelWin, WEIGHTS.duelLoss, WEIGHTS.duelWeekCap).get("m")).toBe(100);
    // the cap is per reset week: the same 25 wins a week later count again
    const next = new Date(monday.getTime() + 7 * 86_400_000);
    expect(cappedPoints([...Array.from({ length: 25 }, () => ev("m", true)), ...Array.from({ length: 25 }, () => ev("m", true, next))], 5, 2, 100).get("m")).toBe(200);
    expect(worldPvpPoints([{ memberId: "m", weekKey: 1, kills: 30, defends: 8, helped: 5 }]).get("m")).toBe(125);
  });

  it("matches the worked example of the plan (a raider's month = 303 with 180 from Discord)", () => {
    const all = inGamePoints({
      dungeons: new Map([["m", 340]]),
      duels: [...Array.from({ length: 6 }, () => ev("m", true)), ...Array.from({ length: 4 }, () => ev("m", false))],
      battlegrounds: [...Array.from({ length: 4 }, () => ev("m", true)), ...Array.from({ length: 2 }, () => ev("m", false))],
      worldWeeks: [{ memberId: "m", weekKey: 1, kills: 30, defends: 8, helped: 5 }]
    });
    expect(all.get("m")).toEqual({ dungeons: 68, pvp: 55, total: 123 });
    const [row] = mergeStandings([{ userId: "u", points: 180, balance: 40 }], new Map([["u", all.get("m")!]]));
    expect(row).toMatchObject({ points: 303, balance: 40, discord: 180, dungeons: 68, pvp: 55 });
  });

  it("never raises the spendable balance and ranks by the merged total", () => {
    const merged = mergeStandings([{ userId: "a", points: 100, balance: 100 }, { userId: "b", points: 50, balance: 50 }], new Map([["b", { dungeons: 60, pvp: 0, total: 60 }], ["c", { dungeons: 5, pvp: 0, total: 5 }]]));
    expect(merged.map(row => [row.userId, row.points, row.balance])).toEqual([["b", 110, 50], ["a", 100, 100], ["c", 5, 0]]);
  });

  it("reads an older stored row (no split) as all Discord", () => {
    expect(breakdownOf({ userId: "a", points: 70, balance: 0 })).toEqual({ discord: 70, dungeons: 0, pvp: 0 });
    expect(splitSuffix({ userId: "a", points: 70, balance: 0 })).toBe("");
    expect(splitSuffix({ userId: "a", points: 70, balance: 0, discord: 40, dungeons: 20, pvp: 10 })).toBe(" · 💬 40 · 🏰 20 · ⚔️ 10");
  });

  it("windows: the season's own, else the last four weeks", () => {
    const now = new Date("2026-11-14T00:00:00Z");
    expect(boardWindow({ createdAt: new Date("2026-11-01T00:00:00Z"), endedAt: new Date("2026-11-10T00:00:00Z"), status: "ENDED" }, now).until).toEqual(new Date("2026-11-10T00:00:00Z"));
    expect(boardWindow(null, now).since).toEqual(new Date("2026-10-17T00:00:00Z"));
  });

  it("loads per Discord user, summing members that share one account", async () => {
    const db = {
      guild: { findUnique: vi.fn(async () => ({ gameEdition: "forever" })) },
      dungeonPointTransaction: { groupBy: vi.fn(async () => [{ memberId: "m1", _sum: { amount: 100 } }, { memberId: "m2", _sum: { amount: 50 } }]) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => [{ id: "m1", discordUserId: "u" }, { id: "m2", discordUserId: "u" }]) }
    };
    const loaded = await loadInGamePoints(db as never, "g", new Date("2026-11-01T00:00:00Z"), new Date("2026-11-14T00:00:00Z"));
    expect(loaded.get("u")).toEqual({ dungeons: 30, pvp: 0, total: 30 });
  });
});

describe("the community card and podium", () => {
  const board = [
    { userId: "a", points: 303, balance: 40, discord: 180, dungeons: 68, pvp: 55 },
    { userId: "b", points: 120, balance: 0, discord: 120, dungeons: 0, pvp: 0 }
  ];
  it("draws the split columns with the total last, in both languages", () => {
    for (const lang of ["en", "fr"] as const) {
      const card = communityBoardCard({ lang, season: { name: "Season 1", number: 1, status: "ACTIVE" }, board, names: new Map([["a", "Kevin"]]) });
      const ladder = card.ladder!;
      expect(ladder.columns.map(c => c.label).slice(0, 4)).toEqual(["Discord", lang === "fr" ? "Donjons" : "Dungeons", lang === "fr" ? "JcJ" : "PvP", "Total"]);
      expect(ladder.columns.findIndex(c => c.primary)).toBe(3);
      expect(ladder.boards[0]!.rows[0]).toMatchObject({ rank: 1, name: "Kevin" });
      expect(ladder.boards[0]!.rows[0]!.values.slice(0, 4)).toEqual(["180", "68", "55", "303"]);
      expect(JSON.stringify(card)).not.toMatch(/cap|plafond|limit/i); // nothing member-visible about how checks work
    }
  });
  it("shows each row's split under the podium and the painting beside it", () => {
    const body = communityLeaderboardCard({ lang: "en", discordId: "guild", season: { id: "s", name: "Season 1", status: "ACTIVE" }, board, names: new Map([["a", "Kevin"]]), image: "community-board-abc.png" });
    expect(body.embeds[0]!.fields![0]!.value).toContain("**303 pts** · 💬 180 · 🏰 68 · ⚔️ 55");
    expect(body.embeds[0]!.image?.url).toBe("attachment://community-board-abc.png");
    expect(JSON.stringify(body)).not.toMatch(/weekly cap|cap\b/i);
  });
  it("the retirement notice points at the community leaderboard, in French too", () => {
    expect(retiredActivityNotice("en", "123").toJSON().description).toContain("<#123>");
    expect(retiredActivityNotice("fr").toJSON().title).toContain("déménagé");
  });
});

describe("the live board with in-game points", () => {
  function fixture(withMessage: boolean) {
    const category = { id: "category", name: "Communauté", type: ChannelType.GuildCategory, permission_overwrites: [] };
    const channel = { id: "channel", parent_id: "category", name: "classement", type: ChannelType.GuildText, permission_overwrites: [] };
    const message = { id: "message", author: { id: "bot" }, embeds: [{ footer: { text: COMMUNITY_BOARD_MARKER } }] as unknown[], components: [] as unknown[], attachments: [] as { filename: string }[] };
    const database = {
      guild: { findUnique: vi.fn(async () => ({ id: "record", gameEdition: "forever", settings: { language: "en" } })) },
      communitySeason: { findFirst: vi.fn(async () => ({ id: "season", name: "Season 1", status: "ACTIVE", createdAt: new Date("2026-11-01T00:00:00Z"), endedAt: null })) },
      communityPoint: { findMany: vi.fn(async () => [{ userId: "u", amount: 50, kind: "AWARD" }]) },
      dungeonPointTransaction: { groupBy: vi.fn(async () => [{ memberId: "m", _sum: { amount: 250 } }]) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => [{ id: "m", discordUserId: "u", displayName: "Kev" }]) },
      ladderSnapshot: { findFirst: vi.fn(async () => null), upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) }
    };
    const rest = {
      get: vi.fn(async (route: string) => route.includes("/pins") ? { items: withMessage ? [{ message }] : [] } : route.includes("/messages") ? withMessage ? [message] : [] : [category, channel]),
      patch: vi.fn(async (route: string, options?: unknown) => { void route; void options; return message; }), post: vi.fn(async (route: string, options?: unknown) => { void route; void options; return message; }), put: vi.fn(async () => {}), delete: vi.fn(async () => {})
    };
    return { database, rest, message };
  }
  it("posts the painted card with the merged total (50 Discord + 250/5 dungeons = 100)", async () => {
    const { database, rest } = fixture(false);
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    const [, options] = rest.post.mock.calls[0] as unknown as [string, { body: { embeds: { fields: { value: string }[] }[]; attachments: { filename: string }[] }; files: { name: string; data: Buffer }[] }];
    expect(options.body.embeds[0]!.fields[0]!.value).toContain("**100 pts** · 💬 50 · 🏰 50 · ⚔️ 0");
    expect(options.files).toHaveLength(1);
    expect(options.files[0]!.name).toMatch(/^community-board-[0-9a-f]{12}\.png$/);
    expect(options.body.attachments[0]!.filename).toBe(options.files[0]!.name);
    expect(options.files[0]!.data.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);
  it("re-sends the picture only when the standings change", async () => {
    const { database, rest, message } = fixture(true);
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    const first = rest.patch.mock.calls[0] as unknown as [string, { body: { embeds: unknown[]; components: unknown[] }; files?: { name: string }[] }];
    message.attachments = [{ filename: first[1].files![0]!.name }];
    message.embeds = JSON.parse(JSON.stringify(first[1].body.embeds)) as unknown[];
    message.components = JSON.parse(JSON.stringify(first[1].body.components)) as unknown[];
    rest.patch.mockClear();
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    expect(rest.patch).not.toHaveBeenCalled();
  }, 60_000);
  it("falls back to the Discord points when the in-game read fails", async () => {
    const { database, rest } = fixture(false);
    database.dungeonPointTransaction.groupBy.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    const options = rest.post.mock.calls[0]![1] as unknown as { body: { embeds: { fields: { value: string }[] }[] } };
    expect(options.body.embeds[0]!.fields[0]!.value).toContain("**50 pts**");
  }, 60_000);
});
