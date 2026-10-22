import { describe, expect, it } from "vitest";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { embedAsContainer, v2Reply } from "../src/services/components-v2.js";

// Leaderboards use Discord's V2 layout (one container, a link button). It must keep every part
// of the embed it replaces and stay within Discord's 4,000-character limit for V2 text.
describe("embed to Components V2", () => {
  const texts = (json: { components: { type: number; content?: string; components?: { label?: string; url?: string }[] }[] }) =>
    json.components.filter((c) => c.type === 10).map((c) => c.content ?? "");

  it("keeps the title, text, fields, footer and colour, and adds the link button", () => {
    const embed = new EmbedBuilder().setTitle("Season 1").setColor(0xd4af37).setDescription("1. **Kev** · 185")
      .addFields({ name: "Records", value: "Deadmines 18:32" }, { name: "​", value: "plain line" }).setFooter({ text: "Ragefire" });
    const json = embedAsContainer(embed, { lead: "Since the weekly reset.", link: { label: "Public leaderboards", url: "https://guilded.kcaron.top/leaderboards/guild/g1?lang=en" } }).toJSON() as never;
    const [body, footer] = texts(json);
    expect(body).toBe("Since the weekly reset.\n\n### Season 1\n\n1. **Kev** · 185\n\n**Records**\nDeadmines 18:32\n\nplain line");
    expect(footer).toBe("-# Ragefire");
    expect((json as { accent_color: number }).accent_color).toBe(0xd4af37);
    expect(JSON.stringify(json)).toContain('"url":"https://guilded.kcaron.top/leaderboards/guild/g1?lang=en"');
  });

  it("cuts long text to Discord's limit and sets the V2 flag without content or embeds", () => {
    const reply = v2Reply(new EmbedBuilder().setTitle("Long").setDescription("x".repeat(4000)).addFields({ name: "More", value: "y".repeat(1000) }).setFooter({ text: "end" }));
    const total = texts(reply.components[0]!.toJSON() as never).join("").length;
    expect(total).toBeLessThanOrEqual(4000);
    expect(reply.flags).toBe(MessageFlags.IsComponentsV2);
    expect(reply).not.toHaveProperty("embeds");
    expect(reply).not.toHaveProperty("content");
  });
});
