import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const SWORD = "|cffa335ee|Hitem:19019::::::::60|h[Thunderfury, Blessed Blade]|h|r";

// Loads Loot.lua with the rules the companion would have written, and records what it starts.
function withLoot(officer = true): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    CALLS = {}
    SETTINGS = {}
    STANDINGS = { Ann = { pr = 5 }, Bob = { pr = 9 } }
    RULES = {
      default = "EPGP", minimumBid = 15, values = { ["guild ring"] = 40 },
      cores = {
        { name = "Tuesday MC", mode = "PRIORITY", pool = false, reserves = 2,
          values = { ["thunderfury blessed blade"] = 250, ["#12345"] = 90 }, players = {} },
        { name = "Pool Raid", mode = "COUNCIL", pool = true, reserves = 1, values = {}, players = { Ann = { pr = 1.5 }, Bob = { pr = 0.5 } } },
        { name = "Res Raid", mode = "RESERVE", pool = false, reserves = 3, values = {}, players = {} },
        { name = "Bid Raid", mode = "EPGP", pool = false, reserves = 1, values = {}, players = {} },
      }
    }
    local function record(name) return function(args) CALLS[#CALLS + 1] = name .. ":" .. table.concat(args, "|") end end
    NS = {
      L = function(t) return t end,
      isOfficer = function() return ${officer} end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getSettings = function() return SETTINGS end,
      getLootRules = function() return RULES end,
      getStanding = function(name) return STANDINGS[name] end,
      reserve = {
        itemId = function(text) return text and tonumber(string.match(text, "item:(%d+)")) end,
        holders = function(id) if id == 19019 then return { "Ann", "Bob" } end return {} end
      },
      council = { startPriority = function(item, price, seconds) CALLS[#CALLS + 1] = "priority:" .. item .. "|" .. price .. "|" .. seconds end },
      commandHandlers = { council = record("council"), bid = record("bid"), reserve = record("reserve"), games = record("games") },
      commandHelp = {}
    }
  `);
  session.load("Modules/Loot.lua");
  return session;
}

const cmd = (s: LuaSession, name: string, line: string) =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers[${JSON.stringify(name)}](a)`);
const last = (s: LuaSession) => s.run("return CHAT_LOG[#CHAT_LOG]");
const calls = (s: LuaSession) => s.run(`return table.concat(CALLS, "\\n")`);
const pick = (s: LuaSession, core: string) => cmd(s, "core", core);

describe("Loot.lua: which system", () => {
  it("uses the guild's system when no core is known", () => {
    const s = withLoot();
    expect(s.run("return NS.loot.mode()")).toBe("EPGP");
    cmd(s, "core", "");
    expect(s.run("return CHAT_LOG[#CHAT_LOG - 1]")).toContain("Loot system: GP bids - the guild's default.");
    expect(last(s)).toContain("Raid cores: Tuesday MC (EPGP priority (set prices))");
  });

  it("follows the core the next raid was made for", () => {
    const s = withLoot();
    s.run(`GuildedNextRaid = { core = "Tuesday MC" }`);
    expect(s.run("return NS.loot.mode()")).toBe("PRIORITY");
    expect(s.run("return NS.loot.coreName()")).toBe("Tuesday MC");
  });

  it("an officer can pick a core by hand (any case), and go back to automatic", () => {
    const s = withLoot();
    s.run(`GuildedNextRaid = { core = "Tuesday MC" }`);
    pick(s, "res raid");
    expect(s.run("return NS.loot.mode()")).toBe("RESERVE");
    expect(s.run("return SETTINGS.activeCore")).toBe("Res Raid");
    pick(s, "auto");
    expect(s.run("return NS.loot.mode()")).toBe("PRIORITY");
    pick(s, "Nowhere");
    expect(last(s)).toBe('No raid core called "Nowhere" is known.');
  });

  it("members cannot change the core or the system", () => {
    const s = withLoot(false);
    pick(s, "Res Raid");
    expect(s.run("return tostring(SETTINGS.activeCore)")).toBe("nil");
    cmd(s, "drop", "mode COUNCIL");
    expect(s.run("return tostring(SETTINGS.lootMode)")).toBe("nil");
  });

  it("the system can be overridden for one night", () => {
    const s = withLoot();
    s.run(`GuildedNextRaid = { core = "Tuesday MC" }`);
    cmd(s, "drop", "mode council");
    expect(s.run("return NS.loot.mode()")).toBe("COUNCIL");
    expect(last(s)).toContain("chosen by you");
    cmd(s, "drop", "mode auto");
    expect(s.run("return NS.loot.mode()")).toBe("PRIORITY");
    cmd(s, "drop", "mode nonsense");
    expect(last(s)).toContain("/guilded drop mode");
  });

  it("says when the rules have not arrived", () => {
    const s = withLoot();
    s.run(`RULES = nil`);
    cmd(s, "core", "");
    expect(last(s)).toContain("No rules from Discord yet");
  });

  it("reserves per player and PR come from the core", () => {
    const s = withLoot();
    pick(s, "Res Raid");
    expect(s.run("return NS.loot.reserveLimit()")).toBe("3");
    expect(s.run("return NS.loot.prFor('Bob')")).toBe("9"); // the guild pool
    pick(s, "Pool Raid");
    expect(s.run("return NS.loot.prFor('Bob')")).toBe("0.5"); // this core's own pool
    expect(s.run("return NS.loot.prFor('Nobody')")).toBe("0");
  });
});

describe("Loot.lua: item prices", () => {
  it("finds a price by name (from a link or plain) or by id, in the core first, then the guild list", () => {
    const s = withLoot();
    pick(s, "Tuesday MC");
    expect(s.run(`return NS.loot.priceOf(${JSON.stringify(SWORD)})`)).toBe("250");
    expect(s.run(`return NS.loot.priceOf("Thunderfury, Blessed Blade")`)).toBe("250");
    expect(s.run(`return NS.loot.priceOf("|Hitem:12345::|h[Something Else]|h")`)).toBe("90");
    expect(s.run(`return NS.loot.priceOf("12345")`)).toBe("90");
    expect(s.run(`return NS.loot.priceOf("Guild Ring")`)).toBe("40");
    expect(s.run(`return tostring(NS.loot.priceOf("Unknown Thing"))`)).toBe("nil");
  });
});

describe("Loot.lua: /guilded drop", () => {
  it("only officers start items", () => {
    const s = withLoot(false);
    cmd(s, "drop", "Sword");
    expect(calls(s)).toBe("");
  });

  it("GP bids: opens bidding at the guild's minimum bid", () => {
    const s = withLoot();
    pick(s, "Bid Raid");
    s.run(`NS.commandHandlers.drop({ ${JSON.stringify(SWORD)}, "20" })`);
    expect(calls(s)).toBe(`bid:start|15|${SWORD}|20`);
  });

  it("loot council: opens the council", () => {
    const s = withLoot();
    pick(s, "Pool Raid");
    s.run(`NS.commandHandlers.drop({ "Big Sword" })`);
    expect(calls(s)).toBe("council:start|Big Sword|60");
  });

  it("priority: starts it at the item's set price", () => {
    const s = withLoot();
    pick(s, "Tuesday MC");
    s.run(`NS.commandHandlers.drop({ ${JSON.stringify(SWORD)} })`);
    expect(calls(s)).toBe(`priority:${SWORD}|250|45`);
    s.run("CALLS = {}");
    s.run(`NS.commandHandlers.drop({ ${JSON.stringify(SWORD)}, "90" })`);
    expect(calls(s)).toBe(`priority:${SWORD}|250|90`);
  });

  it("priority: does not guess a price for an item nobody priced", () => {
    const s = withLoot();
    pick(s, "Tuesday MC");
    s.run(`NS.commandHandlers.drop({ "Mystery Item" })`);
    expect(calls(s)).toBe("");
    expect(last(s)).toContain("No GP price is set for Mystery Item in Tuesday MC");
  });

  it("soft reserves: rolls between the reservers, or starts a free roll when nobody reserved it", () => {
    const s = withLoot();
    pick(s, "Res Raid");
    s.run(`NS.commandHandlers.drop({ ${JSON.stringify(SWORD)} })`);
    expect(calls(s)).toBe(`reserve:roll|${SWORD}`);
    s.run("CALLS = {}");
    s.run(`NS.commandHandlers.drop({ "|Hitem:777::|h[Other]|h" })`);
    expect(calls(s)).toBe("games:highroll");
    expect(last(s)).toContain("Nobody reserved");
    s.run("CALLS = {}");
    s.run(`NS.commandHandlers.drop({ "Plain Name" })`);
    expect(calls(s)).toBe("");
    expect(last(s)).toContain("Shift-click the item");
  });

  it("says so when the part it needs is switched off", () => {
    const s = withLoot();
    pick(s, "Bid Raid");
    s.run(`NS.moduleActive = function() return false end`);
    s.run(`NS.commandHandlers.drop({ "Sword" })`);
    expect(calls(s)).toBe("");
    expect(last(s)).toContain("GP bidding is off");
  });
});

describe("Loot.lua: core roster against the group (several cores per player)", () => {
  const withRoster = () => {
    const s = withLoot(false);
    s.run(`
      RULES.cores[1].roster = {
        { name = "Jaina", member = "Kev", role = "TANK", spot = "main", backup = false },
        { name = "Anduin", member = "Kev", role = "HEALER", spot = "main", backup = true },
        { name = "Uther", member = "Uth", role = "HEALER", spot = "main", backup = false },
        { name = "Rex", member = "Rex", role = "DPS", spot = "bench", backup = false },
        { name = "Newb", member = "Newb", role = "DPS", spot = "trial", backup = false },
      }
      NS.groupMembers = function() return { "Anduin", "Pug", "Newb" } end
    `);
    return s;
  };

  it("sees a player on a backup character, the missing core players, the bench and fill-ins", () => {
    const s = withRoster();
    s.run(`CHECK = NS.loot.rosterCheck(RULES.cores[1])`);
    expect(s.run(`return CHECK.present[1].name .. ":" .. tostring(CHECK.present[1].backup)`)).toBe("Anduin:true");
    expect(s.run(`return CHECK.present[2].name`)).toBe("Newb");
    expect(s.run(`return #CHECK.missing .. ":" .. CHECK.missing[1].name`)).toBe("1:Uther");
    expect(s.run(`return #CHECK.bench .. ":" .. CHECK.bench[1].name`)).toBe("1:Rex");
    expect(s.run(`return table.concat(CHECK.fillIns, ",")`)).toBe("Pug");
  });

  it("/guilded core roster works for everyone, not only officers", () => {
    const s = withRoster();
    cmd(s, "core", "Tuesday MC"); // not an officer: cannot pick the core
    expect(last(s)).toBe("Only officers can do that.");
    s.run(`SETTINGS.activeCore = "Tuesday MC"`);
    cmd(s, "core", "roster");
    const log = s.run(`return table.concat(CHAT_LOG, "\\n")`);
    expect(log).toContain("Tuesday MC: 2 core player(s) in the group.");
    expect(log).toContain("Here: Anduin (Healer, backup), Newb (DPS)");
    expect(log).toContain("Missing: Uther (Healer)");
    expect(log).toContain("Bench not here: Rex (DPS)");
    expect(log).toContain("Filling in: Pug");
  });

  it("says when there is no core or no roster yet", () => {
    const s = withLoot();
    cmd(s, "core", "roster");
    expect(last(s)).toContain("No raid core is being run");
    s.run(`SETTINGS.activeCore = "Pool Raid"`);
    cmd(s, "core", "roster");
    expect(last(s)).toContain("Pool Raid has no roster from Discord yet");
  });
});
