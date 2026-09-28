import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const SWORD = "|cffa335ee|Hitem:19364::::::::60|h[Ashkandi]|h|r";
const RING = "|cffa335ee|Hitem:17063::::::::60|h[Band of Accuria]|h|r";

// Loads Modules/Reserve.lua. `me` is who is playing; `officer` says if they are one.
// Officers in the fake guild are Boss and Kay.
function withReserve(me: string, officer: boolean): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    -- The clock moves on, so Util.lua's message pacing lets every message out at once.
    local T = 0
    function GetTime() T = T + 10; return T end
    function IsInGuild() return true end
    function IsInRaid() return false end
    function IsInGroup() return false end
    C_ChatInfo = {
      SendChatMessage = function(text, ch, _, target) SENT[#SENT + 1] = "CHAT:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      SendAddonMessage = function(_, text, ch, target) SENT[#SENT + 1] = "ADDON:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    RAN = {}
    GAMES = {}
    DB = {}
    NS = {
      L = function(t) return t end,
      isOfficer = function() return ${officer} end,
      isOfficerName = function(n) return n == "Boss" or n == "Kay" end,
      isSecret = function() return false end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      playerName = function() return "${me}" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getDb = function() return DB end,
      runCommand = function(line) RAN[#RAN + 1] = line end,
      commandHandlers = {
        games = function(args) GAMES[#GAMES + 1] = table.concat(args, " ") end
      },
      commandHelp = {}
    }
  `);
  session.load("Modules/Reserve.lua");
  return session;
}

const cmd = (s: LuaSession, line: string) =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["reserve"](a)`);
const addon = (s: LuaSession, from: string, text: string) =>
  s.run(`fire_event("CHAT_MSG_ADDON", "GuildedRes", ${JSON.stringify(text)}, "GUILD", ${JSON.stringify(from)})`);
const whisper = (s: LuaSession, from: string, text: string) =>
  s.run(`fire_event("CHAT_MSG_WHISPER", ${JSON.stringify(text)}, ${JSON.stringify(from)})`);
const holders = (s: LuaSession, id: number) => s.run(`return table.concat(NS.reserve.holders(${id}), ",")`);
const sent = (s: LuaSession, pattern: string) =>
  s.run(`local n = 0; for _, m in ipairs(SENT) do if m:find(${JSON.stringify(pattern)}) then n = n + 1 end end; return n`);

describe("Reserve.lua keeper side", () => {
  it("only officers open a list", () => {
    const s = withReserve("Ray", false);
    cmd(s, "open 2");
    expect(s.run("return tostring(DB.reserves and DB.reserves.host)")).toBe("nil");
  });

  it("opens with the limit and title, and shares the settings to the guild", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open 2 Onyxia night");
    expect(s.run("return DB.reserves.limit")).toBe("2");
    expect(s.run("return DB.reserves.title")).toBe("Onyxia night");
    expect(s.run("return tostring(DB.reserves.open)")).toBe("true");
    expect(sent(s, "^ADDON:GUILD:nil:STATE|1|2|Onyxia night$")).toBe("1");
  });

  it("takes reserves from addon messages, confirms, and shares the list", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    addon(s, "Ann-Realm", "ADD|19364|Ashkandi");
    addon(s, "Bob", "ADD|19364");
    addon(s, "Bob", "ADD|17063"); // limit 1: replaces Bob's own first reserve
    expect(holders(s, 19364)).toBe("Ann");
    expect(holders(s, 17063)).toBe("Bob");
    expect(sent(s, "^ADDON:WHISPER:Ann%-Realm:ACK|")).toBe("1");
    s.run("NS.reserve.share()");
    expect(s.run("return SENT[#SENT]")).toBe("ADDON:GUILD:nil:L|Ann=19364;Bob=17063");
  });

  it("with two per player, allows two and refuses a third", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open 2");
    addon(s, "Ann", "ADD|1");
    addon(s, "Ann", "ADD|2");
    addon(s, "Ann", "ADD|3");
    expect(holders(s, 1)).toBe("Ann");
    expect(holders(s, 2)).toBe("Ann");
    expect(holders(s, 3)).toBe("");
    expect(sent(s, "^ADDON:WHISPER:Ann:REJECT|You already have 2 reserves")).toBe("1");
  });

  it("refuses changes while locked, and takes them again when reopened", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    cmd(s, "lock");
    addon(s, "Ann", "ADD|1");
    expect(holders(s, 1)).toBe("");
    expect(sent(s, "REJECT|Reserves are locked")).toBe("1");
    cmd(s, "unlock");
    addon(s, "Ann", "ADD|1");
    expect(holders(s, 1)).toBe("Ann");
  });

  it("takes whispers from players without the addon", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    whisper(s, "Pug-Realm", `res ${SWORD}`);
    expect(holders(s, 19364)).toBe("Pug");
    expect(sent(s, "^CHAT:WHISPER:Pug%-Realm:%[Guilded%] Reserved: Ashkandi$")).toBe("1");
    whisper(s, "Pug-Realm", `unres ${SWORD}`);
    expect(holders(s, 19364)).toBe("");
    whisper(s, "Pug-Realm", "hello there"); // ignored
  });

  it("lets the officer add and remove for someone, even after the lock", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    cmd(s, "lock");
    cmd(s, `add Zed ${SWORD}`);
    expect(holders(s, 19364)).toBe("Zed");
    expect(s.run("return tostring(DB.reserves.open)")).toBe("false");
    cmd(s, `remove Zed ${SWORD}`);
    expect(holders(s, 19364)).toBe("");
  });

  it("splits a long list into short messages", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    for (let i = 1; i <= 25; i++) addon(s, `Player${i}`, `ADD|${19000 + i}`);
    s.run("SENT = {}; NS.reserve.share()");
    expect(Number(s.run("return #SENT"))).toBeGreaterThan(3);
    expect(s.run("local longest = 0; for _, m in ipairs(SENT) do if #m > longest then longest = #m end end; return longest <= 255 and 1 or 0")).toBe("1");
  });

  it("shows who reserved an item, and rolls between only them", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    addon(s, "Ann", "ADD|19364|Ashkandi");
    addon(s, "Bob", "ADD|19364");
    addon(s, "Cy", "ADD|17063");
    cmd(s, `who ${SWORD}`);
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toBe("Ashkandi is reserved by: Ann, Bob");
    cmd(s, `roll ${SWORD}`);
    expect(s.run("return table.concat(GAMES, '|')")).toBe("highroll|add Ann|add Bob|roll");
    s.run("GAMES = {}");
    cmd(s, `roll ${RING}`); // one reserver: no roll needed
    expect(s.run("return #GAMES")).toBe("0");
  });

  it("awards through the loot command and uses up that reserve", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    addon(s, "Ann", "ADD|19364");
    cmd(s, `award Ann ${SWORD} 20`);
    expect(s.run("return RAN[1]")).toBe("loot Ann Ashkandi 20");
    expect(s.run("return RAN[2]")).toBe("gp Ann 20 Reserve: Ashkandi");
    expect(holders(s, 19364)).toBe("");
  });

  it("stamps the list on every change, so the newest copy wins in Discord", () => {
    const s = withReserve("Boss", true);
    s.run(`NS.now = function() STAMP = (STAMP or 0) + 1; return "t" .. STAMP end`);
    cmd(s, "open");
    const opened = s.run("return DB.reserves.updatedAt");
    addon(s, "Ann", "ADD|1");
    expect(opened).not.toBe("");
    expect(s.run("return DB.reserves.updatedAt")).not.toBe(opened);
  });

  it("clears the list and tells the guild", () => {
    const s = withReserve("Boss", true);
    cmd(s, "open");
    addon(s, "Ann", "ADD|1");
    cmd(s, "clear");
    expect(s.run("return tostring(DB.reserves.host)")).toBe("nil");
    expect(holders(s, 1)).toBe("");
    expect(sent(s, "^ADDON:GUILD:nil:DONE|")).toBe("1");
  });
});

