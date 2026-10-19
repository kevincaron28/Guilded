import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptedToLua, readPersonalRuns, resolveAcceptedPath, uploadPersonalRuns } from "../companion/personal-runs.mjs";
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
      await expect(uploadPersonalRuns({ watchFile: join(saved, "GuildedDungeons.lua"), uploadUrl: "https://guilded.kcaron.top", companionCredential: "c".repeat(40) })).rejects.toThrow("guilded.kcaron.top/me/");
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
