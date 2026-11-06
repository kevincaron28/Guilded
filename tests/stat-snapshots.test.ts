import { describe, expect, it } from "vitest";
import { feedAccess, feedUrl, levelBand, newFeedKey, regenerateFeedKey, revokeFeedKey, statsCsv, takeGuildSnapshot, utcDay, type StatSnapshot } from "../src/services/stat-snapshots.js";
import { barChartSvg, lineChartSvg, statsBody } from "../src/services/stats-page.js";
import { serverStatsCard } from "../src/services/stats-card.js";

const row = (day: string, over: Partial<StatSnapshot> = {}): StatSnapshot => ({ day, discordMembers: 10, activeMembers: 4, linkedMembers: 6, rosterSize: 9, onlinePeak: 3, level60: 2, messages: 50, voiceMinutes: 30, raids: 1, dungeonRuns: 2,
  levelBands: { "1-9": 1, "60": 2 }, classCounts: { Mage: 3, Warrior: 6 }, ...over });

function fakeDb() {
  const snapshots = new Map<string, Record<string, unknown>>();
  const settings = { statsEnabled: true, statsFeedKeyHash: null as string | null };
  const db = {
    member: { count: async () => 5 },
    character: { findMany: async () => [{ level: 60, className: "Mage", lastSeenAt: new Date("2026-12-25T10:00:00Z") }, { level: 7, className: "Mage", lastSeenAt: null }, { level: 34, className: "Priest", lastSeenAt: new Date("2026-12-01T00:00:00Z") }] },
    memberActivityTotal: { aggregate: async () => ({ _sum: { messages: 1000, voiceSeconds: 7200 } }), count: async () => 2 },
    raid: { count: async () => 1 }, dungeonRun: { count: async () => 4 },
    guildStatSnapshot: {
      findFirst: async () => ({ totalMessages: 900, totalVoiceSeconds: 3600, discordMembers: 20 }),
      findUnique: async ({ where }: { where: { guildId_day: { day: string } } }) => (snapshots.get(where.guildId_day.day) as never) ?? null,
      upsert: async ({ where, create, update }: { where: { guildId_day: { day: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => { snapshots.set(where.guildId_day.day, { ...(snapshots.get(where.guildId_day.day) ?? create), ...update }); }
    },
    guildSettings: {
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(settings, data); },
      findUnique: async () => settings
    }
  };
  return { db: db as never, snapshots, settings };
}

describe("statistics snapshots", () => {
  it("bands levels", () => {
    expect([1, 9, 10, 59, 60, 61].map(levelBand)).toEqual(["1-9", "1-9", "10-19", "50-59", "60", "60"]);
  });

  it("writes one row per day with differences against the previous snapshot, and keeps the day's online peak", async () => {
    const { db, snapshots } = fakeDb();
    const now = new Date("2026-12-25T12:00:00Z");
    const first = await takeGuildSnapshot(db, "g1", 42, now);
    expect(first).toMatchObject({ day: "2026-12-25", discordMembers: 42, linkedMembers: 5, rosterSize: 3, level60: 1, onlinePeak: 1, messages: 100, voiceMinutes: 60, raids: 1, dungeonRuns: 4, activeMembers: 2 });
    expect(first.levelBands).toMatchObject({ "1-9": 1, "30-39": 1, "60": 1 });
    expect(first.classCounts).toEqual({ Mage: 2, Priest: 1 });
    snapshots.get("2026-12-25")!["onlinePeak"] = 9;
    const again = await takeGuildSnapshot(db, "g1", null, now);
    expect(again.onlinePeak).toBe(9);
    expect(snapshots.size).toBe(1);
    expect(utcDay(now)).toBe("2026-12-25");
  });

  it("builds a Sheets-friendly CSV, oldest first, with one column per class", () => {
    const csv = statsCsv([row("2026-12-24"), row("2026-12-25", { classCounts: { Mage: 1, "Death Knight": 2 } })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("day,discord_members,active_members,linked_members,roster_characters,online_peak,level_60,messages,voice_minutes,raids,dungeon_runs,level_1_9,level_10_19,level_20_29,level_30_39,level_40_49,level_50_59,level_60,class_Death_Knight,class_Mage,class_Warrior");
    expect(lines[1]!.startsWith("2026-12-24,10,4,6,9,3,2,50,30,1,2,1,0,0,0,0,0,2,0,3,6")).toBe(true);
    expect(lines).toHaveLength(3);
  });
});

describe("feed key", () => {
  it("accepts the current key, stores only a hash, and stops after a new key or a revoke", async () => {
    const { db, settings } = fakeDb();
    const key = await regenerateFeedKey(db, "g1");
    expect(settings.statsFeedKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(settings)).not.toContain(key);
    expect(await feedAccess(db, "g1", key)).toBe(true);
    expect(await feedAccess(db, "g1", newFeedKey())).toBe(false);
    expect(await feedAccess(db, "g1", "short")).toBe(false);
    const next = await regenerateFeedKey(db, "g1");
    expect(await feedAccess(db, "g1", key)).toBe(false);
    expect(await feedAccess(db, "g1", next)).toBe(true);
    settings.statsEnabled = false;
    expect(await feedAccess(db, "g1", next)).toBe(false);
    settings.statsEnabled = true;
    await revokeFeedKey(db, "g1");
    expect(await feedAccess(db, "g1", next)).toBe(false);
  });

  it("builds the address with the key as a query value", () => {
    expect(feedUrl("https://guilded.kcaron.top", "g1", "abc")).toBe("https://guilded.kcaron.top/api/v1/stats-feed?guild=g1&key=abc");
  });
});

describe("charts", () => {
  const t = (en: string) => en;
  it("draws inline SVG without scripts, escaping labels", () => {
    const svg = lineChartSvg(["2026-12-24", "2026-12-25"], [{ label: "<b>x</b>", values: [1, 5] }], "T");
    expect(svg).toContain("<polyline");
    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("<script");
    expect(lineChartSvg(["2026-12-25"], [{ label: "a", values: [3] }], "T")).toContain("<circle");
    expect(barChartSvg([{ label: "Mage", value: 3 }], "B")).toContain("<rect");
  });
  it("shows a helpful message with no snapshots and charts with several", () => {
    expect(statsBody([], t)).toContain("No statistics yet");
    const body = statsBody(Array.from({ length: 7 }, (_, i) => row(`2026-12-${20 + i}`)), t);
    expect(body.match(/<figure/g)).toHaveLength(6);
  });
  it("makes a card from the latest snapshot", () => {
    expect(serverStatsCard([], "G", "en")).toBeNull();
    const card = serverStatsCard([row("2026-12-24"), row("2026-12-25")], "Guild", "en")!;
    expect(card.race![0]).toMatchObject({ name: "Warrior", level: 6, max: 6 });
  });
});
