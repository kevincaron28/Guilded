import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ language: "en" }));
vi.mock("../src/commands/context.js", () => ({
  guildService: { ensureGuild: async () => ({ id: "g1" }), getSettings: async () => ({ language: mocks.language }) }
}));
import { executeHelp } from "../src/commands/help.js";

// /help crashed on 28 September 2026 when a section went over Discord's 1024-character field
// limit. An administrator sees every section, so their view in each language is the largest.
describe("/help stays within Discord's embed limits", () => {
  for (const language of ["en", "fr"]) {
    it(`for an administrator in ${language}`, async () => {
      mocks.language = language;
      const reply = vi.fn();
      await executeHelp({
        guildId: "111", guild: { name: "Quebec Gold" },
        member: { permissions: { has: () => true }, roles: { cache: { some: () => false } } },
        reply
      } as never);
      const embed = (reply.mock.calls[0]![0] as { embeds: { toJSON(): { title?: string; fields?: { name: string; value: string }[]; footer?: { text: string } } }[] }).embeds[0]!.toJSON();
      const fields = embed.fields ?? [];
      expect(fields.length).toBeLessThanOrEqual(25);
      for (const field of fields) {
        expect(field.name.length).toBeLessThanOrEqual(256);
        expect(field.value.length).toBeLessThanOrEqual(1024);
      }
      const total = (embed.title ?? "").length + (embed.footer?.text ?? "").length
        + fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
      expect(total).toBeLessThanOrEqual(6000);
    });
  }
});
