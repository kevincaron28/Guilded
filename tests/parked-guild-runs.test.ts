import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../companion/engine.mjs";
import { parseSavedFiles } from "../companion/addon-files.mjs";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { createRequire } from "node:module";
import { emptyRecord, parseRecord, patchReceiptBlocks, pruneRecord, recordAcknowledged, RECORD_DAYS, RECORD_MAX, serverHoldsGuild, waitLine, withRecordReceipts } from "../companion/parked-runs.mjs";

// 9.3.0: full Guilded parks the data of another guild when a character of a different guild logs in (Core.lua resolveGuildData:
// everything except the guild key moves into GuildedDB.otherGuilds[<key>]). The companion used to read the root only, so the parked
// guild's finished runs never reached the bot. These tests use a Guilded.lua shaped like that: one loaded guild at the root, one parked.

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const KEY = "k".repeat(43);
const END = Math.floor(Date.now() / 1000) - 3600;

const LOADED = "Loaded Guild-TestRealm";
const PARKED = "Parked Guild-TestRealm";

const run = (id: string, who: string[], extra = "", reporter = who[0]) => `["${id}"] = { id = "${id}", state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1, startedAt = ${END - 900}, endedAt = ${END}, completedBy = "final boss", recorder = "${who[0]}",
  players = { ${who.map((name) => `["${name}"] = { class = "WARRIOR", level = 20, deaths = 0, presentSec = 900, inGuild = true }`).join(", ")} }, reporters = { ["${reporter}"] = true }, encounters = {}${extra} }`;

/** A Guilded.lua with Kev's guild loaded and Pat's guild parked (Pat is this account's character in the parked guild). The parked table also holds data that must never leave the PC. */
function guildedSaved(parkedExtra = "") {
  return `GuildedDB = {
  version = 3, guildKey = "${LOADED}", guildEdition = "forever",
  character = { name = "Kev", realm = "TestRealm", class = "PALADIN", level = 30, gameEdition = "forever" },
  myCharacters = { Kev = { name = "Kev", realm = "TestRealm", class = "PALADIN", level = 30 } },
  dungeon = { runs = { ${run("LOADED-1", ["Kev", "Bob"])} } },
  otherGuilds = {
    ["${PARKED}"] = {
      character = { name = "Pat", realm = "TestRealm", class = "MAGE", level = 40, gameEdition = "forever" },
      myCharacters = { Pat = { name = "Pat", realm = "TestRealm", class = "MAGE", level = 40 }, Patalt = { name = "Patalt", realm = "TestRealm", class = "PRIEST", level = 22 } },
      dungeon = { runs = { ${run("PARKED-1", ["Pat", "Zed"])}, ${run("PARKED-2", ["Patalt", "Zed"])}, ${run("PARKED-SYNCED", ["Pat", "Zed"], ", synced = true")}, ${run("PARKED-STRANGER", ["Zed", "Yan"], "", "Nobody")} } },
      roster = { SecretRosterMember = { name = "SecretRosterMember", rank = "Officer" } },
      guildNotes = { SecretNote = "officer only text" },
      ledger = { { id = "SECRET-LEDGER-ROW", player = "SecretRosterMember", points = 50 } },
      bank = { SecretBankItem = { count = 3 } },
      ${parkedExtra}
    },
  },
}
`;
}

function layout(guilded: string) {
  const root = mkdtempSync(join(tmpdir(), "qg-parked-"));
  dirs.push(root);
  const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
  const addon = join(root, "Interface", "AddOns", "Guilded");
  mkdirSync(saved, { recursive: true });
  mkdirSync(addon, { recursive: true });
  const watchFile = join(saved, "Guilded.lua");
  writeFileSync(watchFile, guilded);
  return { root, saved, addon, watchFile, standings: join(addon, "Standings.lua"), record: join(saved, "GuildedCompanion-parked.json") };
}

const ids = (runs?: { id: string }[]) => (runs ?? []).map((entry) => entry.id).sort();

