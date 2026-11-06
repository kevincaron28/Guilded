import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Loads the real Core.lua and Modules/Attunements.lua against a mocked game.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(): LuaSession {
  session = newLuaSession();
  session.run(`
    GuildedDB = nil
    NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    DONE = {}
    C_QuestLog = { IsQuestFlaggedCompleted = function(id) return DONE[id] == true end }
    GetFactionInfoByID = function() return "Argent Dawn", "", 4 end
  `);
  session.load("Core.lua");
  session.load("Compat.lua");
  session.load("Modules/Attunements.lua");
  session.run(`fire_event("PLAYER_LOGIN"); SENT = {}`);
  return session;
}

const mine = (s: LuaSession) => s.run(`local keys = {}; for k, v in pairs(GuildedDB.attunements.Kev or {}) do if v.completed then keys[#keys + 1] = k end end; table.sort(keys); return table.concat(keys, ",")`);

const track = (s: LuaSession) => s.run(`
  SlashCmdList["GUILDED"]('attune track "Hyjal Summit" quest 9001 9002')
  SlashCmdList["GUILDED"]('attune track "Barrow Deeps" quest 9100')
  SlashCmdList["GUILDED"]("attune track \\"Onyxia's Lair\\" rep 529 6")`);

describe("attunements track themselves", () => {
  it("nothing is built in: the raids differ on this server, so it tracks only what you choose", () => {
    const s = loggedIn();
    s.run(`DONE[7848] = true; NS.attunements.scan(true)`);
    expect(mine(s)).toBe("");
    s.run(`SlashCmdList["GUILDED"]("attune tracked")`);
    expect(s.chat().join("\n")).toContain("No attunement is tracked yet");
  });

  it("records every tracked attunement you finished and tells the guild, once", () => {
    const s = loggedIn();
    track(s);
    s.run(`DONE[9002] = true; DONE[9100] = true; NS.attunements.scan(true)`);
    expect(mine(s)).toBe("Barrow Deeps,Hyjal Summit");
    expect(s.run(`local out = {}; for _, m in ipairs(SENT) do if m.text:find("^ATTUNEMENT") then out[#out + 1] = m.target .. ":" .. m.text end end; table.sort(out); return table.concat(out, "|")`))
      .toBe("GUILD:ATTUNEMENT|Kev|Barrow Deeps|true|GUILD:ATTUNEMENT|Kev|Hyjal Summit|true");
    s.run(`SENT = {}; NS.attunements.scan(true)`);
    expect(s.run(`return #SENT`)).toBe("0");
  });

  it("counts a reputation standing, and never clears what was recorded", () => {
    const s = loggedIn();
    track(s);
    s.run(`NS.attunements.scan(true)`);
    expect(mine(s)).toBe("");
    s.run(`GetFactionInfoByID = function() return "Argent Dawn", "", 6 end; NS.attunements.scan(true)`);
    expect(mine(s)).toBe("Onyxia's Lair");
    s.run(`GetFactionInfoByID = function() return "Argent Dawn", "", 4 end; NS.attunements.scan(true)`);
    expect(mine(s)).toBe("Onyxia's Lair");
  });

  it("does nothing when the game cannot say", () => {
    const s = loggedIn();
    track(s);
    s.run(`C_QuestLog = nil; GetFactionInfoByID = nil; NS.attunements.scan(true)`);
    expect(mine(s)).toBe("");
  });

  it("looks again by itself when a quest is handed in", () => {
    const s = loggedIn();
    s.run(`C_Timer = { After = function(_, fn) fn() end }`);
    track(s);
    s.run(`C_Timer = { After = function(_, fn) fn() end }; DONE[9100] = true; fire_event("QUEST_TURNED_IN", 9100)`);
    expect(mine(s)).toBe("Barrow Deeps");
  });

  it("track, list and untrack from the chat, and /guilded attune auto lists what it found", () => {
    const s = loggedIn();
    track(s);
    s.run(`SlashCmdList["GUILDED"]("attune tracked")`);
    expect(s.chat().join("\n")).toContain("Tracked attunements: Hyjal Summit, Barrow Deeps, Onyxia's Lair.");
    s.run(`SlashCmdList["GUILDED"]('attune untrack "Barrow Deeps"'); DONE[9001] = true; SlashCmdList["GUILDED"]("attune auto")`);
    const text = s.chat().join("\n");
    expect(text).toContain("Attunements found: Hyjal Summit.");
    expect(text).toContain("Newly recorded and shared with the guild: Hyjal Summit.");
    s.run(`CHAT_LOG = {}; SlashCmdList["GUILDED"]("attune track Nothing")`);
    expect(s.chat().join("\n")).toContain("attune track");
  });

  it("keeps what a guildmate reports about themselves, and nothing else", () => {
    const s = loggedIn();
    const take = (text: string, channel: string, sender: string) => s.run(`return tostring(NS.attunements.handleMessage("${text}", "${channel}", "${sender}"))`);
    expect(take("ATTUNEMENT|Amy|hyjal summit|true", "GUILD", "Amy-Realm")).toBe("true");
    expect(s.run(`return tostring(GuildedDB.attunements.Amy["Hyjal Summit"].completed)`)).toBe("true");
    expect(take("ATTUNEMENT|Amy|Molten Core|true", "GUILD", "Bob-Realm")).toBe("false");
    expect(take("ATTUNEMENT|Amy|Molten Core|true", "WHISPER", "Amy-Realm")).toBe("false");
  });

  it("a Forever player is their full name; a realm suffix is dropped and a lone first name resolves when only one is known", () => {
    const s = loggedIn();
    expect(s.run(`return NS.normalizeName("  ray  ") .. "|" .. NS.normalizeName("Ray pissjug") .. "|" .. NS.normalizeName("ray pissjug-Realm") .. "|" .. NS.normalizeName("ray")`)).toBe("Ray|Ray Pissjug|Ray Pissjug|Ray Pissjug");
    s.run(`MOCK_UNITS.player.name = "Ray pissjug"`);
    expect(s.run(`return NS.playerName()`)).toBe("Ray Pissjug");
    // A second Ray makes the lone first name ambiguous again.
    expect(s.run(`return NS.normalizeName("Ray Sunfire") .. "|" .. NS.normalizeName("Ray")`)).toBe("Ray Sunfire|Ray");
  });
});
