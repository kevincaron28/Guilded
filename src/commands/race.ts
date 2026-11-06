import { ChannelType, escapeMarkdown, MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService } from "./context.js";
import { clampTop, createRaceChannel, loadRaceBoardData, MAX_TOP, MIN_TOP, nearLevel, updateRaceBoard, LEVEL_CAP } from "../services/race-board.js";

// `/character race ...` (8.5 track B1): members find levelling partners and hide their characters from the board;
// officers switch the board off or back on (it is on by default and posts once /setup has created or adopted its channel). Bilingual by the guild's language, like the board itself.
export const RACE_ACTIONS = ["near", "hide", "show", "board-on", "board-off", "top", "end", "resume"] as const;

export function addRaceSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub.setName("race").setDescription("Race to 60: who is near your level, hide yourself, officer board")
    .setDescriptionLocalizations({ fr: "Course au 60 : proches de ton niveau, te masquer, tableau officiers" })
    .addStringOption(o => o.setName("action").setDescription("What to do").setDescriptionLocalizations({ fr: "Action" }).setRequired(true)
      .addChoices(...RACE_ACTIONS.map(value => ({ name: value, value }))))
    .addChannelOption(o => o.setName("channel").setDescription("Officers: board channel (default: create race-to-60)").setDescriptionLocalizations({ fr: "Officiers : salon du tableau (défaut : course-au-60)" })
      .addChannelTypes(ChannelType.GuildText))
    .addIntegerOption(o => o.setName("count").setDescription("Officers: characters on the board (10-30)").setDescriptionLocalizations({ fr: "Officiers : personnages listés (10-30)" }).setMinValue(MIN_TOP).setMaxValue(MAX_TOP));
}

export async function executeRace(interaction: ChatInputCommandInteraction, context: { guildId: string; memberId: string }): Promise<void> {
  const settings = await guildService.getSettings(context.guildId);
  const fr = asLang(settings?.language) === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const action = interaction.options.getString("action", true);
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (action === "hide" || action === "show") {
    await prisma.member.update({ where: { id: context.memberId }, data: { raceHidden: action === "hide" } });
    if (interaction.guild) await updateRaceBoard(interaction.guild).catch(() => false);
    await reply(action === "hide" ? t("Your characters are hidden from the Race to 60 board.", "Tes personnages sont masqués du tableau de la course au 60.")
      : t("Your characters show on the Race to 60 board again.", "Tes personnages apparaissent de nouveau sur le tableau de la course au 60."));
    return;
  }
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
