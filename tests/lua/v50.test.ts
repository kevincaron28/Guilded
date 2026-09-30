import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 5.0 in game: GP deduction, game rules in chat.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(): LuaSession {
  session = newLuaSession();
  session.run(`GuildedDB = nil; SLASH = SlashCmdList; NS = {}; MOCK_UNITS = { player = { name = "Kev" } }`);
  session.load("Core.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

describe("deduct GP", () => {
  it("takes GP back as an ADJUSTMENT the bot imports, never below zero", () => {
    const s = loggedIn();
    s.run(`SlashCmdList["GUILDED"]("gp Ann 30 Sword")`);
    s.run(`SlashCmdList["GUILDED"]("gpdeduct Ann 10 Charged twice")`);
    const account = () => s.run(`local a = GuildedDB.epgp.Ann; local e = a.ledger[#a.ledger]; return a.gp .. "|" .. e.type .. "|" .. e.gpAmount .. "|" .. e.epAmount .. "|" .. e.reason`);
    expect(account()).toBe("20|ADJUSTMENT|-10|0|Charged twice");

    s.run(`SlashCmdList["GUILDED"]("gpdeduct Ann 50 Returned")`);
    expect(account()).toBe("0|ADJUSTMENT|-20|0|Returned");

    s.run(`SlashCmdList["GUILDED"]("gpdeduct Ann 5 Again")`);
    expect(s.chat().join("\n")).toContain("Ann has no GP to deduct.");
    expect(s.run(`return #GuildedDB.epgp.Ann.ledger`)).toBe("3");
  });
});

function withGames(grouped: boolean): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    function IsInGroup() return ${grouped} end
    function IsInRaid() return false end
    C_Timer = { After = function(_, fn) fn() end }
    SENT_CHAT = {}
    C_ChatInfo = { SendChatMessage = function(text, channel) SENT_CHAT[#SENT_CHAT + 1] = channel .. ":" .. text end }
    NS = {
      isSecret = function() return false end,
      normalizeName = function(n) return n end,
      playerName = function() return "Host" end,
      parseRoll = function() return nil end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Games.lua");
  return session;
}
const game = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["games"](a)`);
const sent = (s: LuaSession) => s.run(`return table.concat(SENT_CHAT, "\\n")`);

describe("games: explain the rules in chat", () => {
  it("posts each game's rules in party chat, with the running game's roll size", () => {
    const s = withGames(true);
    game(s, "explain deathroll");
    expect(sent(s)).toContain("PARTY:[Guilded] How Deathroll works");
    expect(sent(s)).toContain("/roll 100");
    expect(sent(s)).toContain("Last one left wins.");

    s.run(`SENT_CHAT = {}`);
    game(s, "highroll 500");
    s.run(`SENT_CHAT = {}`);
    game(s, "explain");
    expect(sent(s)).toContain("How High Roll works");
    expect(sent(s)).toContain("/roll 500");
  });

  it("uses /say when you are not grouped, and asks which game when none is named or running", () => {
    const s = withGames(false);
    game(s, "explain duel");
    expect(sent(s)).toContain("SAY:[Guilded] How a deathroll duel works");
    game(s, "explain");
    expect(s.chat().join("\n")).toContain("Which game?");
  });

  it("every rule line fits one chat message", () => {
    const s = withGames(true);
    expect(s.run(`local n = 0; for _, lines in pairs(NS.games.RULES) do for _, l in ipairs(lines) do n = math.max(n, #string.format(l, 1000000)) end end; return n`)).toSatisfy((n: string) => Number(n) <= 230);
  });
});

function withMap(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    SETTINGS = {}
    MY = { map = 1429, x = 0.40, y = 0.60 }
    function IsInInstance() return MY.instance or false end
    function CreateVector2D(x, y) return { x = x, y = y, GetXY = function(self) return self.x, self.y end } end
    C_Map = {
      GetBestMapForUnit = function() return MY.map end,
      GetPlayerMapPosition = function() return CreateVector2D(MY.x, MY.y) end,
      -- Elwynn (1429) sits in the middle of its continent (1415) at a quarter of its size.
      GetWorldPosFromMapPos = function(mapId, pos)
        if mapId == 1429 then return 0, CreateVector2D(1500 + pos.x * 1000, 1500 + pos.y * 1000) end
        if mapId == 1415 then return 0, CreateVector2D(pos.x * 4000, pos.y * 4000) end
        return nil
      end,
      GetMapPosFromWorldPos = function(_, world, toMap)
        if toMap == 1415 then return 1415, CreateVector2D(world.x / 4000, world.y / 4000) end
        if toMap == 1429 then return 1429, CreateVector2D((world.x / 4000 - 0.375) * 4, (world.y / 4000 - 0.375) * 4) end
        return nil
      end,
      GetMapWorldSize = function(mapId) return 4000, 4000 end,
      GetMapInfo = function(mapId) return { name = mapId == 1429 and "Elwynn Forest" or "Eastern Kingdoms" } end
    }
    NS = {
      L = function(t) return t end,
      getSettings = function() return SETTINGS end,
      isSecret = function() return false end,
      normalizeName = function(n) return n and (string.gsub(n, "%-.*", "")) or nil end,
      playerName = function() return "Me" end,
      compat = { inCombat = function() return false end, registerEvent = function(f, e) end },
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
    local t = 100
    function GetTime() return t end
    function ADVANCE(s) t = t + s end
  `);
  session.load("Modules/GuildMap.lua");
  return session;
}
const sentText = (s: LuaSession) => s.run(`local t = {}; for _, m in ipairs(SENT) do t[#t + 1] = m.prefix .. ":" .. m.text end; return table.concat(t, ",")`);

describe("guild map", () => {
  it("sends your position to the guild while you move, less often standing still, and nothing in an instance", () => {
    const s = withMap();
    s.run(`NS.guildMap.tick()`);
    expect(sentText(s)).toBe("GuildedMap:P|1429|4000|6000|WARRIOR|60");
    s.run(`ADVANCE(3); NS.guildMap.tick()`);
    expect(sentText(s).split(",")).toHaveLength(1);
    s.run(`ADVANCE(10); NS.guildMap.tick()`);
    expect(sentText(s).split(",")).toHaveLength(1); // standing still: every 30 s
    s.run(`ADVANCE(20); NS.guildMap.tick()`);
    expect(sentText(s).split(",")).toHaveLength(2);
    s.run(`MY.x = 0.45; ADVANCE(5); NS.guildMap.tick()`);
    expect(sentText(s)).toContain("P|1429|4500|6000");
    s.run(`MY.instance = true; ADVANCE(5); NS.guildMap.tick()`);
    expect(sentText(s).split(",").pop()).toBe("GuildedMap:G");
  });

  it("stops sharing when you turn it off, and says so", () => {
    const s = withMap();
    s.run(`NS.guildMap.tick(); NS.commandHandlers["map"]({ "share", "off" })`);
    expect(sentText(s).split(",").pop()).toBe("GuildedMap:G");
    s.run(`SENT = {}; ADVANCE(60); NS.guildMap.tick()`);
    expect(sentText(s)).toBe("");
    expect(s.chat().join("\n")).toContain("no longer shared");
  });

  it("keeps guildmates' positions, lists them with their zone, and drops them when they leave", () => {
    const s = withMap();
    s.run(`NS.guildMap.receive("P|1429|5000|5000|MAGE|42", "Ann-Realm")`);
    s.run(`NS.guildMap.receive("P|99999|5000|5000|MAGE|42", "Me-Realm")`); // yourself: ignored
    s.run(`NS.guildMap.receive("P|1429|20000|5000|MAGE|42", "Bad")`);       // off the map: ignored
    expect(s.run(`return NS.guildMap.listText()`)).toBe("Ann (42): Elwynn Forest");
    s.run(`NS.guildMap.receive("G", "Ann")`);
    expect(s.run(`return NS.guildMap.listText()`)).toContain("No guildmate");
    s.run(`NS.guildMap.receive("P|1429|5000|5000|MAGE|42", "Ann"); ADVANCE(91)`);
    expect(s.run(`return NS.guildMap.listText()`)).toContain("No guildmate");
  });

  it("places a zone position on its continent map, and guildmates on the minimap around you", () => {
    const s = withMap();
    expect(s.run(`local x, y = NS.guildMap.translate(1429, 0.5, 0.5, 1415); return x .. "," .. y`)).toBe("0.5,0.5");
    expect(s.run(`return tostring(NS.guildMap.translate(1429, 0.5, 0.5, 42))`)).toBe("nil");
    // 0.01 of a 4000-yard map = 40 yards east; the outdoor minimap at zoom 0 is ~233 yards across the radius.
    const east = s.run(`local e, n = NS.guildMap.minimapOffset({ mapId = 1429, x = 0.40, y = 0.60 }, { mapId = 1429, x = 0.41, y = 0.60 }, nil, 0, false); return string.format("%.3f,%.3f", e, n)`);
    expect(east).toBe("0.171,0.000");
    const north = s.run(`local e, n = NS.guildMap.minimapOffset({ mapId = 1429, x = 0.40, y = 0.60 }, { mapId = 1429, x = 0.40, y = 0.59 }, nil, 0, false); return string.format("%.3f,%.3f", e, n)`);
    expect(north).toBe("0.000,0.171");
    // Facing west (90 degrees left) on a rotating minimap: someone to the west is straight up.
    const rotated = s.run(`local e, n = NS.guildMap.minimapOffset({ mapId = 1429, x = 0.40, y = 0.60 }, { mapId = 1429, x = 0.39, y = 0.60 }, math.pi / 2, 0, false); return string.format("%.3f,%.3f", math.abs(e) < 0.0005 and 0 or e, n)`);
    expect(rotated).toBe("0.000,0.171");
    expect(s.run(`return tostring(NS.guildMap.minimapOffset({ mapId = 1429, x = 0.4, y = 0.6 }, { mapId = 1429, x = 0.5, y = 0.6 }, nil, 0, false))`)).toBe("nil");
  });

  it("uses world-coordinate conversion for minimap dots when Classic omits GetMapWorldSize", () => {
    const s = withMap();
    s.run(`C_Map.GetMapWorldSize = nil`);
    const offset = s.run(`local e, n = NS.guildMap.minimapOffset({ mapId = 1429, x = 0.40, y = 0.60 }, { mapId = 1429, x = 0.41, y = 0.60 }, nil, 0, false); return string.format("%.3f,%.3f", e, n)`);
    expect(offset).toBe("0.043,0.000");
  });
  it("renders received positions on both map frames and hides expired dots", () => {
    const s = withMap();
    s.run(`
      local original = CreateFrame
      function CreateFrame(...)
        local f = original(...)
        f.SetPoint = function(self, _, _, _, x, y) self.px, self.py = x, y end
        f.Show = function(self) self.visible = true end
        f.Hide = function(self) self.visible = false end
        f.SetFrameLevel = function(self, n) self.level = n end
        return f
      end
      local canvas = { GetWidth = function() return 1000 end, GetHeight = function() return 500 end, GetFrameLevel = function() return 10 end }
      WorldMapFrame = { IsShown = function() return true end, GetMapID = function() return 1429 end,
        ScrollContainer = { Child = canvas, GetCanvasScale = function() return 1 end } }
      Minimap = { GetWidth = function() return 200 end, GetHeight = function() return 200 end,
        GetZoom = function() return 0 end, GetFrameLevel = function() return 5 end }
      NS.guildMap.receive("P|1429|4100|6000|MAGE|60", "Ann")
      NS.guildMap.refreshWorldMap(); NS.guildMap.refreshMinimap()
    `);
    expect(s.run(`local p=NS.guildMap.worldPins[1]; return p.name..":"..tostring(p.visible)..":"..string.format("%.0f,%.0f",p.px,p.py)`)).toBe("Ann:true:410,-300");
    expect(s.run(`local p=NS.guildMap.minimapPins[1]; return p.name..":"..p.level..":"..string.format("%.1f,%.1f",p.px,p.py)`)).toBe("Ann:25:17.1,0.0");
    s.run(`ADVANCE(91); NS.guildMap.listText(); NS.guildMap.refresh()`);
    expect(s.run(`return tostring(NS.guildMap.worldPins[1].visible)..":"..tostring(NS.guildMap.minimapPins[1].visible)`)).toBe("false:false");
  });

  it("preserves east/north on Classic world axes, including a present but unusable size API", () => {
    const s = withMap();
    s.run(`C_Map.GetMapWorldSize = function() return 0, 0 end
      C_Map.GetWorldPosFromMapPos = function(_, p) return 0, CreateVector2D(9000 - p.y * 2000, 8000 - p.x * 4000) end`);
    expect(s.run(`local e, n = NS.guildMap.minimapOffset({mapId=1429,x=.4,y=.6}, {mapId=1429,x=.41,y=.58}, nil, 0, false); return string.format("%.3f,%.3f",e,n)`)).toBe("0.171,0.171");
  });

  it("projects zone dots onto a parent map when world conversion is unavailable", () => {
    const s = withMap();
    s.run(`C_Map.GetMapPosFromWorldPos = nil
      C_Map.GetMapRectOnMap = function(from, to)
        if from == 1429 and to == 947 then return .2, .4, .3, .7 end
      end`);
    expect(s.run(`local x,y = NS.guildMap.translate(1429,.5,.5,947); return string.format("%.2f,%.2f",x,y)`)).toBe("0.30,0.50");
    expect(s.run(`return tostring(NS.guildMap.translate(1429,.5,.5,99))`)).toBe("nil");
  });

  it("requests fresh positions and rate limits requests and replies, respecting privacy", () => {
    const s = withMap();
    s.run(`NS.guildMap.requestPositions(); NS.guildMap.requestPositions()`);
    expect(sentText(s).split(",").filter((x) => x === "GuildedMap:Q")).toHaveLength(1);
    s.run(`SENT = {}; NS.guildMap.receive("Q", "Ann"); NS.guildMap.receive("Q", "Bob")`);
    expect(sentText(s).split(",")).toHaveLength(1);
    s.run(`SETTINGS.mapShare = false; ADVANCE(11); SENT = {}; NS.guildMap.receive("Q", "Ann")`);
    expect(sentText(s)).toBe("");
  });

  it("keeps the update loop available when enabled after login", () => {
    const s = withMap();
    s.run(`ENABLED = false; NS.moduleActive = function() return ENABLED end
      fire_event("PLAYER_LOGIN"); SENT = {}; ENABLED = true
      for _, f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 1) end end`);
    expect(sentText(s)).toContain("GuildedMap:P|1429|4000|6000");
    expect(s.run(`return NS.guildMap.statusText()`)).toContain("Both players need Guilded");
  });

});

function withStandalone(level = 58): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    SETTINGS = {}
    DB = {}
    function UnitLevel() return ${level} end
    NS = {
      L = function(t) return t end,
      getDb = function() return DB end,
      getSettings = function() return SETTINGS end,
      isSecret = function() return false end,
      isOfficer = function() return true end,
      normalizeName = function(n) return n and (string.gsub(n, "%-.*", "")) or nil end,
      playerName = function() return "Me" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
    RaidWarningFrame = {}
    ChatTypeInfo = { GUILD = { r = 0, g = 1, b = 0 } }
    WARNINGS = {}
    function RaidNotice_AddMessage(_, text) WARNINGS[#WARNINGS + 1] = text end
  `);
  session.load("Modules/Scores.lua");
  session.load("Modules/Groups.lua");
  return session;
}
const run = (players: Record<string, { deaths?: number; presentSec?: number }>, name: string, sec: number, id = "r") =>
  `{ id = "${id}", state = "COMPLETED", name = "${name}", durationSec = ${sec}, players = { ${Object.entries(players).map(([n, p]) => `${n} = { deaths = ${p.deaths ?? 0}${p.presentSec !== undefined ? `, presentSec = ${p.presentSec}` : ""} }`).join(", ")} } }`;

describe("dungeon scores (no bot needed)", () => {
  it("scores each dungeon once with its best run: level x 2, speed against the guild record, deaths", () => {
    const s = withStandalone();
    s.run(`NS.scores.learn(${run({ Me: {}, Ann: { deaths: 2 } }, "Stratholme", 1800, "a")})`);
    s.run(`NS.scores.learn(${run({ Me: { deaths: 1 } }, "Stratholme", 3600, "b")})`); // slower: not the best
    s.run(`NS.scores.learn(${run({ Me: {} }, "Mortemines", 1200, "c")})`);             // French name
    // Stratholme: 60 x 2 = 120 at record speed; Deadmines: 26 x 2 = 52.
    expect(s.run(`local t, n = NS.scores.compute("Me"); return t .. "/" .. n`)).toBe("172/2");
    // Ann: same time (record) but 2 deaths = -10%: 108.
    expect(s.run(`return (NS.scores.compute("Ann"))`)).toBe("108");
    // A faster Stratholme by someone else lowers Me's speed share: 0.75 + 0.25 x 1200/1800.
    s.run(`NS.scores.learn(${run({ Bob: {} }, "Stratholme", 1200, "d")})`);
    expect(s.run(`return (NS.scores.compute("Me"))`)).toBe(String(Math.round(120 * (0.75 + 0.25 * 1200 / 1800)) + 52));
    expect(s.run(`return NS.scores.detailText("Me")`)).toContain("Me: dungeon score");
  });

  it("ignores unfinished runs and players who were only there briefly", () => {
    const s = withStandalone();
    s.run(`NS.scores.learn({ id = "x", state = "ABANDONED", name = "Stratholme", durationSec = 900, players = { Me = {} } })`);
    s.run(`NS.scores.learn(${run({ Me: { presentSec: 1700 }, Late: { presentSec: 60 } }, "Stratholme", 1800)})`);
    expect(s.run(`return tostring(NS.scores.scoreOf("Late"))`)).toBe("nil");
    expect(s.run(`return tostring(NS.scores.scoreOf("Me"))`)).toBe("120");
  });

  it("shares your score with the guild, keeps others' shared scores, and ranks everyone", () => {
    const s = withStandalone();
    s.run(`NS.scores.learn(${run({ Me: {} }, "Scholomance", 1500)})`);
    s.run(`NS.scores.share(true)`);
    expect(s.run(`return SENT[#SENT].prefix .. ":" .. SENT[#SENT].text`)).toBe("GuildedScore:S|120|1");
    s.run(`NS.scores.receive("S|300|4", "Ann-Realm"); NS.scores.receive("S|999999|4", "Cheat")`);
    expect(s.run(`return NS.scores.topText(5)`)).toBe(" 1. Ann            300  (4)\n 2. Me             120  (1)");
  });

  it("adds the score to a player's tooltip", () => {
    const s = withStandalone();
    s.run(`NS.scores.receive("S|300|4", "Ann")`);
    s.run(`LINES = {}; local tip = { GetUnit = function() return "Ann", "mouseover" end, AddLine = function(_, t) LINES[#LINES + 1] = t end }
      function UnitIsPlayer() return true end; function UnitName() return "Ann" end
      NS.scores.decorateUnit(tip)`);
    expect(s.run(`return LINES[1]`)).toBe("Guilded dungeon score: 300 (4 dungeons)");
  });
});

describe("in-game group board (no bot needed)", () => {
  it("reads the kind, level range and roles from a post, and skips times", () => {
    const s = withStandalone();
    const parse = (text: string) => s.run(`local k, a, b, r = NS.groups.parse(${JSON.stringify(text)}); return k .. "|" .. tostring(a) .. "|" .. tostring(b) .. "|" .. table.concat(r, ",")`);
    expect(parse("Stratholme need tank and heal")).toBe("dungeon|52|60|TANK,HEALER");
    expect(parse("pvp WSG premade 60")).toBe("pvp|nil|nil|");
    expect(parse("BRD 55-60 dps")).toBe("dungeon|55|60|DPS");
    expect(parse("leveling duo lvl 34")).toBe("leveling|34|34|");
    expect(parse("Mortemines ce soir 20-22h")).toBe("dungeon|18|26|");
  });

  it("alerts guildmates whose alerts, level and roles fit, and lists open groups until closed", () => {
    const s = withStandalone(58);
    s.run(`NS.groups.setAlerts("dungeon", "healer")`);
    s.run(`NS.groups.receive("O|123|dungeon|52|60|TANK,HEALER|Strat UD need tank and heal", "Ann-Realm")`);
    expect(s.run(`return WARNINGS[1]`)).toContain("Ann is looking for a group: Strat UD need tank and heal (52-60)");
    s.run(`NS.groups.receive("O|124|dungeon|52|60|TANK|Strat need tank", "Bob")`);       // tank only: no alert
    s.run(`NS.groups.receive("O|125|dungeon|20|30||Deadmines", "Cy")`);                  // wrong level: no alert
    s.run(`NS.groups.receive("O|126|pvp||||WSG", "Dee")`);                                 // kind not wanted
    expect(s.run(`return #WARNINGS`)).toBe("1");
    expect(s.run(`return NS.groups.listText()`).split("\n")).toHaveLength(4);
    s.run(`NS.groups.receive("X|123", "Ann")`);
    s.run(`NS.groups.receive("X|124", "Mallory")`); // not the leader: ignored
    expect(s.run(`return NS.groups.listText()`)).not.toContain("Ann");
    expect(s.run(`return NS.groups.listText()`)).toContain("Bob");
  });

  it("posts your group to the guild and closes it", () => {
    const s = withStandalone();
    s.run(`NS.commandHandlers["lfg"]({ "post", "BRD", "55-60", "need", "healer" })`);
    expect(s.run(`return SENT[#SENT].text`)).toMatch(/^O\|\d+\|dungeon\|55\|60\|HEALER\|BRD 55-60 need healer$/);
    expect(s.run(`return NS.groups.listText()`)).toContain("Me: BRD 55-60 need healer");
    s.run(`NS.commandHandlers["lfg"]({ "close" })`);
    expect(s.run(`return SENT[#SENT].text`)).toMatch(/^X\|\d+$/);
    expect(s.run(`return NS.groups.listText()`)).toContain("No open groups");
  });
});

describe("standings without the bot", () => {
  it("an officer shares the ledger on this PC as the guild's standings", () => {
    session = newLuaSession();
    session.run(`GuildedDB = nil; SLASH = SlashCmdList; NS = {}; MOCK_UNITS = { player = { name = "Kev" } }`);
    session.load("Core.lua");
    session.load("Modules/Sync.lua");
    session.run(`fire_event("PLAYER_LOGIN")`);
    session.run(`SlashCmdList["GUILDED"]("award Ann 100 Raid"); SlashCmdList["GUILDED"]("gp Ann 40 Sword"); SENT = {}`);
    session.run(`SlashCmdList["GUILDED"]("standings publish")`);
    expect(session.chat().join("\n")).toContain("Shared the standings of 1 players");
    expect(session.run(`local t = {}; for _, m in ipairs(SENT) do if m.prefix == "GuildedSync" then t[#t + 1] = m.text end end; return table.concat(t, ",")`)).toMatch(/^STAND\|[^|]+\|0\|1\|1\|Ann:100:40$/);
    session.run(`SlashCmdList["GUILDED"]("standings Ann")`);
    expect(session.chat().join("\n")).toContain("Ann: EP 100, GP 40, PR 2.50 (Kev (in game)");
  });
});

function withRaidTools(opts: { leader?: boolean; officer?: boolean } = {}): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    CHAT = {}
    MARKS = {}
    DB = {}
    MOCK_RAID = true
    MOCK_GROUP_SIZE = 4
    MOCK_UNITS = { raid1 = { name = "Me" }, raid2 = { name = "Tanky" }, raid3 = { name = "Offtank" }, raid4 = { name = "Lead" }, target = { name = "Boss" } }
    ROLES = { raid2 = "TANK", raid3 = "TANK" }
    function IsInGroup() return true end
    function UnitGroupRolesAssigned(unit) return ROLES[unit] or "DAMAGER" end
    function UnitIsGroupLeader(unit) if unit == "player" then return ${opts.leader ?? true} end return unit == "raid4" end
    function UnitIsGroupAssistant() return false end
    function SetRaidTarget(unit, index) MARKS[#MARKS + 1] = unit .. "=" .. index end
    C_ChatInfo.SendChatMessage = function(text, channel) CHAT[#CHAT + 1] = channel .. ":" .. text end
    NS = {
      L = function(t) return t end,
      getDb = function() return DB end,
      isSecret = function() return false end,
      isOfficer = function() return ${opts.officer ?? false} end,
      isOfficerName = function() return false end,
      normalizeName = function(n) return n and (string.gsub(n, "%-.*", "")) or nil end,
      playerName = function() return "Me" end,
      compat = { inCombat = function() return IN_COMBAT or false end },
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/RaidTools.lua");
  return session;
}
const rt = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["rt"](a)`);

describe("raid tools", () => {
  it("marks the target, the tanks in kill order, and clears the group", () => {
    const s = withRaidTools();
    rt(s, "mark 8");
    rt(s, "tanks");
    expect(s.run(`return table.concat(MARKS, ",")`)).toBe("target=8,raid2=8,raid3=7");
    expect(s.chat().join("\n")).toContain("Tanks marked: Skull Tanky, Cross Offtank");
    s.run(`MARKS = {}`);
    rt(s, "clear");
    expect(s.run(`return table.concat(MARKS, ",")`)).toBe("raid1=0,raid2=0,raid3=0,raid4=0");
  });

  it("only the leader or an assistant marks", () => {
    const s = withRaidTools({ leader: false });
    rt(s, "mark 8");
    expect(s.run(`return #MARKS`)).toBe("0");
    expect(s.chat().join("\n")).toContain("Only the leader or an assistant can mark.");
  });

  it("saves a boss plan, sends it to the raid's screens, and posts it in raid chat", () => {
    const s = withRaidTools();
    rt(s, "plan save Onyxia = tanks left; healers middle ; dps behind | no");
    expect(s.run(`local p = NS.raidTools.getPlan("onyxia"); return p.boss .. ":" .. table.concat(p.lines, "/")`)).toBe("Onyxia:tanks left/healers middle/dps behind   no");
    rt(s, "plan share Onyxia");
    expect(s.run(`local t = {}; for _, m in ipairs(SENT) do t[#t + 1] = m.text end; return table.concat(t, "\\n")`))
      .toMatch(/^PLAN\|\d+\|0\|3\|Onyxia\nPLAN\|\d+\|1\|3\|tanks left\nPLAN\|\d+\|2\|3\|healers middle\nPLAN\|\d+\|3\|3\|dps behind {3}no$/);
    rt(s, "plan post Onyxia");
    expect(s.run(`return table.concat(CHAT, "\\n")`)).toBe("RAID:[Guilded] Onyxia:\nRAID:1. tanks left\nRAID:2. healers middle\nRAID:3. dps behind   no");
    s.run(`IN_COMBAT = true; SENT = {}`);
    rt(s, "plan share Onyxia");
    expect(s.run(`return #SENT`)).toBe("0");
    expect(s.chat().join("\n")).toContain("before the pull");
  });

  it("shows a plan sent by the raid leader, in any order, and ignores one from a raider", () => {
    const s = withRaidTools({ leader: false });
    s.run(`NS.raidTools.receive("PLAN|5|2|2|dps behind", "Lead-Realm")`);
    s.run(`NS.raidTools.receive("PLAN|5|0|2|Onyxia", "Lead")`);
    expect(s.run(`return tostring(NS.raidTools.shown)`)).toBe("nil");
    s.run(`NS.raidTools.receive("PLAN|5|1|2|tanks left", "Lead")`);
    expect(s.run(`local shown = NS.raidTools.shown; return shown.from .. ":" .. shown.plan.boss .. ":" .. table.concat(shown.plan.lines, "/")`)).toBe("Lead:Onyxia:tanks left/dps behind");
    s.run(`NS.raidTools.shown = nil; NS.raidTools.receive("PLAN|6|0|1|Fake", "Tanky"); NS.raidTools.receive("PLAN|6|1|1|go", "Tanky")`);
    expect(s.run(`return tostring(NS.raidTools.shown)`)).toBe("nil");
  });
});
