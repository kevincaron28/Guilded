import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.0 "maximum sharing": Modules/CatchUp.lua (store and forward between two online addons),
// Dungeon.lua's ACK and pruning, and the sync counters, on two mocked clients that pass their
// guild messages to each other.
const CLOCK = 1800000000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

function client(name: string, options: { carrier?: boolean } = {}) {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; GT = 0; INSTANCE = false
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function IsInInstance() if INSTANCE then return true, "party" end return false, "none" end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end`);
  s.load("Core.lua");
  s.load("DungeonRoutes.lua");
  s.load("Compat.lua");
  s.load("Modules/Dungeon.lua");
  s.load("Modules/GuildRelay.lua");
  s.load("Modules/CatchUp.lua");
  s.load("Modules/SyncNow.lua");
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    MEMBERS = { Walter = true, Lebowski = true, Donny = true, Maude = true, Jesus = true }
    NS.isGuildMember = function(n) return MEMBERS[(n or ""):match("^[^-]+")] == true end
    NS.isOfficerName = function() return false end
    NS.currentGuildKey = function() return "Achievers-Realm" end
    GuildedStandings = ${options.carrier ? `{ updatedAt = "2026-12-20T10:00:00Z", players = {} }` : "nil"}
    NS.getDb().standings = { updatedAt = "2026-12-20T10:00:00Z" }
    NS.getDb().peerRoster = {}
    fire_event("PLAYER_ENTERING_WORLD")
    run_timers(); SENT = {}`);
  return s;
}

// A finished run with `players`, ended `ago` seconds before CLOCK.
const seedRun = (s: LuaSession, id: string, players: string[], ago = 3600, extra = "") => s.run(`
  local players = {}
  for _, n in ipairs({ ${players.map((p) => JSON.stringify(p)).join(", ")} }) do players[n] = { class = "WARRIOR", role = "DAMAGER", deaths = 0, presentSec = 900, inGuild = true } end
  NS.dungeon.savedRuns()[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm",
    difficultyId = 1, startedAt = CLOCK - ${ago} - 900, endedAt = CLOCK - ${ago}, recorder = ${JSON.stringify(players[0])},
    players = players, encounters = {}, reporters = { [${JSON.stringify(players[0])}] = true } ${extra} }`);

