import { describe, expect, it } from "vitest";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { signupLayout } from "../src/services/signup-layout.js";
import { buildSignupEmbed } from "../src/services/signup-embed.js";

describe("raid signup layout", () => {
  it.each(["en", "fr"] as const)("retains every roster section under the V2 text limit (%s)", lang => {
    const embed = new EmbedBuilder().setTitle("R".repeat(256)).setDescription("x".repeat(2000)).setFooter({ text: "Footer" });
    const headings = ["Status", "Start", "Total", "Tanks 2/2", "Healers 4/4", "DPS 14/14", "Maybe", "Waitlist", "Core", "Missing", "Bench"];
    embed.addFields(...headings.map(name => ({ name, value: "Player\n".repeat(140) })));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("raidsignup:r:TANK").setLabel("Tank").setStyle(ButtonStyle.Primary));
    const payload = signupLayout(embed, [row], lang);
    const json = payload.components[0]!.toJSON();
    const text = JSON.stringify(json);
    const body = json.components[0] as { content: string };
    expect(body.content.length).toBeLessThanOrEqual(4000);
    for (const name of headings) expect(body.content).toContain(`**${name}**`);
    expect(body.content).toContain("/raid roster");
    expect(text).toContain("raidsignup:r:TANK");
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload).not.toHaveProperty("embeds");
    expect(payload.allowedMentions.parse).toEqual([]);
  });
  it("keeps closed raid status and removes signup controls", () => {
    const embed = buildSignupEmbed({ lang: "en", raid: { id: "r", title: "Hyjal", description: null, scheduledAt: new Date(), status: "COMPLETED", tankLimit: 2, healerLimit: 4, dpsLimit: 14 }, signups: [] });
    const json = signupLayout(embed, [], "en").components[0]!.toJSON();
    expect(json.components).toHaveLength(1);
    expect(JSON.stringify(json)).toContain("Completed");
  });
});
