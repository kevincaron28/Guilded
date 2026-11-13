import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync as readSource } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../companion/engine.mjs";
import { parseSavedFiles, readSavedExport, watchedSavedFiles, NO_GUILD_KEY_MESSAGE } from "../companion/addon-files.mjs";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { deviceRunCounts, dungeonRunReport, signedRunCounts } from "../companion/run-report.mjs";
import { personalPayloadFrom } from "../companion/personal-runs.mjs";
import { writeStandings } from "../companion/standings.mjs";
import { newLuaSession, type LuaSession } from "./lua/harness.js";
import { tocFiles } from "../scripts/build-dungeons-addon.mjs";

// 9.3.0 (owner report, 13 November 2026): a PC with Guilded Dungeons alone (no Guilded) plus the companion gets its runs
// onto the guild's board. The saved files below are written by the REAL standalone addon (Lua harness), not by hand.

const dirs: string[] = [];
let lua: LuaSession | undefined;
afterEach(() => { vi.unstubAllGlobals(); lua?.close(); lua = undefined; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const KEY = "k".repeat(43);
const STAMP = 1_800_000_000;

const SERIALIZER = String.raw`
function SER(v)
  local t = type(v)
  if t == "table" then
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = "[" .. SER(k) .. "]=" .. SER(v[k]) end
    return "{" .. table.concat(out, ",") .. "}"
  elseif t == "string" then return string.format("%q", v)
  else return tostring(v) end
end`;

/** GuildedDungeons.lua as the real standalone addon writes it after `characters` logged in and the first one ran a dungeon. */
function standaloneSaved(options: { characters?: string[]; guild?: boolean; runAs?: string; runId?: string; copies?: string[]; guildOf?: Record<string, string>; old?: boolean } = {}): string {
  const characters = options.characters ?? ["Tester"];
  lua = newLuaSession();
  lua.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil
    C_AddOns = { IsAddOnLoaded = function() return false end }
    ${options.guild === false ? "IsInGuild = function() return false end" : ""}`);
  for (const file of tocFiles()) lua.run(`loadaddon("GuildedDungeons", [=====[${readSource(new URL(`../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
  lua.run(`STAMP = ${STAMP}; NS.compat.serverTime = function() return STAMP end
    NS.compat.instance = function() return { id = 389, type = "party", name = "Ragefire Chasm", difficultyId = 1 } end
    NS.compat.isDungeonFinalBoss = function(_, id) return id == 9000 end`);
  for (const name of characters) {
    const guild = options.guildOf?.[name] ?? "Test Guild";
    // guildOf: { Name: "" } is a character without a guild.
    lua.run(`UnitName = function() return ${JSON.stringify(name)} end
      IsInGuild = function() return ${guild !== "" && options.guild !== false} end
      GetGuildInfo = function() ${guild === "" ? "return nil" : `return ${JSON.stringify(guild)}, "Member", 3, "TestRealm"`} end; fire_event("PLAYER_LOGIN")`);
  }
  // The last character to log in plays the run; its party is Bob and Amy.
  lua.run(`fire_event("PLAYER_ENTERING_WORLD"); fire_event("PLAYER_REGEN_DISABLED"); STAMP = STAMP + 900; fire_event("ENCOUNTER_END", 9000, "Bazzalan", 1, 5, 1)`);
  const played = options.runAs ?? characters.at(-1)!;
  lua.run(`local id, run = next(GuildedDungeonsDB.dungeon.runs)
    ${options.runId ? `GuildedDungeonsDB.dungeon.runs[id] = nil; run.id = ${JSON.stringify(options.runId)}; GuildedDungeonsDB.dungeon.runs[run.id] = run` : ""}
    run.players = { [${JSON.stringify(played)}] = { class = "WARRIOR", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Bob = { class = "MAGE", level = 20, deaths = 0, presentSec = 900, inGuild = true }, Amy = { class = "PRIEST", level = 20, deaths = 0, presentSec = 900, inGuild = true } }
    run.reporters = { [${JSON.stringify(played)}] = true }; run.recorder = ${JSON.stringify(played)}
    for _, copy in ipairs({ ${(options.copies ?? []).map((id) => JSON.stringify(id)).join(", ")} }) do
      local clone = {}; for k, v in pairs(run) do clone[k] = v end; clone.id = copy; GuildedDungeonsDB.dungeon.runs[copy] = clone
    end
    ${options.old ? "GuildedDungeonsDB.guildKey, GuildedDungeonsDB.guildEdition, GuildedDungeonsDB.myCharacters = nil, nil, nil" : ""}`);
  lua.run(SERIALIZER);
  const text = `GuildedDungeonsDB = ${lua.run("return SER(GuildedDungeonsDB)")}\n`;
  lua.close(); lua = undefined;
  return text;
}

function layout(files: { standalone?: string; guilded?: string }) {
  const root = mkdtempSync(join(tmpdir(), "qg-standalone-"));
  dirs.push(root);
  const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
  const addon = join(root, "Interface", "AddOns", "GuildedDungeons");
  mkdirSync(saved, { recursive: true });
  mkdirSync(addon, { recursive: true });
  writeFileSync(join(addon, "Accepted.lua"), "GuildedDungeonAccepted = GuildedDungeonAccepted or {}\n");
  if (files.standalone !== undefined) writeFileSync(join(saved, "GuildedDungeons.lua"), files.standalone);
  if (files.guilded !== undefined) writeFileSync(join(saved, "Guilded.lua"), files.guilded);
  return { root, saved, addon, standaloneFile: join(saved, "GuildedDungeons.lua"), guildedFile: join(saved, "Guilded.lua") };
}

const guildedSaved = (runs: string) => `GuildedDB = { version = 3, guildKey = "Test Guild-TestRealm", character = { name = "Kev", realm = "TestRealm", class = "PALADIN", level = 30, gameEdition = "forever" },
  myCharacters = { Kev = { name = "Kev", realm = "TestRealm", class = "PALADIN", level = 30 } }, dungeon = { runs = { ${runs} } } }`;
const guildedRun = (id: string, extra = "") => `["${id}"] = { id = "${id}", state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1, startedAt = ${STAMP}, endedAt = ${STAMP + 900}, completedBy = "final boss",
  players = { Kev = { presentSec = 900, level = 30, inGuild = true } ${extra} }, encounters = {} }`;

describe("a PC with Guilded Dungeons alone", () => {
  it("exports the runs, character, guild key and characters from GuildedDungeons.lua", async () => {
    const { standaloneFile } = layout({ standalone: standaloneSaved({ characters: ["Tester", "Alttwo"] }) });
    const { full, source, noGuildKey } = await readSavedExport(standaloneFile, "TestRealm");
    expect(source).toBe("standalone");
    expect(noGuildKey).toBe(false);
    expect(full.wowGuild).toBe("Test Guild-TestRealm");
    expect(full.character).toMatchObject({ name: "Alttwo", class: "WARRIOR" });
    expect(full.alts.map((entry: { name: string }) => entry.name).sort()).toEqual(["Alttwo", "Tester"]);
    expect(full.dungeonRuns).toHaveLength(1);
    expect(full.dungeonRuns[0]).toMatchObject({ state: "COMPLETED", instanceId: 389, completedBy: "final boss" });
    // No roster, ledger or officer data: the same shape as a fresh full-Guilded save with nothing in it.
    expect(full.epgpTransactions).toEqual([]);
    expect(full.raids).toEqual([]);
  });

  it("sends the guild and every character, and the run an alt played", () => {
    const text = standaloneSaved({ characters: ["Tester", "Alttwo"], runAs: "Tester" });
    const { full } = parseSavedFiles({ standalone: text, standaloneAt: STAMP * 1000 }, "TestRealm");
    const body = deviceUploadBody(full);
    expect(body.guild).toEqual({ name: "Test Guild", realm: "TestRealm" });
    expect(body.characters.map((entry) => entry.name).sort()).toEqual(["Alttwo", "Tester"]);
    // The last login was Alttwo, but Tester played the run: it still counts as this PC's.
    expect(body.dungeonRuns).toHaveLength(1);
  });

  it("syncs through the device path, writes the receipts for the addon and reports the runs", async () => {
    const text = standaloneSaved();
    const { standaloneFile, addon } = layout({ standalone: text });
    const runId = /\["id"\]="([^"]+)"/.exec(text)![1];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).endsWith("/api/v1/device/uploads")) return Response.json({ error: "unexpected" }, { status: 500 });
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ status: "synced", server: { discordId: "1", name: "Quebec Gold" }, guild: { name: "Test Guild", realm: "TestRealm" }, characters: 1,
        runs: { received: 1, stored: 1, skipped: 0 }, runReceipts: { acceptedRunRefs: [runId], runNotes: {} }, reported: ["Tester"] });
    }));
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ watchFile: standaloneFile, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: KEY }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      expect(await engine.start()).toBe(true);
      await vi.waitFor(() => expect(logs.some((entry) => entry.message.startsWith("Dungeon runs:"))).toBe(true));
    } finally { await engine.stop(); }
    expect(bodies[0]).toMatchObject({ guild: { name: "Test Guild", realm: "TestRealm" }, characters: [{ name: "Tester" }] });
    expect((bodies[0] as { dungeonRuns: unknown[] }).dungeonRuns).toHaveLength(1);
    expect(logs.find((entry) => entry.message.startsWith("Dungeon runs:"))).toEqual(expect.objectContaining({ level: "ok", message: "Dungeon runs: 1 sent, 1 stored." }));
    // The accepted-run list goes to the standalone addon's own file, so it stops resending.
    const accepted = readFileSync(join(addon, "Accepted.lua"), "utf8");
    expect(accepted).toContain(`"${runId}"`);
    expect(accepted).toContain('GuildedCompanion = GuildedCompanion or { mode = "device"');
    // The addon marks the run synced when it loads that file.
    lua = newLuaSession();
    lua.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; C_AddOns = { IsAddOnLoaded = function() return false end }`);
    for (const file of tocFiles()) {
      if (file === "Accepted.lua") continue;
      lua.run(`loadaddon("GuildedDungeons", [=====[${readSource(new URL(`../addon/GuildedDungeons/${file}`, import.meta.url), "utf8")}]=====], NS)`);
    }
    lua.run(`NS.getDb().dungeon = { runs = { [${JSON.stringify(runId)}] = { id = ${JSON.stringify(runId)}, state = "COMPLETED", endedAt = ${STAMP}, players = { Tester = {} } } } }
      local f = load([=====[${accepted}]=====]); f(); NS.dungeon.markSynced()`);
    expect(lua.run(`return tostring(NS.getDb().dungeon.runs[${JSON.stringify(runId)}].synced)`)).toBe("true");
  });

  it("says what to do when the addon has not saved the guild yet, and still does not stay silent", async () => {
    // An addon older than 9.3.0 saved no guild key and no character list.
    const text = standaloneSaved({ old: true });
    expect(text).not.toContain("guildKey");
    expect(text).not.toContain("myCharacters");
    const { standaloneFile } = layout({ standalone: text });
    expect((await readSavedExport(standaloneFile, "TestRealm")).noGuildKey).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "no-guild", guild: null })));
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ watchFile: standaloneFile, uploadUrl: "https://bot.test/api/v1/addon-imports", device: true, deviceSecret: KEY }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      expect(await engine.start()).toBe(true);
      await vi.waitFor(() => expect(logs.some((entry) => entry.message === NO_GUILD_KEY_MESSAGE)).toBe(true));
    } finally { await engine.stop(); }
    expect(logs.find((entry) => entry.message === NO_GUILD_KEY_MESSAGE)?.level).toBe("warn");
    expect(engine.state().syncPhase).toBe("needs-attention");
  });

  it("gives a plain error, not a GuildedDB dead end, when neither file exists", async () => {
    const { standaloneFile } = layout({});
    await expect(readSavedExport(standaloneFile, "R")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("watches both files, so a save by either addon uploads", () => {
    expect(watchedSavedFiles("C:/WoW/SavedVariables/GuildedDungeons.lua")).toEqual(["C:/WoW/SavedVariables/GuildedDungeons.lua", expect.stringMatching(/Guilded\.lua$/)]);
    expect(watchedSavedFiles("C:/WoW/SavedVariables/Guilded.lua")[1]).toMatch(/GuildedDungeons\.lua$/);
    expect(watchedSavedFiles("C:/somewhere/else.json")).toEqual(["C:/somewhere/else.json"]);
  });
});

describe("signed-in standalone PC without a saved guild key", () => {
  it("shows the clear update-the-addon message, not the bot's generic wrong-guild error", async () => {
    const { standaloneFile } = layout({ standalone: standaloneSaved({ old: true }) });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ skipped: "wrong-server", serverWowGuild: { name: "Test Guild" } })));
    const logs: { level: string; message: string }[] = [];
    const engine = createEngine({ watchFile: standaloneFile, uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "1", companionCredential: "c".repeat(40) }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
    try {
      expect(await engine.start()).toBe(true);
      await vi.waitFor(() => expect(engine.state().lastUpload?.message).toBe(NO_GUILD_KEY_MESSAGE));
    } finally { await engine.stop(); }
    expect(logs.some((entry) => entry.level === "warn" && entry.message === NO_GUILD_KEY_MESSAGE)).toBe(true);
  });

  it("counts a run waiting for a second statement as waiting", () => {
    const counts = signedRunCounts(["A", "B"], { acceptedRunRefs: ["A"], runNotes: {}, pendingRunNotes: { B: "Waiting for a second player" } });
    expect(counts).toMatchObject({ sent: 2, stored: 1, waiting: 1, unconfirmed: 0 });
    expect(dungeonRunReport(counts)?.message).toBe("Dungeon runs: 2 sent, 1 stored, 1 waiting for a second player.");
  });
});