const sent = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`)
  .split("\n").filter(Boolean);

// Everything `from` sent goes to each of `to` as guild messages from `fromName`.
function deliver(from: LuaSession, fromName: string, ...to: LuaSession[]) {
  const lines = sent(from);
  for (const line of lines) {
    const [prefix, ...rest] = line.split(">");
    for (const target of to) target.run(`fire_event("CHAT_MSG_ADDON", ${JSON.stringify(prefix)}, ${JSON.stringify(rest.join(">"))}, "GUILD", "${fromName}-Realm")`);
  }
  return lines;
}
const timers = (...s: LuaSession[]) => { for (const one of s) one.run("run_timers()"); };

describe("catch-up keys and digests", () => {
  it("keys are four safe characters and the digest is a count and a 24-bit sum", () => {
    const s = client("Walter");
    expect(s.run(`return NS.catchUp.keyOf(NS.catchUp.hashText("run-1"))`)).toMatch(/^[0-9A-Za-z_-]{4}$/);
    expect(s.run(`return NS.catchUp.digestOf("R")`)).toBe("0:0");
    seedRun(s, "run-1", ["Donny"]);
    seedRun(s, "run-2", ["Donny"], 15 * 86400); // outside the 14-day window
    const [count, sum] = s.run(`return NS.catchUp.digestOf("R")`).split(":").map(Number);
    expect(count).toBe(1);
    expect(sum).toBe(Number(s.run(`return NS.catchUp.hashText("run-1")`)));
    expect(sum).toBeLessThan(2 ** 24);
  });
});

describe("store and forward between two online addons", () => {
  it("a companion user logging in fetches a Dungeons-only player's run and a digest a member held", () => {
    const member = client("Walter");
    const carrier = client("Lebowski", { carrier: true });
    // Donny (Guilded Dungeons only) ran Ragefire while no companion was online; Walter heard it.
    seedRun(member, "donny-rfc", ["Donny", "Jesus"]);
    member.run(`NS.getDb().peerRoster.Maude = { identity = { class = "MAGE", race = "Human", level = 24, spec = "Frost" },
      professions = "Tailoring:150,Enchanting:120", professionsAt = CLOCK - 7200, professionsComplete = true,
      seenAt = CLOCK - 3600, updatedAt = CLOCK - 3600, verify = "ABCDEFGH", status = "READY" }`);

    carrier.run(`NS.catchUp.sendDigest(true)`);
    const dig = deliver(carrier, "Lebowski", member);
    expect(dig).toEqual(["GuildedCatch>DIG|1|1|R:0:0|P:0:0|C:0:0|A:0:0"]);
    timers(member);
    const have = deliver(member, "Walter", carrier);
    expect(have).toHaveLength(2);
    expect(have[0]).toMatch(/^GuildedCatch>HAVE\|R\|Lebowski\|1:\d+\|1\|1\|[\w-]{4}$/);
    const want = deliver(carrier, "Lebowski", member);
    expect(want.every((line) => line.startsWith("GuildedCatch>WANT|"))).toBe(true);
    const forwarded = deliver(member, "Walter", carrier);
    expect(forwarded.some((line) => line.startsWith("GuildedCatch>RUN|donny-rfc|Donny|1|"))).toBe(true);
    expect(forwarded.some((line) => line.startsWith("GuildedCatch>PEER|Maude|"))).toBe(true);

    expect(carrier.run(`local r = NS.dungeon.savedRuns()["donny-rfc"]; return r.forwardedBy .. "/" .. tostring(r.reporters.Donny) .. "/" .. tostring(r.reporters.Walter)`))
      .toBe("Walter/true/nil");
    const maude = JSON.parse(carrier.run(`local e = NS.getDb().peerRoster.Maude
      return string.format('{"class":"%s","level":%d,"prof":"%s","at":%d,"verify":%s,"fwd":%s,"via":"%s"}', e.identity.class, e.identity.level, e.professions, e.seenAt, e.verify and '"x"' or "null", tostring(e.forwarded), e.via)`));
    expect(maude).toEqual({ class: "MAGE", level: 24, prof: "Tailoring:150,Enchanting:120", at: CLOCK - 3600, verify: null, fwd: true, via: "Walter" });
    expect(carrier.run(`return NS.catchUp.digestOf("R") == ${JSON.stringify(member.run(`return NS.catchUp.digestOf("R")`))} and "same" or "differs"`)).toBe("same");
    expect(carrier.run(`return tostring(NS.catchUp.totals().relayedIn)`)).toBe("2");
    expect(member.run(`return tostring(NS.catchUp.totals().relayedOut)`)).toBe("2");
  });

  it("a member logging in pushes what the companion user lacks and learns which runs its bot has", () => {
    const member = client("Walter");
    const carrier = client("Lebowski", { carrier: true });
    seedRun(member, "walter-rfc", ["Walter", "Donny"], 7200);
    seedRun(member, "both-rfc", ["Walter"], 9000);
    seedRun(carrier, "both-rfc", ["Walter"], 9000, ", synced = true");
    member.run(`NS.catchUp.sendDigest(true)`);
    deliver(member, "Walter", carrier);
    timers(carrier);
    const have = deliver(carrier, "Lebowski", member);
    expect(have[0]).toMatch(/\*$/); // the carrier's bot already has both-rfc
    const pushed = deliver(member, "Walter", carrier);
    expect(pushed.filter((l) => l.startsWith("GuildedCatch>RUN|walter-rfc|Walter|"))).not.toHaveLength(0);
    expect(member.run(`return NS.dungeon.savedRuns()["both-rfc"].syncedVia`)).toBe("Lebowski");
    expect(carrier.run(`return tostring(NS.dungeon.savedRuns()["walter-rfc"] ~= nil)`)).toBe("true");
    // A run its bot confirmed is no longer replayed at login.
    member.run(`NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()`);
    const replay = sent(member).filter((l) => l.startsWith("GuildedDgn>SUM|"));
    expect(replay.some((l) => l.includes("both-rfc"))).toBe(false);
    expect(replay.some((l) => l.includes("walter-rfc"))).toBe(true);
  });

  it("only one guildmate answers a DIG: the others stay quiet once they hear an answer", () => {
    const asker = client("Walter");
    const first = client("Lebowski", { carrier: true });
    const second = client("Maude");
    seedRun(first, "a", ["Donny"]);
    seedRun(second, "b", ["Donny"]);
    asker.run(`NS.catchUp.sendDigest(true)`);
    deliver(asker, "Walter", first, second);
    timers(first);
    deliver(first, "Lebowski", asker, second);
    timers(second);
    expect(sent(second)).toEqual([]);
    // And the same asker is answered at most once per ten minutes.
    sent(asker);
    asker.run(`NS.catchUp.sendDigest(true)`);
    deliver(asker, "Walter", first);
    timers(first);
    expect(sent(first)).toEqual([]);
  });

  it("refuses forwarded items it could not believe first-hand", () => {
    const s = client("Lebowski", { carrier: true });
    const hear = (text: string, from = "Walter-Realm") => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", ${JSON.stringify(text)}, "GUILD", "${from}")`);
    const summary = (players: string, ended: number) =>
      `v=1;av=9.0.0;st=COMPLETED;gb=;tr=;api=;ed=forever;cm=0;i=389;n=Ragefire Chasm;d=1;s=${ended - 900};e=${ended};cb=;r=Donny;enc=;p=${players}`;
    hear(`RUN|fake|Walter|1|1|${summary("Donny:WARRIOR:DAMAGER:0:900:1", CLOCK - 3600)}`); // reporter not in the run
    hear(`RUN|old|Donny|1|1|${summary("Donny:WARRIOR:DAMAGER:0:900:1", CLOCK - 15 * 86400)}`); // older than 14 days
    hear(`RUN|future|Donny|1|1|${summary("Donny:WARRIOR:DAMAGER:0:900:1", CLOCK + 86400)}`);
    hear(`RUN|stranger|Donny|1|1|${summary("Donny:WARRIOR:DAMAGER:0:900:1", CLOCK - 3600)}`, "Stranger-Realm"); // not a guild member
    hear(`RUN|ok|Donny|1|1|${summary("Donny:WARRIOR:DAMAGER:0:900:1", CLOCK - 3600)}`);
    expect(s.run(`local ids = {}; for id in pairs(NS.dungeon.savedRuns()) do ids[#ids + 1] = id end; table.sort(ids); return table.concat(ids, ",")`)).toBe("ok");

    hear(`PEER|Stranger|${CLOCK - 60}|MAGE,Human,20,|0|`); // not in the guild
    hear(`PEER|Maude|${CLOCK + 86400}|MAGE,Human,20,|0|`); // from the future
    s.run(`NS.getDb().peerRoster.Donny = { identity = { class = "WARRIOR", level = 30 }, seenAt = CLOCK - 60, verify = "QWERTYUI", professions = "Mining:200", professionsAt = CLOCK - 120 }`);
    hear(`PEER|Donny|${CLOCK - 3600}|WARRIOR,Dwarf,28,|0|`); // older than what this PC heard itself
    expect(s.run(`return tostring(NS.getDb().peerRoster.Stranger) .. tostring(NS.getDb().peerRoster.Maude) .. NS.getDb().peerRoster.Donny.identity.level`)).toBe("nilnil30");
    // Newer: taken, the first-hand verify code is kept, the newer professions are not replaced by older ones.
    hear(`PEER|Donny|${CLOCK - 10}|WARRIOR,Dwarf,31,Arms|${CLOCK - 9000}|Mining:150`);
    expect(s.run(`local e = NS.getDb().peerRoster.Donny; return e.identity.level .. "/" .. e.verify .. "/" .. e.professions`)).toBe("31/QWERTYUI/Mining:200");
  });
});

