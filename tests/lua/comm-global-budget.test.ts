import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.1.7: every prefix and channel shares one send budget (burst 8, 4 a second, learning downwards);
// the game's throttle line backs everything off once per burst; chat lines spend the same budget but are
// never queued. A fake clock and timer list drive the real Util.lua.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const PREFIXES = ["Guilded", "GuildedSync", "GuildedLedger", "GuildedRly", "GuildedCatch", "GuildedBoard", "GuildedOrd", "GuildedDgn",
  "GuildedScore", "GuildedRating", "GuildedSeason", "GuildedBridge", "GuildedRcp", "GuildedMile", "GuildedMap", "GuildedFree",
  "GuildedHist", "GuildedDuel", "GuildedSOS", "GuildedRes"];

function boot(): LuaSession {
  const s = newLuaSession();
  session = s;
  s.run(String.raw`
    GuildedCommBudget = nil
    NS = {}; SENT = {}; CHATS = {}; NOW = 0; TIMERS = {}; INCOMBAT = false; NOTES = {}
    function GetTime() return NOW end
    function InCombatLockdown() return INCOMBAT end
    C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { at = NOW + delay, fn = fn } end }
    C_ChatInfo = {
      RegisterAddonMessagePrefix = function() return true end,
      SendAddonMessage = function(prefix, text, channel, target) SENT[#SENT + 1] = { prefix = prefix, text = text, at = NOW }; return 0 end,
      SendChatMessage = function(text, channel) CHATS[#CHATS + 1] = { text = text, at = NOW } end
    }
    ERR_CHAT_THROTTLED = "The number of messages that can be sent is limited, please wait to send another message."
    -- Moves the clock in 0.1 s steps, running due timers.
    function advance(seconds)
      local stop = NOW + seconds
      while NOW < stop - 1e-9 do
        NOW = NOW + 0.1
        local due = {}
        for i = #TIMERS, 1, -1 do if TIMERS[i].at <= NOW + 1e-9 then due[#due + 1] = table.remove(TIMERS, i) end end
        for _, t in ipairs(due) do t.fn() end
      end
    end
    function sentIn(from, to) local n = 0; for _, m in ipairs(SENT) do if m.at >= from and m.at < to then n = n + 1 end end return n end
  `);
  s.load("Util.lua");
  s.run(`NS.message = function(t) NOTES[#NOTES + 1] = t end; NS.L = function(t) return t end`);
  return s;
}

const storm = (s: LuaSession, each = 40) => s.run(`
  local prefixes = { ${PREFIXES.filter((p) => p !== "GuildedSOS" && p !== "GuildedDgn").map((p) => `"${p}"`).join(",")} }
  for _, p in ipairs(prefixes) do for i = 1, ${each} do NS.comm.send(p, "m" .. i, "GUILD") end end
`);

describe("one global send budget (ns.comm)", () => {
  it("a login burst from eighteen prefixes stays under the shared budget", () => {
    const s = boot();
    storm(s);
    s.run("advance(30)");
    // Burst of 8 at once, then 4 a second.
    expect(Number(s.run("return sentIn(0, 0.95)"))).toBeLessThanOrEqual(9);
    for (const t of [2, 5, 10, 20, 30]) expect(Number(s.run(`return sentIn(0, ${t} + 0.05)`))).toBeLessThanOrEqual(9 + 4 * t);
    // Still moving: the budget does not starve the queues.
    expect(Number(s.run("return #SENT"))).toBeGreaterThan(80);
  });

  it("the queues drain to empty, in order, with no window above the budget", () => {
    const s = boot();
    s.run(`for i = 1, 30 do NS.comm.send("GuildedSync", "a" .. i, "GUILD"); NS.comm.send("GuildedLedger", "b" .. i, "GUILD") end`);
    s.run("advance(60)");
    expect(s.run("return #SENT")).toBe("60");
    expect(s.run("return NS.comm.pending('GuildedSync') + NS.comm.pending('GuildedLedger')")).toBe("0");
    for (let t = 0; t < 55; t += 5) expect(Number(s.run(`return sentIn(${t}, ${t} + 1)`))).toBeLessThanOrEqual(9);
  });

  it("a call for help and a dungeon receipt go out within a second of a login storm", () => {
    const s = boot();
    storm(s, 60);
    s.run("advance(5)"); // deep in the storm
    const before = Number(s.run("return #SENT"));
    s.run(`NS.comm.send("GuildedSOS", "C|help", "GUILD", nil, nil, "interactive"); NS.comm.send("GuildedDgn", "SUM|run", "GUILD", nil, nil, "hold-in-instance")`);
    s.run("advance(1.2)");
    const texts = s.run(`local o = {}; for i = ${before + 1}, #SENT do o[#o + 1] = SENT[i].text end; return table.concat(o, ",")`);
    expect(texts).toContain("C|help");
    expect(texts).toContain("SUM|run");
  });

  it("a chunked transfer under pressure arrives whole and in order, even with repeated chunk text", () => {
    const s = boot();
    storm(s, 40);
    s.run(`for i = 1, 25 do NS.comm.send("GuildedRating", (i % 5 == 0) and "same" or ("part" .. i), "GUILD") end`);
    s.run(`NS.comm.send("GuildedRating", "same", "GUILD")`);
    s.run("advance(400)");
    const chunks = s.run(`local o = {}; for _, m in ipairs(SENT) do if m.prefix == "GuildedRating" and (m.text:sub(1, 4) == "part" or m.text == "same") then o[#o + 1] = m.text end end; return table.concat(o, ",")`);
    const expected = [...Array(25)].map((_, i) => ((i + 1) % 5 === 0 ? "same" : `part${i + 1}`)).concat("same").join(",");
    expect(chunks).toBe(expected);
  });
});

