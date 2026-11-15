import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";

// 9.3.3 relay audit: the companion's alive marker, bounded group re-offers, the run list saying a run went to a group member's
// companion, the recovered-run line without a companion, and recovered runs following the group relay path.

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

type Kind = "guilded" | "standalone";

function client(kind: Kind, name: string, groupmate: string | null): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; CLOCK = ${CLOCK}; GT = 0
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function InCombatLockdown() return false end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
    GROUPMATE = ${groupmate ? JSON.stringify(groupmate) : "nil"}
    function IsInGroup() return GROUPMATE ~= nil end
    UnitName = function(unit) if unit == "player" then return "${name}" end; if unit == "party1" and GROUPMATE then return GROUPMATE end end
    UnitExists = function(unit) return unit == "player" or (unit == "party1" and GROUPMATE ~= nil) end`);
  if (kind === "guilded") {
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua", "Modules/RunResults.lua"]) s.load(file);
  } else {
    for (const file of tocFiles()) s.run(`loadaddon("GuildedDungeons", [=====[${readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    NS.isGuildMember = function() return false end
    NS.isOfficerName = function() return false end
    fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  return s;
}

const runs = "NS.getDb().dungeon.runs";
const makeRun = (id: string) => `${runs}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
  startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Walter", encounters = {}, reporters = { Walter = true },
  players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900 }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900 } } }`;
const sentGroupOffers = (s: LuaSession) => s.run(`local n = 0; for _, m in ipairs(SENT or {}) do if m.target == "PARTY" and string.sub(m.text, 1, 4) == "OFR|" then n = n + 1 end end; SENT = {}; return n`);

describe.each<Kind>(["guilded", "standalone"])("the relay audit (%s)", (kind) => {
  it("a marker with the heartbeat counts as a stopped companion after about three hours, an older one keeps seven days", () => {
    const s = client(kind, "Lebowski", "Walter");
    const alive = (marker: string) => { s.run(`GuildedCompanionFeatures = ${marker}`); return s.run(`return tostring(NS.util.companionFeatureFresh("group-relay"))`); };
    expect(alive('{ ["group-relay"] = true, hb = 1, at = CLOCK - 2 * 3600 }')).toBe("true");
    expect(alive('{ ["group-relay"] = true, hb = 1, at = CLOCK - 4 * 3600 }')).toBe("false");
    expect(alive('{ ["group-relay"] = true, at = CLOCK - 4 * 86400 }')).toBe("true");
    expect(alive('{ ["group-relay"] = true, at = CLOCK - 8 * 86400 }')).toBe("false");
    expect(alive('{ ["group-relay"] = true, hb = 1, at = CLOCK + 2 * 86400 }')).toBe("false");
    expect(alive('{ hb = 1, at = CLOCK }')).toBe("false");
    s.run('GuildedCompanionFeatures = { ["group-relay"] = true, hb = 1, at = CLOCK - 4 * 3600 }');
    expect(s.run("return tostring(NS.dungeon.canCarry())")).toBe("false");
  });

  it("offers a run to groups on a widening schedule and stops after seven days", () => {
    const walter = client(kind, "Walter", "Lebowski");
    walter.run(makeRun("walter-rfc"));
    const attempt = (afterSeconds: number) => {
      walter.run(`CLOCK = CLOCK + ${afterSeconds}; ${runs}["walter-rfc"].endedAt = CLOCK - 1100; NS.dungeon.lastGroupOffer = nil; SENT = {}; NS.dungeon.offerToGroup(); run_timers()`);
      return Number(sentGroupOffers(walter));
    };
    // Each pair is the wait since the previous attempt and whether an offer went out (first offer at 0).
    const steps: [number, number][] = [[0, 1], [3600, 0], [5 * 3600, 1], [11 * 3600, 0], [3600, 1], [23 * 3600, 0], [3600, 1], [24 * 3600, 1], [48 * 3600, 1], [48 * 3600, 1], [48 * 3600, 0]];
    for (const [wait, expected] of steps) expect(attempt(wait)).toBe(expected);
  });

  it("a group member's confirmation never marks the run taken, and the run list says where it went", () => {
    const walter = client(kind, "Walter", "Lebowski");
    walter.run(makeRun("walter-rfc"));
    walter.run("NS.dungeon.offerToGroup()");
    walter.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "ACK|walter-rfc", "PARTY", "Lebowski-Realm")`);
    expect(walter.run(`return tostring(${runs}["walter-rfc"].synced)`)).toBe("nil");
    expect(walter.run(`return tostring(${runs}["walter-rfc"].syncedVia)`)).toBe("nil");
    {
      expect(walter.run(`return NS.runResults.syncText(${runs}["walter-rfc"])`)).toBe("Sent to a group member's companion, not confirmed yet.");
      walter.run(`${runs}["walter-rfc"].synced = true`);
      expect(walter.run(`return NS.runResults.syncText(${runs}["walter-rfc"])`)).not.toContain("group member");
    }
  });

  it("the login line about recovered runs only promises an upload when a companion is known", () => {
    const s = client(kind, "Walter", "Lebowski");
    s.run(`MESSAGES = {}; NS.message = function(text) MESSAGES[#MESSAGES + 1] = text end
      GetBuildInfo = function() return "1.60.1", "70790", "date", 16001 end
      local stored = ${runs}; stored.R1 = { id = "R1", state = "ABANDONED", gameEdition = "forever", instanceId = 389, name = "Ragefire Chasm", difficultyId = 0, startedAt = CLOCK - 3000, endedAt = CLOCK - 100, durationSec = 2900,
        players = { Walter = { presentSec = 2000 }, Donny = { presentSec = 2000 } }, encounters = { { id = 2735, name = "Bazzalan", success = true, at = CLOCK - 1200, source = "native" } } }`);
    const recovered = s.run("return NS.dungeon.recoverRuns()");
    expect(recovered).toBe("1");
    const line = s.run("return MESSAGES[1] or ''");
    expect(line).toContain("recovered 1 dungeon run");
    expect(line).not.toContain("next sync");
    // A recovered run is a finished run of this player: it follows the group path like any other.
    s.run("NS.dungeon.lastGroupOffer = nil; SENT = {}; NS.dungeon.offerToGroup(); run_timers()");
    expect(sentGroupOffers(s)).toBe("1");
  });
});
