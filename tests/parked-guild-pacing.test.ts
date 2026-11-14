import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../companion/engine.mjs";
import { minimalParkedExport, RETRY_MS, MAX_PER_SYNC } from "../companion/parked-runs.mjs";
import { parseSavedFiles } from "../companion/addon-files.mjs";
import { DEVICE_FEATURES, DeviceError, handleDeviceUpload, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";

// 9.3.1: a parked guild's runs are uploaded RUNS-ONLY. The real bot logic (handleDeviceUpload) runs behind a mock HTTP layer, so what a parked
// upload does to the device (its guild, server pick, characters), the roster fallback and the hourly limits are the bot's own.

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const KEY = "k".repeat(43);
const NOW_SEC = Math.floor(Date.now() / 1000);
const LOADED = "Loaded Guild-TestRealm";

const run = (id: string, who: string[], endedAgo = 3600, reporter = who[0]) => `["${id}"] = { id = "${id}", state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1, startedAt = ${NOW_SEC - endedAgo - 900}, endedAt = ${NOW_SEC - endedAgo}, completedBy = "final boss", recorder = "${who[0]}",
  players = { ${who.map((name) => `["${name}"] = { class = "WARRIOR", level = 20, deaths = 0, presentSec = 900, inGuild = true }`).join(", ")} }, reporters = { ["${reporter}"] = true }, encounters = {} }`;

interface ParkedSpec { guild: string; character: string; runs: { id: string; endedAgo?: number }[] }
function saved(parked: ParkedSpec[], loadedCharacters = ["Kev"]) {
  const own = loadedCharacters.map((name) => `${name} = { name = "${name}", realm = "TestRealm", class = "PALADIN", level = 30 }`).join(", ");
  const other = parked.map((entry) => `["${entry.guild}"] = {
      character = { name = "${entry.character}", realm = "TestRealm", class = "MAGE", level = 40, gameEdition = "forever" },
      myCharacters = { ${entry.character} = { name = "${entry.character}", realm = "TestRealm", class = "MAGE", level = 40 } },
      dungeon = { runs = { ${entry.runs.map((r) => run(r.id, [entry.character, "Zed"], r.endedAgo)).join(", ")} } },
      roster = { SecretRosterMember = { name = "SecretRosterMember" } },
    }`).join(",\n    ");
  return `GuildedDB = {
  version = 3, guildKey = "${LOADED}", guildEdition = "forever",
  character = { name = "${loadedCharacters[0]}", realm = "TestRealm", class = "PALADIN", level = 30, gameEdition = "forever" },
  myCharacters = { ${own} },
  dungeon = { runs = { ${run("LOADED-1", [loadedCharacters[0]!, "Bob"])} } },
  otherGuilds = { ${other} },
}
`;
}

function layout(text: string) {
  const root = mkdtempSync(join(tmpdir(), "qg-pacing-"));
  dirs.push(root);
  const savedDir = join(root, "WTF", "Account", "ACC", "SavedVariables");
  const addon = join(root, "Interface", "AddOns", "Guilded");
  mkdirSync(savedDir, { recursive: true });
  mkdirSync(addon, { recursive: true });
  const watchFile = join(savedDir, "Guilded.lua");
  writeFileSync(watchFile, text);
  return { watchFile, record: join(savedDir, "GuildedCompanion-parked.json"), standings: join(addon, "Standings.lua") };
}

// ---- The mock bot: the real handleDeviceUpload over an in-memory store -------------------------------------------------------
type Registered = Record<string, ServerCandidate[]>;
const candidate = (guildId: string, discordId: string, extra: Partial<ServerCandidate> = {}): ServerCandidate => ({ guildId, discordId, serverName: guildId, officerLinked: true, ...extra });

function deviceBot(options: { registered?: Registered; roster?: ServerCandidate; runsOnlyPerHour?: number; uploadsPerHour?: number; features?: boolean; chosenGuildId?: string; guildId?: string; characters?: string[] } = {}) {
  const device: DeviceRow & { tokenHash: string } = { id: "d1", tokenHash: "x", guildId: options.guildId ?? null, chosenGuildId: options.chosenGuildId ?? null, claimedMemberId: null, revokedAt: null, uploads: 0 };
  const characters = new Map<string, Record<string, unknown>>((options.characters ?? []).map((nameKey) => [nameKey, { nameKey }]));
  const held = new Map<string, Set<string>>();
  const requests: { runsOnly: boolean; body: Record<string, unknown>; status: number }[] = [];
  const aliases: string[] = [];
  const store: DeviceStore = {
    async create() { return { id: "d1" }; },
    async find() { return device; },
    async candidates(nameKey, _realm, characterKeys) {
      const registered = options.registered?.[nameKey];
      if (registered?.length) return registered;
      return options.roster && (characterKeys?.length ?? 0) > 0 ? [{ ...options.roster, viaRoster: true, rosterMatch: true }] : [];
    },
    async characterKeys() { return [...characters.keys()]; },
    async saveUpload(_id, data, rows) {
      Object.assign(device, { guildId: data.guildId, chosenGuildId: data.chosenGuildId, uploads: device.uploads + 1 });
      for (const row of rows) characters.set(row.nameKey, { ...row });
    },
    async claim() { return false; },
    async importRuns(guildId, runs) {
      const set = held.get(guildId) ?? new Set<string>();
      for (const entry of runs) set.add((entry as { id: string }).id);
      held.set(guildId, set);
      return { stored: runs.length, skipped: 0 };
    },
    async receipts(guildId, refs) { return refs.filter((ref) => held.get(guildId)?.has(ref)).map((runRef) => ({ runRef, reason: null })); },
    async noteAlias(_guildId, guild) { aliases.push(guild.name); }
  };
  let normal = 0, runsOnly = 0;
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (!String(url).endsWith("/api/v1/device/uploads")) return Response.json({ error: "unexpected" }, { status: 500 });
    const body = JSON.parse(String(init?.body));
    const only = body.runsOnly === true;
    const count = only ? ++runsOnly : ++normal;
    const limit = only ? options.runsOnlyPerHour ?? 12 : options.uploadsPerHour ?? 30;
    if (count > limit) { requests.push({ runsOnly: only, body, status: 429 }); return Response.json({ error: "Too many uploads in the last hour." }, { status: 429 }); }
    try {
      const answer = await handleDeviceUpload(store, device, body, { runLimiter: () => true });
      requests.push({ runsOnly: only, body, status: 200 });
      return Response.json({ ...answer, botVersion: "9.3.1", ...(options.features === false ? {} : { deviceFeatures: DEVICE_FEATURES }) });
    } catch (error) {
      if (error instanceof DeviceError) { requests.push({ runsOnly: only, body, status: error.status }); return Response.json({ error: error.message }, { status: error.status }); }
      throw error;
    }
  });
  return { fetcher, device, characters, held, requests, aliases };
}

