import { ChannelType, EmbedBuilder, escapeMarkdown, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
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

export async function executeBattleground(i: ChatInputCommandInteraction) {
  if (!i.guild) { await i.reply({ content: "Server only / Serveur seulement.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const actor = await i.guild.members.fetch(i.user.id);
  const fr = await teamLanguage(prisma, ctx.guildId);
  const t = (en: string, french: string) => fr ? french : en;
  const sub = i.options.getSubcommand();
  if (["create", "manage"].includes(sub) && !hasPermission(actor, "raidLeader")) throw new Error("Raid Leader required / Responsable de raid requis.");
  if (sub === "panel") {
    await i.editReply({ embeds: [new EmbedBuilder().setTitle(t("Battlegrounds", "Champs de bataille")).setDescription(t(
      "Create: /bg create\nJoin: /bg upcoming → /bg join\nMy groups: /bg mine\nDetails: /bg view\nLeave: /bg leave\n\nPrivate planning. No automatic posts, match capture or awards. Unverified queue formats cannot start.",
      "Créer : /bg create\nRejoindre : /bg upcoming → /bg join\nMes groupes : /bg mine\nDétails : /bg view\nQuitter : /bg leave\n\nPlanification privée. Aucun message automatique, capture ou récompense. Les formats non vérifiés ne peuvent pas démarrer."))] });
    return;
  }
  if (sub === "create") {
    const channel = await requireTeamChannel(i.guild, i.options.getChannel("channel", true).id, actor);
    if (!i.options.getBoolean("normal-realm", true)) throw new Error("Hardcore BG disabled / JcJ Hardcore désactivé.");
    const start = i.options.getString("start", true);
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start)) throw new Error("Include timezone offset / Incluez le décalage horaire.");
    const guild = await prisma.guild.findUniqueOrThrow({ where: { id: ctx.guildId }, select: { gameEdition: true } });
    const mode = i.options.getString("mode", true);
    const session = await createBattleground(prisma, ctx.guildId, {
      name: i.options.getString("name", true), channelId: channel.id, startsAt: new Date(start), durationMinutes: 120,
      tanks: i.options.getInteger("tanks") ?? 0, healers: i.options.getInteger("healers") ?? 1, dps: i.options.getInteger("dps") ?? (mode === "blitz" ? 1 : 4),
      plan: { version: 1, edition: guild.gameEdition, realmType: "normal", mode, map: i.options.getString("map", true),
        minLevel: i.options.getInteger("min-level", true), maxLevel: i.options.getInteger("max-level", true), faction: i.options.getString("faction", true) },
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
  const id = i.options.getString("session", true);
  const session = await prisma.activitySession.findFirst({ where: { id, core: { guildId: ctx.guildId, battlegroundPlan: { not: Prisma.DbNull } } }, include: sessionInclude });
  if (!session) throw new Error("BG session not found / Séance JcJ introuvable.");
  await requireTeamChannel(i.guild, session.core.channelId, actor);
  if (sub === "join" || sub === "leave") {
    const result = await respondToSession(prisma, ctx.guildId, id, ctx.memberId, sub === "leave" ? "ABSENT" : "CONFIRMED",
      i.options.getString("role") as RaidRole | null, i.options.getString("character"), new Date(), sub === "join"
        ? { normalRealm: i.options.getBoolean("normal-realm", true), faction: i.options.getString("faction", true) } : undefined);
    await i.editReply({ content: result.response.status === "WAITLISTED" ? t("On the waiting list.", "En attente.") : sub === "leave" ? t("Withdrawn.", "Inscription retirée.") : t("Signup confirmed.", "Inscription confirmée.") });
  } else if (sub === "manage") {
    await manageSession(prisma, ctx.guildId, id, i.options.getString("action", true) as "open" | "close" | "start" | "cancel" | "complete");
    await i.editReply({ content: t("Session updated.", "Séance mise à jour.") });
  } else await i.editReply({ embeds: [teamSessionEmbed(session, fr)], allowedMentions: { parse: [] } });
}