describe("Reserve.lua member side", () => {
  it("has no list until an officer opens one", () => {
    const s = withReserve("Ann", false);
    cmd(s, `add ${SWORD}`);
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toBe("No reserve list is open. An officer opens one with /guilded reserve open.");
    expect(s.run("return #SENT")).toBe("0");
  });

  it("learns the list from an officer, and ignores anyone else", () => {
    const s = withReserve("Ann", false);
    addon(s, "Rando", "STATE|1|1|Fake");
    expect(s.run("return tostring(DB.reserves and DB.reserves.host)")).toBe("nil");
    addon(s, "Boss", "STATE|1|2|Onyxia");
    addon(s, "Boss", "CLR");
    addon(s, "Boss", "VER|2026-09-20T10:00:00Z|1");
    addon(s, "Boss", "L|Bob=19364,17063;Cy=17063");
    expect(s.run("return DB.reserves.host")).toBe("Boss");
    expect(s.run("return DB.reserves.limit")).toBe("2");
    expect(holders(s, 17063)).toBe("Bob,Cy");
    // A second officer's list is not merged into the keeper's.
    addon(s, "Kay", "L|Zed=1");
    expect(holders(s, 1)).toBe("");
  });

  it("sends a reserve to the keeper and shows the answer", () => {
    const s = withReserve("Ann", false);
    addon(s, "Boss-Realm", "STATE|1|1|");
    cmd(s, SWORD);
    expect(s.run("return SENT[1]")).toBe("ADDON:WHISPER:Boss-Realm:ADD|19364|Ashkandi");
    addon(s, "Boss-Realm", "ACK|Reserved: Ashkandi");
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toBe("Reserved: Ashkandi");
    cmd(s, `remove ${SWORD}`);
    expect(s.run("return SENT[2]")).toBe("ADDON:WHISPER:Boss-Realm:DEL|19364");
  });

  it("asks for a shift-clicked item", () => {
    const s = withReserve("Ann", false);
    addon(s, "Boss", "STATE|1|1|");
    cmd(s, "add Sword");
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toBe("Shift-click the item to reserve it: /guilded reserve <item link>");
  });

  it("shows the list, mine first, and tooltip lines for a reserved item", () => {
    const s = withReserve("Ann", false);
    addon(s, "Boss", "STATE|0|1|Onyxia");
    addon(s, "Boss", "CLR");
    addon(s, "Boss", "VER|2026-09-20T10:00:00Z|1");
    addon(s, "Boss", "L|Ann=19364;Bob=19364");
    const text = s.run("return NS.reserve.statusText()");
    expect(text).toContain("Reserves: locked, 1 per player - Onyxia (Boss)");
    expect(text).toContain("Yours: item 19364");
    expect(s.run("return NS.reserve.tooltipLines(19364)[1]")).toBe("Reserved by Ann, Bob");
    expect(s.run("return #NS.reserve.tooltipLines(1)")).toBe("0");
  });

  it("forgets the list when the keeper clears it", () => {
    const s = withReserve("Ann", false);
    addon(s, "Boss", "STATE|1|1|");
    addon(s, "Boss", "L|Bob=1");
    addon(s, "Boss", "DONE");
    expect(s.run("return tostring(DB.reserves.host)")).toBe("nil");
    expect(holders(s, 1)).toBe("");
  });

  it("does nothing while the module is off", () => {
    const s = withReserve("Ann", false);
    s.run(`NS.moduleActive = function() return false end`);
    addon(s, "Boss", "STATE|1|1|");
    expect(s.run("return tostring(DB.reserves)")).toBe("nil");
  });

  it("keeps the old list until every chunk of a new one has arrived", () => {
    const s = withReserve("Ann", false);
    addon(s, "Boss", "STATE|1|1|Onyxia");
    addon(s, "Boss", "CLR");
    addon(s, "Boss", "VER|2026-09-20T10:00:00Z|1");
    addon(s, "Boss", "L|Bob=19364");
    // A new share whose second chunk never arrives: Bob's reserve stays, nothing is half-replaced.
    addon(s, "Boss", "CLR");
    addon(s, "Boss", "VER|2026-09-21T10:00:00Z|2");
    addon(s, "Boss", "L|Cy=19364");
    expect(holders(s, 19364)).toBe("Bob");
    addon(s, "Boss", "L|Dee=17063");
    expect(holders(s, 19364)).toBe("Cy");
    expect(holders(s, 17063)).toBe("Dee");
  });

  it("the keeper sends the stamp of the list it is sending, not the previous one", () => {
    const s = withReserve("Boss", true);
    s.run(`DB.reserves = { updatedAt = "2020-01-01T00:00:00Z" }; NS.now = function() return "2026-09-22T10:00:00Z" end`);
    cmd(s, "open");
    const stamp = s.run("return DB.reserves.updatedAt");
    expect(stamp).not.toBe("2020-01-01T00:00:00Z");
    expect(sent(s, "VER|" + stamp.replace(/-/g, "%-") + "|0")).toBe("1");
  });

  it("takes the keeper's stamp instead of stamping its own copy", () => {
    const s = withReserve("Ann", false);
    addon(s, "Boss", "STATE|1|1|");
    addon(s, "Boss", "CLR");
    addon(s, "Boss", "VER|2026-09-20T10:00:00Z|1");
    addon(s, "Boss", "L|Bob=19364");
    expect(s.run("return DB.reserves.updatedAt")).toBe("2026-09-20T10:00:00Z");
    addon(s, "Boss", "STATE|0|1|");
    expect(s.run("return DB.reserves.updatedAt")).toBe("2026-09-20T10:00:00Z");
  });
});
