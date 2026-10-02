import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type ModalSubmitInteraction, type SlashCommandSubcommandBuilder, type SlashCommandSubcommandsOnlyBuilder } from "discord.js";
import type { CommunityActivity, CommunitySeason } from "@prisma/client";
import { prisma } from "../database.js";
import { asLang, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { createCommunityService } from "../services/community.js";
import { challengeRules, COMMUNITY_GAMES, eventRules, lotteryRules, quizRules } from "../services/community-rules.js";
import { parseRaidTime } from "../services/raid-time.js";
import { eventVenue } from "../services/scheduled-events.js";
import { accessibleCommunityActivities, assertCommunityChannelAudience, communityAccess as access, resolveCommunitySeason, canAccessCommunity } from "../services/community-access.js";
import { communityActivityChannel, communityMonthName, communitySeasonLabel, communityStatusLabel } from "../services/community-display.js";
import { communityHubReply, diceReply, validateCommunityDestination } from "./community-hub.js";
export { canAccessCommunity };

const service = createCommunityService(prisma);
export const COMMUNITY_PREFIX = "community:";
const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const ref = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("id").setDescription("Activity").setDescriptionLocalizations({ fr: "Activité" }).setRequired(true).setAutocomplete(true));
const seasonOption = (sub: SlashCommandSubcommandBuilder, required = true) => sub.addStringOption(o => o.setName("season").setDescription("Season").setDescriptionLocalizations({ fr: "Saison" }).setRequired(required).setAutocomplete(true));
const titleOption = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o => o.setName("title").setDescription("Title").setDescriptionLocalizations({ fr: "Titre" }).setRequired(true).setMaxLength(200));
const dateOption = (sub: SlashCommandSubcommandBuilder, name: string) => sub.addStringOption(o => o.setName(name).setDescription("Guild time, e.g. vendredi 20h").setDescriptionLocalizations({ fr: "Heure du serveur" }).setRequired(true));
const playerOption = (sub: SlashCommandSubcommandBuilder) => sub.addUserOption(o => o.setName("player").setDescription("Member").setDescriptionLocalizations({ fr: "Membre" }).setRequired(true));
const pointsOption = (sub: SlashCommandSubcommandBuilder, zero = false) => sub.addIntegerOption(o => o.setName("points").setDescription("Points awarded").setDescriptionLocalizations({ fr: "Points gagnés" }).setRequired(true).setMinValue(zero ? 0 : 1).setMaxValue(1000));
const viewCommands = (builder: SlashCommandSubcommandsOnlyBuilder) => builder
  .addSubcommand(sub => ref(sub.setName("show").setDescription("View activity").setDescriptionLocalizations({ fr: "Voir l'activité" })))
  .addSubcommand(sub => seasonOption(sub.setName("list").setDescription("Activities").setDescriptionLocalizations({ fr: "Activités" }))
    .addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => ref(sub.setName("close").setDescription("Close activity").setDescriptionLocalizations({ fr: "Fermer l'activité" })))
  .addSubcommand(sub => ref(sub.setName("cancel").setDescription("Cancel activity").setDescriptionLocalizations({ fr: "Annuler l'activité" })));

export const lotteryCommand = viewCommands(new SlashCommandBuilder().setName("lottery").setDescription("Free, activity points or in-game currency lotteries").setDescriptionLocalizations({ fr: "Loteries" })
  .addSubcommand(sub => dateOption(titleOption(seasonOption(sub.setName("create").setDescription("Create lottery").setDescriptionLocalizations({ fr: "Créer une loterie" }))), "ends")
    .addStringOption(o => o.setName("mode").setDescription("Ticket type").setDescriptionLocalizations({ fr: "Type de billet" }).setRequired(true).addChoices({ name: "Free / Gratuit", value: "FREE" }, { name: "Activity points / Points", value: "POINTS" }, { name: "WoW gold / Or WoW", value: "WOW_GOLD" }, { name: "PoE currency / Monnaie PoE", value: "POE_CURRENCY" }))
    .addStringOption(o => o.setName("prize").setDescription("Prize per winner").setDescriptionLocalizations({ fr: "Lot par gagnant" }).setRequired(true).setMaxLength(250))
    .addIntegerOption(o => o.setName("cost").setDescription("Price per ticket").setDescriptionLocalizations({ fr: "Prix du billet" }).setMinValue(1).setMaxValue(1_000_000))
    .addStringOption(o => o.setName("currency").setDescription("e.g. gold, Divine Orb").setDescriptionLocalizations({ fr: "Monnaie" }).setMaxLength(80))
    .addStringOption(o => o.setName("realm").setDescription("Realm/faction or league/mode").setDescriptionLocalizations({ fr: "Royaume ou ligue" }).setMaxLength(100))
    .addIntegerOption(o => o.setName("winners").setDescription("Unique winners").setDescriptionLocalizations({ fr: "Gagnants distincts" }).setMinValue(1).setMaxValue(20))
    .addIntegerOption(o => o.setName("limit").setDescription("Tickets per member").setDescriptionLocalizations({ fr: "Billets par membre" }).setMinValue(1).setMaxValue(1000)))
  .addSubcommand(sub => ref(sub.setName("join").setDescription("Request tickets").setDescriptionLocalizations({ fr: "Demander des billets" }))
    .addIntegerOption(o => o.setName("quantity").setDescription("Ticket quantity").setDescriptionLocalizations({ fr: "Nombre de billets" }).setMinValue(1).setMaxValue(1000)))
  .addSubcommand(sub => playerOption(ref(sub.setName("confirm").setDescription("Confirm in-game payment").setDescriptionLocalizations({ fr: "Confirmer le paiement" })))
    .addStringOption(o => o.setName("receipt").setDescription("Trade details").setDescriptionLocalizations({ fr: "Détails du paiement" }).setRequired(true).setMaxLength(300)))
  .addSubcommand(sub => ref(sub.setName("payments").setDescription("Ticket requests").setDescriptionLocalizations({ fr: "Demandes de billets" }))
    .addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1))));

