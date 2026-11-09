import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.0.8 (owner report, 9 November 2026): "Saved runs: 64 (14 waiting to reach Discord)", and 8 stayed
// waiting after the companion ran. The bot now acknowledges every run it received (a guildmate's copy
// of a stored run, refused runs) with a short reason; the addon counts only runs no bot confirmed and,
// once per session, says when the companion did not deliver them.
const CLOCK = 1800000000;
let s: LuaSession;
afterEach(() => s?.close());

function start(language?: string) {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; CHAT_LOG = {}
    ${language ? `function GetLocale() return "${language}" end` : ""}
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() local list = TIMERS; TIMERS = {}; for _, fn in ipairs(list) do fn() end end`);
  s.load("Core.lua");
  s.load("Locale.lua");
  s.load("DungeonRoutes.lua");
  s.load("Compat.lua");
  s.load("Modules/Dungeon.lua");
  s.load("Modules/RunResults.lua");
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "Hulke Hogan" end
    NS.dungeon.loadedAt = CLOCK
    TIMERS = {}; CHAT_LOG = {}`);
  return s;
}

const seed = (id: string, ago: number, extra = "") => s.run(`
  NS.dungeon.savedRuns()[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 33, name = "Gnomeregan",
    difficultyId = 1, startedAt = CLOCK - ${ago} - 900, endedAt = CLOCK - ${ago}, recorder = "Hulke Hogan",
    players = { ["Hulke Hogan"] = { presentSec = 900 } }, encounters = {} ${extra} }`);
const chat = () => s.run(`local t = table.concat(CHAT_LOG, "\\n"); CHAT_LOG = {}; return t`);

describe("acknowledged dungeon runs", () => {
  it("marks every received run synced and keeps the bot's reason for a run that earned nothing", () => {
    start();
    seed("copy", 7200); seed("stored", 7200); seed("refused", 7200); seed("waiting", 7200);
    s.run(`GuildedDungeonAccepted = { "copy", "stored", "refused" }
      GuildedDungeonNotes = { copy = "Counted with a guildmate's copy of this run", refused = "Not |cffff0000completed|r" }
      NS.dungeon.markSynced()`);
    const runs = (field: string) => s.run(`local r = NS.dungeon.savedRuns(); return tostring(r.copy.${field}) .. "," .. tostring(r.stored.${field}) .. "," .. tostring(r.refused.${field}) .. "," .. tostring(r.waiting.${field})`);
    expect(runs("synced")).toBe("true,true,true,nil");
    expect(runs("syncNote")).toBe("Counted with a guildmate's copy of this run,nil,Not cffff0000completedr,nil");
    expect(s.run(`return NS.runResults.syncText(NS.dungeon.savedRuns().copy)`)).toBe("Received by Discord. Not scored: Counted with a guildmate's copy of this run");
    expect(s.run(`return NS.runResults.syncText(NS.dungeon.savedRuns().stored)`)).toContain("Companion receipt recorded");
    // An older companion writes no notes: a saved reason stays.
    s.run(`GuildedDungeonNotes = nil; NS.dungeon.markSynced()`);
    expect(runs("syncNote")).toBe("Counted with a guildmate's copy of this run,nil,Not cffff0000completedr,nil");
  });

  it("counts a run a guildmate's bot confirmed as delivered, and only finished runs", () => {
    start();
    seed("mine", 7200); seed("relayed", 7200, `, syncedVia = "Chad"`); seed("done", 7200, ", synced = true");
    s.run(`NS.dungeon.savedRuns().live = { id = "live", state = "ACTIVE", players = {} }`);
    expect(s.run(`return #NS.dungeon.waitingRuns()`)).toBe("1");
    s.run(`NS.commandHandlers.dungeon({})`);
    expect(chat()).toContain("Saved runs: 4 (1 waiting to reach Discord).");
  });

  it("translates the bot's reasons in French", () => {
    start("frFR");
    seed("copy", 7200, `, synced = true, syncNote = "Counted with a guildmate's copy of this run"`);
    expect(s.run(`return NS.runResults.syncText(NS.dungeon.savedRuns().copy)`)).toBe("Reçu par Discord. Sans points : Compté avec la copie d'un membre de la guilde");
  });
});

