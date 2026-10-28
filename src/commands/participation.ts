import { COMMUNITY_MILESTONE_LABEL } from "../services/community-badge-rules.js";
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { config } from "../config.js";
import { asLang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { canAccessCommunity } from "./community.js";
import { createParticipationService } from "../services/participation.js";
import { eligibleParticipationMember } from "../services/participation-discord.js";
import { canViewParticipationChannel, participationChannelCoverage, supportsParticipationMessages } from "../services/participation-channels.js";
import { HELPER_POINTS, HELPER_WEEKLY_POINTS, participationBadge, participationRules } from "../services/participation-rules.js";
import { resolveCommunitySeason } from "../services/community-access.js";
import { communitySeasonLabel } from "../services/community-display.js";

const service = createParticipationService(prisma);
const seasonOption = (sub: SlashCommandSubcommandBuilder, required = true) => sub.addStringOption(o => o.setName("season").setDescription("Discord season").setDescriptionLocalizations({ fr: "Saison Discord" }).setRequired(required).setAutocomplete(true));
const idOption = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("id").setDescription("Record ID").setDescriptionLocalizations({ fr: "Identifiant" }).setRequired(true));
const reasonOption = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("reason").setDescription("Reason").setDescriptionLocalizations({ fr: "Motif" }).setRequired(true).setMaxLength(300));
const limits = [["messages", "messageDailyCap", 0, 50], ["reactions", "reactionDailyCap", 0, 20], ["voice-minutes", "voiceDailyMinutes", 0, 240], ["member-days", "minimumMemberDays", 0, 30], ["weekly-goal", "weeklyGoal", 2, 500], ["voice-points", "voiceBlockPoints", 1, 4]] as const;
const officerCommands = ["settings", "channels", "claims", "review", "reverse"];
export const participationCommand = new SlashCommandBuilder().setName("participation").setDescription("Discord participation and helper recognition").setDescriptionLocalizations({ fr: "Participation Discord et entraide" })
  .addSubcommand(sub => {
    const settings = seasonOption(sub.setName("settings").setDescription("Officer settings").setDescriptionLocalizations({ fr: "Réglages officiers" }))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable earning").setDescriptionLocalizations({ fr: "Activer les gains" }))
      .addChannelOption(o => o.setName("channel").setDescription("Add an eligible channel").setDescriptionLocalizations({ fr: "Ajouter un salon admissible" }).addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
      .addBooleanOption(o => o.setName("remove").setDescription("Remove this channel").setDescriptionLocalizations({ fr: "Retirer ce salon" }))
      .addBooleanOption(o => o.setName("all-voice").setDescription("Count every voice channel").setDescriptionLocalizations({ fr: "Compter tous les salons vocaux" }))
      .addBooleanOption(o => o.setName("all-text").setDescription("Count messages in all accessible channels and threads").setDescriptionLocalizations({ fr: "Compter les messages de tous les salons et fils accessibles" }));
    const descriptions = ["Daily message points cap", "Daily reaction points cap", "Daily voice minutes; maximum 240", "Minimum days in server", "Distinct weekly participants goal", "Points per 15 voice minutes"];
    const french = ["Plafond quotidien de messages", "Plafond quotidien de réactions", "Minutes vocales par jour, maximum 240", "Ancienneté minimale sur le serveur", "Objectif hebdomadaire de membres", "Points par tranche de 15 minutes vocales"];
    limits.forEach(([name, , min, max], index) => settings.addIntegerOption(o => o.setName(name).setDescription(descriptions[index]!).setDescriptionLocalizations({ fr: french[index]! }).setMinValue(min).setMaxValue(max)));
    return settings.addStringOption(o => o.setName("emojis").setDescription("Positive emojis or custom IDs, comma-separated").setDescriptionLocalizations({ fr: "Emojis positifs ou identifiants, séparés par virgules" }).setMaxLength(300));
  })
  .addSubcommand(sub => seasonOption(sub.setName("status").setDescription("Your progress and guild goal").setDescriptionLocalizations({ fr: "Vos progrès et objectif de guilde" }), false))
  .addSubcommand(sub => seasonOption(sub.setName("channels").setDescription("Officer: message earning coverage").setDescriptionLocalizations({ fr: "Officiers : couverture des gains de messages" }), false)
    .addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => reasonOption(seasonOption(sub.setName("nominate").setDescription("Recognize a helper").setDescriptionLocalizations({ fr: "Reconnaître l'entraide" }))
    .addUserOption(o => o.setName("player").setDescription("Helpful member").setDescriptionLocalizations({ fr: "Membre à remercier" }).setRequired(true))))
  .addSubcommand(sub => seasonOption(sub.setName("claims").setDescription("Officer nomination inbox").setDescriptionLocalizations({ fr: "Nominations à valider" })).addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => reasonOption(idOption(seasonOption(sub.setName("review").setDescription("Approve or reject a nomination").setDescriptionLocalizations({ fr: "Valider ou refuser une nomination" }))))
    .addStringOption(o => o.setName("decision").setDescription("Decision").setDescriptionLocalizations({ fr: "Décision" }).setRequired(true).addChoices({ name: "Approve / Valider", value: "APPROVE" }, { name: "Reject / Refuser", value: "REJECT" })))
  .addSubcommand(sub => seasonOption(sub.setName("history").setDescription("Award history and IDs").setDescriptionLocalizations({ fr: "Historique et identifiants des gains" }))
    .addUserOption(o => o.setName("player").setDescription("Officers: another member").setDescriptionLocalizations({ fr: "Officiers : un autre membre" })).addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => reasonOption(idOption(seasonOption(sub.setName("reverse").setDescription("Officer: reverse an award").setDescriptionLocalizations({ fr: "Officiers : annuler un gain" })))));

export async function executeParticipation(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Serveur requis / Server required.", flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const guild = interaction.guild, actor = interaction.user.id, sub = interaction.options.getSubcommand();
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);
  const T = (en: string, fr: string) => lang === "fr" ? fr : en;
  const seasonId = (await resolveCommunitySeason(prisma, guild, context.guildId, actor, interaction.options.getString("season"), officerCommands.includes(sub))).id;
  const season = await prisma.communitySeason.findFirst({ where: { id: seasonId, guildId: context.guildId, game: "DISCORD" }, include: { participation: true } });
  if (!season) throw new Error("Saison Discord introuvable / Discord season not found.");
  const member = await guild.members.fetch({ user: actor, force: true });
  const channel = await guild.channels.fetch(season.channelId);
  if (!canAccessCommunity(member, season, !!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))) throw new Error("Accès refusé / Access denied.");
  const officer = hasPermission(member, "officer");
  if (officerCommands.includes(sub) && !officer) throw new Error("Officiers seulement / Officers only.");
  const rules = participationRules.parse(season.participation?.rules ?? {});
  let content = "";
  if (sub === "settings") {
    const selected = interaction.options.getChannel("channel"), remove = interaction.options.getBoolean("remove") ?? false;
    if (remove && !selected) throw new Error("Choisis un salon / Select a channel.");
    if (selected) {
      const target = await guild.channels.fetch(selected.id);
      if (!target || !supportsParticipationMessages(target.type) || target.id === guild.afkChannelId) throw new Error("Salon de messages ou vocal hors AFK requis / Non-AFK message or voice channel required.");
      if (!remove && (!await canViewParticipationChannel(target, member) || !guild.members.me || !await canViewParticipationChannel(target, guild.members.me))) throw new Error("Salon inaccessible / Inaccessible channel.");
      const key = target.type === ChannelType.GuildVoice ? "voiceChannels" : "textChannels";
      rules[key] = remove ? rules[key].filter(id => id !== target.id) : [...new Set([...rules[key], target.id])];
    }
    for (const [option, key] of limits) { const value = interaction.options.getInteger(option); if (value !== null) rules[key] = value; }
    const emojis = interaction.options.getString("emojis");
    if (emojis !== null) rules.emojis = emojis.split(",").map(value => value.trim().replace(/^<a?:\w+:(\d+)>$/, "$1")).filter(Boolean);
    const enabled = interaction.options.getBoolean("enabled") ?? season.participation?.enabled ?? false;
    const allVoice = interaction.options.getBoolean("all-voice"), allText = interaction.options.getBoolean("all-text");
    if (allVoice !== null) rules.allVoice = allVoice;
    if (allText !== null) rules.allText = allText;
    if (selected || remove || emojis !== null || allVoice !== null || allText !== null || interaction.options.getBoolean("enabled") !== null || limits.some(([option]) => interaction.options.getInteger(option) !== null)) await service.configure(context.guildId, seasonId, enabled, rules);
    content = `${T("Earning", "Gains")} : ${enabled ? T("enabled", "activés") : T("paused", "en pause")}\n` +
      `${T("Message channels", "Salons de messages")} : ${rules.allText ? T("all accessible channels and threads (including forum posts and voice chat text)", "tous les salons et fils accessibles (publications de forum et messages du vocal inclus)") : rules.textChannels.map(id => `<#${id}>`).join(", ") || "—"}\n${T("Voice channels", "Salons vocaux")} : ${rules.allVoice ? T("all voice channels (except AFK)", "tous les salons vocaux (sauf AFK)") : rules.voiceChannels.map(id => `<#${id}>`).join(", ") || "—"}\n` +
      `${T("Daily caps", "Plafonds quotidiens")} : ${rules.messageDailyCap} ${T("message points", "points de messages")} · ${rules.reactionDailyCap} ${T("reaction points", "points de réactions")} · ${rules.voiceDailyMinutes} min ${T("voice", "vocal")}\n` +
      T(`1 message point / 5 min; ${rules.voiceBlockPoints} voice points / 15 min; 2 eligible humans together. Muted listeners count; deafened/AFK do not.`, `1 point de message / 5 min; ${rules.voiceBlockPoints} points vocaux / 15 min; 2 humains admissibles ensemble. Les personnes muettes comptent; pas les personnes assourdies/AFK.`) +
      `\n${T("Positive emojis", "Emojis positifs")} : ${rules.emojis.join(" ") || "—"}\n` +
      T(`Account age: 7 days. Server membership: ${rules.minimumMemberDays} days. Weekly goal: ${rules.weeklyGoal} members. Helpers: ${HELPER_POINTS} points, max ${HELPER_WEEKLY_POINTS}/week after independent review.`, `Comptes : 7 jours. Présence sur le serveur : ${rules.minimumMemberDays} jours. Objectif : ${rules.weeklyGoal} membres/semaine. Entraide : ${HELPER_POINTS} points, max ${HELPER_WEEKLY_POINTS}/semaine après validation indépendante.`) +
      `\n${config.MESSAGE_CONTENT_INTENT ? T("Duplicate/short-text filtering enabled.", "Filtrage des textes courts/répétés activé.") : T("Text access is off: timing and caps apply; repeated text cannot be detected.", "Accès au texte désactivé : délais et plafonds actifs; les textes répétés ne peuvent pas être détectés.")}`;
  } else if (sub === "channels") {
    const earning = season.status === "ACTIVE" && !!season.participation?.enabled;
    const rows = await participationChannelCoverage(guild, member, rules, earning);
    const page = interaction.options.getInteger("page") ?? 1, pages = Math.max(1, Math.ceil(rows.length / 20));
    if (page > pages) throw new Error(T(`Choose a page from 1 to ${pages}.`, `Choisissez une page de 1 à ${pages}.`));
    const labels = { enabled: T("eligible", "admissible"), unavailable: T("bot cannot access", "inaccessible au bot"),
      excluded: T("excluded by settings", "exclu par les réglages"), paused: T("earning paused", "gains en pause") };
    content = `**${T("Message earning coverage", "Couverture des gains de messages")} · ${communitySeasonLabel(season, lang)}**\n` +
      `${T("Earning", "Gains")} : ${earning ? T("enabled", "activés") : T("paused", "en pause")} · ${rules.messageDailyCap} ${T("message points/day", "points de messages/jour")} · ${rules.reactionDailyCap} ${T("reaction points/day", "points de réactions/jour")}\n` +
      rows.slice((page - 1) * 20, page * 20).map(row => `<#${row.id}> — ${labels[row.state]}${row.posts ? T(" (posts)", " (publications)") : ""}${row.history ? "" : T("; reaction history unavailable", "; historique des réactions inaccessible")}`).join("\n") +
      `\nPage ${page}/${pages}\n` + T("Only channels you can view are listed. All-channel mode includes accessible public/private threads and forum/media posts. Private threads require existing membership or moderation access; the bot never joins automatically. Restricted lists match exact channel IDs, not future child threads.", "Seuls les salons que vous pouvez voir sont listés. Le mode tous salons inclut les fils publics/privés accessibles et les publications de forum/média. Les fils privés exigent un accès existant ou de modération; le bot ne les rejoint pas automatiquement. Les listes restreintes visent les identifiants exacts, pas les futurs fils.") +
      `\n` + T(`1 message point per 5 minutes across all channels; daily caps, season audience, 7-day account age and ${rules.minimumMemberDays}-day membership still apply. Bots, webhooks and system messages do not earn. Use /participation status for your progress.`, `1 point de message par 5 minutes, tous salons confondus; plafonds, audience de saison, compte de 7 jours et présence de ${rules.minimumMemberDays} jours restent requis. Les bots, webhooks et messages système ne rapportent rien. /participation status affiche vos progrès.`) +
      `\n${config.MESSAGE_CONTENT_INTENT ? T("Short/duplicate message filtering is enabled.", "Le filtrage des messages courts/répétés est activé.") : T("Message text access is off; timing and caps still apply.", "L’accès au texte est désactivé; délais et plafonds restent actifs.")}`;
  } else if (sub === "status") {
    const summary = await service.summary(context.guildId, seasonId, actor);
    content = `🏅 **${communitySeasonLabel(season, lang)}** · ${season.status}\n${T("Earning", "Gains")} : ${season.status === "ACTIVE" && season.participation?.enabled ? T("enabled", "activés") : T("paused", "en pause")}\n` +
      `${T("Today", "Aujourd'hui")} : ${summary.today?.messages ?? 0}/${rules.messageDailyCap} ${T("message points", "points de messages")} · ${summary.today?.reactions ?? 0}/${rules.reactionDailyCap} ${T("reaction points", "points de réactions")}\n` +
      `${T("Voice", "Vocal")} : ${Math.floor((summary.today?.voiceMs ?? 0) / 60_000)}/${rules.voiceDailyMinutes} min · ${summary.today?.voicePoints ?? 0} points · ${rules.voiceBlockPoints} pts / 15 min\n` +
      `${T("Season score", "Score de saison")} : ${summary.points} · ${T("Milestone", "Palier")} : ${participationBadge(summary.points)} (${COMMUNITY_MILESTONE_LABEL})\n` +
      `${T("Weekly guild goal", "Objectif hebdomadaire de guilde")} : ${summary.participants}/${rules.weeklyGoal} ${T("different members", "membres différents")} ${summary.participants >= rules.weeklyGoal ? "🎉" : ""}\n` +
      `${T("Weekly helpers", "Entraide de la semaine")} : ${summary.helpers.map(([id, points]) => `<@${id}> (${points})`).join(", ") || "—"}\n` +
      T("Voice measures shared connected time, not proof of speaking. Use /community wallet and leaderboard for this season. Badges grant no permissions.", "Le vocal mesure le temps connecté ensemble, sans prouver une conversation. /community wallet et leaderboard affichent cette saison. Les badges ne donnent aucune permission.");
  } else if (sub === "nominate") {
    const target = await guild.members.fetch({ user: interaction.options.getUser("player", true).id, force: true });
    if (![member, target].every(person => eligibleParticipationMember(person, season, rules, new Date()))) throw new Error("Membres admissibles requis / Eligible members required.");
    const claim = await service.nominate(context.guildId, seasonId, target.id, actor, interaction.options.getString("reason", true));
    content = `${T("Nomination saved for officer review", "Nomination enregistrée pour validation")} : \`${claim.id}\` · ${claim.status}`;
  } else if (sub === "claims") {
    const page = interaction.options.getInteger("page") ?? 1;
    const claims = await prisma.communityKudos.findMany({ where: { seasonId, status: "PENDING" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5, skip: (page - 1) * 5 });
    content = claims.map(claim => `\`${claim.id}\` · <@${claim.userId}> ← <@${claim.nominatorId}>\n${claim.reason.slice(0, 150)}`).join("\n\n") || T("No pending nominations.", "Aucune nomination en attente.");
    content += `\nPage ${page}`;
  } else if (sub === "review") {
    const id = interaction.options.getString("id", true), approve = interaction.options.getString("decision", true) === "APPROVE";
    const claim = await prisma.communityKudos.findFirst({ where: { id, seasonId } });
    if (!claim) throw new Error("Nomination introuvable / Nomination not found.");
    if (approve) for (const userId of [claim.userId, claim.nominatorId]) {
      const person = await guild.members.fetch({ user: userId, force: true });
      if (!eligibleParticipationMember(person, season, rules, new Date())) throw new Error("Membres admissibles requis / Eligible members required.");
    }
    const reviewed = await service.review(context.guildId, seasonId, id, actor, approve, interaction.options.getString("reason", true));
    content = `${reviewed.status} · \`${reviewed.id}\``;
  } else if (sub === "history") {
    const target = interaction.options.getUser("player")?.id ?? actor, page = interaction.options.getInteger("page") ?? 1;
    if (target !== actor && !officer) throw new Error("Officiers seulement / Officers only.");
    const points = await prisma.communityPoint.findMany({ where: { seasonId, userId: target, reference: { startsWith: "participation:" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, skip: (page - 1) * 5 });
    content = points.map(point => `${point.amount > 0 ? "+" : ""}${point.amount} · ${point.reason.slice(0, 100)}\n\`${point.id}\` · <t:${Math.floor(point.createdAt.getTime() / 1000)}:f>`).join("\n\n") || T("No awards yet.", "Aucun gain pour le moment.");
    content += `\nPage ${page}`;
  } else if (sub === "reverse") {
    const point = await service.reverse(context.guildId, seasonId, interaction.options.getString("id", true), actor, interaction.options.getString("reason", true));
    content = `${T("Correction recorded; history preserved", "Correction enregistrée; historique conservé")} : ${point.amount}`;
  }
  const chunks: string[] = [];
  while (content.length > 1900) {
    const boundary = content.lastIndexOf("\n", 1900);
    const cut = boundary > 0 ? boundary : 1900;
    chunks.push(content.slice(0, cut)); content = content.slice(cut).trimStart();
  }
  chunks.push(content);
  await interaction.editReply({ content: chunks[0]!, allowedMentions: { parse: [] } });
  for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