export const gamingCommand = viewCommands(new SlashCommandBuilder().setName("gaming").setDescription("Gaming nights, signups and attendance").setDescriptionLocalizations({ fr: "Soirées gaming" })
  .addSubcommand(sub => pointsOption(dateOption(dateOption(titleOption(seasonOption(sub.setName("create").setDescription("Create gaming night").setDescriptionLocalizations({ fr: "Créer une soirée" }))), "starts"), "ends"), true)
    .addIntegerOption(o => o.setName("capacity").setDescription("Player limit").setDescriptionLocalizations({ fr: "Nombre de places" }).setRequired(true).setMinValue(1).setMaxValue(200))
    .addChannelOption(o => o.setName("voice").setDescription("Existing voice channel for the Discord event").setDescriptionLocalizations({ fr: "Vocal existant pour l'événement Discord" }).addChannelTypes(ChannelType.GuildVoice)))
  .addSubcommand(sub => ref(sub.setName("edit").setDescription("Edit an upcoming gaming night").setDescriptionLocalizations({ fr: "Modifier une soirée à venir" }))
    .addStringOption(o => o.setName("title").setDescription("New title").setDescriptionLocalizations({ fr: "Nouveau titre" }).setMaxLength(200))
    .addStringOption(o => o.setName("starts").setDescription("New start in guild time").setDescriptionLocalizations({ fr: "Nouveau début, heure du serveur" }))
    .addStringOption(o => o.setName("ends").setDescription("New end in guild time").setDescriptionLocalizations({ fr: "Nouvelle fin, heure du serveur" }))
    .addChannelOption(o => o.setName("voice").setDescription("Existing voice channel for the Discord event").setDescriptionLocalizations({ fr: "Vocal existant pour l'événement Discord" }).addChannelTypes(ChannelType.GuildVoice)))
  .addSubcommand(sub => ref(sub.setName("join").setDescription("Change signup").setDescriptionLocalizations({ fr: "Modifier l'inscription" }))
    .addStringOption(o => o.setName("choice").setDescription("Availability").setDescriptionLocalizations({ fr: "Disponibilité" }).setRequired(true).addChoices({ name: "Present / Présent", value: "JOINED" }, { name: "Maybe / Peut-être", value: "MAYBE" }, { name: "Absent", value: "ABSENT" })))
  .addSubcommand(sub => playerOption(ref(sub.setName("attendance").setDescription("Confirm actual attendance").setDescriptionLocalizations({ fr: "Confirmer la présence" })))));

export const challengeCommand = viewCommands(new SlashCommandBuilder().setName("challenge").setDescription("Game challenges and reviewed results").setDescriptionLocalizations({ fr: "Défis et résultats" })
  .addSubcommand(sub => pointsOption(dateOption(titleOption(seasonOption(sub.setName("create").setDescription("Create challenge").setDescriptionLocalizations({ fr: "Créer un défi" }))), "ends"))
    .addStringOption(o => o.setName("instructions").setDescription("Objective and proof required").setDescriptionLocalizations({ fr: "Objectif et preuve" }).setRequired(true).setMaxLength(1500)))
  .addSubcommand(sub => ref(sub.setName("submit").setDescription("Submit evidence").setDescriptionLocalizations({ fr: "Soumettre une preuve" }))
    .addStringOption(o => o.setName("proof").setDescription("HTTPS screenshot/video link").setDescriptionLocalizations({ fr: "Lien de preuve" }).setRequired(true).setMaxLength(800)))
  .addSubcommand(sub => playerOption(ref(sub.setName("review").setDescription("Review or reverse award").setDescriptionLocalizations({ fr: "Valider ou corriger" })))
    .addStringOption(o => o.setName("decision").setDescription("Decision").setDescriptionLocalizations({ fr: "Décision" }).setRequired(true).addChoices({ name: "Approve / Valider", value: "APPROVE" }, { name: "Reject / Refuser", value: "REJECT" }, { name: "Reverse / Annuler les points", value: "REVERSE" }))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setDescriptionLocalizations({ fr: "Motif" }).setRequired(true).setMaxLength(300)))
  .addSubcommand(sub => ref(sub.setName("claims").setDescription("Submitted evidence").setDescriptionLocalizations({ fr: "Preuves soumises" }))
    .addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1))));

