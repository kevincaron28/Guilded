import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.1.7: every prefix and channel shares one send budget; the game's throttle line backs everything
// off; chat lines are paced too. A fake clock and timer list drive the real Util.lua.
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
    NS = {}; SENT = {}; CHATS = {}; NOW = 0; TIMERS = {}; INCOMBAT = false
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
  return s;
}

describe("one global send budget (ns.comm)", () => {
  it("a login burst from twenty prefixes stays under the shared budget", () => {
    const s = boot();
    s.run(`
      local prefixes = { ${PREFIXES.map((p) => `"${p}"`).join(",")} }
      for _, p in ipairs(prefixes) do for i = 1, 40 do NS.comm.send(p, "m" .. i, "GUILD") end end
    `);
    s.run("advance(30)");
    // Burst of 8 at once, then 3 a second.
    expect(Number(s.run("return sentIn(0, 0.95)"))).toBeLessThanOrEqual(9);
    for (const t of [2, 5, 10, 20, 30]) expect(Number(s.run(`return sentIn(0, ${t} + 0.05)`))).toBeLessThanOrEqual(9 + 3 * t);
    // Still moving: the budget is not starving the queue.
    expect(Number(s.run("return #SENT"))).toBeGreaterThan(60);
  });

  it("no more than the budget in any window, with the queues draining to empty", () => {
    const s = boot();
    s.run(`for i = 1, 30 do NS.comm.send("GuildedSync", "a" .. i, "GUILD"); NS.comm.send("GuildedLedger", "b" .. i, "GUILD") end`);
    s.run("advance(60)");
    expect(s.run("return #SENT")).toBe("60");
    expect(s.run("return NS.comm.pending('GuildedSync') + NS.comm.pending('GuildedLedger')")).toBe("0");
    for (let t = 0; t < 55; t += 5) expect(Number(s.run(`return sentIn(${t}, ${t} + 1)`))).toBeLessThanOrEqual(11);
  });

  it("the game's throttle line backs off with growing, jittered waits and no retry storm", () => {
    const s = boot();
    s.run(`for i = 1, 20 do NS.comm.send("GuildedSync", "x" .. i, "GUILD") end`);
    const before = Number(s.run("return #SENT"));
    expect(before).toBeGreaterThan(0);
    // Another game language: the global string differs and the line is still recognised.
    s.run(`ERR_CHAT_THROTTLED = "Le nombre de messages est limite."`);
    s.run(`fire_event("CHAT_MSG_SYSTEM", "Le nombre de messages est limite.")`);
    const first = Number(s.run("return NS.comm.budget().waiting"));
    expect(first).toBeGreaterThanOrEqual(4);
    expect(first).toBeLessThanOrEqual(6.01);
    s.run("advance(3.5)");
    expect(Number(s.run("return #SENT"))).toBe(before); // nothing at all while waiting
    // English text is not matched when the game's own string differs: detection is by the global.
    s.run(`fire_event("CHAT_MSG_SYSTEM", "The number of messages that can be sent is limited, please wait to send another message.")`);
    expect(s.run("return NS.comm.budget().throttles")).toBe("1");
    s.run("advance(8)");
    expect(Number(s.run("return #SENT"))).toBeGreaterThan(before); // resumed
    // A second report doubles the wait.
    s.run(`fire_event("CHAT_MSG_SYSTEM", "Le nombre de messages est limite.")`);
    const second = Number(s.run("return NS.comm.budget().waiting"));
    expect(second).toBeGreaterThanOrEqual(8);
    expect(second).toBeLessThanOrEqual(12.01);
    expect(s.run("return NS.comm.budget().strikes")).toBe("2");
  });

  it("a throttled result from the client also backs everything off", () => {
    const s = boot();
    s.run(`C_ChatInfo.SendAddonMessage = function() return 3 end; NS.comm.send("GuildedSync", "x", "GUILD"); NS.comm.send("GuildedLedger", "y", "GUILD")`);
    expect(Number(s.run("return NS.comm.budget().throttles"))).toBeGreaterThanOrEqual(1);
    expect(Number(s.run("return NS.comm.budget().waiting"))).toBeGreaterThan(3);
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

  it("low-value traffic leaves headroom and holds in combat", () => {
    const s = boot();
    s.run(`for i = 1, 6 do NS.comm.send("GuildedSync", "s" .. i, "GUILD") end; for i = 1, 3 do NS.comm.send("GuildedMap", "P|" .. i, "GUILD") end`);
    // 8 tokens: 6 used by sync, so map (needs 4 free) waits for refill.
    expect(Number(s.run("return #SENT"))).toBeLessThanOrEqual(6);
    const s2 = boot();
    s2.run(`INCOMBAT = true; NS.comm.send("GuildedFree", "F|1", "GUILD")`);
    expect(s2.run("return #SENT")).toBe("0");
    s2.run("INCOMBAT = false; advance(3)");
    expect(s2.run("return #SENT")).toBe("1");
  });

  it("coalesces duplicates and bounds the queues", () => {
    const s = boot();
    s.run(`for i = 1, 8 do NS.comm.send("GuildedSync", "bulk" .. i, "GUILD") end; for i = 1, 5 do NS.comm.send("GuildedSync", "same", "GUILD") end`);
    expect(s.run("return NS.comm.pending('GuildedSync')")).toBe("1");
    expect(s.run("return NS.comm.status('GuildedSync').coalesced")).toBe("4");
    s.run(`for i = 1, 2000 do NS.comm.send("GuildedLedger", "n" .. i, "GUILD") end`);
    expect(Number(s.run("return NS.comm.pending('GuildedLedger')"))).toBeLessThanOrEqual(1024);
    for (let i = 0; i < 12; i++) s.run(`NS.comm.send("GuildedMap", "P|" .. ${i}, "GUILD")`);
    expect(Number(s.run("return NS.comm.pending('GuildedMap')"))).toBeLessThanOrEqual(3);
  });

  it("paces chat lines through the same budget and waits during back-off", () => {
    const s = boot();
    s.run(`for i = 1, 20 do NS.comm.chat("line " .. i, "RAID") end`);
    expect(Number(s.run("return #CHATS"))).toBeLessThanOrEqual(8);
    s.run("advance(20)");
    expect(s.run("return #CHATS")).toBe("20");
    s.run(`NS.comm.noteThrottle(); NS.comm.chat("later", "RAID")`);
    expect(s.run("return #CHATS")).toBe("20");
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
