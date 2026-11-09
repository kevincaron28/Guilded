import { ChannelType, escapeMarkdown, MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService } from "./context.js";
import { addHallEntry, clampTop, createRaceChannel, editHallEntry, listHallEntries, loadRaceBoardData, MAX_TOP, memberNames, MIN_TOP, nearLevel, removeHallEntry, updateRaceBoard, LEVEL_CAP, type HallEditError } from "../services/race-board.js";

// `/character race ...` (8.5 track B1): members find levelling partners (everyone is on the board, there is no hide option);
// officers switch the board off or back on (it is on by default and posts once /setup has created or adopted its channel). Bilingual by the guild's language, like the board itself.
export const RACE_ACTIONS = ["near", "board-on", "board-off", "top", "end", "resume", "hall-list", "hall-add", "hall-del", "hall-edit"] as const;

/** Pure: a YYYY-MM-DD date as noon UTC (so every time zone shows the same day), or null when it is not a real date within a day of now. */
export function parseHallDate(text: string | null, now = new Date()): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((text ?? "").trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getTime() <= now.getTime() + 86_400_000 ? date : null;
}

export function addRaceSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub.setName("race").setDescription("Race to 60 and Hall of Fame")
    .setDescriptionLocalizations({ fr: "Course au 60 : proches de ton niveau, tableau officiers" })
    .addStringOption(o => o.setName("action").setDescription("What to do").setDescriptionLocalizations({ fr: "Action" }).setRequired(true)
      .addChoices(...RACE_ACTIONS.map(value => ({ name: value, value }))))
    .addChannelOption(o => o.setName("channel").setDescription("Officers: board channel").setDescriptionLocalizations({ fr: "Officiers : salon du tableau (défaut : course-au-60)" })
      .addChannelTypes(ChannelType.GuildText))
    .addIntegerOption(o => o.setName("count").setDescription("Officers: board size (10-50)").setDescriptionLocalizations({ fr: "Officiers : personnages listés (10-50)" }).setMinValue(MIN_TOP).setMaxValue(MAX_TOP))
    .addStringOption(o => o.setName("name").setDescription("Hall: name or #").setDescriptionLocalizations({ fr: "Temple : nom ou numéro" }).setMaxLength(60))
    .addStringOption(o => o.setName("new_name").setDescription("Hall: new name").setDescriptionLocalizations({ fr: "Temple : nom complet corrigé" }).setMaxLength(60))
    .addStringOption(o => o.setName("class").setDescription("Hall: class").setDescriptionLocalizations({ fr: "Temple : classe" }).setMaxLength(20))
    .addStringOption(o => o.setName("date").setDescription("Hall: YYYY-MM-DD").setDescriptionLocalizations({ fr: "Temple : jour du 60 (AAAA-MM-JJ)" }).setMaxLength(10));
}

