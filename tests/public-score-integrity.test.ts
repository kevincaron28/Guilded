import { describe, expect, it } from "vitest";
import { createBracketedDungeonRules, type BracketedRules } from "../src/services/dungeon-november-rules.js";
import { calculateDungeonRating, type RatingRun } from "../src/services/dungeon-rating.js";
import { freezeSeasonRules, officialWindows } from "../src/services/official-seasons.js";
import { createLeaderboardPages, leaderRun, prismaLeaderboardStore, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { addedRules, characterScores, publicRules, publicSeasons, rateRun, readRuleSnapshot, rulesAt, snapshotRules, type ScoreRun } from "../src/services/public-score.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

// docs/RAIDER_IO_SCORING_ANALYSIS_2026-10-22.md, item 1: public and guild scoring agree on the same
// evidence, seasons keep the rules they froze, and no personal best is lost to a row limit.

const START = new Date("2026-11-10T19:00:00Z");
interface Member { name: string; level: number; minLevel: number; presentSec?: number }

// One run in both shapes: the guild seasons' (calculateDungeonRating) and the website's (rateRun).
function bothShapes(input: { instanceId?: number; durationSec?: number; completedBy?: string; members: Member[]; encounters?: unknown[] }) {
  const instanceId = input.instanceId ?? 389;
  const durationSec = input.durationSec ?? 1000;
  const endedAt = new Date(START.getTime() + durationSec * 1000);
  const encounters = input.encounters ?? [];
  const guild: RatingRun = { instanceId, difficultyId: 0, durationSec, startedAt: START, endedAt, completedBy: input.completedBy ?? "final boss", dungeonName: "Dungeon", runRef: "R1",
    competitionData: { players: input.members.map((m) => ({ name: m.name, level: m.level, minLevel: m.minLevel })), encounters },
    players: input.members.map((m) => ({ character: m.name, memberId: `m-${m.name}`, presentSec: m.presentSec ?? durationSec, member: { displayName: m.name } })) };
  const site: ScoreRun = { runId: "R1", instanceId, routeKey: null, difficultyId: 0, dungeonName: "Dungeon", durationSec, endedAt, confirmations: 1,
    evidence: { startedAt: START, completedBy: input.completedBy ?? "final boss", encounters },
    players: input.members.map((m) => ({ character: m.name, realm: "Doomhowl", className: null, role: null, level: m.level, minLevel: m.minLevel, presentSec: m.presentSec ?? durationSec })) };
  return { guild, site };
}
const guildPoints = (run: RatingRun, rules: BracketedRules) => Object.fromEntries(calculateDungeonRating([run], rules)
  .map((row) => [row.name, row.details?.[0]?.unrankedReason ? null : row.details?.[0]?.points ?? null]));
const sitePoints = (run: ScoreRun, rules: BracketedRules) => Object.fromEntries(run.players.map((p) => [p.character, rateRun(run, rules, p).score?.points ?? null]));

describe("public runs rank like guild seasons on the same evidence", () => {
  const rules = publicRules();
  const kev = { name: "Kev", level: 16, minLevel: 16 };
  const amy = { name: "Amy", level: 17, minLevel: 17 };

  it("gives the same points, penalty included", () => {
    for (const members of [[kev, amy], [kev, { name: "Amy", level: 20, minLevel: 20 }]]) {
      const { guild, site } = bothShapes({ members });
      expect(sitePoints(site, rules)).toEqual(guildPoints(guild, rules));
    }
    expect(sitePoints(bothShapes({ members: [kev, amy] }).site, rules)).toEqual({ Kev: 240, Amy: 240 });
    expect(rateRun(bothShapes({ members: [kev, { name: "Amy", level: 20, minLevel: 20 }] }).site, rules).score).toMatchObject({ points: 192, penaltyPercent: 20 });
  });

  it("leaves manual completions, under-level starts and missing boss evidence unranked", () => {
    const manual = bothShapes({ completedBy: "manual", members: [kev, amy] });
    expect(rateRun(manual.site, rules)).toEqual({ score: null, reason: "Automatic final-boss completion required" });
    expect(guildPoints(manual.guild, rules)).toEqual({ Kev: null, Amy: null });
    // Level 16 at the end, but 14 when the run started: below the 15-18 band.
    const levelled = bothShapes({ members: [kev, { name: "Amy", level: 16, minLevel: 14 }] });
    expect(rateRun(levelled.site, rules).reason).toBe("Below level range");
    expect(guildPoints(levelled.guild, rules)).toEqual({ Kev: null, Amy: null });
    // A Scarlet wing needs its last boss killed inside the run.
    const herod = { id: 3975, name: "Herod", success: true, at: Math.floor(START.getTime() / 1000) + 900 };
    const armory = [{ name: "Kev", level: 35, minLevel: 35 }];
    const ranked = bothShapes({ instanceId: 189, durationSec: 1500, members: armory, encounters: [herod] });
    expect(sitePoints(ranked.site, rules)).toEqual(guildPoints(ranked.guild, rules));
    expect(rateRun(ranked.site, rules).score).toMatchObject({ key: "189:armory", points: 200 });
    const untimed = bothShapes({ instanceId: 189, durationSec: 1500, members: armory, encounters: [{ ...herod, at: undefined }] });
    expect(rateRun(untimed.site, rules).reason).toBe("Dungeon route unknown");
    expect(guildPoints(untimed.guild, rules)).toEqual({ Kev: null });
    expect(rateRun(bothShapes({ instanceId: 2437, members: [kev] }).site, rules).reason).toBe("Route not rated yet");
  });

  it("counts a run only for players present 80% of it, in both", () => {
    const { guild, site } = bothShapes({ members: [kev, { ...amy, presentSec: 500 }] });
    expect(calculateDungeonRating([guild], rules).map((row) => row.name)).toEqual(["Kev"]);
    expect(characterScores([site], rules).map((row) => row.player.character)).toEqual(["Kev"]);
    expect(rateRun(site, rules, site.players[1]).reason).toBe("Presence under 80%");
    // The run itself still ranks (top runs), for the players who earned it.
    expect(rateRun(site, rules).score?.points).toBe(240);
  });

  it("keeps the older check for rows uploaded before evidence was kept", () => {
    const { site } = bothShapes({ completedBy: "manual", members: [kev, { name: "Amy", level: 16, minLevel: 14 }] });
    expect(rateRun({ ...site, evidence: null }, rules).score?.points).toBe(240);
  });
});

describe("official seasons freeze their public rules", () => {
  const rules = publicRules();
  const only15 = createBracketedDungeonRules({ routes: rules.routes.filter((r) => rules.routeBracket[r.dungeonKey] === "15-29"), brackets: rules.brackets.filter((b) => b.key === "15-29"),
    overlevelPenalty: rules.overlevelPenalty, provisional: rules.provisional });
  const retargeted = (from: BracketedRules, seconds: number) => createBracketedDungeonRules({ routes: from.routes.map((r) => r.dungeonKey === "389" ? { ...r, targetSec: seconds } : r),
    brackets: from.brackets, overlevelPenalty: from.overlevelPenalty, provisional: from.provisional });

  it("adds new routes and brackets, never changes a frozen target", () => {
    expect(addedRules(rules, rules)).toBeNull();
    const added = addedRules(only15, retargeted(rules, 900))!;
    expect(added.brackets).toEqual(["30-44"]);
    expect(added.routes).toContain("189:armory");
    expect(added.rules.targets["389"]).toBe(1200);
    expect(added.rules.brackets.map((b) => b.key)).toEqual(["15-29", "30-44"]);
    // A target change alone adds nothing.
    expect(addedRules(rules, retargeted(rules, 900))).toBeNull();
  });

  it("freezes the running season once, then only adds, and never touches what it cannot read", async () => {
    const rows: { id: string; name: string; number: number; startsAt: Date; rules: unknown }[] = [
      { id: "s1", name: "Season 1", number: 1, startsAt: new Date("2026-11-04T23:00:00Z"), rules: null },
      { id: "s2", name: "Season 2", number: 2, startsAt: new Date("2027-02-01T00:00:00Z"), rules: null }
    ];
    const database = { officialSeason: {
      async findFirst({ where }: { where: { startsAt: { lte: Date } } }) { return rows.filter((r) => r.startsAt <= where.startsAt.lte).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null; },
      async update({ where, data }: { where: { id: string }; data: { rules: unknown } }) { rows.find((r) => r.id === where.id)!.rules = JSON.parse(JSON.stringify(data.rules)); }
    } } as never;
    expect(await freezeSeasonRules(database, new Date("2026-11-01T00:00:00Z"), only15)).toBeNull();
    expect(await freezeSeasonRules(database, new Date("2026-11-05T00:00:00Z"), only15)).toMatchObject({ season: "Season 1", frozen: true });
    expect(await freezeSeasonRules(database, new Date("2026-11-05T00:05:00Z"), retargeted(only15, 900))).toBeNull();
    const launch = await freezeSeasonRules(database, new Date("2026-11-20T00:00:00Z"), retargeted(rules, 900));
    expect(launch).toMatchObject({ frozen: false, brackets: ["30-44"] });
    const s1 = readRuleSnapshot(rows[0]!.rules)!;
    expect(s1.frozenAt).toBe("2026-11-05T00:00:00.000Z");
    expect(s1.rules.targets["389"]).toBe(1200);
    expect(s1.additions).toEqual([{ at: "2026-11-20T00:00:00.000Z", routes: launch!.routes, brackets: ["30-44"] }]);
    rows[0]!.rules = { format: 99 };
    expect(await freezeSeasonRules(database, new Date("2026-11-21T00:00:00Z"), rules)).toBeNull();
    expect(rows[0]!.rules).toEqual({ format: 99 });
    // Season 2 freezes on its own; Season 1 keeps what it has.
    expect(await freezeSeasonRules(database, new Date("2027-02-02T00:00:00Z"), rules)).toMatchObject({ season: "Season 2", frozen: true });
    expect(rows[0]!.rules).toEqual({ format: 99 });
  });

  it("scores each season's runs with its own frozen rules", () => {
    const frozen = retargeted(rules, 900);
    const windows = officialWindows([{ number: 1, name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), rules: snapshotRules(frozen, new Date("2026-11-04T23:05:00Z")) }]);
    const periods = publicSeasons(new Date("2026-11-20T00:00:00Z"), windows);
    expect(periods[0]).toMatchObject({ id: "s1", frozenAt: new Date("2026-11-04T23:05:00Z") });
    const run = bothShapes({ durationSec: 900, members: [{ name: "Kev", level: 16, minLevel: 16 }] }).site;
    expect(rateRun(run, rulesAt(periods, run.endedAt)).score?.points).toBe(200);
    // Today's code rules (target 1200) would give more; the beta keeps them.
    expect(rateRun(run, rulesAt(periods, new Date("2026-10-30T00:00:00Z"))).score?.points).toBe(267);
    expect(readRuleSnapshot({ format: 1, frozenAt: "x", additions: [], rules: { version: 6 } })).toBeNull();
  });
});