describe("the waiting-runs reminder", () => {
  it("records each save (logout or /reload) of the file the companion reads", () => {
    start();
    s.run(`fire_event("PLAYER_LOGOUT"); CLOCK = CLOCK + 100; fire_event("PLAYER_LOGOUT")`);
    expect(s.run(`return GuildedDB.dungeon.saveBeforeAt .. "," .. GuildedDB.dungeon.lastSaveAt`)).toBe(`${CLOCK},${CLOCK + 100}`);
  });

  it("speaks once per session when runs saved before the last logout never reached Discord", () => {
    start();
    seed("old", 7200);
    s.run(`GuildedDB.dungeon.lastSaveAt = CLOCK - 3600`);
    expect(s.run(`return tostring(NS.dungeon.remindWaiting())`)).toBe("true");
    const said = chat();
    expect(said).toContain("1 dungeon run(s) have not reached Discord yet. Is the Guilded Companion app running on this PC?");
    expect(said).toContain("3) Keep it open");
    expect(said).toContain("guilded.kcaron.top/companion/");
    expect(s.run(`return tostring(NS.dungeon.remindWaiting())`)).toBe("false");
    expect(chat()).toBe("");
  });

  it("runs after the login checks, from the same timer", () => {
    start();
    seed("old", 7200);
    s.run(`GuildedDB.dungeon.lastSaveAt = CLOCK - 3600; NS.dungeon.waitingReminded = nil; fire_event("PLAYER_LOGIN"); NS.dungeon.loadedAt = CLOCK; run_timers()`);
    expect(chat()).toContain("have not reached Discord yet");
  });

  it("stays quiet when the companion had no time yet, when everything arrived, and with old saved data", () => {
    start();
    seed("fresh", 120);
    // /reload a minute ago: the companion is still sending (its answer is read at the next load).
    s.run(`GuildedDB.dungeon.lastSaveAt = CLOCK - 60`);
    expect(s.run(`return tostring(NS.dungeon.remindWaiting())`)).toBe("false");
    // Two quick reloads: the run was saved at the earlier one, but the companion had only a minute.
    s.run(`GuildedDB.dungeon.saveBeforeAt = CLOCK - 120; GuildedDB.dungeon.lastSaveAt = CLOCK - 60`);
    seed("between", 600);
    expect(s.run(`return tostring(NS.dungeon.remindWaiting())`)).toBe("false");
    // Saved data from before 9.0.8 has no save times.
    s.run(`GuildedDB.dungeon.saveBeforeAt = nil; GuildedDB.dungeon.lastSaveAt = nil`);
    seed("old", 86400);
    expect(s.run(`return tostring(NS.dungeon.remindWaiting())`)).toBe("false");
    // The companion ran: the bot confirmed the old run.
    s.run(`GuildedDB.dungeon.lastSaveAt = CLOCK - 3600; GuildedDungeonAccepted = { "old", "between", "fresh" }; NS.dungeon.markSynced()`);
    expect(s.run(`return tostring(NS.dungeon.remindWaiting())`)).toBe("false");
    expect(chat()).toBe("");
  });

  it("uses the earlier save when the latest one is too recent: runs saved before it were overdue", () => {
    start();
    seed("before", 900);
    s.run(`GuildedDB.dungeon.saveBeforeAt = CLOCK - 600; GuildedDB.dungeon.lastSaveAt = CLOCK - 30`);
    expect(s.run(`return #NS.dungeon.overdueRuns()`)).toBe("1");
    s.run(`NS.commandHandlers.dungeon({})`);
    expect(chat()).toContain("Is the Guilded Companion app running on this PC?");
  });
});
