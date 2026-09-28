import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 4.6 loot in game: off-spec answers and their price share, the core's minimum EP, officer votes
// on the loot council, SR+ (a reserve bonus that grows each week), the GP suggestion from the
// item level, and the drops list with its trade reminders.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const words = (line: string) => `local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end`;

function withCouncil(officer = true): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    local T = 0
    function GetTime() T = T + 10; return T end
    MOCK_UNITS = { raid1 = { name = "Ann" }, raid2 = { name = "Bob" }, raid3 = { name = "Cy" }, raid4 = { name = "Boss" } }
    MOCK_GROUP_SIZE = 4
    function IsInRaid() return true end
    function IsInGroup() return true end
    C_ChatInfo = {
      SendChatMessage = function(text, ch, _, target) SENT[#SENT + 1] = "CHAT:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      SendAddonMessage = function(_, text, ch, target) SENT[#SENT + 1] = "ADDON:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    RAN = {}
    PR = { Ann = 5, Bob = 9, Cy = 1 }
    EP = { Ann = 500, Bob = 40, Cy = 300 }
    NS = {
      L = function(t) return t end,
      isOfficer = function() return ${officer} end,
      isOfficerName = function(n) return n == "Boss" or n == "Me" end,
      isSecret = function() return false end,
      normalizeName = function(n) return n and (string.gsub(n, "%-.*", "")) or nil end,
      playerName = function() return "Me" end,
      groupMembers = function() return { "Me", "Ann", "Bob", "Cy", "Boss" } end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getActiveRaid = function() return nil end,
      getStanding = function(n) return PR[n] and { pr = PR[n], ep = EP[n] or 0, gp = 0 } or nil end,
      runCommand = function(line) RAN[#RAN + 1] = line end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Council.lua");
  return session;
}
const council = (s: LuaSession, line: string) => s.run(`${words(line)}; NS.commandHandlers["council"](a)`);
const order = (s: LuaSession) => s.run(`local t = {}; for _, r in ipairs(NS.council.ranked()) do t[#t + 1] = r.name .. ":" .. r.tier end; return table.concat(t, ",")`);

describe("priority loot: off-spec and minimum EP", () => {
  it("takes Off-spec answers, after everyone who wants it for their main spec", () => {
    const s = withCouncil();
    council(s, "priority 200 Sword");
    s.run(`NS.council.addResponse("Bob", "os")`);
    s.run(`NS.council.addResponse("Ann", "want")`);
    s.run(`NS.council.addResponse("Cy", "want")`);
    expect(order(s)).toBe("Ann:want,Cy:want,Bob:os");
  });

  it("an off-spec win costs the core's share of the price (50% unless the core says otherwise)", () => {
    const s = withCouncil();
    council(s, "priority 200 Sword");
    s.run(`NS.council.addResponse("Bob", "os")`);
    council(s, "close");
    expect(s.run("return RAN[1] .. '|' .. RAN[2]")).toBe("loot Bob Sword 100|gp Bob 100 Priority: Sword");
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toContain("for 100 GP. (off-spec)");

    s.run(`RAN = {}; NS.loot = { offspecPercent = function() return 25 end, minEp = function() return 0 end }`);
    council(s, "priority 200 Axe");
    s.run(`NS.council.addResponse("Bob", "os")`);
    council(s, "close");
    expect(s.run("return RAN[1]")).toBe("loot Bob Axe 50");
  });

  it("a price the officer names still wins over the off-spec share", () => {
    const s = withCouncil();
    council(s, "priority 200 Sword 60");
    s.run(`NS.council.addResponse("Bob", "os")`);
    s.run(`NS.council.current.open = false`);
    council(s, "award Bob 180");
    expect(s.run("return RAN[1]")).toBe("loot Bob Sword 180");
  });

  it("players below the core's minimum EP rank after everyone who has it", () => {
    const s = withCouncil();
    s.run(`NS.loot = { minEp = function() return 100 end, offspecPercent = function() return 50 end,
      epFor = function(n) return EP[n] or 0 end, prFor = function(n) return PR[n] or 0 end }`);
    council(s, "priority 200 Sword");
    s.run(`NS.council.addResponse("Bob", "want")`); // PR 9 but only 40 EP
    s.run(`NS.council.addResponse("Ann", "want")`);
    s.run(`NS.council.addResponse("Cy", "want")`);
    expect(order(s)).toBe("Ann:want,Cy:want,Bob:want");
    expect(s.run("return NS.council.statusText()")).toContain("below min EP");
  });
});

describe("loot council votes", () => {
  it("sends the answers to the other officers in the group when it closes, and counts their votes", () => {
    const s = withCouncil();
    council(s, "start Sword");
    s.run(`NS.council.addResponse("Ann", "bis")`);
    s.run(`NS.council.addResponse("Cy", "up")`);
    council(s, "close");
    const list = s.run(`for _, m in ipairs(SENT) do if m:find("LIST|", 1, true) then return m end end`);
    expect(list).toMatch(/^ADDON:WHISPER:Boss:LIST\|\d+\|Sword\|Ann:bis;Cy:up$/);
    const id = s.run("return NS.council.current.id");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "VOTE|${id}|Cy", "WHISPER", "Boss")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "VOTE|${id}|Cy", "WHISPER", "Rando")`); // not an officer
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "VOTE|${id}|Nobody", "WHISPER", "Boss")`); // did not answer
    expect(s.run(`local r = NS.council.ranked(); return r[2].name .. ":" .. r[2].votes`)).toBe("Cy:1");
    expect(s.run("return NS.council.statusText()")).toContain("1 vote");
  });

  it("an officer gets the list from the host and votes by number", () => {
    const s = withCouncil();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "LIST|77|Sword|Ann:bis;Cy:up", "WHISPER", "Boss")`);
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toContain("1. Ann (BiS), 2. Cy (Upgrade)");
    council(s, "vote 2");
    expect(s.run("return SENT[#SENT]")).toBe("ADDON:WHISPER:Boss:VOTE|77|Cy");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "AWARD|77|Cy", "RAID", "Boss")`);
    expect(s.run("return tostring(NS.council.voting)")).toBe("nil");
  });

  it("ignores a list from someone who is not an officer", () => {
    const s = withCouncil();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "LIST|77|Sword|Ann:bis", "WHISPER", "Ann")`);
    expect(s.run("return tostring(NS.council.voting)")).toBe("nil");
  });
});

const SWORD = "|cffa335ee|Hitem:19364::::::::60|h[Ashkandi]|h|r";

function withReserve(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    local T = 0
    function GetTime() T = T + 10; return T end
    function IsInGuild() return true end
    function IsInRaid() return false end
    function IsInGroup() return false end
    C_ChatInfo = {
      SendChatMessage = function(text, ch) SENT[#SENT + 1] = text end,
      SendAddonMessage = function() end,
      RegisterAddonMessagePrefix = function() return true end
    }
    RAN = {}
    GAMES = {}
    BONUS = {}
    DB = {}
    NS = {
      L = function(t) return t end,
      isOfficer = function() return true end,
      isOfficerName = function(n) return n == "Boss" end,
      isSecret = function() return false end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      playerName = function() return "Boss" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getDb = function() return DB end,
      runCommand = function(line) RAN[#RAN + 1] = line end,
      games = { setBonus = function(name, n) BONUS[name] = n end },
      commandHandlers = { games = function(args) GAMES[#GAMES + 1] = table.concat(args, " ") end },
      commandHelp = {}
    }
  `);
  session.load("Modules/Reserve.lua");
  return session;
}
const reserve = (s: LuaSession, line: string) => s.run(`${words(line)}; NS.commandHandlers["reserve"](a)`);