async function syncs(watchFile: string, bot: ReturnType<typeof deviceBot>, count = 1) {
  vi.stubGlobal("fetch", bot.fetcher);
  const logs: { level: string; message: string }[] = [];
  const engine = createEngine({ watchFile, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: KEY }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
  try {
    expect(await engine.start()).toBe(true);
    for (let i = 0; i < count; i++) {
      const before = engine.state().uploads;
      if (i > 0) engine.uploadNow();
      await vi.waitFor(() => expect(engine.state().uploads).toBeGreaterThan(before), { timeout: 8000 });
      await vi.waitFor(() => expect(engine.state().pendingUpload).toBe(false), { timeout: 8000 });
    }
  } finally { await engine.stop(); }
  return logs;
}

const parkedOnly = (bot: ReturnType<typeof deviceBot>) => bot.requests.filter((request) => request.runsOnly);
const guildOf = (body: Record<string, unknown>) => (body["guild"] as { name: string }).name;

describe("device mode: what a parked upload does on the bot", () => {
  it("leaves the device's guild, the member's server pick and the device's characters as the loaded upload left them", async () => {
    const files = layout(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }]));
    const bot = deviceBot({
      registered: { "loaded guild": [candidate("g-a", "111111111"), candidate("g-b", "222222222")], "parked guild": [candidate("g-p", "333333333")] },
      chosenGuildId: "g-b", guildId: "g-b", characters: ["kev|testrealm"]
    });
    await syncs(files.watchFile, bot);
    // Loaded guild first, then the parked one flagged runs-only.
    expect(bot.requests.map((request) => request.runsOnly)).toEqual([false, true]);
    expect(guildOf(bot.requests[1]!.body)).toBe("Parked Guild");
    expect(bot.held.get("g-p")).toEqual(new Set(["P-1"]));
    expect(bot.held.get("g-b")).toEqual(new Set(["LOADED-1"]));
    // The member's "choose server" pick (g-b) and the device's guild survived the parked upload; Pat is not a device character of the loaded server.
    expect(bot.device.guildId).toBe("g-b");
    expect(bot.device.chosenGuildId).toBe("g-b");
    expect([...bot.characters.keys()].some((name) => name.startsWith("pat"))).toBe(false);
    // Only the vouching character went along, and no roster data.
    expect((bot.requests[1]!.body["characters"] as { name: string }[]).map((entry) => entry.name)).toEqual(["Pat"]);
    expect(JSON.stringify(bot.requests)).not.toContain("SecretRosterMember");
  });

  it("does not take a parked guild's characters into the device's 12-character budget", async () => {
    const names = ["Kev", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11"];
    const files = layout(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }], names));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")], "parked guild": [candidate("g-p", "333333333")] } });
    await syncs(files.watchFile, bot);
    expect(bot.characters.size).toBe(12); // the loaded guild's twelve; the parked guild's Pat did not take or lose a slot
    expect([...bot.characters.keys()].some((name) => name.startsWith("pat"))).toBe(false);
    expect(bot.held.get("g-p")).toEqual(new Set(["P-1"])); // and the parked run still counted
  });

  it("never routes a parked guild nobody set up to a server through the roster, and never tells officers a guild was renamed", async () => {
    const files = layout(saved([{ guild: "Unset Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }]));
    // Pat is in the loaded server's roster: without runs-only the roster fallback would send the Unset Guild's runs there.
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")] }, roster: candidate("g-a", "111111111") });
    const logs = await syncs(files.watchFile, bot);
    expect(parkedOnly(bot)).toHaveLength(1);
    expect(bot.held.get("g-a")).toEqual(new Set(["LOADED-1"]));
    expect(bot.aliases).toEqual([]);
    expect(logs.some((entry) => entry.message.includes("dungeon run of Unset Guild-TestRealm wait"))).toBe(true);
  });

  it("a runs-only upload must name its guild", async () => {
    const bot = deviceBot();
    await expect(handleDeviceUpload({ ...({} as DeviceStore) }, { id: "d", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }, { runsOnly: true, characters: [] })).rejects.toMatchObject({ status: 400 });
    expect(bot.requests).toEqual([]);
  });

  it("waits for a bot that does not announce runs-only (an older bot would store the parked guild as the device's guild)", async () => {
    const files = layout(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }]));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")], "parked guild": [candidate("g-p", "333333333")] }, features: false });
    const logs = await syncs(files.watchFile, bot);
    expect(parkedOnly(bot)).toHaveLength(0);
    expect(logs.some((entry) => entry.message.includes("wait for a bot update"))).toBe(true);
  });
});

