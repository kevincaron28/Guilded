import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";

// 9.3.0 gaps in how a finished run is shared in game: a runs-only catch-up (OFR / ACKS / WNT) on the GuildedDgn prefix so
// a run nobody heard is offered again, a chat line for the recorder when a guildmate's companion uploaded the run, chunk
// reliability, a once-per-session reminder for the receiver, and the standalone addon's roster timing.

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

type Kind = "guilded" | "standalone";
interface Options { raw?: boolean; roster?: string[] }

function client(kind: Kind, name: string, options: Options = {}): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  const roster = options.roster ? `ROSTER = { ${options.roster.map((n) => `"${n}"`).join(", ")} }
    function GetNumGuildMembers() return #ROSTER, #ROSTER end
    function GetGuildRosterInfo(i) CALLS = (CALLS or 0) + 1; return ROSTER[i], "Rank", 4 end` : "";
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; CLOCK = ${CLOCK}; GT = 0; COMBAT = false
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function InCombatLockdown() return COMBAT end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
    UnitName = function() return "${name}" end
    ${roster}`);
  if (kind === "guilded") {
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) s.load(file);
  } else {
    for (const file of tocFiles()) s.run(`loadaddon("GuildedDungeons", [=====[${readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end`);
  if (!options.raw) {
    s.run(`NS.isGuildMember = function() return true end
      NS.isOfficerName = function() return false end`);
  }
  s.run(`fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  return s;
}

const runs = "NS.getDb().dungeon.runs";
const makeRun = (id: string, recorder = "Walter", extra = "") => `${runs}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
  startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "${recorder}", encounters = {}, reporters = { ${recorder} = true },
  players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true } }${extra} }`;

const lines = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`).split("\n").filter(Boolean);
const flush = (s: LuaSession) => s.run("run_timers()");
const hear = (to: LuaSession, from: string, line: string) => {
  const [prefix, ...rest] = line.split(">");
  to.run(`fire_event("CHAT_MSG_ADDON", ${JSON.stringify(prefix)}, ${JSON.stringify(rest.join(">"))}, "GUILD", "${from}-Realm")`);
};
/** Sends what `from` has queued to `to`; returns the lines. */
function deliver(from: LuaSession, fromName: string, to: LuaSession, kind?: string) {
  const sent = lines(from).filter((line) => line.startsWith("GuildedDgn>") && (!kind || line.startsWith(`GuildedDgn>${kind}|`)));
  for (const line of sent) hear(to, fromName, line);
  return sent;
}
const has = (s: LuaSession, id: string) => s.run(`return tostring(${runs}[${JSON.stringify(id)}] ~= nil)`) === "true";
const companion = (s: LuaSession) => s.run("GuildedLinkedMeta = { mode = 'test' }");
const ids = (sent: string[], kind: string) => [...new Set(sent.filter((l) => l.startsWith(`GuildedDgn>${kind}|`)).flatMap((l) => (l.split("|")[1] ?? "").split(",")))];

describe.each<Kind>(["guilded", "standalone"])("the runs-only catch-up (%s)", (kind) => {
  it("re-sends a run nobody heard: offer -> want -> summary", () => {
    const walter = client(kind, "Walter");
    const lebowski = client(kind, "Lebowski");
    companion(lebowski);
    walter.run(makeRun("walter-rfc"));
    walter.run("NS.dungeon.offerRuns(true)");
    flush(walter);
    const offer = deliver(walter, "Walter", lebowski);
    expect(offer).toEqual(["GuildedDgn>OFR|walter-rfc"]);
    flush(lebowski);
    const want = deliver(lebowski, "Lebowski", walter);
    expect(want).toEqual(["GuildedDgn>WNT|walter-rfc"]);
    flush(walter);
    expect(deliver(walter, "Walter", lebowski, "SUM").length).toBeGreaterThan(0);
    expect(has(lebowski, "walter-rfc")).toBe(true);
  });

  it("a holder whose bot has the run answers with a confirmation, the recorder is told once, and the offers stop", () => {
    const walter = client(kind, "Walter");
    const lebowski = client(kind, "Lebowski");
    walter.run(makeRun("walter-rfc"));
    lebowski.run(makeRun("walter-rfc") + "; " + `${runs}["walter-rfc"].synced = true`);
    walter.run("NS.dungeon.offerRuns(true)");
    flush(walter);
    deliver(walter, "Walter", lebowski);
    flush(lebowski);
    const answer = deliver(lebowski, "Lebowski", walter);
    expect(answer).toEqual(["GuildedDgn>ACKS|walter-rfc"]);
    expect(walter.run(`return tostring(${runs}["walter-rfc"].syncedVia)`)).toBe("Lebowski");
    const notices = () => walter.chat().filter((line) => /uploaded by/.test(line));
    expect(notices().length).toBe(1);
    expect(notices()[0]).toMatch(/Ragefire Chasm/);
    // Heard again (a second holder): still one line. Nothing left to offer.
    hear(walter, "Donny", "GuildedDgn>ACKS|walter-rfc");
    expect(notices().length).toBe(1);
    expect(walter.run("return tostring(NS.dungeon.offerRuns(true))")).toBe("false");
  });

  it("waits for the end of combat before printing the recorder's line", () => {
    const walter = client(kind, "Walter");
    walter.run(makeRun("walter-rfc"));
    walter.run("COMBAT = true");
    hear(walter, "Lebowski", "GuildedDgn>ACKS|walter-rfc");
    expect(walter.chat().filter((line) => /uploaded by/.test(line)).length).toBe(0);
    walter.run('COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")');
    expect(walter.chat().filter((line) => /uploaded by/.test(line)).length).toBe(1);
  });

  it("only one of two holders answers: the second hears the first one's answer and stays quiet", () => {
    const walter = client(kind, "Walter");
    const a = client(kind, "Lebowski");
    const b = client(kind, "Donny");
    walter.run(makeRun("walter-rfc"));
    for (const holder of [a, b]) holder.run(makeRun("walter-rfc") + "; " + `${runs}["walter-rfc"].synced = true`);
    walter.run("NS.dungeon.offerRuns(true)");
    flush(walter);
    const offer = lines(walter);
    for (const line of offer) { hear(a, "Walter", line); hear(b, "Walter", line); }
    flush(a);
    const first = deliver(a, "Lebowski", b);
    expect(first.length).toBe(1);
    flush(b);
    expect(lines(b)).toEqual([]);
  });

  it("answers one offer per sender every few minutes and caps the ids it will ask for", () => {
    const lebowski = client(kind, "Lebowski");
    companion(lebowski);
    hear(lebowski, "Walter", "GuildedDgn>OFR|a1,a2,a3,a4,a5");
    flush(lebowski);
    expect(ids(lines(lebowski), "WNT").length).toBe(5);
    hear(lebowski, "Walter", "GuildedDgn>OFR|b1,b2");
    flush(lebowski);
    expect(lines(lebowski)).toEqual([]);
    // Without a companion nothing is asked for at all.
    const plain = client(kind, "Donny");
    hear(plain, "Walter", "GuildedDgn>OFR|a1");
    flush(plain);
    expect(lines(plain)).toEqual([]);
  });

  it("re-sends at most three runs per round and not the same run again within five minutes", () => {
    const walter = client(kind, "Walter");
    const all = ["r1", "r2", "r3", "r4", "r5"];
    for (const id of all) walter.run(makeRun(id));
    hear(walter, "Lebowski", `GuildedDgn>WNT|${all.join(",")}`);
    flush(walter);
    const first = ids(lines(walter), "SUM");
    expect(first).toEqual(["r1", "r2", "r3"]);
    hear(walter, "Lebowski", `GuildedDgn>WNT|${all.join(",")}`);
    flush(walter);
    expect(ids(lines(walter), "SUM")).toEqual(["r4", "r5"]);
  });

  it("keeps the usual acceptance: not from a stranger, not on the party channel", () => {
    const lebowski = client(kind, "Lebowski");
    companion(lebowski);
    lebowski.run("NS.isGuildMember = function(n) return (n or ''):match('^Walter') ~= nil end");
    lebowski.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "OFR|a1", "GUILD", "Stranger-Realm")`);
    lebowski.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "OFR|a2", "PARTY", "Walter-Realm")`);
    flush(lebowski);
    expect(lines(lebowski)).toEqual([]);
  });

  it("status and the login reminder count runs that are not uploaded yet", () => {
    const walter = client(kind, "Walter");
    walter.run(makeRun("walter-rfc"));
    walter.run('NS.commandHandlers["dungeon"]({ "status" })');
    expect(walter.chat().some((line) => /Not uploaded yet: 1 of your runs\./.test(line))).toBe(true);
  });

  it("tells a player with a companion once per session that guildmate runs are waiting", () => {
    const lebowski = client(kind, "Lebowski");
    lebowski.run(makeRun("walter-rfc"));
    expect(lebowski.run("return tostring(NS.dungeon.remindGuildmateRuns())")).toBe("false"); // no companion ever
    companion(lebowski);
    expect(lebowski.run("return tostring(NS.dungeon.remindGuildmateRuns())")).toBe("true");
    expect(lebowski.run("return tostring(NS.dungeon.remindGuildmateRuns())")).toBe("false");
    expect(lebowski.chat().filter((line) => /guildmate run\(s\) are waiting: \/reload/.test(line)).length).toBe(1);
  });
});

describe("chunk reliability", () => {
  const bigRun = (id: string) => makeRun(id) + `; for i = 1, 14 do ${runs}[${JSON.stringify(id)}].players["Extra" .. i] = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true } end`;

  it("a transfer slower than a minute still completes while chunks keep coming (both addons)", () => {
    for (const kind of ["guilded", "standalone"] as Kind[]) {
      const walter = client(kind, "Walter");
      const receiver = client(kind, "Lebowski");
      walter.run(bigRun("walter-slow"));
      walter.run(`NS.dungeon.sendRun(${runs}["walter-slow"])`);
      flush(walter);
      const sum = lines(walter).filter((l) => l.startsWith("GuildedDgn>SUM|"));
      expect(sum.length).toBeGreaterThanOrEqual(3);
      for (const line of sum) { hear(receiver, "Walter", line); receiver.run("CLOCK = CLOCK + 40"); }
      expect(has(receiver, "walter-slow")).toBe(true);
    }
  });

  it("a chunk the game keeps refusing marks the run, which is then offered before the others", () => {
    const walter = client("guilded", "Walter");
    walter.run(makeRun("older") + "; " + `${runs}["older"].endedAt = CLOCK - 5000`);
    walter.run(makeRun("walter-lost"));
    walter.run(`NOW = 0; GetTime = function() return NOW end
      RETRIES = {}
      C_Timer.After = function(_, fn) RETRIES[#RETRIES + 1] = fn end
      C_ChatInfo.SendAddonMessage = function() return 3 end
      NS.dungeon.sendRun(${runs}["walter-lost"])
      for _ = 1, 60 do NOW = NOW + 100; local list = RETRIES; RETRIES = {}; for _, fn in ipairs(list) do pcall(fn) end end`);
    expect(walter.run(`return tostring(${runs}["walter-lost"].shareLostAt ~= nil)`)).toBe("true");
    expect(walter.run("return NS.dungeon.ownUnconfirmed()[1].id")).toBe("walter-lost");
  });
});

describe("the standalone addon's roster timing", () => {
  it("reads the roster once, not once per message, and drops it when the game says it changed", () => {
    const s = client("standalone", "Lebowski", { raw: true, roster: ["Walter-Realm", "Donny-Realm"] });
    s.run("CALLS = 0");
    for (let i = 0; i < 20; i++) s.run(`NS.isGuildMember("Walter-Realm"); NS.isOfficerName("Walter-Realm")`);
    expect(Number(s.run("return CALLS"))).toBeLessThanOrEqual(2);
    s.run(`ROSTER = { "Stranger-Realm" }`);
    expect(s.run(`return tostring(NS.isGuildMember("Walter-Realm"))`)).toBe("true"); // still cached
    s.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run(`return tostring(NS.isGuildMember("Walter-Realm")) .. tostring(NS.isGuildMember("Stranger-Realm"))`)).toBe("falsetrue");
  });

  it("keeps a summary that arrives before the roster has loaded and handles it when the roster comes", () => {
    const walter = client("standalone", "Walter");
    walter.run(makeRun("walter-early"));
    walter.run(`NS.dungeon.sendRun(${runs}["walter-early"])`);
    flush(walter);
    const sum = lines(walter).filter((l) => l.startsWith("GuildedDgn>SUM|"));
    const receiver = client("standalone", "Lebowski", { raw: true, roster: [] });
    for (const line of sum) hear(receiver, "Walter", line);
    expect(has(receiver, "walter-early")).toBe(false);
    receiver.run(`ROSTER = { "Walter-Realm", "Lebowski-Realm" }; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(has(receiver, "walter-early")).toBe(true);
  });
});

