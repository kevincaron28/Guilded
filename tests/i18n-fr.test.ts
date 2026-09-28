import { describe, expect, it } from "vitest";
import { collectKeys } from "../scripts/i18n-keys.mjs";
import { FR_TEXT } from "../src/i18n-fr.js";
import { tx } from "../src/i18n.js";
import { channelNames, channelSpec, CATEGORY_NAMES, type ChannelField } from "../src/setup-names.js";
import { isPermissionRoleName, permissionRoleNames, permissionRolesFr } from "../src/permissions.js";
import { craftEmbed, ensureBoardTags, boardTagNames } from "../src/commands/craft-board.js";
import { coreRosterEmbed } from "../src/services/raid-core.js";
import { buildSignupEmbed } from "../src/services/signup-embed.js";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("French text", () => {
  it("has a French entry for every text in the setup guide, its checklist and the craft board", () => {
    const missing = (collectKeys() as string[]).filter((key) => !(key in FR_TEXT));
    expect(missing).toEqual([]);
  });

  it("keeps the {placeholders} of the English text", () => {
    for (const [english, french] of Object.entries(FR_TEXT)) {
      expect(placeholders(french), english).toEqual(placeholders(english));
      expect(french.trim().length, english).toBeGreaterThan(0);
    }
  });

  it("tx fills placeholders, uses French only for fr, and falls back to English", () => {
    expect(tx("fr", "Give me {gm}", { gm: "Maître de guilde" })).toBe("Me donner Maître de guilde");
    expect(tx("en", "Give me {gm}", { gm: "Guild Master" })).toBe("Give me Guild Master");
    expect(tx("fr", "A text nobody translated {x}", { x: 1 })).toBe("A text nobody translated 1");
  });

  it("stays inside Discord's limits for buttons and select placeholders it is used in", () => {
    for (const key of collectKeys() as string[]) {
      const french = FR_TEXT[key] ?? key;
      // A button label is at most 80 characters; the long texts are descriptions, so only check short keys.
      if (key.length <= 80 && !key.includes("\n")) expect(french.length, key).toBeLessThanOrEqual(160);
    }
  });
});

describe("French server names", () => {
  const fields: ChannelField[] = ["notifyChannelId", "raidSignupChannelId", "raidLogChannelId", "logChannelId", "dungeonLeaderboardChannelId", "dungeonSignupChannelId", "dungeonChannelId", "lootChannelId", "craftChannelId", "readinessChannelId", "coreChannelId"];

  it("gives every channel a valid, distinct French name and topic", () => {
    const names = new Set<string>();
    for (const field of fields) {
      const fr = channelSpec(field, "fr");
      const en = channelSpec(field, "en");
      expect(fr.name).toMatch(/^[a-z0-9-]{2,100}$/);
      expect(fr.topic.length).toBeLessThanOrEqual(1024);
      expect(fr.name).not.toBe(en.name);
      expect(fr.access).toBe(en.access);
      expect(fr.category).toBe(en.category);
      expect(names.has(fr.name)).toBe(false);
      names.add(fr.name);
      // Current names first; names from earlier versions may follow (the group finder was "dungeon-signups").
      expect(channelNames(field).slice(0, 2)).toEqual([en.name, fr.name]);
    }
  });

  it("has French categories and role names, and both spellings count as the role", () => {
    expect(Object.keys(CATEGORY_NAMES.fr)).toEqual(Object.keys(CATEGORY_NAMES.en));
    expect(CATEGORY_NAMES.fr.guild).toBe("⚜️ Guilde");
    expect(permissionRolesFr.officer).toBe("Officier");
    expect(isPermissionRoleName("officer", "Officer")).toBe(true);
    expect(isPermissionRoleName("officer", "Officier")).toBe(true);
    expect(isPermissionRoleName("officer", "Chef de raid")).toBe(false);
    expect(permissionRoleNames("guildMaster")).toEqual(["Guild Master", "Maître de guilde"]);
  });
});

describe("French posts", () => {
  it("renders the craft request, the core roster and the signup post in French", async () => {
    const request = {
      id: "r1", item: "Flacon des Titans", quantity: 2, profession: "Alchemy", note: null, materialsProvided: true, status: "CLAIMED" as const,
      createdAt: new Date(0), requester: { discordUserId: "u1", displayName: "Amy" }, crafter: { discordUserId: "u2", displayName: "Bob" }
    };
    const craft = craftEmbed(request, ["Bob (300)"], "fr").toJSON();
    expect(craft.fields?.map((f) => f.name)).toEqual(["Statut", "Demandé par", "Artisan", "Métier", "Matériaux", "Artisans de la guilde (Alchimie)"]);
    expect(craft.fields?.[0]?.value).toBe("🟡 Pris en charge");

    const roster = coreRosterEmbed({ name: "Mardi", description: null, members: [{ role: "HEALER", bench: true, member: { displayName: "Cy" } }, { role: "TANK", bench: false, member: { displayName: "Dee" } }] }, undefined, "fr").toJSON();
    expect(roster.fields?.map((f) => f.name)).toEqual(["🎲 Butin", "🛡️ Tanks (1)", "💚 Soigneurs (0)", "⚔️ DPS (0)", "🪑 Banc (1)"]);
    expect(roster.fields?.find((f) => f.name.startsWith("🪑"))?.value).toBe("Cy (Soigneur)");
    expect(roster.footer?.text).toBe("1 membre du core + 1 sur le banc · les membres du core ont la priorité aux inscriptions des raids de ce core");

    const signup = buildSignupEmbed({
      lang: "fr",
      raid: { id: "x", title: "MC", description: null, status: "PLANNED", scheduledAt: new Date(0), tankLimit: 1, healerLimit: null, dpsLimit: null },
      signups: [{ memberId: "a", displayName: "Amy", role: "TANK", status: "SIGNED_UP" }],
      core: { name: "Mardi", members: [{ memberId: "m", displayName: "Manque", role: "DPS", bench: false }] }
    }).toJSON();
    const names = signup.fields?.map((f) => f.name) ?? [];
    expect(names).toContain("🛡️ Tank 1/1 · COMPLET");
    expect(names).toContain("Membres du core pas encore inscrits (1)");

    // A forum made in English is recognized in French: no duplicate tags are added.
    const added: string[][] = [];
    await ensureBoardTags({ availableTags: boardTagNames("en").map((name, i) => ({ id: String(i), name })), setAvailableTags: async (tags: { name: string }[]) => { added.push(tags.map((t) => t.name)); } } as never, "fr");
    expect(added).toEqual([]);
  });

  it("has the singular and plural log texts", () => {
    expect(FR_TEXT["{n} wipe"]).toBe("{n} échec");
    expect(FR_TEXT["{n} wipes"]).toBe("{n} échecs");
  });
});
