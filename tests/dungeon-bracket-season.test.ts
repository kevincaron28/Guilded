import { afterEach, describe, expect, it, vi } from "vitest";
import { BETA_DUNGEONS } from "../src/services/dungeon-beta-preset.js";
import {
  PROVISIONAL_PLAN_ID, provisionalSeasonEmbed, provisionalSeasonRules, recalibrationEvidence,
  routeChoices, startProvisionalSeason
} from "../src/services/dungeon-bracket-season.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { createBracketedDungeonRules, routeTargetAt, validBracketedRules, type BracketedRules } from "../src/services/dungeon-november-rules.js";
import { calculateDungeonRating, dungeonRating, frozenRating, ratingEmbed, seasonDungeonCatalog, type RatingRun } from "../src/services/dungeon-rating.js";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";
import { DUNGEON_RATING_RULES } from "../src/services/dungeon-rating.js";

afterEach(() => { vi.useRealTimers(); });

const { rules } = provisionalSeasonRules();
const recalibrated = (r: BracketedRules, key: string, minutes: number, from: string) => createBracketedDungeonRules({ routes: r.routes,
  brackets: r.brackets, overlevelPenalty: r.overlevelPenalty, provisional: r.provisional,
  recalibrations: [...(r.recalibrations ?? []), { dungeonKey: key, targetSec: minutes * 60, from, runs: 3 }] });

describe("provisional all-level season: preview", () => {
  it("builds valid version 6 rules from the plan using only map IDs and difficulty seen in beta runs", () => {
    expect(validBracketedRules(rules)).toBe(true);
    expect(validBracketedRules(JSON.parse(JSON.stringify(rules)))).toBe(true);
    expect(rules.brackets.map(b => [b.key, b.bestCount])).toEqual([["15-29", 5], ["30-44", 5]]);
    expect(rules.provisional!.plan).toBe(PROVISIONAL_PLAN_ID);
    expect(rules.provisionalTargets).toBe(true);
    const observedMaps = new Set<number>(BETA_DUNGEONS.map(d => d.instanceId));
    for (const route of rules.routes) {
      expect(observedMaps.has(route.instanceId)).toBe(true);
      expect(route.competitionBand!.difficultyId).toBe(0);
      expect(route.verification).toEqual({ build: "provisional", runRef: PROVISIONAL_PLAN_ID });
    }
    // Single maps finish on the addon's final-boss detection; Scarlet wings by their last boss's name.
    expect(rules.routes.find(r => r.dungeonKey === "36")).toMatchObject({ completionModel: "addon-final-boss", completion: { ids: [], names: [] } });
    expect(rules.routes.find(r => r.dungeonKey === "189:armory")).toMatchObject({ completion: { names: ["herod", "hérode"] } });
    expect(rules.routes.find(r => r.dungeonKey === "189:armory")).not.toHaveProperty("completionModel");
    expect(rules.catalog.filter(d => d.bracket === "15-29")).toHaveLength(10);
    expect(rules.catalog.filter(d => d.bracket === "30-44")).toHaveLength(8);
    expect(rules.catalog.every(d => d.provisional === true)).toBe(true);
    // Nothing without an observed map ID is guessed into the season.
    const waiting = new Map(rules.provisional!.waiting.map(w => [w.id, w.reason]));
    expect(waiting.get("drowned-city")).toMatch(/No map ID/);
    expect(waiting.get("kroldok-stronghold")).toMatch(/No map ID/);
    expect(waiting.get("blackrock-depths")).toMatch(/No map ID/);
    expect(waiting.size).toBe(16);
    expect(rules.catalog.find(d => d.dungeonKey === "36")).toMatchObject({ minLevel: 17, maxLevel: 26, targetSec: 2400 });
  });
  it("previews every bracket's routes, levels, targets and best-N, labelled provisional", () => {
    const embed = provisionalSeasonEmbed().toJSON();
    expect(embed.title).toContain("PROVISIONAL");
    expect(embed.description).toContain("provisional");
    expect(embed.description).toContain("Guilded owner's calendar");
    const fields = embed.fields!;
    const low = fields.find(f => f.name.startsWith("Levels 15–29"))!;
    expect(low.name).toBe("Levels 15–29 · best 5 of 10 · provisional");
    expect(low.value).toContain("The Deadmines · 17–26 · 40 min (beta)");
    expect(fields.find(f => f.name.startsWith("Levels 30–44"))!.value).toContain("Scarlet Monastery: Armory · 32–42 · 25 min (estimate)");
    expect(fields.find(f => f.name.startsWith("Levels 45–59"))!.name).toContain("NOT in this season");
    expect(fields.find(f => f.name.startsWith("Levels 60"))!.value).toContain("Blackrock Depths");
    expect(fields.find(f => f.name.startsWith("Waiting"))!.value).toContain("The Drowned City");
    expect(embed.footer!.text).toContain("nothing has started");
    expect(JSON.stringify(embed).length).toBeLessThan(6000);
  });
});

