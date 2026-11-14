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
    const frames = queued(player, "WHISPER", "Bee");
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
    const frames = queued(player, "WHISPER", "Bee");
    for (const text of frames) hear(carrier, "Aye", text, "WHISPER");
    const id = carrier.run("for id in pairs(NS.getDb().carry.records) do return id end");
    carrier.run(`GuildedCarryReceipts = { ${JSON.stringify(id)} }`);
    expect(carrier.run("return tostring(NS.carry.applyReceipts())")).toBe("1");
    expect(records(carrier)).toBe("0");
    const told = queued(carrier, "WHISPER", "Aye");
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
    queued(player, "WHISPER", "Bee");
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

const count = (s: LuaSession, expr: string) => Number(s.run(`local n = 0; for _ in pairs(${expr}) do n = n + 1 end; return tostring(n)`));
const part = (key: string, i: number, n: number, body = "winner=sAye") => `R|externalDuel|${key}|${i}/${n}|${body}`;

describe("limits on what a carrier takes in and who it offers to", () => {
  it("looks at one announcement per sender every few minutes, and keeps a bounded list of carriers", () => {
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
    const stamp = player.run("return tostring(NS.carry.hiAt.Bee)");
    player.run("CLOCK = CLOCK + 10");
    for (let i = 0; i < 5; i++) hear(player, "Bee", "HI|1", "GUILD");
    expect(player.run("return tostring(NS.carry.hiAt.Bee)")).toBe(stamp);
    player.run("CLOCK = CLOCK + 400");
    hear(player, "Bee", "HI|1", "GUILD");
    expect(player.run("return tostring(NS.carry.hiAt.Bee)")).not.toBe(stamp);
    // Sixty strangers on the shared channel: the list stays small and the player does not offer to all of them.
    for (let i = 0; i < 60; i++) hear(player, `Stranger${String.fromCharCode(97 + (i % 26))}${i}`, "HI|1", "CHANNEL");
    expect(count(player, "NS.carry.carriers")).toBeLessThanOrEqual(40);
    const targets = new Set(sent(player).map((l) => l.split(">")[2]));
    targets.delete("undefined");
    expect(targets.size).toBeLessThanOrEqual(5);
  });

  it("prefers a carrier in the guild or group over strangers, and records are not computed again on every announcement", () => {
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Stranger", "HI|1", "CHANNEL");
    flush(player);
    sent(player);
    hear(player, "Mate", "HI|1", "GUILD");
    const toMate = queued(player, "WHISPER", "Mate");
    expect(toMate.length).toBeGreaterThan(0);
    player.run("NS.carry.carriers.Mate.sent = 0; NS.carry.carriers.Mate.pauseUntil = 0");
    hear(player, "Other", "HI|1", "CHANNEL");
    expect(queued(player, "WHISPER", "Other")).toEqual([]);
    const first = player.run("return tostring(NS.carry.collectOwn() == NS.carry.collectOwn())");
    expect(first).toBe("true");
  });

  it("holds half-assembled records per sender and overall, and drops them when the rest never comes", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    for (let i = 0; i < 6; i++) hear(carrier, "Mallory", part(`180000000${i}-aaaaaa`, 1, 2), "WHISPER");
    expect(count(carrier, "NS.carry.assemblies")).toBe(3);
    // One sender cannot block everybody else, and the whole PC holds a bounded number.
    for (let i = 0; i < 20; i++) for (let j = 0; j < 3; j++) hear(carrier, `Sender${String.fromCharCode(97 + i)}`, part(`180000${i}00${j}-bbbbbb`, 1, 2), "WHISPER");
    expect(count(carrier, "NS.carry.assemblies")).toBeLessThanOrEqual(30);
    hear(carrier, "Aye", part("1800000999-cccccc", 1, 1), "WHISPER");
    expect(count(carrier, "NS.getDb().carry.records")).toBe(1);
    carrier.run("CLOCK = CLOCK + 130; NS.carry.expire()");
    expect(count(carrier, "NS.carry.assemblies")).toBe(0);
  });

  it("limits each sender's share of the store so one sender cannot push the others out", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run(`local s = NS.getDb().carry
      for i = 1, 100 do s.records["externalDuel:m" .. i .. "-aaaa"] = { kind = "externalDuel", key = "m" .. i .. "-aaaa", author = "Mallory", from = "Mallory", data = {}, at = CLOCK, got = CLOCK - 1000 + i } end
      for i = 1, 99 do s.records["externalDuel:z" .. i .. "-aaaa"] = { kind = "externalDuel", key = "z" .. i .. "-aaaa", author = "Zed", from = "Zed", data = {}, at = CLOCK, got = CLOCK - 5000 + i } end
      s.records["externalDuel:a1-aaaa"] = { kind = "externalDuel", key = "a1-aaaa", author = "Aye", from = "Aye", data = {}, at = CLOCK, got = CLOCK - 9000 }`);
    hear(carrier, "Cee", part("1800000001-dddddd", 1, 1), "WHISPER");
    const byAuthor = (name: string) => count(carrier, `(function() local t = {}; for id, r in pairs(NS.getDb().carry.records) do if r.author == "${name}" then t[id] = true end end; return t end)()`);
    expect(byAuthor("Aye")).toBe(1);
    expect(byAuthor("Cee")).toBe(1);
    expect(byAuthor("Mallory")).toBeLessThanOrEqual(40);
    expect(byAuthor("Zed")).toBeLessThanOrEqual(40);
  });

  it("expires what it remembers about senders, and takes at most a few records from one sender per hour", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    for (let i = 0; i < 30; i++) hear(carrier, "Mallory", part(`17${String(i).padStart(8, "0")}-eeeeee`, 1, 1, "winner=sAye&loser=sZed&at=n1799999000"), "WHISPER");
    expect(count(carrier, "NS.getDb().carry.records")).toBe(20);
    carrier.run("CLOCK = CLOCK + 4000; NS.carry.expire()");
    expect(count(carrier, "NS.carry.received")).toBe(0);
  });
});

