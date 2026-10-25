import { ContainerBuilder, MessageFlags, TextDisplayBuilder, type ActionRowBuilder, type ButtonBuilder, type EmbedBuilder } from "discord.js";
import type { Lang } from "../i18n.js";

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

// Keep every role/count and waitlist/core heading. A long roster must not cut
// off the final fields, as a simple truncation of the whole embed would do.
export function signupLayout(embed: EmbedBuilder, buttons: ActionRowBuilder<ButtonBuilder>[], lang: Lang) {
  const data = embed.data;
  const title = `### ${clip(data.title ?? "Guilded", 256)}`;
  const description = clip(data.description ?? "", 400);
  const footer = `-# ${clip(data.footer?.text ?? "", 250)}\n${lang === "fr" ? "Liste complète : /raid roster" : "Full roster: /raid roster"}`;
  const fields = data.fields ?? [];
  const headings = fields.map(field => `**${clip(field.name, 180)}**`);
  const overhead = [title, description, footer, ...headings].join("\n\n").length + fields.length * 3;
  const budget = Math.max(1, Math.floor((4000 - overhead) / Math.max(1, fields.length)));
  const body = [title, description, ...fields.map((field, index) => `${headings[index]}\n${clip(field.value, budget)}`), footer].filter(Boolean).join("\n\n");
  const container = new ContainerBuilder().setAccentColor(data.color ?? 0xd4af37)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  if (buttons.length) container.addActionRowComponents(...buttons);
  return { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}