describe("back-off", () => {
  it("one refusal line starts a short back-off; nothing leaves while it runs", () => {
    const s = boot();
    s.run(`for i = 1, 20 do NS.comm.send("GuildedSync", "x" .. i, "GUILD") end`);
    const before = Number(s.run("return #SENT"));
    expect(before).toBeGreaterThan(0);
    // Another game language: the global string differs and the line is still recognised.
    s.run(`ERR_CHAT_THROTTLED = "Le nombre de messages est limite."`);
    s.run(`fire_event("CHAT_MSG_SYSTEM", "Le nombre de messages est limite.")`);
    const first = Number(s.run("return NS.comm.budget().waiting"));
    expect(first).toBeGreaterThanOrEqual(2);
    expect(first).toBeLessThanOrEqual(3.01);
    s.run("advance(1.5)");
    expect(Number(s.run("return #SENT"))).toBe(before); // nothing at all while waiting
    // English text is not matched when the game's own string differs: detection is by the global.
    s.run(`fire_event("CHAT_MSG_SYSTEM", "The number of messages that can be sent is limited, please wait to send another message.")`);
    expect(s.run("return NS.comm.budget().refusals")).toBe("1");
  });

  it("a burst of refusal lines is one strike, not eight", () => {
    const s = boot();
    for (let i = 0; i < 8; i++) s.run(`fire_event("CHAT_MSG_SYSTEM", ERR_CHAT_THROTTLED)`);
    expect(s.run("return NS.comm.budget().strikes")).toBe("1");
    expect(s.run("return NS.comm.budget().refusals")).toBe("8");
    expect(Number(s.run("return NS.comm.budget().waiting"))).toBeLessThanOrEqual(3.01);
  });

  it("with Guilded and Guilded Dungeons both loaded one refusal line counts once", () => {
    const s = boot();
    s.run(`NS2 = {}`);
    s.load("Util.lua", "NS2"); // the second addon's copy: its own comm table, its own system-message frame
    s.run(`fire_event("CHAT_MSG_SYSTEM", ERR_CHAT_THROTTLED)`);
    expect(s.run("return NS.comm.budget().strikes")).toBe("1");
    expect(s.run("return NS2.comm.budget().strikes")).toBe("1");
    expect(Number(s.run("return NS.comm.budget().waiting"))).toBeLessThanOrEqual(3.01);
  });

  it("a second report after the back-off ends doubles the wait; strikes are forgotten after 30 quiet seconds", () => {
    const s = boot();
    s.run(`fire_event("CHAT_MSG_SYSTEM", ERR_CHAT_THROTTLED); advance(4); fire_event("CHAT_MSG_SYSTEM", ERR_CHAT_THROTTLED)`);
    expect(s.run("return NS.comm.budget().strikes")).toBe("2");
    const second = Number(s.run("return NS.comm.budget().waiting"));
    expect(second).toBeGreaterThanOrEqual(4);
    expect(second).toBeLessThanOrEqual(6.01);
    s.run("advance(45); fire_event('CHAT_MSG_SYSTEM', ERR_CHAT_THROTTLED)");
    expect(s.run("return NS.comm.budget().strikes")).toBe("1");
  });

  it("does not resume with a burst: two messages, then the lowered rate", () => {
    const s = boot();
    storm(s, 40);
    s.run(`fire_event("CHAT_MSG_SYSTEM", ERR_CHAT_THROTTLED)`);
    const wait = Number(s.run("return NS.comm.budget().waiting"));
    s.run(`advance(${wait} + 0.15)`);
    const start = Number(s.run("return #SENT"));
    s.run("advance(1)");
    // 2 resume tokens plus about 2.4 a second for one second: well under a full burst of 8.
    expect(Number(s.run("return #SENT")) - start).toBeLessThanOrEqual(5);
    // The rate fell and climbs back slowly.
    expect(Number(s.run("return NS.comm.budget().rate"))).toBeLessThan(4);
  });

  it("a throttled result from the client protects on its own, without any chat line", () => {
    const s = boot();
    s.run(`ERR_CHAT_THROTTLED = nil; C_ChatInfo.SendAddonMessage = function() return 3 end; NS.comm.send("GuildedSync", "x", "GUILD"); NS.comm.send("GuildedLedger", "y", "GUILD")`);
    expect(Number(s.run("return NS.comm.budget().strikes"))).toBe(1);
    expect(Number(s.run("return NS.comm.budget().waiting"))).toBeGreaterThan(1);
  });

  it("keeps high-value traffic and drops low-value traffic when throttled", () => {
    const s = boot();
    s.run(`for i = 1, 8 do NS.comm.send("GuildedSync", "bulk" .. i, "GUILD") end`); // empties the burst
    s.run(`NS.comm.send("GuildedMap", "P|1", "GUILD"); NS.comm.send("GuildedFree", "F|1", "GUILD")`);
    s.run(`NS.comm.send("GuildedDgn", "RUN|receipt", "GUILD", nil, nil, "hold-in-instance"); NS.comm.send("GuildedSOS", "C|help", "GUILD", nil, nil, "interactive")`);
    s.run(`fire_event("CHAT_MSG_SYSTEM", ERR_CHAT_THROTTLED)`);
    expect(s.run("return NS.comm.pending('GuildedMap') + NS.comm.pending('GuildedFree')")).toBe("0");
    expect(s.run("return NS.comm.status('GuildedMap').dropped")).toBe("1");
    s.run("advance(30)");
    const texts = s.run("local o = {}; for _, m in ipairs(SENT) do o[#o + 1] = m.text end; return table.concat(o, ',')");
    expect(texts).toContain("RUN|receipt");
    expect(texts).toContain("C|help");
    expect(texts).not.toContain("P|1");
  });
});