export async function executeRace(interaction: ChatInputCommandInteraction, context: { guildId: string; memberId: string }): Promise<void> {
  const settings = await guildService.getSettings(context.guildId);
  const fr = asLang(settings?.language) === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const action = interaction.options.getString("action", true);
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (action === "near") {
    const edition = (await prisma.guild.findUnique({ where: { id: context.guildId }, select: { gameEdition: true } }))?.gameEdition ?? "forever";
    const mine = await prisma.character.findMany({ where: { memberId: context.memberId, level: { not: null } }, select: { name: true, level: true }, orderBy: { level: "desc" } });
    const top = mine[0];
    if (!top?.level) { await reply(t("None of your characters has a reported level yet.", "Aucun de tes personnages n'a encore de niveau rapporté.")); return; }
    if (top.level >= LEVEL_CAP) { await reply(t(`${escapeMarkdown(top.name)} is already level ${LEVEL_CAP}.`, `${escapeMarkdown(top.name)} est déjà niveau ${LEVEL_CAP}.`)); return; }
    const data = await loadRaceBoardData(prisma, context.guildId, edition);
    const rows = nearLevel(data.rows, top.level, new Set(mine.map(row => row.name.toLowerCase())));
    await reply(rows.length
      ? t(`Near ${escapeMarkdown(top.name)} (level ${top.level}):\n`, `Près de ${escapeMarkdown(top.name)} (niveau ${top.level}) :\n`) + rows.map(row => `• ${escapeMarkdown(row.name)} — ${row.className}, ${t("level", "niveau")} ${row.level}`).join("\n")
      : t(`Nobody else is within 3 levels of ${escapeMarkdown(top.name)} yet.`, `Personne n'est à 3 niveaux ou moins de ${escapeMarkdown(top.name)} pour le moment.`));
    return;
  }
  if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) throw new Error("Officer required / Officier requis.");
  if (action.startsWith("hall-")) { await executeHall(interaction, context, action, settings, reply); return; }
  if (action === "top") {
    const count = clampTop(interaction.options.getInteger("count") ?? undefined);
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { raceBoardTop: count } });
    if (interaction.guild) await updateRaceBoard(interaction.guild).catch(() => false);
    await reply(t(`The Race to 60 board now lists the top ${count}.`, `Le tableau de la course au 60 liste maintenant le top ${count}.`));
    return;
  }
  if (action === "end" || action === "resume") {
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { raceEnded: action === "end" } });
    if (interaction.guild) await updateRaceBoard(interaction.guild).catch(() => false);
    await reply(action === "end" ? t("The race is over: the board now shows the Hall of Fame, every level 60 in arrival order. New 60s are still added.", "La course est terminée : le tableau montre le temple de la renommée, tous les niveaux 60 par ordre d'arrivée. Les nouveaux 60 sont toujours ajoutés.")
      : t("The race is back on: the board shows the top again.", "La course reprend : le tableau montre de nouveau le top."));
    return;
  }
  if (action === "board-off") {
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { raceBoardEnabled: false } });
    await reply(t("Race to 60 board off. The existing message stays; delete it if you wish.", "Tableau de la course au 60 désactivé. Le message existant reste; supprimez-le si vous le souhaitez."));
    return;
  }
  if (action === "board-on") {
    if (!interaction.guild) throw new Error("Server only / Serveur seulement.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const picked = interaction.options.getChannel("channel");
    const made = picked || settings?.raceBoardChannelId ? null : await createRaceChannel(interaction.guild, settings?.memberRoleId ?? null, fr ? "fr" : "en").catch(() => null);
    const channelId = picked?.id ?? settings?.raceBoardChannelId ?? made?.id ?? null;
    const openNote = made?.open ? t(" It is visible to everyone because no member role is set; restrict it later.", " Il est visible par tous car aucun rôle membre n'est défini; restreignez-le plus tard.") : "";
    if (!channelId) {
      await interaction.editReply({ content: t("Pick the channel with the channel option: I could not create the race-to-60 channel (needs Manage Channels).", "Choisis le salon avec l'option channel : je n'ai pas pu créer le salon course-au-60 (il faut Gérer les salons).") });
      return;
    }
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { raceBoardEnabled: true, raceBoardChannelId: channelId, ...(picked && picked.id !== settings?.raceBoardChannelId ? { raceBoardMessageId: null } : {}) } });
    const posted = await updateRaceBoard(interaction.guild);
    await interaction.editReply({ content: t(`Race to 60 board ${posted ? "posted" : "saved; it appears on the next refresh"} in <#${channelId}>. It is edited in place, never re-posted.${openNote}`, `Tableau de la course au 60 ${posted ? "publié" : "enregistré; il apparaîtra au prochain rafraîchissement"} dans <#${channelId}>. Il est modifié sur place, jamais republié.${openNote}`), allowedMentions: { parse: [] } });
  }
}

