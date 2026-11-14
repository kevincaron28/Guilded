import { describe, expect, it } from "vitest";
import { createLeaderboardPages, prismaLeaderboardStore, type LeaderboardStore } from "../src/services/public-leaderboard.js";
import { buildDuelBoard, headToHead, type PublicDuel } from "../src/services/public-duels.js";
import { DUEL_RULES, duelRuleLines } from "../src/services/duel-rules.js";
import { duelPoints, PAIR_DAILY_CAP } from "../src/services/duels.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-13T20:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const duel = (winner: string, loser: string, daysAgo: number, wl: number | null, ll: number | null, over: Partial<PublicDuel> = {}): PublicDuel => ({
  winnerKey: `m-${winner}`, loserKey: `m-${loser}`, winner, loser, winnerLevel: wl, loserLevel: ll,
  winnerClass: classes[winner] ?? null, loserClass: classes[loser] ?? null, winnerShown: true, loserShown: true, endedAt: day(daysAgo), reason: "knockout", ...over
});
const classes: Record<string, string> = { Aldric: "Warrior", Brenna: "Priest", Corvin: "Mage", Dara: "Warrior" };
const rows: PublicDuel[] = [
  duel("Aldric", "Brenna", 20, 60, 60), duel("Aldric", "Corvin", 9, 60, 58), duel("Brenna", "Aldric", 3, 60, 60), duel("Corvin", "Brenna", 2, 58, 60),
  duel("Dara", "Aldric", 1, 30, 60), duel("Aldric", "Dara", 1, 60, 30, { endedAt: new Date(day(1).getTime() + 3600_000) })
];
const none = { since: null, until: null, className: null, levels: null };

describe("the public duel board", () => {
  it("scores with duelPoints, ranks by points then wins, and numbers the rows", () => {
    const board = buildDuelBoard(rows, none);
    expect(board.duels).toBe(6);
    const aldric = board.rows.find((r) => r.name === "Aldric")!;
    expect(aldric).toMatchObject({ wins: 3, losses: 2, games: 5 });
    expect(aldric.points).toBe(duelPoints(60, 60) + duelPoints(60, 58) + duelPoints(60, 30));
    expect(board.rows.map((r) => r.rank)).toEqual(board.rows.map((_, i) => i + 1));
    expect(board.rows[0]!.name).toBe("Dara");
    expect(board.rows[0]!.points).toBe(20);
  });

  it("tracks streak, last duel and level at the last duel", () => {
    const aldric = buildDuelBoard(rows, none).rows.find((r) => r.name === "Aldric")!;
    expect(aldric.streak).toBe(1);
    expect(aldric.bestStreak).toBe(2);
    expect(aldric.lastAt.getTime()).toBe(day(1).getTime() + 3600_000);
    expect(aldric.level).toBe(60);
  });

  it("filters by period, class and level range", () => {
    const week = buildDuelBoard(rows, { ...none, since: day(7) });
    expect(week.duels).toBe(4);
    const warriors = buildDuelBoard(rows, { ...none, className: "warrior" });
    expect(warriors.rows.map((r) => r.name).sort()).toEqual(["Aldric", "Dara"]);
    expect(warriors.rows.map((r) => r.rank)).toEqual([1, 2]);
    const sixty = buildDuelBoard(rows, { ...none, levels: [60, 60] });
    expect(sixty.duels).toBe(2);
    expect(buildDuelBoard(rows, { ...none, levels: [1, 19] }).rows).toEqual([]);
  });

  it("keeps players who left out of the list and out of the recent duels, but their results still count for the others", () => {
    const gone = [duel("Aldric", "Ghost", 2, 60, 60, { loserShown: false }), duel("Aldric", "Brenna", 1, 60, 60)];
    const board = buildDuelBoard(gone, none);
    expect(board.rows.map((r) => r.name)).toEqual(["Aldric", "Brenna"]);
    expect(board.rows[0]!.points).toBe(20);
    expect(board.recent.map((d) => d.loser)).toEqual(["Brenna"]);
  });

  it("answers head to head by name, newest first, and refuses unknown names", () => {
    const h = headToHead(rows, "aldric", "DARA")!;
    expect(h).toMatchObject({ aWins: 1, bWins: 1 });
    expect(h.last[0]!.winner).toBe("Aldric");
    expect(headToHead(rows, "Aldric", "Nobody")).toBeNull();
    expect(headToHead(rows, "Aldric", "Aldric")).toBeNull();
  });

  it("states the rules from the same constants the points use", () => {
    expect(PAIR_DAILY_CAP).toBe(DUEL_RULES.pairDailyCap);
    expect(duelPoints(50, 50)).toBe(DUEL_RULES.basePoints);
    expect(duelPoints(1, 60)).toBe(DUEL_RULES.maxPoints);
    expect(duelRuleLines("en").join(" ")).toContain(`${DUEL_RULES.pairDailyCap} duels per pair`);
    expect(duelRuleLines("fr").join(" ")).toContain(`${DUEL_RULES.pairDailyCap} duels par paire`);
  });
});