describe("headroom, queues and chat", () => {
  it("low-value traffic leaves headroom and holds in combat", () => {
    const s = boot();
    s.run(`for i = 1, 6 do NS.comm.send("GuildedSync", "s" .. i, "GUILD") end; for i = 1, 3 do NS.comm.send("GuildedMap", "P|" .. i, "GUILD") end`);
    expect(Number(s.run("return #SENT"))).toBeLessThanOrEqual(6);
    const s2 = boot();
    s2.run(`INCOMBAT = true; NS.comm.send("GuildedFree", "F|1", "GUILD")`);
    expect(s2.run("return #SENT")).toBe("0");
    s2.run("INCOMBAT = false; advance(3)");
    expect(s2.run("return #SENT")).toBe("1");
  });

  it("never coalesces messages (a chunked transfer is not deduplicated) and bounds the queues", () => {
    const s = boot();
    s.run(`for i = 1, 8 do NS.comm.send("GuildedSync", "bulk" .. i, "GUILD") end; for i = 1, 5 do NS.comm.send("GuildedSync", "same", "GUILD") end`);
    // 13 messages in, none merged: what was sent plus what waits is all 13, repeats included.
    expect(Number(s.run("return NS.comm.pending('GuildedSync') + #SENT"))).toBe(13);
    s.run(`for i = 1, 2000 do NS.comm.send("GuildedLedger", "n" .. i, "GUILD") end`);
    expect(Number(s.run("return NS.comm.pending('GuildedLedger')"))).toBeLessThanOrEqual(1024);
    for (let i = 0; i < 12; i++) s.run(`NS.comm.send("GuildedMap", "P|" .. ${i}, "GUILD")`);
    expect(Number(s.run("return NS.comm.pending('GuildedMap')"))).toBeLessThanOrEqual(3);
  });

  it("sends chat at once when the budget allows and drops it with a note when not, never late", () => {
    const s = boot();
    expect(s.run(`return tostring(NS.comm.chat("line 1", "RAID"))`)).toBe("true");
    expect(s.run("return #CHATS")).toBe("1");
    s.run(`for i = 1, 20 do NS.comm.chat("line " .. i, "RAID") end`);
    expect(Number(s.run("return #CHATS"))).toBeLessThanOrEqual(9); // the budget, not 21
    expect(Number(s.run("return #NOTES"))).toBeGreaterThan(0); // the player was told
    s.run("advance(30)");
    expect(Number(s.run("return #CHATS"))).toBeLessThanOrEqual(9); // nothing was queued for later
    s.run(`NS.comm.noteThrottle()`);
    expect(s.run(`return tostring(NS.comm.chat("later", "RAID"))`)).toBe("false");
  });

  it("does not mistake the throttle line for a guild event or route system messages into a tab", () => {
    const s = boot();
    s.run(`ERR_GUILD_JOIN_S = "%s has joined the guild."`);
    s.load("Modules/ChatTab.lua");
    expect(s.run("return tostring(NS.chatTab.parse(ERR_CHAT_THROTTLED))")).toBe("nil");
    for (const dir of ["Guilded", "Guilded/Modules"]) {
      for (const f of readdirSync(`addon/${dir}`).filter((n) => n.endsWith(".lua"))) {
        expect(readFileSync(`addon/${dir}/${f}`, "utf8"), f).not.toMatch(/AddMessageGroup|RemoveMessageGroup/);
      }
    }
  });
});
