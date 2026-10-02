import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";
import type { Lang } from "../i18n.js";
import { communitySeasonLabel } from "./community-display.js";

export const COMMUNITY_HUB_MARKER = "Guilded · Community activities";
export const COMMUNITY_HUB_PREFIX = "community:hub-";
const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
export function communityHubButton(action: string, id: string, label: string, primary = false) {
  return new ButtonBuilder().setCustomId(`${COMMUNITY_HUB_PREFIX}${action}:${id}`).setLabel(label).setStyle(primary ? ButtonStyle.Primary : ButtonStyle.Secondary);
}
export function communityHubComponents(season: { id: string; status: string; game?: string } | null, lang: Lang, organizer = false) {
  const id = season?.id ?? "none", active = season?.status === "ACTIVE", discord = !season?.game || season.game === "DISCORD";
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    communityHubButton("dice", id, say(lang, "🎲 Roll the dice", "🎲 Lancer le dé"), true).setDisabled(!active || !discord),
    communityHubButton("activities", id, say(lang, "🎮 Current activities", "🎮 Activités en cours")).setDisabled(!season),
    communityHubButton("wallet", id, say(lang, "📊 My points", "📊 Mes points")).setDisabled(!season),
    communityHubButton("polls", id, say(lang, "🗳️ Vote in a poll", "🗳️ Voter à un sondage")).setDisabled(!active));
  const second = new ActionRowBuilder<ButtonBuilder>().addComponents(
    communityHubButton("thanks", id, say(lang, "🤝 Thank a member", "🤝 Remercier un membre")).setDisabled(!active || !discord),
    communityHubButton("board", id, say(lang, "🏆 Rankings", "🏆 Classement")).setDisabled(!season),
    communityHubButton("archives", id, say(lang, "📚 Seasons", "📚 Saisons")),
    communityHubButton("weekly", id, say(lang, "📅 This week", "📅 Cette semaine")).setDisabled(!season));
  if (organizer && active) second.addComponents(communityHubButton("templates", id, say(lang, "Organizer templates", "Modèles organisateurs")));
  return [first, second];
}
export function communityHubCard(season: { id: string; name: string; number?: number; status: string; game?: string } | null, lang: Lang, earning = false) {
  const embed = new EmbedBuilder().setColor(0xd4af37).setTitle(say(lang, "🎮 YOUR NEXT ACTIVITY", "🎮 À TOI DE JOUER"))
    .setDescription(season ? `**${escapeMarkdown(communitySeasonLabel(season, lang))}**\n${say(lang, "A game, a night with friends, a helping hand. Choose an action below.", "Un jeu, une soirée avec la gang, un coup de main. Choisis une action ci-dessous.")}` : say(lang, "The next season is coming. Browse previous seasons below.", "La prochaine saison s’en vient. Consulte les saisons précédentes ci-dessous."))
    .addFields({ name: say(lang, "🎲 Daily dice", "🎲 Dé quotidien"), value: say(lang, "One roll per day: +5 points, or +15 on 90–100. Results and personal points are private.", "Un lancer par jour : +5 points, ou +15 sur 90–100. Ton résultat et tes points sont privés.") },
      { name: say(lang, "🤝 Participation", "🤝 Participation"), value: earning ? say(lang, "Configured chat, reactions and voice can earn capped points. My points shows today's limits. Helping points require independent officer review.", "Les salons configurés rapportent des points plafonnés. Mes points affiche les limites du jour. L’entraide exige une validation indépendante.") : say(lang, "Automatic participation and helper rewards are currently paused or unconfigured. Dice and configured activities have their own rules.", "Les gains automatiques et d’entraide sont en pause ou non configurés. Les dés et les activités configurées ont leurs propres règles.") })
    .setFooter({ text: COMMUNITY_HUB_MARKER });
  return { content: "", embeds: [embed.toJSON()], components: communityHubComponents(season, lang).map(r => r.toJSON()), allowed_mentions: { parse: [] as string[] } };
}