describe("SR+ (soft reserve bonus)", () => {
  it("adds 10 for every week the same item was reserved and not won, and uses it in the roll", () => {
    const s = withReserve();
    reserve(s, "open 1");
    reserve(s, `add Ann ${SWORD}`);
    reserve(s, `add Bob ${SWORD}`);
    reserve(s, "clear");                  // week 1 over: neither got it
    reserve(s, "open 1");                 // opening right after a clear counts nothing again
    expect(s.run("return NS.reserve.plusFor('Ann', 19364)")).toBe("10");
    reserve(s, `add Ann ${SWORD}`);       // Ann reserves it again, Bob does not
    reserve(s, `add Cy ${SWORD}`);
    reserve(s, "open 1");                 // week 2 over
    expect(s.run("return NS.reserve.plusFor('Ann', 19364) .. ':' .. NS.reserve.plusFor('Bob', 19364) .. ':' .. NS.reserve.plusFor('Cy', 19364)")).toBe("20:0:10");
    reserve(s, `add Ann ${SWORD}`);
    reserve(s, `add Cy ${SWORD}`);
    reserve(s, `roll ${SWORD}`);
    expect(s.run("return BONUS.Ann .. ':' .. BONUS.Cy")).toBe("20:10");
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toContain("Ann (+20), Cy (+10)");
    expect(s.run("return NS.reserve.statusText()")).toContain("Ashkandi (SR+20)");
  });

  it("winning the item uses the bonus up", () => {
    const s = withReserve();
    reserve(s, "open 1");
    reserve(s, `add Ann ${SWORD}`);
    reserve(s, "clear");
    reserve(s, "open 1");
    reserve(s, `add Ann ${SWORD}`);
    reserve(s, `award Ann ${SWORD}`);
    expect(s.run("return NS.reserve.plusFor('Ann', 19364)")).toBe("0");
  });
});