const hallError = (error: HallEditError, fr: boolean) => ({
  "not-found": fr ? "Aucune entrée du temple ne correspond (utilise hall-list pour voir les numéros)." : "No Hall of Fame entry matches (hall-list shows the numbers).",
  ambiguous: fr ? "Plusieurs entrées correspondent : utilise le numéro." : "Several entries match: use the number.",
  exists: fr ? "Ce personnage est déjà dans le temple." : "That character is already in the Hall of Fame.",
  "bad-class": fr ? "Classe inconnue (ou manquante : indique class pour un personnage absent du tableau)." : "Unknown class (or missing: give class for a character that is not on the board).",
  "bad-date": fr ? "Date invalide : écris AAAA-MM-JJ, pas dans le futur." : "Invalid date: write YYYY-MM-DD, not in the future."
})[error];

// Officers keep the permanent Hall of Fame right (8.5 audit): list, add a missed character, remove a wrong entry, correct a detail.
async function executeHall(interaction: ChatInputCommandInteraction, context: { guildId: string }, action: string, settings: Awaited<ReturnType<typeof guildService.getSettings>>, reply: (content: string) => Promise<unknown>): Promise<void> {
  const fr = asLang(settings?.language) === "fr", lang = fr ? "fr" : "en";
  const t = (en: string, french: string) => fr ? french : en;
  if (action === "hall-list") {
    const entries = await listHallEntries(prisma, context.guildId);
    await reply(entries.length ? entries.slice(0, 40).map(entry => `**#${entry.order}** ${escapeMarkdown(entry.name)} · ${entry.className} · <t:${Math.floor(entry.reachedAt.getTime() / 1000)}:d>`).join("\n") : t("The Hall of Fame is empty.", "Le temple de la renommée est vide."));
    return;
  }
  const name = interaction.options.getString("name")?.trim();
  if (!name) { await reply(t("Give the character's name or number in the name option.", "Indique le nom ou le numéro du personnage dans l'option name.")); return; }
  const channelId = settings?.raceBoardChannelId;
  const channel = channelId && interaction.guild ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) { await reply(t("The Race to 60 channel is not set up (see board-on).", "Le salon de la course au 60 n'est pas configuré (voir board-on).")); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const say = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });
  const dateText = interaction.options.getString("date");
  const reachedAt = dateText ? parseHallDate(dateText) : null;
  if (dateText && !reachedAt) { await say(hallError("bad-date", fr)); return; }
  const edition = (await prisma.guild.findUnique({ where: { id: context.guildId }, select: { gameEdition: true } }))?.gameEdition ?? "forever";
  const data = await loadRaceBoardData(prisma, context.guildId, edition);
  const names = interaction.guild ? await memberNames(interaction.guild, [...new Set(data.rows.flatMap(row => row.discordId ? [row.discordId] : []))]) : new Map<string, string>();
  const nameOf = (id: string) => names.get(id) ?? null;
  const target = channel as unknown as Parameters<typeof addHallEntry>[1];
  const className = interaction.options.getString("class");
  if (action === "hall-add") {
    const result = await addHallEntry(prisma, target, context.guildId, { name, className, reachedAt }, data.rows, lang, nameOf);
    await say(result.ok ? t(`Added to the Hall of Fame as #${result.entry.order}: ${escapeMarkdown(result.entry.name)}.`, `Ajouté au temple sous le n° ${result.entry.order} : ${escapeMarkdown(result.entry.name)}.`) : hallError(result.error, fr));
    return;
  }
  if (action === "hall-del") {
    const result = await removeHallEntry(prisma, target, context.guildId, name, lang);
    await say(result.ok ? t(`Removed #${result.entry.order} ${escapeMarkdown(result.entry.name)}. Other numbers do not change; hall-add brings it back.`, `Retiré : n° ${result.entry.order} ${escapeMarkdown(result.entry.name)}. Les autres numéros ne changent pas; hall-add le rétablit.`) : hallError(result.error, fr));
    return;
  }
  const result = await editHallEntry(prisma, target, context.guildId, name, { newName: interaction.options.getString("new_name"), className, reachedAt }, data.rows, lang, nameOf);
  await say(result.ok ? t(`Updated #${result.entry.order} ${escapeMarkdown(result.entry.name)}.`, `Mis à jour : n° ${result.entry.order} ${escapeMarkdown(result.entry.name)}.`) : hallError(result.error, fr));
}