export const communityCommand = new SlashCommandBuilder().setName("community").setDescription("Seasons, leaderboards, dice and quizzes").setDescriptionLocalizations({ fr: "Saisons et jeux" })
  .addSubcommand(sub => sub.setName("start-season").setDescription("Start a season").setDescriptionLocalizations({ fr: "Démarrer une saison" })
    .addStringOption(o => o.setName("game").setDescription("Game").setDescriptionLocalizations({ fr: "Jeu" }).setRequired(true).addChoices(...COMMUNITY_GAMES.map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("name").setDescription("Theme; defaults to month").setDescriptionLocalizations({ fr: "Thème; mois par défaut" }).setMaxLength(80))
    .addRoleOption(o => o.setName("role").setDescription("Game role; required outside Discord").setDescriptionLocalizations({ fr: "Rôle du jeu" })))
  .addSubcommand(sub => seasonOption(sub.setName("season-settings").setDescription("Rename or route announcements").setDescriptionLocalizations({ fr: "Nom et salon des annonces" }))
    .addStringOption(o => o.setName("name").setDescription("Theme").setDescriptionLocalizations({ fr: "Thème" }).setMaxLength(80))
    .addChannelOption(o => o.setName("channel").setDescription("Announcements").setDescriptionLocalizations({ fr: "Annonces" }).addChannelTypes(ChannelType.GuildText))
    .addBooleanOption(o => o.setName("monthly").setDescription("New season every month").setDescriptionLocalizations({ fr: "Nouvelle saison chaque mois" })))
  .addSubcommand(sub => seasonOption(sub.setName("hub").setDescription("Activities and organizer templates").setDescriptionLocalizations({ fr: "Activités et modèles" }), false))
  .addSubcommand(sub => seasonOption(sub.setName("end-season").setDescription("Freeze final standings").setDescriptionLocalizations({ fr: "Archiver le classement" })))
  .addSubcommand(sub => sub.setName("seasons").setDescription("Accessible season history").setDescriptionLocalizations({ fr: "Historique des saisons" })
    .addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => seasonOption(sub.setName("leaderboard").setDescription("Season rankings").setDescriptionLocalizations({ fr: "Classement de la saison" }), false)
    .addIntegerOption(o => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand(sub => seasonOption(sub.setName("wallet").setDescription("Your points and history").setDescriptionLocalizations({ fr: "Tes points et leur historique" }), false))
  .addSubcommand(sub => seasonOption(sub.setName("dice").setDescription("Daily d100: 5 points, +10 at 90+").setDescriptionLocalizations({ fr: "Dé quotidien" }), false))
  .addSubcommand(sub => pointsOption(dateOption(titleOption(seasonOption(sub.setName("quiz").setDescription("Create a four-answer quiz").setDescriptionLocalizations({ fr: "Créer un quiz" }))), "ends"))
    .addStringOption(o => o.setName("a").setDescription("Answer A").setDescriptionLocalizations({ fr: "Réponse A" }).setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("b").setDescription("Answer B").setDescriptionLocalizations({ fr: "Réponse B" }).setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("c").setDescription("Answer C").setDescriptionLocalizations({ fr: "Réponse C" }).setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("d").setDescription("Answer D").setDescriptionLocalizations({ fr: "Réponse D" }).setRequired(true).setMaxLength(80))
    .addIntegerOption(o => o.setName("correct").setDescription("Correct answer: 1=A, 2=B, 3=C, 4=D").setDescriptionLocalizations({ fr: "Bonne réponse" }).setRequired(true).setMinValue(1).setMaxValue(4)))
  .addSubcommand(sub => ref(sub.setName("close-quiz").setDescription("Close a quiz").setDescriptionLocalizations({ fr: "Fermer un quiz" })));

async function getActivity(guild: Guild, guildId: string, id: string, userId: string, kind?: string, organizer = false) {
  const row = await prisma.communityActivity.findFirst({ where: { id, season: { guildId }, ...(kind ? { kind } : {}) }, include: { season: true } });
  if (!row) throw new Error("Activité introuvable / Activity not found.");
  await access(guild, userId, row.season, organizer, communityActivityChannel(row));
  return row;
}

export async function executeCommunity(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Utilise cette commande sur le serveur / Use this command in the server.", ephemeral: true }); return; }
  await interaction.deferReply({ ephemeral: true });
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const guild = interaction.guild;
  const settings = await guildService.getSettings(context.guildId);
  const lang = asLang(settings?.language);
  const timezone = settings?.timezone ?? "America/Toronto";
  const sub = interaction.options.getSubcommand();
  const area = interaction.commandName;
  const actor = interaction.user.id;
  const kind = area === "lottery" ? "LOTTERY" : area === "gaming" ? "EVENT" : area === "challenge" ? "CHALLENGE" : "QUIZ";
  const seasonId = interaction.options.getString("season");
  const id = interaction.options.getString("id");
  const organizer = ["create", "edit", "confirm", "payments", "attendance", "review", "claims", "close", "cancel", "start-season", "end-season", "season-settings", "quiz", "close-quiz"].includes(sub);
  const current = seasonId || ["dice", "wallet", "leaderboard", "hub"].includes(sub) ? await resolveCommunitySeason(prisma, guild, context.guildId, actor, seasonId, organizer) : null;
  const row = id ? await getActivity(guild, context.guildId, id, actor, kind, organizer) : null;
  let content = "";
  if (sub === "start-season") {
    const member = await guild.members.fetch({ user: actor, force: true });
    if (!hasPermission(member, "officer")) throw new Error("Organisateurs seulement / Organizers only.");
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased() || !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) || !channel.permissionsFor(guild.members.me!)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) throw new Error("Choisis un salon accessible au bot / Choose a channel the bot can use.");
    const role = interaction.options.getRole("role");
    if (role?.id === guild.id || role?.managed) throw new Error("Choisis un rôle de jeu / Choose a game role.");
    const created = await service.startSeason(context.guildId, { name: interaction.options.getString("name") ?? communityMonthName(new Date(), timezone, lang), game: interaction.options.getString("game", true), channelId: channel.id, audienceRoleId: role?.id ?? null, actorId: actor });
    content = `${say(lang, "Season created", "Saison créée")} : **${communitySeasonLabel(created, lang)}** (${created.game})\n/community hub`;
  } else if (sub === "season-settings") {
    const name = interaction.options.getString("name"), channel = interaction.options.getChannel("channel"), monthly = interaction.options.getBoolean("monthly");
    if (channel) await validateCommunityDestination(guild, current!, channel.id, actor);
    const updated = await service.configureSeason(context.guildId, current!.id, actor, { ...(name === null ? {} : { name }), ...(channel ? { announcementChannelId: channel.id } : {}), ...(monthly === null ? {} : { monthly }) });
    content = `**${communitySeasonLabel(updated, lang)}** · <#${updated.announcementChannelId ?? updated.channelId}> · ${updated.monthly ? say(lang, "a new season starts every month", "une nouvelle saison commence chaque mois") : say(lang, "runs until an organizer ends it", "dure jusqu'à ce qu'un organisateur la termine")}`;
  } else if (sub === "hub") {
    await interaction.editReply(await communityHubReply(guild, context.guildId, actor, current!, lang));
    return;
  } else if (sub === "seasons") {
    const member = await guild.members.fetch({ user: actor, force: true });
    const channels = await guild.channels.fetch();
    const visible = channels.filter(channel => !!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)).map(channel => channel!.id);
    const where = { guildId: context.guildId, channelId: { in: visible }, ...(hasPermission(member, "officer") ? {} : { OR: [{ audienceRoleId: null }, { audienceRoleId: { in: [...member.roles.cache.keys()] } }] }) };
    const count = await prisma.communitySeason.count({ where });
    const page = Math.min(interaction.options.getInteger("page") ?? 1, Math.max(1, Math.ceil(count / 10)));
    const seasons = await prisma.communitySeason.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, skip: (page - 1) * 10 });
    content = seasons.map(season => `**${communitySeasonLabel(season, lang)}** · ${season.game} · ${season.status === "ACTIVE" ? say(lang, "Active", "En cours") : say(lang, "Archived", "Archivée")}`).join("\n\n") || say(lang, "No seasons yet.", "Aucune saison pour le moment.");
    content += `\nPage ${page}/${Math.max(1, Math.ceil(count / 10))}`;
  } else if (sub === "end-season") {
    await service.endSeason(context.guildId, current!.id);
    content = say(lang, "Season archived. Final standings remain available.", "Saison archivée. Le classement final reste consultable.");
  } else if (sub === "leaderboard" || sub === "wallet") {
    const board = await service.board(context.guildId, current!.id);
    if (sub === "leaderboard") {
      const pages = Math.max(1, Math.ceil(board.length / 10));
      const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
      const top = board.slice((page - 1) * 10, page * 10);
      content = `🏆 **${communitySeasonLabel(current!, lang)}** · ${current!.game}\n` + (top.map(item => `${1 + board.filter(other => other.points > item.points).length}. <@${item.userId}> · ${item.points} points`).join("\n") || say(lang, "No points yet.", "Aucun point pour le moment.")) + `\nPage ${page}/${pages}`;
    } else {
      const mine = board.find(item => item.userId === actor);
      const history = await prisma.communityPoint.findMany({ where: { seasonId: current!.id, userId: actor }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 });
      content = `**${communitySeasonLabel(current!, lang)}**\n${say(lang, "Earned score", "Score gagné")} : ${mine?.points ?? 0}\n${say(lang, "Spendable balance", "Solde disponible")} : ${mine?.balance ?? 0}\n` + history.map(entry => `${entry.amount > 0 ? "+" : ""}${entry.amount} · ${entry.reason.slice(0, 100)} · ${entry.kind}`).join("\n");
    }
  } else if (sub === "dice") {
    content = await diceReply(context.guildId, current!, actor, timezone, lang);
  } else if (sub === "create" || sub === "quiz") {
    if (interaction.channelId !== (current!.announcementChannelId ?? current!.channelId)) throw new Error("Crée l'activité dans le salon des annonces / Create this in the announcements channel.");
    await validateCommunityDestination(guild, current!, interaction.channelId, actor);
    const startsAt = kind === "EVENT" ? parseRaidTime(interaction.options.getString("starts", true), timezone) : undefined;
    const endsAt = parseRaidTime(interaction.options.getString("ends", true), timezone);
    let rules: unknown;
    if (kind === "LOTTERY") {
      const mode = interaction.options.getString("mode", true);
      if (mode === "FREE" && (interaction.options.getInteger("cost") || (interaction.options.getInteger("limit") ?? 1) !== 1)) throw new Error("Gratuit : un billet sans paiement / Free: one ticket, no payment.");
      rules = { mode, prize: interaction.options.getString("prize", true), cost: mode === "FREE" ? 0 : interaction.options.getInteger("cost") ?? 0, currency: mode === "POINTS" ? "points" : interaction.options.getString("currency") ?? "", realm: interaction.options.getString("realm") ?? "", winners: interaction.options.getInteger("winners") ?? 1, maxTickets: mode === "FREE" ? 1 : interaction.options.getInteger("limit") ?? 10 };
    } else if (kind === "EVENT") {
      const voice = interaction.options.getChannel("voice");
      if (voice) {
        const channel = await guild.channels.fetch(voice.id);
        const member = await guild.members.fetch(actor);
        if (!channel?.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) throw new Error("Vocal inaccessible / Voice channel inaccessible.");
        await validateEventVenue(guild, current!.announcementChannelId ?? current!.channelId, voice.id);
      }
      rules = { capacity: interaction.options.getInteger("capacity", true), points: interaction.options.getInteger("points", true), ...(voice ? { voiceChannelId: voice.id } : {}) };
    }
    else if (kind === "CHALLENGE") rules = { instructions: interaction.options.getString("instructions", true), points: interaction.options.getInteger("points", true) };
    else rules = { choices: ["a", "b", "c", "d"].map(key => interaction.options.getString(key, true)), correct: interaction.options.getInteger("correct", true) - 1, points: interaction.options.getInteger("points", true) };
    const created = await service.create(context.guildId, current!.id, { kind, title: interaction.options.getString("title", true), rules, ...(startsAt ? { startsAt } : {}), endsAt, actorId: actor });
    content = `${say(lang, "Activity saved; its message will appear shortly.", "Activité enregistrée; son message apparaîtra sous peu.")} **${created.title}**`;
  } else if (sub === "edit" && kind === "EVENT") {
    const title = interaction.options.getString("title");
    const starts = interaction.options.getString("starts");
    const ends = interaction.options.getString("ends");
    const voice = interaction.options.getChannel("voice");
    if (voice) {
      const channel = await guild.channels.fetch(voice.id);
      const member = await guild.members.fetch(actor);
      if (!channel?.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) throw new Error("Vocal inaccessible / Voice channel inaccessible.");
      await validateEventVenue(guild, communityActivityChannel(row!), voice.id);
    }
    await service.editEvent(context.guildId, id!, { ...(title === null ? {} : { title }), ...(starts === null ? {} : { startsAt: parseRaidTime(starts, timezone) }),
      ...(ends === null ? {} : { endsAt: parseRaidTime(ends, timezone) }), ...(voice ? { voiceChannelId: voice.id } : {}) });
    content = say(lang, "Gaming night updated. Its message and Discord event will refresh shortly.", "Soirée modifiée. Son annonce et l'événement Discord seront actualisés sous peu.");
  } else if (sub === "list") {
    const available = (await accessibleCommunityActivities(prisma, guild, context.guildId, actor, current!.id)).filter(item => item.kind === kind).reverse();
    const pages = Math.max(1, Math.ceil(available.length / 10));
    const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
    const items = available.slice((page - 1) * 10, page * 10);
    content = items.map(item => `**${item.title}** · ${item.status}${item.messageId ? `\nhttps://discord.com/channels/${guild.id}/${communityActivityChannel({ ...item, season: current! })}/${item.messageId}` : ""}`).join("\n\n") || say(lang, "No activities.", "Aucune activité.");
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(communitySeasonLabel(current!, lang)).setDescription(content.slice(0, 4000)).setFooter({ text: `Page ${page}/${pages}` })], allowedMentions: { parse: [] } });
    return;
  } else if (sub === "show") {
    const entries = await prisma.communityEntry.findMany({ where: { activityId: row!.id }, orderBy: { createdAt: "asc" } });
    const card = communityCard(row!, entries, lang);
    await interaction.editReply({ ...card, components: [], allowedMentions: { parse: [] } });
    return;
  } else if (sub === "join") {
    if (kind === "LOTTERY") {
      const quantity = interaction.options.getInteger("quantity") ?? 1;
      if (lotteryRules.parse(row!.rules).mode === "POINTS") { await interaction.editReply(lotteryConfirmation(row!, quantity, actor, lang)); return; }
      const entry = await service.enterLottery(context.guildId, row!.id, actor, quantity);
      content = ticketReply(lang, row!, entry);
    } else {
      const entry = await service.signup(context.guildId, row!.id, actor, interaction.options.getString("choice", true));
      content = signupReply(lang, entry.status);
    }
  } else if (sub === "confirm") {
    const user = interaction.options.getUser("player", true);
    await access(guild, user.id, row!.season);
    await service.confirmPayment(context.guildId, row!.id, user.id, actor, interaction.options.getString("receipt", true));
    content = say(lang, "Payment confirmed; tickets are eligible for the draw.", "Paiement confirmé; les billets sont admissibles au tirage.");
  } else if (sub === "attendance") {
    const user = interaction.options.getUser("player", true);
    await access(guild, user.id, row!.season);
    await service.attendance(context.guildId, row!.id, user.id, actor);
    content = say(lang, "Attendance confirmed; points awarded once.", "Présence confirmée; points attribués une seule fois.");
  } else if (sub === "submit") {
    await service.submit(context.guildId, row!.id, actor, interaction.options.getString("proof", true));
    content = say(lang, "Evidence submitted for organizer review.", "Preuve soumise à un organisateur.");
  } else if (sub === "review") {
    const user = interaction.options.getUser("player", true);
    if (interaction.options.getString("decision", true) === "APPROVE") await access(guild, user.id, row!.season);
    await service.review(context.guildId, row!.id, user.id, actor, interaction.options.getString("decision", true), interaction.options.getString("reason", true));
    content = say(lang, "Decision saved with its point history.", "Décision enregistrée avec l'historique des points.");
  } else if (sub === "payments" || sub === "claims") {
    const count = await prisma.communityEntry.count({ where: { activityId: row!.id } });
    const pages = Math.max(1, Math.ceil(count / 3));
    const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
    const entries = await prisma.communityEntry.findMany({ where: { activityId: row!.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 3, skip: (page - 1) * 3 });
    const rules = row!.kind === "LOTTERY" ? lotteryRules.parse(row!.rules) : null;
    content = entries.map(entry => `<@${entry.userId}> · ${entry.status}${rules ? ` · ${entry.quantity} ${say(lang, "tickets", "billets")} = ${entry.quantity * rules.cost} ${rules.currency}` : ""}\n${entry.evidence ?? ""}\n${entry.reviewNote ?? ""}`).join("\n\n") || say(lang, "No entries.", "Aucune participation.");
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(row!.title).setDescription(content).setFooter({ text: `Page ${page}/${pages}` })], allowedMentions: { parse: [] } });
    return;
  } else if (sub === "close" || sub === "cancel" || sub === "close-quiz") {
    await service.close(context.guildId, row!.id, sub === "cancel");
    content = say(lang, "Activity closed. The announcement will update shortly.", "Activité fermée. L'annonce sera mise à jour sous peu.");
  }
  await interaction.editReply({ content: content.slice(0, 1950) || say(lang, "Done.", "Terminé."), allowedMentions: { parse: [] } });
}

