import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withAutoInvite(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    DB = { roster = { Old = {} } }
    INVITED = {}
    NOW = 1000
    time = function() return NOW end
    function CanGuildInvite() return true end
    GuildInvite = function(name) INVITED[#INVITED + 1] = name end
    NS = {
      isSecret = function() return false end,
      normalizeName = function(n) return (string.gsub(string.match(n, "^([^%-]+)") or n, "^%l", string.upper)) end,
      isOfficer = function() return true end,
      now = function() return "2026-10-01T20:00:00Z" end,
      getDb = function() return DB end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/AutoInvite.lua");
  return session;
}

const whisper = (s: LuaSession, text: string, who: string) => s.run(`fire_event("CHAT_MSG_WHISPER", ${JSON.stringify(text)}, ${JSON.stringify(who)}); return #INVITED`);
const command = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["autoinvite"](a)`);

// The guild invite is protected on WoW Forever: called from a whisper event (no click) it is refused with
// "Guilded has been blocked from an action only available to the Blizzard UI". Guilded only hands the
// officer the /ginvite line.
const asked = (s: LuaSession) => s.run(`local n = 0; for _, line in ipairs(CHAT_LOG or {}) do if line:find("To invite them", 1, true) then n = n + 1 end end; return n`);

describe("AutoInvite.lua", () => {
  it("is off until an officer turns it on, then gives the /ginvite line for whoever whispers the phrase", () => {
    const s = withAutoInvite();
    expect(whisper(s, "ginv", "Amy-Realm")).toBe("0");
    expect(asked(s)).toBe("0");
    command(s, "on");
    expect(whisper(s, "  GINV ", "Amy-Realm")).toBe("0");            // never invites by itself
    expect(s.run(`return CHAT_LOG[#CHAT_LOG]`)).toContain("/ginvite Amy-Realm");
    whisper(s, "hello there", "Bob-Realm");
    expect(asked(s)).toBe("1");
  });

  it("never calls a guild invite function from a whisper", () => {
    const s = withAutoInvite();
    s.run(`C_GuildInfo = { Invite = function(name) INVITED[#INVITED + 1] = name end }`);
    command(s, "on");
    for (let i = 0; i < 5; i++) whisper(s, "ginv", `Player${String.fromCharCode(97 + i)}-Realm`);
    expect(s.run(`return #INVITED`)).toBe("0");
    expect(asked(s)).toBe("5");
  });

  it("uses a custom phrase and can be turned off", () => {
    const s = withAutoInvite();
    command(s, "on join us please");
    whisper(s, "ginv", "Amy-Realm");
    expect(asked(s)).toBe("0");
    whisper(s, "join us please", "Amy-Realm");
    expect(asked(s)).toBe("1");
    command(s, "off");
    whisper(s, "join us please", "Cy-Realm");
    expect(asked(s)).toBe("1");
  });

  it("skips known guild members, repeats within the hour, combat, non-officers and rate-limit overflow", () => {
    const s = withAutoInvite();
    command(s, "on");
    whisper(s, "ginv", "Old-Realm");
    expect(asked(s)).toBe("0");
    whisper(s, "ginv", "Amy-Realm");
    whisper(s, "ginv", "Amy-Realm");
    expect(asked(s)).toBe("1");
    s.run(`NOW = NOW + 3601`);
    whisper(s, "ginv", "Amy-Realm");
    expect(asked(s)).toBe("2");
    s.run(`fire_event("PLAYER_REGEN_DISABLED")`);
    whisper(s, "ginv", "Bob-Realm");
    expect(asked(s)).toBe("2");
    s.run(`fire_event("PLAYER_REGEN_ENABLED"); NS.isOfficer = function() return false end`);
    whisper(s, "ginv", "Bob-Realm");
    expect(asked(s)).toBe("2");
    s.run(`NS.isOfficer = function() return true end`);
    const before = Number(asked(s));
    for (let i = 0; i < 20; i++) whisper(s, "ginv", `Player${String.fromCharCode(97 + i)}-Realm`);
    // At most 15 requests in any hour.
    expect(Number(asked(s)) - before).toBeLessThanOrEqual(14);
  });

  it("only officers can change the setting, and status lists recent requests", () => {
    const s = withAutoInvite();
    s.run(`NS.isOfficer = function() return false end`);
    command(s, "on");
    expect(s.chat().join("\n")).toContain("Only officers can use auto-invite");
    s.run(`NS.isOfficer = function() return true end`);
    command(s, "on");
    whisper(s, "ginv", "Amy-Realm");
    command(s, "status");
    expect(s.chat().join("\n")).toContain('Auto-invite is on, phrase "ginv". 1 recent request(s).');
  });
});