describe("reading a parked guild's runs", () => {
  it("returns each parked guild's unsynced runs, tagged with its own key, and none of the loaded guild's", () => {
    const { full, parked } = parseSavedFiles({ guilded: guildedSaved() }, "TestRealm");
    expect(full.wowGuild).toBe(LOADED);
    expect(ids(full.dungeonRuns)).toEqual(["LOADED-1"]);
    expect(parked).toHaveLength(1);
    expect(parked[0]!.key).toBe(PARKED);
    expect(parked[0]!.full.wowGuild).toBe(PARKED);
    // The synced run stays out; the stranger's run is read here and filtered by the device body (nobody of this account was in it).
    expect(ids(parked[0]!.full.dungeonRuns)).toEqual(["PARKED-1", "PARKED-2", "PARKED-STRANGER"]);
    expect(deviceUploadBody(parked[0]!.full).dungeonRuns?.map((entry: { id: string }) => entry.id).sort()).toEqual(["PARKED-1", "PARKED-2"]);
  });

  it("never reads anything but the runs and this account's characters of a parked guild", () => {
    const { parked, full } = parseSavedFiles({ guilded: guildedSaved() }, "TestRealm");
    const text = JSON.stringify(parked[0]!.full);
    for (const secret of ["SecretRosterMember", "SECRET-LEDGER-ROW", "SecretBankItem", "SecretNote", "officer only text"]) expect(text).not.toContain(secret);
    expect(JSON.stringify(full)).not.toContain("SecretRosterMember");
    const body = deviceUploadBody(parked[0]!.full);
    expect(Object.keys(body).sort()).toEqual(["characters", "dungeonRuns", "guild"]);
    expect(body.characters.map((entry: { name: string }) => entry.name).sort()).toEqual(["Pat", "Patalt"]);
    expect(body.guild).toEqual({ name: "Parked Guild", realm: "TestRealm" });
  });

  it("leaves out runs already acknowledged, and a file with no parked guild reads as before", () => {
    const { parked } = parseSavedFiles({ guilded: guildedSaved() }, "TestRealm", { skip: new Set(["PARKED-1"]) });
    expect(ids(parked[0]!.full.dungeonRuns)).toEqual(["PARKED-2", "PARKED-STRANGER"]);
    const all = parseSavedFiles({ guilded: guildedSaved() }, "TestRealm", { skip: new Set(["PARKED-1", "PARKED-2", "PARKED-STRANGER"]) });
    expect(all.parked).toEqual([]);
    const text = guildedSaved();
    const plain = `${text.slice(0, text.indexOf("  otherGuilds"))}}\n`;
    expect(parseSavedFiles({ guilded: plain }, "TestRealm").parked).toEqual([]);
  });

  it("ignores a parked entry of another edition and one whose key is the loaded guild", () => {
    const text = guildedSaved().replace('["Parked Guild-TestRealm"] = {', '["classic@Parked Guild-TestRealm"] = {');
    expect(parseSavedFiles({ guilded: text }, "TestRealm").parked).toEqual([]);
    const same = guildedSaved().replace('["Parked Guild-TestRealm"] = {', `["${LOADED}"] = {`);
    expect(parseSavedFiles({ guilded: same }, "TestRealm").parked).toEqual([]);
  });
});

