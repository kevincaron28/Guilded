import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { readAddonExport } from "../companion/lua-export.mjs";
import { witnessTables } from "./helpers/witness-tables.js";
import { mergeDeviceReceipts, parseDeviceReceipts, readDeviceReceipts, writeDeviceReceipts } from "../companion/device-receipts.mjs";
import { handleDeviceUpload, prismaInstallStore, storeDeviceRuns, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { newLuaSession, type LuaSession } from "./lua/harness.js";

// 9.1.3 (second-PC test of 9.1.2): an unsigned (device-key) companion uploaded its runs, but 10 stayed "waiting" for ever.
// The whole path, in one test: saved file -> device upload -> the bot stores the runs and writes receipts -> the answer
// carries the receipts -> the companion writes them for the addon -> the addon marks the runs synced at the next load.

const dirs: string[] = [];
let lua: LuaSession | undefined;
afterEach(() => { lua?.close(); lua = undefined; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const season = { id: "s1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: null, status: "ACTIVE", name: "Season 1", ratingRules: provisionalSeasonRules().rules };
const START = Math.floor(new Date("2026-11-08T20:00:00Z").getTime() / 1000);
const now = new Date("2026-11-09T12:00:00Z");

/** A transaction double with the tables the run import reads and writes, receipts included. */
function fakeDatabase() {
  const runs: Record<string, unknown>[] = [];
  const receipts: Record<string, unknown>[] = [];
  // Meo (this PC's character) is in the officer-synced roster, so the run counts on its own.
  const trust = witnessTables(["meo gratton"]);
  const tx = {
    ...trust.tables,
    guild: { findUnique: async () => ({ gameEdition: "forever" }) },
    character: { findMany: async () => [] },
    guildSettings: { findUnique: async () => ({ dungeonLeaderboardChannelId: null }) },
    dungeonSeason: { findFirst: async () => season, create: async () => season, update: vi.fn() },
    dungeonRun: {
      groupBy: async () => [], aggregate: async () => ({ _min: { durationSec: null }, _count: { _all: 0 } }),
      updateMany: async () => ({ count: 0 }),
      findUnique: async ({ where }: { where: { guildId_runRef: { runRef: string } } }) => runs.find((r) => r["runRef"] === where.guildId_runRef.runRef) ?? null,
      findMany: async ({ where }: { where: { runRef?: { in: string[] }; instanceId?: number; valid?: boolean; state?: string; completedBy?: string } }) => runs.filter((r) =>
        (!where.runRef || where.runRef.in.includes(r["runRef"] as string)) && (where.instanceId === undefined || r["instanceId"] === where.instanceId)
        && (where.valid === undefined || r["valid"] === where.valid) && (where.state === undefined || r["state"] === where.state)
        && (where.completedBy === undefined || r["completedBy"] === where.completedBy)),
      create: async ({ data }: { data: Record<string, unknown> & { players: { create: { character: string; memberId: string | null }[] } } }) => {
        const row = { ...data, id: `run-${runs.length + 1}`, players: data.players.create.map((p) => ({ ...p, member: null })) };
        runs.push(row);
        return row;
      }
    },
    dungeonRunReceipt: {
      findMany: async ({ where }: { where: { guildId: string; runRef: { in: string[] }; outcome?: string | { not: string } } }) =>
        receipts.filter((r) => r["guildId"] === where.guildId && where.runRef.in.includes(r["runRef"] as string)
          && (!where.outcome || (typeof where.outcome === "string" ? r["outcome"] === where.outcome : r["outcome"] !== where.outcome.not))),
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => { receipts.push(...data); return { count: data.length }; },
      updateMany: async () => ({ count: 0 }),
      update: async () => ({})
    },
    dungeonAchievement: { findMany: async () => [], create: async () => ({}) },
    dungeonPointTransaction: { create: async ({ data }: { data: unknown }) => data }
  };
  return { tx, runs, receipts };
}

const luaRun = (id: string, over: { endedAt?: number; instanceId?: number } = {}) => {
  const endedAt = over.endedAt ?? START + 2700;
  return `{ id = "${id}", state = "COMPLETED", instanceId = ${over.instanceId ?? 90}, name = "Gnomeregan", difficultyId = 0, startedAt = ${endedAt - 2700}, endedAt = ${endedAt}, completedBy = "final boss",
    players = { ["Meo"] = { presentSec = 2700, inGuild = true, level = 30, deaths = 0 }, ["Bob"] = { presentSec = 2700, inGuild = true, level = 30, deaths = 0 }, ["Amy"] = { presentSec = 2700, inGuild = true, level = 30, deaths = 0 } }, encounters = {} }`;
};

function layout() {
  const root = mkdtempSync(join(tmpdir(), "qg-receipts-"));
  dirs.push(root);
  const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
  const guilded = join(root, "Interface", "AddOns", "Guilded");
  mkdirSync(saved, { recursive: true });
  mkdirSync(guilded, { recursive: true });
  writeFileSync(join(guilded, "Guilded.toc"), "## Interface: 11508\n## Title: Guilded\nStandings.lua\n");
  // A signed-in companion of someone else used this folder before: its Standings.lua still names its Discord user.
  writeFileSync(join(guilded, "Standings.lua"), 'GuildedLinkedAs = "Meo Gratton"\nGuildedDungeonAccepted = { "old-run" }\n');
  const file = join(saved, "Guilded.lua");
  const runs = [luaRun("QG-1"), luaRun("QG-2", { endedAt: START + 9000 }), luaRun("QG-3", { endedAt: START + 20000 }), luaRun("QG-RESET", { endedAt: START - 8 * 86400 })];
  writeFileSync(file, `GuildedDB = { version = 3, guildKey = "Quebec Gold-CAMWOW US2 Realm 2 PvP", character = { name = "Meo", realm = "", class = "PALADIN", level = 30, gameEdition = "forever" },
    dungeon = { runs = { ${runs.map((run, i) => `[${i + 1}] = ${run}`).join(", ")} } } }`);
  return { root, file, guilded };
}

const quebec: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
const device: DeviceRow = { id: "d1", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 };

function botStore(database: ReturnType<typeof fakeDatabase>): DeviceStore {
  const real = prismaInstallStore(database.tx as never);
  return {
    async create() { return { id: "d1" }; },
    async find() { return device; },
    // Matched by the in-game guild name, not the realm (#695): the guild is on "Realm 2", the character on another realm.
    async candidates(nameKey) { return nameKey === "quebec gold" ? [quebec] : []; },
    async characterKeys() { return []; },
    async saveUpload() { /* device rows are not under test */ },
    async claim() { return false; },
    importRuns: (guildId, runs, at, source) => storeDeviceRuns(database.tx as never, guildId, runs, at, source),
    receipts: (guildId, refs) => real.receipts!(guildId, refs)
  };
}

/** One companion upload against the bot double: the JSON the bot would answer. */
async function sync(file: string, database: ReturnType<typeof fakeDatabase>, acknowledged = new Set<string>()) {
  const full = await readAddonExport(file, "Forever");
  const body = JSON.parse(JSON.stringify(deviceUploadBody(full, { acknowledged })));
  return { body, answer: JSON.parse(JSON.stringify(await handleDeviceUpload(botStore(database), device, body, { now, allows: () => true, runLimiter: () => true }))) };
}

function addonSession() {
  lua = newLuaSession();
  lua.run(`NS = {}; GuildedDB = nil; CLOCK = 1800000000; CHAT_LOG = {}
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }`);
  for (const name of ["Core.lua", "Locale.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua", "Modules/CompanionLink.lua"]) lua.load(name);
  lua.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return ${START + 86400} end
    NS.playerName = function() return "Meo" end`);
  return lua;
}

describe("unsigned companion: runs reach the bot and come back as receipts", () => {
  it("stores the runs, answers with receipts, and the addon marks them synced", async () => {
    const { file, guilded } = layout();
    const database = fakeDatabase();
    const { body, answer } = await sync(file, database);
    // Four finished runs went up under the device key, with the guild's name and no Discord sign-in.
    expect(body.dungeonRuns).toHaveLength(4);
    expect(body.guild).toEqual({ name: "Quebec Gold", realm: "CAMWOW US2 Realm 2 PvP" });
    // The server was found by the in-game guild name and the runs were stored for it.
    expect(answer).toMatchObject({ status: "synced", server: { discordId: "111111111" }, runs: { received: 4 } });
    expect(database.runs.map((run) => run["runRef"]).sort()).toEqual(["QG-1", "QG-2", "QG-3", "QG-RESET"]);
    // A run from before the season is kept as not scored, and that is receipted too (with a reason), so it stops waiting.
    expect(database.receipts.map((r) => r["runRef"]).sort()).toEqual(["QG-1", "QG-2", "QG-3", "QG-RESET"]);
    expect(answer.runReceipts.acceptedRunRefs.sort()).toEqual(["QG-1", "QG-2", "QG-3", "QG-RESET"]);
    expect(answer.runReceipts.runNotes["QG-RESET"]).toBe("Outside the season window");

    // The companion writes them where the addon reads them.
    const config = { watchFile: file };
    expect(await writeDeviceReceipts(config, answer.runReceipts, undefined, now)).not.toHaveLength(0);
    const text = readFileSync(join(guilded, "Standings.lua"), "utf8");
    expect(text).toContain("GuildedLinkedAs = nil");
    expect(text).not.toContain("Meo Gratton");
    expect(parseDeviceReceipts(text).refs.sort()).toEqual(["QG-1", "QG-2", "QG-3", "QG-RESET"]);
    expect(readFileSync(join(guilded, "..", "GuildedData", "Standings.lua"), "utf8")).toContain('"QG-RESET"');

    // Next game load: the addon (no Discord link anywhere) marks the runs synced and keeps the reason.
    const session = addonSession();
    for (const id of ["QG-1", "QG-2", "QG-3", "QG-RESET", "QG-LATER"]) {
      session.run(`NS.dungeon.savedRuns()["${id}"] = ${id === "QG-RESET" ? luaRun(id, { endedAt: START - 8 * 86400 }) : luaRun(id)}`);
    }
    session.run(text);
    session.run("NS.dungeon.markSynced()");
    const flag = (id: string) => session.run(`return tostring(NS.dungeon.savedRuns()["${id}"].synced)`);
    expect(["QG-1", "QG-2", "QG-3", "QG-RESET", "QG-LATER"].map(flag)).toEqual(["true", "true", "true", "true", "nil"]);
    expect(session.run(`return NS.dungeon.savedRuns()["QG-RESET"].syncNote`)).toBe("Outside the season window");
  });

  it("does not send an acknowledged run again, and keeps earlier acknowledgements", async () => {
    const { file } = layout();
    const config = { watchFile: file };
    const first = await sync(file, fakeDatabase());
    await writeDeviceReceipts(config, first.answer.runReceipts, undefined, now);
    const acknowledged = new Set((await readDeviceReceipts(config)).refs);
    expect(acknowledged.has("QG-1")).toBe(true);
    const second = await sync(file, fakeDatabase(), acknowledged);
    expect(second.body.dungeonRuns ?? []).toHaveLength(0);
    expect(second.answer.runReceipts).toBeUndefined();
    // Writing with no new receipts (a later upload) leaves the earlier ones in place.
    await writeDeviceReceipts(config, second.answer.runReceipts, undefined, now);
    expect((await readDeviceReceipts(config)).refs).toHaveLength(4);
  });

  it("merges receipts newest first and lets the bot's latest note replace an older one", () => {
    const merged = mergeDeviceReceipts({ refs: ["a", "b"], notes: { a: "old", b: "kept" } }, { acceptedRunRefs: ["c", "a"], runNotes: { c: "new" } });
    expect(merged).toEqual({ refs: ["c", "a", "b"], notes: { c: "new", b: "kept" }, pending: {} });
  });
});

describe("the addon and an unsigned companion", () => {
  it("never announces an old Discord link once the companion says this PC is unsigned", () => {
    const session = addonSession();
    session.run(`GuildedLinkedAs = "Meo Gratton"`);
    expect(session.run("return tostring(NS.companionLink.linkedAs())")).toBe("Meo Gratton");
    session.run(`GuildedCompanion = { mode = "device", updatedAt = "2026-11-09T12:00:00.000Z" }`);
    expect(session.run("return tostring(NS.companionLink.linkedAs())")).toBe("nil");
    expect(session.run("return tostring(NS.companionLink.announceLinked())")).toBe("false");
    expect(session.run("return tostring(NS.companionLink.needed())")).toBe("false");
  });
});

describe("runs that are not this PC's", () => {
  it("gives a guildmate's run no receipt: no bot holds it, so nobody may be told it is delivered", async () => {
    const database = fakeDatabase();
    const store = botStore(database);
    const body = { guild: { name: "Quebec Gold", realm: "R" }, characters: [{ name: "Meo", realm: "" }], dungeonRuns: [
      { id: "QG-OTHER", protocolVersion: 1, state: "COMPLETED", instanceId: 90, name: "Gnomeregan", difficultyId: 0, startedAt: START, endedAt: START + 2700, encounters: [], players: [{ character: "Zed", realm: "", presentSec: 2700, inGuild: true }] }
    ] };
    const answer = await handleDeviceUpload(store, device, body, { now, allows: () => true, runLimiter: () => true });
    expect(answer).toMatchObject({ status: "synced", runs: { received: 1, stored: 0, skipped: 0 } });
    expect(answer).not.toHaveProperty("runReceipts");
    expect(database.runs).toHaveLength(0);
    // Once a signed-in guildmate's companion stored it, the same upload is answered with the real receipt.
    database.runs.push({ runRef: "QG-OTHER", guildId: "g1", state: "COMPLETED", invalidReason: null });
    expect(await handleDeviceUpload(store, device, body, { now, allows: () => true, runLimiter: () => true })).toMatchObject({ runReceipts: { acceptedRunRefs: ["QG-OTHER"], runNotes: {} } });
  });

  it("the companion sends only runs this PC's characters played", () => {
    const run = (id: string, names: string[]) => ({ id, state: "COMPLETED", endedAt: START, players: names.map((character) => ({ character })) });
    const body = deviceUploadBody({ wowGuild: "Quebec Gold-R", character: { name: "Meo Gratton" }, alts: [{ name: "Zed" }],
      dungeonRuns: [run("mine", ["Meo Gratton", "Bob"]), run("first-name", ["Meo"]), run("alt", ["Zed"]), run("guildmate", ["Bob", "Amy"]), { id: "broken", state: "COMPLETED" }] });
    expect((body.dungeonRuns as { id: string }[]).map((entry) => entry.id).sort()).toEqual(["alt", "first-name", "mine"]);
  });

  it("forgets a 9.1.3 refusal kept as a receipt", () => {
    const note = "Not one of this PC's characters";
    const merged = mergeDeviceReceipts({ refs: ["kept", "refused"], notes: { refused: note, kept: "Not completed" } }, { acceptedRunRefs: ["new", "refused-again"], runNotes: { "refused-again": note } });
    expect(merged).toEqual({ refs: ["new", "kept"], notes: { kept: "Not completed" }, pending: {} });
  });
});

describe("per-character identity (9.1.4)", () => {
  it("answers with only the characters this device reported, and the addon says 'Reported, not confirmed' for them", async () => {
    const { file, guilded } = layout();
    const { body, answer } = await sync(file, fakeDatabase());
    expect(body.characters.map((c: { name: string }) => c.name)).toEqual(["Meo"]);
    // Privacy: the answer lists names the device itself sent and carries no Discord name at all.
    expect(answer.reported).toEqual(["Meo"]);
    expect(JSON.stringify(answer)).not.toMatch(/discord(User|Name|Account)|Gratton/);
    await writeDeviceReceipts({ watchFile: file }, { ...answer.runReceipts, reported: answer.reported }, undefined, now);
    const text = readFileSync(join(guilded, "Standings.lua"), "utf8");
    expect(text).toContain('["meo"] = { confirmed = false }');
    expect(text).not.toContain("Meo Gratton");
    const session = addonSession();
    session.run(`GuildedCompanion = { mode = "device" }; GuildedLinked = { ["meo"] = { confirmed = false } }; GuildedLinkedMeta = { updatedAt = "2027-01-14T00:00:00Z", }`);
    session.run("CLOCK = 1800000000; time = function() return CLOCK end");
    expect(session.run("local s = NS.companionLink.linkedState(); return s and tostring(s.confirmed) or 'nil'")).toBe("false");
    expect(session.run("return tostring(NS.companionLink.announceLinked())")).toBe("true");
  });

  it("rewrites the map's stamp when it is a day old, even with nothing else changed", async () => {
    const { file, guilded } = layout();
    const { answer } = await sync(file, fakeDatabase());
    const answerWith = { ...answer.runReceipts, reported: answer.reported };
    await writeDeviceReceipts({ watchFile: file }, answerWith, undefined, now);
    const later = new Date(now.getTime() + 2 * 86_400_000);
    await writeDeviceReceipts({ watchFile: file }, answerWith, undefined, later);
    expect(readFileSync(join(guilded, "Standings.lua"), "utf8")).toContain(`updatedAt = "${later.toISOString()}"`);
  });
});