describe("device mode: pacing", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ guild: `Parked${i} Guild-TestRealm`, character: `Pat${i}`, runs: [{ id: `P${i}-1` }] }));

  it("ten parked guilds without a server: the loaded upload goes first, at most 3 guilds a sync, dead ends rest for an hour", async () => {
    const files = layout(saved(ten));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")] } });
    await syncs(files.watchFile, bot, 5);
    // Each sync: the loaded upload, then up to MAX_PER_SYNC parked ones (3, 3, 3, 1); the fifth finds every guild resting.
    const perSync: boolean[][] = [];
    for (const request of bot.requests) { if (!request.runsOnly) perSync.push([]); perSync.at(-1)!.push(request.runsOnly); }
    expect(perSync.map((entries) => entries.filter(Boolean).length)).toEqual([MAX_PER_SYNC, MAX_PER_SYNC, MAX_PER_SYNC, 1, 0]);
    expect(perSync.every((entries) => entries[0] === false)).toBe(true);
    // Every guild was asked exactly once (round-robin), so the device's hourly budget is nowhere near used.
    const asked = parkedOnly(bot).map((request) => guildOf(request.body));
    expect(new Set(asked).size).toBe(10);
    expect(bot.requests.filter((request) => !request.runsOnly)).toHaveLength(5);
    expect(RETRY_MS).toBeGreaterThanOrEqual(3_600_000);
  });

  it("a 429 for the parked uploads ends the loop and the loaded guild is unaffected", async () => {
    const files = layout(saved(ten));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")] }, runsOnlyPerHour: 0 });
    const logs = await syncs(files.watchFile, bot);
    expect(parkedOnly(bot)).toHaveLength(1);
    expect(parkedOnly(bot)[0]!.status).toBe(429);
    expect(bot.held.get("g-a")).toEqual(new Set(["LOADED-1"]));
    expect(logs.some((entry) => entry.level === "error")).toBe(false);
  });

  it("a guild with several servers to choose from rests too, and a new run wakes it", async () => {
    const files = layout(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }]));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")], "parked guild": [candidate("g-p1", "333333333", { officerLinked: false }), candidate("g-p2", "444444444", { officerLinked: false })] } });
    await syncs(files.watchFile, bot, 2);
    expect(parkedOnly(bot)).toHaveLength(1); // the second sync did not ask again
    expect(bot.held.size).toBe(1);
  });

  it("does not read or send a parked run older than 45 days", async () => {
    const files = layout(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "OLD", endedAgo: 46 * 86400 }, { id: "NEW" }] }]));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")], "parked guild": [candidate("g-p", "333333333")] } });
    await syncs(files.watchFile, bot);
    expect(bot.held.get("g-p")).toEqual(new Set(["NEW"]));
    const { parked } = parseSavedFiles({ guilded: readFileSync(files.watchFile, "utf8") }, "TestRealm");
    expect(parked[0]!.full.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["NEW"]);
  });

  it("a guild whose only runs are too old is never sent at all", async () => {
    const files = layout(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "OLD", endedAgo: 60 * 86400 }] }]));
    const bot = deviceBot({ registered: { "loaded guild": [candidate("g-a", "111111111")] } });
    await syncs(files.watchFile, bot);
    expect(parkedOnly(bot)).toHaveLength(0);
  });
});

