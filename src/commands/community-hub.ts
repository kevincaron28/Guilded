import { ActionRowBuilder, ButtonBuilder, ChannelType, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, escapeMarkdown, type ButtonInteraction, type Guild, type ModalSubmitInteraction, type StringSelectMenuInteraction, type UserSelectMenuInteraction } from "discord.js";
import type { CommunitySeason } from "@prisma/client";
import { prisma } from "../database.js";
import { asLang, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService } from "./context.js";
import { accessibleCommunityActivities, accessibleCommunityPolls, accessibleCommunitySeasons, assertCommunityChannelAudience, communityAccess, resolveCommunitySeason } from "../services/community-access.js";
import { communityActivityChannel, communityDiceDay, communitySeasonLabel, communityStatusLabel, communityKindLabel } from "../services/community-display.js";
import { communityHubButton, communityHubCard, communityHubComponents, COMMUNITY_HUB_PREFIX } from "../services/community-panels.js";
import { createCommunityService } from "../services/community.js";
import { createParticipationService } from "../services/participation.js";
import { participationBadge, participationRules } from "../services/participation-rules.js";
import { eligibleParticipationMember } from "../services/participation-discord.js";
import { parseRaidTime } from "../services/raid-time.js";

const service = createCommunityService(prisma), participation = createParticipationService(prisma);
const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const noMentions = { parse: [] as [] };
type HubInteraction = ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction;

export async function validateCommunityDestination(guild: Guild, season: CommunitySeason, channelId: string, actorId: string) {
  await communityAccess(guild, actorId, season, true, channelId);
  const target = await guild.channels.fetch(channelId);
  if (!target || target.type !== ChannelType.GuildText || !guild.members.me || !target.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) throw new Error("Salon inaccessible au bot / Channel unavailable to the bot.");
  await assertCommunityChannelAudience(guild, season.channelId, channelId);
}

export async function diceReply(guildId: string, season: CommunitySeason, actor: string, timezone: string, lang: Lang, now = new Date()) {
  const { day, reset } = communityDiceDay(now, timezone);
  const prior = await prisma.communityEntry.findFirst({ where: { userId: actor, activity: { seasonId: season.id, kind: "DICE", title: day } } });
  const entry = await service.dice(guildId, season.id, actor, day, now);
  return `🎲 **${entry.evidence}/100** · **${Number(entry.evidence) >= 90 ? 15 : 5} points**\n` +
    (prior ? say(lang, "Already played today; these points were already saved.", "Déjà joué aujourd’hui; ces points sont déjà enregistrés.") : say(lang, "Today's result saved once.", "Résultat du jour enregistré une seule fois.")) +
    `\n${say(lang, "Next roll", "Prochain lancer")} : <t:${Math.floor(reset.getTime() / 1000)}:R>`;
}

export async function communityHubReply(guild: Guild, guildId: string, actor: string, season: CommunitySeason, lang: Lang) {
  const member = await communityAccess(guild, actor, season);
  const cfg = await prisma.communityParticipationConfig.findUnique({ where: { seasonId: season.id } });
  const card = communityHubCard(season, lang, season.status === "ACTIVE" && !!cfg?.enabled);
  return { embeds: card.embeds, components: communityHubComponents(season, lang, hasPermission(member, "officer")), allowedMentions: noMentions };
}

function templateModal(kind: string, seasonId: string) {
  const modal = new ModalBuilder().setCustomId(`${COMMUNITY_HUB_PREFIX}create-${kind}:${seasonId}`).setTitle({ quiz: "Quiz", gaming: "Soirée / Gaming night", challenge: "Défi / Challenge" }[kind] ?? "Activité");
  const field = (id: string, label: string, value = "", paragraph = false, limit = 200) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(true).setMaxLength(limit);
    if (value) input.setValue(value);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  };
  field("title", kind === "quiz" ? "Question" : "Titre / Title");
  if (kind === "quiz") {
    field("choices", "4 réponses, une par ligne / 4 answers", "", true, 325);
    field("correct", "Bonne réponse / Correct answer (1–4)", "1", false, 1);
    field("ends", "Fermeture / Closing time", "demain 20h", false, 80);
    field("points", "Points", "10", false, 4);
  } else if (kind === "gaming") {
    field("starts", "Début / Start", "vendredi 20h", false, 80);
    field("ends", "Fin / End", "vendredi 23h", false, 80);
    field("capacity", "Places / Capacity", "8", false, 3);
    field("points", "Points de présence / Attendance points", "10", false, 4);
  } else {
    field("instructions", "Objectif et preuve / Objective and proof", "", true, 1500);
    field("ends", "Fermeture / Closing time", "dimanche 22h", false, 80);
    field("points", "Points après validation / Reviewed points", "20", false, 4);
  }
  return modal;
}