describe("Dungeon.lua: confirmations, instance hold and pruning", () => {
  it("a companion user confirms a replayed run its bot has, and the author stops replaying it", () => {
    const carrier = client("Lebowski", { carrier: true });
    const author = client("Donny");
    seedRun(author, "donny-1", ["Donny"]);
    seedRun(carrier, "donny-1", ["Donny"], 3600, ", synced = true");
    // (9.3) A confirmation counts at once only from someone heard holding the run.
    author.run(`NS.dungeon.markHeard("donny-1", "Lebowski")`);
    author.run(`NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()`);
    deliver(author, "Donny", carrier);
    const ack = deliver(carrier, "Lebowski", author);
    expect(ack).toEqual(["GuildedDgn>ACK|donny-1"]);
    expect(author.run(`return NS.dungeon.savedRuns()["donny-1"].syncedVia`)).toBe("Lebowski");
    author.run(`NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()`);
    expect(sent(author)).toEqual([]);
    // Said once per run per session.
    author.run(`NS.dungeon.savedRuns()["donny-1"].syncedVia = nil; NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()`);
    deliver(author, "Donny", carrier);
    expect(sent(carrier)).toEqual([]);
  });

  it("guild summaries wait outside the instance; group messages do not", () => {
    const s = client("Donny");
    seedRun(s, "donny-2", ["Donny"]);
    s.run(`INSTANCE = true; NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()`);
    expect(sent(s)).toEqual([]);
    // (9.3) Inside an instance the summary is not even queued; it follows once the player is outside.
    s.run(`INSTANCE = false; GT = GT + 30; NS.comm.send("GuildedDgn", "nudge", "PARTY")`);
    timers(s);
    expect(sent(s).some((l) => l.startsWith("GuildedDgn>SUM|donny-2|"))).toBe(true);
  });

  it("drops confirmed copies after 30 days and guildmates' unconfirmed runs after 45, never our own", () => {
    const s = client("Walter");
    seedRun(s, "confirmed-old", ["Donny"], 31 * 86400, ", syncedVia = 'Lebowski'");
    seedRun(s, "peer-old", ["Donny"], 46 * 86400);
    seedRun(s, "peer-recent", ["Donny"], 20 * 86400);
    seedRun(s, "mine-old", ["Walter"], 60 * 86400);
    s.run(`NS.dungeon.markSynced()`);
    expect(s.run(`local ids = {}; for id in pairs(NS.dungeon.savedRuns()) do ids[#ids + 1] = id end; table.sort(ids); return table.concat(ids, ",")`)).toBe("mine-old,peer-recent");
  });
});

