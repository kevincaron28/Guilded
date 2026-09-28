import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withSync(): LuaSession {
  session = newLuaSession();
  session.run(`
    GetAddOnMetadata = function() return "2.0.0" end
    DB = {}
    NS = {
      isSecret = function() return false end,
      normalizeName = function(n) return (string.gsub(string.match(n, "^([^%-]+)") or n, "^%l", string.upper)) end,
      playerName = function() return "Kev" end,
      isOfficer = function() return false end, isOfficerName = function() return false end,
      getDb = function() return DB end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Sync.lua");
  return session;
}

describe("Sync.lua", () => {
  it("/guilded peers lists who runs which version and who is older", () => {
    const s = withSync();
    s.run(`
      fire_event("PLAYER_ENTERING_WORLD")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "VERSION|1.5.0", "GUILD", "Amy-Realm")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "VERSION|2.0.0", "GUILD", "Bob-Realm")
      NS.commandHandlers["peers"]({})
    `);
    const text = s.chat().join("\n");
    expect(text).toContain("2 addon user(s) seen");
    expect(text).toContain("Amy 1.5.0 (older)");
    expect(text).toContain("Bob 2.0.0");
    expect(text).toContain("you run 2.0.0, 1 older");
  });

  it("ignores message kinds it does not know", () => {
    const s = withSync();
    s.run(`fire_event("PLAYER_ENTERING_WORLD"); fire_event("CHAT_MSG_ADDON", "GuildedSync", "FUTURE|whatever|1|2", "GUILD", "Amy-Realm"); NS.commandHandlers["peers"]({})`);
    expect(s.chat().join("\n")).toContain("No guildmate with the addon has announced a version");
  });
});

describe("why there is no standing", () => {
  it("names the real reason instead of always blaming the link", () => {
    const s = withSync();
    s.run(`fire_event("PLAYER_ENTERING_WORLD")`);
    // Nothing arrived yet.
    expect(s.run(`return NS.standingProblem("Ray")`)).toBe("none");
    expect(s.run(`return NS.standingProblemText("Ray")`)).toContain("have not arrived yet");
    // Arrived, but the bot had nobody linked when it wrote them.
    s.run(`DB.standings = { updatedAt = "2026-09-26T00:00:00Z", baseGp = 0, players = {} }`);
    expect(s.run(`return NS.standingProblem("Ray")`)).toBe("empty");
    expect(s.run(`return NS.standingProblemText("Ray")`)).toContain("no linked characters yet");
    // Arrived with others, but not this character.
    s.run(`DB.standings.players = { Amy = { ep = 10, gp = 0, pr = 1 } }`);
    expect(s.run(`return NS.standingProblem("Ray")`)).toBe("missing");
    expect(s.run(`return NS.standingProblemText("Ray")`)).toContain("Ray is not linked to a Discord member yet");
    expect(s.run(`return tostring(NS.standingProblem("Amy"))`)).toBe("nil");
  });
});

describe("module requests are rate limited", () => {
  it("answers one requester once, then waits for the cooldown", () => {
    const s = withSync();
    s.run(`
      NS.isOfficer = function() return true end
      NS.getSettings = function() return { guildModules = { updatedAt = 50, by = "Kev", off = {} } } end
      SENT = 0
      C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function(_, text) if string.find(text, "^MODS|") then SENT = SENT + 1 end end }
      fire_event("PLAYER_ENTERING_WORLD")
      for _ = 1, 4 do fire_event("CHAT_MSG_ADDON", "GuildedSync", "MODSREQ|0", "GUILD", "Amy-Realm") end
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "MODSREQ|0", "GUILD", "Bob-Realm")
    `);
    expect(s.run(`return SENT`)).toBe("2");
  });
});

describe("item tooltip data", () => {
  it("an officer shares it in chunks and another player adopts it", () => {
    const officer = withSync();
    officer.run(`
      NS.isOfficer = function() return true end
      C_Timer = { After = function(_, fn) fn() end }
      SENT_ITEMS = {}
      C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function(_, text) if string.find(text, "^ITEM|") then SENT_ITEMS[#SENT_ITEMS + 1] = text end end }
      DB.standings = { updatedAt = "2026-09-26T00:00:00Z", baseGp = 0, players = { Amy = { ep = 10, gp = 5, pr = 2 } } }
      DB.items = { updatedAt = "2026-09-26T00:00:00Z", list = {
        ["thunderfury blessed blade of the windseeker"] = { gp = 120, n = 3, wn = 5, wish = { { "Amy", 1 }, { "Bob", 2 } } },
        ["some ring"] = { gp = nil, n = 0, wn = 1, wish = { { "Cy", 3 } } }
      } }
      fire_event("PLAYER_ENTERING_WORLD")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STANDREQ|0", "GUILD", "Amy-Realm")
    `);
    const count = Number(officer.run(`return #SENT_ITEMS`));
    expect(count).toBeGreaterThan(0);
    const messages = JSON.parse(officer.run(`local out = {}; for i, m in ipairs(SENT_ITEMS) do out[i] = string.format("%q", m) end; return "[" .. table.concat(out, ",") .. "]"`)) as string[];
    officer.close();

    const member = withSync();
    member.run(`NS.isOfficerName = function() return true end; fire_event("PLAYER_ENTERING_WORLD")`);
    for (const message of messages) member.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", ${JSON.stringify(message)}, "GUILD", "Kevin-Realm")`);
    expect(member.run(`return DB.items.list["some ring"].wish[1][1] .. DB.items.list["some ring"].wish[1][2]`)).toBe("Cy3");
    expect(member.run(`local i = DB.items.list["thunderfury blessed blade of the windseeker"]; return i.gp .. "/" .. i.n .. "/" .. i.wn .. "/" .. #i.wish`)).toBe("120/3/5/2");
  });

  it("ignores item data from someone who is not an officer", () => {
    const s = withSync();
    s.run(`fire_event("PLAYER_ENTERING_WORLD"); fire_event("CHAT_MSG_ADDON", "GuildedSync", "ITEM|2026-09-26T00:00:00Z|1|1|some ring~~0~1~Cy:3", "GUILD", "Pug-Realm")`);
    expect(s.run(`return tostring(DB.items)`)).toBe("nil");
  });

  it("reads the companion-written items file together with the standings", () => {
    const s = withSync();
    s.run(`
      GuildedStandings = { updatedAt = "2026-09-27T00:00:00Z", baseGp = 0, players = { { name = "Amy", ep = 10, gp = 5 } } }
      GuildedItems = { ["some ring"] = { gp = 40, n = 2, wn = 1, wish = { { "Cy", 3 } } } }
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    expect(s.run(`return NS.getItemInsight("some ring").gp`)).toBe("40");
    expect(s.run(`return tostring(NS.getItemInsight("nope"))`)).toBe("nil");
  });

  it("keeps each raid core's loot system, prices and own-pool standings from the companion file", () => {
    const s = withSync();
    s.run(`
      GuildedStandings = { updatedAt = "2026-09-27T00:00:00Z", baseGp = 0, players = {} }
      GuildedLoot = {
        default = "EPGP", minimumBid = 15, values = { ["ring"] = 20 },
        cores = {
          { id = "c1", name = "Tuesday MC", mode = "PRIORITY", pool = true, reserves = 2, baseGp = 10,
            values = { ["sulfuras hand of ragnaros"] = 250, ["#19019"] = 250, ["bad"] = "x" },
            players = { { name = "amy-Realm", ep = 300, gp = 90 } } },
        }
      }
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    expect(s.run(`return NS.getLootRules().default`)).toBe("EPGP");
    expect(s.run(`return NS.getLootRules().minimumBid`)).toBe("15");
    expect(s.run(`return NS.getLootRules().values.ring`)).toBe("20");
    const core = `NS.getLootRules().cores[1]`;
    expect(s.run(`return ${core}.name .. ":" .. ${core}.mode .. ":" .. tostring(${core}.pool) .. ":" .. ${core}.reserves`)).toBe("Tuesday MC:PRIORITY:true:2");
    expect(s.run(`return ${core}.values["sulfuras hand of ragnaros"]`)).toBe("250");
    expect(s.run(`return tostring(${core}.values.bad)`)).toBe("nil");
    expect(s.run(`return string.format("%.2f", ${core}.players.Amy.pr)`)).toBe("3.00"); // 300 / (90 + 10)
    // 4.6: no off-spec share or minimum EP in the file: 50% and none.
    expect(s.run(`return ${core}.offspec .. ":" .. ${core}.minEp`)).toBe("50:0");
  });

  it("keeps a core's off-spec share and minimum EP (4.6), kept in range", () => {
    const s = withSync();
    s.run(`
      GuildedStandings = { updatedAt = "2026-09-27T00:00:00Z", baseGp = 0, players = {} }
      GuildedLoot = { default = "EPGP", cores = {
        { id = "c1", name = "A", mode = "PRIORITY", offspec = 25, minEp = 100, players = {} },
        { id = "c2", name = "B", mode = "PRIORITY", offspec = 250, minEp = -5, players = {} }
      } }
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    expect(s.run(`local c = NS.getLootRules().cores; return c[1].offspec .. ":" .. c[1].minEp .. "|" .. c[2].offspec .. ":" .. c[2].minEp`)).toBe("25:100|100:0");
  });

  it("has no loot rules when the file carries none", () => {
    const s = withSync();
    s.run(`GuildedStandings = { updatedAt = "2026-09-27T00:00:00Z", baseGp = 0, players = {} }; fire_event("PLAYER_ENTERING_WORLD")`);
    expect(s.run(`return tostring(NS.getLootRules())`)).toBe("nil");
  });
});

describe("standings chunk reassembly", () => {
  it("rejects an out-of-range chunk index instead of completing an incomplete snapshot", () => {
    const s = withSync();
    s.run(`NS.isOfficerName = function() return true end; fire_event("PLAYER_ENTERING_WORLD")`);
    // total says 2; an out-of-range index 3 arrives first. Without the bound, this
    // would still count toward "2 received" once index 1 arrives, and the snapshot
    // would complete with index 2 (never sent) missing.
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-26T00:00:00Z|0|3|2|Bad:1:1", "GUILD", "Amy-Realm")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-26T00:00:00Z|0|1|2|Amy:10:5", "GUILD", "Amy-Realm")`);
    expect(s.run(`return tostring(DB.standings)`)).toBe("nil");
    // The real chunk 2 now arrives and the snapshot completes correctly.
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-26T00:00:00Z|0|2|2|Bob:4:2", "GUILD", "Amy-Realm")`);
    expect(s.run(`return DB.standings.players.Amy.ep`)).toBe("10");
    expect(s.run(`return DB.standings.players.Bob.ep`)).toBe("4");
  });

  it("ignores a chunk that disagrees with the in-progress snapshot's total or sender", () => {
    const s = withSync();
    s.run(`NS.isOfficerName = function() return true end; fire_event("PLAYER_ENTERING_WORLD")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-26T00:00:00Z|0|1|2|Amy:10:5", "GUILD", "Amy-Realm")`);
    // Same updatedAt, but a different claimed total and a different sender: ignored
    // rather than mixed into the in-progress assembly.
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-26T00:00:00Z|0|2|3|Bob:4:2", "GUILD", "Evil-Realm")`);
    expect(s.run(`return tostring(DB.standings)`)).toBe("nil");
    // The real second chunk from the original sender completes it correctly.
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-26T00:00:00Z|0|2|2|Bob:4:2", "GUILD", "Amy-Realm")`);
    expect(s.run(`return DB.standings.players.Bob.ep`)).toBe("4");
  });

  it("rejects an out-of-range item chunk index the same way", () => {
    const s = withSync();
    s.run(`NS.isOfficerName = function() return true end; fire_event("PLAYER_ENTERING_WORLD")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "ITEM|2026-09-26T00:00:00Z|3|2|bad~~0~0~", "GUILD", "Amy-Realm")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "ITEM|2026-09-26T00:00:00Z|1|2|some ring~10~0~0~", "GUILD", "Amy-Realm")`);
    expect(s.run(`return tostring(DB.items)`)).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "ITEM|2026-09-26T00:00:00Z|2|2|other ring~20~0~0~", "GUILD", "Amy-Realm")`);
    expect(s.run(`return DB.items.list["some ring"].gp`)).toBe("10");
    expect(s.run(`return DB.items.list["other ring"].gp`)).toBe("20");
  });
});
