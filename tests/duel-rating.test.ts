import { emptyNameBook } from "../src/services/character-display.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RATING, RATING_START, ratingSeasonName, ratingSeasonRange, loadPairWeights, expectedScore, isRanked, kFor, levelHandicap, pairWeight, rateSeason, ratingApplies, seasonOf, shrunk, showChange, type RatedDuel } from "../src/services/duel-rating.js";
import { ADDON_SHOWS_RATING, duelRuleLines, ratingFooter, ratingRuleLines } from "../src/services/duel-rules.js";
import { duelLadder, ratingStartOf } from "../src/services/duels.js";
import { duelBoardCard, duelBoardEmbed, loadDuelBoardData } from "../src/services/duel-board.js";
import { duelResultCard, withRatings, type DuelCardInput } from "../src/services/duel-card.js";
import { buildRatingBoard, type PublicDuel } from "../src/services/public-duels.js";
import { createLeaderboardPages, type LeaderboardStore } from "../src/services/public-leaderboard.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

interface Vector { name: string; duels: { winner: string; loser: string; winnerLevel: number | null; loserLevel: number | null; at: string }[];
  expect: { players: Record<string, { rating: number; score: number; rated: number; games: number; wins: number; losses: number; opponents: number; ranked: boolean }>; changes: { winner: string; loser: string; winnerDelta: number; loserDelta: number; rated: boolean }[] } }
const vectors = JSON.parse(readFileSync("tests/fixtures/duel-rating-vectors.json", "utf8")) as { rules: typeof RATING; tolerance: number; cases: Vector[]; seasons: { at: string; id: string; from: string; to: string | null; rated: boolean }[] };
const rated = (v: Vector): RatedDuel[] => v.duels.map((x) => ({ winnerKey: x.winner, loserKey: x.loser, winnerName: x.winner, loserName: x.loser, winnerLevel: x.winnerLevel, loserLevel: x.loserLevel, endedAt: new Date(x.at) }));
// Test-only repeat-duel fractions (the real ones are server configuration, DUEL_PAIR_WEIGHTS).
const TEST_WEIGHTS = [1, 0.5, 0];
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(vectors.tolerance);