describe("AutoInvite.lua: invite the raid from Discord signups", () => {
  function withRaid(): LuaSession {
    const s = withAutoInvite();
    s.run(`
      PARTY_INVITED = {}
      C_PartyInfo = { InviteUnit = function(name) PARTY_INVITED[#PARTY_INVITED + 1] = name end }
      NS.groupMembers = function() return { "Kev", "Amy" } end
      GuildedNextRaid = { id = "r1", title = "Molten Core", at = "2026-10-02T00:00:00Z", core = "", players = {
        { name = "Amy", role = "TANK" }, { name = "Bob", role = "DPS" }, { name = "Cy-Realm", role = "HEALER" } }, maybe = {} }
    `);
    return s;
  }
  const invite = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["invite"](a)`);

  it("lists who signed up but is not in the group yet", () => {
    const s = withRaid();
    invite(s, "missing");
    expect(s.chat().join("\n")).toContain("2 signed up for Molten Core but not in your group: Bob, Cy");
  });

  it("lists /invite lines for only the missing players and never calls the invite API", () => {
    const s = withRaid();
    invite(s, "raid");
    expect(s.run(`return #PARTY_INVITED`)).toBe("0");
    const text = s.chat().join(" ");
    expect(text).toContain("2 of 3 signed up for Molten Core are not in your group");
    expect(text).toContain("/invite Bob");
    expect(text).toContain("/invite Cy");
    expect(text).not.toContain("/invite Amy");
  });

  it("explains when there is no roster, when everyone is here, and to non-officers", () => {
    const s = withRaid();
    s.run(`GuildedNextRaid = nil`);
    invite(s, "raid");
    expect(s.chat().join("\n")).toContain("No raid roster yet");
    s.run(`NS.groupMembers = function() return { "Kev", "Amy", "Bob", "Cy" } end; GuildedNextRaid = { title = "MC", players = { { name = "Amy" }, { name = "Bob" } } }`);
    invite(s, "raid");
    expect(s.chat().join("\n")).toContain("already in your group");
    s.run(`NS.isOfficer = function() return false end`);
    invite(s, "raid");
    expect(s.chat().join("\n")).toContain("Only officers can invite the raid");
  });
});

describe("AutoInvite.lua never calls the invite API (WoW Forever: \"Guilded tried to call Invite()\")", () => {
  it("/guilded invite raid lists /invite lines instead of calling InviteUnit", () => {
    const s = withAutoInvite();
    s.run(`
      CALLED = 0
      C_PartyInfo = { InviteUnit = function() CALLED = CALLED + 1 end }
      InviteUnit = function() CALLED = CALLED + 1 end
      NS.groupMembers = function() return { "Kev" } end
      GuildedNextRaid = { title = "MC", players = { { name = "Amy Smith" }, { name = "Bob Jones" } } }
      NS.commandHandlers["invite"]({ "raid" })
    `);
    expect(s.run(`return CALLED`)).toBe("0");
    const text = s.chat().join("\n");
    expect(text).toContain("/invite Amy Smith");
    expect(text).toContain("/invite Bob Jones");
    s.close();
  });
});
