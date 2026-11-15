import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.3.5: a run summary longer than one chunk goes packed (SUMZ, the game's compression plus base64) as a whisper to the guildmate who
// asked for it and said Z1 in a digest line. Everyone else, and every client without the game's packing, gets the plain guild SUM.

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

// The game's packing, faked but reversible and really smaller on repeated letters; base64 is hex.
const PACKING = String.raw`
  C_EncodingUtil = {
    CompressString = function(t)
      local out, i = {}, 1
      while i <= #t do
        local c = t:sub(i, i); local j = i
        while j < #t and t:sub(j + 1, j + 1) == c do j = j + 1 end
        local n = j - i + 1
        out[#out + 1] = n >= 4 and ("~" .. n .. "~" .. c) or string.rep(c, n)
        i = j + 1
      end
      return table.concat(out)
    end,
    DecompressString = function(t)
      if t:find("^BAD") then error("not packed") end
      return (t:gsub("~(%d+)~(.)", function(n, c) return string.rep(c, tonumber(n)) end))
    end,
    EncodeBase64 = function(text) return (string.gsub(text, ".", function(c) return string.format("%02x", string.byte(c)) end)) end,
    DecodeBase64 = function(text) return (string.gsub(text, "%x%x", function(h) return string.char(tonumber(h, 16)) end)) end
  }
`;

function client(name: string, pack = true): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  if (pack) s.run(PACKING);
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; GT = 0
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    C_ChatInfo.SendAddonMessage = function(prefix, text, channel, target) SENT = SENT or {}; SENT[#SENT + 1] = { prefix = prefix, text = text, channel = channel, target = target } end
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
function longRun(s: LuaSession, id = "walter-rfc") {
  s.run(`local enc = {}
    for i = 1, 8 do enc[i] = { id = 100 + i, name = string.rep("A", 100), success = true, at = CLOCK - 1500 + i * 10, startedAt = CLOCK - 1600 + i * 10 } end
    ${runs}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
    startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Walter", encounters = enc, reporters = { Walter = true },
    players = { Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true } } }
    NS.dungeon.solicited[${JSON.stringify(id)}] = CLOCK`);
}
const take = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.channel .. ">" .. tostring(m.target) .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`)
  .split("\n").filter(Boolean).map((line) => { const [prefix, channel, target, ...rest] = line.split(">"); return { prefix, channel, target, text: rest.join(">") }; });
const holds = (s: LuaSession, id: string) => s.run(`return tostring(${runs}[${JSON.stringify(id)}] ~= nil)`) === "true";
const hear = (s: LuaSession, from: string, channel: string, text: string) => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", ${JSON.stringify(text)}, "${channel}", "${from}-Realm")`);

// Walter hears Lebowski's digest (with the given capabilities), then Lebowski's WNT for the run.
function ask(walter: LuaSession, caps: string | null) {
  if (caps) hear(walter, "Lebowski", "GUILD", `DGS|1|${caps}|2900:000001`);
  walter.run(`run_timers(); SENT = {}`);
  hear(walter, "Lebowski", "GUILD", "WNT|walter-rfc");
  walter.run(`run_timers()`);
  return take(walter).filter((m) => m.prefix === "GuildedDgn");
}

describe("packed run summaries (Z1)", () => {
  it("whispers the run packed, in fewer chunks than the plain summary, to a guildmate that said Z1", () => {
    const walter = client("Walter"), lebowski = client("Lebowski");
    longRun(walter);
    const plainChunks = Number(walter.run(`return math.ceil(#NS.dungeon.serialize(${runs}["walter-rfc"]) / 200)`));
    const sent = ask(walter, "D1,Z1");
    const packed = sent.filter((m) => m.text.startsWith("SUMZ|"));
    expect(plainChunks).toBeGreaterThan(2);
    expect(packed.length).toBeGreaterThan(0);
    expect(packed.length).toBeLessThan(plainChunks);
    expect(sent.filter((m) => m.text.startsWith("SUM|"))).toHaveLength(0);
    for (const m of packed) { expect(m.channel).toBe("WHISPER"); expect(m.target).toContain("Lebowski"); expect(m.text.length).toBeLessThanOrEqual(255); }
    // Lebowski unpacks it and keeps exactly the run Walter holds.
    for (const m of packed) hear(lebowski, "Walter", "WHISPER", m.text);
    expect(holds(lebowski, "walter-rfc")).toBe(true);
    expect(lebowski.run(`return #${runs}["walter-rfc"].encounters`)).toBe("8");
    expect(lebowski.run(`return ${runs}["walter-rfc"].encounters[1].name`)).toBe("A".repeat(100));
    expect(Number(lebowski.run(`return NS.dungeon.stats.packedHeard`))).toBe(1);
  });

  it("sends the plain guild SUM to a guildmate that did not say Z1, or whose digest says only D1", () => {
    for (const caps of [null, "D1"]) {
      const walter = client("Walter");
      longRun(walter);
      const sent = ask(walter, caps);
      expect(sent.filter((m) => m.text.startsWith("SUMZ|"))).toHaveLength(0);
      expect(sent.filter((m) => m.text.startsWith("SUM|") && m.channel === "GUILD").length).toBeGreaterThan(0);
    }
  });

  it("falls back to the plain SUM when this client has no packing", () => {
    const walter = client("Walter", false);
    longRun(walter);
    expect(walter.run(`return NS.dungeon.caps()`)).toBe("D1");
    const sent = ask(walter, "D1,Z1");
    expect(sent.filter((m) => m.text.startsWith("SUMZ|"))).toHaveLength(0);
    expect(sent.filter((m) => m.text.startsWith("SUM|")).length).toBeGreaterThan(0);
  });

  it("says Z1 in its own digest only where the packing exists", () => {
    const withPacking = client("Walter"), without = client("Donny", false);
    for (const s of [withPacking, without]) { longRun(s); s.run(`NS.dungeon.sendDigest(true)`); }
    expect(take(withPacking).find((m) => m.text.startsWith("DGS|"))?.text).toMatch(/^DGS\|1\|D1,Z1\|/);
    expect(take(without).find((m) => m.text.startsWith("DGS|"))?.text).toMatch(/^DGS\|1\|D1\|/);
  });

  it("ignores a packed summary from a stranger, on the guild channel, corrupt, or from someone not in the run", () => {
    const walter = client("Walter"), lebowski = client("Lebowski");
    longRun(walter);
    const packed = ask(walter, "D1,Z1").filter((m) => m.text.startsWith("SUMZ|"));
    hear(lebowski, "Stranger", "WHISPER", packed[0].text);                         // not a guildmate
    for (const m of packed) hear(lebowski, "Walter", "GUILD", m.text);             // SUMZ is whisper only
    expect(holds(lebowski, "walter-rfc")).toBe(false);
    hear(lebowski, "Walter", "WHISPER", "SUMZ|walter-rfc|1|1|BAD00");              // not packed data
    expect(holds(lebowski, "walter-rfc")).toBe(false);
    // From a guildmate who is not a player of the run: dropped like a plain SUM.
    MEMBERS_ADD(lebowski);
    for (const m of packed) hear(lebowski, "Donny2", "WHISPER", m.text);
    expect(holds(lebowski, "walter-rfc")).toBe(false);
  });
});

function MEMBERS_ADD(s: LuaSession) { s.run(`MEMBERS.Donny2 = true`); }
