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
    TIMERS = {}; TICKERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function(seconds, fn) TICKERS[#TICKERS + 1] = { seconds = seconds, fn = fn }; return {} end }
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
const CLOCK_STEP = (s: LuaSession, seconds: number) => s.run(`CLOCK = CLOCK + ${seconds}`);
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

  it("a carrier that already has a record done answers it when it is offered again, so a player who was offline at the first receipt clears it", () => {
    if (!own) return;
    const carrier = client(kind, "Bee", { companion: true });
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    const frames = queued(player, "WHISPER", "Bee");
    for (const text of frames) hear(carrier, "Aye", text, "WHISPER");
    const id = carrier.run("for id in pairs(NS.getDb().carry.records) do return id end");
    // The carrier reloads with the bot's receipt; the player was offline, so the first K reached nobody.
    carrier.run(`GuildedCarryReceipts = { ${JSON.stringify(id)} }`);
    carrier.run("NS.carry.applyReceipts()");
    queued(carrier, "WHISPER", "Aye");
    expect(waiting(player)).toBe("1");
    // The player offers it again (a later announcement): the carrier answers once, and the player clears it.
    CLOCK_STEP(player, 4000);
    hear(player, "Bee", "HI|1", "GUILD");
    const again = queued(player, "WHISPER", "Bee");
    expect(again.length).toBeGreaterThan(0);
    for (const text of again) hear(carrier, "Aye", text, "WHISPER");
    const told = queued(carrier, "WHISPER", "Aye");
    expect(told).toEqual([`K|${id}`]);
    for (const text of again) hear(carrier, "Aye", text, "WHISPER");
    expect(queued(carrier, "WHISPER", "Aye")).toEqual([]);
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
    hear(player, "Mate", "HI|1", "GUILD");
    const toMate = queued(player, "WHISPER", "Mate");
    expect(toMate.length).toBeGreaterThan(0);
    hear(player, "Stranger", "HI|1", "CHANNEL");
    expect(queued(player, "WHISPER", "Stranger")).toEqual([]);
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
      for i = 1, 100 do s.records["externalDuel:m" .. i .. "-aaaa"] = { kind = "externalDuel", key = "m" .. i .. "-aaaa", author = "Mallory", from = "Mallory", data = {}, at = CLOCK, got = CLOCK - 600 + i } end
      for i = 1, 99 do s.records["externalDuel:z" .. i .. "-aaaa"] = { kind = "externalDuel", key = "z" .. i .. "-aaaa", author = "Zed", from = "Zed", data = {}, at = CLOCK, got = CLOCK - 1500 + i } end
      s.records["externalDuel:a1-aaaa"] = { kind = "externalDuel", key = "a1-aaaa", author = "Aye", from = "Aye", data = {}, at = CLOCK, got = CLOCK - 1700 }`);
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

  it("does not resend to a carrier what it already whispered, so older records get their turn", () => {
    const player = client("guilded", "Aye");
    duel(player, "Aye", "Zed", CLOCK - 300);
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
    const first = player.run("for id in pairs(NS.getDb().carry.sentTo) do return id end");
    CLOCK_STEP(player, 400);
    player.run("NS.carry.carriers.Bee.sent = 0; NS.carry.carriers.Bee.pauseUntil = 0");
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee")).toEqual([]);
    duel(player, "Aye", "Yan", CLOCK - 200);
    CLOCK_STEP(player, 400);
    hear(player, "Bee", "HI|1", "GUILD");
    const texts = queued(player, "WHISPER", "Bee");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.join(" ")).not.toContain(first.split(":")[1]!);
  });

  it("acts on each companion receipt once per session", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Aye", part("1799999000-aaaaaa", 1, 1, "winner=sAye&loser=sZed&at=n1799999000"), "WHISPER");
    const id = carrier.run("for id in pairs(NS.getDb().carry.records) do return id end");
    carrier.run(`GuildedCarryReceipts = { ${JSON.stringify(id)} }`);
    expect(carrier.run("return tostring(NS.carry.applyReceipts())")).toBe("1");
    carrier.run(`NS.getDb().carry.records[${JSON.stringify(id)}] = { kind = "externalDuel", key = "again", author = "Aye", data = {}, got = CLOCK }`);
    expect(carrier.run("return tostring(NS.carry.applyReceipts())")).toBe("0");
    expect(records(carrier)).toBe("1");
  });

  it("expires half-assembled records and old sender notes on a short timer", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Mallory", part("1800000000-aaaaaa", 1, 2), "WHISPER");
    hear(carrier, "Mallory", "HI|1", "GUILD");
    expect(count(carrier, "NS.carry.assemblies")).toBe(1);
    carrier.run("CLOCK = CLOCK + 700; for _, t in ipairs(TICKERS) do if t.seconds == 25 then t.fn() end end");
    expect(count(carrier, "NS.carry.assemblies")).toBe(0);
    expect(count(carrier, "NS.carry.hiAt")).toBe(0);
  });

  it("an officer's switch and the login replay are sent only when quiet, and /guilded carry off is the same switch as /gdungeons carry off", () => {
    const player = client("guilded", "Aye");
    player.run("NS.getDb().dungeon = NS.getDb().dungeon or {}; NS.commandHandlers.carry({ 'off' })");
    expect(player.run("return tostring(NS.getDb().dungeon.carryGroupRuns)")).toBe("false");
    expect(player.run("return tostring(NS.dungeon.carryOn())")).toBe("false");
    player.run("NS.commandHandlers.carry({ 'on' })");
    expect(player.run("return tostring(NS.dungeon.carryOn())")).toBe("true");
  });

  it("reads the companion's receipts again while the game runs", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Aye", part("1799999000-aaaaaa", 1, 1, "winner=sAye&loser=sZed&at=n1799999000"), "WHISPER");
    const id = carrier.run("for id in pairs(NS.getDb().carry.records) do return id end");
    carrier.run(`GuildedCarryReceipts = { ${JSON.stringify(id)} }; NS.carry.applyReceipts()`);
    expect(records(carrier)).toBe("0");
  });

  it("keeps one join chain at most: extra calls while a retry waits start nothing new", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run(`JOINS = 0; CH = 0; function JoinTemporaryChannel() JOINS = JOINS + 1 end; function GetChannelName() return CH end; TIMERS = {}`);
    // In combat: five calls (ticker, /guilded carry on, login...) leave one waiting retry, not five.
    carrier.run("COMBAT = true; for _ = 1, 5 do NS.carry.joinChannel() end");
    expect(carrier.run("return #TIMERS")).toBe("1");
    // Out of combat the one retry joins once; while its answer is awaited, more calls do nothing.
    carrier.run("COMBAT = false; local list = TIMERS; TIMERS = {}; list[1](); for _ = 1, 5 do NS.carry.joinChannel() end");
    expect(carrier.run("return tostring(JOINS) .. ':' .. #TIMERS")).toBe("1:1");
    // The game gave no channel: one retry is scheduled; calls while it waits add no chain.
    carrier.run("local list = TIMERS; TIMERS = {}; list[1](); for _ = 1, 5 do NS.carry.joinChannel() end");
    expect(carrier.run("return tostring(JOINS) .. ':' .. #TIMERS")).toBe("1:1");
    // Each later step still makes exactly one attempt and one next timer.
    for (let step = 0; step < 4; step++) carrier.run("local list = TIMERS; TIMERS = {}; for _, fn in ipairs(list) do fn() end; NS.carry.joinChannel(); NS.carry.joinChannel()");
    expect(Number(carrier.run("return #TIMERS"))).toBeLessThanOrEqual(1);
    expect(Number(carrier.run("return JOINS"))).toBe(3);
  });

  it("joins the shared channel only when quiet, retries a failed join with growing pauses, and refreshes the number before sending", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run(`JOINS = 0; CH = 0; function JoinTemporaryChannel() JOINS = JOINS + 1 end; function GetChannelName() return CH end`);
    carrier.run("COMBAT = true; NS.carry.joinChannel()");
    expect(carrier.run("return tostring(JOINS)")).toBe("0");
    carrier.run("COMBAT = false; CH = 0; run_timers()");
    // The game never answers: the first try and the four retries of the ladder, and the slow retries go on after it.
    expect(Number(carrier.run("return tostring(JOINS)"))).toBeGreaterThan(5);
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

// Real-client test of 9.3.2: "/guilded carry" said "2 records wait for a companion" although one had already been whispered to a carrier
// (and applied by the bot): the two counts are told apart now.
describe("the /guilded carry status line", () => {
  const ids = (s: LuaSession) => s.run("local t = {}; for _, r in ipairs(NS.carry.collectOwn(true)) do t[#t + 1] = r.kind .. ':' .. r.key end; return table.concat(t, ',')").split(",");
  const hand = (s: LuaSession, id: string) => s.run(`NS.getDb().carry.sentTo[${JSON.stringify(id)}] = { name = "Bee", at = CLOCK }; NS.carry.ownCache = nil`);
  const status = (s: LuaSession) => s.run("return NS.carry.statusLine()");

  it("tells how many records wait, since when and why, and that the companion sends them at once; handed records say they await confirmation", () => {
    const player = client("guilded", "Aye");
    duel(player, "Aye", "Zed", CLOCK - 300);
    duel(player, "Aye", "Yan", CLOCK - 200);
    expect(status(player)).toMatch(/^2 records are waiting, since .+\. No player with the companion is near you yet\. Installing the companion sends them at once\.$/);
    const [first = "", second = ""] = ids(player);
    hand(player, first);
    // One still waits for a carrier: the reason is about the waiting one.
    expect(status(player)).toMatch(/^2 records are waiting, since .+\. No player with the companion is near you yet\./);
    hand(player, second);
    expect(status(player)).toMatch(/^2 records are waiting, since .+\. Sent, waiting for confirmation\./);
    // The receipt for one comes back: only the other is still waiting for confirmation.
    hear(player, "Bee", `K|${first}`, "WHISPER");
    expect(status(player)).toMatch(/^1 record is waiting, since .+\. Sent, waiting for confirmation\./);
    hear(player, "Bee", `K|${second}`, "WHISPER");
    expect(status(player)).not.toContain("waiting");
    expect(status(player)).toBe("Your records were uploaded by a companion near you.");
  });

  it("uses the singular for one waiting record, says a carrier is near when one was heard and that carrying is off when it is", () => {
    const player = client("guilded", "Aye");
    duel(player);
    expect(status(player)).toMatch(/^1 record is waiting, since .+\. No player with the companion is near you yet\. Installing the companion sends them at once\.$/);
    player.run(`NS.carry.carriers.Bee = { name = "Bee", at = CLOCK, fails = 0, sent = 999, pauseUntil = CLOCK + 9999, near = true }`);
    expect(status(player)).toContain("A player near you with the companion will take them.");
    player.run("NS.commandHandlers.carry({ 'off' })");
    expect(status(player)).toBe("Carrying records is off. Type /guilded carry on to turn it on.");
    expect(player.run("return NS.carry.windowLine()")).toContain("Carrying is off.");
    expect(player.run("return NS.carry.windowLine()")).toContain("Installing the companion sends them at once.");
  });

  it("the window line is empty when nothing waits or this PC's own companion sends them, and the Home page carries it", () => {
    const player = client("guilded", "Aye");
    expect(player.run("return NS.carry.windowLine()")).toBe("");
    duel(player);
    expect(player.run("return NS.carry.windowLine()")).toContain("1 record is waiting");
    player.run(`GuildedCompanionFeatures = { ["carry-records"] = true, at = CLOCK }`);
    expect(player.run("return NS.carry.windowLine()")).toBe("");
  });

  it("says it once at login, in the player's own words, and not again", () => {
    const player = client("guilded", "Aye");
    duel(player);
    player.run("MSGS = {}; NS.message = function(text) MSGS[#MSGS + 1] = text end; NS.carry.loginSaid = nil; NS.carry.loginLine(); NS.carry.loginLine()");
    expect(player.run("return #MSGS")).toBe("1");
    expect(player.run("return MSGS[1]")).toContain("1 record is waiting");
    const quietOne = client("guilded", "Dee");
    quietOne.run("MSGS = {}; NS.message = function(text) MSGS[#MSGS + 1] = text end; NS.carry.loginLine()");
    expect(quietOne.run("return #MSGS")).toBe("0");
  });

  it("French, German and Spanish have the new lines", () => {
    for (const language of ["frFR", "deDE", "esES"]) {
      const out = newLuaSession();
      sessions.push(out);
      out.run(`NS = {}; GetLocale = function() return "${language}" end`);
      out.load("Locale.lua");
      for (const line of ["1 record is waiting, since %s.", "%d records are waiting, since %s.", "1 record is waiting.", "%d records are waiting.", "Carrying is off.", "Sent, waiting for confirmation.", "A player near you with the companion will take them.", "No player with the companion is near you yet.", "Installing the companion sends them at once.", "Asking for a carrier is off. Guild and group carriers still work.", "Asking for a carrier is on."]) {
        expect(out.run(`return NS.L(${JSON.stringify(line)})`), `${language}: ${line}`).not.toBe(line);
      }
    }
  });

  it("on the carrier, says the records wait for its companion's next upload", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    expect(status(carrier)).toBe("Your companion carries records for players near you: 0 waiting for its next upload.");
  });
});

// Real-client finding on 9.3.2: the second PC's companion was stopped, yet the addon kept carrying, announced itself and kept its own
// new record instead of handing it to a real carrier nearby. The marker's window is the shared Util helper's job; these are the live checks.
describe("a companion that stopped is not trusted as a carrier", () => {
  const here = (s: LuaSession) => s.run("return tostring(NS.carry.companionHere())");

  it("a carrier holds a record for 2 hours in one session and keeps carrying (its receipt can only come at the next load)", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run("NS.carry.noteLoad()");
    hear(carrier, "Cee", part("1800000001-dddddd", 1, 1), "WHISPER");
    expect(records(carrier)).toBe("1");
    CLOCK_STEP(carrier, 2 * 3600);
    // The companion keeps writing standings during the session: the global does not change until a load, and nothing stands down.
    carrier.run(`GuildedCompanionFeatures = { ["carry-records"] = true, at = CLOCK }`);
    expect(here(carrier)).toBe("true");
    carrier.run("NS.carry.lastAnnounce = 0; NS.carry.announce(true)");
    expect(queued(carrier, "GUILD")).toEqual(["HI|1"]);
    hear(carrier, "Dee", part("1800000002-eeeeee", 1, 1), "WHISPER");
    expect(records(carrier)).toBe("2");
  });

  it("a companion whose heartbeat marker was already older than the window at the load carries nothing; a live one keeps carrying for hours", () => {
    const dead = client("guilded", "Bee");
    dead.run(`GuildedCompanionFeatures = { ["carry-records"] = true, hb = 1, at = CLOCK - 4 * 3600 }; NS.carry.noteLoad()`);
    expect(here(dead)).toBe("false");
    hear(dead, "Cee", part("1800000001-dddddd", 1, 1), "WHISPER");
    expect(records(dead)).toBe("0");
    const alive = client("guilded", "Dee");
    alive.run(`GuildedCompanionFeatures = { ["carry-records"] = true, hb = 1, at = CLOCK - 600 }; NS.carry.noteLoad()`);
    CLOCK_STEP(alive, 5 * 3600);
    expect(here(alive)).toBe("true");
  });

  it("a record held across a reload with a live companion and no receipt makes it stand down until a load clears it", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run("NS.carry.noteLoad()");
    hear(carrier, "Cee", part("1800000001-dddddd", 1, 1), "WHISPER");
    expect(here(carrier)).toBe("true");
    // /reload 10 minutes later: the companion read the saved data and wrote again (marker newer than the record), yet no receipt.
    CLOCK_STEP(carrier, 600);
    carrier.run(`GuildedCompanionFeatures = { ["carry-records"] = true, at = CLOCK - 60 }; GuildedCarryReceipts = {}; NS.carry.noteLoad(); NS.carry.applyReceipts()`);
    expect(here(carrier)).toBe("false");
    // A reload right after receiving (the companion has not written since): no conclusion yet.
    const quick = client("guilded", "Dee", { companion: true });
    quick.run("NS.carry.noteLoad()");
    hear(quick, "Cee", part("1800000003-ffffff", 1, 1), "WHISPER");
    CLOCK_STEP(quick, 5);
    quick.run(`GuildedCompanionFeatures = { ["carry-records"] = true, at = CLOCK - 3600 }; NS.carry.noteLoad()`);
    expect(here(quick)).toBe("true");
    carrier.run("NS.carry.lastAnnounce = 0; NS.carry.announce(true)");
    expect(queued(carrier, "GUILD")).toEqual([]);
    hear(carrier, "Dee", part("1800000002-eeeeee", 1, 1), "WHISPER");
    expect(records(carrier)).toBe("1");
    // What it holds stays (its companion may still upload it); its own new record is handed to a carrier that works.
    duel(carrier, "Bee", "Zed", CLOCK - 50);
    hear(carrier, "Eve", "HI|1", "GUILD");
    expect(queued(carrier, "WHISPER", "Eve").length).toBeGreaterThan(0);
    // The receipt arrives at the next load: it carries again.
    carrier.run(`GuildedCarryReceipts = { "externalDuel:1800000001-dddddd" }; NS.carry.noteLoad(); NS.carry.applyReceipts()`);
    expect(here(carrier)).toBe("true");
  });

  it("a record handed to one carrier is offered to another only after 24 hours without a receipt", () => {
    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
    hear(player, "Cee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Cee")).toEqual([]);
    CLOCK_STEP(player, 23 * 3600);
    player.run("NS.carry.carriers.Cee = nil; NS.carry.hiAt.Cee = nil");
    hear(player, "Cee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Cee")).toEqual([]);
    CLOCK_STEP(player, 3601);
    player.run("NS.carry.carriers.Cee = nil; NS.carry.hiAt.Cee = nil");
    hear(player, "Cee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Cee").length).toBeGreaterThan(0);
    // Now handed to Cee: Bee does not get it again within the per-carrier pause.
    player.run("NS.carry.carriers.Bee = nil; NS.carry.hiAt.Bee = nil");
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee")).toEqual([]);
  });
});

// 9.3.3: a party with no companion at all: each player's own finished run travels as a "run" record to a carrier met later.
describe.each<Kind>(["guilded", "standalone"])("own dungeon runs carried (%s)", (kind) => {
  const runs = "NS.getDb().dungeon.runs";
  const makeRun = (id: string, extra = "") => `${runs}[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
    startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Aye", reporters = { Aye = true },
    encounters = { { id = 2735, success = true, at = CLOCK - 1100 }, { id = 2732, success = false, at = CLOCK - 1500 } },
    players = { Aye = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900 }, Zed = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 1, presentSec = 880 } } ${extra} }`;
  const own = (s: LuaSession) => s.run(`local out = {}; for _, r in ipairs(NS.carry.collectOwn(true)) do if r.kind == "run" then out[#out + 1] = r.key end end; return table.concat(out, ",")`);

  it("is a flat record of the player's own run, only for a finished run nobody holds", () => {
    const player = client(kind, "Aye");
    player.run(makeRun("QG-20261114-153000-Aye"));
    expect(own(player)).toMatch(/^QG-20261114-153000-Aye-[0-9a-f]{6}$/);
    const data = player.run(`local r; for _, x in ipairs(NS.carry.collectOwn(true)) do if x.kind == "run" then r = x end end; return NS.carry.encode(r.data)`);
    expect(data).toContain("i=n389");
    expect(data).toContain("p1=sAye;WARRIOR;TANK;20;900;0");
    expect(data).toContain("ev=s2735:");
    // Not a run nobody needs: held by a bot, still being recorded, a received group copy, someone else's, or too big a party.
    player.run(makeRun("QG-synced", ", synced = true"));
    player.run(makeRun("QG-active", ", state = \"ACTIVE\""));
    player.run(makeRun("QG-group", ", viaGroup = true"));
    player.run(`${runs}["QG-other"] = { id = "QG-other", state = "COMPLETED", instanceId = 389, startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, players = { Zed = { level = 20 } } }`);
    player.run(makeRun("QG-six", `, players = { Aye = {}, B = {}, C = {}, D = {}, E = {}, F = {} }`));
    expect(own(player).split(",")).toHaveLength(1);
  });

  it("goes to a carrier by whisper, is stored under the sender's name, and stops once receipted", () => {
    const player = client(kind, "Aye");
    const carrier = client(kind, "Bee", { companion: true });
    player.run(makeRun("QG-20261114-153000-Aye"));
    hear(player, "Bee", "HI|1", "GUILD");
    const whispers = queued(player, "WHISPER", "Bee");
    expect(whispers.length).toBeGreaterThan(0);
    expect(whispers.every((text) => text.startsWith("R|run|"))).toBe(true);
    for (const text of whispers) hear(carrier, "Aye", text, "WHISPER");
    expect(carrier.run(`local d = NS.getDb().carry.records; local n = 0; for id, r in pairs(d) do if string.sub(id, 1, 4) == "run:" and r.from == "Aye" then n = n + 1 end end; return tostring(n)`)).toBe("1");
    const key = own(player);
    player.run(`GuildedCarryReceipts = { ${JSON.stringify(`run:${key}`)} }; NS.carry.noteLoad(); NS.carry.applyReceipts()`);
    expect(own(player)).toBe("");
  });
});

