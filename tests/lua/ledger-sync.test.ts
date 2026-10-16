import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Two (or three) officers' clients with the real LedgerSync.lua, connected by a fake guild
// channel: GUILD messages reach everyone else, WHISPER only the named player.
const sessions: LuaSession[] = [];
afterEach(() => { for (const session of sessions) session.close(); sessions.length = 0; });

interface Client { name: string; s: LuaSession }

function client(name: string, options: { officer?: boolean; local?: boolean; sync?: boolean } = {}): Client {
  const s = newLuaSession(); sessions.push(s);
  s.run(`
    NOW = 1800000000; OUT = {}
    DB = { settings = { setupMode = ${options.local === false ? '"connected"' : '"local"'}, ledgerSync = ${options.sync === false ? "false" : "true"} }, epgp = {} }
    NS = {
      getDb = function() return DB end, playerName = function() return "${name}" end,
      normalizeName = function(n) return n and string.match(n, "^([^%-]+)") end,
      isSecret = function() return false end, isOfficer = function() return ${options.officer === false ? "false" : "true"} end,
      isOfficerName = function(n) return n == "Alice" or n == "Bob" or n == "Cara" end,
      isInGameOnly = function() return DB.settings.setupMode == "local" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {},
      util = {
        serverTime = function() return NOW end,
        tooFarAhead = function(stamp) return type(stamp) == "number" and stamp > NOW + 600 end,
        truncate = function(text, limit) return string.sub(text, 1, limit) end
      },
      comm = { register = function() end, send = function(prefix, text, channel, target) OUT[#OUT + 1] = { text = text, channel = channel, target = target } end }
    }
    -- The way Core.lua records an award: a ledger entry with a permanent id, and the guild-pool balance.
    function award(player, ep, gp, seq, reason)
      DB.epgp[player] = DB.epgp[player] or { ep = 0, gp = 0, ledger = {} }
      local account = DB.epgp[player]
      account.ep, account.gp = account.ep + ep, account.gp + gp
      table.insert(account.ledger, { id = string.format("%s-%d-%d", "${name}", NOW, seq), pending = true, epAmount = ep, gpAmount = gp, type = "EP_AWARD", reason = reason or "Raid", at = "x", by = "${name}" })
    end
    function balance(player) local a = DB.epgp[player]; return a and (a.ep .. "/" .. a.gp) or "none" end
    function count(player) local a = DB.epgp[player]; return a and #a.ledger or 0 end
  `);
  s.load("Modules/LedgerSync.lua");
  return { name, s };
}

// Moves every queued message to its receivers until nobody has anything left to say.
function pump(clients: Client[], rounds = 50) {
  for (let round = 0; round < rounds; round++) {
    let moved = 0;
    for (const from of clients) {
      const count = Number(from.s.run("return #OUT"));
      const messages = Array.from({ length: count }, (_, i) => ({
        text: from.s.run(`return OUT[${i + 1}].text`), channel: from.s.run(`return OUT[${i + 1}].channel`), target: from.s.run(`return OUT[${i + 1}].target or ""`)
      }));
      from.s.run("OUT = {}");
      for (const message of messages) {
        expect(Buffer.byteLength(message.text)).toBeLessThanOrEqual(255);
        for (const to of clients) {
          if (to === from) continue;
          if (message.channel === "WHISPER" && message.target.replace(/-.*/, "") !== to.name) continue;
          to.s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLedger", ${JSON.stringify(message.text)}, ${JSON.stringify(message.channel)}, "${from.name}-Realm")`);
          moved++;
        }
      }
    }
    if (moved === 0) return;
  }
  throw new Error("ledger sync did not settle");
}

// Everyone shares the server clock.
const advance = (clients: Client[], seconds: number) => { for (const c of clients) c.s.run(`NOW = NOW + ${seconds}`); };
const summary = (c: Client) => c.s.run("local n, h = NS.ledgerSync.summary(); return n .. ':' .. h");

