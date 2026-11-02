import { AttachmentBuilder, EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { achievementsCard } from "../services/end-cards.js";
import { scoreCardPng } from "../services/score-card.js";
import { syncMemberAchievements } from "../services/achievements.js";
import { teamLanguage } from "../services/activity-core-discord.js";
import { requireGuildContext } from "./context.js";

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
  await i.deferReply();
  const view = await syncMemberAchievements(prisma, ctx.guildId, target.id);
  const items = view.results.map(row => ({ id: row.def.id, earnedAt: row.earned ? row.earnedAt : null, value: row.value }));
  const png = await scoreCardPng(achievementsCard(target.displayName, items, fr ? "fr" : "en")).catch(() => null);
  const earned = view.results.filter(row => row.earned);
  const embed = new EmbedBuilder().setTitle(`⚜️ ${t("Achievements", "Succès")} · ${target.displayName}`.slice(0, 256))
    .setDescription((earned.length
      ? earned.sort((a, b) => b.earnedAt!.getTime() - a.earnedAt!.getTime()).slice(0, 12).map(row => `**${row.def[fr ? "fr" : "en"].name}** — ${row.def[fr ? "fr" : "en"].description} <t:${Math.floor(row.earnedAt!.getTime() / 1000)}:d>${view.newlyEarned.includes(row.def.id) ? ` ✨ ${t("new", "nouveau")}` : ""}`).join("\n")
      : t("No achievements yet. They are earned from synced characters, dungeon runs, raid attendance and your PoE2 log.", "Aucun succès pour l'instant. Ils s'obtiennent avec les personnages synchronisés, les donjons, les présences aux raids et votre journal PoE2.")).slice(0, 4000))
    .setFooter({ text: `${earned.length}/${view.results.length} · ${t("computed from recorded data, no points", "calculé à partir des données enregistrées, sans points")} · ${t("Full list", "Liste complète")}: guilded.kcaron.top/me/` });
  if (png) embed.setImage("attachment://achievements.png");
  await i.editReply({ embeds: [embed], ...(png ? { files: [new AttachmentBuilder(png, { name: "achievements.png" })] } : {}), allowedMentions: { parse: [] } });
}
