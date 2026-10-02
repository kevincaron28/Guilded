import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from "discord.js";
import { prisma } from "../database.js";
import { config } from "../config.js";
import { asLang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { canAccessCommunity } from "./community.js";
import { createParticipationService } from "../services/participation.js";
import { eligibleParticipationMember } from "../services/participation-discord.js";
import { participationBadge, participationRules } from "../services/participation-rules.js";

const service = createParticipationService(prisma);
const seasonOption = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("season").setDescription("Discord season ID").setDescriptionLocalizations({ fr: "Saison Discord" }).setRequired(true));
const idOption = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("id").setDescription("Record ID").setDescriptionLocalizations({ fr: "Identifiant" }).setRequired(true));
const reasonOption = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("reason").setDescription("Reason").setDescriptionLocalizations({ fr: "Motif" }).setRequired(true).setMaxLength(300));
const limits = [["messages", "messageDailyCap", 0, 50], ["reactions", "reactionDailyCap", 0, 20], ["voice-minutes", "voiceDailyMinutes", 0, 240], ["member-days", "minimumMemberDays", 0, 30], ["weekly-goal", "weeklyGoal", 2, 500]] as const;
export const participationCommand = new SlashCommandBuilder().setName("participation").setDescription("Discord participation and helper recognition").setDescriptionLocalizations({ fr: "Participation Discord et entraide" })
  .addSubcommand(sub => {
    const settings = seasonOption(sub.setName("settings").setDescription("Officer settings").setDescriptionLocalizations({ fr: "Réglages officiers" }))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable earning").setDescriptionLocalizations({ fr: "Activer les gains" }))
      .addChannelOption(o => o.setName("channel").setDescription("Add an eligible channel").setDescriptionLocalizations({ fr: "Ajouter un salon admissible" }).addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice))
      .addBooleanOption(o => o.setName("remove").setDescription("Remove this channel").setDescriptionLocalizations({ fr: "Retirer ce salon" }));
    const descriptions = ["Daily message points cap", "Daily reaction points cap", "Daily voice minutes; maximum 240", "Minimum days in server", "Distinct weekly participants goal"];
    const french = ["Plafond quotidien de messages", "Plafond quotidien de réactions", "Minutes vocales par jour, maximum 240", "Ancienneté minimale sur le serveur", "Objectif hebdomadaire de membres"];
    limits.forEach(([name, , min, max], index) => settings.addIntegerOption(o => o.setName(name).setDescription(descriptions[index]!).setDescriptionLocalizations({ fr: french[index]! }).setMinValue(min).setMaxValue(max)));
    return settings.addStringOption(o => o.setName("emojis").setDescription("Positive emojis or custom IDs, comma-separated").setDescriptionLocalizations({ fr: "Emojis positifs ou identifiants, séparés par virgules" }).setMaxLength(300));
  })
  .addSubcommand(sub => seasonOption(sub.setName("status").setDescription("Your progress and guild goal").setDescriptionLocalizations({ fr: "Vos progrès et objectif de guilde" })))
  .addSubcommand(sub => reasonOption(seasonOption(sub.setName("nominate").setDescription("Recognize a helper").setDescriptionLocalizations({ fr: "Reconnaître l'entraide" }))
    .addUserOption(o => o.setName("player").setDescription("Helpful member").setDescriptionLocalizations({ fr: "Membre à remercier" }).setRequired(true))))
  .addSubcommand(sub => seasonOption(sub.setName("claims").setDescription("Officer nomination inbox").setDescriptionLocalizations({ fr: "Nominations à valider" })).addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => reasonOption(idOption(seasonOption(sub.setName("review").setDescription("Approve or reject a nomination").setDescriptionLocalizations({ fr: "Valider ou refuser une nomination" }))))
    .addStringOption(o => o.setName("decision").setDescription("Decision").setDescriptionLocalizations({ fr: "Décision" }).setRequired(true).addChoices({ name: "Approve / Valider", value: "APPROVE" }, { name: "Reject / Refuser", value: "REJECT" })))
  .addSubcommand(sub => seasonOption(sub.setName("history").setDescription("Award history and IDs").setDescriptionLocalizations({ fr: "Historique et identifiants des gains" }))
    .addUserOption(o => o.setName("player").setDescription("Officers: another member").setDescriptionLocalizations({ fr: "Officiers : un autre membre" })).addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => reasonOption(idOption(seasonOption(sub.setName("reverse").setDescription("Officer: reverse an award").setDescriptionLocalizations({ fr: "Officiers : annuler un gain" })))));