describe("officer ledger sync (in-game-only guilds)", () => {
  it("includes an award made immediately after a cached summary", () => {
    const alice = client("Alice"); const bob = client("Bob");
    summary(alice);
    alice.s.run('award("Tank", 10, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(bob.s.run('return balance("Tank")')).toBe("10/0");
  });

  it("merges two officers' ledgers into the same entries and balances", () => {
    const alice = client("Alice"); const bob = client("Bob");
    alice.s.run('award("Tank", 10, 0, 1); award("Healer", 5, 0, 2)');
    bob.s.run('award("Healer", 7, 0, 1); award("Rogue", 3, 0, 2)');
    advance([alice, bob], 86400);
    alice.s.run('award("Tank", 0, 20, 3, "Sword | of doom")');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(summary(alice)).toBe(summary(bob));
    for (const c of [alice, bob]) {
      expect(c.s.run('return balance("Tank")')).toBe("10/20");
      expect(c.s.run('return balance("Healer")')).toBe("12/0");
      expect(c.s.run('return balance("Rogue")')).toBe("3/0");
    }
    expect(bob.s.run('for _, e in ipairs(DB.epgp.Tank.ledger) do if e.gpAmount == 20 then return e.reason .. "/" .. e.fromPeer .. "/" .. tostring(e.pending) end end')).toBe("Sword   of doom/Alice/true");
    // A second exchange finds nothing to send.
    advance([alice, bob], 20);
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(alice.s.run('return count("Healer")')).toBe("2");
    expect(bob.s.run('return count("Healer")')).toBe("2");
  });

  it("passes a void on, once, and takes the points back out", () => {
    const alice = client("Alice"); const bob = client("Bob");
    alice.s.run('award("Tank", 10, 0, 1); award("Tank", 4, 0, 2)');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(bob.s.run('return balance("Tank")')).toBe("14/0");
    // Alice voids her entry the way Core.lua does (the entry stays, marked).
    advance([alice, bob], 120);
    alice.s.run(`
      local e = DB.epgp.Tank.ledger[2]; e.voided = "now"; e.pending = nil
      DB.epgp.Tank.ep = DB.epgp.Tank.ep - 4
      NS.commandHandlers.ledgersync({"now"})`);
    pump([alice, bob]);
    expect(bob.s.run('return balance("Tank")')).toBe("10/0");
    expect(bob.s.run('return tostring(DB.epgp.Tank.ledger[2].voided ~= nil) .. "/" .. tostring(DB.epgp.Tank.ledger[2].pending)')).toBe("true/nil");
    expect(summary(alice)).toBe(summary(bob));
    advance([alice, bob], 120);
    bob.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(bob.s.run('return balance("Tank")')).toBe("10/0");
  });

  it("brings a third officer up to date from either of the others", () => {
    const alice = client("Alice"); const bob = client("Bob"); const cara = client("Cara");
    alice.s.run('for i = 1, 30 do award("P" .. i, i, 0, i, "Boss kill number " .. i) end');
    advance([alice, bob, cara], 3 * 86400);
    bob.s.run('award("P1", 0, 50, 1)');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob, cara]);
    // Cara got Alice's entries; she announces too (every officer does, at login and every few
    // minutes) and gets Bob's from whoever answers.
    advance([alice, bob, cara], 120);
    cara.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob, cara]);
    expect(summary(alice)).toBe(summary(cara));
    expect(summary(bob)).toBe(summary(cara));
    expect(cara.s.run('return balance("P1")')).toBe("1/50");
    expect(cara.s.run('return balance("P30")')).toBe("30/0");
  });

  it("ignores members, officers with sync off, connected guilds and malformed entries", () => {
    const alice = client("Alice");
    const member = client("Dave", { officer: false });
    const off = client("Bob", { sync: false });
    const connected = client("Cara", { local: false });
    alice.s.run('award("Tank", 10, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, member, off, connected]);
    for (const c of [member, off, connected]) expect(c.s.run('return balance("Tank")')).toBe("none");
    // A non-officer's entry, an absurd amount and a future entry are refused.
    const bob = client("Bob");
    bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|Dave-1800000000-1|Tank|5|0||EP_AWARD|0|x", "WHISPER", "Dave-Realm")');
    bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|Alice-1800000000-9|Tank|999999|0||EP_AWARD|0|x", "WHISPER", "Alice-Realm")');
    bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|Alice-1900000000-9|Tank|5|0||EP_AWARD|0|x", "WHISPER", "Alice-Realm")');
    bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|not-an-id|Tank|5|0||EP_AWARD|0|x", "WHISPER", "Alice-Realm")');
    bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|Alice-1800000000-2|Tank|1.5|0||EP_AWARD|0|x", "WHISPER", "Alice-Realm")');
    bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|Alice-1800000000-3|Tank|5|0||EP_AWARD|maybe|x", "WHISPER", "Alice-Realm")');
    expect(bob.s.run('return balance("Tank")')).toBe("none");
    // The same entry twice counts once.
    for (let i = 0; i < 2; i++) bob.s.run('fire_event("CHAT_MSG_ADDON", "GuildedLedger", "E|1|Alice-1800000000-1|Tank|10|0||EP_AWARD|0|Raid", "WHISPER", "Alice-Realm")');
    expect(bob.s.run('return balance("Tank") .. "/" .. count("Tank")')).toBe("10/0/1");
  });

  it("is turned on by officers in in-game-only mode only", () => {
    const officer = client("Alice", { sync: false });
    officer.s.run('NS.commandHandlers.ledgersync({"on"})');
    expect(officer.s.run("return tostring(DB.settings.ledgerSync)")).toBe("true");
    const connected = client("Bob", { local: false, sync: false });
    connected.s.run('NS.commandHandlers.ledgersync({"on"})');
    expect(connected.s.run("return tostring(DB.settings.ledgerSync)")).toBe("false");
    expect(connected.s.run("return CHAT_LOG[#CHAT_LOG]")).toContain("in-game-only");
    const member = client("Dave", { officer: false, sync: false });
    member.s.run('NS.commandHandlers.ledgersync({"on"})');
    expect(member.s.run("return tostring(DB.settings.ledgerSync)")).toBe("false");
    officer.s.run('NS.commandHandlers.ledgersync({"status"})');
    expect(officer.s.run("return table.concat(CHAT_LOG, ' | ')")).toContain("0 entries here");
  });
});

describe("ledger sync status", () => {
  const status = (c: Client) => {
    c.s.run('CHAT_LOG = {}; NS.commandHandlers.ledgersync({"status"})');
    return Array.from({ length: Number(c.s.run("return #CHAT_LOG")) }, (_, i) => c.s.run(`return CHAT_LOG[${i + 1}]`)).join("\n");
  };

  it("says when no partner was seen, then remembers each officer across reloads and warns after a quiet week", () => {
    const alice = client("Alice"), bob = client("Bob");
    expect(status(alice)).toContain("No other officer with ledger sync on has been seen yet");
    bob.s.run('award("Tank", 10, 0, 1)');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(status(alice)).toContain("Bob: last heard 0 min ago.");
    // Saved in the SavedVariables settings, so a reload keeps it.
    expect(alice.s.run("return DB.settings.ledgerSyncSeen.Bob")).toBe(alice.s.run("return NOW"));
    advance([alice, bob], 8 * 86_400);
    const later = status(alice);
    expect(later).toContain("Bob: last heard 8 d ago.");
    expect(later).toContain("Over a week without another officer");
  });
});