export async function handleCommunityHub(interaction: HubInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [action, rawId, extra] = interaction.customId.slice(COMMUNITY_HUB_PREFIX.length).split(":");
  if (!action || !rawId) throw new Error("Bouton invalide / Invalid button.");
  if (interaction.isButton() && ["template-quiz", "template-gaming", "template-challenge"].includes(action)) {
    await interaction.showModal(templateModal(action.slice(9), rawId)); return;
  }
  if (interaction.isUserSelectMenu() && action === "nominee") {
    const target = interaction.values[0];
    if (!target) return;
    await interaction.showModal(new ModalBuilder().setCustomId(`${COMMUNITY_HUB_PREFIX}nominate:${rawId}:${target}`).setTitle("Remercier / Thank a member")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Coup de main / How did they help?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)))); return;
  }
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild, actor = interaction.user.id;
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const settings = await guildService.getSettings(record.id), lang = asLang(settings?.language), timezone = settings?.timezone ?? "America/Toronto";
  const page = Math.max(0, Math.min(100000, Number(extra) || 0));
  if (action === "archives") {
    const seasons = await accessibleCommunitySeasons(prisma, guild, record.id, actor);
    const pages = Math.max(1, Math.ceil(seasons.length / 10)), currentPage = Math.min(page, pages - 1), items = seasons.slice(currentPage * 10, currentPage * 10 + 10);
    const select = new StringSelectMenuBuilder().setCustomId(`${COMMUNITY_HUB_PREFIX}select:none`).setPlaceholder(say(lang, "Choose a season", "Choisir une saison"));
    items.forEach(s => select.addOptions({ label: `${communitySeasonLabel(s, lang)} · ${s.game}`.slice(0, 100), description: s.status === "ACTIVE" ? say(lang, "Active", "En cours") : say(lang, "Archived", "Archivée"), value: s.id }));
    const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(communityHubButton(`archives`, `none:${Math.max(0, currentPage - 1)}`, "←").setDisabled(currentPage === 0), communityHubButton("archives", `none:${currentPage + 1}`, "→").setDisabled(currentPage + 1 >= pages));
    await interaction.editReply({ content: items.length ? `${say(lang, "Seasons", "Saisons")} · ${currentPage + 1}/${pages}` : say(lang, "No accessible seasons yet.", "Aucune saison accessible pour le moment."), components: items.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), nav] : [], allowedMentions: noMentions }); return;
  }
  const id = interaction.isStringSelectMenu() && action === "select" ? interaction.values[0] ?? null : rawId === "none" ? null : rawId;
  const organizer = action === "templates" || action.startsWith("create-");
  const season = await resolveCommunitySeason(prisma, guild, record.id, actor, id, organizer);
  const T = (en: string, fr: string) => say(lang, en, fr);
  if (season.status !== "ACTIVE" && ["dice", "thanks", "nominate"].includes(action)) {
    await interaction.editReply({ content: T("This season is archived. Choose an active season.", "Cette saison est archivée. Choisis une saison en cours."), components: [new ActionRowBuilder<ButtonBuilder>().addComponents(communityHubButton("archives", "none", T("Choose season", "Choisir une saison")))] }); return;
  }
  if (action === "select") { await interaction.editReply(await communityHubReply(guild, record.id, actor, season, lang)); return; }
  let content = "";
  if (action === "dice") content = await diceReply(record.id, season, actor, timezone, lang);
  else if (action === "polls") {
    const polls = await accessibleCommunityPolls(prisma, guild, record.id, actor, season);
    content = `🗳️ **${T("Community polls", "Sondages communautaires")}**\n` + (polls.map(poll => `[${escapeMarkdown(poll.question.slice(0, 100))}](https://discord.com/channels/${guild.id}/${poll.channelId}/${poll.messageId})${poll.closesAt ? ` · <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>` : ""}`).join("\n\n") || T("No open polls in the activity channels. Officers can create one with /poll create.", "Aucun sondage ouvert dans les salons d’activités. Les officiers peuvent en créer avec /poll create."));
  } else if (action === "wallet" || action === "board") {
    const board = await service.board(record.id, season.id);
    if (action === "board") {
      const pages = Math.max(1, Math.ceil(board.length / 10)), currentPage = Math.min(page, pages - 1);
      content = `🏆 **${escapeMarkdown(communitySeasonLabel(season, lang))}**\n` + (board.slice(currentPage * 10, currentPage * 10 + 10).map(row => `${1 + board.filter(other => other.points > row.points).length}. <@${row.userId}> · ${row.points} pts`).join("\n") || T("No points yet.", "Aucun point pour le moment."));
      await interaction.editReply({ content: `${content}\n${currentPage + 1}/${pages}`, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(communityHubButton("board", `${season.id}:${Math.max(0, currentPage - 1)}`, "←").setDisabled(currentPage === 0), communityHubButton("board", `${season.id}:${currentPage + 1}`, "→").setDisabled(currentPage + 1 >= pages))], allowedMentions: noMentions }); return;
    }
    const mine = board.find(row => row.userId === actor);
    const history = await prisma.communityPoint.findMany({ where: { seasonId: season.id, userId: actor }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 });
    content = `📊 **${escapeMarkdown(communitySeasonLabel(season, lang))}**\n${T("Earned score", "Score gagné")} : **${mine?.points ?? 0}** · ${T("Available balance", "Solde disponible")} : **${mine?.balance ?? 0}**\n` + history.map(p => `${p.amount > 0 ? "+" : ""}${p.amount} · ${escapeMarkdown(p.reason.slice(0, 100))}`).join("\n");
    if (season.game === "DISCORD") {
      const summary = await participation.summary(record.id, season.id, actor);
      content += `\n\n🏅 ${T("Milestone", "Palier")} : ${participationBadge(mine?.points ?? 0)} (50 / 150 / 300)\n${T("Participation", "Participation")} : ${season.status === "ACTIVE" && summary.season.participation?.enabled ? T("enabled", "activée") : T("paused / unconfigured", "en pause / non configurée")}\n${T("Today", "Aujourd’hui")} : ${summary.today?.messages ?? 0}/${summary.rules.messageDailyCap} messages · ${summary.today?.reactions ?? 0}/${summary.rules.reactionDailyCap} ${T("reactions", "réactions")} · ${Math.floor((summary.today?.voiceMs ?? 0) / 60000)}/${summary.rules.voiceDailyMinutes} min\n${T("Weekly goal", "Objectif hebdomadaire")} : ${summary.participants}/${summary.rules.weeklyGoal} ${T("members", "membres")}\n${T("Helpers", "Entraide")} : ${summary.helpers.map(([user, points]) => `<@${user}> (${points} pts)`).join(", ") || "—"}`;
    }
  } else if (action === "activities" || action === "weekly") {
    const now = new Date(), cutoff = new Date(now.getTime() + 7 * 86400000);
    const rows = (await accessibleCommunityActivities(prisma, guild, record.id, actor, season.id)).filter(row => row.status === "OPEN" && row.season.status === "ACTIVE" && row.endsAt > now && (action !== "weekly" || !row.startsAt || row.startsAt < cutoff));
    const pages = Math.max(1, Math.ceil(rows.length / 5)), currentPage = Math.min(page, pages - 1);
    const items = rows.slice(currentPage * 5, currentPage * 5 + 5);
    const entries = items.length ? await prisma.communityEntry.findMany({ where: { activityId: { in: items.map(r => r.id) }, userId: actor } }) : [];
    content = `📅 **${escapeMarkdown(communitySeasonLabel(season, lang))}**\n` + (items.map(row => {
      const mine = entries.find(e => e.activityId === row.id);
      const title = escapeMarkdown(row.title.slice(0, 100));
      return `${row.messageId ? `[${title}](https://discord.com/channels/${guild.id}/${communityActivityChannel(row)}/${row.messageId})` : title} · ${communityKindLabel(row.kind, lang)}\n<t:${Math.floor((row.startsAt ?? row.endsAt).getTime() / 1000)}:F>${mine ? ` · ${communityStatusLabel(mine.status, lang)}` : ""}`;
    }).join("\n\n") || T("No activities scheduled yet. Organizers can use the templates in /community hub.", "Aucune activité prévue. Les organisateurs ont des modèles dans /community hub."));
    await interaction.editReply({ content: `${content}\n${currentPage + 1}/${pages}`, components: pages > 1 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(communityHubButton(action, `${season.id}:${Math.max(0, currentPage - 1)}`, "←").setDisabled(currentPage === 0), communityHubButton(action, `${season.id}:${currentPage + 1}`, "→").setDisabled(currentPage + 1 >= pages))] : [], allowedMentions: noMentions }); return;
  } else if (action === "thanks" || action === "nominate") {
    const cfg = await prisma.communityParticipationConfig.findUnique({ where: { seasonId: season.id } });
    if (!cfg?.enabled || season.game !== "DISCORD") { await interaction.editReply(T("Helper rewards are paused or unconfigured. An officer can enable participation.", "Les récompenses d’entraide sont en pause ou non configurées. Un officier peut activer la participation.")); return; }
    if (action === "thanks") {
      await interaction.editReply({ content: T("Who helped you? Points follow independent officer review.", "Qui t’a aidé ? Les points suivent une validation indépendante."), components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${COMMUNITY_HUB_PREFIX}nominee:${season.id}`).setPlaceholder(T("Choose a member", "Choisir un membre")).setMaxValues(1))] }); return;
    }
    if (!interaction.isModalSubmit() || !extra) throw new Error("Formulaire invalide / Invalid form.");
    const member = await communityAccess(guild, actor, season), target = await communityAccess(guild, extra, season);
    const rules = participationRules.parse(cfg.rules);
    if (![member, target].every(person => eligibleParticipationMember(person, season, rules, new Date()))) throw new Error("Membres admissibles requis / Eligible members required.");
    await participation.nominate(record.id, season.id, extra, actor, interaction.fields.getTextInputValue("reason"));
    content = T("Nomination saved for independent officer review.", "Nomination enregistrée pour validation indépendante.");
  } else if (action === "templates") {
    await interaction.editReply({ content: T("Choose a template, fill its details, then submit to publish. Polls: /poll create. Existing Discord events provide optional reminders.", "Choisis un modèle, remplis les détails, puis envoie pour publier. Sondages : /poll create. Les événements Discord offrent les rappels facultatifs."), components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      communityHubButton("template-quiz", season.id, "Quiz").setDisabled(season.game !== "DISCORD"), communityHubButton("template-gaming", season.id, T("Gaming night", "Soirée gaming")), communityHubButton("template-challenge", season.id, T("Cooperative challenge", "Défi coopératif")))] }); return;
  } else if (action.startsWith("create-") && interaction.isModalSubmit()) {
    const kind = action.slice(7);
    if (!["quiz", "gaming", "challenge"].includes(kind)) throw new Error("Modèle invalide / Invalid template.");
    await validateCommunityDestination(guild, season, season.announcementChannelId ?? season.channelId, actor);
    const value = (name: string) => interaction.fields.getTextInputValue(name).trim();
    const points = Number(value("points")), endsAt = parseRaidTime(value("ends"), timezone);
    const rules = kind === "quiz" ? { choices: value("choices").split(/\r?\n/).map(s => s.trim()), correct: Number(value("correct")) - 1, points } : kind === "gaming" ? { capacity: Number(value("capacity")), points } : { instructions: value("instructions"), points };
    const row = await service.create(record.id, season.id, { kind: kind === "quiz" ? "QUIZ" : kind === "gaming" ? "EVENT" : "CHALLENGE", title: value("title"), rules, ...(kind === "gaming" ? { startsAt: parseRaidTime(value("starts"), timezone) } : {}), endsAt, actorId: actor });
    content = `${T("Activity saved", "Activité enregistrée")} : **${escapeMarkdown(row.title)}** · <#${communityActivityChannel({ ...row, season })}>`;
  } else throw new Error("Action inconnue / Unknown action.");
  await interaction.editReply({ content: content.slice(0, 1950), allowedMentions: noMentions });
}
