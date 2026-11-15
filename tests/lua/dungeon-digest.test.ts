import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.3.5: guildmates compare a digest of the runs they hold before the login replay sends anything. A peer that says "D1" sends
// DGS|1|D1|<week>:<hash>; an equal hash for a run's week means that peer holds the run, so the replay skips it; a different hash
// makes the author offer (OFR) and send only what is asked for (WNT). An addon without D1 gets the old replay.

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

function client(name: string): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; GT = 0
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
    UnitName = function() return "${name}" end`);
  for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    MEMBERS = { Walter = true, Lebowski = true, Donny = true }
    NS.isGuildMember = function(n) return MEMBERS[(n or ""):match("^[^-]+")] == true end
    NS.isOfficerName = function() return false end
    fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  return s;
}

const runs = "NS.getDb().dungeon.runs";
function giveRun(s: LuaSession, id: string, endedAgo = 1100) {
  s.run(`${runs}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
    startedAt = CLOCK - 2000, endedAt = CLOCK - ${endedAgo}, completedBy = "final boss", recorder = "Walter", encounters = {}, reporters = { Walter = true },
    players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true } } }`);
}
const holds = (s: LuaSession, id: string) => s.run(`return tostring(${runs}[${JSON.stringify(id)}] ~= nil)`) === "true";
const take = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`).split("\n").filter(Boolean);

// Hands every Guilded dungeon line `from` sent to each recipient as a guild addon message; returns the lines.
function pump(from: LuaSession, fromName: string, ...to: LuaSession[]) {
  const lines = take(from).filter((line) => line.startsWith("GuildedDgn>"));
  for (const line of lines) {
    const text = line.slice("GuildedDgn>".length);
    for (const peer of to) peer.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", ${JSON.stringify(text)}, "GUILD", "${fromName}-Realm")`);
  }
  return lines.map((line) => line.slice("GuildedDgn>".length));
}
const replay = (s: LuaSession) => s.run(`NS.dungeon.lastReplay = nil; NS.dungeon.replayPending(); run_timers()`);
const kinds = (lines: string[], kind: string) => lines.filter((line) => line.startsWith(kind + "|"));

describe("run digests before the login replay", () => {
  it("sends a digest line that names the D1 capability and keeps the hash under 24 bits", () => {
    const walter = client("Walter");
    giveRun(walter, "walter-rfc");
    walter.run(`NS.dungeon.sendDigest(true)`);
    const lines = pump(walter, "Walter");
    const digest = kinds(lines, "DGS");
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatch(/^DGS\|1\|D1\|\d+:[0-9a-f]{6}$/);
    expect(digest[0]!.length).toBeLessThan(80);
  });

  it("does not send a run again to a guildmate whose digest already matches (no duplicates)", () => {
    const walter = client("Walter"), lebowski = client("Lebowski"), donny = client("Donny");
    for (const s of [walter, lebowski, donny]) giveRun(s, "walter-rfc");
    for (const [s, name] of [[lebowski, "Lebowski"], [donny, "Donny"]] as const) { s.run(`NS.dungeon.sendDigest(true)`); pump(s, name, walter); }
    replay(walter);
    const sent = pump(walter, "Walter", lebowski, donny);
    expect(kinds(sent, "SUM")).toHaveLength(0);
    expect(Number(walter.run(`return NS.dungeon.stats.digestSkipped`))).toBe(1);
  });

  it("offers when a digest differs, and sends the run once, only to the one who asks (nothing missed)", () => {
    const walter = client("Walter"), lebowski = client("Lebowski"), donny = client("Donny");
    giveRun(walter, "walter-rfc"); giveRun(donny, "walter-rfc");
    lebowski.run(`NS.getDb().dungeon.companionEver = true`);
    giveRun(lebowski, "other-run", 90000); // Lebowski holds a different run in the same week, so his digest differs
    for (const [s, name] of [[lebowski, "Lebowski"], [donny, "Donny"]] as const) { s.run(`NS.dungeon.sendDigest(true)`); pump(s, name, walter); }
    walter.run(`run_timers()`);
    const offers = pump(walter, "Walter", lebowski, donny);
    expect(kinds(offers, "OFR")).toHaveLength(1);
    expect(kinds(offers, "OFR")[0]).toContain("walter-rfc");
    // Lebowski lacks it and asks; Donny already holds it and stays quiet.
    lebowski.run(`run_timers()`); donny.run(`run_timers()`);
    const wants = pump(lebowski, "Lebowski", walter).concat(pump(donny, "Donny", walter));
    expect(kinds(wants, "WNT")).toHaveLength(1);
    walter.run(`run_timers()`);
    const summaries = pump(walter, "Walter", lebowski, donny);
    expect(kinds(summaries, "SUM").length).toBeGreaterThan(0);
    expect(holds(lebowski, "walter-rfc")).toBe(true);
    // Nothing more is sent for it once it arrived.
    walter.run(`run_timers()`);
    expect(kinds(pump(walter, "Walter", lebowski), "SUM")).toHaveLength(0);
  });

  it("keeps the old replay for a guildmate without the capability (mixed versions)", () => {
    const walter = client("Walter"), old = client("Lebowski");
    giveRun(walter, "walter-rfc");
    // An older addon never sends a digest, so nothing is known about it.
    replay(walter);
    const sent = pump(walter, "Walter", old);
    expect(kinds(sent, "SUM").length).toBeGreaterThan(0);
    expect(holds(old, "walter-rfc")).toBe(true);
    expect(Number(walter.run(`return NS.dungeon.stats.digestSkipped or 0`))).toBe(0);
  });

  it("ignores a digest without D1 or an oversized one, and forgets a stale one", () => {
    const walter = client("Walter");
    giveRun(walter, "walter-rfc");
    walter.run(`NS.dungeon.onDigest("DGS|1|X9|2900:abcdef", "Donny")`);
    expect(walter.run(`return tostring(NS.dungeon.peerDigests.Donny)`)).toBe("nil");
    walter.run(`NS.dungeon.onDigest("DGS|1|D1|" .. string.rep("1", 300), "Donny")`);
    expect(walter.run(`return tostring(NS.dungeon.peerDigests.Donny)`)).toBe("nil");
    const week = walter.run(`return NS.dungeon.bucketOf(NS.getDb().dungeon.runs["walter-rfc"])`);
    walter.run(`NS.dungeon.onDigest(string.format("DGS|1|D1|%d:%06x", ${week}, NS.dungeon.digest()[${week}]), "Donny")`);
    expect(walter.run(`return tostring(NS.dungeon.peerHolds(NS.getDb().dungeon.runs["walter-rfc"]))`)).toBe("true");
    walter.run(`CLOCK = CLOCK + 4000`);
    expect(walter.run(`return tostring(NS.dungeon.peerHolds(NS.getDb().dungeon.runs["walter-rfc"]))`)).toBe("false");
  });
});
