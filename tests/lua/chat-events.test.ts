import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Track E1: guild events (join, leave, kick, promote, demote, online, offline) in the Guilded tab.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const ENGLISH = String.raw`
  ERR_GUILD_JOIN_S = "%s has joined the guild."
  ERR_GUILD_LEAVE_S = "%s has left the guild."
  ERR_GUILD_REMOVE_SS = "%s has been kicked out of the guild by %s."
  ERR_GUILD_PROMOTE_SSS = "%s has promoted %s to %s."
  ERR_GUILD_DEMOTE_SSS = "%s has demoted %s to %s."
  ERR_FRIEND_ONLINE_SS = "|Hplayer:%s|h[%s]|h has come online."
  ERR_FRIEND_OFFLINE_S = "%s has gone offline."
`;
// The French client uses positional arguments for the promotion strings.
const FRENCH = String.raw`
  ERR_GUILD_JOIN_S = "%s a rejoint la guilde."
  ERR_GUILD_LEAVE_S = "%s a quitt\195\169 la guilde."
  ERR_GUILD_REMOVE_SS = "%2$s a renvoy\195\169 %1$s de la guilde."
  ERR_GUILD_PROMOTE_SSS = "%1$s a promu %2$s au rang de %3$s."
  ERR_GUILD_DEMOTE_SSS = "%1$s a r\195\169trograd\195\169 %2$s au rang de %3$s."
  ERR_FRIEND_ONLINE_SS = "|Hplayer:%s|h[%s]|h s'est connect\195\169."
  ERR_FRIEND_OFFLINE_S = "%s s'est d\195\169connect\195\169."
`;