function seasonDb(active: { id: string; name: string } | null) {
  const created: unknown[] = [];
  const tx = { $executeRaw: vi.fn(),
    dungeonSeason: { findFirst: vi.fn(async () => active && { ...active, status: "ACTIVE", startsAt: new Date(0), ratingRules: DUNGEON_RATING_RULES }),
      findMany: async () => active ? [{ ...active, status: "ACTIVE", startsAt: new Date(0), ratingRules: DUNGEON_RATING_RULES }] : [],
      update: vi.fn(), updateMany: vi.fn(), create: vi.fn(async ({ data }: { data: unknown }) => { created.push(data); return { id: "new", ...(data as object) }; }) },
    dungeonRun: { findMany: async () => [] }, dungeonPointTransaction: { groupBy: async () => [], create: vi.fn() },
    member: { count: async () => 0, findMany: async () => [] }, guildSettings: { findUnique: async () => null }, dungeonAchievement: { upsert: vi.fn() } };
  return { tx, created, db: { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never };
}

describe("provisional all-level season: start", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const times = { startsAt: new Date("2026-10-20T00:00:00Z"), endsAt: new Date("2026-11-04T04:00:00Z") };
  it("starts with the explicit window and the provisional rules", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { db, created } = seasonDb(null);
    const result = await startProvisionalSeason(db, "g", { name: "All levels", ...times, rotate: false }, now);
    expect(created).toEqual([expect.objectContaining({ guildId: "g", name: "All levels", ...times, ratingRules: rules })]);
    expect(result.rules.brackets).toHaveLength(2);
  });
  it("refuses while a season is active unless the officer confirms rotation, then archives it", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { db, tx, created } = seasonDb({ id: "old", name: "Beta finale" });
    await expect(startProvisionalSeason(db, "g", { name: "All levels", ...times, rotate: false }, now)).rejects.toThrow(/Beta finale\*\* is active. Nothing changed/);
    expect(created).toEqual([]);
    expect(tx.dungeonSeason.updateMany).not.toHaveBeenCalled();
    const result = await startProvisionalSeason(db, "g", { name: "All levels", ...times, rotate: true }, now);
    expect(result.ended).toEqual(["Beta finale"]);
    expect(tx.dungeonSeason.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "old" }, data: expect.objectContaining({ finalStandings: [] }) }));
    expect(tx.dungeonSeason.updateMany).toHaveBeenCalledWith({ where: { guildId: "g", status: "ACTIVE" }, data: { status: "ENDED", endsAt: expect.any(Date) } });
    expect(created).toHaveLength(1);
  });
  it("refuses a past start, a backwards window and a season that appears in between", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { db, tx, created } = seasonDb(null);
    await expect(startProvisionalSeason(db, "g", { name: "x1", startsAt: new Date("2026-10-18T00:00:00Z"), endsAt: times.endsAt, rotate: true }, now)).rejects.toThrow(/past/);
    await expect(startProvisionalSeason(db, "g", { name: "x1", startsAt: times.endsAt, endsAt: times.startsAt, rotate: true }, now)).rejects.toThrow(/after/);
    // Read as "no season", but one is active by the time the rotation runs: nothing is rotated.
    tx.dungeonSeason.findFirst.mockResolvedValueOnce(null);
    tx.dungeonSeason.findFirst.mockResolvedValueOnce({ id: "raced", name: "Raced", status: "ACTIVE", startsAt: new Date(0), ratingRules: DUNGEON_RATING_RULES } as never);
    await expect(startProvisionalSeason(db, "g", { name: "All levels", ...times, rotate: false }, now)).rejects.toThrow(/changed/);
    expect(created).toEqual([]);
  });
});