describe("the SR+ bonus in a high roll", () => {
  it("adds to the roll and says so", () => {
    session = newLuaSession();
    const s = session;
    s.run(String.raw`
      function IsInGroup() return true end
      C_ChatInfo = { SendChatMessage = function() end }
      NS = {
        isSecret = function() return false end,
        normalizeName = function(n) return n and (string.gsub(n, "%-.*", "")) or nil end,
        playerName = function() return "Host" end,
        parseRoll = function(text)
          local name, value, low, high = string.match(text, "^(%S+) rolls (%d+) %((%d+)%-(%d+)%)$")
          return name, tonumber(value), tonumber(low), tonumber(high)
        end,
        message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
        commandHandlers = {}, commandHelp = {}
      }
    `);
    s.load("Modules/Games.lua");
    const game = (line: string) => s.run(`${words(line)}; NS.commandHandlers["games"](a)`);
    game("highroll");
    game("add Ann");
    game("add Bob");
    expect(s.run("return tostring(NS.games.setBonus('Ann', 20))")).toBe("true");
    expect(s.run("return tostring(NS.games.setBonus('Zed', 20))")).toBe("false");
    game("roll");
    s.run(`fire_event("CHAT_MSG_SYSTEM", "Bob rolls 90 (1-100)")`);
    s.run(`fire_event("CHAT_MSG_SYSTEM", "Ann rolls 75 (1-100)")`);
    expect(s.chat().join("\n")).toContain("High Roll: Ann wins with 95 (75 + 20 SR+)!");
  });
});