// 9.3.4: a player with no guild or group finds a carrier on the shared channel, quietly and with back-off.
describe("finding a carrier on the shared channel", () => {
  const joined = (s: LuaSession) => s.run(`CH = 9; function GetChannelName() return CH end; NS.carry.channelName = "GuildedCarryN"; DELAYS = {}
    C_Timer.After = function(seconds, fn) DELAYS[#DELAYS + 1] = seconds; TIMERS[#TIMERS + 1] = fn end; SENT = {}`);
  const asked = (s: LuaSession) => queued(s, "CHANNEL", "9");

  it("asks once on the channel when records wait and no carrier is known, and sends nothing in the cases it must stay quiet", () => {
    const player = client("guilded", "Aye");
    joined(player);
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    duel(player);
    expect(player.run("return tostring(NS.carry.ask())")).toBe("true");
    expect(asked(player)).toEqual(["Q|1"]);
    player.run("COMBAT = true");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    player.run("COMBAT = false; IsInInstance = function() return true end");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    player.run("IsInInstance = function() return false end; CH = 0");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    player.run("CH = 9; NS.carry.carriers.Bee = { name = 'Bee', at = CLOCK, fails = 0, sent = 0, pauseUntil = 0, near = false }");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    player.run("NS.carry.carriers = {}; GuildedCompanionFeatures = { ['carry-records'] = true, at = CLOCK }");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    expect(asked(player)).toEqual([]);
  });

  it("backs off while nobody answers (60, 180, 600, 1800 seconds, then 1800 again) and stops when nothing waits or a carrier answers", () => {
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    player.run("NS.carry.askTries = 0; NS.carry.scheduleAsk(60); NS.carry.scheduleAsk(60)");
    for (let round = 0; round < 6; round += 1) player.run("local list = TIMERS; TIMERS = {}; for _, fn in ipairs(list) do fn() end; CLOCK = CLOCK + 2000");
    expect(player.run("return table.concat(DELAYS, ',')")).toBe("60,180,600,1800,1800,1800,1800");
    // One chain at a time: the second schedule call at the start did nothing.
    expect(player.run("return tostring(NS.carry.stats.asked)")).toBe("6");
    // A carrier heard: the chain ends and the pause starts again at the first step.
    player.run("NS.carry.carriers.Bee = { name = 'Bee', at = CLOCK, fails = 0, sent = 0, pauseUntil = 0, near = false }; local list = TIMERS; TIMERS = {}; for _, fn in ipairs(list) do fn() end");
    expect(player.run("return #TIMERS .. ':' .. NS.carry.askTries")).toBe("0:0");
  });

  it("a carrier answers an ask with a whispered announcement, once per asker per five minutes and six a minute in all, never in combat or from guild chat", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Aye", "Q|1", "CHANNEL");
    expect(queued(carrier, "WHISPER", "Aye")).toEqual(["HI|1"]);
    hear(carrier, "Aye", "Q|1", "CHANNEL");
    expect(queued(carrier, "WHISPER", "Aye")).toEqual([]);
    CLOCK_STEP(carrier, 301);
    hear(carrier, "Aye", "Q|1", "CHANNEL");
    expect(queued(carrier, "WHISPER", "Aye")).toEqual(["HI|1"]);
    for (let i = 0; i < 12; i += 1) hear(carrier, `Walker${String.fromCharCode(97 + i)}`, "Q|1", "CHANNEL");
    flush(carrier);
    expect(sent(carrier).filter((line) => line.includes(">WHISPER>Walker")).length).toBe(5);
    CLOCK_STEP(carrier, 61);
    hear(carrier, "Late", "Q|1", "CHANNEL");
    expect(queued(carrier, "WHISPER", "Late")).toEqual(["HI|1"]);
    carrier.run("COMBAT = true");
    hear(carrier, "Combat", "Q|1", "CHANNEL");
    carrier.run("COMBAT = false");
    hear(carrier, "Guild", "Q|1", "GUILD");
    hear(carrier, "Junk", "Q|x", "CHANNEL");
    expect(sent(carrier).filter((line) => line.includes(">WHISPER>Combat") || line.includes(">WHISPER>Guild") || line.includes(">WHISPER>Junk"))).toEqual([]);
    // A PC without a carrying companion, or with carrying off, never answers.
    const plain = client("guilded", "Cee");
    hear(plain, "Aye", "Q|1", "CHANNEL");
    expect(queued(plain, "WHISPER", "Aye")).toEqual([]);
    carrier.run("NS.commandHandlers.carry({ 'off' }); SENT = {}");
    hear(carrier, "Fresh", "Q|1", "CHANNEL");
    expect(queued(carrier, "WHISPER", "Fresh")).toEqual([]);
  });

  it("the asker takes a whispered answer only shortly after asking, then hands over its records", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    // An answer nobody asked for is ignored.
    hear(player, "Bee", "HI|1", "WHISPER");
    expect(player.run("return NS.carry.carrierCount()")).toBe("0");
    player.run("NS.carry.ask()");
    flush(player); sent(player);
    hear(carrier, "Aye", "Q|1", "CHANNEL");
    const [answer] = queued(carrier, "WHISPER", "Aye");
    hear(player, "Bee", answer!, "WHISPER");
    expect(player.run("return NS.carry.carrierCount()")).toBe("1");
    const frames = queued(player, "WHISPER", "Bee");
    expect(frames.length).toBeGreaterThan(0);
    for (const text of frames) hear(carrier, "Aye", text, "WHISPER");
    expect(records(carrier)).toBe("1");
    // A late answer (more than a minute after the ask) is ignored.
    const slow = client("guilded", "Dee");
    joined(slow);
    duel(slow);
    slow.run("NS.carry.ask()");
    CLOCK_STEP(slow, 61);
    hear(slow, "Bee", "HI|1", "WHISPER");
    expect(slow.run("return NS.carry.carrierCount()")).toBe("0");
  });

  it("/guilded carry ask off stops asking (guild and group carriers still work); ask on starts again", () => {
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    player.run("MSGS = {}; NS.message = function(text) MSGS[#MSGS + 1] = text end; NS.commandHandlers.carry({ 'ask', 'off' })");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
    player.run("NS.carry.scheduleAsk(60); run_timers()");
    expect(player.run("return tostring(NS.carry.stats.asked)")).toBe("0");
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
    player.run("NS.carry.carriers = {}; NS.getDb().carry.sentTo = {}; NS.carry.ownCache = nil; NS.commandHandlers.carry({ 'ask', 'on' })");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("true");
    expect(player.run("return MSGS[1] .. '|' .. MSGS[2]")).toBe("Asking for a carrier is off. Guild and group carriers still work.|Asking for a carrier is on.");
  });

  it("a whispered answer resets the back-off, and is limited per sender like announcements", () => {
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    player.run("NS.carry.ask(); NS.carry.askTries = 3");
    hear(player, "Bee", "HI|1", "WHISPER");
    expect(player.run("return NS.carry.askTries")).toBe("0");
    player.run("NS.carry.carriers = {}; NS.carry.askTries = 3");
    hear(player, "Bee", "HI|1", "WHISPER");
    expect(player.run("return NS.carry.askTries .. ':' .. NS.carry.carrierCount()")).toBe("3:0");
  });

  it("the back-off restarts from the first step once the records are gone", () => {
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    player.run("NS.carry.askTries = 3; NS.getDb().duels.external = {}; NS.carry.ownCache = nil; NS.carry.scheduleAsk(60); run_timers()");
    expect(player.run("return NS.carry.askTries")).toBe("0");
  });

  it("the ask switch lives in the saved variables, not in the session", () => {
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    player.run("NS.message = function() end; NS.commandHandlers.carry({ 'ask', 'off' }); NS.carry.askTries = 0; NS.carry.askSentAt = nil; NS.carry.stats.asked = 0");
    expect(player.run("return tostring(NS.getDb().carry.noAsk)")).toBe("true");
    expect(player.run("return tostring(NS.carry.ask())")).toBe("false");
  });

  it("the dungeon carry switch turns the line to 'Carrying is off', with the same remedy", () => {
    const player = client("guilded", "Aye");
    duel(player);
    player.run("NS.carry.carriers.Bee = { name = 'Bee', at = CLOCK, fails = 0, sent = 0, pauseUntil = 0, near = true }; NS.dungeon.carryOn = function() return false end");
    const line = player.run("return NS.carry.windowLine()");
    expect(line).toContain("Carrying is off.");
    expect(line).not.toContain("will take them");
    expect(line).not.toContain("near you yet");
  });

  it("drops the 'since' clause when the time cannot be written", () => {
    const player = client("guilded", "Aye");
    duel(player);
    player.run("NS.util.whenText = function() return nil end");
    expect(player.run("return NS.carry.windowLine()")).toMatch(/^1 record is waiting\. No player/);
  });

  it("does not undo the cache on every read when records wait", () => {
    const player = client("guilded", "Aye");
    duel(player);
    player.run("NS.carry.windowLine()");
    expect(player.run("return tostring(NS.carry.ownCache ~= nil)")).toBe("true");
    const quietOne = client("guilded", "Dee");
    quietOne.run("NS.carry.windowLine()");
    expect(quietOne.run("return tostring(NS.carry.ownCache)")).toBe("nil");
  });

  it("says 'Carrying is off' at login once only, and again after carrying was switched on and off", () => {
    const player = client("guilded", "Aye");
    duel(player);
    player.run("MSGS = {}; NS.message = function(text) MSGS[#MSGS + 1] = text end; NS.commandHandlers.carry({ 'off' }); MSGS = {}; NS.carry.loginSaid = nil; NS.carry.loginLine()");
    expect(player.run("return #MSGS")).toBe("1");
    expect(player.run("return MSGS[1]")).toContain("Carrying is off.");
    player.run("NS.carry.loginSaid = nil; NS.carry.loginLine()");
    expect(player.run("return #MSGS")).toBe("1");
    // /guilded carry status still tells.
    expect(player.run("return NS.carry.statusLine()")).toBe("Carrying records is off. Type /guilded carry on to turn it on.");
    expect(player.run("return NS.carry.windowLine()")).toContain("Carrying is off.");
    player.run("NS.commandHandlers.carry({ 'on' }); NS.commandHandlers.carry({ 'off' }); MSGS = {}; NS.carry.loginSaid = nil; NS.carry.loginLine()");
    expect(player.run("return #MSGS")).toBe("1");
  });

  it("the game's 'no player named' line after a whispered answer is still hidden", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    carrier.run(`FILTERS = {}; ERR_CHAT_PLAYER_NOT_FOUND_S = "No player named '%s' is currently playing."
      function ChatFrame_AddMessageEventFilter(event, fn) FILTERS[event] = fn end
      NS.carry.filtersInstalled = nil; fire_event("PLAYER_LOGIN")`);
    hear(carrier, "Aye", "Q|1", "CHANNEL");
    expect(queued(carrier, "WHISPER", "Aye")).toEqual(["HI|1"]);
    expect(carrier.run("return tostring(FILTERS.CHAT_MSG_SYSTEM(nil, nil, \"No player named 'Aye' is currently playing.\"))")).toBe("true");
    expect(carrier.run("return tostring(FILTERS.CHAT_MSG_SYSTEM(nil, nil, \"No player named 'Zed' is currently playing.\"))")).toBe("false");
  });
});