export async function executeParticipation(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Serveur requis / Server required.", ephemeral: true }); return; }
  await interaction.deferReply({ ephemeral: true });
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const guild = interaction.guild, actor = interaction.user.id, sub = interaction.options.getSubcommand();
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);
  const T = (en: string, fr: string) => lang === "fr" ? fr : en;
  const seasonId = interaction.options.getString("season", true);
  const season = await prisma.communitySeason.findFirst({ where: { id: seasonId, guildId: context.guildId, game: "DISCORD" }, include: { participation: true } });
  if (!season) throw new Error("Saison Discord introuvable / Discord season not found.");
  const member = await guild.members.fetch({ user: actor, force: true });
  const channel = await guild.channels.fetch(season.channelId);
  if (!canAccessCommunity(member, season, !!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))) throw new Error("Accès refusé / Access denied.");
  const officer = hasPermission(member, "officer");
  if (["settings", "claims", "review", "reverse"].includes(sub) && !officer) throw new Error("Officiers seulement / Officers only.");
  const rules = participationRules.parse(season.participation?.rules ?? {});
  let content = "";
  if (sub === "settings") {
    const selected = interaction.options.getChannel("channel"), remove = interaction.options.getBoolean("remove") ?? false;
    if (remove && !selected) throw new Error("Choisis un salon / Select a channel.");
    if (selected) {
      const target = await guild.channels.fetch(selected.id);
      if (!target || ![ChannelType.GuildText, ChannelType.GuildVoice].includes(target.type) || target.id === guild.afkChannelId) throw new Error("Salon hors AFK requis / Non-AFK text or voice channel required.");
      if (!remove && (!target.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) || !guild.members.me || !target.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ViewChannel))) throw new Error("Salon inaccessible / Inaccessible channel.");
      const key = target.type === ChannelType.GuildVoice ? "voiceChannels" : "textChannels";
      rules[key] = remove ? rules[key].filter(id => id !== target.id) : [...new Set([...rules[key], target.id])];
    }
    for (const [option, key] of limits) { const value = interaction.options.getInteger(option); if (value !== null) rules[key] = value; }
    const emojis = interaction.options.getString("emojis");
    if (emojis !== null) rules.emojis = emojis.split(",").map(value => value.trim().replace(/^<a?:\w+:(\d+)>$/, "$1")).filter(Boolean);
    const enabled = interaction.options.getBoolean("enabled") ?? season.participation?.enabled ?? false;
    if (selected || remove || emojis !== null || interaction.options.getBoolean("enabled") !== null || limits.some(([option]) => interaction.options.getInteger(option) !== null)) await service.configure(context.guildId, seasonId, enabled, rules);
    content = `${T("Earning", "Gains")} : ${enabled ? T("enabled", "activés") : T("paused", "en pause")}\n` +
      `${T("Text channels", "Salons textuels")} : ${rules.textChannels.map(id => `<#${id}>`).join(", ") || "—"}\n${T("Voice channels", "Salons vocaux")} : ${rules.voiceChannels.map(id => `<#${id}>`).join(", ") || "—"}\n` +
      `${T("Daily caps", "Plafonds quotidiens")} : ${rules.messageDailyCap} ${T("message points", "points de messages")} · ${rules.reactionDailyCap} ${T("reaction points", "points de réactions")} · ${rules.voiceDailyMinutes} min ${T("voice", "vocal")}\n` +
      T("1 message point / 5 min; 2 voice points / 15 min; 2 eligible humans together. Muted listeners count; deafened/AFK do not.", "1 point de message / 5 min; 2 points vocaux / 15 min; 2 humains admissibles ensemble. Les personnes muettes comptent; pas les personnes assourdies/AFK.") +
      `\n${T("Positive emojis", "Emojis positifs")} : ${rules.emojis.join(" ") || "—"}\n` +
      T(`Account age: 7 days. Server membership: ${rules.minimumMemberDays} days. Weekly goal: ${rules.weeklyGoal} members. Helpers: 5 points, max 15/week after independent review.`, `Comptes : 7 jours. Présence sur le serveur : ${rules.minimumMemberDays} jours. Objectif : ${rules.weeklyGoal} membres/semaine. Entraide : 5 points, max 15/semaine après validation indépendante.`) +
      `\n${config.MESSAGE_CONTENT_INTENT ? T("Duplicate/short-text filtering enabled.", "Filtrage des textes courts/répétés activé.") : T("Text access is off: timing and caps apply; repeated text cannot be detected.", "Accès au texte désactivé : délais et plafonds actifs; les textes répétés ne peuvent pas être détectés.")}`;
  } else if (sub === "status") {
    const summary = await service.summary(context.guildId, seasonId, actor);
    content = `🏅 **${season.name}** · ${season.status}\n${T("Earning", "Gains")} : ${season.status === "ACTIVE" && season.participation?.enabled ? T("enabled", "activés") : T("paused", "en pause")}\n` +
      `${T("Today", "Aujourd'hui")} : ${summary.today?.messages ?? 0}/${rules.messageDailyCap} ${T("message points", "points de messages")} · ${summary.today?.reactions ?? 0}/${rules.reactionDailyCap} ${T("reaction points", "points de réactions")}\n` +
      `${T("Voice", "Vocal")} : ${Math.floor((summary.today?.voiceMs ?? 0) / 60_000)}/${rules.voiceDailyMinutes} min · ${summary.today?.voicePoints ?? 0} points\n` +
      `${T("Season score", "Score de saison")} : ${summary.points} · ${T("Milestone", "Palier")} : ${participationBadge(summary.points)} (50 / 150 / 300)\n` +
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
  for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, ephemeral: true, allowedMentions: { parse: [] } });
}