function withLoot(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    CALLS = {}
    SETTINGS = { activeCore = "c1" }
    DB = {}
    SERVER = 1000000
    function GetServerTime() return SERVER end
    function IsInRaid() return true end
    ITEMS = { [19019] = { "Thunderfury", 5, 80, "INVTYPE_WEAPON" }, [16921] = { "Halo", 4, 66, "INVTYPE_HEAD" }, [1] = { "Junk", 2, 60, "INVTYPE_HEAD" } }
    function GetItemInfo(link)
      local id = tonumber(string.match(link or "", "item:(%d+)"))
      local i = ITEMS[id]
      if not i then return nil end
      return i[1], link, i[2], i[3], 60, "Armor", "Plate", 1, i[4]
    end
    RULES = { default = "EPGP", values = {}, cores = {
      { id = "c1", name = "Tuesday MC", mode = "PRIORITY", pool = false, values = { ["halo"] = 80 }, players = {}, offspec = 40, minEp = 50 }
    } }
    NS = {
      L = function(t) return t end,
      isOfficer = function() return true end,
      isSecret = function() return false end,
      normalizeName = function(n) return n and (string.gsub(n, "%-.*", "")) or nil end,
      playerName = function() return "Me" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getSettings = function() return SETTINGS end,
      getLootRules = function() return RULES end,
      getDb = function() return DB end,
      getStanding = function() return nil end,
      council = { startPriority = function(item, price) CALLS[#CALLS + 1] = "priority:" .. item .. "|" .. price end },
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Loot.lua");
  return session;
}

const HALO = "|cffa335ee|Hitem:16921::::::::60|h[Halo]|h|r";
const TF = "|cffff8000|Hitem:19019::::::::60|h[Thunderfury]|h|r";
const JUNK = "|cff1eff00|Hitem:1::::::::60|h[Junk]|h|r";

describe("Loot.lua 4.6", () => {
  it("reads the core's off-spec share and minimum EP", () => {
    const s = withLoot();
    expect(s.run("return NS.loot.offspecPercent() .. ':' .. NS.loot.minEp()")).toBe("40:50");
    s.run("SETTINGS.activeCore = nil");
    expect(s.run("return NS.loot.offspecPercent() .. ':' .. NS.loot.minEp()")).toBe("50:0");
  });

  it("suggests a GP price from the item level and slot", () => {
    const s = withLoot();
    const gp = (level: number, slot: string, quality = 4) => Number(s.run(`return NS.loot.suggestGp(${level}, "${slot}", ${quality})`));
    expect(gp(66, "INVTYPE_CHEST")).toBeGreaterThan(50);
    expect(gp(66, "INVTYPE_CHEST")).toBeLessThan(100);
    expect(gp(78, "INVTYPE_CHEST")).toBe(100);
    expect(gp(104, "INVTYPE_CHEST")).toBe(200); // doubles every 26 item levels
    expect(gp(66, "INVTYPE_FINGER")).toBeLessThan(gp(66, "INVTYPE_CHEST"));
    expect(gp(66, "INVTYPE_2HWEAPON")).toBeGreaterThan(gp(66, "INVTYPE_CHEST"));
    expect(gp(66, "INVTYPE_CHEST", 3)).toBeLessThan(gp(66, "INVTYPE_CHEST"));
    expect(gp(700, "INVTYPE_2HWEAPON")).toBe(5000);
    expect(s.run(`return tostring(NS.loot.suggestGp(nil, "INVTYPE_CHEST"))`)).toBe("nil");
  });

  it("prefills the price box with the suggestion", () => {
    const s = withLoot();
    s.run(`StaticPopupDialogs = {}
      BOX = { SetText = function(self, t) self.text = t end, HighlightText = function() end }
      StaticPopup_Show = function() return { editBox = BOX } end`);
    s.run(`NS.loot.askPrice("${TF.replace(/\|/g, "\\|")}", 30)`.replace(/\\\|/g, "|"));
    expect(Number(s.run("return BOX.text"))).toBeGreaterThan(0);
  });

  it("notes epic drops from personal or group loot, not lesser ones, and only once", () => {
    const s = withLoot();
    s.run(`fire_event("ENCOUNTER_LOOT_RECEIVED", 610, 16921, "${HALO}", 1, "Ann-Realm", "PRIEST")`);
    s.run(`fire_event("ENCOUNTER_LOOT_RECEIVED", 610, 16921, "${HALO}", 1, "Ann-Realm", "PRIEST")`);
    s.run(`fire_event("ENCOUNTER_LOOT_RECEIVED", 610, 1, "${JUNK}", 1, "Bob", "MAGE")`);
    expect(s.run("local d = NS.loot.drops(); return #d .. ':' .. d[1].holder")).toBe("1:Ann");
  });

  it("notes the epic items on an opened corpse", () => {
    const s = withLoot();
    s.run(`
      LOOT = { "${TF}", "${JUNK}" }
      function GetNumLootItems() return #LOOT end
      function GetLootSlotLink(i) return LOOT[i] end
      function GetLootSourceInfo(i) return "Creature-0-1" end
      fire_event("LOOT_OPENED")
      fire_event("LOOT_OPENED")
    `);
    expect(s.run("local d = NS.loot.drops(); return #d .. ':' .. tostring(d[1].holder)")).toBe("1:nil");
  });

  it("starts a noted drop the way the core decides loot, and reminds the holder to trade it", () => {
    const s = withLoot();
    s.run(`fire_event("ENCOUNTER_LOOT_RECEIVED", 610, 16921, "${HALO}", 1, "Ann", "PRIEST")`);
    s.run(`${words("1")}; NS.commandHandlers["drops"](a)`);
    expect(s.run("return CALLS[1]")).toBe(`priority:${HALO}|80`);
    expect(s.run("return #NS.loot.drops()")).toBe("0");
    s.run(`NS.loot.noteAward("Halo", "Bob")`);
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toContain("Ann holds");
    expect(s.run("return NS.loot.tradesText()")).toBe("Trade: Ann -> Bob: Halo (2:00 left)");
    s.run("SERVER = SERVER + 3 * 3600");
    expect(s.run("return NS.loot.tradesText()")).toBe("");
  });

  it("no trade when the holder is the winner", () => {
    const s = withLoot();
    s.run(`fire_event("ENCOUNTER_LOOT_RECEIVED", 610, 16921, "${HALO}", 1, "Ann", "PRIEST")`);
    s.run(`NS.loot.noteAward("${HALO}", "Ann")`);
    expect(s.run("return NS.loot.tradesText()")).toBe("");
  });
});
