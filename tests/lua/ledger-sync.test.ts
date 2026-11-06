import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { newLuaSession, type LuaSession } from "./harness.js";

// Two (or three) officers' clients with the real LedgerSync.lua, connected by a fake guild
// channel: GUILD messages reach everyone else, WHISPER only the named player.
const sessions: LuaSession[] = [];
// Every message pump delivered, in order (the compression tests look at what went by).
const delivered: { from: string; text: string }[] = [];
afterEach(() => { for (const session of sessions) session.close(); sessions.length = 0; delivered.length = 0; });

interface Client { name: string; s: LuaSession }

// The game's text packing, faked but reversible: "compression" marks the text, base64 is hex.
const PACKING = String.raw`
  C_EncodingUtil = {
    CompressString = function(text) return "Z" .. text end,
    DecompressString = function(text) if string.sub(text, 1, 1) ~= "Z" then error("not packed") end return string.sub(text, 2) end,
    EncodeBase64 = function(text) return (string.gsub(text, ".", function(c) return string.format("%02x", string.byte(c)) end)) end,
    DecodeBase64 = function(text) return (string.gsub(text, "%x%x", function(h) return string.char(tonumber(h, 16)) end)) end
  }
`;

function client(name: string, options: { officer?: boolean; local?: boolean; sync?: boolean; pack?: boolean } = {}): Client {
  const s = newLuaSession(); sessions.push(s);
  if (options.pack) s.run(PACKING);
  s.run(`
    NOW = 1800000000; OUT = {}
    DB = { settings = { setupMode = ${options.local === false ? '"connected"' : '"local"'}, ledgerSync = ${options.sync === false ? "false" : "true"} }, epgp = {} }
    NS = {
      getDb = function() return DB end, playerName = function() return "${name}" end,
      normalizeName = function(n) return n and string.match(n, "^([^%-]+)") end,
      isSecret = function() return false end, isOfficer = function() return ${options.officer === false ? "false" : "true"} end,
      isOfficerName = function(n) return n == "Alice" or n == "Bob" or n == "Cara" end,
      ledgerPeerRole = function(address)
        local name = address:match("^([^-]+)%-Realm$")
        if NS.isOfficerName(name) then return "officer" end
        if name == "Dave" or name == "Eve" or name == "Fay" then return "member" end
      end,
      isInGameOnly = function() return DB.settings.setupMode == "local" end,
      currentGuildKey = function() return GetGuildInfo("player") .. "-Realm" end,
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
  // Fengari exposes Lua 5.3 operators; WoW supplies these operations via LuaBitOp. No ror here on purpose: WoW's bit table may lack it.
  s.run(`bit = {
    band = function(a,b) return a & b end, bxor = function(a,b,c) return a ~ b ~ (c or 0) end,
    rshift = function(a,n) return a >> n end, bor = function(a,b) return a | b end, lshift = function(a,n) return a << n end
  }`);
  s.load("Modules/LedgerDigest.lua");
  s.load("Modules/LedgerRelay.lua");
  s.load("Modules/LedgerSync.lua");
  return { name, s };
}

// Moves every queued message to its receivers until nobody has anything left to say.
function pump(clients: Client[], rounds = 50, lostGuild: string[] = []) {
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
        delivered.push({ from: from.name, text: message.text });
        for (const to of clients) {
          if (to === from) continue;
          if (message.channel === "WHISPER" && message.target.replace(/-.*/, "") !== to.name) continue;
          if (message.channel === "GUILD" && lostGuild.includes(from.name)) continue;
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

  it("still syncs when one officer's guild-channel messages never arrive (seen in game)", () => {
    const alice = client("Alice"); const bob = client("Bob");
    // Alice's award reaches Bob through Alice's SUM, as on 16 October.
    alice.s.run('award("Tank", 1, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob], 50, ["Bob"]);
    expect(bob.s.run('return balance("Tank")')).toBe("1/0");
    // Then Bob awards and asks. Before the fix his SUM went only to the guild channel and
    // Alice never heard it; it now also goes by whisper to the officers he exchanged with.
    advance([alice, bob], 30);
    bob.s.run('award("Healer", 1, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob], 50, ["Bob"]);
    expect(alice.s.run('return balance("Healer")')).toBe("1/0");
    // Bob voids it 30 seconds later: within the old one-minute answer cooldown, but a changed
    // ledger is answered at once.
    advance([alice, bob], 30);
    bob.s.run(`
      local e = DB.epgp.Healer.ledger[1]; e.voided = "now"; e.pending = nil
      DB.epgp.Healer.ep = DB.epgp.Healer.ep - 1
      NS.commandHandlers.ledgersync({"now"})`);
    pump([alice, bob], 50, ["Bob"]);
    expect(alice.s.run('return balance("Healer")')).toBe("0/0");
    expect(summary(alice)).toBe(summary(bob));
  });

  it("answers the same SUM once when it comes by guild and by whisper", () => {
    const alice = client("Alice"); const bob = client("Bob");
    alice.s.run('award("Tank", 1, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    advance([alice, bob], 30);
    bob.s.run('award("Healer", 1, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    // Bob's SUM went out twice (guild and whisper); Alice answers it with one AUTH.
    const sums = Number(bob.s.run('local n = 0; for _, m in ipairs(OUT) do if string.find(m.text, "^SUM") then n = n + 1 end end; return n'));
    expect(sums).toBe(2);
    // One delivery round only: Alice has answered but nobody has heard the answer yet.
    expect(() => pump([alice, bob], 1)).toThrow("did not settle");
    expect(Number(alice.s.run('local n = 0; for _, m in ipairs(OUT) do if string.find(m.text, "^AUTH") then n = n + 1 end end; return n'))).toBe(1);
    pump([alice, bob]);
    expect(summary(alice)).toBe(summary(bob));
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

  it("supplies a member while refusing forged entries, disabled peers and connected guilds", () => {
    const alice = client("Alice");
    const member = client("Dave", { officer: false });
    const off = client("Bob", { sync: false });
    const connected = client("Cara", { local: false });
    alice.s.run('award("Tank", 10, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, member, off, connected]);
    expect(member.s.run('return balance("Tank")')).toBe("10/0");
    for (const c of [off, connected]) expect(c.s.run('return balance("Tank")')).toBe("none");
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

  it("can be enabled by any member in in-game-only mode", () => {
    const officer = client("Alice", { sync: false });
    officer.s.run('NS.commandHandlers.ledgersync({"on"})');
    expect(officer.s.run("return tostring(DB.settings.ledgerSync)")).toBe("true");
    const connected = client("Bob", { local: false, sync: false });
    connected.s.run('NS.commandHandlers.ledgersync({"on"})');
    expect(connected.s.run("return tostring(DB.settings.ledgerSync)")).toBe("false");
    expect(connected.s.run("return CHAT_LOG[#CHAT_LOG]")).toContain("in-game-only");
    const member = client("Dave", { officer: false, sync: false });
    member.s.run('NS.commandHandlers.ledgersync({"on"})');
    expect(member.s.run("return tostring(DB.settings.ledgerSync)")).toBe("true");
    officer.s.run('NS.commandHandlers.ledgersync({"status"})');
    expect(officer.s.run("return table.concat(CHAT_LOG, ' | ')")).toContain("0 entries here");
  });
});

describe("compressed ledger batches (7.5.0)", () => {
  it("matches independent SHA-256 vectors across padding and chunk boundaries", () => {
    const { s } = client("Dave", { officer: false });
    for (const size of [0, 3, 55, 56, 64, 160, 640]) {
      expect(s.run(`return NS.ledgerDigest(string.rep("a", ${size}))`))
        .toBe(createHash("sha256").update("a".repeat(size)).digest("hex"));
    }
  });

  it("computes the same digest with a native rotate", () => {
    const { s } = client("Dave", { officer: false });
    s.run('bit.ror = function(a,n) return (a >> n) | (a << (32-n)) end; NS.ledgerDigest = nil');
    s.load("Modules/LedgerDigest.lua");
    expect(s.run('return NS.ledgerDigest("abc")')).toBe(createHash("sha256").update("abc").digest("hex"));
  });

  it("stays off, rather than wrong, when the client has no bit operations", () => {
    const { s } = client("Dave", { officer: false });
    s.run('bit = { band = bit.band }; NS.ledgerDigest = nil');
    s.load("Modules/LedgerDigest.lua");
    expect(s.run("return tostring(NS.ledgerDigest)")).toBe("nil");
  });

  it.each([1, 8])("delivers %i officer-approved awards between two ordinary members with the officer offline", (size) => {
    const boss = client("Alice", { pack: true });
    const holder = client("Dave", { officer: false, pack: true });
    const reader = client("Eve", { officer: false, pack: true });
    boss.s.run(`for i = 1, ${size} do award("Tank", 5, 0, i) end`);
    holder.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([boss, holder]);
    const seal = delivered.find(m => m.from === "Alice" && m.text.startsWith("SEAL|"))?.text;
    expect(seal).toMatch(/^SEAL\|1\|[a-f0-9]{64}$/);
    const receive = (text: string, from: string, channel: string) =>
      reader.s.run(`fire_event("CHAT_MSG_ADDON","GuildedLedger",${JSON.stringify(text)},"${channel}","${from}-Realm")`);
    receive(seal!, "Dave", "GUILD");
    expect(reader.s.run("return #DB.ledgerRelay.order")).toBe("0");
    receive(seal!, "Alice", "GUILD");
    const digest = seal!.slice(7);
    // The receiver heard the officer's receipt but missed the original data.
    reader.s.run('NS.commandHandlers.ledgersync({"now"})');
    receive("HAVE|1|" + digest, "Fay", "WHISPER");
    receive("PART|1|" + digest + "|1|1|E|1|Alice-1800000000-1|Tank|999|0||EP_AWARD|0|forged", "Fay", "WHISPER");
    expect(reader.s.run('return balance("Tank")')).toBe("none");
    reader.s.run("OUT = {}");
    advance([holder, reader], 20);
    reader.s.run('NS.commandHandlers.ledgersync({"now"})');
    // The peer whose bytes failed the digest is not asked again for a while.
    receive("HAVE|1|" + digest, "Fay", "WHISPER");
    expect(reader.s.run('for _, m in ipairs(OUT) do if m.text:sub(1, 5) == "FETCH" then return "fetched" end end return "none"')).toBe("none");
    pump([holder, reader]);
    expect(reader.s.run('return count("Tank") .. ":" .. balance("Tank")')).toBe(`${size}:${5*size}/0`);
    reader.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([holder, reader]);
    expect(summary(reader)).toBe(summary(boss));
    advance([boss, holder, reader], 300);
    boss.s.run('DB.epgp.Tank.ledger[1].voided = "now"; DB.epgp.Tank.ep = DB.epgp.Tank.ep - 5; NS.commandHandlers.ledgersync({"now"})');
    pump([boss, holder]);
    const seals = delivered.filter(m => m.from === "Alice" && m.text.startsWith("SEAL|"));
    const reversal = seals[seals.length-1]!.text;
    expect(reversal).not.toBe(seal);
    receive(reversal, "Alice", "GUILD");
    reader.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([holder, reader]);
    expect(reader.s.run('return count("Tank") .. ":" .. balance("Tank")')).toBe(`${size}:${5*size-5}/0`);
    expect(summary(reader)).toBe(summary(boss));
    reader.s.run('GetGuildInfo = function() return "Other Guild" end; OUT = {}');
    receive("SEEK|1|" + digest, "Dave", "GUILD");
    expect(reader.s.run("return #DB.ledgerRelay.order .. ':' .. #OUT")).toBe("0:0");
  });
  const sentBy = (name: string, kind: string) => delivered.filter((m) => m.from === name && m.text.startsWith(kind + "|")).length;

  it("sends a day of entries as one batch between officers whose game can pack text", () => {
    const alice = client("Alice", { pack: true }); const bob = client("Bob", { pack: true });
    alice.s.run('for i = 1, 30 do award("P" .. i, i, 0, i, "Boss kill number " .. i) end');
    alice.s.run('award("P1", 0, 25, 31, "Sword | of doom")');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(summary(alice)).toBe(summary(bob));
    expect(bob.s.run('return balance("P1") .. ":" .. balance("P30")')).toBe("1/25:30/0");
    expect(bob.s.run('for _, e in ipairs(DB.epgp.P1.ledger) do if e.gpAmount == 25 then return e.reason .. "/" .. e.fromPeer end end')).toBe("Sword   of doom/Alice");
    expect(sentBy("Alice", "E")).toBe(0);
    expect(sentBy("Alice", "Z")).toBeGreaterThan(1);
    expect(sentBy("Bob", "CAP")).toBeGreaterThan(0);
  });

  it.each([15, 180])("recovers a multi-part officer ledger after a %i-second send lockdown", (seconds) => {
    const alice = client("Alice", { pack: true });
    const bob = client("Bob", { pack: true });
    const clients = [alice, bob];
    // Exercise the sender's production queue, with the client's timer and send API under test control.
    alice.s.load("Util.lua");
    alice.s.run(`
      GetServerTime = function() return NOW end
      GetTime = function() return NOW - 1800000000 end
      local timers = {}
      C_Timer.After = function(delay, fn) timers[#timers+1] = { due = GetTime() + delay, fn = fn } end
      function runDueTimers()
        local pending = timers
        timers = {}
        for _, timer in ipairs(pending) do
          if timer.due <= GetTime() then timer.fn() else timers[#timers+1] = timer end
        end
      end
      C_ChatInfo.SendAddonMessage = function(_, text, channel, target)
        if not unlock and (blocked or text:match("^Z|1|[^|]+|%d+|2|")) then
          blocked = blocked or text
          denied = (denied or 0) + 1
          return 11
        end
        OUT[#OUT+1] = { text = text, channel = channel, target = target }
        return 0
      end
      for i = 1, 8 do award("Tank", i, 0, i) end
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    const tick = () => {
      advance(clients, 1);
      alice.s.run("runDueTimers()");
      pump(clients);
    };
    advance(clients, 60);
    alice.s.run("runDueTimers()");
    pump(clients);
    for (let i = 0; i < 10 && !alice.s.run("return blocked"); i++) tick();
    const blocked = alice.s.run("return blocked");
    expect(blocked).toMatch(/^Z\|1\|/);
    expect(sentBy("Alice", "Z")).toBe(1);
    for (let i = 0; i < seconds; i++) tick();
    expect(Number(alice.s.run("return denied"))).toBeLessThanOrEqual(1 + Math.ceil(seconds / 5));
    expect(bob.s.run('return count("Tank")')).toBe("0");

    const requests = sentBy("Bob", "GET");
    alice.s.run("unlock = true");
    for (let i = 0; i < 60 && alice.s.run('return NS.comm.pending("GuildedLedger")') !== "0"; i++) tick();
    expect(delivered.filter(m => m.from === "Alice" && m.text.startsWith("Z|"))[1]?.text).toBe(blocked);
    expect(alice.s.run('return NS.comm.pending("GuildedLedger")')).toBe("0");
    // Only an expired partial day needs to be requested again.
    expect(sentBy("Bob", "GET") - requests).toBe(seconds > 120 ? 1 : 0);
    expect(summary(bob)).toBe(summary(alice));
    expect(bob.s.run('return count("Tank") .. ":" .. balance("Tank")')).toBe("8:36/0");
  });

  it.each([
    ["sync is disabled", "DB.settings.ledgerSync = false"],
    ["the sender loses officer access", "NS.isOfficer = function() return false end"],
    ["the recipient loses officer access", "NS.isOfficerName = function() return false end"],
    ["the sender changes guild", 'GetGuildInfo = function() return "Other Guild" end'],
  ])("cancels a deferred officer whisper when %s", (_, change) => {
    const { s } = client("Alice", { pack: true });
    s.load("Util.lua");
    s.run(`
      attempts = 0
      C_ChatInfo.SendAddonMessage = function() attempts = attempts + 1; return 11 end
      C_Timer.After = function(_, fn) retry = fn end
      fire_event("CHAT_MSG_ADDON", "GuildedLedger", "SUM|1|1|123", "WHISPER", "Bob-Realm")
    `);
    expect(Number(s.run('return NS.comm.pending("GuildedLedger")'))).toBeGreaterThan(0);
    expect(s.run("return attempts")).toBe("1");
    s.run(`${change}; GetTime = function() return 10 end; retry()`);
    expect(s.run('return attempts .. ":" .. NS.comm.pending("GuildedLedger")')).toBe("1:0");
  });

  it("keeps single entries for an officer whose game cannot pack, and for one entry", () => {
    const alice = client("Alice", { pack: true }); const bob = client("Bob");
    alice.s.run('for i = 1, 5 do award("P" .. i, i, 0, i) end');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(summary(alice)).toBe(summary(bob));
    expect(sentBy("Alice", "Z")).toBe(0);
    expect(sentBy("Alice", "E")).toBe(5);
    expect(sentBy("Bob", "CAP")).toBe(0);
    const cara = client("Cara", { pack: true });
    cara.s.run('award("Solo", 3, 0, 1); NS.commandHandlers.ledgersync({"now"})');
    pump([alice, cara]);
    expect(alice.s.run('return balance("Solo")')).toBe("3/0");
    expect(sentBy("Cara", "Z")).toBe(0);
  });

  it("checks every line of a batch like an E message, and drops a damaged batch", () => {
    const bob = client("Bob", { pack: true });
    const lines = ["Alice-1800000000-1|Tank|10|0||EP_AWARD|0|Raid", "Alice-1800000000-2|Tank|999999|0||EP_AWARD|0|x", "not-an-id|Tank|5|0||EP_AWARD|0|x"].join("\n");
    const hex = Buffer.from("Z" + lines).toString("hex");
    const fire = (from: string, text: string) => bob.s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLedger", ${JSON.stringify(text)}, "WHISPER", "${from}-Realm")`);
    // From a member: ignored whole.
    fire("Dave", `Z|1|Alice|20833|1|1|${hex}`);
    expect(bob.s.run('return balance("Tank")')).toBe("none");
    // In two parts from an officer: the valid line counts, the absurd amount does not.
    fire("Alice", `Z|1|Alice|20833|1|2|${hex.slice(0, 100)}`);
    expect(bob.s.run('return balance("Tank")')).toBe("none");
    fire("Alice", `Z|1|Alice|20833|2|2|${hex.slice(100)}`);
    expect(bob.s.run('return balance("Tank") .. "/" .. count("Tank")')).toBe("10/0/1");
    fire("Alice", "Z|1|Alice|20834|1|1|00ff");
    expect(bob.s.run('return count("Tank")')).toBe("1");
  });
});

describe("ledger sync status", () => {
  const status = (c: Client) => {
    c.s.run('CHAT_LOG = {}; NS.commandHandlers.ledgersync({"status"})');
    return Array.from({ length: Number(c.s.run("return #CHAT_LOG")) }, (_, i) => c.s.run(`return CHAT_LOG[${i + 1}]`)).join("\n");
  };

  it("says when no partner was seen, then remembers each officer across reloads and warns after a quiet week", () => {
    const alice = client("Alice"), bob = client("Bob");
    expect(status(alice)).toContain("No sync partner seen yet");
    bob.s.run('award("Tank", 10, 0, 1)');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(status(alice)).toContain("Bob: last heard 0 min ago.");
    // Saved in the SavedVariables settings, so a reload keeps it.
    expect(alice.s.run("return DB.settings.ledgerSyncSeen.Bob")).toBe(alice.s.run("return NOW"));
    advance([alice, bob], 8 * 86_400);
    const later = status(alice);
    expect(later).toContain("Bob: last heard 8 d ago.");
    expect(later).toContain("No ledger sync partner seen in the past week");
  });
});

describe("ledger sync partners on Home (6.3)", () => {
  it("remembers whether each officer's ledger matched at the last comparison", () => {
    const alice = client("Alice"), bob = client("Bob");
    bob.s.run('award("Tank", 10, 0, 1)');
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    // Bob compares Alice's summary with his own before the entries are exchanged.
    pump([alice, bob]);
    expect(bob.s.run("return tostring(DB.settings.ledgerSyncMatch.Alice)")).toBe("false");
    expect(bob.s.run("return table.concat(NS.ledgerSync.waiting(), ',')")).toBe("Alice");
    // After the merge the next comparison matches, and Alice leaves the waiting list.
    advance([alice, bob], 120);
    alice.s.run('NS.commandHandlers.ledgersync({"now"})');
    pump([alice, bob]);
    expect(bob.s.run("return tostring(DB.settings.ledgerSyncMatch.Alice)")).toBe("true");
    expect(bob.s.run("return #NS.ledgerSync.waiting()")).toBe("0");
    bob.s.run('CHAT_LOG = {}; NS.commandHandlers.ledgersync({"status"})');
    expect(bob.s.run("return table.concat(CHAT_LOG, ' | ')")).toContain("Alice: last heard 0 min ago. Ledgers matched.");
  });
});