describe("leaderboard store reads whole histories", () => {
  it("returns every run past 5,000 rows, newest first for a character", async () => {
    const rows = Array.from({ length: 12_003 }, (_, i) => ({ id: `run${String(i).padStart(6, "0")}`, instanceId: 389, routeKey: "389", difficultyId: 0, dungeonName: "Ragefire Chasm",
      durationSec: 1000 + (i % 500), startedAt: new Date(START.getTime() - i * 60_000), endedAt: new Date(START.getTime() - i * 60_000 + 1_000_000), deaths: 0, bracket: "15-29",
      season: "2026-Q4", confirmations: 1, evidenceVersion: i % 2, completedBy: "final boss", encounters: [],
      players: [{ character: "Kev", realm: "Doomhowl", className: null, role: null, level: 16, minLevel: 16, presentSec: 1000 }] }));
    const queries: { take: number; cursor?: { id: string } }[] = [];
    const database = { publicRun: { async findMany(args: { take: number; skip?: number; cursor?: { id: string } }) {
      queries.push(args);
      const from = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
      return rows.slice(from, from + args.take);
    } } } as never;
    const history = await prismaLeaderboardStore(database).characterRuns("Kev", "Doomhowl");
    expect(history).toHaveLength(12_003);
    expect(queries).toHaveLength(3);
    expect(history[0]!.endedAt.getTime()).toBeGreaterThan(history[1]!.endedAt.getTime());
    expect(history.find((r) => r.runId === "run000001")!.evidence).toMatchObject({ completedBy: "final boss" });
    expect(history.find((r) => r.runId === "run000000")!.evidence).toBeNull();
  });

  it("maps a stored row's evidence, or none for rows uploaded before 7.4", () => {
    const row = { id: "x", gameEdition: "forever", instanceId: 389, routeKey: "389", difficultyId: 0, dungeonName: "RFC", durationSec: 1000, startedAt: START, endedAt: new Date(START.getTime() + 1_000_000),
      deaths: null, bracket: "15-29", season: "2026-Q4", confirmations: 1, completedBy: "manual", encounters: null, players: [] };
    expect(leaderRun({ ...row, evidenceVersion: 1 }).evidence).toEqual({ startedAt: START, completedBy: "manual", encounters: [] });
    expect(leaderRun({ ...row, evidenceVersion: 0 }).evidence).toBeNull();
  });
});