describe("a PC with both addons", () => {
  it("unions the runs by id: Guilded's copy wins, a run only the standalone addon recorded is kept", async () => {
    const standalone = standaloneSaved({ characters: ["Kev"], runId: "SHARED", copies: ["ONLY-STANDALONE"] });
    const { guildedFile, standaloneFile } = layout({ standalone, guilded: guildedSaved(guildedRun("SHARED", ', Zed = { presentSec = 900, level = 30, inGuild = true }')) });
    const { full, source } = await readSavedExport(guildedFile, "TestRealm");
    expect(source).toBe("both");
    expect(full.wowGuild).toBe("Test Guild-TestRealm");
    expect(full.dungeonRuns.map((run: { id: string }) => run.id).sort()).toEqual(["ONLY-STANDALONE", "SHARED"]);
    // Guilded's copy of the shared run (with Zed in it) is the one kept.
    expect(full.dungeonRuns.find((run: { id: string }) => run.id === "SHARED").players.map((player: { character: string }) => player.character)).toContain("Zed");
    // Choosing the other file reads the same two.
    expect((await readSavedExport(standaloneFile, "TestRealm")).source).toBe("both");
  });

  it("adds the standalone addon's characters of the same guild, and only those", () => {
    // Alt2 logged in last, in another guild: it is not this guild's character.
    const standalone = standaloneSaved({ characters: ["Alt1", "Alt2"], guildOf: { Alt2: "Other Guild" } });
    const { full } = parseSavedFiles({ guilded: guildedSaved(guildedRun("G1")), standalone, standaloneAt: 1 }, "TestRealm");
    const names = [full.character.name, ...full.alts.map((entry: { name: string }) => entry.name)];
    expect(names).toContain("Alt1");
    expect(names).not.toContain("Alt2");
  });

  it("is exactly the old export when there is no standalone file", () => {
    const { full, source } = parseSavedFiles({ guilded: guildedSaved(guildedRun("G1")) }, "TestRealm");
    expect(source).toBe("guilded");
    expect(full.dungeonRuns.map((run: { id: string }) => run.id)).toEqual(["G1"]);
  });
});

