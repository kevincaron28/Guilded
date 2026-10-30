import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, escapeMarkdown, MessageFlags, ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext } from "./context.js";
import { createBattleground } from "../services/battleground-organization.js";
import { manageSession, respondToSession, sessionInclude } from "../services/activity-core.js";
import { requireTeamChannel, teamLanguage, teamSessionEmbed } from "../services/activity-core-discord.js";
import { Prisma, type RaidRole } from "../generated/prisma/client.js";

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
  .addSubcommand(s => s.setName("view").setDescription("View group and signup details").addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true)));

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
  const fr = await teamLanguage(prisma, ctx.guildId);
  const t = (en: string, french: string) => fr ? french : en;
  const sub = command?.options.getSubcommand() ?? input?.action ?? "";
  if (["create", "manage"].includes(sub) && !hasPermission(actor, "raidLeader")) throw new Error("Raid Leader required / Responsable de raid requis.");
  if (sub === "panel") {
    await i.editReply({ components: [battlegroundPanel(fr, ctx.guildId)], embeds: [new EmbedBuilder().setTitle(t("Battlegrounds", "Champs de bataille")).setDescription(t(
      "Create: /bg create\nJoin: /bg upcoming → /bg join\nMy groups: /bg mine\nDetails: /bg view\nLeave: /bg leave\n\nPrivate planning. No automatic posts, match capture or awards. Unverified queue formats cannot start.",
      "Créer : /bg create\nRejoindre : /bg upcoming → /bg join\nMes groupes : /bg mine\nDétails : /bg view\nQuitter : /bg leave\n\nPlanification privée. Aucun message automatique, capture ou récompense. Les formats non vérifiés ne peuvent pas démarrer."))] });
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
  if (i.isButton() && ["mine", "upcoming"].includes(action)) {
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
