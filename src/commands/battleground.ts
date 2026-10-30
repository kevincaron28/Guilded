import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, escapeMarkdown, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext } from "./context.js";
import { createBattleground } from "../services/battleground-organization.js";
import { manageSession, respondToSession, sessionInclude } from "../services/activity-core.js";
import { requireTeamChannel, teamLanguage, teamSessionEmbed } from "../services/activity-core-discord.js";
import { Prisma, type RaidRole } from "../generated/prisma/client.js";
import { battlegroundHistory, battlegroundStats, correctBattlegroundReport, setBattlegroundConsent } from "../services/battleground-records.js";
import { battlegroundPrivacyHelp, battlegroundRecordPanel, battlegroundResultCard, battlegroundSetupHelp } from "./battleground-record-ui.js";
import { currentGuildScope } from "../services/guild-scope.js";

export const battlegroundCommand = new SlashCommandBuilder().setName("bg").setDescription("Battleground planning")
  .setDescriptionLocalizations({ fr: "Organisation des champs de bataille" })
  .addSubcommand(s => s.setName("panel").setDescription("Create, join, my groups and upcoming sessions"))
  .addSubcommand(s => s.setName("create").setDescription("Plan a one-off session (leaders)")
    .addStringOption(o => o.setName("name").setDescription("Group name").setRequired(true).setMaxLength(50))
    .addChannelOption(o => o.setName("channel").setDescription("Existing channel defining who can see this group").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("mode").setDescription("Format").setRequired(true).addChoices(...["casual", "rated", "blitz"].map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("map").setDescription("Map or random queue").setRequired(true).setMaxLength(70))
    .addStringOption(o => o.setName("start").setDescription("ISO start with offset, e.g. 2026-11-05T20:00:00-05:00").setRequired(true))
    .addIntegerOption(o => o.setName("min-level").setDescription("Minimum level").setRequired(true).setMinValue(10).setMaxValue(90))
    .addIntegerOption(o => o.setName("max-level").setDescription("Maximum level").setRequired(true).setMinValue(10).setMaxValue(90))
    .addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).addChoices(...["Alliance", "Horde"].map(value => ({ name: value, value }))))
    .addBooleanOption(o => o.setName("normal-realm").setDescription("Confirm this is not Hardcore").setRequired(true))
    .addIntegerOption(o => o.setName("healers").setDescription("Healer slots").setMinValue(0).setMaxValue(5))
    .addIntegerOption(o => o.setName("dps").setDescription("Damage slots").setMinValue(0).setMaxValue(5))
    .addIntegerOption(o => o.setName("tanks").setDescription("Tank slots").setMinValue(0).setMaxValue(5)))
  .addSubcommand(s => s.setName("join").setDescription("Join with your own character; no statistics opt-in")
    .addStringOption(o => o.setName("session").setDescription("Session ID from /bg upcoming").setRequired(true))
    .addStringOption(o => o.setName("character").setDescription("Your linked character name-realm").setRequired(true))
    .addStringOption(o => o.setName("role").setDescription("Role").setRequired(true).addChoices(...["TANK", "HEALER", "DPS"].map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("faction").setDescription("Confirm your character's faction").setRequired(true).addChoices(...["Alliance", "Horde"].map(value => ({ name: value, value }))))
    .addBooleanOption(o => o.setName("normal-realm").setDescription("Confirm your character is not Hardcore").setRequired(true)))
  .addSubcommand(s => s.setName("leave").setDescription("Withdraw your signup").addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true)))
  .addSubcommand(s => s.setName("mine").setDescription("My upcoming groups"))
  .addSubcommand(s => s.setName("upcoming").setDescription("Upcoming groups I can access"))
  .addSubcommand(s => s.setName("manage").setDescription("Start, cancel or close a session (leaders)")
    .addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true))
    .addStringOption(o => o.setName("action").setDescription("Action").setRequired(true).addChoices(...["open", "close", "start", "cancel", "complete"].map(value => ({ name: value, value })))))
  .addSubcommand(s => s.setName("view").setDescription("View group and signup details").addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true)))
  .addSubcommand(s => s.setName("history").setDescription("My private battleground reports").setDescriptionLocalizations({ fr: "Mes rapports JcJ privés" }))
  .addSubcommand(s => s.setName("result").setDescription("View one of my private reports").setDescriptionLocalizations({ fr: "Voir un de mes rapports privés" })
    .addStringOption(o => o.setName("report").setDescription("Report ID from /bg history").setRequired(true).setMaxLength(160)))
  .addSubcommand(s => s.setName("correct").setDescription("Withdraw my incorrect report; retain correction history").setDescriptionLocalizations({ fr: "Retirer mon rapport erroné en conservant la correction" })
    .addStringOption(o => o.setName("report").setDescription("My report ID").setRequired(true).setMaxLength(160))
    .addStringOption(o => o.setName("reason").setDescription("Reason for withdrawal").setRequired(true).setMinLength(3).setMaxLength(240)))
  .addSubcommand(s => s.setName("privacy").setDescription("Choose personal capture and guild-statistics consent").setDescriptionLocalizations({ fr: "Choisir la collecte personnelle et les statistiques de guilde" })
    .addBooleanOption(o => o.setName("capture").setDescription("Allow my paired Companion to submit my postmatch reports").setRequired(true))
    .addBooleanOption(o => o.setName("guild-stats").setDescription("Allow my eligible reports in guild statistics; requires capture").setRequired(true)))
  .addSubcommand(s => s.setName("stats").setDescription("Opt-in guild participation reports, explicitly provisional").setDescriptionLocalizations({ fr: "Participations de guilde avec accord, explicitement provisoires" })
    .addStringOption(o => o.setName("mode").setDescription("Format").setRequired(true).addChoices(...["casual", "rated", "blitz"].map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("bracket").setDescription("Reported API bracket identifier from /bg result").setRequired(true).setMaxLength(20))
    .addIntegerOption(o => o.setName("season").setDescription("Season number; defaults to current").setMinValue(1)))
  .addSubcommand(s => s.setName("setup").setDescription("Officer setup instructions; changes no channels or permissions").setDescriptionLocalizations({ fr: "Guide officiers, sans modification de salons ou permissions" }));

type BgInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;
type BgInput = { action: string; strings?: Record<string, string>; integers?: Record<string, number>; booleans?: Record<string, boolean>; channelId?: string | undefined };

// Both component forms and slash commands reach the same authorization and service path.
export async function executeBattleground(i: BgInteraction, input?: BgInput) {
  const command = i.isChatInputCommand() ? i : null;
  function text(key: string, required: true): string;
  function text(key: string, required?: false): string | null;
  function text(key: string, required = false) {
    const value = command?.options.getString(key) ?? input?.strings?.[key] ?? null;
    if (required && value === null) throw new Error(`Missing ${key}`);
    return value;
  }
  function integer(key: string, required: true): number;
  function integer(key: string, required?: false): number | null;
  function integer(key: string, required = false) {
    const value = command?.options.getInteger(key) ?? input?.integers?.[key] ?? null;
    if (required && value === null) throw new Error(`Missing ${key}`);
    return value;
  }
  const normalRealm = () => command?.options.getBoolean("normal-realm") ?? input?.booleans?.["normal-realm"] ?? false;
  if (!i.guild) { await i.reply({ content: "Server only / Serveur seulement.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
  const memberRoleId = currentGuildScope()?.memberRoleId;
  if (memberRoleId && !actor.permissions.has(PermissionFlagsBits.Administrator) && !actor.roles.cache.has(memberRoleId)) {
    throw new Error("Current guild member role required / Rôle de membre actuel requis.");
  }
  const fr = await teamLanguage(prisma, ctx.guildId);
  const t = (en: string, french: string) => fr ? french : en;
  const sub = command?.options.getSubcommand() ?? input?.action ?? "";
  if (["create", "manage"].includes(sub) && !hasPermission(actor, "raidLeader")) throw new Error("Raid Leader required / Responsable de raid requis.");
  if (sub === "setup" && !hasPermission(actor, "officer")) throw new Error("Officer required / Officier requis.");
  if (sub === "setup" || sub === "privacy-help") {
    await i.editReply({ content: sub === "setup" ? battlegroundSetupHelp(fr) : battlegroundPrivacyHelp(fr), allowedMentions: { parse: [] } }); return;
  }
  if (sub === "privacy") {
    const capture = command?.options.getBoolean("capture", true) ?? false;
    const guildStats = command?.options.getBoolean("guild-stats", true) ?? false;
    await setBattlegroundConsent(prisma, ctx.guildId, ctx.memberId, { capture, guildStats });
    await i.editReply({ content: `${t("Saved", "Enregistré")} — ${t("capture", "collecte")}: ${capture ? "ON" : "OFF"}; ${t("guild statistics", "statistiques de guilde")}: ${guildStats ? "ON" : "OFF"}.\n${battlegroundPrivacyHelp(fr)}`, allowedMentions: { parse: [] } }); return;
  }
  if (sub === "history" || sub === "result") {
    const rows = await battlegroundHistory(prisma, ctx.guildId, ctx.memberId, sub === "result" ? text("report", true) : undefined);
    if (sub === "result") {
      const id = text("report", true);
      const row = rows.find(row => row.id === id || row.reportId === id);
      if (!row) throw new Error("Own report not found / Rapport personnel introuvable.");
      await i.editReply({ embeds: [battlegroundResultCard(row, fr)], allowedMentions: { parse: [] } }); return;
    }
    const description = rows.length ? rows.map(row => `${escapeMarkdown(row.id)} · ${escapeMarkdown(row.gameEdition)} · ${escapeMarkdown(row.mode)} · ${escapeMarkdown(row.bracket)}\n<t:${Math.floor(row.endedAt.getTime() / 1000)}:f> · ${row.outcome} · ${row.status}`).join("\n\n")
      : t("No personal reports. /bg privacy chooses consent; the paired Companion uploads eligible postmatch reports.", "Aucun rapport personnel. /bg privacy définit votre accord; le Compagnon lié importe les rapports admissibles après match.");
    await i.editReply({ embeds: [new EmbedBuilder().setTitle(t("My recent reports (up to 25)", "Mes rapports récents (25 maximum)")).setDescription(description.slice(0, 4000))
      .setFooter({ text: t("Private · /bg result report:<ID> · /bg correct report:<ID> reason:<reason>", "Privé · /bg result report:<ID> · /bg correct report:<ID> reason:<motif>") })], allowedMentions: { parse: [] } }); return;
  }
  if (sub === "correct") {
    await correctBattlegroundReport(prisma, ctx.guildId, ctx.memberId, text("report", true), text("reason", true));
    await i.editReply({ content: t("Your report is withdrawn from statistics. The correction is retained in your private history.", "Votre rapport est retiré des statistiques. La correction reste dans votre historique privé."), allowedMentions: { parse: [] } }); return;
  }
  if (sub === "stats") {
    const mode = text("mode"), bracket = text("bracket");
    if (!mode || !bracket) {
      await i.editReply({ content: t("Choose one format and the reported API bracket identifier shown in /bg result: /bg stats mode:casual bracket:<identifier>. This is not a verified level range. The current guild edition and season apply; use season:<number> for an earlier season. Formats and brackets are never mixed.", "Choisissez un format et l'identifiant de bracket rapporté par l'API dans /bg result : /bg stats mode:casual bracket:<identifiant>. Ce n'est pas une tranche de niveaux vérifiée. L'édition de guilde et la saison actuelle s'appliquent; season:<numéro> choisit une saison antérieure. Les formats et brackets ne sont jamais mélangés."), allowedMentions: { parse: [] } }); return;
    }
    const guild = await prisma.guild.findUniqueOrThrow({ where: { id: ctx.guildId }, select: { gameEdition: true } });
    const now = new Date();
    const selected = integer("season");
    const season = await prisma.officialSeason.findFirst({ where: { gameEdition: guild.gameEdition, ...(selected ? { number: selected } : { startsAt: { lte: now } }) }, orderBy: { startsAt: "desc" } });
    if (!season) { await i.editReply({ content: t("No season is available for this edition.", "Aucune saison disponible pour cette édition.") }); return; }
    const next = await prisma.officialSeason.findFirst({ where: { gameEdition: guild.gameEdition, startsAt: { gt: season.startsAt } }, orderBy: { startsAt: "asc" } });
    const endsAt = next && next.startsAt < now ? next.startsAt : now;
    if (season.startsAt >= endsAt) { await i.editReply({ content: t("This season has not started.", "Cette saison n'a pas commencé.") }); return; }
    const stats = await battlegroundStats(prisma, ctx.guildId, { edition: guild.gameEdition, ...(mode ? { mode } : {}), ...(bracket ? { bracket } : {}), startsAt: season.startsAt, endsAt });
    await i.editReply({ embeds: [new EmbedBuilder().setTitle(t("Provisional guild participation reports", "Participations de guilde provisoires"))
      .setDescription(`${escapeMarkdown(guild.gameEdition)} · ${t("Season", "Saison")} ${season.number} · ${escapeMarkdown(mode ?? t("All formats", "Tous formats"))} · ${t("API bracket", "Bracket API")}: ${escapeMarkdown(bracket)}\n<t:${Math.floor(season.startsAt.getTime() / 1000)}:d> → <t:${Math.floor(endsAt.getTime() / 1000)}:d>`)
      .addFields({ name: t("Player participations (not unique matches)", "Participations (pas des matchs uniques)"), value: String(stats.participations), inline: true },
        { name: t("Reported wins / losses / draws", "Victoires / défaites / nuls rapportés"), value: `${stats.wins} / ${stats.losses} / ${stats.draws}`, inline: true },
        { name: t("Reported win rate", "Taux de victoire rapporté"), value: stats.winRate === null ? "—" : `${(stats.winRate * 100).toFixed(1)}%`, inline: true },
        { name: t("Known-outcome sample / unknown", "Échantillon connu / résultat inconnu"), value: `${stats.wins + stats.losses + stats.draws} / ${stats.unknownOutcomes}`, inline: true },
        { name: t("Verified unique matches", "Matchs uniques vérifiés"), value: t("Unavailable: adapters and cross-reporter identity are not verified.", "Indisponibles : adaptateurs et identité entre rapporteurs non validés.") })
      .setFooter({ text: t("Opted-in reports only; withdrawn/conflicting reports excluded. Provisional, not official or ranked. No MMR, skill score or competitive points.", "Rapports consentants seulement; retraits et conflits exclus. Provisoire, sans classement officiel. Aucun MMR, score de talent ou point compétitif.") })], allowedMentions: { parse: [] } }); return;
  }
  if (sub === "panel") {
    await i.editReply({ components: [battlegroundPanel(fr, ctx.guildId), battlegroundRecordPanel(fr, ctx.guildId)], embeds: [new EmbedBuilder().setTitle(t("Battlegrounds", "Champs de bataille")).setDescription(t(
      "Create: /bg create\nJoin: /bg upcoming → /bg join\nMy groups: /bg mine\nDetails: /bg view\nLeave: /bg leave\n\nMy results: /bg history · Privacy: /bg privacy\nGuild statistics: /bg stats\nPrivate planning and opt-in reports. No automatic posts or awards. Unverified queue formats cannot start; provisional reports are excluded from verified statistics.",
      "Créer : /bg create\nRejoindre : /bg upcoming → /bg join\nMes groupes : /bg mine\nDétails : /bg view\nQuitter : /bg leave\n\nMes résultats : /bg history · Confidentialité : /bg privacy\nStatistiques de guilde : /bg stats\nPlanification privée et rapports avec accord. Aucun message automatique ni récompense. Les formats non vérifiés ne démarrent pas; les rapports provisoires restent hors des statistiques vérifiées."))] });
    return;
  }
  if (sub === "create") {
    const channel = await requireTeamChannel(i.guild, command?.options.getChannel("channel", true).id ?? input?.channelId ?? i.channelId ?? "", actor);
    if (!normalRealm()) throw new Error("Hardcore BG disabled / JcJ Hardcore désactivé.");
    const start = text("start", true);
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start)) throw new Error("Include timezone offset / Incluez le décalage horaire.");
    const guild = await prisma.guild.findUniqueOrThrow({ where: { id: ctx.guildId }, select: { gameEdition: true } });
    const mode = text("mode", true);
    const session = await createBattleground(prisma, ctx.guildId, {
      name: text("name", true), channelId: channel.id, startsAt: new Date(start), durationMinutes: 120,
      tanks: integer("tanks") ?? 0, healers: integer("healers") ?? 1, dps: integer("dps") ?? (mode === "blitz" ? 1 : 4),
      plan: { version: 1, edition: guild.gameEdition, realmType: "normal", mode, map: text("map", true),
        minLevel: integer("min-level", true), maxLevel: integer("max-level", true), faction: text("faction", true) },
    });
    await i.editReply({ content: t(`Created planning session ${session.id}. View /bg view; join /bg join.`, `Séance créée : ${session.id}. Voir /bg view; inscription /bg join.`), allowedMentions: { parse: [] } });
    return;
  }
  if (sub === "mine" || sub === "upcoming") {
    const sessions = await prisma.activitySession.findMany({ where: {
      core: { guildId: ctx.guildId, archived: false, battlegroundPlan: { not: Prisma.DbNull } },
      status: { in: ["PLANNED", "ACTIVE"] }, endsAt: { gt: new Date() },
      ...(sub === "mine" ? { responses: { some: { memberId: ctx.memberId, status: { in: ["CONFIRMED", "WAITLISTED", "TENTATIVE"] } } } } : {}),
    }, include: sessionInclude, orderBy: { scheduledAt: "asc" }, take: 100 });
    const visible = [];
    for (const session of sessions) {
      try { await requireTeamChannel(i.guild, session.core.channelId, actor); visible.push(session); } catch { /* private/deleted channel */ }
      if (visible.length === 5) break;
    }
    await i.editReply(visible.length ? { embeds: [new EmbedBuilder().setTitle(t("Upcoming groups", "Groupes à venir")).setDescription(visible.map(s => `${escapeMarkdown(s.core.name)} · <t:${Math.floor(s.scheduledAt.getTime() / 1000)}:F>\n/bg view session:${s.id}`).join("\n\n"))], allowedMentions: { parse: [] } }
      : { content: t("No upcoming groups you can access.", "Aucun groupe à venir accessible.") });
    return;
  }
  const id = text("session", true);
  const session = await prisma.activitySession.findFirst({ where: { id, core: { guildId: ctx.guildId, battlegroundPlan: { not: Prisma.DbNull } } }, include: sessionInclude });
  if (!session) throw new Error("BG session not found / Séance JcJ introuvable.");
  await requireTeamChannel(i.guild, session.core.channelId, actor);
  if (sub === "join" || sub === "leave") {
    const result = await respondToSession(prisma, ctx.guildId, id, ctx.memberId, sub === "leave" ? "ABSENT" : "CONFIRMED",
      text("role") as RaidRole | null, text("character"), new Date(), sub === "join"
        ? { normalRealm: normalRealm(), faction: text("faction", true) } : undefined);
    await i.editReply({ content: result.response.status === "WAITLISTED" ? t("On the waiting list.", "En attente.") : sub === "leave" ? t("Withdrawn.", "Inscription retirée.") : t("Signup confirmed.", "Inscription confirmée.") });
  } else if (sub === "manage") {
    await manageSession(prisma, ctx.guildId, id, text("action", true) as "open" | "close" | "start" | "cancel" | "complete");
    await i.editReply({ content: t("Session updated.", "Séance mise à jour.") });
  } else await i.editReply({ embeds: [teamSessionEmbed(session, fr)], allowedMentions: { parse: [] } });
}

export const BG_PREFIX = "bgui:";
export function battlegroundPanel(fr: boolean, guildId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[["create", fr ? "Créer" : "Create"], ["join", fr ? "Rejoindre" : "Join"], ["mine", fr ? "Mes groupes" : "My groups"], ["upcoming", fr ? "À venir" : "Upcoming"]].map(([id, label]) =>
      new ButtonBuilder().setCustomId(`${BG_PREFIX}${guildId}:${id}`).setLabel(label!).setStyle(ButtonStyle.Secondary)));
}

function bgField(id: string, label: string, placeholder: string, maxLength: number) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label)
    .setStyle(TextInputStyle.Short).setPlaceholder(placeholder).setRequired(true).setMaxLength(maxLength));
}

