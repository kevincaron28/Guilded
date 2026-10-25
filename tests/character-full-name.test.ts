import { describe, expect, it, vi } from "vitest";
import { parseAddonExportText } from "../companion/lua-export-content.mjs";
import { standingsToLua } from "../companion/standings-format.mjs";
import { addonCharacterSchema } from "../src/integrations/addon.js";
import { applyDiscoveredCharacters } from "../src/services/roster-discovery.js";
import { characterDisplayLine, characterName } from "../src/services/character-display.js";
import { readPersonalRuns } from "../companion/personal-runs-content.mjs";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";

describe("full names through companion and bot", () => {
  it("retains the standalone uploader's full name and treats run names as optional presentation", () => {
    const personal = readPersonalRuns('GuildedDungeonsDB = { character = { name = "Halidor", displayName = "Halidor Galemorne", realm = "Forever" } }');
    expect(personal.character).toMatchObject({ name: "Halidor", displayName: "Halidor Galemorne" });
    const player = dungeonRunSchema.shape.players.element.parse({ character: "Halidor", displayName: "Halidor Galemorne", realm: "Forever" });
    expect(player.character).toBe("Halidor");
    expect(player.displayName).toBe("Halidor Galemorne");
  });
  it("keeps ledger names and source refs stable while exporting self and peer display names", () => {
    const parsed = parseAddonExportText(`GuildedDB = {
      character = { name = "Halidor", displayName = "Halidor Galemorne", class = "WARRIOR" },
      displayNames = { Highpriest = "Highpriest Cheech" },
      peerRoster = { Highpriest = { identity = { class = "PRIEST" } } },
      epgp = { Halidor = { ledger = { { id = "old-ref", epAmount = 100, reason = "Raid" } } } }
    }`, "Forever");
    expect(parsed.character).toMatchObject({ name: "Halidor", displayName: "Halidor Galemorne" });
    expect(parsed.characters?.[0]).toMatchObject({ name: "Highpriest", displayName: "Highpriest Cheech" });
    expect(parsed.epgpTransactions[0]).toMatchObject({ character: "Halidor", sourceRef: "qg:old-ref" });
    expect(addonCharacterSchema.parse(parsed.character).displayName).toBe("Halidor Galemorne");
  });
  it("refreshes presentation without renaming or relinking a stored character", async () => {
    const update = vi.fn(async () => ({}));
    const tx = { character: { update, findUnique: vi.fn(async () => null) }, professionSkill: { upsert: vi.fn() } };
    const entry = addonCharacterSchema.parse({ name: "Halidor", realm: "Forever", class: "WARRIOR", displayName: "Halidor Galemorne" });
    await applyDiscoveredCharacters(tx as never, "guild", [entry], [{ id: "existing", name: "Halidor", realm: "Forever" }]);
    expect(update).toHaveBeenCalledWith({ where: { id: "existing" }, data: expect.objectContaining({ displayName: "Halidor Galemorne" }) });
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("memberId");
  });
  it("shows full names in rosters and returns them alongside stable standings keys", () => {
    const character = { name: "Halidor", displayName: "Halidor Galemorne", className: "Warrior" };
    expect(characterName(character)).toBe("Halidor Galemorne");
    expect(characterName({ name: "Halidor" })).toBe("Halidor");
    expect(characterDisplayLine("Kevin · Halidor", character, "en")).toContain("Kevin · Halidor Galemorne");
    expect(characterDisplayLine("HalidorFan", character, "en")).toContain("HalidorFan");
    expect(standingsToLua({ standings: [{ character: "Halidor", displayName: character.displayName, ep: 100, gp: 40 }] })).toContain('name = "Halidor", displayName = "Halidor Galemorne"');
  });
});