describe("two guilds on one account", () => {
  const ids = (full: { dungeonRuns: { id: string }[] }) => full.dungeonRuns.map((run) => run.id);

  it("uploads only the runs of the guild of the last login, never the other guild's", () => {
    // A1 (Test Guild) ran, then B1 (Other Guild) logged in last.
    const text = standaloneSaved({ characters: ["B1", "A1"], runAs: "A1", guildOf: { B1: "Other Guild" } });
    // The run was recorded by A1 (Test Guild): the last login A1 is in Test Guild, so it uploads for Test Guild.
    const forA = parseSavedFiles({ standalone: text }, "TestRealm").full;
    expect(forA.wowGuild).toBe("Test Guild-TestRealm");
    expect(ids(forA).length).toBe(1);
    expect([forA.character.name, ...(forA.alts ?? []).map((a: { name: string }) => a.name)]).not.toContain("B1");
    // Same account, B1 logged in last: the run of A1 stays out of Other Guild's upload.
    const other = standaloneSaved({ characters: ["A1", "B1"], runAs: "A1", guildOf: { B1: "Other Guild" } });
    const forB = parseSavedFiles({ standalone: other }, "TestRealm").full;
    expect(forB.wowGuild).toBe("Other Guild-TestRealm");
    expect(ids(forB)).toEqual([]);
    expect(forB.character.name).toBe("B1");
  });

  it("a guildless alt logging in last leaves the earlier guild's upload intact", () => {
    const text = standaloneSaved({ characters: ["Main", "Alt"], runAs: "Main", guildOf: { Alt: "" } });
    const { full, noGuildKey } = parseSavedFiles({ standalone: text }, "TestRealm");
    expect(noGuildKey).toBe(false);
    expect(full.wowGuild).toBe("Test Guild-TestRealm");
    expect(ids(full).length).toBe(1);
    expect(full.character.name).toBe("Main");
  });

  it("a character that left its guild stops sending runs to it", () => {
    const text = standaloneSaved({ characters: ["Solo"], guild: false });
    const { full, noGuildKey } = parseSavedFiles({ standalone: text }, "TestRealm");
    expect(noGuildKey).toBe(true);
    expect(full.wowGuild).toBeUndefined();
  });

  it("a leftover GuildedDungeons.lua beside Guilded adds only the Guilded guild's runs", () => {
    const standalone = standaloneSaved({ characters: ["Kev", "Other"], runAs: "Other", runId: "FOREIGN", guildOf: { Other: "Other Guild" } });
    const { full } = parseSavedFiles({ guilded: guildedSaved(guildedRun("G1")), standalone, standaloneAt: 1 }, "TestRealm");
    expect(ids(full)).toEqual(["G1"]);
  });
});