export function battlegroundCreateModal(mode: string, faction: string, fr: boolean, guildId: string) {
  return new ModalBuilder().setCustomId(`${BG_PREFIX}${guildId}:create-form:${mode}:${faction}`).setTitle(fr ? "Planifier un champ de bataille" : "Plan a battleground")
    .addComponents(bgField("name", fr ? "Nom du groupe" : "Group name", fr ? "Groupe du vendredi" : "Friday group", 50),
      bgField("map", fr ? "Carte ou file aléatoire" : "Map or random queue", fr ? "Aléatoire" : "Random", 70),
      bgField("start", fr ? "Début avec décalage horaire" : "Start with timezone offset", "2026-11-05T20:00:00-05:00", 40),
      bgField("levels", fr ? "Niveaux minimum-maximum" : "Minimum-maximum levels", mode === "blitz" ? "90-90" : "10-19", 7),
      bgField("roles", fr ? "Places tank/soigneur/DPS" : "Tank/healer/DPS slots", mode === "blitz" ? "0/1/1" : "0/1/4", 8));
}

export function battlegroundJoinModal(fr: boolean, guildId: string) {
  return new ModalBuilder().setCustomId(`${BG_PREFIX}${guildId}:join-form`).setTitle(fr ? "Rejoindre un groupe" : "Join a group")
    .addComponents(bgField("session", fr ? "ID de séance (/bg upcoming)" : "Session ID (/bg upcoming)", "c...", 40),
      bgField("character", fr ? "Votre personnage-royaume" : "Your character-realm", "Name-Realm", 120),
      bgField("role", fr ? "Rôle : TANK, HEALER ou DPS" : "Role: TANK, HEALER or DPS", "DPS", 6),
      bgField("faction", "Faction : Alliance / Horde", "Alliance", 8),
      bgField("normal", fr ? "Sans Hardcore : écrivez normal" : "Not Hardcore: type normal", "normal", 6));
}

