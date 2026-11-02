import { describe, expect, it, vi } from "vitest";
import { ACHIEVEMENTS, achievementById, wowLevelCap } from "../src/services/achievements-catalogue.js";
import { emptyFacts, evaluateAchievements, syncMemberAchievements, type AchievementFacts } from "../src/services/achievements.js";
import { achievementsCard } from "../src/services/end-cards.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { createPoeMappingService } from "../src/services/poe-mapping.js";

const now = new Date("2026-11-02T12:00:00Z");
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 20));
const facts = (patch: Partial<AchievementFacts>): AchievementFacts => ({ ...emptyFacts(), ...patch });
const earnedIds = (patch: Partial<AchievementFacts>) => evaluateAchievements(facts(patch), now).filter(row => row.earned).map(row => row.def.id);

describe("achievement catalogue", () => {
  it("has unique stable ids, both languages and sensible thresholds", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ACHIEVEMENTS.map(row => row.id)).size).toBe(ACHIEVEMENTS.length);
    for (const row of ACHIEVEMENTS) {
      expect(row.id).toMatch(/^[a-z0-9-]+$/);
      expect(row.threshold).toBeGreaterThan(0);
      for (const lang of [row.en, row.fr]) { expect(lang.name.length).toBeGreaterThan(2); expect(lang.description.length).toBeGreaterThan(10); }
      expect(achievementById(row.id)).toBe(row);
    }
    expect([...new Set(ACHIEVEMENTS.map(row => row.game))].sort()).toEqual(["guild", "poe2", "wow"]);
  });
  it("covers the PoE2 levels 90, 99 and 100 and the WoW level cap", () => {
    expect(ACHIEVEMENTS.filter(row => row.metric === "poeLevel").map(row => row.threshold).sort((a, b) => a - b)).toEqual([75, 90, 99, 100]);
    expect(achievementById("wow-max-level")?.metric).toBe("wowMaxLevel");
    expect(wowLevelCap("classic-tbc")).toBe(70);
    expect(wowLevelCap("retail")).toBe(90);
    expect(wowLevelCap("unknown-edition")).toBe(60);
  });
});

describe("evaluateAchievements", () => {
  it("earns nothing from no data", () => expect(earnedIds({})).toEqual([]));
  it("earns WoW level steps from the highest synced level", () => {
    expect(earnedIds({ highestWowLevel: 45 })).toEqual(["wow-level-20", "wow-level-40"]);
    expect(earnedIds({ highestWowLevel: 60, charactersAtCap: 1 })).toEqual(expect.arrayContaining(["wow-level-60", "wow-max-level"]));
    expect(earnedIds({ highestWowLevel: 60, charactersAtCap: 1 })).not.toContain("wow-max-level-3");
  });
  it("dates a counted achievement by the Nth recorded event", () => {
    const runs = Array.from({ length: 12 }, (_, i) => day(i + 1));
    const results = evaluateAchievements(facts({ dungeonRuns: runs }), now);
    expect(results.find(row => row.def.id === "dungeon-runs-1")?.earnedAt).toEqual(day(1));
    expect(results.find(row => row.def.id === "dungeon-runs-10")?.earnedAt).toEqual(day(10));
    expect(results.find(row => row.def.id === "dungeon-runs-25")).toMatchObject({ earned: false, value: 12, earnedAt: null });
  });
  it("counts raid clears separately from attendance", () => {
    const ids = earnedIds({ raidsAttended: [day(1), day(2)], raidClears: [day(2)] });
    expect(ids).toEqual(expect.arrayContaining(["raids-1", "raid-clears-1"]));
    expect(ids).not.toContain("raids-5");
  });
  it("uses the log's own date for PoE2 levels", () => {
    const results = evaluateAchievements(facts({ poeLevels: [{ level: 92, reachedAt: day(5) }, { level: 91, reachedAt: day(4) }] }), now);
    expect(results.find(row => row.def.id === "poe2-level-90")).toMatchObject({ earned: true, earnedAt: day(4) });
    expect(results.find(row => row.def.id === "poe2-level-99")).toMatchObject({ earned: false, value: 92 });
  });
  it("clamps a future date to now and dates level-only achievements at detection", () => {
    const results = evaluateAchievements(facts({ dungeonRuns: [new Date("2030-01-01")], highestWowLevel: 20 }), now);
    expect(results.find(row => row.def.id === "dungeon-runs-1")?.earnedAt).toEqual(now);
    expect(results.find(row => row.def.id === "wow-level-20")?.earnedAt).toEqual(now);
  });
});

