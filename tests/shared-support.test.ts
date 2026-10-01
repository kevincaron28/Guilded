import { ChannelType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  settings: { answerChannelId: "faq", language: "fr", aiAnswers: true, timezone: "America/Toronto" },
  faq: vi.fn(async () => []), member: vi.fn(), privateFacts: vi.fn(), schedule: vi.fn(),
  ai: vi.fn<(settings: unknown, messages: unknown[]) => Promise<{ answer: string }>>(async () => ({ answer: "Utilise /help pour commencer." }))
}));
vi.mock("../src/database.js", () => ({ prisma: { faqEntry: { findMany: mocks.faq }, member: { findFirst: mocks.member } } }));
vi.mock("../src/commands/context.js", () => ({
  guildService: { ensureGuild: async () => ({ id: "record" }), getSettings: async () => mocks.settings },
  requireGuildContext: vi.fn()
}));
vi.mock("../src/config.js", () => ({ config: { AI_BASE_URL: "https://example.invalid", AI_MODEL: "test", AI_DAILY_LIMIT: 100 } }));
vi.mock("../src/commands/craft-board.js", () => ({ guideText: () => "Craft guide" }));
vi.mock("../src/services/answers.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/services/answers.js")>(),
  askAi: mocks.ai, guildFacts: mocks.privateFacts, scheduleAnswer: mocks.schedule
}));
import { answerMessage, forgetAnswerSettings } from "../src/commands/faq.js";
import { installationAnswer, looksLikeInstallationQuestion } from "../src/services/answers.js";
import { gettingStartedPost } from "../src/services/bot-messages.js";

function message(content: string, user: string, parent: { name: string } | null = { name: "⚜️ Guilded" }) {
  return {
    author: { id: user, bot: false }, system: false, inGuild: () => true, content, channelId: "faq",
    guild: { id: "discord", name: "Quebec Gold", channels: { fetch: vi.fn(async () => null) } },
    channel: { type: ChannelType.GuildText, parent, parentId: parent ? "category" : null, sendTyping: vi.fn(async () => undefined) },
    client: { user: { id: "bot" } }, mentions: { users: { has: () => false } }, reply: vi.fn(async () => undefined)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetAnswerSettings("discord");
});

describe("shared Guilded support", () => {
  it("answers addon installation without AI or a personal record", async () => {
    const question = message("Comment installer l'addon Guilded ?", "install");
    await answerMessage(question as never, "Product help");
    expect(question.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Interface\\AddOns\\Guilded\\Guilded.toc") }));
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("does not read hidden raids or personal records for a question in shared support", async () => {
    const question = message("Quand est le prochain raid et combien j'ai de EP ?", "public");
    await answerMessage(question as never, "Product help");
    expect(mocks.ai).toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.privateFacts).not.toHaveBeenCalled();
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.ai.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("shared bot-support channel") })]));
  });
  it("does not select private facts when the parent cannot be resolved", async () => {
    await answerMessage(message("Quels sont les raids prévus ?", "unknown-parent", null) as never, "Product help");
    expect(mocks.privateFacts).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("keeps both language guides and complete installation replies within Discord limits", () => {
    for (const lang of ["en", "fr"] as const) {
      expect(gettingStartedPost(lang).data.description!.length).toBeLessThanOrEqual(4096);
      const answer = installationAnswer(lang);
      expect(answer.length).toBeLessThan(1500);
      expect(answer).toContain("/character pair");
      expect(answer).toContain("/reload");
      expect(looksLikeInstallationQuestion(lang === "fr" ? "Comment connecter le compagnon ?" : "How do I install the addon?")).toBe(true);
    }
  });
});