async function validateEventVenue(guild: Guild, channelId: string, voiceId: string): Promise<void> {
  try { await eventVenue(guild, channelId, voiceId); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "event-voice-audience") {
      throw new Error("Choisis un vocal avec la même visibilité que le salon de la saison / Choose a voice channel with the same visibility as the season channel.");
    }
    throw error;
  }
}
function ticketReply(lang: Lang, row: CommunityActivity, entry: { status: string; quantity: number }) {
  const rules = lotteryRules.parse(row.rules);
  return entry.status === "PENDING"
    ? say(lang, `${entry.quantity} tickets requested (${entry.quantity * rules.cost} ${rules.currency}, ${rules.realm}). Arrange the trade with an organizer. Tickets count after payment confirmation.`, `${entry.quantity} billets demandés (${entry.quantity * rules.cost} ${rules.currency}, ${rules.realm}). Fais l'échange avec un organisateur. Les billets comptent après sa confirmation du paiement.`)
    : say(lang, `${entry.quantity} tickets confirmed. One request per member; repeated clicks do not purchase more.`, `${entry.quantity} billets confirmés. Une demande par membre; recliquer n'achète pas de billets supplémentaires.`);
}
function signupReply(lang: Lang, status: string) {
  return say(lang, `Signup saved: ${status === "WAITLISTED" ? "waitlist; promotion is automatic if a spot opens" : status === "JOINED" ? "present" : status === "MAYBE" ? "maybe" : "absent"}.`, `Inscription enregistrée : ${status === "WAITLISTED" ? "liste d'attente; passage automatique si une place se libère" : status === "JOINED" ? "présent" : status === "MAYBE" ? "peut-être" : "absent"}.`);
}