describe("signed-in standalone PC (guild upload)", () => {
  it("keeps the run receipts in the standalone addon's own Accepted.lua when there is no Guilded folder", async () => {
    const { standaloneFile, addon, root } = layout({ standalone: standaloneSaved() });
    const answer = { protocolVersion: 2, standings: [], acceptedRunRefs: ["RUN-1", "RUN-2"], runNotes: { "RUN-2": "Not completed" }, botVersion: "9.3.0", updatedAt: "2026-11-13T12:00:00Z", accounts: {} };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(answer, { headers: { etag: "e1" } })));
    const result = await writeStandings({ watchFile: standaloneFile, realm: "TestRealm", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "1", companionCredential: "c".repeat(40) });
    expect(result.acceptedOnly).toBe(true);
    const accepted = readFileSync(join(addon, "Accepted.lua"), "utf8");
    expect(accepted).toContain('"RUN-1", "RUN-2"');
    expect(accepted).toContain('GuildedDungeonNotes["RUN-2"] = "Not completed"');
    // Nothing is created in a Guilded folder that does not exist.
    expect(() => readFileSync(join(root, "Interface", "AddOns", "Guilded", "Standings.lua"), "utf8")).toThrow();
  });
});

describe("the dungeon run line", () => {
  it("counts what the bot stored, copied, holds back or has not confirmed", () => {
    const sent = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const counts = deviceRunCounts(sent, { runReceipts: { acceptedRunRefs: ["a", "b", "c"], runNotes: { b: "Counted with a guildmate's copy of this run", c: "Not completed" }, pendingRunNotes: { d: "Waiting for a second player's addon" } } });
    expect(counts).toMatchObject({ sent: 5, stored: 1, copies: 1, waiting: 1, unconfirmed: 1, notCounted: { "Not completed": 1 } });
    expect(dungeonRunReport(counts)).toEqual({ level: "warn", message: "Dungeon runs: 5 sent, 1 stored, 1 copied from a guildmate, 1 waiting for a second player, 1 not counted (Not completed), 1 not confirmed yet." });
    expect(dungeonRunReport(signedRunCounts(sent.slice(0, 2), { acceptedRunRefs: ["a", "b"], runNotes: {} }))?.message).toBe("Dungeon runs: 2 sent, 2 stored.");
    expect(dungeonRunReport(deviceRunCounts([], {}))?.message).toBe("Dungeon runs: none to send.");
  });
});

describe("personal mode with several characters", () => {
  it("sends every saved character so an alt's run is not refused", () => {
    const text = standaloneSaved({ characters: ["Tester", "Alttwo"], runAs: "Tester" });
    const payload = personalPayloadFrom([text], "TestRealm");
    expect(payload.character?.name).toBe("Alttwo");
    expect(payload.characters.map((entry: { name: string }) => entry.name).sort()).toEqual(["Alttwo", "Tester"]);
    expect(payload.runs).toHaveLength(1);
  });
});
