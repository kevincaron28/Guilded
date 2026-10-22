import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder, type EmbedBuilder } from "discord.js";

// Discord's newer message layout (Components V2): one container instead of an embed, with room
// for a link button under the text. A V2 message has no `content` or `embeds`, and all of its
// text together must stay within 4,000 characters, so the body is cut to fit.
const MAX_TEXT = 4000;

export interface V2Link { label: string; url: string }

/** The embed's title, text, fields and footer as one container (same accent colour). */
export function embedAsContainer(embed: EmbedBuilder, options: { lead?: string | undefined; link?: V2Link | undefined } = {}): ContainerBuilder {
  const data = embed.data;
  const title = data.title ? `### ${data.url ? `[${data.title}](${data.url})` : data.title}` : "";
  const fields = (data.fields ?? []).map((field) => field.name.trim() && field.name !== "​" ? `**${field.name}**\n${field.value}` : field.value);
  const footer = data.footer?.text ? `-# ${data.footer.text}` : "";
  let body = [options.lead ?? "", title, data.description ?? "", ...fields].filter(Boolean).join("\n\n");
  const room = MAX_TEXT - footer.length;
  if (body.length > room) body = `${body.slice(0, room - 1)}…`;
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(body || "​"));
  if (typeof data.color === "number") container.setAccentColor(data.color);
  if (footer) container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
  if (options.link) {
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(options.link.label).setURL(options.link.url)));
  }
  return container;
}

/** A reply payload in the V2 layout. Mentions stay off, as with the embed replies. */
export function v2Reply(embed: EmbedBuilder, options: { lead?: string | undefined; link?: V2Link | undefined } = {}) {
  return { components: [embedAsContainer(embed, options)], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}
