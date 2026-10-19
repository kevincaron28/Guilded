import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { check, expectedCopy, SHARED, tocFiles } from "../../scripts/build-dungeons-addon.mjs";

// Guilded Dungeons (7.0): the standalone addon, loaded from its own .toc order.
let s: LuaSession;
afterEach(() => s?.close());

function load(withGuilded: boolean) {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil
    C_AddOns = { IsAddOnLoaded = function(name) return ${withGuilded ? "name == \"Guilded\"" : "false"} end }`);
  for (const file of tocFiles()) {
    const source = readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8");
    s.run(`loadaddon("GuildedDungeons", [=====[${source}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = {id=389, type="party", name="Ragefire Chasm", difficultyId=1}
    NS.compat.instance = function() return INSTANCE end
    NS.compat.isDungeonFinalBoss = function(_, id) return id == 9000 end`);
}

function playRun() {
  s.run(`fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    STAMP = STAMP + 900
    fire_event("ENCOUNTER_END", 9000, "Bazzalan", 1, 5, 1)`);
}

describe("Guilded Dungeons without Guilded", () => {
  it("records a whole run in its own SavedVariables", () => {
    load(false);
    playRun();
    expect(s.run("local n=0; for _ in pairs(GuildedDungeonsDB.dungeon.runs) do n=n+1 end; return tostring(n)")).toBe("1");
    expect(s.run("local _, run = next(GuildedDungeonsDB.dungeon.runs); return run.state .. ':' .. run.completedBy .. ':' .. run.name")).toBe("COMPLETED:final boss:Ragefire Chasm");
    expect(s.run("return tostring(GuildedDB)")).toBe("nil");
    expect(s.run("return GuildedDungeonsDB.character.name .. '-' .. GuildedDungeonsDB.character.realm .. ':' .. GuildedDungeonsDB.character.class")).toBe("Tester-TestRealm:WARRIOR");
  });

  it("answers its own slash command", () => {
    load(false);
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("status")`);
    expect(s.chat().join("\n")).toContain("[Guilded Dungeons] No dungeon run in progress");
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("nonsense")`);
    expect(s.chat().at(-1)).toContain("/gdungeons status");
  });
});

describe("Guilded Dungeons next to Guilded", () => {
  it("stays quiet so Guilded alone counts the run", () => {
    load(true);
    playRun();
    expect(s.run("return tostring(GuildedDungeonsDB.dungeon)")).toBe("nil");
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("status")`);
    expect(s.chat().join("\n")).toContain("Guilded is installed");
    expect(s.run("return tostring(SENT == nil)")).toBe("true");
  });
});

describe("one source of truth", () => {
  it("ships exact copies of Guilded's dungeon files, in load order", () => {
    expect(() => check()).not.toThrow();
    expect(tocFiles()).toEqual(["Shim.lua", "Shared/Util.lua", "Shared/Compat.lua", "Shared/Locale.lua", "Shared/DungeonRoutes.lua", "Shared/Dungeon.lua", "Shared/RunResults.lua", "Shared/Scores.lua", "Accepted.lua", "Main.lua"]);
    for (const file of SHARED) expect(expectedCopy(file)).toContain(readFileSync(new URL(`../../addon/Guilded/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n").slice(0, 200));
  });
});
