import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { duelBoardCard } from "../src/services/duel-board.js";
import { KEEP_DAYS, moveFields, movementsFrom, ranksOf, trackRanks, utcDay } from "../src/services/ladder-snapshots.js";
import { scoreCardPng } from "../src/services/score-card.js";

interface Row { guildId: string; board: string; day: string; ranks: Record<string, number> }
/** An in-memory stand-in for prisma.ladderSnapshot with the three calls trackRanks makes. */
function fakeDb(rows: Row[] = []) {
  return {
    rows,
    ladderSnapshot: {
      findFirst: async ({ where }: { where: { guildId: string; board: string; day: { lt: string } } }) =>
        rows.filter(r => r.guildId === where.guildId && r.board === where.board && r.day < where.day.lt).sort((a, b) => b.day.localeCompare(a.day))[0] ?? null,
      upsert: async ({ where, create, update }: { where: { guildId_board_day: { guildId: string; board: string; day: string } }; create: Row; update: { ranks: Record<string, number> } }) => {
        const key = where.guildId_board_day, found = rows.find(r => r.guildId === key.guildId && r.board === key.board && r.day === key.day);
        if (found) found.ranks = update.ranks; else rows.push({ ...create });
        return found ?? create;
      },
      deleteMany: async ({ where }: { where: { guildId: string; day: { lt: string } } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.guildId === where.guildId && rows[i]!.day < where.day.lt) rows.splice(i, 1);
        return { count: before - rows.length };
      }
    }
  };
}

describe("rank movement", () => {
  it("ranks ids in order and compares them with the previous day", () => {
    expect(ranksOf(["a", "b", "a", "", "c"])).toEqual({ a: 1, b: 2, c: 5 });
    const moves = movementsFrom({ a: 2, b: 1, c: 3 }, { a: 1, b: 2, c: 3, d: 4 });
    expect([...moves]).toEqual([["a", 1], ["b", -1], ["c", 0], ["d", "new"]]);
    expect(moveFields(moves, "d", "fr")).toEqual({ move: "new", moveLabel: "nouv." });
    expect(moveFields(moves, "b", "en")).toEqual({ move: -1, moveLabel: "1" });
    expect(moveFields(null, "a", "en")).toEqual({});
    expect(moveFields(moves, "zzz", "en")).toEqual({});
  });
  it("stores one snapshot per board per UTC day, shows nothing on the first day, then movement since the latest earlier day", async () => {
    const db = fakeDb();
    const day1 = new Date("2026-11-07T10:00:00Z"), later = new Date("2026-11-07T22:00:00Z"), day2 = new Date("2026-11-08T09:00:00Z");
    expect(await trackRanks(db as never, "g1", "duel", ["a", "b", "c"], day1)).toBeNull();
    // A second refresh the same day rewrites the day's row and still has nothing earlier to compare with.
    expect(await trackRanks(db as never, "g1", "duel", ["b", "a", "c"], later)).toBeNull();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ day: "2026-11-07", ranks: { b: 1, a: 2, c: 3 } });
    const moves = await trackRanks(db as never, "g1", "duel", ["a", "c", "d"], day2);
    expect(moves && [...moves]).toEqual([["a", 1], ["c", 1], ["d", "new"]]);
    // Boards and guilds are separate.
    expect(await trackRanks(db as never, "g1", "race", ["a"], day2)).toBeNull();
    expect(await trackRanks(db as never, "g2", "duel", ["a"], day2)).toBeNull();
  });
  it("prunes snapshots older than the retention window and never throws", async () => {
    const db = fakeDb([{ guildId: "g1", board: "duel", day: "2026-10-01", ranks: { a: 1 } }, { guildId: "g1", board: "race", day: utcDay(new Date("2026-11-01T00:00:00Z")), ranks: { a: 1 } }]);
    await trackRanks(db as never, "g1", "duel", ["a"], new Date("2026-11-08T00:00:00Z"));
    expect(KEEP_DAYS).toBe(14);
    expect(db.rows.map(r => r.day).sort()).toEqual(["2026-11-01", "2026-11-08"]);
    const broken = { ladderSnapshot: { findFirst: async () => { throw new Error("db down"); } } };
    expect(await trackRanks(broken as never, "g1", "duel", ["a"])).toBeNull();
  });
});

describe("arrows on the ladder card", () => {
  it("adds a 24h column and draws a green up arrow, a red down arrow and a gold 'new'", async () => {
    const standings = Array.from({ length: 4 }, (_, i) => ({ memberId: `m${i}`, name: `Duelist ${i}`, score: (10 - i) * 10, wins: 10 - i, losses: i, games: 10, winRate: (10 - i) / 10, streak: 0, bestStreak: 2 }));
    const card = duelBoardCard({ duels: 20, edition: "forever", recent: [], standings }, "en", new Map(), new Date("2026-11-08T09:00:00Z"),
      new Map<string, number | "new">([["m0", 2], ["m1", -3], ["m2", 0], ["m3", "new"]]));
    expect(card.ladder!.columns.at(-1)).toMatchObject({ label: "24h", kind: "move" });
    expect(card.ladder!.boards[0]!.rows.map(row => row.move)).toEqual([2, -3, 0, "new"]);
    const png = (await scoreCardPng(card))!;
    // The move column is the rightmost (right edge at x=1122); the arrow sits left of its number. Rows are 38 px from y=216.
    const strip = async (top: number) => {
      const { data, info } = await sharp(png).extract({ left: 1060, top, width: 62, height: 30 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let green = 0, red = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (g > 150 && r < 160 && b < 120) green++;
        if (r > 200 && g < 140 && b < 120) red++;
      }
      return { green, red };
    };
    const up = await strip(220), down = await strip(258);
    expect(up.green).toBeGreaterThan(10);
    expect(down.red).toBeGreaterThan(10);
    expect(up.red).toBe(0);
  }, 60_000);
});