export function battlegroundFormInput(i: Pick<ModalSubmitInteraction, "customId" | "fields" | "channelId">): BgInput {
  const field = (key: string) => i.fields.getTextInputValue(key).trim();
  const actionId = i.customId.replace(/^bgui:[^:]+:/, "bgui:");
  if (actionId === `${BG_PREFIX}join-form`) return { action: "join", strings: {
    session: field("session"), character: field("character"), role: field("role").toUpperCase(),
    faction: /^alliance$/i.test(field("faction")) ? "Alliance" : /^horde$/i.test(field("faction")) ? "Horde" : field("faction"),
  }, booleans: { "normal-realm": field("normal").toLowerCase() === "normal" } };
  const match = /^bgui:create-form:(casual|rated|blitz):(Alliance|Horde)$/.exec(actionId);
  if (!match) throw new Error("Invalid BG form / Formulaire JcJ invalide.");
  const levels = /^(\d{2})\s*-\s*(\d{2})$/.exec(field("levels"));
  const roles = /^(\d)\s*\/\s*(\d)\s*\/\s*(\d)$/.exec(field("roles"));
  if (!levels || !roles) throw new Error("Use levels 10-19 and roles 0/1/4 / Niveaux 10-19 et rôles 0/1/4.");
  return { action: "create", channelId: i.channelId ?? undefined, strings: {
    name: field("name"), map: field("map"), start: field("start"), mode: match[1]!, faction: match[2]!,
  }, integers: { "min-level": Number(levels[1]), "max-level": Number(levels[2]), tanks: Number(roles[1]), healers: Number(roles[2]), dps: Number(roles[3]) },
    booleans: { "normal-realm": true } }; // The preceding selector explicitly confirms normal realm.
}

