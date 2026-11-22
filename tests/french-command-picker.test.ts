import { describe, expect, it } from "vitest";
import { commands } from "../src/commands/index.js";
import { FR_DESCRIPTIONS } from "../src/commands/french-descriptions.js";
import { FRENCH_TOP_NAMES, localizeCommandJson } from "../src/commands/localize.js";
import { frenchErrorMessage } from "../src/services/error-fr.js";

type Node = { name: string; description?: string; name_localizations?: Record<string, string>; description_localizations?: Record<string, string>; options?: Node[]; choices?: unknown[]; value?: unknown };
const json = commands.map((command) => command.toJSON() as unknown as Node);

describe("French command picker", () => {
  it("gives every command, subcommand and option a French description", () => {
    const missing: string[] = [];
    const visit = (node: Node, path: string) => {
      if (node.description && !node.description_localizations?.["fr"]) missing.push(path);
      for (const child of node.options ?? []) visit(child, `${path}/${child.name}`);
    };
    for (const command of json) visit(command, command.name);
    expect(missing).toEqual([]);
  });

  it("keeps French descriptions within Discord's 100 characters and names valid", () => {
    for (const [english, french] of Object.entries(FR_DESCRIPTIONS)) {
      expect(french.length, english).toBeLessThanOrEqual(100);
      expect(french.trim(), english).not.toBe("");
    }
    for (const name of Object.values(FRENCH_TOP_NAMES)) expect(name).toMatch(/^[-_\p{L}\p{N}]{1,32}$/u);
  });

  it("keeps command names in English for routing and the top-level French names unique", () => {
    expect(json.map((command) => command.name)).toContain("loot");
    const shown = json.map((command) => command.name_localizations?.["fr"] ?? command.name);
    expect(new Set(shown).size).toBe(shown.length);
    expect(json.find((command) => command.name === "loot")?.name_localizations?.["fr"]).toBe("butin");
  });

  it("counts only the longest localization of each field against Discord's 8000-character limit", () => {
    const size = (node: Node): number => {
      const longest = (base: string | undefined, loc: Record<string, string> | undefined) => Math.max(base?.length ?? 0, ...Object.values(loc ?? {}).map((text) => text.length));
      return longest(node.name, node.name_localizations) + longest(node.description, node.description_localizations) + (typeof node.value === "string" ? node.value.length : 0)
        + [...(node.options ?? []), ...(node.choices ?? [])].reduce<number>((sum, child) => sum + size(child as Node), 0);
    };
    for (const command of json) expect(size(command), command.name).toBeLessThan(7500);
  });

  it("does not replace a French description that is already set", () => {
    const node = localizeCommandJson({ name: "x", description: "Page", description_localizations: { fr: "Autre" } as Record<string, string> });
    expect(node.description_localizations["fr"]).toBe("Autre");
  });
});

describe("French error messages", () => {
  it("translates known messages, exactly and by pattern", () => {
    expect(frenchErrorMessage("Craft request not found.")).toBe("Demande d'artisanat introuvable.");
    expect(frenchErrorMessage("That request is already done.")).toBe("Cette demande est déjà terminée.");
    expect(frenchErrorMessage('No linked character called "Bob". /character list shows what is linked.')).toContain("Aucun personnage lié nommé");
    expect(frenchErrorMessage("Bid must be at least 25 GP")).toBe("La mise doit être d'au moins 25 GP.");
    expect(frenchErrorMessage("You have no linked character yet. DM your character's full name (First Last) to the bot, or type it in the guild-invite channel.")).toMatch(/^Tu n.as pas encore de personnage lié\. Envoie/);
  });

  it("passes unknown messages through unchanged", () => {
    expect(frenchErrorMessage("Something nobody has translated")).toBe("Something nobody has translated");
    expect(frenchErrorMessage("Déjà en français.")).toBe("Déjà en français.");
  });
});
