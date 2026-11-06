import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({}) }));
import { LEVEL_CAP, RACE_BOARD_MARKER, loadRaceBoardData, nearLevel, nextEntry, orderRace, raceBoardEmbed, raceCard, weekStart, type RaceBoardData, type RaceRow } from "../src/services/race-board.js";
import { ensurePvpModule, pvpChannelNames } from "../src/services/battleground-setup.js";

const row = (name: string, level: number, over: Partial<RaceRow> = {}): RaceRow => ({ name, className: "Mage", level, reachedMaxAt: null, weekGain: 0, memberId: null, ...over });
const data = (rows: RaceRow[]): RaceBoardData => ({ rows, total: rows.length, finished: rows.filter(r => r.level >= LEVEL_CAP).length, edition: "forever" });

describe("race to 60 state", () => {
  const wed = new Date("2026-11-11T12:00:00Z"); // a Wednesday
  it("weeks start on Monday 00:00 UTC", () => {
    expect(weekStart(wed).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-15T23:59:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("starts a new character at its level with no gain", () => {
    expect(nextEntry(null, 12, wed)).toEqual({ level: 12, reachedMaxAt: null, weekStartLevel: 12, weekStartedAt: weekStart(wed) });
  });
  it("records the moment a character reaches the cap, once", () => {
    const before = { level: 59, reachedMaxAt: null, weekStartLevel: 55, weekStartedAt: weekStart(wed) };
    const hit = nextEntry(before, 60, wed);
    expect(hit.reachedMaxAt).toEqual(wed);
    expect(nextEntry(hit, 60, new Date("2026-11-12T00:00:00Z")).reachedMaxAt).toEqual(wed);
  });
  it("rolls the weekly baseline on a new week and keeps it within a week", () => {
    const prev = { level: 30, reachedMaxAt: null, weekStartLevel: 20, weekStartedAt: new Date("2026-11-02T00:00:00Z") };
    expect(nextEntry(prev, 33, wed)).toMatchObject({ level: 33, weekStartLevel: 30 });
    expect(nextEntry({ ...prev, weekStartedAt: weekStart(wed) }, 33, wed)).toMatchObject({ weekStartLevel: 20 });
  });
  it("restarts the history when a name comes back at a lower level", () => {
    const prev = { level: 60, reachedMaxAt: wed, weekStartLevel: 58, weekStartedAt: weekStart(wed) };
    expect(nextEntry(prev, 4, wed)).toMatchObject({ level: 4, reachedMaxAt: null, weekStartLevel: 4 });
  });
  it("orders finishers by arrival, then racers by level", () => {
    const rows = [row("Low", 10), row("Late", 60, { reachedMaxAt: new Date("2026-11-08T00:00:00Z") }), row("Early", 60, { reachedMaxAt: new Date("2026-11-06T00:00:00Z") }), row("High", 59)];
    expect(orderRace(rows).map(r => r.name)).toEqual(["Early", "Late", "High", "Low"]);
  });
  it("finds partners near a level, skipping own characters and finished ones", () => {
    const rows = [row("Own", 30), row("Near", 31), row("Far", 50), row("Done", 60), row("Close", 30)];
    expect(nearLevel(rows, 30, new Set(["own"])).map(r => r.name)).toEqual(["Close", "Near"]);
  });
});

describe("race board embed and card", () => {
  it("has English and French empty states and the marker", () => {
    expect(raceBoardEmbed(data([]), "en", "g1").toJSON().description).toContain("No levelled character");
    const fr = raceBoardEmbed(data([]), "fr", "g1").toJSON();
    expect(fr.title).toBe("🏁 Course au niveau 60");
    expect(fr.footer?.text?.startsWith(`${RACE_BOARD_MARKER} • g1 •`)).toBe(true);
  });
  it("lists the finish order, who is still racing and the week's best", () => {
    const json = raceBoardEmbed(data([row("Aria", 60, { reachedMaxAt: new Date("2026-11-06T12:00:00Z"), weekGain: 4 }), row("Brom", 41, { weekGain: 9 }), row("**Cy**", 20)]), "en", "g1", "race.png").toJSON();
    expect(json.description).toContain("**1** of **3**");
    expect(json.fields?.map(f => f.name)).toEqual(["Finish order", "Still racing", "Most levels this week"]);
    expect(json.fields?.[0]?.value).toContain("🥇 Aria · <t:1793966400:d>");
    expect(json.fields?.[2]?.value).toBe("Brom +9\nAria +4");
    expect(json.fields?.[1]?.value).toContain("\\*\\*Cy\\*\\*");
    expect(json.image?.url).toBe("attachment://race.png");
  });
  it("draws at most 14 class-coloured bars", () => {
    const card = raceCard(data(Array.from({ length: 20 }, (_, i) => row(`P${i}`, 50 - i, { weekGain: i === 0 ? 3 : 0 }))), "fr");
    expect(card.race).toHaveLength(14);
    expect(card.race?.[0]).toMatchObject({ color: "#69ccf0", level: 50, max: 60, note: "+3 sem." });
    expect(card.title).toBe("Course au niveau 60");
  });
});

describe("race board data", () => {
  it("counts linked and unlinked characters once, skips hidden members, and stores first sightings", async () => {
    const upsert = vi.fn();
    const db = {
      character: { findMany: vi.fn()
        .mockResolvedValueOnce([{ name: "Aria Stone", realm: "Realm", className: "Mage", level: 60, memberId: "m1" }])
        .mockResolvedValueOnce([{ name: "Secret One", realm: "Realm" }]) },
      unclaimedCharacter: { findMany: vi.fn(async () => [
        { nameKey: "aria stone", name: "Aria Stone", className: "Mage", level: 58 },
        { nameKey: "bob smith", name: "Bob Smith", className: "Rogue", level: 33 }]) },
      levelRaceEntry: { findMany: vi.fn(async () => []), upsert }
    };
    const result = await loadRaceBoardData(db as never, "g1", "forever", new Date("2026-11-11T12:00:00Z"));
    expect(result.total).toBe(result.rows.length);
    expect(result.rows.filter(r => r.name === "Aria Stone")).toHaveLength(1);
    expect(result.rows.find(r => r.name === "Aria Stone")?.level).toBe(60);
    expect(result.finished).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(result.total);
  });
});

describe("PvP channels", () => {
  it("adopts the battleground names and the new PvP names in both languages", () => {
    expect(pvpChannelNames("stats")).toEqual(["battleground-statistics", "statistiques-jcj", "pvp-ladder", "classement-pvp"]);
    expect(pvpChannelNames("groups")).toContain("pvp-groups");
  });
  it("does nothing for a server that has not switched the module on", async () => {
    const db = { guildSettings: { findUnique: vi.fn(async () => ({ pvpModuleEnabled: false })) } };
    await expect(ensurePvpModule({} as never, db as never, "g1", "en", "u1")).resolves.toBe("");
  });
});