export async function handleBattlegroundComponent(i: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction) {
  const action = i.customId.split(":").slice(2).join(":");
  if (i.isModalSubmit()) { await executeBattleground(i, battlegroundFormInput(i)); return; }
  if (i.isButton() && ["mine", "upcoming", "history", "stats", "privacy-help", "setup"].includes(action)) {
    await executeBattleground(i, { action: action }); return;
  }
  const ctx = await requireGuildContext(i);
  if (!ctx || !i.guild) return;
  const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
  await requireTeamChannel(i.guild, i.channelId, actor);
  const fr = await teamLanguage(prisma, ctx.guildId);
  if (i.isButton() && action === "join") { await i.showModal(battlegroundJoinModal(fr, ctx.guildId)); return; }
  if (!hasPermission(actor, "raidLeader")) throw new Error("Raid Leader required / Responsable de raid requis.");
  if (i.isButton() && action === "create") {
    await i.reply({ flags: MessageFlags.Ephemeral, content: fr
      ? "Choisissez le format et la faction. Ce choix confirme un royaume normal (sans Hardcore). Le salon actuel définit l'accès au groupe. Aucun message public ne sera envoyé."
      : "Choose format and faction. This confirms a normal realm (not Hardcore). The current channel defines group access. No public post will be sent.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${BG_PREFIX}${ctx.guildId}:format`)
      .setPlaceholder(fr ? "Format · faction · royaume normal" : "Format · faction · normal realm")
      .addOptions(...["casual", "rated", "blitz"].flatMap(mode => ["Alliance", "Horde"].map(faction => ({ label: `${mode} · ${faction}`, value: `${mode}:${faction}` })))))] });
    return;
  }
  if (i.isStringSelectMenu() && action === "format") {
    const match = /^(casual|rated|blitz):(Alliance|Horde)$/.exec(i.values[0] ?? "");
    if (!match) throw new Error("Invalid BG format / Format JcJ invalide.");
    await i.showModal(battlegroundCreateModal(match[1]!, match[2]!, fr, ctx.guildId)); return;
  }
  throw new Error("Unknown BG control / Contrôle JcJ inconnu.");
}