describe("message volume in a big guild", () => {
  it("an author with five unconfirmed runs offers once, in one short message", () => {
    const walter = client("guilded", "Walter");
    for (let i = 1; i <= 5; i++) walter.run(makeRun(`mine-${i}`, "Walter"));
    walter.run("NS.dungeon.offerRuns(true)");
    flush(walter);
    const sent = lines(walter).filter((l) => l.startsWith("GuildedDgn>OFR|"));
    expect(sent.length).toBe(1);
    expect((sent[0]?.split("|")[1] ?? "").split(",").length).toBeLessThanOrEqual(5);
    expect(sent[0]?.length ?? 0).toBeLessThan(250);
    // A second try inside the debounce window sends nothing.
    walter.run("NS.dungeon.offerRuns()");
    flush(walter);
    expect(lines(walter).filter((l) => l.startsWith("GuildedDgn>OFR|")).length).toBe(0);
  });

  it("a companion PC that hears 30 members offer 5 runs each answers in a few short messages, within the send budget", () => {
    const lebowski = client("guilded", "Lebowski");
    companion(lebowski);
    for (let member = 1; member <= 30; member++) {
      const offered = [1, 2, 3, 4, 5].map((n) => `m${member}-r${n}`).join(",");
      hear(lebowski, `Member${member}`, `GuildedDgn>OFR|${offered}`);
    }
    flush(lebowski);
    const sent = lines(lebowski).filter((l) => l.startsWith("GuildedDgn>"));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(Math.max(...sent.map((l) => l.length))).toBeLessThanOrEqual(255);
    const asked = sent.flatMap((l) => (l.split("|")[1] ?? "").split(","));
    expect(asked.length).toBeLessThanOrEqual(24);
    // The game's own limit for a burst of addon messages is not exceeded either.
    expect(Number(lebowski.run('return NS.comm.status("GuildedDgn").sent'))).toBeLessThanOrEqual(8);
  });
});
