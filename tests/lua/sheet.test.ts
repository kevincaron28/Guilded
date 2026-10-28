import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// /guilded sheet: tab-separated tables that paste into Excel or Google Sheets one value per cell.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function start(): LuaSession {
  const s = newLuaSession();
  s.run(`
    GuildedDB = nil
    NS = {}
  `);
  s.load("Core.lua");
  s.run(`
    fire_event("PLAYER_LOGIN")
    local db = GuildedDB
    db.raids = {
      { id = "r1", title = "Molten Core", startedAt = "2026-10-01T19:00:00Z", endedAt = "2026-10-01T22:00:00Z" },
      { id = "r2", title = "Onyxia", startedAt = "2026-10-08T19:00:00Z" },
    }
    db.attendance = { r1 = { Kev = { status = "PRESENT" }, Ray = { status = "ABSENT" } }, r2 = { Kev = { status = "LATE" } } }
    db.bosses = { r1 = { { name = "Lucifron" }, { name = "Magmadar" } } }
    db.loot = { { player = "Kev", item = "Tab\\tbed\\nSword", cost = 50, at = "2026-10-01T20:00:00Z", raid = "r1", boss = "Magmadar" } }
    db.standings = { updatedAt = "2026-10-08T00:00:00Z", baseGp = 0, players = {
      Kev = { ep = 300, gp = 100 }, Ray = { ep = 100, gp = 100 } } }
  `);
  return s;
}

const rows = (s: LuaSession, kind: string): string[][] =>
  String(s.run(`return (NS.sheetText("${kind}"))`)).split("\n").map((line) => line.split("\t"));

describe("/guilded sheet", () => {
  it("puts the standings in columns, best PR first", () => {
    session = start();
    const table = rows(session, "standings");
    expect(table[0]).toEqual(["Rank", "Name", "EP", "GP", "PR"]);
    expect(table[1]).toEqual(["1", "Kev", "300", "100", "3.00"]);
    expect(table[2]?.[1]).toBe("Ray");
  });

  it("keeps a tab or line break inside a value from spilling into other cells", () => {
    session = start();
    const table = rows(session, "loot");
    expect(table).toHaveLength(2);
    expect(table[1]).toEqual(["2026-10-01 20:00:00", "Molten Core", "Tab bed Sword", "Kev", "50", "Magmadar"]);
  });

  it("lists attendance and raids newest first", () => {
    session = start();
    expect(rows(session, "attendance").slice(1)).toEqual([
      ["Onyxia", "2026-10-08 19:00:00", "Kev", "LATE"],
      ["Molten Core", "2026-10-01 19:00:00", "Kev", "PRESENT"],
      ["Molten Core", "2026-10-01 19:00:00", "Ray", "ABSENT"],
    ]);
    expect(rows(session, "raids").slice(1)).toEqual([
      ["Onyxia", "2026-10-08 19:00:00", "", "1", "0", "0"],
      ["Molten Core", "2026-10-01 19:00:00", "2026-10-01 22:00:00", "1", "2", "1"],
    ]);
  });

  it("keeps formula-like names and titles literal without changing numeric values", () => {
    session = start();
    session.run(`
      GuildedDB.raids[1].title = '=1+1'
      GuildedDB.loot[1].item = '  @SUM(A1)'
      GuildedDB.loot[1].player = '+CMD()'
      GuildedDB.loot[1].boss = '-0xFF'
      GuildedDB.loot[1].cost = -25
      GuildedDB.standings.players.Kev.ep = -300
    `);
    expect(rows(session, "loot")[1]).toEqual(["2026-10-01 20:00:00", "'=1+1", "'  @SUM(A1)", "'+CMD()", "-25", "'-0xFF"]);
    expect(rows(session, "attendance").find(row => row[2] === "Kev" && row[0] !== "Onyxia")?.[0]).toBe("'=1+1");
    expect(rows(session, "raids")[2]?.[0]).toBe("'=1+1");
    expect(rows(session, "standings").find(row => row[1] === "Kev")?.slice(2)).toEqual(["-300", "100", "-3.00"]);
    expect(session.run('return GuildedDB.raids[1].title')).toBe('=1+1');
  });

  it("opens the copy box from the command, and explains an unknown table", () => {
    session = start();
    session.run(`
      BOX_TEXT = nil
      local create = CreateFrame
      CreateFrame = function(...)
        local f = create(...)
        f.SetText = function(self, text) BOX_TEXT = text; return self end
        return f
      end
      SlashCmdList["GUILDED"]("sheet standings")
      CHAT_LOG = {}
      SlashCmdList["GUILDED"]("sheet nonsense")
    `);
    expect(String(session.run(`return BOX_TEXT`))).toMatch(/^Rank\tName\tEP\tGP\tPR\n1\tKev/);
    expect(String(session.run(`return table.concat(CHAT_LOG, "\\n")`))).toContain("standings|loot|attendance|raids|dungeons");
  });
});