type Stored = { guildId: string; memberId: string; key: string; earnedAt: Date; value: number };
function fakeDb(overrides: Record<string, unknown> = {}) {
  const stored: Stored[] = [];
  const db = {
    member: { findFirst: vi.fn(async () => ({ discordUserId: "u1" })) },
    character: { findMany: vi.fn(async () => [{ level: 60, gameEdition: "forever" }]) },
    dungeonRunPlayer: { findMany: vi.fn(async () => [{ runId: "r1", run: { endedAt: day(3), startedAt: null, createdAt: day(3) } }, { runId: "r1", run: { endedAt: day(3), startedAt: null, createdAt: day(3) } }]) },
    raidAttendance: { findMany: vi.fn(async () => [{ raidId: "a", raid: { endedAt: day(6), scheduledAt: day(6), bosses: [{ status: "KILLED" }, { status: "KILLED" }] } }, { raidId: "b", raid: { endedAt: null, scheduledAt: day(7), bosses: [{ status: "KILLED" }, { status: "PENDING" }] } }]) },
    communityParticipationDay: { findMany: vi.fn(async () => [{ day: "2026-10-01", messages: 60, reactions: 4, voiceMs: 7_200_000 }, { day: "2026-10-01", messages: 0, reactions: 0, voiceMs: 0 }, { day: "2026-10-02", messages: 50, reactions: 7, voiceMs: 3_600_000 }]) },
    memberActivityTotal: { findUnique: vi.fn(async () => ({ messages: 600, reactionsGiven: 30, reactionsReceived: 2, voiceSeconds: 40 * 3600 + 59 })) },
    communityPoint: { aggregate: vi.fn(async () => ({ _sum: { amount: 130 } })), count: vi.fn(async () => 40) },
    epgpTransaction: { aggregate: vi.fn(async () => ({ _sum: { epAmount: 250 } })) },
    professionSkill: { findMany: vi.fn(async () => [{ skillLevel: 175 }]) },
    poeLevelReached: { findMany: vi.fn(async () => []) },
    poeMapVisit: { findMany: vi.fn(async () => []) },
    memberAchievement: {
      findMany: vi.fn(async () => stored.map(row => ({ ...row }))),
      createMany: vi.fn(async ({ data }: { data: Stored[] }) => { let count = 0; for (const row of data) if (!stored.some(s => s.key === row.key && s.memberId === row.memberId)) { stored.push(row); count += 1; } return { count }; })
    },
    ...overrides
  };
  return { db: db as never, raw: db, stored };
}

