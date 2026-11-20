import { describe, expect, it, vi } from "vitest";
import { recordCard, recordDiff, recordEmbed, recordItems } from "../src/services/record-card.js";
import { recordRunHighlights, type DungeonHighlightItem } from "../src/services/dungeon-records.js";
import { scoreCardPng } from "../src/services/score-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";

const T0 = 1_762_500_000;
const roles = ["TANK", "HEALER", "DPS", "DPS", "DPS"];
const classes = ["Warrior", "Priest", "Mage", "Rogue", "Hunter"];
function run(over: Partial<DungeonImportResult> = {}): DungeonImportResult {
  return {
    runRef: "Alda-1", runId: "run1", dungeonName: "Wailing Caverns", instanceId: 43, difficultyId: 1, state: "COMPLETED", valid: true,
    durationSec: 3672, points: 0, guildRecord: true, previousGuildBest: 3915, personalRecords: [], players: ["Alda", "Bren", "Cyra", "Dax", "Eli"],
    deaths: 0, endedAt: T0 + 3672, startedAt: T0, unlinked: [], achievements: [],
    fullNames: { Alda: "Alda Stonehelm", Bren: "Bren Vale", Cyra: "Cyra Moonwhisper", Dax: "Dax Ironfist", Eli: "Eli Brightleaf" },
    playerDetails: ["Alda", "Bren", "Cyra", "Dax", "Eli"].map((character, i) => ({ character, deaths: 0, presentSec: 3672, points: 0, role: roles[i], class: classes[i] })),
    ...over
  } as DungeonImportResult;
}
const base = { instanceId: 43, difficultyId: 1, dungeonName: "Wailing Caverns", players: ["Alda Stonehelm"] };
const clear: DungeonHighlightItem = { ...base, kind: "clear", key: "clear:43:1:run1", valueSec: 3672, previousSec: 3915, previousPlayers: ["Fenn Ashgrove", "Garr Thunderhoof"] };
const first: DungeonHighlightItem = { ...base, kind: "first", key: "first:43:1", valueSec: 3672 };
const tie: DungeonHighlightItem = { ...clear, previousSec: 3672 };
const png = async (item: DungeonHighlightItem, lang: "en" | "fr") => (await scoreCardPng(recordCard(run(), item, lang)))?.subarray(1, 4).toString();

describe("record card", () => {
  it("shows the old and new time, the difference, the party with roles and the previous holders", async () => {
    const card = recordCard(run(), clear, "fr");
    expect(card.record).toMatchObject({ ribbon: "Nouveau record de guilde", newSec: 3672, previousSec: 3915, diffLabel: "−4:03", oldLabel: "Ancien record 65:15",
      previousHolders: ["Fenn Ashgrove", "Garr Thunderhoof"] });
    expect(card.record!.party.map(member => [member.name, member.role])).toEqual([["Alda Stonehelm", "TANK"], ["Bren Vale", "HEALER"], ["Cyra Moonwhisper", "DPS"], ["Dax Ironfist", "DPS"], ["Eli Brightleaf", "DPS"]]);
    expect(await png(clear, "fr")).toBe("PNG");
  }, 60_000);

  it("draws a first-ever record with no previous time or holders", async () => {
    const card = recordCard(run({ guildRecord: false, previousGuildBest: null }), first, "en");
    expect(card.record).toMatchObject({ ribbon: "First guild record", diffLabel: "First time", oldLabel: "No time before this one", previousHolders: [] });
    expect(card.record!.previousSec).toBeUndefined();
    expect(await png(first, "en")).toBe("PNG");
  }, 60_000);

  it("draws a tie as tied, with an equals sign", async () => {
    expect(recordCard(run(), tie, "en").record).toMatchObject({ ribbon: "Guild record tied", diffLabel: "=" });
    expect(await png(tie, "en")).toBe("PNG");
  }, 60_000);

  it("formats the difference both ways", () => {
    expect(recordDiff(3672, 3915)).toBe("−4:03");
    expect(recordDiff(100, 100)).toBe("=");
    expect(recordDiff(120, 100)).toBe("+0:20");
  });
});

describe("record post", () => {
  it("puts the dungeon, time and difference in the embed title, in both languages", () => {
    expect(recordEmbed(run(), clear, "fr").toJSON().title).toBe("🏆 Nouveau record de guilde : Wailing Caverns 61:12 (−4:03)");
    expect(recordEmbed(run(), clear, "en").toJSON().title).toBe("🏆 New guild record: Wailing Caverns 61:12 (−4:03)");
    expect(recordEmbed(run(), first, "en").toJSON().title).toBe("🚩 First guild record: Wailing Caverns 61:12");
    const text = recordEmbed(run(), clear, "en").toJSON().description!;
    expect(text).toContain("**Alda Stonehelm** (Tank)");
    expect(text).toContain("Held before by: Fenn Ashgrove, Garr Thunderhoof");
    expect(text).not.toContain("<@");
  });

  it("gives a card to a clear record or a first clear only, never to boss records or challenges", () => {
    const boss: DungeonHighlightItem = { ...base, kind: "boss", key: "boss:1", label: "Mutanus", valueSec: 60, previousSec: 70 };
    const flawless: DungeonHighlightItem = { ...base, kind: "deathless", key: "deathless:43:1" };
    expect(recordItems([boss, clear, flawless]).map(item => item.kind)).toEqual(["clear"]);
    expect(recordItems([first, flawless]).map(item => item.kind)).toEqual(["first"]);
    expect(recordItems([boss])).toEqual([]);
    expect(recordItems(undefined)).toEqual([]);
  });
});

describe("previous holders", () => {
  it("names the guild members of the run that held the record before", async () => {
    const result = run();
    const db = {
      dungeonRun: {
        findMany: vi.fn(async (args: { where: { id?: unknown } }) => "in" in (args.where.id as object ?? {})
          ? [{ id: "run1", instanceId: 43, endedAt: new Date((T0 + 3672) * 1000) }]
          : [{ instanceId: 43, difficultyId: 1, endedAt: new Date((T0 - 86400) * 1000), competitionData: null, players: [{ deaths: 1, inGuild: true, memberId: "m9" }] }]),
        findFirst: vi.fn(async () => ({ players: [{ character: "Fenn" }, { character: "Garr" }] }))
      },
      dungeonHighlight: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 1 })) }
    };
    await recordRunHighlights(db as never, "g1", [result]);
    const item = result.highlights?.find(entry => entry.kind === "clear");
    expect(item?.previousPlayers).toEqual(["Fenn", "Garr"]);
    expect(db.dungeonRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ durationSec: 3915, id: { not: "run1" } }) }));
  });
});
