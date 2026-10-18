import { describe, expect, it } from "vitest";
import { readDatabase } from "../companion/lua-export-content.mjs";
import { csvCell, sheetFiles, sheetTables, SHEET_TABLES, toCsv } from "../companion/sheet-export.mjs";

// A Guilded.lua the way WoW writes it: arrays with explicit [1] = keys.
const SAVED = `
GuildedDB = {
  ["standings"] = {
    ["baseGp"] = 0,
    ["updatedAt"] = "2026-10-18T12:00:00Z",
    ["players"] = {
      ["Amélie"] = { ["ep"] = 100, ["gp"] = 10, ["account"] = "acc1" },
      ["Bob"] = { ["ep"] = 50, ["gp"] = 50 },
    },
  },
  ["acceptedLedgerRefs"] = { ["addon:qg:old"] = true },
  ["epgp"] = {
    ["Amélie"] = { ["ledger"] = {
      [1] = { ["id"] = "old", ["epAmount"] = 20, ["gpAmount"] = 0 },
      [2] = { ["id"] = "new", ["epAmount"] = 20, ["gpAmount"] = 0, ["pending"] = true },
      [3] = { ["id"] = "core", ["epAmount"] = 99, ["gpAmount"] = 0, ["pending"] = true, ["coreId"] = "c1" },
    } },
    ["Newbie"] = { ["ledger"] = { [1] = { ["id"] = "n1", ["epAmount"] = 5, ["gpAmount"] = 0, ["pending"] = true } } },
  },
  ["raids"] = {
    [1] = { ["id"] = "1700000000-Kev", ["title"] = "Molten Core, week 1", ["startedAt"] = "2026-10-14T20:00:00Z", ["endedAt"] = "2026-10-14T23:00:00Z" },
    [2] = { ["id"] = "1700100000-Kev", ["title"] = "Onyxia", ["startedAt"] = "2026-10-15T20:00:00Z" },
  },
  ["attendance"] = {
    ["1700000000-Kev"] = { ["Bob"] = { ["status"] = "PRESENT" }, ["Amélie"] = { ["status"] = "LATE" }, ["Zed"] = { ["status"] = "ABSENT" } },
  },
  ["bosses"] = { ["1700000000-Kev"] = { [1] = { ["name"] = "Lucifron" }, [2] = { ["name"] = "Ragnaros" } } },
  ["loot"] = {
    [1] = { ["at"] = "2026-10-14T21:00:00Z", ["raid"] = "1700000000-Kev", ["item"] = "|cffa335ee|Hitem:17076::::::::60:::::|h[Bonereaver's Edge]|h|r", ["player"] = "Bob", ["cost"] = 50, ["boss"] = "Ragnaros" },
    [2] = { ["at"] = "2026-10-14T22:00:00Z", ["raid"] = "1700000000-Kev", ["item"] = "Cape \\"rouge\\", épique", ["player"] = "Amélie", ["cost"] = 0 },
  },
  ["dungeonBoard"] = {
    ["status"] = "ACTIVE",
    ["detailsAvailable"] = false,
    ["rows"] = { [1] = { ["name"] = "Bob", ["points"] = 40 }, [2] = { ["name"] = "Amélie-Realm", ["points"] = 75 } },
    ["profiles"] = { [1] = { ["name"] = "Amélie", ["points"] = 80, ["details"] = { [1] = { ["name"] = "Deadmines" }, [2] = { ["name"] = "Stockade" } } } },
  },
}
`;
const NOW = Date.parse("2026-10-18T12:00:00Z") / 1000;

