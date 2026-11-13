import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";
import { parseSavedFiles } from "../../companion/addon-files.mjs";
import { deviceUploadBody } from "../../companion/device-sync.mjs";

// 9.3.0: a member with an addon but NO companion cannot reach the internet. Their run reaches the bot only when a guildmate
// whose PC has the companion hears it (a guild addon message sent when the run ends and replayed at login) and keeps it; that
// guildmate's companion then uploads it as a "heard" run (reporterNames). Which of the four addon pairs does that work for?
//   Guilded -> Guilded        works
//   standalone -> Guilded     works
//   Guilded -> standalone     DOES NOT WORK (the standalone addon drops runs it did not record itself)
//   standalone -> standalone  DOES NOT WORK (same reason)
// 9.3: the last two now work: the standalone addon keeps a guildmate's relayed run too (Dungeon.lua onAddonMessage "SUM").

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

type Kind = "guilded" | "standalone";

function client(kind: Kind, name: string): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; CLOCK = ${CLOCK}; GT = 0
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
    UnitName = function() return "${name}" end`);
  if (kind === "guilded") {
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) s.load(file);
  } else {
    for (const file of tocFiles()) s.run(`loadaddon("GuildedDungeons", [=====[${readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    MEMBERS = { Walter = true, Lebowski = true, Donny = true }
    NS.isGuildMember = function(n) return MEMBERS[(n or ""):match("^[^-]+")] == true end
    NS.isOfficerName = function() return false end
    fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  return s;
}

const saved = (kind: Kind) => (kind === "guilded" ? "NS.getDb().dungeon.runs" : "NS.getDb().dungeon.runs");

// Walter finished Ragefire with Donny (neither is on the receiver's PC) and has no companion.
function walterRan(s: LuaSession, kind: Kind, id = "walter-rfc") {
  s.run(`${saved(kind)}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
    startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Walter", encounters = {}, reporters = { Walter = true },
    players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true } } }
    NS.dungeon.lastReplay = nil; NS.dungeon.replayPending(); run_timers()`);
}

const sentLines = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`).split("\n").filter(Boolean);

function deliver(from: LuaSession, fromName: string, to: LuaSession) {
  const lines = sentLines(from).filter((line) => line.startsWith("GuildedDgn>SUM|"));
  for (const line of lines) {
    const [prefix, ...rest] = line.split(">");
    to.run(`fire_event("CHAT_MSG_ADDON", ${JSON.stringify(prefix)}, ${JSON.stringify(rest.join(">"))}, "GUILD", "${fromName}-Realm")`);
  }
  return lines.length;
}

const holds = (s: LuaSession, id: string) => s.run(`return tostring(${saved("guilded")}[${JSON.stringify(id)}] ~= nil)`) === "true";

function relay(from: Kind, to: Kind) {
  const sender = client(from, "Walter");
  const receiver = client(to, "Lebowski");
  walterRan(sender, from);
  const messages = deliver(sender, "Walter", receiver);
  return { sender, receiver, messages };
}

describe("a run recorded by a member without the companion", () => {
  it("Guilded -> Guilded: the guildmate keeps it, and its companion uploads it as heard", () => {
    const { receiver, messages } = relay("guilded", "guilded");
    expect(messages).toBeGreaterThan(0);
    expect(holds(receiver, "walter-rfc")).toBe(true);
    expect(receiver.run(`return tostring(${saved("guilded")}["walter-rfc"].reporters.Walter)`)).toBe("true");
  });

  it("standalone -> Guilded: the guildmate keeps it", () => {
    const { receiver, messages } = relay("standalone", "guilded");
    expect(messages).toBeGreaterThan(0);
    expect(holds(receiver, "walter-rfc")).toBe(true);
  });

  // 9.3: the standalone addon keeps a guildmate's run too, so its companion can upload it as a heard run.
  it("Guilded -> standalone: the standalone guildmate should keep it too", () => {
    const { receiver, messages } = relay("guilded", "standalone");
    expect(messages).toBeGreaterThan(0);
    expect(holds(receiver, "walter-rfc")).toBe(true);
  });

  it("standalone -> standalone: the standalone guildmate should keep it too", () => {
    const { receiver, messages } = relay("standalone", "standalone");
    expect(messages).toBeGreaterThan(0);
    expect(holds(receiver, "walter-rfc")).toBe(true);
  });

  it("a standalone guildmate who was in the same run merges the reporter into its own copy (both pairs)", () => {
    for (const from of ["guilded", "standalone"] as Kind[]) {
      const sender = client(from, "Walter");
      const receiver = client("standalone", "Donny");
      walterRan(sender, from);
      // Donny recorded the same run (same id) in the same party.
      receiver.run(`NS.getDb().dungeon.runs["walter-rfc"] = { id = "walter-rfc", state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
        startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Donny", encounters = {}, reporters = { Donny = true },
        players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true } } }`);
      deliver(sender, "Walter", receiver);
      expect(receiver.run(`return tostring(NS.getDb().dungeon.runs["walter-rfc"].reporters.Walter)`)).toBe("true");
    }
  });
});

// The companion side of the relay: a PC whose companion holds a run only a guildmate recorded sends it as a heard run.
describe("the guildmate's companion uploads the relayed run", () => {
  const SER = String.raw`function SER(v) local t = type(v) if t == "table" then local keys = {} for k in pairs(v) do keys[#keys + 1] = k end table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local out = {} for _, k in ipairs(keys) do out[#out + 1] = "[" .. SER(k) .. "]=" .. SER(v[k]) end return "{" .. table.concat(out, ",") .. "}" elseif t == "string" then return string.format("%q", v) else return tostring(v) end end`;

  it("a Guilded Lebowski sends Walter's run as heard (not as one of his own characters')", () => {
    const { receiver } = relay("standalone", "guilded");
    receiver.run(SER);
    const text = `GuildedDB = ${receiver.run("return SER(GuildedDB)")}\n`;
    const { full } = parseSavedFiles({ guilded: text }, "TestRealm");
    const body = deviceUploadBody({ ...full, character: { name: "Lebowski", realm: "TestRealm" } });
    expect(body.dungeonRuns?.map((run: { id: string }) => run.id)).toEqual(["walter-rfc"]);
    expect(body.dungeonRuns?.[0]?.reporterNames).toContain("Walter");
  });
});
