import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Track K (8.5): Modules/GuildRelay.lua (protocol check, carriers, "Synced via", stale pruning)
// and Util.lua's "hold-in-instance" lane, run against the real Lua files on the mocked client.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

const CLOCK = 1800000000;

function setup(options: { carrier?: boolean } = {}) {
  s = newLuaSession();
  s.run(`CLOCK = ${CLOCK}; GT = 0; INSTANCE = false
    function GetServerTime() return CLOCK end
    function GetTime() return GT end
    function IsInInstance() if INSTANCE then return true, "party" end return false, "none" end
    DB = { peerRoster = {}, standings = { updatedAt = "2026-12-20T10:00:00Z", from = "companion" } }
    ${options.carrier ? `GuildedStandings = { updatedAt = "2026-12-20T10:00:00Z", players = {} }` : "GuildedStandings = nil"}
    MEMBERS = { Lebowski = true, Donny = true, Maude = true }
    NS = { getDb = function() return DB end, commandHandlers = {}, commandHelp = {},
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      currentGuildKey = function() return "Achievers-Realm" end,
      normalizeName = function(name) return name and (name:match("^([^-]+)")) or nil end,
      playerName = function() return "Walter" end,
      addonVersion = function() return "8.5.0" end,
      isGuildMember = function(name) return MEMBERS[(name or ""):match("^[^-]+")] == true end,
      isOfficerName = function() return false end }`);
  s.load("Modules/GuildRelay.lua");
  return s;
}
const hear = (text: string, sender = "Lebowski-Realm", channel = "GUILD") =>
  s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedRly", ${JSON.stringify(text)}, "${channel}", "${sender}")`);
const sent = () => s!.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; return table.concat(out, "\\n")`);

describe("GuildRelay.lua", () => {
  it("announces the protocol, and says whether this PC carries guildmates' data", () => {
    setup({ carrier: true }).run(`NS.relay.announce()`);
    expect(sent()).toBe("GuildedRly>HI|1|1|8.5.0");
    s!.close(); setup().run(`NS.relay.announce()`);
    expect(sent()).toBe("GuildedRly>HI|1|0|8.5.0");
  });

  it("a stopped companion's file (older than the guild's data) does not count as carrying", () => {
    const lua = setup({ carrier: true });
    lua.run(`DB.standings.updatedAt = "2026-12-21T00:00:00Z"`);
    expect(lua.run(`return tostring(NS.relay.isCarrier())`)).toBe("false");
  });

  it("shows which guildmate's companion carries this member's data, and how long ago", () => {
    const lua = setup();
    hear("HI|1|1|8.5.0");
    lua.run(`CLOCK = CLOCK + 2 * 3600`);
    expect(lua.run(`return NS.relay.viaText()`)).toBe("Synced via Lebowski, 2 h ago.");
    // A later carrier wins; one that says it stopped carrying is forgotten.
    hear("HI|1|1|8.5.0", "Donny-Realm");
    expect(lua.run(`return NS.relay.viaText()`)).toBe("Synced via Donny, just now.");
    hear("HI|1|0|8.5.0", "Donny-Realm");
    expect(lua.run(`return NS.relay.viaText()`)).toBe("Synced via Lebowski, 2 h ago.");
  });

  it("ignores strangers, whispers and its own PC's carrier status", () => {
    const lua = setup();
    hear("HI|1|1|8.5.0", "Stranger-Realm");
    hear("HI|1|1|8.5.0", "Lebowski-Realm", "WHISPER");
    expect(lua.run(`return tostring(NS.relay.viaText())`)).toBe("nil");
    s!.close();
    const carrier = setup({ carrier: true });
    hear("HI|1|1|8.5.0");
    expect(carrier.run(`return tostring(NS.relay.viaText())`)).toBe("nil");
  });

  it("asks once to update when a guildmate runs a newer sync protocol, and lists older ones", () => {
    const lua = setup();
    hear("HI|2|0|8.6.0");
    hear("HI|3|0|8.7.0", "Donny-Realm");
    const asks = lua.chat().filter((line) => line.includes("Please update Guilded"));
    expect(asks).toEqual(["Lebowski runs a newer Guilded sync (8.6.0). Please update Guilded so your data keeps reaching Discord."]);
    hear("HI|0|0|8.4.0", "Maude-Realm");
    lua.run(`NS.commandHandlers.relay({})`);
    expect(lua.chat().join("\n")).toContain("Older Guilded (please update): Maude");
  });

  it("drops guildmates' digests older than 45 days and shows the age of what it keeps", () => {
    const lua = setup();
    lua.run(`DB.peerRoster = { Old = { seenAt = CLOCK - 46 * 86400 }, Fresh = { seenAt = CLOCK - 3 * 86400 }, NoTime = { professions = "" } }`);
    expect(lua.run(`return tostring(NS.relay.prune())`)).toBe("1");
    expect(lua.run(`return tostring(DB.peerRoster.Old == nil and DB.peerRoster.Fresh ~= nil and DB.peerRoster.NoTime ~= nil)`)).toBe("true");
    lua.run(`NS.commandHandlers.relay({})`);
    expect(lua.chat().join("\n")).toContain("Guildmates' data held here: 2, oldest 3 d ago");
  });

  it("forgets carriers silent for two weeks, and everything when the guild changes", () => {
    const lua = setup();
    hear("HI|1|1|8.5.0");
    lua.run(`CLOCK = CLOCK + 15 * 86400; NS.relay.prune()`);
    expect(lua.run(`return tostring(NS.relay.viaText())`)).toBe("nil");
    hear("HI|1|1|8.5.0");
    lua.run(`NS.currentGuildKey = function() return "Other-Realm" end`);
    expect(lua.run(`return tostring(NS.relay.viaText())`)).toBe("nil");
  });

  it("holds background sync inside an instance and sends it in order once outside", () => {
    const lua = setup();
    lua.run(`INSTANCE = true; NS.relay.announce(); NS.comm.send("GuildedRly", "second", "GUILD", nil, nil, "hold-in-instance")`);
    expect(sent()).toBe("");
    expect(lua.run(`return tostring(NS.comm.pending("GuildedRly"))`)).toBe("2");
    expect(lua.run(`return NS.comm.status("GuildedRly").lastResult`)).toBe("held");
    lua.run(`INSTANCE = false; GT = 30; NS.comm.send("GuildedRly", "third", "GUILD", nil, nil, "hold-in-instance")`);
    expect(sent()).toBe("GuildedRly>HI|1|0|8.5.0\nGuildedRly>second\nGuildedRly>third");
    // Ordinary traffic is never held.
    lua.run(`INSTANCE = true; NS.comm.send("GuildedOther", "now", "PARTY")`);
    expect(sent()).toContain("GuildedOther>now");
  });
});

describe("Digest.lua with the relay", () => {
  it("adds the Synced via line to /guilded digest", () => {
    const lua = setup();
    lua.run(`NS.now = function() return "2026-12-20T12:00:00Z" end`);
    lua.load("Modules/Digest.lua");
    hear("HI|1|1|8.5.0");
    lua.run(`DB.digest = { lastSeen = "2026-12-20T11:00:00Z", enabled = true }; NS.commandHandlers.digest({})`);
    expect(lua.chat()).toContain("Synced via Lebowski, just now.");
  });
});