function appFor(guilds = [{ id: "g1", name: "Quebec Gold", publicSlug: "quebec-gold" }, { id: "g2", name: "Private Crew", publicSlug: "private-crew" }], extra: Partial<LeaderboardStore> = {}) {
  const store: LeaderboardStore = {
    async runs() { return []; }, async characterRuns() { return []; }, async guilds() { return guilds; }, async guildRuns() { return []; }, async guildRoster() { return []; },
    async guildStats() { return []; },
    async guildDuelRows(id) { return id === "g1" ? rows : []; },
    // These page tests are about the points-era board; the rating has its own tests.
    async guildDuelRatingStart() { return new Date("2100-01-01T00:00:00Z"); },
    ...extra
  };
  const pages = createLeaderboardPages({ store, personal: null, now: () => NOW });
  const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null,
    routes: [pages.route], now: () => NOW, fetch: fetch });
  return (path: string) => { const url = new URL(path, "https://guildedwow.com"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
}

describe("the public duel page", () => {
  it("shows ranking, rules box, recent duels and canonical/hreflang, in English and French", async () => {
    const get = appFor();
    const en = await get("/leaderboards/guild/quebec-gold/duels");
    expect(en.status).toBe(200);
    expect(en.body).toContain("How scoring works");
    expect(en.body).toContain("c-warrior");
    expect(en.body).toContain("Recent duels");
    expect(en.body).toContain('rel="canonical"');
    expect(en.body).toContain('hreflang="fr"');
    expect(en.body).toContain(`${DUEL_RULES.basePoints} points`);
    const fr = await get("/leaderboards/guild/quebec-gold/duels?lang=fr");
    expect(fr.body).toContain("Comment fonctionne le score");
    expect(fr.body).toContain("Duels récents");
  });

  it("filters by class and period and answers head to head", async () => {
    const get = appFor();
    const warriors = (await get("/leaderboards/guild/quebec-gold/duels?class=Warrior")).body;
    expect(warriors).toContain("Dara");
    expect(warriors).not.toContain("class-name c-priest");
    const week = (await get("/leaderboards/guild/quebec-gold/duels?when=week")).body;
    expect(week).not.toContain("2026-10-24");
    const h2h = (await get("/leaderboards/guild/quebec-gold/duels?a=Aldric&b=Dara")).body;
    expect(h2h).toContain("1 – 1");
    expect((await get("/leaderboards/guild/quebec-gold/duels?a=Aldric&b=Nobody")).body).toContain("Both names must be players");
  });

  it("serves the JSON for the app without ids or internal keys", async () => {
    const get = appFor();
    const res = await get("/leaderboards/guild/quebec-gold/duels.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const json = JSON.parse(res.body) as { slug: string; rules: { id: string }; players: { name: string; rank: number }[]; recent: unknown[] };
    expect(json.slug).toBe("quebec-gold");
    expect(json.rules.id).toBe(DUEL_RULES.id);
    expect(json.players[0]).toMatchObject({ rank: 1, name: "Dara" });
    expect(res.body).not.toContain("m-Aldric");
    expect((await get("/leaderboards/guild/nope/duels.json")).status).toBe(404);
  });

  it("404s a guild that is not listed, and redirects the id URL to the slug", async () => {
    const get = appFor();
    expect((await get("/leaderboards/guild/unknown/duels")).status).toBe(404);
    const moved = await get("/leaderboards/guild/g1/duels");
    expect(moved.status).toBe(302);
    expect(moved.headers["location"]).toContain("/leaderboards/guild/quebec-gold/duels");
  });

  it("is linked from the guild page", async () => {
    const get = appFor();
    expect((await get("/leaderboards/guild/quebec-gold")).body).toContain("/leaderboards/guild/quebec-gold/duels");
  });
});

describe("the duel rows store", () => {
  it("asks only for counted duels between visible members and lists only active ones", async () => {
    let where: Record<string, unknown> | undefined;
    const database = {
      duelResult: { async findMany(args: { where: Record<string, unknown> }) {
        where = args.where;
        return [{ winnerId: "m1", loserId: "m2", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 60, loserLevel: 59, endedAt: day(1), reason: "knockout", winner: { status: "ACTIVE" }, loser: { status: "LEFT" } }];
      } },
      character: { async findMany() { return [{ memberId: "m1", name: "Aldric", className: "Warrior" }, { memberId: "m2", name: "Brenna", className: "Priest" }]; } }
    };
    const store = prismaLeaderboardStore(database as never);
    const list = await store.guildDuelRows!("g1");
    expect(where).toMatchObject({ guildId: "g1", counted: true, winner: { isTest: false, raceHidden: false }, loser: { isTest: false, raceHidden: false } });
    expect(list[0]).toMatchObject({ winner: "Aldric", winnerClass: "Warrior", loserClass: "Priest", winnerShown: true, loserShown: false });
  });
});

describe("the duel rows store under the page (hidden members, many duels, concurrent loads)", () => {
  type Row = { winnerId: string; loserId: string; winnerCharacter: string; loserCharacter: string; winnerLevel: number; loserLevel: number; endedAt: Date; reason: string; winner: { status: string; isTest: boolean; raceHidden: boolean }; loser: { status: string; isTest: boolean; raceHidden: boolean } };
  const member = (over: Partial<Row["winner"]> = {}) => ({ status: "ACTIVE", isTest: false, raceHidden: false, ...over });
  const mk = (w: string, l: string, at: Date, wm = member(), lm = member()): Row => ({ winnerId: `m-${w}`, loserId: `m-${l}`, winnerCharacter: w, loserCharacter: l, winnerLevel: 60, loserLevel: 60, endedAt: at, reason: "knockout", winner: wm, loser: lm });
  function fakeDatabase(all: Row[], counter = { loads: 0 }) {
    return {
      duelResult: { async findMany(args: { where: { winner: { isTest: boolean; raceHidden: boolean }; loser: { isTest: boolean; raceHidden: boolean } }; orderBy: { endedAt: "asc" | "desc" }; take: number }) {
        counter.loads++;
        const ok = (m: Row["winner"], f: { isTest: boolean; raceHidden: boolean }) => m.isTest === f.isTest && m.raceHidden === f.raceHidden;
        const kept = all.filter((r) => ok(r.winner, args.where.winner) && ok(r.loser, args.where.loser)).sort((a, b) => (args.orderBy.endedAt === "asc" ? 1 : -1) * (a.endedAt.getTime() - b.endedAt.getTime()));
        return kept.slice(0, args.take);
      } },
      character: { async findMany() { return []; } },
      guildSettings: { async findMany() { return [{ guildId: "g1", publicSlug: "quebec-gold", guild: { name: "Quebec Gold", discordId: "g1", page: null } }]; }, async findUnique() { return { publicSlug: "quebec-gold" }; }, async updateMany() { return { count: 0 }; } }
    };
  }
  const appWith = (database: unknown) => {
    // The real duel rows and guild list under test; the dungeon parts are not part of this case.
    const store: LeaderboardStore = { ...prismaLeaderboardStore(database as never), async guildDuelRatingStart() { return new Date("2100-01-01T00:00:00Z"); }, async runs() { return []; }, async characterRuns() { return []; }, async guildRuns() { return []; }, async guildRoster() { return []; }, async guildStats() { return []; } };
    const pages = createLeaderboardPages({ store, personal: null, now: () => NOW });
    const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => NOW, fetch });
    return (path: string) => { const url = new URL(path, "https://guildedwow.com"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
  };

  it("never shows a hidden or test member's name on the page, the JSON or in a head to head", async () => {
    const all = [mk("Aldric", "Brenna", day(3)), mk("Aldric", "Secret", day(2), member(), member({ raceHidden: true })), mk("Tester", "Aldric", day(1), member({ isTest: true }))];
    const get = appWith(fakeDatabase(all));
    for (const path of ["/leaderboards/guild/quebec-gold/duels", "/leaderboards/guild/quebec-gold/duels.json"]) {
      const body = (await get(path)).body;
      expect(body).not.toContain("Secret");
      expect(body).not.toContain("Tester");
      expect(body).toContain("Brenna");
    }
    const h2h = (await get("/leaderboards/guild/quebec-gold/duels?a=Aldric&b=Secret")).body;
    expect(h2h).toContain("Both names must be players");
    expect(h2h).not.toContain("<strong>Secret");
  });

  it("keeps the newest 20,000 duels, not the oldest", async () => {
    const all = Array.from({ length: 20_001 }, (_, i) => mk("Aldric", "Brenna", new Date(NOW.getTime() - (20_001 - i) * 60_000)));
    const rowsOut = await prismaLeaderboardStore(fakeDatabase(all) as never).guildDuelRows!("g1");
    expect(rowsOut).toHaveLength(20_000);
    expect(rowsOut.at(-1)!.endedAt.getTime()).toBe(NOW.getTime() - 60_000);
    expect(rowsOut[0]!.endedAt.getTime()).toBeLessThan(rowsOut.at(-1)!.endedAt.getTime());
  });

  it("shares one load between concurrent cold requests", async () => {
    const counter = { loads: 0 };
    const get = appWith(fakeDatabase([mk("Aldric", "Brenna", day(1))], counter));
    await Promise.all([get("/leaderboards/guild/quebec-gold/duels"), get("/leaderboards/guild/quebec-gold/duels"), get("/leaderboards/guild/quebec-gold/duels.json")]);
    expect(counter.loads).toBe(1);
  });

  it("sends the JSON under an old id URL to the slug, and a head to head ignores players who left", async () => {
    const get = appWith(fakeDatabase([mk("Aldric", "Gone", day(1), member(), member({ status: "LEFT" }))]));
    const moved = await get("/leaderboards/guild/g1/duels.json");
    expect(moved.status).toBe(302);
    expect(moved.headers["location"]).toContain("/leaderboards/guild/quebec-gold/duels.json");
    expect((await get("/leaderboards/guild/quebec-gold/duels?a=Aldric&b=Gone")).body).toContain("Both names must be players");
  });
});
