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
type Lang = "en" | "fr";
const t = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;

/** The server's language: officer log lines and button labels follow it, like the rest of the officer log (22 Nov 2026 audit). */
async function serverLang(guildId: string): Promise<Lang> {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { language: true } }).catch(() => null);
  return settings?.language === "fr" ? "fr" : "en";
}
async function langOfDiscord(discordId: string | null): Promise<Lang> {
  if (!discordId) return "en";
  const guild = await prisma.guild.findFirst({ where: { discordId }, select: { id: true } }).catch(() => null);
  return guild ? serverLang(guild.id) : "en";
}

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
    const lang = await serverLang(guildId);
    const list = fresh.map((row) => `• **${row.name}**`).join("\n").slice(0, 1500);
    const text = fresh.length === 1
      ? t(lang, `**${fresh[0]!.name}** left the guild. Add to do-not-invite?`, `**${fresh[0]!.name}** a quitté la guilde. L'ajouter à la liste à ne pas réinviter?`)
      : t(lang, `${fresh.length} people left the guild. Add any of them to do-not-invite?`, `${fresh.length} personnes ont quitté la guilde. En ajouter à la liste à ne pas réinviter?`) + `\n${list}`
        + (fresh.length > shown.length ? t(lang, `\nOnly the first ${shown.length} have buttons; use /mod dni add for the others.`, `\nSeules les ${shown.length} premières ont des boutons; utilise /mod dni add pour les autres.`) : "");
    await channel.send({
      content: `${text}\n_${t(lang, "Nothing is added unless an officer clicks. Default: one year.", "Rien n'est ajouté sans le clic d'un officier. Par défaut : un an.")}_`, allowedMentions: { parse: [] },
      components: shown.map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}k:${row.id}`).setLabel(t(lang, `Kicked: add ${row.name}`, `Expulsé : ajouter ${row.name}`).slice(0, 80)).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}i:${row.id}`).setLabel(t(lang, "Left: don't add", "Parti : ne pas ajouter")).setStyle(ButtonStyle.Secondary)))
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
  const lang = await langOfDiscord(interaction.guildId);
  if (!interaction.guildId || !interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) { await say(t(lang, "Only officers can use this.", "Réservé aux officiers.")); return; }
  if (!id || !["k", "i", "u", "c", "x"].includes(action ?? "")) { await say(t(lang, "This button is out of date.", "Ce bouton n'est plus à jour.")); return; }
  if (action === "k" || action === "i") {
    const row = await prisma.guildRosterEntry.findUnique({ where: { id }, select: { name: true, guildId: true } });
    const owner = row ? await prisma.guild.findUnique({ where: { id: row.guildId }, select: { discordId: true } }) : null;
    if (!row || owner?.discordId !== interaction.guildId) { await say(t(lang, "That roster entry is no longer there.", "Cette personne n'est plus dans le registre.")); return; }
    let added: { id: string } | null = null;
    if (action === "k") {
      const listed = await service.list(row.guildId, { take: 500 });
      if (!dniMatches(listed, { names: [row.name] }).length) added = await service.add(row.guildId, { name: row.name, kind: "KICKED", expiry: "1y", reason: t(lang, "Kicked from the guild", "Expulsé de la guilde"), addedBy: interaction.user.id });
    }
    const rest = withoutRow(interaction.message, id);
    // A mis-click on "Kicked" can be undone from the same message (the Undo row takes the freed row's place).
    if (added) rest.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${DNI_PREFIX}x:${added.id}`).setLabel(t(lang, `Undo: remove ${row.name}`, `Annuler : retirer ${row.name}`).slice(0, 80)).setStyle(ButtonStyle.Secondary)));
    const line = action === "k"
      ? t(lang, `⛔ **${row.name}** added to do-not-invite for one year by <@${interaction.user.id}>.`, `⛔ **${row.name}** ajouté à la liste à ne pas réinviter pour un an par <@${interaction.user.id}>.`)
      : t(lang, `👋 **${row.name}** left: not added, can be invited again (<@${interaction.user.id}>).`, `👋 **${row.name}** est parti : pas ajouté, peut être réinvité (<@${interaction.user.id}>).`);
    await interaction.update({ components: rest, content: `${interaction.message.content}\n${line}`.slice(0, 1990) });
    return;
  }
  const entry = await prisma.doNotInvite.findUnique({ where: { id }, select: { name: true, guildId: true, status: true, guild: { select: { discordId: true } } } });
  if (!entry || entry.guild.discordId !== interaction.guildId) { await say(t(lang, "That entry is gone.", "Cette entrée n'existe plus.")); return; }
  if (action === "x") {
    if (entry.status !== "CLEARED") await service.clear(entry.guildId, id, interaction.user.id);
    await interaction.update({ components: withoutRow(interaction.message, id),
      content: `${interaction.message.content}\n${t(lang, `↩️ Undone: **${entry.name}** removed from do-not-invite by <@${interaction.user.id}>; can be invited again.`, `↩️ Annulé : **${entry.name}** retiré de la liste par <@${interaction.user.id}>; peut être réinvité.`)}`.slice(0, 1990) });
    return;
  }
  if (entry.status === "CLEARED") { await interaction.update({ components: [] }); return; }
  await service.decideAppeal(entry.guildId, id, interaction.user.id, action === "c" ? "clear" : "uphold");
  await interaction.update({ components: [], content: `${interaction.message.content}\n${action === "c" ? t(lang, "✅ Appeal granted: cleared", "✅ Appel accepté : entrée retirée") : t(lang, "⛔ Appeal declined: the entry stays", "⛔ Appel refusé : l'entrée reste")} ${t(lang, "by", "par")} <@${interaction.user.id}>.`.slice(0, 1990) });
}

/** `/character appeal`: the listed person asks the officers to review. Needs their own Discord account on an entry; nothing about the entry is shown. */
export async function executeAppeal(interaction: ChatInputCommandInteraction): Promise<void> {
  const say = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const lang = await langOfDiscord(interaction.guildId);
  if (!interaction.guild || !interaction.guildId) { await say("Use this in the guild's Discord server."); return; }
  const mine = await service.forUser(interaction.guildId, interaction.user.id);
  if (!mine.length) { await say(t(lang, "The officers have nothing recorded for this Discord account here. If you were told otherwise, ask an officer directly.", "Les officiers n'ont rien d'inscrit pour ce compte Discord ici. Si on t'a dit le contraire, écris directement à un officier.")); return; }
  const open = mine.filter((entry) => entry.status === "ACTIVE");
  if (!open.length) { await say(t(lang, "Your appeal is already with the officers. They decide; you will not be pinged here.", "Ton appel est déjà entre les mains des officiers. Ils décident; tu ne seras pas mentionné ici.")); return; }
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
      content: `📨 <@${interaction.user.id}> ${t(lang, "appeals their do-not-invite entry", "conteste son inscription sur la liste à ne pas réinviter")} **${entry.name}${entry.realm ? `-${entry.realm}` : ""}** (${entry.reason}).${message ? `\n> ${message.replace(/\n+/g, " ")}` : ""}`,
      allowedMentions: { parse: [] },
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}c:${entry.id}`).setLabel(t(lang, "Clear", "Retirer")).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${DNI_PREFIX}u:${entry.id}`).setLabel(t(lang, "Uphold", "Maintenir")).setStyle(ButtonStyle.Danger))]
    }).catch(() => undefined);
    sent++;
  }
  await say(sent ? t(lang, "Your appeal was sent to the officers. They decide, and they may contact you on Discord.", "Ton appel a été envoyé aux officiers. Ils décident et pourraient t'écrire sur Discord.")
    : t(lang, "Could not reach the officers' log. Please message an officer directly.", "Impossible de joindre le journal des officiers. Écris directement à un officier."));
}
