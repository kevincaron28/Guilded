import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptedToLua, personalPayloadFrom, personalSavedFiles, readPersonalRuns, resolveAcceptedPath, uploadPersonalRuns } from "../companion/personal-runs.mjs";
import { pairAccount, validateConfig } from "../companion/engine.mjs";

afterEach(() => vi.unstubAllGlobals());
const END = 1_800_000_000;
const SAVED = `GuildedDungeonsDB = {
  ["character"] = { ["name"] = "Kev", ["realm"] = "Doomhowl", ["class"] = "WARRIOR", ["level"] = 16 },
  ["dungeon"] = { ["runs"] = {
    ["QG-1"] = { ["id"] = "QG-1", ["state"] = "COMPLETED", ["instanceId"] = 389, ["name"] = "Ragefire Chasm", ["startedAt"] = ${END - 1500}, ["endedAt"] = ${END}, ["recorder"] = "Kev",
      ["players"] = { ["Kev"] = { ["class"] = "WARRIOR", ["level"] = 16, ["deaths"] = 0, ["presentSec"] = 1500 } } },
    ["QG-2"] = { ["id"] = "QG-2", ["state"] = "COMPLETED", ["instanceId"] = 389, ["name"] = "Ragefire Chasm", ["startedAt"] = ${END - 9000}, ["endedAt"] = ${END - 7000}, ["synced"] = true,
      ["players"] = { ["Kev"] = { ["presentSec"] = 2000 } } },
    ["QG-3"] = { ["id"] = "QG-3", ["state"] = "ABANDONED", ["instanceId"] = 389, ["name"] = "Ragefire Chasm", ["players"] = { ["Kev"] = { ["presentSec"] = 10 } } }
  } }
}
`;