export function lotteryConfirmation(row: CommunityActivity, quantity: number, userId: string, lang: Lang) {
  const rules = lotteryRules.parse(row.rules);
  if (rules.mode !== "POINTS" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > rules.maxTickets) throw new Error("Nombre de billets invalide / Invalid ticket quantity.");
  const total = quantity * rules.cost;
  return { content: say(lang, `${quantity} ticket(s) for **${row.title}**: **${total} points**. Your earned ranking stays unchanged. Confirm this purchase?`, `${quantity} billet(s) pour **${row.title}** : **${total} points**. Ton score au classement reste intact. Confirmer l'achat ?`),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${COMMUNITY_PREFIX}buy:${row.id}:${quantity}:${total}:${userId}`).setLabel(say(lang, "Confirm purchase", "Confirmer l'achat")).setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] as [] } };
}

export function communityCard(row: CommunityActivity & { season: CommunitySeason }, entries: { userId: string; quantity: number; status: string }[], lang: Lang) {
  const embed = new EmbedBuilder().setColor(0xd4af37).setTitle(row.title).setFooter({ text: `${communitySeasonLabel(row.season, lang)} · ${row.season.game}` });
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const buttons = new ActionRowBuilder<ButtonBuilder>();
  const closed = row.status !== "OPEN" || row.endsAt <= new Date();
  const addButton = (action: string, label: string, style = ButtonStyle.Primary) => buttons.addComponents(new ButtonBuilder().setCustomId(`${COMMUNITY_PREFIX}${action}:${row.id}`).setLabel(label).setStyle(style).setDisabled(closed));
  let description = `${say(lang, "Closes", "Fermeture")} : <t:${Math.floor(row.endsAt.getTime() / 1000)}:F>\n`;
  if (row.kind === "LOTTERY") {
    const rules = lotteryRules.parse(row.rules);
    const confirmed = entries.filter(entry => entry.status === "CONFIRMED");
    description += `🎁 ${say(lang, "Prize per winner", "Lot par gagnant")} : ${rules.prize}\n`;
    description += rules.mode === "FREE" ? say(lang, "Free: one ticket per member.\n", "Gratuit : un billet par membre.\n") : `${rules.cost} ${rules.currency} / ${say(lang, "ticket", "billet")} · ${rules.maxTickets} ${say(lang, "max per member", "maximum par membre")}\n${rules.realm}\n`;
    description += `${confirmed.length} ${say(lang, "participants", "participants")} · ${confirmed.reduce((sum, entry) => sum + entry.quantity, 0)} ${say(lang, "confirmed tickets", "billets confirmés")} · ${rules.winners} ${say(lang, "winner(s)", "gagnant(s)")}\n`;
    if (["WOW_GOLD", "POE_CURRENCY"].includes(rules.mode)) description += say(lang, "In-game payment is confirmed by an organizer. Pending requests do not enter the draw.\n", "Un organisateur confirme le paiement en jeu. Les demandes en attente ne participent pas au tirage.\n");
    description += say(lang, "One request per member. Every confirmed ticket has equal odds; each person can win once.\n", "Une demande par membre. Chaque billet confirmé a la même chance; une personne peut gagner une seule fois.\n");
    const result = row.result as { winners?: string[]; externalRefundsRequired?: { userId: string; amount: number }[] } | null;
    if (row.status === "CLOSED") description += `🏆 ${say(lang, "Winners", "Gagnants")} : ${result?.winners?.map(id => `<@${id}>`).join(", ") || say(lang, "No eligible entries", "Aucune participation admissible")}\n`;
    if (row.status === "CANCELLED") description += say(lang, "Cancelled. Activity points refunded automatically. In-game refunds must be handled by organizers.\n", "Annulée. Points d'activité remboursés automatiquement. Les remboursements en jeu sont à faire par les organisateurs.\n");
    if (result?.externalRefundsRequired?.length) description += `${say(lang, "In-game refunds", "Remboursements en jeu")} : ${result.externalRefundsRequired.length}\n`;
    addButton(rules.mode === "FREE" ? "free" : "tickets", rules.mode === "FREE" ? say(lang, "Enter for free", "Participer gratuitement") : say(lang, "Choose tickets", "Choisir mes billets"));
  } else if (row.kind === "EVENT") {
    const rules = eventRules.parse(row.rules);
    description += `🎮 <t:${Math.floor(row.startsAt!.getTime() / 1000)}:F>\n${rules.points} ${say(lang, "points for organizer-confirmed attendance", "points pour une présence confirmée par un organisateur")}\n`;
    description += `${Math.max(0, rules.capacity - entries.filter(e => ["JOINED", "PRESENT"].includes(e.status)).length)} ${say(lang, "places available", "places disponibles")}\n`;
    for (const [status, label] of [["JOINED", say(lang, "Present", "Présent")], ["PRESENT", say(lang, "Attendance confirmed", "Présence confirmée")], ["MAYBE", say(lang, "Maybe", "Peut-être")], ["WAITLISTED", say(lang, "Waitlist", "Attente")]]) {
      const people = entries.filter(entry => entry.status === status);
      description += `**${label} (${people.length}${status === "JOINED" ? `/${rules.capacity}` : ""})** : ${people.slice(0, 15).map(entry => `<@${entry.userId}>`).join(", ") || "—"}${people.length > 15 ? " …" : ""}\n`;
    }
    addButton("present", say(lang, "Join", "Je participe"));
    addButton("maybe", say(lang, "Maybe", "Peut-être"), ButtonStyle.Secondary);
    addButton("absent", "Absent", ButtonStyle.Secondary);
    if (row.startsAt! <= new Date()) for (const button of buttons.components) button.setDisabled(true);
  } else if (row.kind === "CHALLENGE") {
    const rules = challengeRules.parse(row.rules);
    description += `${rules.instructions}\n🏆 ${rules.points} ${say(lang, "points after evidence review; once per member", "points après validation de la preuve; une fois par membre")}\n`;
    addButton("proof", say(lang, "Submit evidence", "Soumettre une preuve"));
    buttons.addComponents(new ButtonBuilder().setCustomId(`${COMMUNITY_PREFIX}claim-status:${row.id}`).setLabel(say(lang, "My submission", "Ma soumission")).setStyle(ButtonStyle.Secondary));
  } else if (row.kind === "QUIZ") {
    const rules = quizRules.parse(row.rules);
    description += `${rules.points} ${say(lang, "points for a correct answer. One attempt; the author cannot play.", "points pour une bonne réponse. Un essai; l'auteur ne participe pas.")}\n`;
    rules.choices.forEach((choice, index) => { description += `**${"ABCD"[index]}** — ${choice}\n`; addButton(`answer${index}`, "ABCD"[index]!); });
    if (row.status === "CLOSED") description += `${say(lang, "Answer", "Réponse")} : ${"ABCD"[rules.correct]}\n`;
  }
  if (row.status === "CANCELLED") description += say(lang, "Status: cancelled", "Statut : annulée");
  else if (row.status === "CLOSED") description += say(lang, "Status: closed", "Statut : terminée");
  embed.setDescription(description.slice(0, 4000));
  if (buttons.components.length) components.push(buttons);
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}

export async function handleCommunityButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [action, id, quantityText, totalText, ownerId] = interaction.customId.slice(COMMUNITY_PREFIX.length).split(":");
  if (!action || !id) throw new Error("Bouton invalide / Invalid button.");
  // Fetches and permission checks occur after acknowledgement; opening a modal
  // is the first response so its initial lookup must be bounded by Discord.
  if (action === "proof" || action === "tickets") {
    const modal = new ModalBuilder().setCustomId(`${COMMUNITY_PREFIX}${action}:${id}`).setTitle(action === "proof" ? "Preuve / Evidence" : "Billets / Tickets");
    const input = new TextInputBuilder().setCustomId("value").setLabel(action === "proof" ? "Lien HTTPS de la preuve / Evidence link" : "Nombre de billets / Number of tickets").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(action === "proof" ? 800 : 4);
    if (action === "tickets") input.setValue("1");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = asLang((await guildService.getSettings(record.id))?.language);
  const kind = action.startsWith("answer") ? "QUIZ" : ["free", "buy"].includes(action) ? "LOTTERY" : action === "claim-status" ? "CHALLENGE" : "EVENT";
  const row = await getActivity(interaction.guild, record.id, id, interaction.user.id, kind);
  if (action !== "buy" && communityActivityChannel(row) !== interaction.channelId) throw new Error("Mauvais salon / Wrong channel.");
  let content: string;
  if (action === "free" || action === "buy") {
    const rules = lotteryRules.parse(row.rules);
    const quantity = action === "free" ? 1 : Number(quantityText);
    if (action === "free" && rules.mode !== "FREE" || action === "buy" && (ownerId !== interaction.user.id || rules.mode !== "POINTS" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > rules.maxTickets || Number(totalText) !== quantity * rules.cost)) throw new Error("Confirmation invalide / Invalid confirmation.");
    content = ticketReply(lang, row, await service.enterLottery(record.id, id, interaction.user.id, quantity));
  } else if (action === "claim-status") {
    const entry = await prisma.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId: interaction.user.id } } });
    content = entry ? `${communityStatusLabel(entry.status, lang)}\n${entry.evidence ?? ""}\n${entry.reviewNote ?? ""}` : say(lang, "No submission yet. Use Submit evidence.", "Aucune soumission. Utilise Soumettre une preuve.");
  } else if (/^answer[0-3]$/.test(action)) {
    const entry = await service.answerQuiz(record.id, id, interaction.user.id, Number(action.slice(-1)));
    content = entry.status === "CORRECT" ? say(lang, "Correct! Points saved.", "Bonne réponse! Points enregistrés.") : say(lang, "Answer saved. Try the next quiz!", "Réponse enregistrée. Réessaie au prochain quiz!");
  } else {
    const choice = { present: "JOINED", maybe: "MAYBE", absent: "ABSENT" }[action];
    if (!choice) throw new Error("Bouton invalide / Invalid button.");
    content = signupReply(lang, (await service.signup(record.id, id, interaction.user.id, choice)).status);
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

export async function handleCommunityModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const [action, id] = interaction.customId.slice(COMMUNITY_PREFIX.length).split(":");
  if (!id || !["proof", "tickets"].includes(action ?? "")) throw new Error("Formulaire invalide / Invalid form.");
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const row = await getActivity(interaction.guild, record.id, id, interaction.user.id, action === "proof" ? "CHALLENGE" : "LOTTERY");
  if (communityActivityChannel(row) !== interaction.channelId) throw new Error("Mauvais salon / Wrong channel.");
  const lang = asLang((await guildService.getSettings(record.id))?.language);
  const value = interaction.fields.getTextInputValue("value").trim();
  let content: string;
  if (action === "proof") {
    await service.submit(record.id, id, interaction.user.id, value);
    content = say(lang, "Evidence sent to organizers.", "Preuve envoyée aux organisateurs.");
  } else {
    if (!/^\d{1,4}$/.test(value)) throw new Error("Nombre de billets invalide / Invalid ticket quantity.");
    if (lotteryRules.parse(row.rules).mode === "POINTS") { await interaction.editReply(lotteryConfirmation(row, Number(value), interaction.user.id, lang)); return; }
    content = ticketReply(lang, row, await service.enterLottery(record.id, id, interaction.user.id, Number(value)));
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

export async function publishCommunityActivity(guild: Guild, guildId: string, id: string): Promise<void> {
  const row = await prisma.communityActivity.findFirst({ where: { id, season: { guildId } }, include: { season: true, entries: true } });
  if (!row) return;
  await assertCommunityChannelAudience(guild, row.season.channelId, communityActivityChannel(row));
  const channel = await guild.channels.fetch(communityActivityChannel(row));
  if (!channel?.isTextBased()) throw new Error("Community channel unavailable");
  const lang = asLang((await guildService.getSettings(guildId))?.language);
  const card = communityCard(row, row.entries, lang);
  if (row.kind === "EVENT") {
    const event = await prisma.discordEventLink.findFirst({ where: { guildId, sourceType: "community", sourceId: row.id } });
    if (event?.discordId) card.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(lang === "fr" ? "Événement et rappel Discord" : "Discord event and reminder").setURL(`https://discord.com/events/${guild.id}/${event.discordId}`)));
  }
  let message = row.messageId ? await channel.messages.fetch(row.messageId).catch((error: unknown) => {
    if ((error as { code?: number }).code === 10008) return null;
    throw error;
  }) : null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 });
    message = recent.find(item => item.author.id === guild.client.user!.id && (item.embeds.some(embed => embed.footer?.text.endsWith(`ID: ${id}`)) || JSON.stringify(item.components).includes(`:${id}"`))) ?? null;
  }
  if (message) await message.edit(card);
  else message = await channel.send({ ...card, nonce: id.slice(-25), enforceNonce: true });
  if (message.id !== row.messageId || !row.postedChannelId) await prisma.communityActivity.update({ where: { id }, data: { messageId: message.id, postedChannelId: channel.id } });
}

let ticking = false;
export async function runCommunityActivities(guilds: Iterable<Guild>): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const guild of guilds) {
      const record = await prisma.guild.findUnique({ where: { discordId: guild.id } });
      if (record) { await service.tick(record.id); await service.rotateMonthly(record.id); }
    }
  } finally { ticking = false; }
}