describe("names, receipts and the channel", () => {
  it("files a record under the full name without the realm and whispers back to that name", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Aye", part("1799999000-aaaaaa", 1, 1, "winner=sAye&loser=sZed&at=n1799999000"), "WHISPER");
    expect(carrier.run("local r; for _, v in pairs(NS.getDb().carry.records) do r = v end; return r.author .. '|' .. r.from")).toBe("Aye|Aye");
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    expect(player.run("local n; for name in pairs(NS.carry.carriers) do n = name end; return n")).toBe("Bee");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
  });

  it("remembers whom it handed a record to across a reload, so a late receipt is still accepted", () => {
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    flush(player);
    const id = player.run("return NS.carry.collectOwn()[1].kind .. ':' .. NS.carry.collectOwn()[1].key");
    expect(player.run(`return tostring(NS.getDb().carry.sentTo[${JSON.stringify(id)}].name)`)).toBe("Bee");
    hear(player, "Bee", `K|${id}`, "WHISPER");
    expect(waiting(player)).toBe("0");
    expect(player.run(`return tostring(NS.getDb().carry.sentTo[${JSON.stringify(id)}])`)).toBe("nil");
  });

  it("reads the companion's receipts again while the game runs", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Aye", part("1799999000-aaaaaa", 1, 1, "winner=sAye&loser=sZed&at=n1799999000"), "WHISPER");
    const id = carrier.run("for id in pairs(NS.getDb().carry.records) do return id end");
    carrier.run(`GuildedCarryReceipts = { ${JSON.stringify(id)} }; NS.carry.applyReceipts()`);
    expect(records(carrier)).toBe("0");
  });

  it("joins the shared channel only when quiet, retries a failed join with growing pauses, and refreshes the number before sending", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run(`JOINS = 0; CH = 0; function JoinTemporaryChannel() JOINS = JOINS + 1 end; function GetChannelName() return CH end`);
    carrier.run("COMBAT = true; NS.carry.joinChannel()");
    expect(carrier.run("return tostring(JOINS)")).toBe("0");
    carrier.run("COMBAT = false; CH = 0; run_timers()");
    // The game never answers: the first try and four retries, then guild and group only.
    expect(Number(carrier.run("return tostring(JOINS)"))).toBe(5);
    expect(carrier.run("return tostring(NS.carry.channelFailed)")).toBe("true");
    const fresh = client("guilded", "Dee", { companion: true });
    fresh.run(`JOINS = 0; CH = 0; function JoinTemporaryChannel() JOINS = JOINS + 1; if JOINS == 2 then CH = 7 end end; function GetChannelName() return CH end`);
    fresh.run("NS.carry.joinChannel(); run_timers()");
    expect(fresh.run("return tostring(JOINS) .. ':' .. tostring(NS.carry.channelId)")).toBe("2:7");
    // The game renumbers the channel: the next announcement uses the number it has now.
    fresh.run("CH = 9; CLOCK = CLOCK + 1000; NS.carry.announce()");
    expect(queued(fresh, "CHANNEL", "9")).toEqual(["HI|1"]);
  });

  it("never joins or leaves in combat or an instance", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run(`JOINS = 0; LEFT = 0; CH = 5; function JoinTemporaryChannel() JOINS = JOINS + 1 end; function LeaveChannelByName() LEFT = LEFT + 1 end; function GetChannelName() return CH end`);
    carrier.run("NS.carry.channelName = 'GuildedCarryA'; COMBAT = true; NS.commandHandlers.carry({ 'off' })");
    expect(carrier.run("return tostring(LEFT)")).toBe("0");
    carrier.run("COMBAT = false; run_timers()");
    expect(carrier.run("return tostring(LEFT)")).toBe("1");
  });
});