// 9.3.7: records reach a carrier sooner after a dungeon, a carrier's "done" stays good for a week, and a busy carrier says so.
describe("faster handover, longer receipts and a busy carrier", () => {
  const joined = (s: LuaSession) => s.run(`CH = 9; function GetChannelName() return CH end; NS.carry.channelName = "GuildedCarryN"; SENT = {}`);

  it("after leaving an instance it offers to the carriers heard, or asks once when none is, and never closer than five minutes apart", () => {
    const player = client("guilded", "Aye");
    joined(player);
    duel(player);
    player.run("IsInInstance = function() return true end; fire_event('PLAYER_ENTERING_WORLD'); run_timers()");
    expect(queued(player, "CHANNEL", "9")).toEqual([]);
    player.run("IsInInstance = function() return false end; fire_event('PLAYER_ENTERING_WORLD')");
    expect(queued(player, "CHANNEL", "9")).toEqual(["Q|1"]);
    // Another exit right away does nothing more.
    player.run("IsInInstance = function() return true end; fire_event('PLAYER_ENTERING_WORLD'); IsInInstance = function() return false end; fire_event('PLAYER_ENTERING_WORLD')");
    expect(queued(player, "CHANNEL", "9")).toEqual([]);
    // Later, with a carrier known (heard while inside, so nothing was offered), the records are offered.
    CLOCK_STEP(player, 400);
    player.run("NS.carry.carriers.Bee = { name = 'Bee', at = CLOCK, fails = 0, sent = 0, pauseUntil = 0, near = true }");
    player.run("IsInInstance = function() return true end; fire_event('PLAYER_ENTERING_WORLD'); IsInInstance = function() return false end; fire_event('PLAYER_ENTERING_WORLD')");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
  });

  it("asks nothing after an instance when no record waits, and once shortly after login", () => {
    const quietOne = client("guilded", "Dee");
    joined(quietOne);
    quietOne.run("IsInInstance = function() return true end; fire_event('PLAYER_ENTERING_WORLD'); IsInInstance = function() return false end; fire_event('PLAYER_ENTERING_WORLD')");
    expect(queued(quietOne, "CHANNEL", "9")).toEqual([]);
    const player = client("guilded", "Aye");
    duel(player);
    player.run("CH = 9; function GetChannelName() return CH end; NS.carry.channelName = 'GuildedCarryN'; SENT = {}; fire_event('PLAYER_LOGIN'); run_timers()");
    expect(queued(player, "CHANNEL", "9")).toContain("Q|1");
  });

  it("a carrier tells the author done for a record received up to a week ago, and not for an older one", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    for (const [key, age] of [["1800000001-aaaaaa", 3 * 86400], ["1800000002-bbbbbb", 8 * 86400]] as const) {
      carrier.run(`local s = NS.getDb().carry; s.records["externalDuel:${key}"] = { kind = "externalDuel", key = "${key}", author = "Aye", from = "Aye", data = { at = 1 }, got = CLOCK - ${age} }`);
      carrier.run(`GuildedCarryReceipts = { "externalDuel:${key}" }; NS.carry.receiptsSeen = {}; NS.carry.applyReceipts()`);
    }
    expect(queued(carrier, "WHISPER", "Aye")).toEqual(["K|externalDuel:1800000001-aaaaaa"]);
  });

  it("a carrier over its limits answers busy once, and the sender hands the record to another carrier without waiting", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    for (let i = 0; i < 20; i++) hear(carrier, "Mallory", part(`17${String(i).padStart(8, "0")}-eeeeee`, 1, 1, "winner=sAye&loser=sZed&at=n1799999000"), "WHISPER");
    queued(carrier, "WHISPER");
    hear(carrier, "Mallory", part("1700000099-eeeeee", 1, 1), "WHISPER");
    hear(carrier, "Mallory", part("1700000099-eeeeee", 1, 1), "WHISPER");
    expect(queued(carrier, "WHISPER", "Mallory")).toEqual(["B|externalDuel:1700000099-eeeeee"]);
    expect(count(carrier, "NS.getDb().carry.records")).toBe(20);

    const player = client("guilded", "Aye");
    duel(player);
    hear(player, "Bee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Bee").length).toBeGreaterThan(0);
    const id = player.run("for k in pairs(NS.getDb().carry.sentTo) do return k end");
    // A busy answer from a name the record was not handed to changes nothing.
    hear(player, "Cee", `B|${id}`, "WHISPER");
    expect(count(player, "NS.getDb().carry.sentTo")).toBe(1);
    hear(player, "Bee", `B|${id}`, "WHISPER");
    expect(count(player, "NS.getDb().carry.sentTo")).toBe(0);
    expect(player.run("return tostring(NS.carry.carriers.Bee.pauseUntil > CLOCK)")).toBe("true");
    hear(player, "Dee", "HI|1", "GUILD");
    expect(queued(player, "WHISPER", "Dee").length).toBeGreaterThan(0);
  });

  it("an older addon that does not know the busy answer ignores it (only R, K, HI, Q and GOFF are acted on)", () => {
    const carrier = client("guilded", "Bee", { companion: true });
    hear(carrier, "Aye", "B|externalDuel:1700000099-eeeeee", "WHISPER");
    expect(records(carrier)).toBe("0");
    expect(queued(carrier, "WHISPER")).toEqual([]);
  });
});

