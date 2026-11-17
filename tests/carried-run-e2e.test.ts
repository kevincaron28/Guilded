/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory stand-ins for the few Prisma calls the carried-run lane makes */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newLuaSession, type LuaSession } from "./lua/harness.js";
import { exportCarriedRecords } from "../companion/carry-content.mjs";
import { parseCarryReceipts, receiptIdsOf, writeCarryReceipts } from "../companion/carry.mjs";
import { applyCarriedRecords } from "../src/services/carried-records.js";
import { agrees, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { rankCharacters, type LeaderRun } from "../src/services/public-leaderboard.js";
import { withIntegrityWindow } from "../src/services/dungeon-integrity.js";
import { publicRules } from "../src/services/public-score.js";

// Offline end to end (9.3.x): an addon-only player (no companion, no guild) finishes a dungeon; the real Carry.lua hands the run to whoever is online
// (a carrier); the carrier's companion export goes through the bot's carried-record lane; the receipt travels back through the companion's Carry.lua
// to the carrier's addon, which tells the player. The run must stand on the public board and rank the player. Only the database and the public run
// store are in-memory stand-ins; everything else is the real code.

const CLOCK = Math.floor(Date.now() / 60_000) * 60;
const NOW = new Date(CLOCK * 1000);
const START = CLOCK - 2000;
const stamp = (at: number) => new Date(at * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const sessions: LuaSession[] = [];
const dirs: string[] = [];
afterEach(async () => { for (const s of sessions.splice(0)) s.close(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

function client(name: string, opts: { companion?: boolean } = {}): LuaSession {
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
  for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua", "Modules/Carry.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
  if (opts.companion) s.run(`GuildedCompanionFeatures = { ["carry-records"] = true, at = CLOCK }`);
  return s;
}
const flush = (s: LuaSession) => s.run("run_timers()");
const sent = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.channel .. ">" .. tostring(m.target) .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`).split("\n").filter(Boolean);
const queued = (s: LuaSession, channel: string, target?: string) => { flush(s); return sent(s).map((line) => line.split(">")).filter((p) => p[1] === channel && (!target || p[2] === target)).map((p) => p.slice(3).join(">")); };
const hear = (to: LuaSession, from: string, text: string, channel: string) => to.run(`fire_event("CHAT_MSG_ADDON", "GuildedCry", ${JSON.stringify(text)}, ${JSON.stringify(channel)}, "${from}-Realm")`);
const waiting = (s: LuaSession) => Number(s.run("return tostring(#NS.carry.collectOwn(true))"));

/** A finished run in the player's own addon (difficulty 0 is what the Forever client reports for Normal in real exported runs, docs/DUNGEON_BETA_PRESET_2026-10.md): "Alice Guildless" (tank) and Bob (mage), no guild anywhere. `idTime` is the time in the run id (each recorder names it after itself). */
function finishRun(s: LuaSession, recorder: string, idTime: number, dungeon: { instanceId: number; name: string; bossId: number; level?: number; proof?: boolean } = { instanceId: 389, name: "Ragefire Chasm", bossId: 2735 }) {
  const id = `QG-${stamp(idTime)}-${recorder}`;
  s.run(`local root = NS.getDb(); root.dungeon = root.dungeon or {}; root.dungeon.runs = root.dungeon.runs or {}
    root.dungeon.runs[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = ${dungeon.instanceId}, name = ${JSON.stringify(dungeon.name)}, difficultyId = 0,
      startedAt = ${START}, endedAt = ${START + 1500}, completedBy = "final boss", recorder = ${JSON.stringify(recorder)}, reporters = { ${recorder} = true },
      encounters = { { id = ${dungeon.bossId}, success = true, at = ${START + 1500}${dungeon.proof ? `, source = "native"` : ""} } },
      players = { Alice = { class = "WARRIOR", role = "TANK", level = ${dungeon.level ?? 20}, deaths = 0, presentSec = 1450${dungeon.proof ? `, integrity = { knownSec = 1450, unknownSec = 0, lockedRole = "TANK", mixedRole = false, knownIntervals = { { ${START + 5}, ${START + 1455} } } }` : ""} },
        Bob = { class = "MAGE", role = "DAMAGER", level = ${dungeon.level ?? 20}, deaths = 1, presentSec = 1400${dungeon.proof ? `, integrity = { knownSec = 700, unknownSec = 750, lockedRole = "DPS", mixedRole = false, knownIntervals = { { ${START + 5}, ${START + 705} } } }` : ""} } } }
    ${dungeon.proof ? `root.dungeon.runs[${JSON.stringify(id)}].integrity = { version = 2, startWitness = "unknown", startTrigger = "first combat", continuous = true, observer = ${JSON.stringify(recorder)}, detectedAt = ${START - 2}, combatAt = ${START + 3} }` : ""}`);
  return id;
}

/** The carrier's stored records as the companion reads them from the saved file (a JSON round trip of the Lua table). */
function savedRecords(carrier: LuaSession) {
  const json = carrier.run(`local function js(v)
      local t = type(v)
      if t == "string" then return string.format("%q", v)
      elseif t == "number" or t == "boolean" then return tostring(v)
      elseif t == "table" then local parts = {}; for k, x in pairs(v) do parts[#parts + 1] = js(tostring(k)) .. ":" .. js(x) end; return "{" .. table.concat(parts, ",") .. "}" end
      return "null"
    end
    return js(NS.getDb().carry.records)`);
  return exportCarriedRecords({ carry: { records: JSON.parse(json) } }) as { kind: string; key: string; author: string; data: Record<string, unknown> }[];
}

/** The player hands the run to the carrier by whisper (the real frames), the carrier keeps it. */
function hand(player: LuaSession, name: string, carrier: LuaSession, carrierName: string) {
  hear(player, carrierName, "HI|1", "GUILD");
  const frames = queued(player, "WHISPER", carrierName);
  expect(frames.length).toBeGreaterThan(0);
  for (const text of frames) hear(carrier, name, text, "WHISPER");
}

interface Row { id: number; kind: string; key: string; author: string; authorKey: string; carrier: string; status: string; runKey?: string | null; createdAt: Date }
function fakeDb() {
  const rows: Row[] = [];
  let counter = 0;
  const matches = (row: Row, where: any): boolean => Object.entries(where ?? {}).every(([field, wanted]) => {
    if (field === "createdAt" && (wanted as any)?.lt) return row.createdAt < (wanted as any).lt;
    if (field === "createdAt" && (wanted as any)?.gte) return row.createdAt >= (wanted as any).gte;
    if (field === "carrier" && typeof wanted === "object") return row.carrier.startsWith((wanted as any).startsWith);
    return (row as any)[field] === wanted;
  });
  const db: any = {
    carriedRecord: {
      count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
      findUnique: async ({ where }: any) => rows.find((row) => row.kind === where.kind_authorKey_key.kind && row.authorKey === where.kind_authorKey_key.authorKey && row.key === where.kind_authorKey_key.key) ?? null,
      findMany: async ({ where, distinct }: any) => {
        let out = rows.filter((row) => matches(row, where));
        if (distinct) out = out.filter((row, index) => out.findIndex((other) => (other as any)[distinct[0]] === (row as any)[distinct[0]]) === index);
        return out;
      },
      create: async ({ data: created }: any) => {
        if (rows.some((row) => row.kind === created.kind && row.authorKey === created.authorKey && row.key === created.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        rows.push({ id: ++counter, createdAt: NOW, ...created }); return created;
      },
      updateMany: async ({ where, data: changes }: any) => { const hit = rows.filter((row) => matches(row, where)); for (const row of hit) Object.assign(row, changes); return { count: hit.length }; },
      deleteMany: async ({ where }: any) => { const hit = rows.filter((row) => matches(row, where)); for (const row of hit) rows.splice(rows.indexOf(row), 1); return { count: hit.length }; }
    }
  };
  return { db, rows };
}
function memoryStore() {
  const runs = new Map<string, StoredRun & { summary: RunSummary }>();
  const uploads: { key: string }[] = [];
  let next = 0;
  const store: PublicRunStore = {
    async findRun(runKey) { return runs.get(runKey) ?? null; },
    async findRunsNear(_edition, instanceId, startedAt, windowSec) { return [...runs.values()].filter((row) => row.instanceId === instanceId && Math.abs(row.startedAt.getTime() - startedAt.getTime()) <= windowSec * 1000); },
    async createRun(summary, uploader) { uploads.push({ key: uploader.key }); runs.set(summary.runKey, { ...summary, id: `r${++next}`, status: "ACCEPTED", uploaders: [uploader.key], reporters: [...uploader.reporters], summary, confirmations: 1 } as never); },
    async addUpload(runId, uploader, summary) { const row = [...runs.values()].find((entry) => entry.id === runId)!; const agree = agrees(row, summary); row.uploaders.push(uploader.key); uploads.push({ key: uploader.key }); return { agree, duplicate: false }; },
    async uploadsSince(key) { return uploads.filter((entry) => entry.key === key).length; },
    async storedRefs() { return []; }
  };
  return { store, runs };
}
const leaderRun = (row: StoredRun & { summary: RunSummary }): LeaderRun => ({
  runId: row.id, instanceId: row.summary.instanceId, dungeonName: row.summary.dungeonName, durationSec: row.summary.durationSec, endedAt: row.summary.endedAt, deaths: row.summary.deaths, bracket: row.summary.bracket,
  season: "s1", confirmations: 1, routeKey: row.summary.routeKey, difficultyId: row.summary.difficultyId,
  evidence: { startedAt: row.summary.startedAt, completedBy: row.summary.completedBy, encounters: row.summary.encounters,
    ...(row.summary.integrity ? { integrity: (row.summary.integrity as { run: unknown }).run, receivedAt: NOW } : {}) },
  players: row.summary.players.map((player) => ({ ...player, minLevel: player.level, presentSec: player.presentSec,
    ...(row.summary.integrity ? { integrity: (row.summary.integrity as { players: { character: string; observation: unknown }[] }).players.find((seen) => seen.character === player.character)?.observation } : {}) }))
}) as never;
const ranked = (runs: Map<string, StoredRun & { summary: RunSummary }>, policy: "current-v1" | "current-v2") =>
  rankCharacters([...runs.values()].map(leaderRun), { className: null, role: null, confirmed: false }, 100,
    withIntegrityWindow({ ...publicRules(), evidencePolicy: policy }, new Date((CLOCK - 86_400 * 30) * 1000), null)).map((entry) => entry.player.character);

/** The companion writes the bot's receipts for the carrier's addon; returns what its Carry.lua says. */
async function companionWrites(receipts: string[]) {
  const root = await mkdtemp(join(tmpdir(), "carried-e2e-"));
  dirs.push(root);
  const addons = join(root, "Interface", "AddOns");
  await mkdir(join(addons, "Guilded"), { recursive: true });
  await writeFile(join(addons, "Guilded", "Standings.lua"), "", "utf8");
  const config = { watchFile: join(root, "WTF", "Account", "A", "SavedVariables", "Guilded.lua") };
  expect((await writeCarryReceipts(config, { carriedReceipts: receipts })).length).toBeGreaterThan(0);
  return parseCarryReceipts(await readFile(join(addons, "Guilded", "Carry.lua"), "utf8"));
}

describe.each([
  { label: "a carrier with no guild (an unsigned device)", carrier: "device:bee-pc" },
  { label: "a carrier signed in to another guild's server", carrier: "member:other-guild-officer" }
])("an addon-only run reaches the public board through $label", ({ carrier }) => {
  it("travels from the player's addon to the board, the receipt comes back and stops it", async () => {
    const alice = client("Alice");
    const bee = client("Bee", { companion: true });
    const id = finishRun(alice, "Alice", START);
    expect(waiting(alice)).toBe(1);
    hand(alice, "Alice", bee, "Bee");

    const records = savedRecords(bee);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: "run", author: "Alice" });
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const shared: unknown[][] = [];
    const out = await applyCarriedRecords(db, { carrier, carrierKeys: new Set(["bee"]), now: NOW, records, relay: { store, onPlaced: (list: unknown[]) => shared.push(list) } });
    expect(out.receipts).toEqual([`carry:run:${records[0]!.key}`]);
    // The run is on the public boards with no guild and no link behind it.
    expect(runs.size).toBe(1);
    const placed = [...runs.values()][0]!;
    expect(placed.status).toBe("ACCEPTED");
    expect(placed.runKey).toBe(`389:${id}`);
    expect(rows[0]).toMatchObject({ status: "applied", carrier });
    expect(shared).toHaveLength(1);

    // The receipt: bot answer -> companion's Carry.lua -> carrier addon -> the player.
    const written = await companionWrites(out.receipts);
    expect(written).toEqual([`run:${records[0]!.key}`]);
    expect(receiptIdsOf({ carriedReceipts: out.receipts })).toEqual(written);
    bee.run(`GuildedCarryReceipts = { ${written.map((value) => JSON.stringify(value)).join(", ")} }`);
    expect(bee.run("return tostring(NS.carry.applyReceipts())")).toBe("1");
    const told = queued(bee, "WHISPER", "Alice");
    expect(told).toEqual([`K|run:${records[0]!.key}`]);
    hear(alice, "Bee", told[0]!, "WHISPER");
    expect(waiting(alice)).toBe(0);

    // And the player ranks on the public leaderboard under the season's current rules.
    expect(ranked(runs, "current-v1")).toContain("Alice");
  });

  it("a Scarlet Monastery wing is told apart from boss ids alone (the carried record has no boss names), so the run ranks like an uploaded one", async () => {
    const alice = client("Alice");
    const bee = client("Bee", { companion: true });
    finishRun(alice, "Alice", START, { instanceId: 189, name: "Scarlet Monastery", bossId: 448, level: 36 });
    hand(alice, "Alice", bee, "Bee");
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    await applyCarriedRecords(db, { carrier, carrierKeys: new Set(["bee"]), now: NOW, records: savedRecords(bee), relay: { store } });
    expect([...runs.values()][0]?.routeKey).toBe("189:armory");
    expect(ranked(runs, "current-v1")).toContain("Alice");
  });

  it("a second party member's copy of the same run is a receipted confirmation: one run, no extra daily key", async () => {
    const alice = client("Alice");
    const bob = client("Bob");
    const bee = client("Bee", { companion: true });
    finishRun(alice, "Alice", START);
    finishRun(bob, "Bob", START + 20);
    hand(alice, "Alice", bee, "Bee");
    hand(bob, "Bob", bee, "Bee");
    const records = savedRecords(bee);
    expect(records).toHaveLength(2);
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const out = await applyCarriedRecords(db, { carrier, carrierKeys: new Set(["bee"]), now: NOW, records, relay: { store } });
    expect(out.receipts).toHaveLength(2);
    expect(runs.size).toBe(1);
    expect(rows.filter((row) => row.status === "applied")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "copy")).toHaveLength(1);
    // The day's distinct runs: the copy is not one.
    expect(new Set(rows.filter((row) => row.status !== "copy").map((row) => row.runKey)).size).toBe(1);
    expect(ranked(runs, "current-v1").sort()).toEqual(["Alice", "Bob"]);
  });

  it("under current-v2 rules a carried run WITH the addon's presence proof ranks the players it proves present, and not the others", async () => {
    const alice = client("Alice");
    const bee = client("Bee", { companion: true });
    finishRun(alice, "Alice", START, { instanceId: 389, name: "Ragefire Chasm", bossId: 2735, proof: true });
    hand(alice, "Alice", bee, "Bee");
    const records = savedRecords(bee);
    expect(JSON.stringify(records[0]).length).toBeLessThan(2048);
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    await applyCarriedRecords(db, { carrier, carrierKeys: new Set(["bee"]), now: NOW, records, relay: { store } });
    expect(runs.size).toBe(1);
    // Alice was seen for 1450 of 1500 s; Bob for 700 s only (under 80%): the proof ranks Alice alone. Season 1 rules still rank both.
    expect(ranked(runs, "current-v2")).toEqual(["Alice"]);
    expect(ranked(runs, "current-v1").sort()).toEqual(["Alice", "Bob"]);
  });

  it("(G1) under current-v2 rules a carried run WITHOUT the proof (an older addon) is not ranked, as before", async () => {
    const alice = client("Alice");
    const bee = client("Bee", { companion: true });
    finishRun(alice, "Alice", START);
    hand(alice, "Alice", bee, "Bee");
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    await applyCarriedRecords(db, { carrier, carrierKeys: new Set(["bee"]), now: NOW, records: savedRecords(bee), relay: { store } });
    expect(runs.size).toBe(1);
    // Documents the gap, not a wish: until carried runs carry presence evidence, Season 2 (current-v2) leaves them unranked.
    expect(ranked(runs, "current-v2")).toEqual([]);
  });
});