describe("the companion-side record", () => {
  it("keeps the acknowledged runs with their guild, ignoring runs the bot refused for this PC", () => {
    const { record, added } = recordAcknowledged(emptyRecord(), PARKED, [{ id: "A", endedAt: END }, { id: "B", endedAt: END }, { id: "C", endedAt: END }], ["A", "B"], { B: "Not completed", C: "Not one of this PC's characters" });
    expect(added).toBe(2);
    expect(record.runs.A).toEqual({ guild: PARKED, ended: END });
    expect(record.runs.B).toMatchObject({ note: "Not completed" });
    expect(record.runs.C).toBeUndefined();
  });

  it("is pruned with the addon's rules: nothing older than 45 days, at most 1200 entries, newest kept", () => {
    const now = Date.now();
    const old = Math.floor(now / 1000) - (RECORD_DAYS + 1) * 86400;
    const runs: Record<string, { guild: string; ended: number }> = { OLD: { guild: PARKED, ended: old } };
    for (let i = 0; i < RECORD_MAX + 50; i++) runs[`R${i}`] = { guild: PARKED, ended: Math.floor(now / 1000) - 60 - i };
    const pruned = pruneRecord({ ...emptyRecord(), runs }, now);
    expect(pruned.runs.OLD).toBeUndefined();
    expect(Object.keys(pruned.runs)).toHaveLength(RECORD_MAX);
    expect(pruned.runs.R0).toBeDefined();
    expect(pruned.runs[`R${RECORD_MAX + 40}`]).toBeUndefined();
    expect(parseRecord("not json")).toEqual(emptyRecord());
  });

  it("adds its refs to the standings answer's accepted list and to a Standings.lua already on disk", () => {
    const record = recordAcknowledged(emptyRecord(), PARKED, [{ id: "P-1", endedAt: END }], ["P-1"], { "P-1": "Not completed" }).record;
    expect(withRecordReceipts({ acceptedRunRefs: ["X"], runNotes: { X: "n" } }, record)).toMatchObject({ acceptedRunRefs: ["X", "P-1"], runNotes: { X: "n", "P-1": "Not completed" } });
    const text = 'GuildedDungeonAccepted = {\n  "X",\n}\nGuildedDungeonNotes = {\n}\nGuildedDungeonPending = {\n}\n';
    const patched = patchReceiptBlocks(text, record);
    expect(patched).toContain('"P-1",');
    expect(patched).toContain('["P-1"] = "Not completed",');
    expect(patchReceiptBlocks(patched, record)).toBe(patched); // idempotent
  });

  it("knows a server holds a guild only by the profile's own guild or one a past upload showed it knows", () => {
    expect(serverHoldsGuild({ guildDiscordId: "1", wowGuild: PARKED }, emptyRecord(), PARKED)).toBe(true);
    expect(serverHoldsGuild({ guildDiscordId: "1" }, emptyRecord(), PARKED)).toBe(false);
    expect(serverHoldsGuild({ guildDiscordId: "1" }, { ...emptyRecord(), servers: { "1": ["parkedguild-testrealm"] } }, PARKED)).toBe(true);
    expect(serverHoldsGuild({ guildDiscordId: "2" }, { ...emptyRecord(), servers: { "1": ["parkedguild-testrealm"] } }, PARKED)).toBe(false);
  });
});

describe("device (zero-setup) mode", () => {
  it("sends the parked guild's runs to its own server first, keeps the receipt and never resends", async () => {
    const files = layout(guildedSaved());
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).endsWith("/api/v1/device/uploads")) return Response.json({ error: "unexpected" }, { status: 500 });
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const parked = body.guild?.name === "Parked Guild";
      const sent = (body.dungeonRuns ?? []).map((entry: { id: string }) => entry.id);
      return Response.json({ status: "synced", server: { discordId: parked ? "PARKED-SERVER" : "LOADED-SERVER", name: parked ? "Parked server" : "Loaded server" }, guild: body.guild, characters: 1,
        runs: { received: sent.length, stored: sent.length, skipped: 0 }, runReceipts: { acceptedRunRefs: sent, runNotes: {} }, reported: ["Kev"], deviceFeatures: ["runs-only"] });
    }));
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ watchFile: files.watchFile, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: KEY, deviceServer: "LOADED-SERVER" }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      expect(await engine.start()).toBe(true);
      await vi.waitFor(() => expect(existsSync(files.record) && Object.keys(JSON.parse(readFileSync(files.record, "utf8")).runs).length).toBe(2), { timeout: 5000 });
      await vi.waitFor(() => expect(existsSync(files.standings) && readFileSync(files.standings, "utf8").includes('"PARKED-2"')).toBe(true), { timeout: 5000 });
    } finally { await engine.stop(); }
    // The loaded guild went first with the pinned server; the parked guild's runs followed, runs-only, to the server the bot finds from ITS key.
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ guild: { name: "Loaded Guild" }, server: "LOADED-SERVER" });
    expect(bodies[0]).not.toHaveProperty("runsOnly");
    expect((bodies[0]!["dungeonRuns"] as { id: string }[]).map((entry) => entry.id)).toEqual(["LOADED-1"]);
    expect(bodies[1]).toMatchObject({ runsOnly: true, guild: { name: "Parked Guild", realm: "TestRealm" } });
    expect(bodies[1]).not.toHaveProperty("server");
    expect(Object.keys(bodies[1]!).sort()).toEqual(["characters", "dungeonRuns", "guild", "runsOnly"]);
    expect((bodies[1]!["dungeonRuns"] as { id: string }[]).map((entry) => entry.id).sort()).toEqual(["PARKED-1", "PARKED-2"]);
    expect(JSON.stringify(bodies)).not.toMatch(/SecretRosterMember|SECRET-LEDGER-ROW|SecretBankItem|officer only text/);
    expect(logs.find((entry) => entry.message.startsWith("Dungeon runs of Parked Guild-TestRealm:"))?.message).toBe("Dungeon runs of Parked Guild-TestRealm: 2 sent, 2 stored.");
    // The record and the addon's receipts: the parked runs are acknowledged for when that guild loads again.
    const record = JSON.parse(readFileSync(files.record, "utf8"));
    expect(Object.keys(record.runs).sort()).toEqual(["PARKED-1", "PARKED-2"]);
    expect(record.runs["PARKED-1"].guild).toBe(PARKED);
    const standings = readFileSync(files.standings, "utf8");
    for (const id of ["PARKED-1", "PARKED-2", "LOADED-1"]) expect(standings).toContain(`"${id}"`);
  });

  it("does not send a parked run again once acknowledged", async () => {
    const files = layout(guildedSaved());
    writeFileSync(files.record, JSON.stringify({ version: 1, runs: { "PARKED-1": { guild: PARKED, ended: END }, "PARKED-2": { guild: PARKED, ended: END } }, servers: {} }));
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return Response.json({ status: "synced", server: { discordId: "S", name: "S" }, guild: body.guild, characters: 1, runReceipts: { acceptedRunRefs: [], runNotes: {} }, reported: [], deviceFeatures: ["runs-only"] });
    }));
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ watchFile: files.watchFile, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: KEY }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      expect(await engine.start()).toBe(true);
      await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0), { timeout: 5000 });
    } finally { await engine.stop(); }
    expect(bodies.map((body) => (body["guild"] as { name: string }).name)).toEqual(["Loaded Guild"]);
    // The receipts file still lists them for the addon.
    expect(readFileSync(files.standings, "utf8")).toContain('"PARKED-1"');
  });
});

