import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The duel rating in Modules/Duels.lua against the shared vectors (tests/fixtures/duel-rating-vectors.json, the same file the bot's
// tests/duel-rating.test.ts runs): the Lua and the TypeScript must agree within the stated tolerance.
interface VectorDuel { winner: string; loser: string; winnerLevel: number | null; loserLevel: number | null; at: string }
interface VectorPlayer { rating: number; score: number; rated: number; games: number; wins: number; losses: number; opponents: number; ranked: boolean }
interface VectorChange { winner: string; loser: string; winnerDelta: number; loserDelta: number; rated: boolean }
interface VectorCase { name: string; duels: VectorDuel[]; expect: { players: Record<string, VectorPlayer>; changes: VectorChange[] } }
const vectors = JSON.parse(readFileSync(new URL("../fixtures/duel-rating-vectors.json", import.meta.url), "utf8")) as {
  tolerance: number; cases: VectorCase[]; seasons: { at: string; id: string; from: string; to: string; rated: boolean }[];
};

let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup() {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; SETTINGS = {}; CLOCK = 1800000000
    function GetServerTime() return CLOCK end
    function GetTime() return 100 end
    function GetLocale() return "enUS" end
    function UnitName() return "Aldric" end
    function IsInGuild() return true end
    function GetNumGuildMembers() return 0 end
    NS = { getDb = function() return DB end, getSettings = function() return SETTINGS end, util = {}, commandHandlers = {}, commandHelp = {},
      message = function() end, isSecret = function() return false end, isGuildMember = function() return true end }`);
  s.load("Locale.lua");
  s.load("Modules/Duels.lua");
  return s;
}
const lit = (value: string | number | null) => (value === null ? "nil" : typeof value === "number" ? String(value) : JSON.stringify(value));
const seconds = (iso: string) => Date.parse(iso) / 1000;

function rateInLua(duels: VectorDuel[]) {
  const rows = duels.map(d => `{ winner = ${lit(d.winner)}, loser = ${lit(d.loser)}, wlv = ${lit(d.winnerLevel)}, llv = ${lit(d.loserLevel)}, at = ${seconds(d.at)} }`);
  const out = s!.run(`
    local res = NS.duels.rate({ ${rows.join(", ")} })
    local lines = {}
    for _, p in pairs(res.players) do
      lines[#lines + 1] = table.concat({ "P", p.name, p.rating, p.score, p.rated, p.games, p.wins, p.losses, p.opponents, tostring(p.ranked) }, "|")
    end
    for _, c in ipairs(res.changes) do
      lines[#lines + 1] = table.concat({ "C", c.winner, c.loser, c.winnerDelta, c.loserDelta, tostring(c.rated) }, "|")
    end
    return table.concat(lines, "\\n")`);
  const players = new Map<string, string[]>();
  const changes: string[][] = [];
  for (const line of String(out).split("\n")) {
    const parts = line.split("|");
    if (parts[0] === "P") players.set(parts[1]!, parts.slice(2)); else changes.push(parts.slice(1));
  }
  return { players, changes };
}

describe("duel rating shared vectors", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      setup();
      const got = rateInLua(c.duels);
      for (const [name, want] of Object.entries(c.expect.players)) {
        const g = got.players.get(name);
        expect(g, name).toBeDefined();
        expect(Math.abs(Number(g![0]) - want.rating)).toBeLessThan(vectors.tolerance);
        expect(Math.abs(Number(g![1]) - want.score)).toBeLessThan(vectors.tolerance);
        expect(g!.slice(2, 7).map(Number)).toEqual([want.rated, want.games, want.wins, want.losses, want.opponents]);
        expect(g![7]).toBe(String(want.ranked));
      }
      expect(got.changes).toHaveLength(c.expect.changes.length);
      // The Lua list is in the rated order, the same order the bot's `changes` use.
      c.expect.changes.forEach((want, i) => {
        const g = got.changes[i]!;
        expect(g[0]).toBe(want.winner);
        expect(g[1]).toBe(want.loser);
        expect(Math.abs(Number(g[2]) - want.winnerDelta)).toBeLessThan(vectors.tolerance);
        expect(Math.abs(Number(g[3]) - want.loserDelta)).toBeLessThan(vectors.tolerance);
        expect(g[4]).toBe(String(want.rated));
      });
    });
  }

  it("finds the season of a time as the vectors say", () => {
    setup();
    for (const row of vectors.seasons) {
      const id = s!.run(`return tostring((NS.duels.seasonOf(${seconds(row.at)})))`);
      const from = s!.run(`local _, f = NS.duels.seasonOf(${seconds(row.at)}); return tostring(f)`);
      const to = s!.run(`local _, _, t = NS.duels.seasonOf(${seconds(row.at)}); return tostring(t)`);
      if (!row.rated) { expect(id).toBe("nil"); continue; }
      expect(id).toBe(row.id);
      expect(Number(from)).toBe(seconds(row.from));
      expect(Number(to)).toBe(seconds(row.to));
    }
  });

  it("runs the months after the first season through to the end of the year", () => {
    setup();
    expect(s!.run(`return (NS.duels.seasonOf(${seconds("2027-02-28T23:59:59Z")}))`)).toBe("2027-02");
    expect(s!.run(`return (NS.duels.seasonOf(${seconds("2027-03-01T00:00:00Z")}))`)).toBe("2027-03");
    expect(s!.run(`return (NS.duels.seasonOf(${seconds("2027-12-31T23:59:59Z")}))`)).toBe("2027-12");
    expect(s!.run(`return (NS.duels.seasonOf(${seconds("2028-01-01T00:00:00Z")}))`)).toBe("2028-01");
    expect(s!.run(`return (NS.duels.seasonOf(${seconds("2028-02-29T12:00:00Z")}))`)).toBe("2028-02");
  });

  it("lists the seasons from the current one back to the first", () => {
    setup();
    s!.run(`CLOCK = ${seconds("2027-02-10T00:00:00Z")}`);
    expect(s!.run(`return table.concat(NS.duels.seasons(), ",")`)).toBe("2027-02,2027-01,2026-11");
    s!.run(`CLOCK = ${seconds("2026-11-20T00:00:00Z")}`);
    expect(s!.run(`return table.concat(NS.duels.seasons(), ",")`)).toBe("2026-11");
    s!.run(`CLOCK = ${seconds("2026-11-12T23:00:00Z")}`);
    expect(s!.run(`return #NS.duels.seasons()`)).toBe("0");
  });

  it("rounds a change for display", () => {
    setup();
    expect(s!.run(`return NS.duels.changeText(12.4) .. "," .. NS.duels.changeText(-11.6) .. "," .. NS.duels.changeText(0.2) .. "," .. NS.duels.changeText(-0.4)`)).toBe("+12,-12,0,0");
  });
});

describe("duel hash chain", () => {
  const bitMock = `bit = {
    band = function(a, b) return a & b end, bxor = function(a, b, c) return a ~ b ~ (c or 0) end, bnot = function(a) return ~a end,
    rshift = function(a, n) return (a & 0xffffffff) >> n end, bor = function(a, b) return a | b end, lshift = function(a, n) return (a << n) & 0xffffffff end
  }`;
  it("hashes like SHA-256 for short and long texts (first 16 hex)", () => {
    setup();
    s!.run(bitMock);
    for (const text of ["", "abc", "0000000000000000|0123456789abcdef|1|Aldric|Realm|Brenna|Realm|1794528100|knockout", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(130)]) {
      const want = createHash("sha256").update(text).digest("hex").slice(0, 16);
      expect(s!.run(`return NS.duels.sha16(${JSON.stringify(text)})`), text.slice(0, 20)).toBe(want);
    }
  });
});