describe("duel rating: shared test vectors", () => {
  it("the vector file states the rules the code uses", () => {
    expect(JSON.parse(JSON.stringify(vectors.rules))).toEqual(JSON.parse(JSON.stringify(RATING)));
  });
  for (const v of vectors.cases) {
    it(v.name, () => {
      const result = rateSeason(rated(v), TEST_WEIGHTS);
      for (const [name, want] of Object.entries(v.expect.players)) {
        const got = [...result.players.values()].find((p) => p.name === name)!;
        near(got.rating, want.rating); near(got.score, want.score);
        expect([got.rated, got.games, got.wins, got.losses, got.opponents, got.ranked]).toEqual([want.rated, want.games, want.wins, want.losses, want.opponents, want.ranked]);
      }
      v.expect.changes.forEach((want, i) => { near(result.changes[i]!.winnerDelta, want.winnerDelta); near(result.changes[i]!.loserDelta, want.loserDelta); expect(result.changes[i]!.rated).toBe(want.rated); });
    });
  }
  it("the first season runs from 13 November until the official Season 2 starts, then a duel season is the official season", () => {
    const calendar = [{ number: 2, name: "Season 2", start: new Date("2026-12-09T23:00:00Z") }];
    const at = (iso: string) => seasonOf(new Date(iso), RATING_START, calendar);
    expect(at("2026-11-12T23:59:59Z")).toMatchObject({ id: "s0", rated: false });
    expect(at("2026-11-13T00:00:00Z")).toMatchObject({ id: "2026-11", number: 1, rated: true });
    expect(at("2026-12-09T22:59:59Z")).toMatchObject({ id: "2026-11", number: 1 });
    expect(at("2026-12-09T22:59:59Z").to?.toISOString()).toBe("2026-12-09T23:00:00.000Z");
    // The month change no longer resets anything.
    expect(at("2026-12-31T23:59:59Z")).toMatchObject({ id: "S2", number: 2, to: null });
    expect(at("2027-01-01T00:00:00Z").id).toBe("S2");
    expect(at("2026-12-09T23:00:00Z").from.toISOString()).toBe("2026-12-09T23:00:00.000Z");
    // With no later season scheduled (or the calendar not loaded) the first season simply continues.
    expect(seasonOf(new Date("2027-05-01T00:00:00Z"), RATING_START, [])).toMatchObject({ id: "2026-11", to: null });
    expect(RATING_START.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
  it("names seasons Season N / Saison N, keeps old ids readable and shows the dates as a subtitle", () => {
    const calendar = [{ number: 2, name: "Season 2", start: new Date("2026-12-09T23:00:00Z") }, { number: 3, name: "Season 3", start: new Date("2027-03-02T00:00:00Z") }];
    expect(ratingSeasonName("2026-11", "en")).toBe("Season 1");
    expect(ratingSeasonName("S2", "en")).toBe("Season 2");
    expect(ratingSeasonName("S2", "fr")).toBe("Saison 2");
    expect(ratingSeasonName("2026-12", "en")).toBe("December 2026"); // an old month id that is not the first season stays a month
    expect(ratingSeasonRange("2026-11", "en", calendar)).toBe("November 13 – December 9");
    expect(ratingSeasonRange("S2", "en", calendar)).toBe("December 9 – March 1");
    expect(ratingSeasonRange("S3", "en", calendar)).toBe("From March 2");
    expect(ratingSeasonRange("2026-12", "en", calendar)).toBe("");
  });
  it("ratings restart from 1000 at the official season change and the old season keeps its own ladder", () => {
    const calendar = [{ number: 2, name: "Season 2", start: new Date("2026-12-09T23:00:00Z") }];
    const day = (iso: string) => ({ winnerKey: "a", loserKey: "b", winnerName: "Aldric", loserName: "Brenna", winnerLevel: 60, loserLevel: 60, endedAt: new Date(iso) });
    const duels = [day("2026-12-05T10:00:00Z"), day("2026-12-10T10:00:00Z")];
    const idOf = (d: { endedAt: Date }) => seasonOf(d.endedAt, RATING_START, calendar).id;
    expect(duels.map(idOf)).toEqual(["2026-11", "S2"]);
    const seasonTwo = rateSeason(duels.filter(d => idOf(d) === "S2")).players.get("a")!;
    const seasonOne = rateSeason(duels.filter(d => idOf(d) === "2026-11")).players.get("a")!;
    expect(seasonTwo.games).toBe(1);
    expect(seasonTwo.rating).toBeCloseTo(seasonOne.rating, 6); // both started from 1000 with one win
  });
});

describe("duel rating: the formulas, by hand", () => {
  it("a first duel between equals moves the winner by K 40 x 0.5 = 20, shown as 20 x 1/11", () => {
    const r = rateSeason([{ winnerKey: "a", loserKey: "b", winnerName: "A", loserName: "B", winnerLevel: 60, loserLevel: 60, endedAt: new Date("2026-12-02T00:00:00Z") }]);
    expect(r.players.get("a")!.rating).toBeCloseTo(1020, 6);
    expect(r.players.get("b")!.rating).toBeCloseTo(980, 6);
    expect(r.changes[0]!.winnerDelta).toBeCloseTo(20 / 11, 6);
    expect(showChange(r.changes[0]!.winnerDelta)).toBe("+2");
  });
  it("K by games, handicap, pair weight, shrink and the ranked rule", () => {
    expect([kFor(0), kFor(9), kFor(10), kFor(29), kFor(30), kFor(500)]).toEqual([40, 40, 24, 24, 16, 16]);
    expect([levelHandicap(50, 55), levelHandicap(55, 50), levelHandicap(50, 99), levelHandicap(null, 50)]).toEqual([100, -100, 100, 0]);
    expect([pairWeight(0, TEST_WEIGHTS), pairWeight(1, TEST_WEIGHTS), pairWeight(2, TEST_WEIGHTS), pairWeight(9, TEST_WEIGHTS)]).toEqual([1, 0.5, 0, 0]);
    expect([pairWeight(0, null), pairWeight(40, null)]).toEqual([1, 1]);
    expect(loadPairWeights({ DUEL_PAIR_WEIGHTS: "[1,0.5]" })).toEqual([1, 0.5]);
    expect([loadPairWeights({}), loadPairWeights({ DUEL_PAIR_WEIGHTS: "oops" }), loadPairWeights({ DUEL_PAIR_WEIGHTS: "[2]" })]).toEqual([null, null, null]);
    expect(expectedScore(1000, 1000, 0)).toBe(0.5);
    expect(shrunk(1100, 10)).toBe(1050);
    expect([isRanked(8, 4), isRanked(7, 4), isRanked(8, 3)]).toEqual([true, true, true]);
  });
});

describe("duel rating: late reports and the season boundary", () => {
  const base = (name: string, at: string, w: string, l: string): RatedDuel => ({ winnerKey: w, loserKey: l, winnerName: w, loserName: l, winnerLevel: 60, loserLevel: 60, endedAt: new Date(at) });
  const history = [base("1", "2026-12-03T10:00:00Z", "Aldric", "Brenna"), base("2", "2026-12-05T10:00:00Z", "Brenna", "Aldric")];
  const late = base("3", "2026-12-04T10:00:00Z", "Aldric", "Brenna");
  it("a duel reported late is placed in date order, so the result is the same whenever it arrived", () => {
    const inOrder = rateSeason([history[0]!, late, history[1]!]);
    const arrivedLast = rateSeason([...history, late]);
    expect(arrivedLast.players.get("Aldric")!.rating).toBeCloseTo(inOrder.players.get("Aldric")!.rating, 9);
  });
  it("and it changes ratings that were already shown", () => {
    const before = rateSeason(history).players.get("Aldric")!.score;
    const after = rateSeason([...history, late]).players.get("Aldric")!.score;
    expect(after).not.toBeCloseTo(before, 3);
  });
  it("a duel before the start is archived (no season) and one at the start is in the first season", () => {
    expect(seasonOf(new Date("2026-11-12T23:59:59Z")).rated).toBe(false);
    expect(seasonOf(new Date("2026-11-13T00:00:00Z")).id).toBe("2026-11");
    expect(ratingApplies(new Date("2026-11-12T23:59:59Z"))).toBe(false);
    expect(ratingApplies(new Date("2026-11-13T00:00:00Z"))).toBe(true);
    // A server's own marker moves the start; its first season is still the one before the official Season 2.
    expect(seasonOf(new Date("2026-12-15T00:00:00Z"), T0).id).toBe("2026-12");
  });
});

const T0 = new Date("2026-12-01T00:00:00Z");
const row = (winner: string, loser: string, at: string, wl = 60, ll = 60) => ({ winnerId: `m-${winner}`, loserId: `m-${loser}`, winnerCharacter: winner, loserCharacter: loser, winnerLevel: wl, loserLevel: ll, endedAt: new Date(at), reportKey: `${winner}-${loser}-${at}` });
const dbWith = (rows: ReturnType<typeof row>[], startsAt: Date | null = T0) => ({
  duelResult: { findMany: async (args: { where: { endedAt?: { gte?: Date; lt?: Date } } }) => rows.filter((r) => (!args.where.endedAt?.gte || r.endedAt >= args.where.endedAt.gte) && (!args.where.endedAt?.lt || r.endedAt < args.where.endedAt.lt)) },
  guildSettings: { findUnique: async () => ({ duelRatingStartsAt: startsAt }) }
}) as never;
const OLD = [row("Aldric", "Brenna", "2026-11-20T10:00:00Z", 60, 58), row("Aldric", "Corvin", "2026-11-21T10:00:00Z")];

describe("duel rating: inert until the start date", () => {
  it("before the start the ladder is the old points, to the point", async () => {
    const ladder = await duelLadder(dbWith(OLD), "g1", "forever", { now: new Date("2026-11-30T12:00:00Z") });
    expect(ladder.mode).toBe("points");
    expect(ladder.standings[0]).toMatchObject({ name: "Aldric", score: 16 });
  });
  it("the old board card and embed say nothing about ratings", async () => {
    const data = await loadDuelBoardData(dbWith(OLD), "g1", "forever", new Date("2026-11-30T12:00:00Z"));
    expect(data.mode).toBe("points");
    expect(duelBoardCard(data, "en").footer).toContain("10 per win");
    expect(JSON.stringify(duelBoardEmbed(data, "en").toJSON())).not.toMatch(/Rating|rating/);
  });
  it("a server can move the start with its own marker", async () => {
    expect((await ratingStartOf(dbWith([], new Date("2026-11-01T00:00:00Z")), "g1")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(await ratingStartOf(dbWith([], null), "g1")).toEqual(RATING_START);
    const ladder = await duelLadder(dbWith(OLD, new Date("2026-11-01T00:00:00Z")), "g1", "forever", { now: new Date("2026-11-30T12:00:00Z") });
    expect(ladder.mode).toBe("rating");
    expect(ladder.season!.id).toBe("2026-11");
  });
});

describe("duel rating: from the start date", () => {
  const NEW = [row("Aldric", "Brenna", "2026-12-02T10:00:00Z"), row("Aldric", "Corvin", "2026-12-03T10:00:00Z"), row("Brenna", "Corvin", "2026-12-04T10:00:00Z")];
  const now = new Date("2026-12-10T12:00:00Z");
  it("duels before the start do not count in the first rated season and everyone starts at 1000", async () => {
    const ladder = await duelLadder(dbWith([...OLD, ...NEW]), "g1", "forever", { now });
    expect(ladder.mode).toBe("rating");
    expect(ladder.duels).toBe(3);
    expect(ladder.standings.every((s) => s.ranked && !s.placement && s.rank)).toBe(true);
    const aldric = ladder.standings.find((s) => s.name === "Aldric")!;
    expect(aldric.score).toBeGreaterThan(1000);
    expect(aldric.rank).toBe(1);
  });
  it("the board says which rules apply, since when, and that the game shows the old score", async () => {
    expect(ADDON_SHOWS_RATING).toBe(false);
    const data = await loadDuelBoardData(dbWith(NEW), "g1", "forever", now);
    const card = duelBoardCard(data, "en");
    expect(card.footer).toContain("Rating starts at 1000");
    expect(card.footer).toContain("the in-game ladder shows the old score until the next addon update");
    expect(card.ladder!.columns[0]!.label).toBe("Rating");
    expect(card.subtitle).toContain("December 2026");
    const fr = duelBoardCard(data, "fr");
    expect(fr.ladder!.columns[0]!.label).toBe("Cote");
    expect(fr.footer).toContain("le classement dans le jeu affiche l'ancien score");
    expect(JSON.stringify(duelBoardEmbed(data, "fr").toJSON())).toContain("1006");
  });
  it("the per-duel card shows the change for both players and the placement", () => {
    const fresh = [{ reportKey: "k", winnerId: "m-Aldric", loserId: "m-Brenna", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 60, loserLevel: 60, reason: "knockout", endedAt: new Date("2026-12-02T10:00:00Z") }];
    const history = NEW.slice(0, 1).map((r) => ({ ...r, reportKey: "k" }));
    const card = withRatings(fresh.map((d) => ({ ...d, points: 0, winnerScore: 0, winnerStreak: 1, winnerBest: 1 })), history, T0)[0]!;
    expect(card.rating).toBeDefined();
    const built = duelResultCard(card, "en", new Map(), emptyNameBook);
    expect(built.rows![0]!.right).toBe("+2 → 1002");
    expect(built.rows![1]!.right).toBe("-2 → 998");
    expect(built.footer).not.toMatch(/Score: 10|points/);
    expect(duelResultCard(card, "fr", new Map(), emptyNameBook).stats[0]!.label).toBe("Cote");
  });
  it("a duel before the start keeps the points card", () => {
    const fresh: DuelCardInput = { reportKey: "k", winnerId: "a", loserId: "b", winnerCharacter: "A", loserCharacter: "B", winnerLevel: 60, loserLevel: 60, reason: "knockout", endedAt: new Date("2026-11-20T10:00:00Z"), points: 10, winnerScore: 10, winnerStreak: 1, winnerBest: 1 };
    const out = withRatings([fresh], [], T0)[0]!;
    expect(out.rating).toBeUndefined();
    expect(duelResultCard(out, "en", new Map(), emptyNameBook).stats[0]!.value).toBe("+10");
  });
});

describe("duel rating: the member-facing text", () => {
  it("is generated from the constants, in both languages, and says the time zone", () => {
    const en = ratingRuleLines("en").join(" "), fr = ratingRuleLines("fr").join(" ");
    for (const text of [en, fr]) {
      expect(text).toContain(String(RATING.start));
            expect(text).toContain("UTC");
      expect(text).not.toMatch(/same pair|même duo|factors|facteurs \d+, /i);
    }
    expect(en).toContain("ranked from their first counted duel");
    expect(en).not.toMatch(/per pair per day|placement/);
    expect(en).toContain("November 13, 2026");
    expect(en).toContain("Season 2");
    expect(en).not.toContain("calendar month");
    expect(en).not.toMatch(/Season 0/);
    expect(fr).toContain("13 novembre 2026");
    expect(fr).not.toMatch(/Saison 0/);
    expect(fr).not.toContain("réinitialisation du mardi");
    expect(duelRuleLines("en").join(" ")).toContain("10 points");
    expect(ratingFooter("en", "December 2026", RATING_START, true)).not.toContain("old score");
  });
});

describe("duel rating: the public page and JSON", () => {
  const people: Record<string, string> = { Aldric: "Warrior", Brenna: "Priest", Corvin: "Mage", Dara: "Rogue", Edda: "Hunter" };
  const duel = (w: string, l: string, at: string, wl = 60, ll = 60): PublicDuel => ({ winnerKey: `m-${w}`, loserKey: `m-${l}`, winner: w, loser: l, winnerLevel: wl, loserLevel: ll, winnerClass: people[w] ?? null, loserClass: people[l] ?? null, winnerShown: true, loserShown: true, endedAt: new Date(at), reason: "knockout" });
  const all: PublicDuel[] = [duel("Aldric", "Brenna", "2026-11-20T10:00:00Z"), duel("Aldric", "Corvin", "2026-12-02T10:00:00Z"), duel("Brenna", "Aldric", "2026-12-03T10:00:00Z"), duel("Dara", "Edda", "2026-12-04T10:00:00Z", 30, 30)];
  const get = (nowIso: string, start?: Date) => {
    const store: LeaderboardStore = { async runs() { return []; }, async characterRuns() { return []; }, async guilds() { return [{ id: "g1", name: "Quebec Gold", publicSlug: "quebec-gold" }]; }, async guildRuns() { return []; }, async guildRoster() { return []; }, async guildStats() { return []; },
      async guildDuelRows() { return all; }, async guildDuelRatingStart() { return start ?? T0; } };
    const pages = createLeaderboardPages({ store, personal: null, now: () => new Date(nowIso) });
    const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => new Date(nowIso), fetch: fetch });
    return (path: string) => { const url = new URL(path, "https://guildedwow.com"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
  };
  it("is unchanged before the start: points, no rating text", async () => {
    const page = (await get("2026-11-25T12:00:00Z")("/leaderboards/guild/quebec-gold/duels")).body;
    expect(page).toContain("Points");
    expect(page).not.toMatch(/Season 0/);
    const json = JSON.parse((await get("2026-11-25T12:00:00Z")("/leaderboards/guild/quebec-gold/duels.json")).body) as { rules: { id: string }; season: string | null };
    expect(json.rules.id).toBe("points-v1");
    expect(json.season).toBeNull();
  });
  it("from the start shows the season's rating, placement, the rating rules and the old-score note, with no Season 0", async () => {
    const fn = get("2026-12-10T12:00:00Z");
    const page = (await fn("/leaderboards/guild/quebec-gold/duels")).body;
    expect(page).toContain("December 2026");
    expect(page).toContain("Rating");
    expect(page).not.toMatch(/placement|per pair per day/);
    expect(page).toContain("How scoring works");
    expect(page).toContain("The in-game ladder shows the old score until the next addon update");
    expect(page).not.toMatch(/Season 0|value="s0"/);
    expect((await fn("/leaderboards/guild/quebec-gold/duels?when=s0")).body).toContain("December 2026");
    const fr = (await fn("/leaderboards/guild/quebec-gold/duels?lang=fr")).body;
    expect(fr).toContain("Cote");
    expect(fr).toContain("Comment fonctionne le score");
    const json = JSON.parse((await fn("/leaderboards/guild/quebec-gold/duels.json")).body) as { rules: { id: string }; season: string; players: { rating?: number; ranked?: boolean; placement?: unknown }[]; recent: { winnerChange?: number }[] };
    expect(json.rules.id).toBe("rating-v1");
    expect(json.season).toBe("2026-12");
    expect(json.players[0]).toMatchObject({ ranked: true });
    expect(json.recent[0]).toHaveProperty("winnerChange");
  });
  it("starts on 13 November by default, and the single switch (DUEL_RATING=off) is read once at load", () => {
    expect(RATING_START.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
  it("buildRatingBoard ranks everyone and hides players who left", () => {
    const eight = Array.from({ length: 8 }, (_, i) => duel("Aldric", ["Brenna", "Corvin", "Dara", "Edda"][i % 4]!, `2026-12-0${2 + Math.floor(i / 2)}T1${i}:00:00Z`));
    const board = buildRatingBoard([...eight, duel("Ghost", "Brenna", "2026-12-06T10:00:00Z")].map((d) => d.winner === "Ghost" ? { ...d, winnerShown: false } : d), "2026-12", T0, { className: null, levels: null });
    expect(board.rows[0]).toMatchObject({ name: "Aldric", rank: 1 });
    expect(board.rows.some((r) => r.name === "Ghost")).toBe(false);
    expect(board.rows.find((r) => r.name === "Brenna")!.rank).toBeGreaterThan(1);
  });
});