describe("/guilded sync stats", () => {
  it("counts messages and bytes both ways, relayed items and the last catch-up, and saves them at logout", () => {
    const member = client("Walter");
    const carrier = client("Lebowski", { carrier: true });
    seedRun(member, "x", ["Donny"]);
    carrier.run(`NS.catchUp.sendDigest(true)`);
    deliver(carrier, "Lebowski", member);
    timers(member);
    deliver(member, "Walter", carrier);
    deliver(carrier, "Lebowski", member);
    deliver(member, "Walter", carrier);
    carrier.run(`CHAT_LOG = nil; NS.commandHandlers.sync({ "stats" })`);
    const lines = carrier.chat();
    expect(lines[0]).toMatch(/^\[Guilded\] Guild sync this session: \d+ messages sent \(\d+ B\), [1-9]\d* received \(\d+ B\), 0 held in instances\.$/);
    expect(lines[1]).toBe("[Guilded] Relayed: 1 items received from guildmates, 0 passed on; 0 dungeon confirmations heard, 0 sent.");
    expect(lines[3]).toBe("[Guilded] Last catch-up: just now with Walter.");
    carrier.run(`fire_event("PLAYER_LOGOUT")`);
    expect(carrier.run(`local s = NS.getDb().syncStats; return s.sent .. "/" .. s.relayedIn .. "/" .. s.lastCatchUpWith`)).toMatch(/^\d+\/1\/Walter$/);
    // Folding twice does not count the session twice.
    const once = carrier.run(`return tostring(NS.getDb().syncStats.sent)`);
    carrier.run(`NS.catchUp.fold()`);
    expect(carrier.run(`return tostring(NS.getDb().syncStats.sent)`)).toBe(once);
  });
});