describe("the member's notice and the officer's switch", () => {
  it.each<Kind>(["guilded", "standalone"])("tells the member once that carrying is on (%s)", (kind) => {
    const s = client(kind, "Aye");
    const at = s.run("return tostring(NS.getDb().carry.noticed)");
    expect(at).not.toBe("nil");
    s.run("CLOCK = CLOCK + 5000; fire_event('PLAYER_LOGIN')");
    expect(s.run("return tostring(NS.getDb().carry.noticed)")).toBe(at);
  });

  it("an officer's guild-wide off switch stops carrying; only an officer's guild message counts", () => {
    const player = client("guilded", "Aye");
    player.run("NS.isOfficerName = function(n) return string.match(n, '^Boss') ~= nil end");
    hear(player, "Mallory", `GOFF|1|${CLOCK}`, "GUILD");
    expect(player.run("return tostring(NS.carry.enabled())")).toBe("true");
    hear(player, "Boss", `GOFF|1|${CLOCK}`, "WHISPER");
    expect(player.run("return tostring(NS.carry.enabled())")).toBe("true");
    hear(player, "Boss", `GOFF|1|${CLOCK}`, "GUILD");
    expect(player.run("return tostring(NS.carry.enabled())")).toBe("false");
    // A later word from an officer turns it back on.
    hear(player, "Boss", `GOFF|0|${CLOCK + 10}`, "GUILD");
    expect(player.run("return tostring(NS.carry.enabled())")).toBe("true");
  });

  it("an officer sets the switch with /guilded carry guild off, and a member cannot", () => {
    const officer = client("guilded", "Boss");
    officer.run("NS.isOfficer = function() return true end; NS.getDb().carry.guild = nil; IsInGuild = function() return true end; SENT = {}");
    officer.run("NS.commandHandlers.carry({ 'guild', 'off' })");
    expect(officer.run("return tostring(NS.carry.enabled())")).toBe("false");
    expect(queued(officer, "GUILD").some((t) => t.startsWith("GOFF|1|"))).toBe(true);
    const member = client("guilded", "Aye");
    member.run("NS.isOfficer = function() return false end");
    member.run("NS.commandHandlers.carry({ 'guild', 'off' })");
    expect(member.run("return tostring(NS.carry.enabled())")).toBe("true");
  });

  it("/gdungeons carry on and off reach the shared switch and the records module", () => {
    const s = client("standalone", "Aye");
    s.run("SlashCmdList.GUILDEDDUNGEONS = nil");
    s.run("NS.commandHandlers.dungeon({ 'carry', 'off' })");
    expect(s.run("return tostring(NS.carry.enabled())")).toBe("false");
    expect(s.run("return tostring(NS.getDb().carry.off)")).toBe("true");
    s.run("NS.commandHandlers.dungeon({ 'carry', 'on' })");
    expect(s.run("return tostring(NS.carry.enabled())")).toBe("true");
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