describe("provisional labels", () => {
  it("shows provisional on the leaderboard / season card and in /dungeon rules until every route is recalibrated", () => {
    const board = ratingEmbed([], "All levels", "en", rules).toJSON();
    expect(board.title).toContain("provisional");
    expect(board.description).toContain("Provisional targets");
    const one = ratingEmbed([], "All levels", "fr", rules, "15-29").toJSON();
    expect(one.title).toContain("provisoire");
    expect(one.description).toContain("Cibles provisoires");
    const guide = dungeonScoringGuide(dungeonConfig(undefined), "en", rules).toJSON();
    expect(guide.fields!.find(f => f.name === "Provisional targets (*)")!.value).toContain("16 planned dungeon(s) wait for launch data");
    expect(guide.fields!.find(f => f.name === "Routes 15-29")!.value).toContain("The Deadmines · 17–26 · 40 min*");
    expect(JSON.stringify(guide).length).toBeLessThan(6000);
    expect(seasonDungeonCatalog(rules, []).every(d => d.provisional)).toBe(true);

    let all = rules;
    for (const d of rules.catalog) all = recalibrated(all, d.dungeonKey, 30, "2026-10-25T00:00:00.000Z");
    expect(validBracketedRules(all)).toBe(true);
    expect(all.provisionalTargets).toBe(false);
    expect(ratingEmbed([], "All levels", "en", all).toJSON().title).not.toContain("provisional");
    const after = dungeonScoringGuide(dungeonConfig(undefined), "en", all).toJSON();
    expect(after.fields!.some(f => f.name === "Recalibrated targets")).toBe(true);
    expect(after.fields!.find(f => f.name === "Routes 15-29")!.value).not.toContain("*");
  });
  it("lists rated routes for the recalibrate autocomplete, provisional ones marked", async () => {
    const db = { dungeonSeason: { findFirst: async () => ({ ratingRules: rules }) } } as never;
    const choices = await routeChoices(db, "g", "dead");
    expect(choices).toEqual([{ name: "The Deadmines · 17–26 · 40:00 · provisional", value: "36" }]);
  });
});

// In-memory stand-in for the Prisma queries the import and the rating make.
function importDb(season: { id: string; startsAt: Date; endsAt: Date | null; status: string; ratingRules: unknown }) {
  const runs: Record<string, unknown>[] = [];
  const points: { memberId: string; amount: number }[] = [];
  type Where = { instanceId?: number; valid?: boolean; state?: string; completedBy?: string; startedAt?: { gte?: Date; lte?: Date } };
  const tx = {
    guildSettings: { findUnique: async () => null },
    dungeonSeason: { findFirst: async () => season, create: async () => season, update: vi.fn() },
    dungeonRun: {
      findUnique: async ({ where }: { where: { guildId_runRef: { runRef: string } } }) => runs.find(r => r["runRef"] === where.guildId_runRef.runRef) ?? null,
      findMany: async ({ where }: { where: Where }) => runs.filter(r => (where.instanceId === undefined || r["instanceId"] === where.instanceId)
        && (where.valid === undefined || r["valid"] === where.valid) && (where.state === undefined || r["state"] === where.state)
        && (where.completedBy === undefined || r["completedBy"] === where.completedBy)
        && (!where.startedAt?.gte || (r["startedAt"] as Date) >= where.startedAt.gte) && (!where.startedAt?.lte || (r["startedAt"] as Date) <= where.startedAt.lte)),
      create: async ({ data }: { data: Record<string, unknown> & { players: { create: { character: string; memberId: string | null }[] } } }) => {
        const run = { ...data, id: `run-${runs.length + 1}`, players: data.players.create.map(p => ({ ...p,
          member: p.memberId ? { displayName: p.character, guildId: "g1" } : null })) };
        runs.push(run);
        return run;
      }
    },
    dungeonAchievement: { findMany: async () => [], create: async () => ({}) },
    dungeonPointTransaction: { create: async ({ data }: { data: { memberId: string; amount: number } }) => { points.push(data); return data; } }
  };
  return { tx: tx as unknown as Parameters<typeof importDungeonRuns>[0], runs, points };
}

const characters = ["Kev", "Bob", "Amy"].map(name => ({ name, realm: "Forever", memberId: `m-${name.toLowerCase()}` }));
const start = Math.floor(new Date("2026-10-21T00:00:00Z").getTime() / 1000);
function addonRun(id: string, instanceId: number, name: string, offset: number, durationSec: number, levels: number[], extra: Record<string, unknown> = {}) {
  return { id, protocolVersion: 1, state: "COMPLETED", instanceId, name, difficultyId: 0, startedAt: start + offset, endedAt: start + offset + durationSec,
    reporters: 1, completedBy: "final boss", encounters: [],
    players: characters.map((c, i) => ({ character: c.name, realm: "Forever", deaths: 0, presentSec: durationSec, inGuild: true, level: levels[i], minLevel: levels[i] })),
    ...extra };
}