describe("signed mode", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ guild: `Parked${i} Guild-TestRealm`, character: `Pat${i}`, runs: [{ id: `P${i}-1` }] }));

  /** A signed bot: every addon import is accepted; the standings answer lists nothing for parked runs unless `holds` says so. */
  function signedBot(holds = false, parkedStatus = 200) {
    const uploads: { guild: string | undefined; keys: string[]; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      const address = String(url);
      if (address.includes("/api/v1/standings")) {
        const refs = holds ? uploads.flatMap((entry) => ((entry.body["export"] as { dungeonRuns?: { id: string }[] }).dungeonRuns ?? []).map((r) => r.id)) : [];
        return Response.json({ protocolVersion: 2, standings: [], acceptedRunRefs: refs, runNotes: {}, botVersion: "9.3.1", updatedAt: "2026-11-13T12:00:00Z", accounts: {} }, { headers: { etag: `e${uploads.length}` } });
      }
      if (address.endsWith("/api/v1/addon-imports") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        uploads.push({ guild: body.export?.wowGuild, keys: Object.keys(body.export ?? {}), body });
        if (parkedStatus !== 200 && body.export?.wowGuild !== LOADED) return Response.json({ error: "slow down" }, { status: parkedStatus });
        return Response.json({ importId: "i", status: "PREVIEWED", transactionCount: 0, serverWowGuild: { known: true, name: body.export?.wowGuild }, botVersion: "9.3.1", protocolVersion: 2 });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    return { fetcher, uploads };
  }

  async function run(text: string, bot: ReturnType<typeof signedBot>, servers: string[], rounds = 1) {
    const files = layout(text);
    writeFileSync(files.record, JSON.stringify({ version: 1, runs: {}, servers: { SERVER: servers.map((key) => key.replace(/\s+/g, "").toLowerCase()) }, outcomes: {} }));
    vi.stubGlobal("fetch", bot.fetcher);
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ watchFile: files.watchFile, uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "SERVER", companionCredential: "c".repeat(40) }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      expect(await engine.start()).toBe(true);
      for (let i = 0; i < rounds; i++) {
        const before = engine.state().uploads;
        if (i > 0) engine.uploadNow();
        await vi.waitFor(() => expect(engine.state().uploads).toBeGreaterThan(before), { timeout: 8000 });
        await vi.waitFor(() => expect(engine.state().pendingUpload).toBe(false), { timeout: 8000 });
      }
      await vi.waitFor(() => expect(engine.state().pendingUpload).toBe(false), { timeout: 8000 });
    } finally { await engine.stop(); }
    return { logs, files, engine };
  }

  it("sends a purpose-built body: the guild, this account's characters in it and the runs, no empty sections", async () => {
    const bot = signedBot();
    await run(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }]), bot, ["Parked Guild-TestRealm"]);
    const parked = bot.uploads.find((entry) => entry.guild === "Parked Guild-TestRealm")!;
    const allowed = new Set(["gameEdition", "interface", "source", "exportedAt", "addonVersion", "wowGuild", "character", "alts", "dungeonRuns"]);
    expect(parked.keys.every((key) => allowed.has(key))).toBe(true);
    for (const empty of ["transactions", "epgpTransactions", "raids", "loot", "readiness", "attunements", "characters", "guildRoster", "guildInfo"]) expect(parked.keys).not.toContain(empty);
    expect((parked.body["export"] as { dungeonRuns: unknown[] }).dungeonRuns).toHaveLength(1);
    expect(JSON.stringify(parked.body)).not.toContain("SecretRosterMember");
    expect(minimalParkedExport({ wowGuild: "G", dungeonRuns: [], alts: [], source: "Guilded", exportedAt: "x", transactions: [1] })).toEqual({ source: "Guilded", exportedAt: "x", wowGuild: "G" });
  });

  it("ten parked guilds the server holds: the loaded guild first, at most 3 a sync", async () => {
    const bot = signedBot();
    await run(saved(ten), bot, ten.map((entry) => entry.guild), 2);
    const order = bot.uploads.map((entry) => entry.guild);
    expect(order[0]).toBe(LOADED);
    // Round one: loaded + 3; round two: loaded + 3 others (the least recently tried first).
    expect(order.slice(0, 4).filter((guild) => guild !== LOADED)).toHaveLength(3);
    const parkedGuilds = order.filter((guild) => guild !== LOADED);
    expect(parkedGuilds.length).toBeLessThanOrEqual(2 * MAX_PER_SYNC);
    expect(new Set(parkedGuilds).size).toBe(parkedGuilds.length);
  });

  it("a 429 on a parked upload ends the loop", async () => {
    const bot = signedBot(false, 429);
    await run(saved(ten), bot, ten.map((entry) => entry.guild));
    expect(bot.uploads[0]!.guild).toBe(LOADED);
    expect(bot.uploads.filter((entry) => entry.guild !== LOADED)).toHaveLength(1); // the first parked upload got the 429; the loop stopped
  });

  it("gives up on runs the bot never confirms and does not resend them every sync", async () => {
    const bot = signedBot(false);
    const { logs } = await run(saved([{ guild: "Parked Guild-TestRealm", character: "Pat", runs: [{ id: "P-1" }] }]), bot, ["Parked Guild-TestRealm"], 8);
    const sent = bot.uploads.filter((entry) => entry.guild === "Parked Guild-TestRealm");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(8); // not once per sync for ever
    expect(logs.some((entry) => entry.message.startsWith("Dungeon runs of Parked Guild-TestRealm:"))).toBe(true);
  });
});