describe("companion spreadsheet export", () => {
  it("quotes CSV values as RFC 4180 says and adds the byte-order mark", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("Élodie")).toBe("Élodie");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell(-3)).toBe("-3");
    expect(toCsv([["a", "b"], [1, null]])).toBe("\uFEFFa,b\r\n1,\r\n");
  });

  it("names one file per table, dated, each with the byte-order mark", () => {
    const files = sheetFiles(SAVED, { now: NOW });
    expect(files.map((file) => file.name)).toEqual(SHEET_TABLES.map((table) => `guilded-${table}-2026-10-18.csv`));
    for (const file of files) expect(file.text.startsWith("\uFEFF")).toBe(true);
    expect(Object.fromEntries(files.map((file) => [file.table, file.rows]))).toEqual({ standings: 3, loot: 2, attendance: 3, raids: 2, dungeons: 2 });
  });

  it("standings: saved standings plus what Discord has not counted yet, best PR first", () => {
    const { standings } = sheetTables(sheetFilesDb(), NOW);
    expect(standings).toEqual([
      ["Rank", "Name", "EP", "GP", "PR"],
      // 100 + 20 (pending, not accepted); the accepted entry and the core's entry don't count.
      [1, "Amélie", 120, 10, "12.00"],
      [2, "Bob", 50, 50, "1.00"],
      // No saved standings for Newbie: the whole ledger counts, and no GP means PR 0.
      [3, "Newbie", 5, 0, "0.00"]
    ]);
  });

  it("loot: newest first, raid titles, item links as plain names", () => {
    const { loot } = sheetTables(sheetFilesDb(), NOW);
    expect(loot).toEqual([
      ["Date (UTC)", "Raid", "Item", "Player", "GP", "Boss"],
      ["2026-10-14 22:00:00", "Molten Core, week 1", 'Cape "rouge", épique', "Amélie", 0, ""],
      ["2026-10-14 21:00:00", "Molten Core, week 1", "Bonereaver's Edge", "Bob", 50, "Ragnaros"]
    ]);
    const text = sheetFiles(SAVED, { now: NOW }).find((file) => file.table === "loot")!.text;
    expect(text).toContain('"Molten Core, week 1","Cape ""rouge"", épique",Amélie,0,\r\n');
  });

  it("attendance and raids: newest raid first, players sorted, absences not counted", () => {
    const { attendance, raids } = sheetTables(sheetFilesDb(), NOW);
    expect(attendance).toEqual([
      ["Raid", "Date (UTC)", "Player", "Status"],
      ["Molten Core, week 1", "2026-10-14 20:00:00", "Amélie", "LATE"],
      ["Molten Core, week 1", "2026-10-14 20:00:00", "Bob", "PRESENT"],
      ["Molten Core, week 1", "2026-10-14 20:00:00", "Zed", "ABSENT"]
    ]);
    expect(raids).toEqual([
      ["Raid", "Started (UTC)", "Ended (UTC)", "Attended", "Bosses", "Loot"],
      ["Onyxia", "2026-10-15 20:00:00", "", 0, 0, 0],
      ["Molten Core, week 1", "2026-10-14 20:00:00", "2026-10-14 23:00:00", 2, 2, 2]
    ]);
  });

  it("dungeons: the active season, profiles first, one row per player", () => {
    const { dungeons } = sheetTables(sheetFilesDb(), NOW);
    expect(dungeons).toEqual([
      ["Rank", "Name", "Score", "Dungeons", "Bracket"],
      [1, "Amélie", 80, 2, ""],
      [2, "Bob", 40, "", ""]
    ]);
    expect(sheetTables({ dungeonBoard: { status: "ENDED", rows: [{ name: "Bob", points: 1 }] } }, NOW)["dungeons"]).toHaveLength(1);
  });

  it("copes with a fresh addon that has no data yet", () => {
    const files = sheetFiles("GuildedDB = {}", { now: NOW });
    expect(files.every((file) => file.rows === 0)).toBe(true);
    expect(() => sheetFiles("Other = {}")).toThrow(/GuildedDB/);
  });
});

// The parsed GuildedDB of SAVED (sheetTables takes the table itself).
function sheetFilesDb() { return readDatabase(SAVED); }