describe("leaderboard pages say why a run is unranked", () => {
  it("shows the reason, the older-check label and the frozen rules date", async () => {
    const NOW = new Date("2026-11-20T00:00:00Z");
    const player = { character: "Kev", realm: "Doomhowl", className: "Warrior", role: "TANK", level: 16, minLevel: 16, presentSec: 1000 };
    const base = { instanceId: 389, routeKey: "389", difficultyId: 0, dungeonName: "Ragefire Chasm", durationSec: 1000, endedAt: new Date("2026-11-10T20:00:00Z"), deaths: 0, bracket: "15-29", season: "2026-Q4", confirmations: 1, players: [player] };
    const runs: LeaderRun[] = [
      { ...base, runId: "manual", evidence: { startedAt: START, completedBy: "manual", encounters: [] } },
      { ...base, runId: "old", durationSec: 1100, endedAt: new Date("2026-11-09T20:00:00Z"), evidence: null }
    ];
    const store: LeaderboardStore = { async runs() { return runs; }, async characterRuns() { return runs; }, async guilds() { return []; }, async guildRuns() { return []; }, async guildRoster() { return []; } };
    const frozen = snapshotRules(publicRules(), new Date("2026-11-04T23:05:00Z"));
    const pages = createLeaderboardPages({ store, personal: null, now: () => NOW, calendar: async () => [{ number: 1, name: "Season 1", start: new Date("2026-11-04T23:00:00Z"), end: null, rules: frozen }] });
    const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) }, allows: () => true,
      postApplication: async () => null, routes: [pages.route], now: () => NOW });
    const get = (target: string) => { const url = new URL(target, "https://guilded.kcaron.top"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
    const page = await get("/leaderboards/character/Kev-Doomhowl");
    expect(page.body).toContain('title="Unranked: Automatic final-boss completion required"');
    expect(page.body).toContain("older check");
    // The older row is the only ranked run: 200 x 1200 / 1100.
    expect(page.body).toContain('<span class="score">218</span>');
    const fr = await get("/leaderboards/character/Kev-Doomhowl?lang=fr");
    expect(fr.body).toContain("Non classé : Fin automatique au dernier boss requise");
    const board = await get("/leaderboards/");
    expect(board.body).toContain("This season's rules were frozen on 2026-11-04.");
  });
});
