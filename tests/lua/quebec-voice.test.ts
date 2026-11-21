import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The addon's Quebec French voice (Locale.lua, last block): hype lines only, mild sacres, a single switch, and nothing
// formal (errors, setup, settings, help) touched.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const SACRES = /tabarn|tabarou|c[âa]lisse|c[âa]line|criss|ostie|osti\b|sacrament|viarge/i;
// Lua escapes (\195\162) decoded so the accents are real characters.
const decode = (text: string) => Buffer.from(text.replace(/\\(\d{1,3})/g, (_, n: string) => String.fromCharCode(Number(n))), "latin1").toString("utf8");
const SOURCE = readFileSync(new URL("../../addon/Guilded/Locale.lua", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const START = SOURCE.indexOf("-- Quebec voice");
const BLOCK = SOURCE.slice(START);
const FORMAL = SOURCE.slice(0, START);

function french() {
  s = newLuaSession();
  s.run(`SETTINGS = { language = "fr" }; NS = {}; NS.getSettings = function() return SETTINGS end`);
  s.load("Locale.lua");
  return s;
}

describe("addon Quebec voice", () => {
  it("has a single switch and a joual-only twin for every swearing line", () => {
    expect(BLOCK.match(/local QUEBEC_SWEARING = (true|false)/g)).toHaveLength(1);
    const lines = BLOCK.split("\n").filter(line => /= Q\(/.test(line));
    expect(lines.length).toBeGreaterThanOrEqual(20);
    for (const line of lines) {
      const parts = /Q\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)/.exec(line);
      expect(parts, line).not.toBeNull();
      expect(decode(parts![2]!), line).not.toMatch(SACRES);
    }
  });

  it("speaks the milestones, the duel card and the call-for-help replies in joual", () => {
    const lua = french();
    expect((lua.run(`return string.format(NS.L("%s reached level %d!"), "Kev", 30)`))).toBe("Câline, Kev a atteint le niveau 30 !");
    expect((lua.run(`return string.format(NS.L("%s has won %d duels!"), "Kev", 10)`))).toMatch(/^Tabarnak, Kev a gagné 10 duels/);
    expect((lua.run(`return NS.L("VICTORY")`))).toBe("GAGNÉ, CRISSE !");
    expect((lua.run(`return NS.L("Rematch? Target %s and choose Duel.")`))).toContain("Cible");
    expect((lua.run(`return string.format(NS.L("%s is on the way."), "Bob")`))).toBe("Tabarnak, Bob s'en vient !");
    expect((lua.run(`return NS.L("On my way")`))).toBe("J'm'en viens !");
  });

  it("keeps English untouched", () => {
    s = newLuaSession();
    s.run(`SETTINGS = { language = "en" }; NS = {}; NS.getSettings = function() return SETTINGS end`);
    s.load("Locale.lua");
    expect(s.run(`return string.format(NS.L("%s reached level %d!"), "Kev", 30)`)).toBe("Kev reached level 30!");
  });

  it("keeps errors, setup, settings and help in formal French: no sacre outside the voice block", () => {
    for (const [index, line] of FORMAL.split("\n").entries()) expect(decode(line), `Locale.lua line ${index + 1}`).not.toMatch(SACRES);
  });

  it("keeps the alert title and the guild-chat call line formal", () => {
    const lua = french();
    expect((lua.run(`return NS.L("CALL FOR HELP: %s")`))).not.toMatch(SACRES);
    expect((lua.run(`return NS.L("[Guilded] Help! %s is under attack in %s")`))).not.toMatch(SACRES);
  });
});