describe("provisional all-level season: import to rating", () => {
  it("rates each character in the bracket of their level, from what the addon records", async () => {
    const season = { id: "all", startsAt: new Date((start - 60) * 1000), endsAt: new Date("2026-11-04T04:00:00Z"), status: "ACTIVE", ratingRules: rules };
    const { tx, runs } = importDb(season);
    const now = new Date("2026-10-22T00:00:00Z");
    const doan = (offset: number) => [{ id: 1, name: "Arcanist Doan", success: true, startedAt: start + offset + 1400, at: start + offset + 1450 }];
    const summary = await importDungeonRuns(tx, "g1", [
      addonRun("dm-first", 36, "The Deadmines", 0, 2400, [20, 20, 20]),                     // 15-29, at target: 200
      addonRun("dm-over", 36, "The Deadmines", 3000, 1200, [27, 20, 20]),             // one level above 17-26: 400 − 10%
      addonRun("gnome", 90, "Gnomeregan", 6000, 2700, [30, 30, 30]),                  // 30-44, at target: 200
      addonRun("library", 189, "Scarlet Monastery", 9000, 1500, [30, 30, 30], { encounters: doan(9000) }), // wing by boss name
      addonRun("manual", 47, "Razorfen Kraul", 12000, 2100, [30, 30, 30], { completedBy: undefined, endReason: "manual" }),
      addonRun("drowned", 4321, "The Drowned City", 15000, 1800, [38, 38, 38])        // no map ID in the plan
    ], characters, "officer", null, now);
    expect({ malformed: summary.malformed, duplicates: summary.duplicates }).toEqual({ malformed: 0, duplicates: 0 });
    const reason = (ref: string) => summary.results.find(r => r.runRef === ref)!.playerDetails![0]!.unrankedReason;
    expect(reason("dm-first")).toBeUndefined();
    expect(reason("library")).toBeUndefined();
    expect(reason("manual")).toBe("Automatic final-boss completion required");
    expect(reason("drowned")).toBe("Dungeon route unknown");
    expect(summary.results.find(r => r.runRef === "dm-first")!.playerDetails![0]).toMatchObject({ ratingTotal: 200, ratingGain: 200 });
    expect(runs).toHaveLength(6);

    const rows = await dungeonRating(tx as never, "g1", season);
    expect(frozenRating(JSON.parse(JSON.stringify(rows)))).not.toBeNull();
    const kev = (bracket: string) => rows.find(r => r.character === "Kev" && r.bracket === bracket);
    // Kev's best Deadmines is the faster run with Kev one level over: 400 − 10%, still in 15-29.
    expect(kev("15-29")).toMatchObject({ points: 360, bestCount: 5 });
    expect(kev("15-29")!.details!.find(d => d.dungeonKey === "36")).toMatchObject({ points: 360, penaltyPercent: 10 });
    // Gnomeregan and the Library wing, both at target, at level 30.
    expect(kev("30-44")).toMatchObject({ points: 400, bestCount: 5 });
    expect(kev("30-44")!.details!.map(d => d.dungeonKey)).toEqual(expect.arrayContaining(["90", "189:library", "4321"]));
    expect(kev("30-44")!.details!.find(d => d.dungeonKey === "4321")).toMatchObject({ points: 0, unrankedReason: "Dungeon route unknown" });
    expect(rows.find(r => r.character === "Bob" && r.bracket === "15-29")!.points).toBe(360);
    expect(rows.some(r => r.bracket === "45-59" || r.bracket === "60")).toBe(false);
  });
});

