import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";

// 9.3.1: the same run messages (SUM, OFR, WNT, ACKS) also travel in a party or raid, so a player with no companion and no guild is
// carried by any companion in the group. Both addons share the code (Modules/Dungeon.lua).

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

type Kind = "guilded" | "standalone";

function client(kind: Kind, name: string, groupmate: string | null, guildmates = true): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; CLOCK = ${CLOCK}; GT = 0; COMBAT = false
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function InCombatLockdown() return COMBAT end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
    GROUPMATE = ${groupmate ? JSON.stringify(groupmate) : "nil"}
    function IsInGroup() return GROUPMATE ~= nil end
    UnitName = function(unit) if unit == "player" then return "${name}" end; if unit == "party1" and GROUPMATE then return GROUPMATE end end
    UnitExists = function(unit) return unit == "player" or (unit == "party1" and GROUPMATE ~= nil) end`);
  if (kind === "guilded") {
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) s.load(file);
  } else {
    for (const file of tocFiles()) s.run(`loadaddon("GuildedDungeons", [=====[${readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    NS.isGuildMember = function() return ${guildmates ? "true" : "false"} end
    NS.isOfficerName = function() return false end
    fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  return s;
}

const runs = "NS.getDb().dungeon.runs";
const makeRun = (id: string) => `${runs}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
  startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Walter", encounters = {}, reporters = { Walter = true },
  players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900 }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900 } } }`;
const lines = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. (m.target or "?") .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`).split("\n").filter(Boolean);
const flush = (s: LuaSession) => s.run("run_timers()");
const hear = (to: LuaSession, from: string, text: string, channel: string) =>
  to.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", ${JSON.stringify(text)}, ${JSON.stringify(channel)}, "${from}-Realm")`);
/** What `from` queued on `channel`, delivered to `to` as that channel. */
function deliver(from: LuaSession, fromName: string, to: LuaSession, channel: string, kind?: string) {
  const sent = lines(from).filter((line) => line.startsWith(`GuildedDgn>${channel}>`)).map((line) => line.split(">").slice(2).join(">"));
  const wanted = sent.filter((text) => !kind || text.startsWith(`${kind}|`));
  for (const text of wanted) hear(to, fromName, text, channel);
  return wanted;
}
const has = (s: LuaSession, id: string) => s.run(`return tostring(${runs}[${JSON.stringify(id)}] ~= nil)`) === "true";
const companion = (s: LuaSession) => s.run(`GuildedLinkedMeta = { mode = 'test' }; GuildedCompanionFeatures = { ["group-relay"] = true, at = CLOCK }`);
/** Carried runs of other players live in their own table, which a companion that does not know the relay never reads. */
const carried = (s: LuaSession, id: string) => s.run(`local d = NS.getDb().dungeon; return tostring(d.carried ~= nil and d.carried[${JSON.stringify(id)}] ~= nil)`) === "true";

describe.each<Kind>(["guilded", "standalone"])("runs carried through the group (%s)", (kind) => {
  it("a player with no companion offers a run to the group, a companion asks for it and keeps it marked as from the group", () => {
    const walter = client(kind, "Walter", "Lebowski");
    const lebowski = client(kind, "Lebowski", "Walter", false);
    companion(lebowski);
    walter.run(makeRun("walter-rfc"));
    walter.run("NS.dungeon.offerToGroup()");
    flush(walter);
    const offer = deliver(walter, "Walter", lebowski, "PARTY");
    expect(offer).toEqual(["OFR|walter-rfc"]);
    flush(lebowski);
    expect(deliver(lebowski, "Lebowski", walter, "PARTY")).toEqual(["WNT|walter-rfc"]);
    flush(walter);
    expect(deliver(walter, "Walter", lebowski, "PARTY", "SUM").length).toBeGreaterThan(0);
    // Kept apart: an exporter that only reads dungeon.runs (every companion before the group relay) never sees it.
    expect(has(lebowski, "walter-rfc")).toBe(false);
    expect(carried(lebowski, "walter-rfc")).toBe(true);
  });

  it("a run that ends in the group is also sent to the group once", () => {
    const walter = client(kind, "Walter", "Lebowski");
    walter.run(makeRun("walter-rfc"));
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    const sent = lines(walter);
    expect(sent.some((line) => line.startsWith("GuildedDgn>PARTY>SUM|walter-rfc|1|"))).toBe(true);
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    expect(lines(walter).some((line) => line.startsWith("GuildedDgn>PARTY>SUM|"))).toBe(false);
  });

  it("sends nothing to a group when alone", () => {
    const walter = client(kind, "Walter", null);
    walter.run(makeRun("walter-rfc"));
    walter.run("NS.dungeon.offerToGroup()");
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    expect(lines(walter).some((line) => line.startsWith("GuildedDgn>PARTY>"))).toBe(false);
  });

  it("a player without a companion does not carry, and carrying can be turned off", () => {
    const walter = client(kind, "Walter", "Lebowski");
    const plain = client(kind, "Lebowski", "Walter", false);
    walter.run(makeRun("walter-rfc"));
    walter.run("NS.dungeon.offerToGroup()");
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    deliver(walter, "Walter", plain, "PARTY");
    expect(carried(plain, "walter-rfc")).toBe(false);
    companion(plain);
    plain.run("NS.dungeon.carryOn = function() return false end");
    deliver(walter, "Walter", plain, "PARTY");
    expect(carried(plain, "walter-rfc")).toBe(false);
  });

  it("only a player in the same group may send it, and a copy through the guild clears the mark", () => {
    const walter = client(kind, "Walter", "Lebowski");
    const lebowski = client(kind, "Lebowski", "Someone", false);
    companion(lebowski);
    walter.run(makeRun("walter-rfc"));
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    // Lebowski's group is someone else: Walter is not in it.
    deliver(walter, "Walter", lebowski, "PARTY");
    expect(carried(lebowski, "walter-rfc")).toBe(false);
    lebowski.run('GROUPMATE = "Walter"');
    const all = lines(walter);
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"], "GROUP")`);
    flush(walter);
    for (const text of lines(walter).filter((line) => line.startsWith("GuildedDgn>PARTY>")).map((line) => line.split(">").slice(2).join(">"))) hear(lebowski, "Walter", text, "PARTY");
    expect(all).toBeDefined();
    expect(carried(lebowski, "walter-rfc")).toBe(true);
    lebowski.run("NS.isGuildMember = function() return true end");
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    for (const text of lines(walter).filter((line) => line.startsWith("GuildedDgn>GUILD>")).map((line) => line.split(">").slice(2).join(">"))) hear(lebowski, "Walter", text, "GUILD");
    // The guild's copy is a guild run: it moves out of the carried table into the ordinary one.
    expect(carried(lebowski, "walter-rfc")).toBe(false);
    expect(has(lebowski, "walter-rfc")).toBe(true);
  });

  it("a confirmation heard in a group proves nothing: only the companion's own receipt marks a run taken", () => {
    const walter = client(kind, "Walter", "Lebowski");
    walter.run(makeRun("walter-rfc"));
    hear(walter, "Lebowski", "ACK|walter-rfc", "PARTY");
    hear(walter, "Lebowski", "ACKS|walter-rfc", "PARTY");
    const mark = (field: string) => walter.run(`return tostring(${runs}["walter-rfc"].${field})`);
    expect(mark("synced")).toBe("nil");
    expect(mark("syncedVia")).toBe("nil");
    expect(mark("groupAckedAt")).not.toBe("nil");
    // Only the group: receipt of the companion ends the offers, and it never marks the run as held by a guild.
    walter.run(`NS.getDb().dungeon.carried = { ["walter-rfc"] = { id = "walter-rfc", endedAt = CLOCK } }; GuildedDungeonAccepted = { "group:walter-rfc" }; NS.dungeon.markSynced()`);
    expect(walter.run(`return tostring(NS.getDb().dungeon.carried["walter-rfc"].groupSynced)`)).toBe("true");
    expect(mark("synced")).toBe("nil");
  });

  it("sends nothing to a group bigger than a party of five", () => {
    const walter = client(kind, "Walter", "Lebowski");
    walter.run("function GetNumGroupMembers() return 6 end");
    walter.run(makeRun("walter-rfc"));
    walter.run("NS.dungeon.offerToGroup()");
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    expect(lines(walter).some((line) => line.startsWith("GuildedDgn>PARTY>"))).toBe(false);
  });

  it("keeps at most ten waiting runs from one sender", () => {
    const walter = client(kind, "Walter", "Lebowski");
    const lebowski = client(kind, "Lebowski", "Walter", false);
    companion(lebowski);
    for (let index = 0; index < 12; index++) {
      walter.run(makeRun(`walter-${index}`));
      walter.run(`NS.dungeon.sendRun(${runs}["walter-${index}"], "GROUP")`);
      flush(walter);
      deliver(walter, "Walter", lebowski, "PARTY", "SUM");
    }
    const count = Number(lebowski.run(`local n = 0; for id in pairs(NS.getDb().dungeon.carried or {}) do if string.sub(id, 1, 7) == "walter-" then n = n + 1 end end; return n`));
    expect(count).toBe(10);
  });

  it("a companion that does not announce the group relay (an older one, or a stale marker) carries nothing", () => {
    const walter = client(kind, "Walter", "Lebowski");
    const lebowski = client(kind, "Lebowski", "Walter", false);
    lebowski.run("GuildedLinkedMeta = { mode = 'test' }");
    walter.run(makeRun("walter-rfc"));
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"], "GROUP")`);
    flush(walter);
    deliver(walter, "Walter", lebowski, "PARTY");
    expect(carried(lebowski, "walter-rfc")).toBe(false);
    // The marker went stale (the companion has not written for weeks): the same.
    lebowski.run("GuildedCompanionFeatures = { [\"group-relay\"] = true, at = CLOCK - 20 * 86400 }");
    deliver(walter, "Walter", lebowski, "PARTY");
    expect(carried(lebowski, "walter-rfc")).toBe(false);
    expect(lebowski.run("return tostring(NS.dungeon.canCarry())")).toBe("false");
  });

  it("the waiting reminder never counts runs carried for others", () => {
    const lebowski = client(kind, "Lebowski", "Walter", false);
    companion(lebowski);
    lebowski.run(`NS.getDb().dungeon.carried = { ["x-1"] = { id = "x-1", state = "COMPLETED", endedAt = CLOCK - 100 } }`);
    expect(lebowski.run("return tostring(#NS.dungeon.waitingRuns())")).toBe("0");
  });

  it("the end-of-run group send is only marked once it really went out", () => {
    const walter = client(kind, "Walter", null);
    walter.run(makeRun("walter-rfc"));
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    expect(walter.run(`return tostring(${runs}["walter-rfc"].groupShared)`)).toBe("nil");
    walter.run("GROUPMATE = 'Lebowski'");
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"])`);
    flush(walter);
    expect(walter.run(`return tostring(${runs}["walter-rfc"].groupShared)`)).toBe("true");
  });

  it("a summary heard in the group changes nothing in a run this PC already holds", () => {
    const walter = client(kind, "Walter", "Lebowski");
    const lebowski = client(kind, "Lebowski", "Walter", false);
    companion(lebowski);
    walter.run(makeRun("walter-rfc"));
    lebowski.run(makeRun("walter-rfc"));
    lebowski.run(`${runs}["walter-rfc"].state = "ABANDONED"; ${runs}["walter-rfc"].completedBy = nil`);
    const snapshot = () => lebowski.run(`local r = ${runs}["walter-rfc"]; local names = {}; for n in pairs(r.players) do names[#names + 1] = n end; table.sort(names); local rep = {}; for n in pairs(r.reporters or {}) do rep[#rep + 1] = n end; table.sort(rep); return r.state .. "|" .. table.concat(names, ",") .. "|" .. table.concat(rep, ",") .. "|" .. #(r.encounters or {})`);
    const before = snapshot();
    walter.run(`${runs}["walter-rfc"].players.Stranger = { class = "ROGUE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900 }; ${runs}["walter-rfc"].encounters = { { id = 1, success = true, at = CLOCK - 1200 } }`);
    walter.run(`NS.dungeon.sendRun(${runs}["walter-rfc"], "GROUP")`);
    flush(walter);
    deliver(walter, "Walter", lebowski, "PARTY", "SUM");
    expect(snapshot()).toBe(before);
    expect(carried(lebowski, "walter-rfc")).toBe(false);
  });
});
