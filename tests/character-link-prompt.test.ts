import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { DISCORD_CLIENT_ID: "1552633893587394590", COMPANION_WEB_URL: undefined as string | undefined },
  db: { character: { findMany: vi.fn() } },
  issueCode: vi.fn(),
  context: vi.fn(), settings: vi.fn()
}));
vi.mock("../src/config.js", () => ({ config: mocks.config }));
vi.mock("../src/database.js", () => ({ prisma: mocks.db }));
vi.mock("../src/services/character-pairing.js", () => ({ issueCharacterPairingCode: mocks.issueCode, revokeCompanionCredentials: vi.fn() }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: mocks.context, guildService: { getSettings: mocks.settings } }));

import { characterLinkPrompt } from "../src/services/character-link-prompt.js";
import { companionWebUrl } from "../src/services/companion-links.js";
import { executeCharacter } from "../src/commands/character.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.COMPANION_WEB_URL = undefined;
  mocks.db.character.findMany.mockResolvedValue([]);
  mocks.issueCode.mockResolvedValue({ code: "ABC123DEF456", expiresAt: new Date("2026-10-14T12:00:00Z") });
  mocks.context.mockResolvedValue({ guildId: "guild1", memberId: "member1" });
  mocks.settings.mockResolvedValue({ language: "fr" });
});

describe("companion links", () => {
  it("opens the official hosted companion with the correct server prefilled and no code in the URL", () => {
    const url = companionWebUrl("123456789012345678");
    expect(url).toBe("https://guilded-wow.kcaron.workers.dev/companion/?guild=123456789012345678");
    expect(url).not.toContain("ABC123DEF456");
  });

  it("uses independent hosts' own companion and never defaults them to the hosted bot", () => {
    expect(companionWebUrl("server2", { DISCORD_CLIENT_ID: "other-app" })).toBeNull();
    expect(companionWebUrl("server2", { COMPANION_WEB_URL: "https://own-bot.example/companion/?lang=fr", DISCORD_CLIENT_ID: "other-app" }))
      .toBe("https://own-bot.example/companion/?lang=fr&guild=server2");
  });
});

describe("private character connection instructions", () => {
  it("shows an empty state, the current companion labels and a visible success check", async () => {
    const reply = await characterLinkPrompt(mocks.db as never, "guild1", "member1", "server1", "en");
    const embed = reply.embeds[0]!.toJSON();
    expect(embed.description).toContain("No WoW character is linked");
    expect(embed.description).toContain("becomes your main");
    expect(embed.fields![0]!.value).toContain("**ABC123DEF456**");
    expect(embed.fields![1]!.value).toContain("**Connect**");
    expect(embed.fields![1]!.value).toContain("`server1`");
    expect(embed.fields![2]!.value).toContain("/character list");
    expect(reply.components[0]!.toJSON().components[0]).toMatchObject({ url: "https://guilded-wow.kcaron.workers.dev/companion/?guild=server1" });
    expect(mocks.db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "member1", member: { guildId: "guild1" } } }));
  });

  it("distinguishes already linked main/alts and explains when an existing companion needs no code", async () => {
    mocks.db.character.findMany.mockResolvedValue([
      { name: "Ray", realm: "Forever", isMain: true }, { name: "AltRay", realm: "Other Realm", isMain: false }
    ]);
    const reply = await characterLinkPrompt(mocks.db as never, "guild1", "member1", "server1", "en");
    const text = reply.embeds[0]!.data.description!;
    expect(text).toContain("Main: **Ray** — Forever");
    expect(text).toContain("Alt: **AltRay** — Other Realm");
    expect(text).toContain("your main stays the same");
    expect(text).toContain("No new code needed");
    expect(reply.embeds[0]!.data.fields![0]!.value).toContain("replaces your previous companion connection");
  });

  it("offers an officer-provided link when an independent host has not configured its public URL", async () => {
    const appId = mocks.config.DISCORD_CLIENT_ID;
    mocks.config.DISCORD_CLIENT_ID = "independent";
    try {
      const reply = await characterLinkPrompt(mocks.db as never, "guild1", "member1", "server1", "fr");
      expect(reply.components).toEqual([]);
      expect(reply.embeds[0]!.data.fields![1]!.value).toContain("Demande à un officier le lien");
    } finally { mocks.config.DISCORD_CLIENT_ID = appId; }
  });

  it.each(["en", "fr"] as const)("bounds long character lists within Discord limits in %s", async (lang) => {
    mocks.db.character.findMany.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({
      name: "A".repeat(50), realm: "R".repeat(50), isMain: i === 0
    })));
    const reply = await characterLinkPrompt(mocks.db as never, "guild1", "member1", "123456789012345678", lang);
    const embed = reply.embeds[0]!.toJSON();
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
    for (const field of embed.fields!) expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(embed.description!.length + embed.fields!.reduce((sum, field) => sum + field.name.length + field.value.length, 0)).toBeLessThan(6000);
    expect(embed.description).toContain("/character list");
  });

  it("uses the same French instructions for /character pair and acknowledges before database work", async () => {
    const interaction = {
      guild: { id: "server1" }, guildId: "server1", member: {},
      options: { getSubcommand: () => "pair" }, deferReply: vi.fn(), editReply: vi.fn()
    };
    mocks.context.mockImplementation(async () => {
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      return { guildId: "guild1", memberId: "member1" };
    });
    await executeCharacter(interaction as never);
    expect(interaction.editReply.mock.calls[0]![0].embeds[0].data.title).toBe("🔗 Tes personnages WoW");
    expect(mocks.issueCode).toHaveBeenCalledWith(mocks.db, "guild1", "member1");
  });
});
