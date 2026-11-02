import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { achievementsCard } from "../services/end-cards.js";
import { scoreCardPng } from "../services/score-card.js";
import { syncMemberAchievements } from "../services/achievements.js";
import { teamLanguage } from "../services/activity-core-discord.js";
import { requireGuildContext } from "./context.js";
import { announceNewAchievements } from "../services/achievement-announce.js";

export const ACHIEVEMENT_SHARE_PREFIX = "achshare:";
const SHARE_COOLDOWN_MS = 2 * 60_000;
const lastShared = new Map<string, number>();

/** Builds the embed and card for one member. Shared by the private view and the public share. */
async function render(guildId: string, memberId: string, name: string, fr: boolean) {
  const t = (en: string, french: string) => fr ? french : en;
  const view = await syncMemberAchievements(prisma, guildId, memberId);
  const items = view.results.map(row => ({ id: row.def.id, earnedAt: row.earned ? row.earnedAt : null, value: row.value }));
  const png = await scoreCardPng(achievementsCard(name, items, fr ? "fr" : "en")).catch(() => null);
  const earned = view.results.filter(row => row.earned);
  const embed = new EmbedBuilder().setTitle(`⚜️ ${t("Achievements", "Succès")} · ${name}`.slice(0, 256))
    .setDescription((earned.length
      ? earned.sort((a, b) => b.earnedAt!.getTime() - a.earnedAt!.getTime()).slice(0, 12).map(row => `**${row.def[fr ? "fr" : "en"].name}** — ${row.def[fr ? "fr" : "en"].description} <t:${Math.floor(row.earnedAt!.getTime() / 1000)}:d>${view.newlyEarned.includes(row.def.id) ? ` ✨ ${t("new", "nouveau")}` : ""}`).join("\n")
      : t("No achievements yet. They are earned from synced characters, dungeon runs, raid attendance and your PoE2 log.", "Aucun succès pour l'instant. Ils s'obtiennent avec les personnages synchronisés, les donjons, les présences aux raids et votre journal PoE2.")).slice(0, 4000))
    .setFooter({ text: `${earned.length}/${view.results.length} · ${t("computed from recorded data, no points", "calculé à partir des données enregistrées, sans points")} · ${t("Full list", "Liste complète")}: guilded.kcaron.top/me/` });
  if (png) embed.setImage("attachment://achievements.png");
  return { embed, png, view };
}

export const achievementsCommand = new SlashCommandBuilder()
  .setName("achievements")
  .setDescription("Show your achievements card (levels, dungeon runs, raids), or another member's.")
  .addUserOption((o) => o.setName("member").setDescription("Another member (default: you)"));

export async function executeAchievements(i: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const fr = await teamLanguage(prisma, ctx.guildId);
  const t = (en: string, french: string) => fr ? french : en;
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: ctx.guildId }, select: { achievementsEnabled: true } });
  if (settings && !settings.achievementsEnabled) {
    await i.reply({ content: t("Achievements are turned off in this guild.", "Les succès sont désactivés dans cette guilde."), flags: MessageFlags.Ephemeral });
    return;
  }
  const other = i.options.getUser("member");
  const target = other && other.id !== i.user.id
    ? await prisma.member.findFirst({ where: { guildId: ctx.guildId, discordUserId: other.id, status: "ACTIVE", isTest: false }, select: { id: true, displayName: true } })
    : await prisma.member.findFirst({ where: { id: ctx.memberId }, select: { id: true, displayName: true } });
  if (!target) {
    await i.reply({ content: t("That member has no activity recorded in this guild yet.", "Ce membre n'a pas encore d'activité enregistrée dans cette guilde."), flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const { embed, png, view } = await render(ctx.guildId, target.id, target.displayName, fr);
  // Newly stored achievements may be announced when an officer opted in; never let that block this reply.
  await announceNewAchievements(prisma, ctx.guildId, target.id).catch(() => undefined);
  const share = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${ACHIEVEMENT_SHARE_PREFIX}${target.id}`).setLabel(t("Share to channel", "Partager dans le salon")).setEmoji("📣").setStyle(ButtonStyle.Primary).setDisabled(!view.results.some(row => row.earned)));
  await i.editReply({ embeds: [embed], components: [share], ...(png ? { files: [new AttachmentBuilder(png, { name: "achievements.png" })] } : {}), allowedMentions: { parse: [] } });
}

/** "Share to channel": posts the card publicly in the current channel, as the person who clicked. */
export async function handleAchievementShare(i: ButtonInteraction): Promise<void> {
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const fr = await teamLanguage(prisma, ctx.guildId);
  const t = (en: string, french: string) => fr ? french : en;
  const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
  const channel = i.channel;
  // The member must be able to post here themselves: the button is not a way around channel permissions.
  if (!channel || channel.isDMBased() || !channel.permissionsFor(i.user)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) {
    await reply(t("You cannot post in this channel.", "Vous ne pouvez pas écrire dans ce salon."));
    return;
  }
  const now = Date.now(), last = lastShared.get(i.user.id) ?? 0;
  if (now - last < SHARE_COOLDOWN_MS) {
    await reply(t(`Please wait ${Math.ceil((SHARE_COOLDOWN_MS - (now - last)) / 1000)} s before sharing again.`, `Patientez ${Math.ceil((SHARE_COOLDOWN_MS - (now - last)) / 1000)} s avant de partager à nouveau.`));
    return;
  }
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: ctx.guildId }, select: { achievementsEnabled: true } });
  const target = await prisma.member.findFirst({ where: { id: i.customId.slice(ACHIEVEMENT_SHARE_PREFIX.length), guildId: ctx.guildId, status: "ACTIVE", isTest: false }, select: { id: true, displayName: true, discordUserId: true } });
  if ((settings && !settings.achievementsEnabled) || !target) {
    await reply(t("Achievements are not available for this member.", "Les succès ne sont pas disponibles pour ce membre."));
    return;
  }
  // Another member's card is shared only when their profile is not hidden.
  if (target.discordUserId !== i.user.id) {
    const account = await prisma.webAccount.findFirst({ where: { discordUserId: target.discordUserId }, select: { publicProfile: true } });
    if (account && !account.publicProfile) { await reply(t("That member keeps their profile hidden.", "Ce membre garde son profil masqué.")); return; }
  }
  lastShared.set(i.user.id, now);
  if (lastShared.size > 500) for (const [user, at] of lastShared) if (now - at > SHARE_COOLDOWN_MS) lastShared.delete(user);
  await i.deferReply();
  const { embed, png } = await render(ctx.guildId, target.id, target.displayName, fr);
  embed.setFooter({ text: `${embed.data.footer?.text ?? ""} · ${t("shared by", "partagé par")} ${i.user.displayName}`.slice(0, 2048) });
  await i.editReply({ embeds: [embed], ...(png ? { files: [new AttachmentBuilder(png, { name: "achievements.png" })] } : {}), allowedMentions: { parse: [] } });
}
