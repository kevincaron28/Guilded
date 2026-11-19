import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember, type Message } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createDoNotInviteService, dniMatches } from "./do-not-invite.js";

// 9.4 T10: the officer log asks "Add to do-not-invite?" when someone leaves the in-game guild (never
// automatic), and a listed person can appeal; officers uphold or clear from buttons in the log.
export const DNI_PREFIX = "dni:";
const service = createDoNotInviteService(prisma);
const MAX_ROWS = 5;      // Discord allows five rows of buttons; each departure takes one row
const MAX_DEPARTURES = 25; // more at once is a roster reset or a mass clean-up, not a person leaving

async function officerLog(discordGuild: DiscordGuild, guildId: string) {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { logChannelId: true } });
  if (!settings?.logChannelId) return null;
  const channel = await discordGuild.channels.fetch(settings.logChannelId).catch(() => null);
  return channel?.isTextBased() && "send" in channel ? channel : null;
}

/** One message per roster sync, however many people left. Never throws (a prompt must not break a roster upload). */
export async function promptDepartures(discordGuild: DiscordGuild | undefined | null, guildId: string, left: { id: string; name: string }[]): Promise<void> {
  if (!discordGuild || !left.length || left.length > MAX_DEPARTURES) return;
  try {
    const listed = await service.list(guildId, { take: 500 });
    const fresh = left.filter((row) => !dniMatches(listed, { names: [row.name] }).length);
    if (!fresh.length) return;
    const channel = await officerLog(discordGuild, guildId);
    if (!channel) return;
    const shown = fresh.slice(0, MAX_ROWS);
    const text = fresh.length === 1 ? `**${fresh[0]!.name}** left the guild. Add to do-not-invite?`
      : `${fresh.length} people left the guild. Add any of them to do-not-invite?\n${fresh.map((row) => `• **${row.name}**`).join("\n").slice(0, 1500)}`
        + (fresh.length > shown.length ? `\nOnly the first ${shown.length} have buttons; use /mod dni add for the others.` : "");
    await channel.send({
      content: `${text}\n_Nothing is added unless an officer clicks. Default: one year._`, allowedMentions: { parse: [] },
      components: shown.map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}k:${row.id}`).setLabel(`Kicked: add ${row.name}`.slice(0, 80)).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}i:${row.id}`).setLabel(`Left: ignore`).setStyle(ButtonStyle.Secondary)))
    });
  } catch (error) {
    console.error("Do-not-invite departure prompt failed", error);
  }
}

function withoutRow(message: Message, rowKey: string) {
  return message.components
    .filter((row) => !("components" in row && row.components.some((component) => "customId" in component && typeof component.customId === "string" && component.customId.endsWith(`:${rowKey}`))))
    .map((row) => ActionRowBuilder.from(row as never) as unknown as ActionRowBuilder<ButtonBuilder>);
}

/** Buttons in the officer log. Officer-only; every click is checked again here. */
export async function handleDniButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, id] = interaction.customId.split(":");
  const say = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.guildId || !interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) { await say("Only officers can use this."); return; }
  if (!id || !["k", "i", "u", "c"].includes(action ?? "")) { await say("This button is out of date."); return; }
  if (action === "k" || action === "i") {
    const row = await prisma.guildRosterEntry.findUnique({ where: { id }, select: { name: true, guildId: true } });
    const owner = row ? await prisma.guild.findUnique({ where: { id: row.guildId }, select: { discordId: true } }) : null;
    if (!row || owner?.discordId !== interaction.guildId) { await say("That roster entry is no longer there."); return; }
    if (action === "k") {
      const listed = await service.list(row.guildId, { take: 500 });
      if (!dniMatches(listed, { names: [row.name] }).length) await service.add(row.guildId, { name: row.name, kind: "KICKED", expiry: "1y", reason: "Kicked from the guild", addedBy: interaction.user.id });
    }
    const rest = withoutRow(interaction.message, id);
    await interaction.update({ components: rest, content: `${interaction.message.content}\n${action === "k" ? `✅ **${row.name}** added by <@${interaction.user.id}> (one year).` : `Ignored: **${row.name}** (<@${interaction.user.id}>).`}`.slice(0, 1990) });
    return;
  }
  const entry = await prisma.doNotInvite.findUnique({ where: { id }, select: { name: true, guildId: true, status: true, guild: { select: { discordId: true } } } });
  if (!entry || entry.guild.discordId !== interaction.guildId) { await say("That entry is gone."); return; }
  if (entry.status === "CLEARED") { await interaction.update({ components: [] }); return; }
  await service.decideAppeal(entry.guildId, id, interaction.user.id, action === "c" ? "clear" : "uphold");
  await interaction.update({ components: [], content: `${interaction.message.content}\n${action === "c" ? "✅ Appeal granted: cleared" : "⛔ Appeal declined: the entry stays"} by <@${interaction.user.id}>.`.slice(0, 1990) });
}

/** `/character appeal`: the listed person asks the officers to review. Needs their own Discord account on an entry; nothing about the entry is shown. */
export async function executeAppeal(interaction: ChatInputCommandInteraction): Promise<void> {
  const say = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.guild || !interaction.guildId) { await say("Use this in the guild's Discord server."); return; }
  const mine = await service.forUser(interaction.guildId, interaction.user.id);
  if (!mine.length) { await say("The officers have nothing recorded for this Discord account here. If you were told otherwise, ask an officer directly."); return; }
  const open = mine.filter((entry) => entry.status === "ACTIVE");
  if (!open.length) { await say("Your appeal is already with the officers. They decide; you will not be pinged here."); return; }
  const message = (interaction.options.getString("message") ?? "").trim().slice(0, 500);
  const seen = new Set<string>();
  let sent = 0;
  for (const entry of open.slice(0, 3)) {
    const group = entry.aliasGroup ?? entry.id;
    if (seen.has(group)) continue;
    seen.add(group);
    const channel = await officerLog(interaction.guild as DiscordGuild, entry.guildId);
    if (!channel) continue;
    if (!await service.setAppealed(entry.guildId, entry.id, interaction.user.id)) continue;
    await channel.send({
      content: `📨 <@${interaction.user.id}> appeals their do-not-invite entry **${entry.name}${entry.realm ? `-${entry.realm}` : ""}** (${entry.reason}).${message ? `\n> ${message.replace(/\n+/g, " ")}` : ""}`,
      allowedMentions: { parse: [] },
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}c:${entry.id}`).setLabel("Clear").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}u:${entry.id}`).setLabel("Uphold").setStyle(ButtonStyle.Danger))]
    }).catch(() => undefined);
    sent++;
  }
  await say(sent ? "Your appeal was sent to the officers. They decide, and they may contact you on Discord." : "Could not reach the officers' log. Please message an officer directly.");
}