// 9.3.8: the run's presence proof (the same integrity data a companion upload carries) rides along when it fits.
describe.each<Kind>(["guilded", "standalone"])("own dungeon runs carry a presence proof (%s)", (kind) => {
  const runs = "NS.getDb().dungeon.runs";
  /** A five-player run of `seconds` with `spans` known spans per player (each `spanLen` long, 3 s apart). */
  const proofRun = (id: string, opts: { spans?: number; spanLen?: number; gap?: number; names?: string[]; withIntegrity?: boolean } = {}) => {
    const names = opts.names ?? ["Aye", "Bee", "Cee", "Dee", "Eve"];
    const spans = opts.spans ?? 1, spanLen = opts.spanLen ?? 1400, gap = opts.gap ?? 3;
    return `local start = CLOCK - 2000
      local run = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 0,
        startedAt = start, endedAt = start + 1500, completedBy = "final boss", recorder = "Aye", reporters = { Aye = true },
        encounters = { { id = 2735, success = true, at = start + 1500, source = "native" }, { id = 2732, success = true, at = start + 700 } }, players = {} }
      ${opts.withIntegrity === false ? "" : `run.integrity = { version = 2, startWitness = "unknown", startTrigger = "first combat", continuous = true, observer = "Aye", detectedAt = start - 2, combatAt = start + 3 }`}
      local roles = { "TANK", "HEALER", "DPS", "DPS", "DPS" }
      for i, name in ipairs({ ${names.map((n) => JSON.stringify(n)).join(", ")} }) do
        local spans, at, known = {}, start + 5, 0
        for _ = 1, ${spans} do spans[#spans + 1] = { at, at + ${spanLen} }; known = known + ${spanLen}; at = at + ${spanLen} + ${gap} end
        run.players[name] = { class = "WARRIOR", role = roles[i], level = 20, deaths = 0, presentSec = 1400,
          ${opts.withIntegrity === false ? "" : `integrity = { knownSec = known, unknownSec = 0, lockedRole = roles[i], mixedRole = false, knownIntervals = spans }`} }
      end
      ${runs}[${JSON.stringify(id)}] = run`;
  };
  const record = (s: LuaSession) => JSON.parse(s.run(`local r; for _, x in ipairs(NS.carry.collectOwn(true)) do if x.kind == "run" then r = x end end
      local function js(v) local t = type(v); if t == "string" then return string.format("%q", v) elseif t == "number" or t == "boolean" then return tostring(v) elseif t == "table" then local p = {}; for k, x in pairs(v) do p[#p + 1] = js(tostring(k)) .. ":" .. js(x) end; return "{" .. table.concat(p, ",") .. "}" end; return "null" end
      return r and js(r.data) or "null"`)) as Record<string, string> | null;
  /** The size the companion measures: the JSON text of the whole record (key, author and time included), which must stay within 2048. */
  const jsonSize = (s: LuaSession) => JSON.stringify(JSON.parse(s.run(`local r; for _, x in ipairs(NS.carry.collectOwn(true)) do if x.kind == "run" then r = x end end
      local function js(v) local t = type(v); if t == "string" then return string.format("%q", v) elseif t == "number" or t == "boolean" then return tostring(v) elseif t == "table" then local p = {}; for k, x in pairs(v) do p[#p + 1] = js(tostring(k)) .. ":" .. js(x) end; return "{" .. table.concat(p, ",") .. "}" end; return "null" end
      return js({ kind = r.kind, key = r.key, author = r.author, data = r.data, at = r.at })`))).length;
  const encodedSize = (s: LuaSession) => Number(s.run(`local r; for _, x in ipairs(NS.carry.collectOwn(true)) do if x.kind == "run" then r = x end end; return tostring(#NS.carry.encode(r.data))`));

  it("adds the run's observation, each player's known spans and the native kills", () => {
    const player = client(kind, "Aye");
    player.run(proofRun("QG-20261114-153000-Aye"));
    const data = record(player)!;
    expect(data["ig"]).toBe("Aye;f;-2;3;1;u");
    expect(data["ns"]).toBe(`2735:${Number(data["st"]) + 1500}`);
    // Names are sorted (Aye, Bee, ...): player 1 is Aye, a tank with one span of 1400 s that starts 5 s after the run's start.
    expect(data["q1"]).toBe("1400;0;T;0;5.1400");
    expect(data["q2"]).toBe("1400;0;H;0;5.1400");
    expect(data["p1"]).toBe("Aye;WARRIOR;TANK;20;1400;0");
  });

  it("sends nothing extra without integrity (an older record, a peer-merged copy, an observer outside the run)", () => {
    const player = client(kind, "Aye");
    player.run(proofRun("QG-20261114-153000-Aye", { withIntegrity: false }));
    const plain = record(player)!;
    expect(plain["ig"]).toBeUndefined();
    expect(Object.keys(plain).some((key) => /^q\d$/.test(key))).toBe(false);
    player.run(proofRun("QG-20261114-154000-Aye", {}) + `; ${runs}["QG-20261114-154000-Aye"].integrity.observer = "Nobody"; ${runs}["QG-20261114-153000-Aye"] = nil`);
    expect(record(player)!["ig"]).toBeUndefined();
  });

  it("worst case: five players with 64 spans each still fits 2 KB by dropping the shortest spans; the run keeps its base data", () => {
    const player = client(kind, "Aye");
    player.run(proofRun("QG-20261114-153000-Aye", { spans: 64, spanLen: 10, gap: 10, names: ["Aaaaaaaaaaaa", "Bbbbbbbbbbbb", "Cccccccccccc", "Dddddddddddd", "Aye"] }));
    const data = record(player)!;
    expect(data["p2"]).toContain("Aye;");
    expect(encodedSize(player)).toBeLessThanOrEqual(1750);
    expect(jsonSize(player)).toBeLessThanOrEqual(2048);
    // 64 spans of five players cannot fit: spans were dropped (known time shrank), never extended.
    const known = Object.entries(data).filter(([key]) => /^q\d$/.test(key)).reduce((sum, [, value]) => sum + Number(value.split(";")[0]), 0);
    expect(known).toBeLessThan(5 * 64 * 10);
    expect(known).toBeGreaterThan(0);
  });

  it("a realistic five-player run with proof is far below the limit", () => {
    const player = client(kind, "Aye");
    player.run(proofRun("QG-20261114-153000-Aye", { spans: 3, spanLen: 400, names: ["Aaaaaaaaaaaa", "Bbbbbbbbbbbb", "Cccccccccccc", "Dddddddddddd", "Aye"] }));
    expect(encodedSize(player)).toBeLessThan(1200);
    expect(jsonSize(player)).toBeLessThan(1400);
    expect(record(player)!["q1"]).toBeDefined();
  });
});
