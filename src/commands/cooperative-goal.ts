import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { cooperativeGoalStatus, saveCooperativeGoal } from "../services/cooperative-goal.js";
import type { Lang } from "../i18n.js";

export async function executeCooperativeGoal(interaction: ChatInputCommandInteraction, guildId: string, lang: Lang) {
  const fr = lang === "fr", target = interaction.options.getInteger("goal"), pause = interaction.options.getBoolean("pause");
  const seasonId = interaction.options.getString("season"), metric = interaction.options.getString("goal-kind");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (target !== null || pause !== null || seasonId !== null || metric !== null) {
    const member = await interaction.guild!.members.fetch(interaction.user.id);
    if (!hasPermission(member as GuildMember, "officer")) throw new Error(fr ? "Seuls les officiers configurent l’objectif." : "Only officers can configure the goal.");
    if (pause !== null && (target !== null || seasonId !== null || metric !== null)) throw new Error(fr ? "Séparez pause et configuration." : "Use pause separately from configuration.");
    if (pause !== null) await prisma.cooperativeGoal.updateMany({ where: { guildId }, data: { paused: pause } });
    else {
      if (target === null || !seasonId) throw new Error(fr ? "Choisissez goal et season ensemble." : "Choose goal and season together.");
      await saveCooperativeGoal(prisma, guildId, interaction.user.id, { target, seasonId, metric: metric ?? "dungeons" });
    }
  }
  const result = await cooperativeGoalStatus(prisma, guildId);
  let text: string;
  if (result.status === "unconfigured") text = fr ? "Aucun objectif. Un officier peut choisir goal et season ici." : "No goal configured. An officer can choose goal and season here.";
  else if (result.status === "paused") text = fr ? "Objectif en pause." : "Goal paused.";
  else if (result.status === "scope-changed") text = fr ? "Édition, saison ou règles modifiées : nouvelle configuration requise." : "Edition, season or rules changed: an officer must configure the goal again.";
  else if (result.status === "too-many-runs") text = fr ? "Trop de parcours pour un total complet." : "Too many runs for a complete total.";
  else {
    const unit = result.goal.metric === "runs" ? fr ? "parcours" : "runs" : fr ? "donjons différents" : "different dungeons";
    text = `${result.complete ? "🏅 " : ""}${result.value}/${result.goal.target} ${unit} · ${result.progress.participants} ${fr ? "membres" : "members"}\n`
      + `${result.goal.edition} · <t:${Math.floor(result.goal.startsAt.getTime() / 1000)}:d> – <t:${Math.floor(result.goal.endsAt.getTime() / 1000)}:d>\n`
      + (fr ? "Au moins deux membres admissibles par parcours. Les corrections peuvent modifier ce bilan." : "At least two eligible members per run. Corrections can change this progress.")
      + (result.ended ? fr ? "\nPériode terminée." : "\nPeriod ended." : "");
  }
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57a773).setTitle(fr ? "Jouer ensemble" : "Playing together")
    .setDescription(text).setFooter({ text: fr ? "Reconnaissance visuelle seulement · Aucun point ni changement de cote" : "Cosmetic recognition only · No points or rating changes" })], allowedMentions: { parse: [] } });
}