describe("signed-in mode", () => {
  /** A bot stub: guild uploads answer per the server (which knows only `holds`), the standings answer lists what it holds. */
  function bot(holds: string | null, extra: { wrong?: boolean } = {}) {
    const uploads: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      const address = String(url);
      if (address.endsWith("/api/v1/standings") || address.includes("/api/v1/standings?")) {
        return Response.json({ protocolVersion: 2, standings: [], acceptedRunRefs: holds ? uploads.filter((entry) => (entry["export"] as { wowGuild?: string }).wowGuild === holds).flatMap((entry) => ((entry["export"] as { dungeonRuns?: { id: string }[] }).dungeonRuns ?? []).map((r) => r.id)) : [], runNotes: {}, botVersion: "9.3.0", updatedAt: "2026-11-13T12:00:00Z", accounts: {} }, { headers: { etag: `e${uploads.length}` } });
      }
      if (address.endsWith("/api/v1/addon-imports") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        uploads.push(body);
        const guild = body.export?.wowGuild;
        if (guild !== holds || extra.wrong) return Response.json({ skipped: "wrong-server", status: "SKIPPED", serverWowGuild: { known: false, name: holds }, botVersion: "9.3.0", protocolVersion: 2 });
        return Response.json({ importId: "imp", status: "PREVIEWED", transactionCount: 0, serverWowGuild: { known: true, name: holds }, botVersion: "9.3.0", protocolVersion: 2 });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    return { fetcher, uploads };
  }
  const config = (files: ReturnType<typeof layout>, more: Record<string, unknown> = {}) => ({ watchFile: files.watchFile, uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "PARKED-SERVER", companionCredential: "c".repeat(40), ...more });
  const runTo = async (engine: ReturnType<typeof createEngine>, ready: () => boolean) => {
    try { expect(await engine.start()).toBe(true); await vi.waitFor(ready, { timeout: 5000 }); } finally { await engine.stop(); }
  };

  it("uploads the parked guild's runs when this profile is that guild's server, even while another guild is loaded", async () => {
    const files = layout(guildedSaved());
    const { fetcher, uploads } = bot(PARKED);
    vi.stubGlobal("fetch", fetcher);
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine(config(files, { wowGuild: PARKED }), { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    await runTo(engine, () => expect(existsSync(files.record) && Object.keys(JSON.parse(readFileSync(files.record, "utf8")).runs).length).toBeGreaterThanOrEqual(2) as unknown as boolean);
    const parkedUpload = uploads.find((entry) => (entry["export"] as { wowGuild?: string }).wowGuild === PARKED)!;
    expect(parkedUpload["guildDiscordId"]).toBe("PARKED-SERVER");
    const exported = parkedUpload["export"] as Record<string, unknown> & { dungeonRuns: { id: string }[] };
    expect(ids(exported.dungeonRuns)).toEqual(["PARKED-1", "PARKED-2", "PARKED-STRANGER"]);
    expect(JSON.stringify(parkedUpload)).not.toMatch(/SecretRosterMember|SECRET-LEDGER-ROW|SecretBankItem|officer only text|LOADED-1/);
    // The loaded (other) guild's data did not go to this server: the profile is for the parked guild only.
    expect(uploads.every((entry) => (entry["export"] as { wowGuild?: string }).wowGuild === PARKED)).toBe(true);
    // The bot's answer for the server's guild becomes the record, so the parked runs are not sent again and show as synced in game.
    const record = JSON.parse(readFileSync(files.record, "utf8"));
    expect(Object.keys(record.runs).sort()).toEqual(expect.arrayContaining(["PARKED-1", "PARKED-2"]));
    expect(logs.some((entry) => entry.message.startsWith("Dungeon runs of Parked Guild-TestRealm:"))).toBe(true);
    expect(readFileSync(files.standings, "utf8")).toContain('"PARKED-1"');
  });

  it("leaves the runs and says so when this profile is not linked to that guild's server", async () => {
    const files = layout(guildedSaved());
    const { fetcher, uploads } = bot(LOADED);
    vi.stubGlobal("fetch", fetcher);
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine(config(files, { guildDiscordId: "LOADED-SERVER" }), { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    await runTo(engine, () => expect(logs.some((entry) => entry.message.includes("wait: log in on a character of that guild or link that server"))).toBe(true) as unknown as boolean);
    expect(logs.find((entry) => entry.message.includes("wait:"))?.message).toBe(waitLine(PARKED, 3));
    expect(waitLine(PARKED, 1)).toBe("1 dungeon run of Parked Guild-TestRealm wait: log in on a character of that guild or link that server.");
    // Only the loaded guild went to its own server; no parked run, no parked guild's data.
    await vi.waitFor(() => expect(uploads.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(uploads.every((entry) => (entry["export"] as { wowGuild?: string }).wowGuild === LOADED)).toBe(true);
    expect(JSON.stringify(uploads)).not.toMatch(/PARKED-1|PARKED-2|SecretRosterMember/);
    // Nothing of the parked guild was recorded as acknowledged (only what this server knows about the loaded guild).
    expect(existsSync(files.record) ? Object.keys(JSON.parse(readFileSync(files.record, "utf8")).runs) : []).toEqual([]);
  });

  it("a server that answers wrong-server for the parked guild is remembered as not holding it, and the runs wait", async () => {
    const files = layout(guildedSaved());
    const { fetcher } = bot(LOADED, { wrong: true });
    vi.stubGlobal("fetch", fetcher);
    writeFileSync(files.record, JSON.stringify({ version: 1, runs: {}, servers: { "PARKED-SERVER": ["parkedguild-testrealm"] } }));
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine(config(files), { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    await runTo(engine, () => expect(logs.some((entry) => entry.message.includes("wait:"))).toBe(true) as unknown as boolean);
    const record = JSON.parse(readFileSync(files.record, "utf8"));
    expect(record.servers["PARKED-SERVER"]).not.toContain("parkedguild-testrealm");
    expect(Object.keys(record.runs)).toEqual([]);
  });
});

describe("French companion lines", () => {
  it("translates the parked-guild run report and the waiting line", () => {
    const { message } = createRequire(import.meta.url)("../companion-app/i18n.cjs") as { message: (language: string, value: string) => string };
    expect(message("fr", "Dungeon runs of Parked Guild-TestRealm: 2 sent, 2 stored.")).toBe("Parcours de donjon de Parked Guild-TestRealm : 2 envoyé(s), 2 enregistré(s).");
    expect(message("fr", waitLine(PARKED, 3))).toContain("en attente");
  });
});
