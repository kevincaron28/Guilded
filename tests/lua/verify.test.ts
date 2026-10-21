import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { parseAddonExportText } from "../../companion/lua-export-content.mjs";
import { parseAddonSnapshot } from "../../src/integrations/addon.js";

// /guilded verify: the member pastes one line, every digest of that WoW account repeats the code,
// and an officer's saved data keeps it under the sender's name for the companion. Real Core.lua.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(): LuaSession {
  session = newLuaSession();
  session.run(`GuildedDB = nil; NS = {}; MOCK_UNITS = { player = { name = "Kev" } }`);
  session.load("Core.lua");
  session.load("Compat.lua");
  session.run(`fire_event("PLAYER_LOGIN"); GetInventoryItemLink = function() return nil end`);
  return session;
}
const lastDigest = (s: LuaSession) => s.run(`local text = ""; for _, m in ipairs(SENT or {}) do if string.find(m.text, "^READINESS|") then text = m.text end end; return text`);

describe("/guilded verify", () => {
  it("saves the pasted code, however it was typed, and tells the guild right away", () => {
    const s = loggedIn();
    s.run(`SENT = {}; SlashCmdList["GUILDED"]("verify abcd-efgh")`);
    expect(s.run(`return GuildedDB.verifyCode`)).toBe("ABCDEFGH");
    expect(lastDigest(s)).toContain("|V:ABCDEFGH");
    expect(s.chat().join("\n")).toContain("Nothing else to do, also for your alts");
    // Later digests (alts read the same saved data) keep carrying it.
    s.run(`SENT = {}; SlashCmdList["GUILDED"]("inspect")`);
    expect(lastDigest(s)).toContain("|V:ABCDEFGH");
  });

  it("refuses a mistyped code without forgetting the saved one, and removes it on request", () => {
    const s = loggedIn();
    s.run(`SlashCmdList["GUILDED"]("verify ABCD EFGH")`);
    s.run(`SlashCmdList["GUILDED"]("verify ABCD-EFG")`);
    expect(s.chat().join("\n")).toContain("That code does not look right");
    expect(s.run(`return GuildedDB.verifyCode`)).toBe("ABCDEFGH");
    s.run(`SlashCmdList["GUILDED"]("verify")`);
    expect(s.chat().join("\n")).toContain("Your Discord link code is saved");
    s.run(`SENT = {}; SlashCmdList["GUILDED"]("verify off")`);
    expect(s.run(`return tostring(GuildedDB.verifyCode)`)).toBe("nil");
    expect(lastDigest(s)).not.toContain("|V:");
  });

  it("still lets a player who left the guild remove the code", () => {
    const s = loggedIn();
    s.run(`SlashCmdList["GUILDED"]("verify ABCD-EFGH"); function IsInGuild() return false end`);
    s.run(`SlashCmdList["GUILDED"]("verify KLMN-PQRS")`);
    expect(s.run(`return GuildedDB.verifyCode`)).toBe("ABCDEFGH");
    s.run(`SlashCmdList["GUILDED"]("verify off")`);
    expect(s.run(`return tostring(GuildedDB.verifyCode)`)).toBe("nil");
  });

  it("answers in French for a French player", () => {
    const s = loggedIn();
    s.load("Locale.lua");
    s.run(`GuildedDB.settings.language = "fr"; SlashCmdList["GUILDED"]("verify")`);
    expect(s.chat().join("\n")).toContain("Sur Discord, utilisez /character pair");
  });
});

describe("an officer's addon hearing the code", () => {
  it("keeps a valid code under the name the game gave for the sender, never a malformed one", () => {
    const s = loggedIn();
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100||I:MAGE,Human,58,Fire|V:ABCDEFGH|F:NOFOOD", "GUILD", "Amy-Realm")`);
    expect(s.run(`local p = GuildedDB.peerRoster["Amy"]; return p.verify .. "|" .. p.identity.class .. "|" .. p.professions .. "|" .. p.flags`)).toBe("ABCDEFGH|MAGE||NOFOOD");
    // I and O are never issued; a longer value is not a code.
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Bob|READY|0|100|Mining:300|V:ABCDEFGI", "GUILD", "Bob-Realm")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Cid|READY|0|100|V:ABCDEFGHJ", "GUILD", "Cid-Realm")`);
    expect(s.run(`return tostring(GuildedDB.peerRoster["Bob"].verify) .. "|" .. tostring(GuildedDB.peerRoster["Cid"].verify)`)).toBe("nil|nil");
    // Someone sending a digest under another player's name is ignored as before.
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Dee|READY|0|100||I:MAGE,Human,58,|V:ABCDEFGH", "GUILD", "Mallory-Realm")`);
    expect(s.run(`return tostring(GuildedDB.peerRoster["Dee"])`)).toBe("nil");
    // A later digest without the code (the player turned it off) drops it.
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100||I:MAGE,Human,58,Fire", "GUILD", "Amy-Realm")`);
    expect(s.run(`return tostring(GuildedDB.peerRoster["Amy"].verify)`)).toBe("nil");
  });

  it("is sent on by the companion export, so the bot can link Amy", () => {
    const lua = `GuildedDB = { epgp = {}, exports = { ["2026-10-21T20:00:00Z"] = { exportedAt = "2026-10-21T20:00:00Z" } },
      peerRoster = {
        ["Amy"] = { status = "READY", professions = "", identity = { class = "MAGE", race = "Human", level = 58, spec = "Fire" }, verify = "ABCDEFGH" },
        ["Bob"] = { status = "READY", professions = "", identity = { class = "ROGUE", race = "Gnome", level = 30, spec = "" }, verify = "abc" }
      } }`;
    const snapshot = parseAddonSnapshot(parseAddonExportText(lua, "Forever"));
    expect(snapshot.characters.map((row) => [row.name, row.verify])).toEqual([["Amy", "ABCDEFGH"], ["Bob", undefined]]);
  });
});
