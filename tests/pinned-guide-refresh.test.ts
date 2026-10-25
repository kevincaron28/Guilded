import { beforeEach, describe, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
const mocks = vi.hoisted(() => ({ language: "en" }));
vi.mock("../src/commands/context.js", () => ({ guildService: { ensureGuild: async () => ({ id: "guild" }), getSettings: async () => ({ language: mocks.language }) } }));
import { ensureBotGuide, gettingStartedPost, refreshPinnedBotGuides } from "../src/services/bot-messages.js";
import { executeHelp } from "../src/commands/help.js";
import { CURRENT_VERSION } from "../src/services/version-announce.js";

beforeEach(() => { mocks.language = "en"; });
function pinned(title: string, description: string, author = "bot", footer?: string) {
  const data = { title, description, ...(footer ? { footer: { text: footer } } : {}) };
  return { author: { id: author }, editable: true, embeds: [{ ...data, toJSON: () => data }], edit: vi.fn<(body: unknown) => Promise<void>>().mockResolvedValue(undefined) };
}
const channel = (pins: ReturnType<typeof pinned>[]) => ({ client: { user: { id: "bot" } }, messages: { fetchPins: vi.fn(async () => ({ items: pins.map(message => ({ message })) })) }, send: vi.fn() });

describe("existing Discord guide maintenance", () => {
  it("updates the same pinned guide when content, version or language changes", async () => {
    const guide = pinned("⚜️ Getting started with Guilded", "Old installation instructions");
    const c = channel([guide]);
    expect(await refreshPinnedBotGuides(c as never, "fr")).toBe(1);
    const body = guide.edit.mock.calls[0]![0] as unknown as { embeds: ReturnType<typeof gettingStartedPost>[]; allowedMentions: unknown };
    expect(body.embeds[0]!.data.title).toContain("Bien commencer");
    expect(body.embeds[0]!.data.description).toContain("Sign in with Discord");
    expect(body.embeds[0]!.data.footer?.text).toContain(CURRENT_VERSION);
    expect(body.allowedMentions).toEqual({ parse: [] });
    expect(c.send).not.toHaveBeenCalled();
  });
  it("leaves current pins alone and never posts a missing guide on startup", async () => {
    const current = gettingStartedPost("en").data;
    const guide = pinned(current.title!, current.description!, "bot", current.footer!.text);
    expect(await refreshPinnedBotGuides(channel([guide]) as never, "en")).toBe(0);
    expect(guide.edit).not.toHaveBeenCalled();
    const empty = channel([]);
    expect(await refreshPinnedBotGuides(empty as never, "en")).toBe(0);
    expect(empty.send).not.toHaveBeenCalled();
  });
  it("does not trust another author's title or touch unrelated guild messages", async () => {
    const spoof = pinned("⚜️ Getting started with Guilded", "Owner's instructions", "member");
    const unrelated = pinned("Raid schedule", "Keep this exact date");
    const customized = pinned("⚜️ Getting started with Guilded", "Custom multi-embed guide");
    customized.embeds.push(unrelated.embeds[0]!);
    expect(await refreshPinnedBotGuides(channel([spoof, unrelated, customized]) as never, "en")).toBe(0);
    expect(spoof.edit).not.toHaveBeenCalled(); expect(unrelated.edit).not.toHaveBeenCalled();
    expect(customized.edit).not.toHaveBeenCalled();
  });
  it("updates only the version of a legacy custom overview and preserves raid dates", async () => {
    const old = "**Version actuelle : 6.1.2 Release**\n\n**Raids**\n9 décembre à 20 h";
    const guide = pinned("Guilded — les outils de la gang", old, "bot", "Guilded · Informations actuelles");
    await refreshPinnedBotGuides(channel([guide]) as never, "fr");
    const body = guide.edit.mock.calls[0]![0] as unknown as { embeds: ReturnType<typeof gettingStartedPost>[] };
    expect(body.embeds[0]!.data.description).toBe(old.replace("6.1.2", CURRENT_VERSION));
  });
  it("does not create a duplicate when pins cannot be read", async () => {
    const c = channel([]); c.messages.fetchPins.mockRejectedValue(new Error("Missing access"));
    await expect(ensureBotGuide(c as never, "en")).rejects.toThrow("Missing access");
    expect(c.send).not.toHaveBeenCalled();
  });
  it.each(["en", "fr"])("keeps full officer help within Discord limits in %s", async lang => {
    mocks.language = lang;
    const reply = vi.fn();
    await executeHelp({ guildId: "discord", guild: { id: "discord", name: "Guild" }, member: { permissions: { has: () => true }, roles: { cache: new Collection() } }, reply } as never);
    const embed = reply.mock.calls[0]![0].embeds[0].toJSON();
    const fields = embed.fields as { name: string; value: string }[];
    expect(fields.every(field => field.value.length <= 1024)).toBe(true);
    expect((embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields.reduce((n, f) => n + f.name.length + f.value.length, 0)).toBeLessThanOrEqual(6000);
    expect(JSON.stringify(embed)).toContain("/wow use");
  });
});
