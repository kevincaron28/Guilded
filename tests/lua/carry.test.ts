import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";

// 9.3.2: records carried for players near you. An addon with no companion hands its outside duels to a carrier it heard, the carrier's
// companion uploads them, the receipts come back through Carry.lua. Both addons share the code (Modules/Carry.lua).

const CLOCK = 1_800_000_000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

type Kind = "guilded" | "standalone";

function client(kind: Kind, name: string, opts: { companion?: boolean } = {}): LuaSession {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; GuildedCompanionFeatures = nil; GuildedCarryReceipts = nil; CLOCK = ${CLOCK}; GT = 0; COMBAT = false
    C_AddOns = { IsAddOnLoaded = function() return false end }
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function InCombatLockdown() return COMBAT end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
    C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, SendAddonMessage = function(prefix, text, channel, target) SENT = SENT or {}; SENT[#SENT + 1] = { prefix = prefix, text = text, channel = channel, target = target }; return 0 end }
    function IsInGroup() return false end
    UnitName = function(unit) if unit == "player" then return "${name}" end end
    UnitExists = function(unit) return unit == "player" end`);
  if (kind === "guilded") {
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua", "Modules/Carry.lua"]) s.load(file);
  } else {
    for (const file of tocFiles()) s.run(`loadaddon("GuildedDungeons", [=====[${readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  if (opts.companion) s.run(`GuildedCompanionFeatures = { ["carry-records"] = true, at = CLOCK }`);
  return s;
}

const duel = (s: LuaSession, winner = "Aye", loser = "Zed", at = CLOCK - 100) => s.run(`local root = NS.getDb(); root.duels = root.duels or {}; root.duels.external = root.duels.external or {}
  root.duels.external[${JSON.stringify(`${winner}|${loser}|${at}`)}] = { winner = ${JSON.stringify(winner)}, loser = ${JSON.stringify(loser)}, winnerRealm = "Forever", loserRealm = "Forever", winnerClass = "MAGE", loserClass = "ROGUE",
    winnerLevel = 30, loserLevel = 31, zone = "Elwynn Forest", at = ${at}, durationSec = 40, reason = "knockout", side = "winner", seq = 5, nonce = "abcdef0123456789", chain = "0123456789abcdef", evidence = { endAt = ${at} } }`);
const sent = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.channel .. ">" .. tostring(m.target) .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`).split("\n").filter(Boolean);
const flush = (s: LuaSession) => s.run("run_timers()");
const hear = (to: LuaSession, from: string, text: string, channel: string) =>
  to.run(`fire_event("CHAT_MSG_ADDON", "GuildedCry", ${JSON.stringify(text)}, ${JSON.stringify(channel)}, "${from}-Realm")`);
/** What `from` queued for `channel` (a whisper to `target`), as the texts the other side hears. */
const queued = (s: LuaSession, channel: string, target?: string) => { flush(s); return sent(s).map((line) => line.split(">")).filter((p) => p[1] === channel && (!target || p[2] === target)).map((p) => p.slice(3).join(">")); };
const records = (s: LuaSession) => s.run(`local n = 0; for _ in pairs(NS.getDb().carry and NS.getDb().carry.records or {}) do n = n + 1 end; return tostring(n)`);
const waiting = (s: LuaSession) => s.run("return tostring(#NS.carry.collectOwn())");

describe.each<Kind>(["guilded", "standalone"])("records carried by a nearby companion (%s)", (kind) => {
  // The standalone addon has no duels: its own records are none, but it still carries other players'.
  const own = kind === "guilded";

  it("a carrier announces itself, the other side offers its records, and the carrier stores them under the sender's name", () => {
    const carrier = client(kind, "Bee", { companion: true });
    expect(carrier.run("return tostring(NS.carry.companionHere())")).toBe("true");
    carrier.run("NS.carry.announce()");
    const announced = queued(carrier, "GUILD");
    expect(announced).toEqual(["HI|1"]);
    if (!own) return;
    const player = client("guilded", "Aye");
    duel(player);
    expect(waiting(player)).toBe("1");
    hear(player, "Bee", announced[0]!, "GUILD");
    const frames = queued(player, "WHISPER", "Bee-Realm");
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((text) => text.startsWith("R|externalDuel|") && text.length < 230)).toBe(true);
    for (const text of frames) hear(carrier, "Aye", text, "WHISPER");
    expect(records(carrier)).toBe("1");
    expect(carrier.run("local r; for _, v in pairs(NS.getDb().carry.records) do r = v end; return r.author .. '|' .. r.data.winner .. '|' .. r.data.loser .. '|' .. tostring(r.data.winnerLevel) .. '|' .. tostring(r.data.chain)")).toBe("Aye|Aye|Zed|30|nil");
  });

  it("only a carrier keeps what is whispered to it", () => {
    const stranger = client(kind, "Cee");
    for (const text of ["R|externalDuel|1800000000-abcdef|1/1|winner%3DsAye"]) hear(stranger, "Aye", text, "WHISPER");
    expect(records(stranger)).toBe("0");
  });

  it("a receipt written by the companion removes the record and tells the player it came from", () => {
    if (!own) return;
    const carrier = client(kind, "Bee", { companion: true });
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    const frames = queued(player, "WHISPER", "Bee-Realm");
    for (const text of frames) hear(carrier, "Aye", text, "WHISPER");
    const id = carrier.run("for id in pairs(NS.getDb().carry.records) do return id end");
    carrier.run(`GuildedCarryReceipts = { ${JSON.stringify(id)} }`);
    expect(carrier.run("return tostring(NS.carry.applyReceipts())")).toBe("1");
    expect(records(carrier)).toBe("0");
    const told = queued(carrier, "WHISPER", "Aye-Realm");
    expect(told).toEqual([`K|${id}`]);
    // The player stops carrying it once the carrier it handed it to says so.
    hear(player, "Bee", told[0]!, "WHISPER");
    expect(waiting(player)).toBe("0");
  });

  it("a receipt from a name the record was never handed to changes nothing", () => {
    if (!own) return;
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    queued(player, "WHISPER", "Bee-Realm");
    const id = player.run("return NS.carry.collectOwn()[1].kind .. ':' .. NS.carry.collectOwn()[1].key");
    hear(player, "Mallory", `K|${id}`, "WHISPER");
    hear(player, "Mallory", `K|${id}`, "CHANNEL");
    expect(waiting(player)).toBe("1");
  });

  it("a third player cannot make a carrier keep a record under another name", () => {
    const carrier = client(kind, "Bee", { companion: true });
    const body = "winner=sAye&loser=sZed&at=n1799999000&reason=sknockout&side=swinner";
    hear(carrier, "Mallory", `R|externalDuel|1799999000-aaaaaa|1/1|${body}`, "WHISPER");
    expect(carrier.run("local r; for _, v in pairs(NS.getDb().carry.records) do r = v end; return r.author")).toBe("Mallory");
  });

  it("nothing is sent in combat, and nothing at all once switched off", () => {
    const carrier = client(kind, "Bee", { companion: true });
    carrier.run("COMBAT = true; NS.carry.announce()");
    expect(queued(carrier, "GUILD")).toEqual([]);
    carrier.run("COMBAT = false; NS.commandHandlers.carry({ 'off' })");
    expect(carrier.run("return tostring(NS.carry.enabled())")).toBe("false");
    carrier.run("NS.carry.announce()");
    expect(queued(carrier, "GUILD")).toEqual([]);
    carrier.run("NS.commandHandlers.carry({ 'on' })");
    expect(carrier.run("return tostring(NS.carry.enabled())")).toBe("true");
  });

  it("does not treat the shared channel as a place to deliver records", () => {
    const carrier = client(kind, "Bee", { companion: true });
    hear(carrier, "Aye", "R|externalDuel|1799999000-aaaaaa|1/1|winner=sAye", "CHANNEL");
    expect(records(carrier)).toBe("0");
  });
});

describe("the record text", () => {
  it("round-trips text with separators and refuses damaged input", () => {
    const s = client("guilded", "Aye");
    const out = s.run(`local text = NS.carry.encode({ zone = "A|B&C=D~E%F", at = 12, flag = true })
      local back = NS.carry.decode(text)
      return back.zone .. ';' .. back.at .. ';' .. tostring(back.flag) .. ';' .. tostring(NS.carry.decode('x=n1y') == nil) .. ';' .. tostring(NS.carry.decode('x=') == nil)`);
    expect(out).toBe("A|B&C=D~E%F;12;true;true;true");
  });
});