describe("syncMemberAchievements", () => {
  it("stores what is earned once, from recorded data only, and is idempotent", async () => {
    const { db, stored } = fakeDb();
    const first = await syncMemberAchievements(db, "g", "m", now);
    expect(first.newlyEarned).toEqual(expect.arrayContaining(["wow-level-60", "wow-max-level", "dungeon-runs-1", "raids-1", "raid-clears-1"]));
    expect(first.newlyEarned).not.toContain("dungeon-runs-10");
    // The duplicate run row counts once, the raid with a pending boss is not a clear, a repeated day counts once.
    expect(first.results.find(row => row.def.id === "dungeon-runs-1")?.value).toBe(1);
    expect(first.results.find(row => row.def.id === "profession-150")?.earned).toBe(true);
    expect(first.results.find(row => row.def.id === "profession-300")?.earned).toBe(false);
    expect(first.results.find(row => row.def.id === "raid-clears-1")?.value).toBe(1);
    expect(first.results.find(row => row.def.id === "active-days-7")?.value).toBe(2);
    const count = stored.length;
    const second = await syncMemberAchievements(db, "g", "m", new Date("2026-11-09T12:00:00Z"));
    expect(second.newlyEarned).toEqual([]);
    expect(stored.length).toBe(count);
    expect(second.results.find(row => row.def.id === "dungeon-runs-1")?.earnedAt).toEqual(day(3));
  });
  it("measures activity and scoring totals, taking the larger of the counter and the season record", async () => {
    const { db } = fakeDb();
    const view = await syncMemberAchievements(db, "g", "m", now);
    const value = (id: string) => view.results.find(row => row.def.id === id)!;
    // Counter 600 beats the season record (110): the 500 step is earned, 1,000 is not.
    expect(value("messages-500")).toMatchObject({ earned: true, value: 600 });
    expect(value("messages-1000").earned).toBe(false);
    // Voice: counter 40 h 59 s beats the season record (5 h); partial hours do not count.
    expect(value("voice-hours-25").value).toBe(40);
    expect(value("voice-hours-50").earned).toBe(false);
    // Reactions given come from the participation ledger (40) when above the counter (30); received from the season record (11).
    expect(value("reactions-given-25")).toMatchObject({ earned: true, value: 40 });
    expect(value("reactions-received-10")).toMatchObject({ earned: true, value: 11 });
    expect(value("points-100")).toMatchObject({ earned: true, value: 130 });
    expect(value("points-500").earned).toBe(false);
    expect(value("ep-100")).toMatchObject({ earned: true, value: 250 });
    expect(value("ep-500").earned).toBe(false);
  });
  it("never reads message text: only counts are asked of the database", async () => {
    const { raw } = fakeDb();
    await syncMemberAchievements(raw as never, "g", "m", now);
    expect(JSON.stringify((raw.communityParticipationDay.findMany as ReturnType<typeof vi.fn>).mock.calls)).not.toMatch(/content|messageHashes/);
  });
  it("keeps an earned achievement even if the data later shrinks", async () => {
    const { db, raw } = fakeDb();
    await syncMemberAchievements(db, "g", "m", now);
    (raw.dungeonRunPlayer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const again = await syncMemberAchievements(db, "g", "m", now);
    expect(again.results.find(row => row.def.id === "dungeon-runs-1")).toMatchObject({ earned: true });
  });
  it("evaluates nothing for a member who is not in the guild", async () => {
    const { db, stored } = fakeDb({ member: { findFirst: vi.fn(async () => null) } });
    const view = await syncMemberAchievements(db, "g", "stranger", now);
    expect(view.newlyEarned).toEqual([]);
    expect(stored).toEqual([]);
  });
});

describe("achievement card", () => {
  const items = (ids: string[]) => ACHIEVEMENTS.map(def => ({ id: def.id, earnedAt: ids.includes(def.id) ? day(2) : null, value: ids.includes(def.id) ? def.threshold : 4 }));
  it("summarises unlocked counts per game and lists the latest in tier colours", () => {
    const card = achievementsCard("Kevin", items(["wow-level-20", "wow-max-level", "dungeon-runs-1"]), "en");
    expect(card.stats[0]).toMatchObject({ label: "Unlocked", value: `3/${ACHIEVEMENTS.length}` });
    expect(card.stats[1]).toMatchObject({ label: "WoW", value: "2/8" });
    expect(card.rows).toHaveLength(3);
  });
  it("shows the closest locked ones before anything is earned, in French when asked", () => {
    const card = achievementsCard("Kevin", items([]), "fr");
    expect(card.rowsLabel).toBe("Les plus proches");
    expect(card.rows![0]!.right).toBe("Verrouillé");
    expect(card.stats[0]!.label).toBe("Débloqués");
  });
  it("renders to a PNG", async () => {
    const png = await scoreCardPng(achievementsCard("Kevin Caron", items(["wow-level-20", "wow-level-40", "wow-level-60", "wow-max-level", "dungeon-runs-1", "dungeon-runs-10", "raids-1"]), "en"));
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("PoE2 level ingest", () => {
  const level = { character: "Ann", league: "Pilot", level: 90, reachedAt: "2026-10-30T12:00:00Z" };
  const makeDb = (settings: unknown = { poeTrackingEnabled: true, dataResetAt: null }) => ({
    guildSettings: { findUnique: vi.fn(async () => settings) }, member: { findFirst: vi.fn(async () => ({ id: "m" })) },
    poeLevelReached: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) }
  });
  it("stores levels for the paired member, ignoring any member id in the body", async () => {
    const db = makeDb();
    const service = createPoeMappingService(db as never);
    expect(await service.ingestLevels("g", "m", { guildDiscordId: "1", levels: [level] }, now)).toEqual({ inserted: 1, excludedByReset: 0 });
    expect(db.poeLevelReached.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true, data: [{ guildId: "g", memberId: "m", level: 90 }] });
    await expect(service.ingestLevels("g", "m", { guildDiscordId: "1", levels: [{ ...level, memberId: "other" }] }, now)).rejects.toThrow();
  });
  it("refuses when tracking is off, levels out of range and future timestamps", async () => {
    const body = (row: unknown) => ({ guildDiscordId: "1", levels: [row] });
    await expect(createPoeMappingService(makeDb({ poeTrackingEnabled: false }) as never).ingestLevels("g", "m", body(level), now)).rejects.toThrow(/disabled/);
    await expect(createPoeMappingService(makeDb() as never).ingestLevels("g", "m", body({ ...level, level: 101 }), now)).rejects.toThrow();
    await expect(createPoeMappingService(makeDb() as never).ingestLevels("g", "m", body({ ...level, reachedAt: "2030-01-01T00:00:00Z" }), now)).rejects.toThrow(/future/);
  });
  it("skips levels from before a data reset", async () => {
    const db = makeDb({ poeTrackingEnabled: true, dataResetAt: new Date("2026-11-01T00:00:00Z") });
    expect(await createPoeMappingService(db as never).ingestLevels("g", "m", { guildDiscordId: "1", levels: [level] }, now)).toEqual({ inserted: 0, excludedByReset: 1 });
  });
});

describe("long progressions", () => {
  const ladders = (metric: string) => ACHIEVEMENTS.filter(def => def.metric === metric);
  it("gives messages 10 steps and voice 8, rising in threshold and tier, ending at a very high number", () => {
    const order = ["bronze", "silver", "gold", "platinum", "epic", "legendary"];
    for (const [metric, steps, top] of [["messagesSent", 10, 250_000], ["voiceHours", 8, 1000], ["reactionsGiven", 7, 10_000], ["communityPoints", 7, 25_000]] as const) {
      const rows = ladders(metric);
      expect(rows, metric).toHaveLength(steps);
      expect(rows.map(def => def.threshold)).toEqual([...rows.map(def => def.threshold)].sort((a, b) => a - b));
      expect(rows.map(def => def.rank)).toEqual(rows.map((_, i) => i + 1));
      expect(rows.map(def => order.indexOf(def.tier))).toEqual([...rows.map(def => order.indexOf(def.tier))].sort((a, b) => a - b));
      expect(rows.at(-1)!.threshold).toBe(top);
    }
  });
  it("has English and French text with the number in each description and plural hours", () => {
    expect(ACHIEVEMENTS.find(def => def.id === "messages-250000")!.fr.description).toBe("Envoyer 250\u00a0000 messages sur le Discord de la guilde.");
    expect(ACHIEVEMENTS.find(def => def.id === "messages-250000")!.en.description).toBe("Send 250,000 messages in the guild's Discord.");
    expect(ACHIEVEMENTS.find(def => def.id === "voice-hours-1")!.en.description).toContain("1 hour in");
    expect(ACHIEVEMENTS.find(def => def.id === "voice-hours-10")!.fr.description).toContain("10 heures");
    for (const def of ACHIEVEMENTS) for (const lang of ["en", "fr"] as const) { expect(def[lang].name.length, def.id).toBeGreaterThan(2); expect(def[lang].description.length, def.id).toBeGreaterThan(10); }
  });
  it("shows only the top earned step and the next unearned step of a ladder on the card", () => {
    const earnedIds = ["messages-100", "messages-500", "messages-1000"];
    const items = ACHIEVEMENTS.map(def => ({ id: def.id, earnedAt: earnedIds.includes(def.id) ? day(2) : null, value: earnedIds.includes(def.id) ? def.threshold : 3 }));
    const card = achievementsCard("Kevin", items, "en");
    expect(card.rows).toHaveLength(1);
    expect(card.rows![0]!.name).toBe("Regular Poster");
    expect(JSON.stringify(card)).toContain("Next:");
  });
});