describe("personal companion mode", () => {
  it("refreshes the public score snapshot even when every run was already synced", async () => {
    const root = mkdtempSync(join(tmpdir(), "gd-score-"));
    try {
      const watchFile = join(root, "GuildedDungeons.lua"), acceptedFile = join(root, "Accepted.lua");
      writeFileSync(watchFile, 'GuildedDungeonsDB = { character = { name="Kev", realm="Doomhowl" }, dungeon = {runs={}} }');
      const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({ runs: [], includeScore: true });
        return Response.json({ acceptedRunRefs: [], publicScore: { character: "Kev", realm: "Doomhowl", season: "Public", status: "ACTIVE", updatedAt: "2026-10-23T12:00:00Z", rows: [] } });
      });
      vi.stubGlobal("fetch", fetcher);
      await uploadPersonalRuns({ watchFile, acceptedFile, uploadUrl: "https://guilded.kcaron.top", companionCredential: "c".repeat(40) });
      expect(readFileSync(acceptedFile, "utf8")).toContain('GuildedDungeonsPublicScore.character = "Kev"');
      // A pre-upgrade server must clear any stale new-format snapshot safely.
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ acceptedRunRefs: [] })));
      await uploadPersonalRuns({ watchFile, acceptedFile, uploadUrl: "https://guilded.kcaron.top", companionCredential: "c".repeat(40) });
      expect(readFileSync(acceptedFile, "utf8")).toContain("GuildedDungeonsPublicScore = nil");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("exports calibration metadata from saved runs", () => {
    const saved = SAVED.replace('["id"] = "QG-1",', '["id"] = "QG-1", gameBuild="12345", startTrigger="first combat",');
    expect(readPersonalRuns(saved).runs[0]).toMatchObject({ gameBuild: "12345", startTrigger: "first combat" });
  });
  it("reads GuildedDungeons' saved file, leaving out runs already sent", () => {
    const { character, runs } = readPersonalRuns(SAVED);
    expect(character).toEqual({ name: "Kev", realm: "Doomhowl", class: "WARRIOR", level: 16 });
    expect(runs.map((run) => run.id).sort()).toEqual(["QG-1", "QG-3"]);
    expect(runs.find((run) => run.id === "QG-1")!.players[0]).toMatchObject({ character: "Kev", realm: "Doomhowl", level: 16, deaths: 0 });
  });

  it("writes the accepted list without replacing Guilded's", () => {
    const lua = acceptedToLua(["QG-1", 'odd"id']);
    expect(lua).toContain("GuildedDungeonAccepted = GuildedDungeonAccepted or {}");
    expect(lua).toContain('{ "QG-1", "odd\\"id" }');
    expect(resolveAcceptedPath({ watchFile: "C:\\WoW\\_classic_\\WTF\\Account\\A\\SavedVariables\\GuildedDungeons.lua" })).toMatch(/_classic_[\\/]Interface[\\/]AddOns[\\/]GuildedDungeons[\\/]Accepted\.lua$/);
  });

  it("sends finished runs with the personal credential and saves what the website holds", async () => {
    const root = mkdtempSync(join(tmpdir(), "gd-personal-"));
    try {
      const saved = join(root, "WTF", "Account", "A", "SavedVariables");
      mkdirSync(saved, { recursive: true });
      writeFileSync(join(saved, "GuildedDungeons.lua"), SAVED);
      const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.character.name).toBe("Kev");
        expect(body.runs.map((run: { id: string }) => run.id)).toEqual(["QG-1"]);
        expect((init?.headers as Record<string, string>)["x-companion-credential"]).toBe("c".repeat(40));
        return Response.json({ accepted: ["QG-1"], confirmed: [], duplicates: [], rejected: [], acceptedRunRefs: ["QG-1", "QG-2"] });
      });
      vi.stubGlobal("fetch", fetcher);
      const result = await uploadPersonalRuns({ watchFile: join(saved, "GuildedDungeons.lua"), uploadUrl: "https://guilded.kcaron.top", companionCredential: "c".repeat(40) });
      expect(String(fetcher.mock.calls[0]![0])).toBe("https://guilded.kcaron.top/api/v1/public-runs");
      expect(result.message).toBe("Public leaderboards: 1 new, 0 confirmed, 0 already sent.");
      expect(readFileSync(join(root, "Interface", "AddOns", "GuildedDungeons", "Accepted.lua"), "utf8")).toContain('"QG-1", "QG-2"');
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "no" }, { status: 401 })));
      await expect(uploadPersonalRuns({ watchFile: join(saved, "GuildedDungeons.lua"), uploadUrl: "https://guilded.kcaron.top", companionCredential: "c".repeat(40) })).rejects.toThrow("Sign in with Discord again");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // With both addons installed Guilded records the runs and Guilded Dungeons stays silent
  // (Shim.lua): its file keeps no character and no new runs.
  const SILENT_DUNGEONS = `GuildedDungeonsDB = {\n  ["addonVersion"] = "7.2.0",\n  ["settings"] = {},\n  ["character"] = {}\n}\n`;
  const GUILDED = `GuildedDB = {
  ["character"] = { ["name"] = "Kev", ["realm"] = "Doomhowl", ["class"] = "WARRIOR", ["level"] = 18 },
  ["dungeon"] = { ["runs"] = {
    ["QG-1"] = { ["id"] = "QG-1", ["state"] = "COMPLETED", ["instanceId"] = 389, ["name"] = "Ragefire Chasm", ["startedAt"] = ${END - 1500}, ["endedAt"] = ${END}, ["recorder"] = "Kev",
      ["players"] = { ["Kev"] = { ["class"] = "WARRIOR", ["level"] = 16, ["deaths"] = 0, ["presentSec"] = 1500 } } },
    ["QG-9"] = { ["id"] = "QG-9", ["state"] = "COMPLETED", ["instanceId"] = 389, ["name"] = "Ragefire Chasm", ["startedAt"] = ${END + 500}, ["endedAt"] = ${END + 2000}, ["recorder"] = "Kev",
      ["players"] = { ["Kev"] = { ["class"] = "WARRIOR", ["level"] = 18, ["deaths"] = 1, ["presentSec"] = 1500 } } }
  } }
}
`;

  it("reads both addons' files and sends each run once, with the newest file's character", () => {
    expect(personalPayloadFrom([SILENT_DUNGEONS, GUILDED])).toMatchObject({ character: { name: "Kev", level: 18 } });
    // A player who used Guilded Dungeons alone first, then installed Guilded: runs from both files.
    const both = personalPayloadFrom([SAVED, GUILDED]);
    expect(both.runs.map((run) => run.id)).toEqual(["QG-9", "QG-1"]);
    expect(both.character).toMatchObject({ name: "Kev", level: 18 });
    expect(personalPayloadFrom([SAVED, null]).runs.map((run) => run.id)).toEqual(["QG-1"]);
    expect(personalPayloadFrom([SILENT_DUNGEONS]).character).toBeNull();
  });

  it("picks the other addon's file from the same SavedVariables folder", () => {
    const folder = join("C:", "WoW", "WTF", "Account", "A", "SavedVariables");
    expect(personalSavedFiles(join(folder, "GuildedDungeons.lua"))).toEqual([join(folder, "GuildedDungeons.lua"), join(folder, "Guilded.lua")]);
    expect(personalSavedFiles(join(folder, "guilded.lua"))).toEqual([join(folder, "guilded.lua"), join(folder, "GuildedDungeons.lua")]);
    expect(personalSavedFiles(join(folder, "export.json"))).toEqual([join(folder, "export.json")]);
  });

  it("uploads Guilded's runs when the chosen GuildedDungeons.lua is silent because Guilded is installed", async () => {
    const root = mkdtempSync(join(tmpdir(), "gd-both-"));
    try {
      const saved = join(root, "WTF", "Account", "A", "SavedVariables");
      mkdirSync(saved, { recursive: true });
      writeFileSync(join(saved, "GuildedDungeons.lua"), SILENT_DUNGEONS);
      writeFileSync(join(saved, "Guilded.lua"), GUILDED);
      const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.character).toMatchObject({ name: "Kev", realm: "Doomhowl" });
        expect(body.runs.map((run: { id: string }) => run.id)).toEqual(["QG-9", "QG-1"]);
        return Response.json({ accepted: ["QG-9", "QG-1"], confirmed: [], duplicates: [], rejected: [], acceptedRunRefs: ["QG-9", "QG-1"] });
      });
      vi.stubGlobal("fetch", fetcher);
      const result = await uploadPersonalRuns({ watchFile: join(saved, "GuildedDungeons.lua"), uploadUrl: "https://guilded.kcaron.top", companionCredential: "c".repeat(40) });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ sent: 2, message: "Public leaderboards: 2 new, 0 confirmed, 0 already sent." });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("pairs with a website code and needs no Discord server ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ companionCredential: "k".repeat(43), personal: true })));
    const paired = await pairAccount({ uploadUrl: "https://guilded.kcaron.top", pairingCode: "P0123456789A" });
    expect(paired).toMatchObject({ ok: true, personal: true, guildDiscordId: "" });
    expect(validateConfig({ watchFile: "x/GuildedDungeons.lua", uploadUrl: "https://guilded.kcaron.top", companionCredential: "k".repeat(43), personal: true })).toEqual([]);
    expect(validateConfig({ watchFile: "x/Guilded.lua", uploadUrl: "https://guilded.kcaron.top", companionCredential: "k".repeat(43) })).toContain("The Discord server ID is not set.");
  });
});
