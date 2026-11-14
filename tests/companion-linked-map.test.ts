import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkedMapLua } from "../companion/standings-format.mjs";
import { writeStandings } from "../companion/standings.mjs";

// 9.1.4: the signed-in companion writes the per-character "Linked to Discord" map for this PC's own characters.
const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function game() {
  const root = mkdtempSync(join(tmpdir(), "qg-linked-map-"));
  dirs.push(root);
  const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
  mkdirSync(saved, { recursive: true });
  mkdirSync(join(root, "Interface", "AddOns", "Guilded"), { recursive: true });
  const file = join(saved, "Guilded.lua");
  writeFileSync(file, `GuildedDB = { version = 3, character = { name = "Meo", realm = "", gameEdition = "forever" },
    myCharacters = { ["Meo"] = { name = "Meo" }, ["Alt Two"] = { name = "Alt Two" }, ["Squatted"] = { name = "Squatted" }, ["Unknown"] = { name = "Unknown" } } }`);
  return { file, standings: join(root, "Interface", "AddOns", "Guilded", "Standings.lua") };
}

describe("the signed-in companion's per-character map", () => {
  it("confirms this PC's characters the bot holds for one member, not a squatted one or unknown ones", async () => {
    const pc = game();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ protocolVersion: 2, updatedAt: "2026-11-10T00:00:00Z", baseGp: 0, standings: [], gameEdition: "forever",
        accounts: { Meo: "m1", "Alt Two": "m1", Squatted: "m2", Stranger: "m3" } })
    }));
    const result = await writeStandings({ watchFile: pc.file, uploadUrl: "https://bot.example", guildDiscordId: "1", companionCredential: "c".repeat(43), discordAccount: { displayName: "Kev|" } });
    expect(result.text).toContain('["meo"] = { discord = "Kev", confirmed = true },');
    expect(result.text).toContain('["alt two"] = { discord = "Kev", confirmed = true },');
    // Someone else's character on this PC, an unknown one and a stranger's name (never on this PC) get no Discord name.
    expect(result.text).not.toContain('["squatted"]');
    expect(result.text).not.toContain('["unknown"]');
    expect(result.text).not.toContain("stranger");
    expect(readFileSync(pc.standings, "utf8")).toContain('GuildedLinkedMeta = { updatedAt = "2026-11-10T00:00:00Z", }');
  });

  it("writes an empty map when the sign-in has no name, and drops reported entries' names", () => {
    expect(linkedMapLua([], "2026-11-10T00:00:00Z")).toBe('GuildedLinked = {\n}\nGuildedLinkedMeta = { updatedAt = "2026-11-10T00:00:00Z", }\nGuildedCompanionFeatures = { ["group-relay"] = true, at = 1794268800 }\n');
    expect(linkedMapLua([{ name: "Ann", discord: "Secret", confirmed: false }], "t")).toContain('["ann"] = { confirmed = false },');
    expect(linkedMapLua([{ name: "Ann", discord: "Secret", confirmed: false }], "t")).not.toContain("Secret");
  });
});
