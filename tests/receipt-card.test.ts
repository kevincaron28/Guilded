import { describe, expect, it } from "vitest";
import { dungeonRunCard, receiptCardOf, runCardsOf } from "../src/services/dungeon-card.js";
import { saveRunReceipts, type DungeonImportResult } from "../src/services/dungeon-import.js";

type Details = NonNullable<DungeonImportResult["playerDetails"]>;
const d = (character: string, extra: Partial<Details[number]> = {}): Details[number] => ({ character, class: "WARRIOR", deaths: 0, presentSec: 1100, points: 0, ...extra });
const run = (playerDetails: Details): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Ragefire Chasm", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1105, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: playerDetails.map((p) => p.character), deaths: 0, unlinked: [],
  inGuildPlayers: playerDetails.map((p) => p.character), achievements: [], endedAt: 1794000000, playerDetails, ratingEnabled: true
});
const party = [
  d("Aldric", { level: 24, guild: "Québec Gold", ratingTotal: 412.4, ratingGain: 36 }),
  d("Brenna", { level: 23, guild: "Québec Gold", ratingTotal: 388, ratingGain: -2 }),
  d("Cedric", { level: 24 }),
  d("Dara", { level: 22, ratingTotal: 57, ratingGain: 12 }),
  d("Edric"), d("Fenn", { level: 20 })
];

describe("the receipt card rows for the in-game result card", () => {
  it("uses the Discord card's own level, guild, gain and total, five players at most", () => {
    const rows = receiptCardOf(run(party))!;
    const discord = dungeonRunCard(run(party), "en").dungeon!.party;
    expect(rows).toHaveLength(5);
    for (const [index, row] of rows.entries()) {
      expect(row.l).toBe(discord[index]!.level);
      expect(row.g).toBe(discord[index]!.guildName);
      expect(row.a).toBe(discord[index]!.gain);
      expect(row.t).toBe(discord[index]!.total);
    }
    expect(rows[0]).toEqual({ n: "Aldric", l: 24, g: "Québec Gold", a: 36, t: 412 });
    expect(rows[1]!.a).toBe(0); // never a negative gain
    expect(rows[2]).toEqual({ n: "Cedric", l: 24 }); // not rated: nothing invented
  });
  it("is null when nothing beyond names is known", () => {
    expect(receiptCardOf(run([d("Aldric"), d("Brenna")]))).toBeNull();
  });
  it("answers runCards from stored rows, cleaned and capped", () => {
    const rows = [
      { runRef: "a", card: [{ n: "X", l: 20, g: "G", a: 1, t: 2 }, { n: "" }, { bad: true }, ...Array.from({ length: 8 }, (_, i) => ({ n: `P${i}`, l: 10 }))] },
      { runRef: "b", card: "garbage" }, { runRef: "c", card: null }, { runRef: "d", card: [{ n: "Y", a: 1 }] }
    ];
    const cards = runCardsOf(rows);
    expect(Object.keys(cards)).toEqual(["a", "d"]);
    expect(cards["a"]).toHaveLength(5);
    expect(cards["d"]).toEqual([{ n: "Y" }]); // a gain without a total is dropped
    expect(Object.keys(runCardsOf(Array.from({ length: 50 }, (_, i) => ({ runRef: `r${i}`, card: [{ n: "X", l: 1 }] })), 30))).toHaveLength(30);
  });
  it("saves the card with a new receipt and refreshes it on a recovered run", async () => {
    const created: unknown[] = [];
    const updated: unknown[] = [];
    const table = {
      findMany: async () => [{ runRef: "r2", outcome: "retry", createdAt: new Date() }],
      createMany: async (args: { data: unknown[] }) => { created.push(...args.data); return { count: 1 }; },
      updateMany: async () => ({ count: 0 }), update: async (args: unknown) => { updated.push(args); return {}; }
    };
    const card = [{ n: "Aldric", l: 24 }];
    await saveRunReceipts({ dungeonRunReceipt: table } as never, "g", [
      { runRef: "r1", outcome: "stored", reason: null, runId: "x", fresh: true, card },
      { runRef: "r2", outcome: "stored", reason: null, runId: "y", fresh: true, card }
    ]);
    expect(created[0]).toMatchObject({ runRef: "r1", card });
    expect(updated[0]).toMatchObject({ data: { card } });
  });
});