function withEvents(globals = ENGLISH): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    LINES = { main = {}, tab = {} }
    DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) LINES.main[#LINES.main + 1] = text end }
    NUM_CHAT_WINDOWS = 3
    ChatFrame1 = DEFAULT_CHAT_FRAME
    ChatFrame3 = { AddMessage = function(_, text) LINES.tab[#LINES.tab + 1] = text end }
    GetChatWindowInfo = function(i) return ({ "General", "Log", "Guilded" })[i] end
    RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92 }, WARRIOR = { r = 0.78, g = 0.61, b = 0.43 } }
    ROSTER = { { "Ann-Realm", "Guild Master", 0, 60, "Mage", "", "", "", true, 0, "MAGE" },
               { "Bob-Realm", "Member", 3, 55, "Warrior", "", "", "", false, 0, "WARRIOR" } }
    GetNumGuildMembers = function() return #ROSTER end
    GetGuildRosterInfo = function(i) return table.unpack(ROSTER[i]) end
    SETTINGS = { chatTab = true, officerRanks = { [0] = true, [1] = true } }
    NS = { getSettings = function() return SETTINGS end, commandHandlers = {}, commandHelp = {},
           normalizeName = function(n) return (string.gsub(n, "%-.*$", "")) end }
  ` + globals);
  session.load("Modules/ChatTab.lua");
  return session;
}

const say = (s: LuaSession, text: string) => s.run(`fire_event("CHAT_MSG_SYSTEM", ${JSON.stringify(text)}); return #LINES.tab`);
const last = (s: LuaSession) => s.run(`return LINES.tab[#LINES.tab] or ""`);

describe("guild events in the Guilded tab", () => {
  it("recognises every event from the English client strings", () => {
    const s = withEvents();
    const parse = (text: string) => s.run(`local p = NS.chatTab.parse(${JSON.stringify(text)}); if not p then return "nil" end return p.kind .. "|" .. tostring(p.name) .. "|" .. tostring(p.by) .. "|" .. tostring(p.rank)`);
    expect(parse("Ann has joined the guild.")).toBe("join|Ann|nil|nil");
    expect(parse("Ann has left the guild.")).toBe("leave|Ann|nil|nil");
    expect(parse("Bob has been kicked out of the guild by Ann.")).toBe("kick|Bob|Ann|nil");
    expect(parse("Ann has promoted Bob to Officer.")).toBe("promote|Bob|Ann|Officer");
    expect(parse("Ann has demoted Bob to Initiate.")).toBe("demote|Bob|Ann|Initiate");
    expect(parse("|Hplayer:Ann|h[Ann]|h has come online.")).toBe("online|Ann|nil|nil");
    expect(parse("Ann has gone offline.")).toBe("offline|Ann|nil|nil");
    expect(parse("Ann says hello")).toBe("nil");
  });

  it("recognises the French client strings, including positional arguments", () => {
    const s = withEvents(FRENCH);
    const parse = (text: string) => s.run(`local p = NS.chatTab.parse(${JSON.stringify(text)}); if not p then return "nil" end return p.kind .. "|" .. tostring(p.name) .. "|" .. tostring(p.by) .. "|" .. tostring(p.rank)`);
    expect(parse("Ann a rejoint la guilde.")).toBe("join|Ann|nil|nil");
    expect(parse("Ann a quitt\u00e9 la guilde.")).toBe("leave|Ann|nil|nil");
    expect(parse("Ann a promu Bob au rang de Officier.")).toBe("promote|Bob|Ann|Officier");
    expect(parse("Ann a r\u00e9trograd\u00e9 Bob au rang de Recrue.")).toBe("demote|Bob|Ann|Recrue");
    // %2$s a renvoy\u00e9 %1$s: the kicked player is argument 1.
    expect(parse("Ann a renvoy\u00e9 Bob de la guilde.")).toBe("kick|Bob|Ann|nil");
    expect(parse("|Hplayer:Ann|h[Ann]|h s'est connect\u00e9.")).toBe("online|Ann|nil|nil");
    expect(parse("Ann s'est d\u00e9connect\u00e9.")).toBe("offline|Ann|nil|nil");
  });

  it("writes a coloured, time-stamped line into the tab only, never into General", () => {
    const s = withEvents();
    expect(say(s, "Ann has joined the guild.")).toBe("1");
    const line = last(s);
    expect(line).toContain("|cff40c7ebAnn|r");   // Mage colour
    expect(line).toContain("joined the guild");
    expect(line).toMatch(/^\|cff9d9d9d\d\d:\d\d\|r/); // timestamp first
    expect(s.run(`return #LINES.main`)).toBe("0");
    expect(say(s, "Ann has promoted Bob to Officer.")).toBe("2");
    expect(last(s)).toContain("promoted to Officer by");
    expect(say(s, "Bob has been kicked out of the guild by Ann.")).toBe("3");
    expect(last(s)).toContain("removed from the guild by");
  });

  it("shows online and offline for guild members only", () => {
    const s = withEvents();
    expect(say(s, "|Hplayer:Ann|h[Ann]|h has come online.")).toBe("1");
    expect(say(s, "Bob has gone offline.")).toBe("2");
    expect(say(s, "|Hplayer:Stranger|h[Stranger]|h has come online.")).toBe("2"); // a friend, not a guildmate
    expect(say(s, "Stranger has gone offline.")).toBe("2");
  });

  it("per-type toggles hide an event type; officers-only limits online and offline to officer ranks", () => {
    const s = withEvents();
    s.run(`NS.chatTab.setEventEnabled("join", false)`);
    expect(say(s, "Ann has joined the guild.")).toBe("0");
    expect(say(s, "Ann has left the guild.")).toBe("1");
    s.run(`SETTINGS.chatEventsOfficersOnly = true`);
    expect(say(s, "|Hplayer:Ann|h[Ann]|h has come online.")).toBe("2");   // Ann is rank 0
    expect(say(s, "Bob has gone offline.")).toBe("2");                    // Bob is rank 3
    expect(s.run(`return tostring(NS.chatTab.eventEnabled("join"))`)).toBe("false");
    expect(s.run(`return tostring(NS.chatTab.eventEnabled("leave"))`)).toBe("true");
  });

  it("does nothing while the chat tab is off", () => {
    const s = withEvents();
    s.run(`SETTINGS.chatTab = false`);
    expect(say(s, "Ann has left the guild.")).toBe("0");
    expect(s.run(`return #LINES.main`)).toBe("0");
  });
});

describe("the Guilded tab is on by default (8.5), without Guilded opening chat windows (9 Nov 2026)", () => {
  const FRESH = String.raw`
    OPENED = 0
    FCF_OpenNewWindow = function() OPENED = OPENED + 1; return ChatFrame3 end
    C_Timer = { After = function(_, fn) fn() end }
    SETTINGS.chatTab = nil
  `;

  it("turns it on at the first login and uses a window the player named Guilded", () => {
    const s = withEvents();
    s.run(FRESH + `GetChatWindowInfo = function(i) return ({ "General", "Log", "Guilded" })[i] end`);
    s.run(`fire_event("PLAYER_LOGIN")`);
    expect(s.run(`return tostring(SETTINGS.chatTab) .. ":" .. OPENED`)).toBe("true:0");
    expect(s.run(`return LINES.tab[1]`)).toContain("This tab shows Guilded's messages");
    expect(say(s, "Ann has joined the guild.")).toBe("2");
  });

  it("without such a window: on, one line on how to make it, and no window opened", () => {
    const s = withEvents();
    s.run(FRESH + `GetChatWindowInfo = function(i) return ({ "General", "Log" })[i] end`);
    s.run(`fire_event("PLAYER_LOGIN")`);
    expect(s.run(`return tostring(SETTINGS.chatTab) .. ":" .. OPENED`)).toBe("true:0");
    expect(s.run(`return LINES.main[#LINES.main]`)).toContain("name it Guilded");
    const before = s.run(`return #LINES.main`);
    s.run(`fire_event("PLAYER_LOGIN")`);                       // said once, not at every login
    expect(s.run(`return #LINES.main`)).toBe(before);
  });

  it("leaves a saved choice alone, on or off", () => {
    const off = withEvents();
    off.run(FRESH);
    off.run(`SETTINGS.chatTab = false; fire_event("PLAYER_LOGIN")`);
    expect(off.run(`return OPENED`)).toBe("0");
    expect(off.run(`return tostring(SETTINGS.chatTab)`)).toBe("false");
  });
});