describe("recalibrating a provisional target", () => {
  const season = { id: "all", name: "All levels", status: "ACTIVE", startsAt: new Date("2026-10-20T00:00:00Z"), endsAt: null };
  const timed = (ref: string, durationSec: number, endedAt: string, level = 20): RatingRun & { runRef: string; completedBy: string } => ({
    runRef: ref, instanceId: 36, difficultyId: 0, durationSec, completedBy: "final boss",
    startedAt: new Date(Date.parse(endedAt) - durationSec * 1000), endedAt: new Date(endedAt),
    competitionData: { players: [{ name: "Kev", level, minLevel: level }], encounters: [] },
    players: [{ character: "Kev", memberId: "m-kev", presentSec: durationSec, member: { displayName: "Kev" } }] });
  function db(ratingRules: unknown, runs: ReturnType<typeof timed>[]) {
    const tx = { $executeRaw: vi.fn(), dungeonSeason: { findFirst: async () => ({ ...season, ratingRules }), update: vi.fn() },
      dungeonRun: { findMany: async () => runs } };
    return { tx, db: { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never };
  }
  it("needs real ranked timed runs, suggests their median, and never changes scores already earned", async () => {
    const early = [timed("a", 1500, "2026-10-21T01:00:00Z"), timed("b", 1800, "2026-10-21T02:00:00Z")];
    const few = db(rules, early);
    expect((await recalibrationEvidence(few.db, "g", "36")).times).toEqual([]); // legacy build/start evidence is unknown
    expect(few.tx.dungeonSeason.update).not.toHaveBeenCalled();

    // An over-level group and a run on another route do not calibrate Deadmines.
    const runs = [...early, timed("c", 1680, "2026-10-21T03:00:00Z"), timed("over", 600, "2026-10-21T04:00:00Z", 28)];
    const diverse = Array.from({ length: 20 }, (_, i) => {
      const run = timed(`diverse-${i}`, 1680, `2026-10-${21 + Math.floor(i / 5)}T12:00:00Z`);
      const crew = Array.from({ length: 5 }, (_, p) => `Crew${i % 5}Player${p}`);
      run.players = crew.map(character => ({ character, memberId: character, presentSec: 1680, member: { displayName: character } }));
      run.competitionData = { gameBuild: "12345", startTrigger: "first combat", players: crew.map(name => ({ name, level: 20, minLevel: 20 })), encounters: [] };
      return run;
    });
    const enough = db(rules, [...runs, ...diverse]);
    const evidence = await recalibrationEvidence(enough.db, "g", "36");
    expect(evidence).toMatchObject({ crews: 5, days: 4, ready: true, median: 1680, suggestedMinutes: 28, currentSec: 2400, provisional: true });
    // A long sample must not be silently clipped and presented as its median.
    const long = db(rules, diverse.map(r => ({ ...r, durationSec: 10800,
      players: r.players.map(p => ({ ...p, presentSec: 10800 })) })));
    expect(await recalibrationEvidence(long.db, "g", "36")).toMatchObject({ ready: false, median: 10800, suggestedMinutes: null });
    expect(long.tx.dungeonSeason.update).not.toHaveBeenCalled();
    const at = new Date("2026-10-25T00:00:00Z");
    // Historical recalibrations remain readable, but there is no write API any more.
    const next = recalibrated(rules, "36", 28, at.toISOString());
    expect(enough.tx.dungeonSeason.update).not.toHaveBeenCalled();
    expect(validBracketedRules(JSON.parse(JSON.stringify(next)))).toBe(true);
    expect(next.targets["36"]).toBe(1680);
    expect(next.catalog.find(d => d.dungeonKey === "36")!.provisional).toBe(false);
    expect(next.provisionalTargets).toBe(true);

    // Earned before the change: the 40-minute target. Ending after it: the 28-minute target.
    expect(routeTargetAt(next, "36", new Date("2026-10-21T01:00:00Z"))).toBe(2400);
    expect(routeTargetAt(next, "36", new Date("2026-10-26T00:00:00Z"))).toBe(1680);
    const before = calculateDungeonRating([runs[0]!], rules)[0]!.points;
    expect(calculateDungeonRating([runs[0]!], next)[0]!.points).toBe(before);
    expect(before).toBe(320);
    const later = timed("d", 1500, "2026-10-26T00:00:00Z");
    expect(calculateDungeonRating([later], next)[0]!.details![0]).toMatchObject({ targetSec: 1680, points: 224 });
    // Best per route still compares frozen points: the earlier 320 stays Kev's best.
    expect(calculateDungeonRating([runs[0]!, later], next)[0]!.points).toBe(320);
  });
  it("leaves normal seasons fixed: a new target waits for the next season", async () => {
    const fixed = createBracketedDungeonRules({ routes: rules.routes, brackets: rules.brackets });
    expect(() => createBracketedDungeonRules({ routes: rules.routes, brackets: rules.brackets,
      recalibrations: [{ dungeonKey: "36", targetSec: 1680, from: "2026-10-22T00:00:00.000Z", runs: 3 }] })).toThrow(/Only a provisional season/);
    await expect(recalibrationEvidence(db(fixed, []).db, "g", "36")).rejects.toThrow(/next season/);
    expect(() => recalibrated(rules, "4321", 30, "2026-10-22T00:00:00.000Z")).toThrow(/not rated/);
    const one = recalibrated(rules, "36", 30, "2026-10-22T00:00:00.000Z");
    expect(() => recalibrated(one, "90", 30, "2026-10-21T00:00:00.000Z")).toThrow(/time order/);
  });
});
