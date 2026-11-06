import { describe, expect, it } from "vitest";
import { applyPrelaunchCleanup, describeCleanup, planPrelaunchCleanup, type CleanupInput } from "../src/services/prelaunch-cleanup.js";
import { BETA_PRESET_ID, BETA_SEASON_NAME } from "../src/services/dungeon-beta-preset.js";

// Owner request (6 November 2026): beta characters still showed in the profession directory, the
// race to 60 and the unlinked list. A fake guild with beta and live data.
const before = new Date("2026-10-20T12:00:00Z");
const after = new Date("2026-11-05T12:00:00Z");
const ch = (id: string, name: string, extra: Partial<CleanupInput["characters"][number]> = {}) =>
  ({ id, name, realm: "Forever", gameEdition: "forever", createdAt: before, lastSeenAt: before, ...extra });

function guild(): CleanupInput {
  return {
    characters: [
      ch("beta", "Naomine Beta", { realm: "Classic Beta PvP" }),
      ch("beta-quiet", "Old Tester", { realm: "Classic Beta PvP 2", lastSeenAt: null }), // beta realm, never seen: deleted
      ch("planned", "Planned Raider", { lastSeenAt: null }), // added by hand before launch, never seen: kept
      ch("both", "Halidor Galemorne", { realm: "Classic Beta PvP", lastSeenAt: after }), // played the beta and since launch: kept
      ch("live", "Lebowski Holyroller", { createdAt: after, lastSeenAt: after }),
      ch("relayed", "Donny Kerabatsos", { lastSeenAt: before, relayedAt: after }), // a guildmate's companion saw it after launch
      ch("retail", "Amy", { gameEdition: "retail", realm: "area52", lastSeenAt: before })
    ],
    unclaimed: [
      { id: "u-beta", name: "Walter Beta", realm: "Classic Beta PvP 2", gameEdition: "forever", nameKey: "walter beta", lastSeenAt: before },
      { id: "u-live", name: "Maude Lebowski", realm: "Forever", gameEdition: "forever", nameKey: "maude lebowski", lastSeenAt: after }
    ],
    recipes: [
      { id: "r-beta", character: "Naomine Beta", realm: "Classic Beta PvP", scannedAt: before },
      { id: "r-orphan", character: "Gone Tester", realm: "Forever", scannedAt: before },
      { id: "r-both", character: "Halidor Galemorne", realm: "Classic Beta PvP", scannedAt: before }, // kept character: kept
      { id: "r-live", character: "Lebowski Holyroller", realm: "Forever", scannedAt: after }
    ],
    cooldowns: [{ id: "c-beta", character: "Naomine Beta", realm: "Classic Beta PvP", scannedAt: before }],
    levelRace: [{ id: "l-beta", nameKey: "naomine beta", name: "Naomine Beta" }, { id: "l-live", nameKey: "lebowski holyroller", name: "Lebowski Holyroller" },
      { id: "l-unclaimed", nameKey: "maude lebowski", name: "Maude Lebowski" }, { id: "l-retail", nameKey: "amy-area52", name: "Amy" }],
    raceHall: [{ id: "h-beta", nameKey: "old tester", name: "Old Tester" }],
    seasons: [
      { id: "s-beta", name: BETA_SEASON_NAME, startsAt: new Date("2026-10-13T00:00:00Z"), endsAt: new Date("2026-10-23T04:00:00Z"), status: "ENDED", ratingRules: { presetId: BETA_PRESET_ID }, rulesSnapshot: null },
      { id: "s-old", name: "Pre-launch test", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-10T00:00:00Z"), status: "ENDED", ratingRules: null, rulesSnapshot: null },
      { id: "s-open", name: "Started early", startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: null, status: "ACTIVE", ratingRules: null, rulesSnapshot: null },
      { id: "s1", name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: null, status: "ACTIVE", ratingRules: { presetId: "current-v1" }, rulesSnapshot: null }
    ],
    runs: [
      { id: "run-beta", seasonId: "s-beta", endedAt: new Date("2026-10-20T00:00:00Z"), createdAt: before, dungeonName: "Ragefire Chasm" },
      { id: "run-old", seasonId: null, endedAt: new Date("2026-11-03T00:00:00Z"), createdAt: before, dungeonName: "Deadmines" },
      { id: "run-live", seasonId: "s1", endedAt: after, createdAt: after, dungeonName: "Ragefire Chasm" },
      { id: "run-open", seasonId: "s-open", endedAt: after, createdAt: after, dungeonName: "Wailing Caverns" }
    ]
  };
}

describe("pre-launch cleanup rule", () => {
  it("deletes beta and pre-launch Forever data, keeps everything active since launch, and lists what needs a look", () => {
    const plan = planPrelaunchCleanup(guild());
    expect(plan.characters.map((c) => c.id)).toEqual(["beta", "beta-quiet"]);
    expect(plan.unclaimed.map((u) => u.id)).toEqual(["u-beta"]);
    expect(plan.recipeIds).toEqual(["r-beta", "r-orphan"]);
    expect(plan.cooldownIds).toEqual(["c-beta"]);
    expect(plan.levelRaceIds).toEqual(["l-beta"]); // live, unclaimed-live and Retail entries stay
    expect(plan.raceHallIds).toEqual(["h-beta"]);
    expect(plan.seasons.map((s) => s.id)).toEqual(["s-beta", "s-old"]); // never Season 1
    expect(plan.runIds).toEqual(["run-beta", "run-old"]);
    expect(plan.ambiguous).toEqual([
      "character Planned Raider (Forever): added before launch and never seen in game; kept",
      "character Halidor Galemorne (Classic Beta PvP): beta realm label but active since launch; kept",
      'dungeon season "Started early" started before launch and is still open (ACTIVE); kept'
    ]);
  });

  it("finds nothing the second time", () => {
    const first = planPrelaunchCleanup(guild());
    const gone = (ids: string[]) => <T extends { id: string }>(rows: T[]) => rows.filter((row) => !ids.includes(row.id));
    const input = guild();
    const after2: CleanupInput = {
      characters: gone(first.characters.map((c) => c.id))(input.characters), unclaimed: gone(first.unclaimed.map((u) => u.id))(input.unclaimed),
      recipes: gone(first.recipeIds)(input.recipes), cooldowns: gone(first.cooldownIds)(input.cooldowns), levelRace: gone(first.levelRaceIds)(input.levelRace),
      raceHall: gone(first.raceHallIds)(input.raceHall), seasons: gone(first.seasons.map((s) => s.id))(input.seasons), runs: gone(first.runIds)(input.runs)
    };
    const second = planPrelaunchCleanup(after2);
    expect([second.characters, second.unclaimed, second.recipeIds, second.cooldownIds, second.levelRaceIds, second.raceHallIds, second.seasons, second.runIds].every((list) => list.length === 0)).toBe(true);
  });

  it("the preview names what goes and what stays", () => {
    const text = describeCleanup("Quebec Gold", planPrelaunchCleanup(guild()), { professions: 3, raidSignups: 0 }).join("\n");
    expect(text).toContain("characters: 2 - Naomine Beta (Classic Beta PvP), Old Tester (Classic Beta PvP 2)");
    expect(text).toContain("removed with them: 3 professions");
    expect(text).toContain('dungeon seasons: 2 - "Quebec Gold - Beta finale Oct 22", "Pre-launch test"; dungeon runs: 2');
    expect(text).toContain("KEPT, CHECK: character Halidor Galemorne");
  });
});

describe("applying it", () => {
  it("deletes only the planned rows of this guild, never ledger, and asks the bot to redraw", async () => {
    const calls: { table: string; where: unknown }[] = [];
    const del = (table: string, count = 1) => ({ deleteMany: async ({ where }: { where: unknown }) => { calls.push({ table, where }); return { count }; } });
    const jobs: string[] = [];
    const tx = {
      character: del("character", 2), unclaimedCharacter: del("unclaimed"), recipeKnown: del("recipe", 2), professionCooldown: del("cooldown"),
      levelRaceEntry: del("levelRace"), raceHallEntry: del("raceHall"), dungeonSeason: del("season", 2), dungeonRun: del("run", 2),
      dungeonPointTransaction: del("points", 4), dungeonAchievement: del("achievements"),
      discordJob: { upsert: async ({ create }: { create: { kind: string } }) => { jobs.push(create.kind); return create; } }
    };
    const counts = await applyPrelaunchCleanup(tx as never, "g", planPrelaunchCleanup(guild()));
    expect(counts).toMatchObject({ characters: 2, runs: 2, seasons: 2, dungeonPoints: 4 });
    expect(calls.map((c) => c.table)).not.toContain("epgp");
    // Every delete is scoped to the guild; characters also to Forever.
    expect(calls.find((c) => c.table === "character")!.where).toEqual({ member: { guildId: "g" }, gameEdition: "forever", id: { in: ["beta", "beta-quiet"] } });
    for (const call of calls.filter((c) => c.table !== "character")) expect((call.where as { guildId: string }).guildId).toBe("g");
    expect(jobs).toEqual(["PROFESSIONS", "RACE_BOARD", "DUNGEON_BOARD"]);
  });
});
