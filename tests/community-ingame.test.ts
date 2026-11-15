import { describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import { boardWindow, breakdownOf, cappedPoints, clearInGameCache, defaultScoring, dungeonWeekPoints, inGamePoints, legacyScoring, loadInGamePoints, mergeStandings, scoring, scoringForSeason, seasonInGamePoints, worldPvpPoints } from "../src/services/community-ingame.js";
import { communityBoardCard, communityLeaderboardCard, COMMUNITY_BOARD_MARKER, updateCommunityLeaderboard } from "../src/services/community-leaderboard.js";
import { splitSuffix } from "../src/services/community-ranking-display.js";
import { retiredActivityNotice } from "../src/services/activity-retire.js";

// 14 November 2026: the guild activity ladder is part of the community leaderboard (docs/plans/COMMUNITY_LEADERBOARD_MERGE_2026-11-14.md).
const monday = new Date("2026-11-09T12:00:00Z"); // inside the reset week that began Tue 3 Nov 15:00 UTC
const ev = (memberId: string, win: boolean, at = monday) => ({ memberId, win, at });

describe("in-game points of the community board", () => {
  it("defaults to the 15 November rebalance (dungeons /5 with a 500 weekly bound, PvP /3 with tighter weekly bounds), from server-side config", () => {
    const config = defaultScoring();
    expect([config.dungeons.divisor, config.duels.divisor, config.battlegrounds.divisor, config.worldPvp.divisor]).toEqual([5, 3, 3, 3]);
    expect([config.dungeons.weekCap, config.duels.weekCap, config.battlegrounds.weekCap, config.worldPvp.weekCap]).toEqual([500, 80, 150, 75]);
    expect(scoring()).toEqual(config);
  });

  it("twelve distinct dungeons in one week score exactly 100 community points", () => {
    const runs = Array.from({ length: 12 }, (_, i) => ({ memberId: "m", amount: 75, at: new Date(monday.getTime() + i * 3_600_000) })); // 900 raw
    expect(dungeonWeekPoints(runs).get("m")).toBe(500);
    expect(inGamePoints({ dungeons: runs, duels: [], battlegrounds: [], worldWeeks: [] }).get("m")).toEqual({ dungeons: 100, pvp: 0, total: 100 });
  });

  it("bounds dungeon points per reset week, then sums the weeks", () => {
    const next = new Date(monday.getTime() + 7 * 86_400_000);
    const week = (at: Date) => Array.from({ length: 8 }, () => ({ memberId: "m", amount: 100, at })); // 800 raw a week
    expect(inGamePoints({ dungeons: [...week(monday), ...week(next)], duels: [], battlegrounds: [], worldWeeks: [] }).get("m")!.dungeons).toBe(200);
    // a quiet week is not topped up by a busy one: 300 + 500 (capped from 800) = 800 raw = 160
    const quiet = [{ memberId: "m", amount: 300, at: monday }, ...week(next)];
    expect(inGamePoints({ dungeons: quiet, duels: [], battlegrounds: [], worldWeeks: [] }).get("m")!.dungeons).toBe(160);
  });

  it("lets COMMUNITY_INGAME_SCORING override the new dungeon bound", async () => {
    vi.resetModules();
    process.env["COMMUNITY_INGAME_SCORING"] = JSON.stringify({ dungeons: { weekCap: 250 } });
    try {
      const fresh = await import("../src/services/community-ingame.js");
      expect(fresh.scoring().dungeons).toEqual({ divisor: 5, weekCap: 250 });
      expect(fresh.scoring().duels.weekCap).toBe(80);
    } finally { delete process.env["COMMUNITY_INGAME_SCORING"]; vi.resetModules(); }
  });

  it("bounds a reset week, and the bound renews with the next week", () => {
    const wins = Array.from({ length: 25 }, () => ev("m", true));
    expect(cappedPoints(wins, 5, 2, 100).get("m")).toBe(100);
    const next = new Date(monday.getTime() + 7 * 86_400_000);
    expect(cappedPoints([...wins, ...wins.map(w => ({ ...w, at: next }))], 5, 2, 100).get("m")).toBe(200);
    expect(worldPvpPoints([{ memberId: "m", weekKey: 1, kills: 30, defends: 8, helped: 5 }]).get("m")).toBe(75);
  });

  it("counts later actions of the same day for less (full, then half, then a quarter)", () => {
    const eight = Array.from({ length: 10 }, () => ev("m", true));
    // 4 full + 4 half + 2 quarter at 5 points = 20 + 10 + 2.5
    expect(cappedPoints(eight, 5, 2, 1000, { soft: { full: 4, half: 4 } }).get("m")).toBe(32.5);
    // the next day starts again at full value
    const nextDay = new Date(monday.getTime() + 86_400_000);
    expect(cappedPoints([...eight.slice(0, 4), ...eight.slice(0, 4).map(e => ({ ...e, at: nextDay }))], 5, 2, 1000, { soft: { full: 4, half: 4 } }).get("m")).toBe(40);
  });

  it("counts a rematch within a week for half, a new opponent in full, and a later rematch in full", () => {
    const duel = (opponentId: string, days: number) => ({ memberId: "m", win: true, at: new Date(monday.getTime() + days * 86_400_000), opponentId });
    expect(cappedPoints([duel("x", 0), duel("x", 1)], 5, 2, 1000, { rematchDays: 7 }).get("m")).toBe(7.5);
    expect(cappedPoints([duel("x", 0), duel("y", 1)], 5, 2, 1000, { rematchDays: 7 }).get("m")).toBe(10);
    expect(cappedPoints([duel("x", 0), duel("x", 8)], 5, 2, 1000, { rematchDays: 7 }).get("m")).toBe(10);
  });

  it("scores a raider's month on the divide-by-three scale (dungeons 340 -> 68, PvP 9 + 28 + 25 = 62; the world week is bounded at 75)", () => {
    const all = inGamePoints({
      dungeons: new Map([["m", 340]]), // a plain member total is taken as is
      duels: [...Array.from({ length: 6 }, () => ev("m", true)), ...Array.from({ length: 4 }, () => ev("m", false))],
      battlegrounds: [...Array.from({ length: 4 }, () => ev("m", true)), ...Array.from({ length: 2 }, () => ev("m", false))],
      worldWeeks: [{ memberId: "m", weekKey: 1, kills: 30, defends: 8, helped: 5 }]
    });
    expect(all.get("m")).toEqual({ dungeons: 68, pvp: 62, total: 130 });
    const [row] = mergeStandings([{ userId: "u", points: 180, balance: 40 }], new Map([["u", all.get("m")!]]));
    expect(row).toMatchObject({ points: 310, balance: 40, discord: 180, dungeons: 68, pvp: 62 });
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
      dungeonPointTransaction: { findMany: vi.fn(async () => [{ memberId: "m1", amount: 100, createdAt: new Date("2026-11-09T00:00:00Z"), run: null }, { memberId: "m2", amount: 50, createdAt: new Date("2026-11-09T00:00:00Z"), run: null }]) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => [{ id: "m1", discordUserId: "u" }, { id: "m2", discordUserId: "u" }]) }
    };
    const loaded = await loadInGamePoints(db as never, "g", new Date("2026-11-01T00:00:00Z"), new Date("2026-11-14T00:00:00Z"));
    expect(loaded.get("u")).toEqual({ dungeons: 30, pvp: 0, total: 30 });
    expect(db.dungeonPointTransaction.findMany).toHaveBeenCalledTimes(1);
  });

  it("is isolated per guild: every read is scoped to the guild id and the cache never crosses guilds", async () => {
    clearInGameCache();
    const mk = (amount: number) => ({
      guild: { findUnique: vi.fn(async () => ({ gameEdition: "forever" })) },
      dungeonPointTransaction: { findMany: vi.fn(async (args: unknown) => { void args; return [{ memberId: "m", amount, createdAt: new Date("2026-11-09T00:00:00Z"), run: null }]; }) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async (args: unknown) => { void args; return [{ id: "m", discordUserId: "u" }]; }) }
    });
    const a = mk(300), b = mk(30), season = { createdAt: new Date("2026-11-01T00:00:00Z"), endedAt: null, status: "ACTIVE" }, now = new Date("2026-11-14T00:00:00Z");
    expect((await seasonInGamePoints(a as never, "guildA", season, now)).get("u")!.dungeons).toBe(60);
    expect((await seasonInGamePoints(b as never, "guildB", season, now)).get("u")!.dungeons).toBe(6);
    expect(a.dungeonPointTransaction.findMany.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guildA" } });
    expect(b.dungeonPointTransaction.findMany.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guildB" } });
    expect(a.member.findMany.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guildA" } });
    // a burst of reads for one live window hits the database once
    await seasonInGamePoints(a as never, "guildA", season, now);
    expect(a.dungeonPointTransaction.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("scoring versions: closed seasons keep their old numbers", () => {
  const october = { createdAt: new Date("2026-10-01T04:00:00Z"), endedAt: new Date("2026-11-01T04:00:00Z"), status: "ENDED" };
  const november = { createdAt: new Date("2026-11-01T04:00:00Z"), endedAt: null, status: "ACTIVE" };
  const week = (at: Date, amounts: number[]) => amounts.map(amount => ({ memberId: "m", amount, at }));
  it("picks the legacy set for an ended season that began before 1 November, the current set otherwise", () => {
    expect(scoringForSeason(october)).toEqual(legacyScoring());
    expect(scoringForSeason(november)).toEqual(scoring());
    expect(scoringForSeason({ ...november, status: "ENDED" })).toEqual(scoring());
    expect(scoringForSeason(null)).toEqual(scoring());
    expect(legacyScoring().dungeons).toEqual({ divisor: 3, weekCap: Infinity });
  });
  it("an ended October season totals exactly what origin/main computed; November uses the new values", () => {
    const input = {
      dungeons: [...week(new Date("2026-10-07T12:00:00Z"), [400, 400, 400]), ...week(new Date("2026-10-14T12:00:00Z"), [300])],
      duels: Array.from({ length: 80 }, () => ev("m", true, new Date("2026-10-07T12:00:00Z"))),
      battlegrounds: Array.from({ length: 60 }, (_, i) => ev("m", true, new Date(Date.parse("2026-10-07T12:00:00Z") + Math.floor(i / 20) * 86_400_000))),
      worldWeeks: [{ memberId: "m", weekKey: 1, kills: 40, defends: 10, helped: 10 }]
    };
    // origin/main: dungeons (1500 raw) / 3, duels capped 100 raw /3 per week, battlegrounds capped 300 /3, world capped 125 /3
    const old = inGamePoints(input, scoringForSeason(october)).get("m")!;
    expect(old.dungeons).toBe(500);
    expect(old.pvp).toBe(Math.round(100 / 3) + Math.round(300 / 3) + Math.round(125 / 3));
    const now = inGamePoints(input, scoringForSeason(november)).get("m")!;
    expect(now.dungeons).toBe(Math.round((500 + 300) / 5));
    expect(now.pvp).toBe(Math.round(80 / 3) + Math.round(150 / 3) + Math.round(75 / 3));
  });
  it("a negative admin adjustment in one week never reduces another week (current set)", () => {
    const at1 = new Date("2026-11-09T12:00:00Z"), at2 = new Date("2026-11-16T12:00:00Z");
    const rows = [...week(at1, [-300]), ...week(at2, [250])];
    expect(dungeonWeekPoints(rows, 500).get("m")).toBe(250);
    expect(dungeonWeekPoints(rows, Infinity).get("m")).toBe(-50);
  });
  it("warns when the dungeon read hits its limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rows = Array.from({ length: 200_000 }, () => ({ memberId: "m", amount: 1, createdAt: new Date("2026-11-09T00:00:00Z"), run: null }));
    const db = {
      guild: { findUnique: vi.fn(async () => ({ gameEdition: "forever" })) }, dungeonPointTransaction: { findMany: vi.fn(async () => rows) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => [{ id: "m", discordUserId: "u" }]) }
    };
    await loadInGamePoints(db as never, "guildX", new Date("2026-11-01T00:00:00Z"), new Date("2026-11-14T00:00:00Z"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("guildX"));
    warn.mockRestore();
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
      dungeonPointTransaction: { findMany: vi.fn(async () => [{ memberId: "m", amount: 250, createdAt: new Date("2026-11-09T00:00:00Z"), run: null }]) },
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
    database.dungeonPointTransaction.findMany.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    const options = rest.post.mock.calls[0]![1] as unknown as { body: { embeds: { fields: { value: string }[] }[] } };
    expect(options.body.embeds[0]!.fields[0]!.value).toContain("**50 pts**");
  }, 60_000);
});

describe("season end", () => {
  async function run(failRead: boolean) {
    const order: string[] = [];
    const season: Record<string, unknown> = { id: "s", guildId: "g", game: "DISCORD", status: "ACTIVE", createdAt: new Date("2026-11-01T00:00:00Z") };
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      communitySeason: { findFirst: vi.fn(async () => season), update: vi.fn(async (args: { data: Record<string, unknown> }) => { order.push("update"); return Object.assign(season, args.data); }) },
      communityActivity: { count: vi.fn(async () => 0) }, communityEntry: { count: vi.fn(async () => 0) }, communityKudos: { count: vi.fn(async () => 0) },
      communityPoint: { findMany: vi.fn(async () => [{ userId: "u", amount: 50, kind: "AWARD" }]) }
    };
    const read = { guild: { findUnique: vi.fn(async () => { order.push("read"); if (failRead) throw new Error("down"); return { gameEdition: "forever" }; }) },
      dungeonPointTransaction: { findMany: vi.fn(async () => [{ memberId: "m", amount: 300, createdAt: new Date("2026-11-09T00:00:00Z"), run: null }]) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => [{ id: "m", discordUserId: "u" }]) } };
    const database = { ...tx, ...read, $transaction: <T>(work: (t: typeof tx) => Promise<T>) => { order.push("transaction"); return work(tx); } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { createCommunityService } = await import("../src/services/community.js");
    await createCommunityService(database as never).endSeason("g", "s");
    return { order, season };
  }
  it("archives the merged standings, reading the in-game points before the transaction opens", async () => {
    const { order, season } = await run(false);
    expect(order.indexOf("read")).toBeLessThan(order.indexOf("transaction"));
    expect(season["finalStandings"]).toEqual([{ userId: "u", points: 110, balance: 50, discord: 50, dungeons: 60, pvp: 0 }]);
  });
  it("keeps the Discord points alone when the in-game read fails, and still ends the season", async () => {
    const { season } = await run(true);
    expect(season["status"]).toBe("ENDED");
    expect(season["finalStandings"]).toEqual([{ userId: "u", points: 50, balance: 50 }]);
  });
});

describe("closed seasons are untouched by the scoring", () => {
  it("a closed season's board and archive read its frozen standings, never a rescore", async () => {
    const frozen = [{ userId: "u", points: 133, balance: 50, discord: 50, dungeons: 83, pvp: 0 }];
    const category = { id: "category", name: "Communauté", type: ChannelType.GuildCategory, permission_overwrites: [] };
    const channel = { id: "channel", parent_id: "category", name: "classement", type: ChannelType.GuildText, permission_overwrites: [] };
    const message = { id: "message", author: { id: "bot" }, embeds: [] as unknown[], components: [] as unknown[], attachments: [] as { filename: string }[] };
    const database = {
      guild: { findUnique: vi.fn(async () => ({ id: "record", gameEdition: "forever", settings: { language: "en" } })) },
      communitySeason: { findFirst: vi.fn(async () => ({ id: "s0", name: "Season 0", status: "ENDED", createdAt: new Date("2026-10-01T00:00:00Z"), endedAt: new Date("2026-10-31T00:00:00Z"), finalStandings: frozen })) },
      communityPoint: { findMany: vi.fn(async () => []) },
      dungeonPointTransaction: { findMany: vi.fn(async () => [{ memberId: "m", amount: 5000, createdAt: new Date("2026-10-10T00:00:00Z"), run: null }]) },
      duelResult: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) }, worldPvpWeek: { findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => [{ id: "m", discordUserId: "u", displayName: "Kev" }]) },
      ladderSnapshot: { findFirst: vi.fn(async () => null), upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) }
    };
    const rest = {
      get: vi.fn(async (route: string) => route.includes("/pins") ? { items: [] } : route.includes("/messages") ? [] : [category, channel]),
      patch: vi.fn(async () => message), post: vi.fn(async (route: string, options?: unknown) => { void route; void options; return message; }), put: vi.fn(async () => {}), delete: vi.fn(async () => {})
    };
    await updateCommunityLeaderboard(rest as never, database as never, "guild", "bot");
    const options = rest.post.mock.calls[0]![1] as unknown as { body: { embeds: { fields: { value: string }[] }[] } };
    expect(options.body.embeds[0]!.fields[0]!.value).toContain("**133 pts** · 💬 50 · 🏰 83 · ⚔️ 0");
    expect(database.dungeonPointTransaction.findMany).not.toHaveBeenCalled();
  }, 60_000);
});
