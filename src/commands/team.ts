import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type SlashCommandStringOption } from "discord.js";
import type { RaidAttendanceStatus, RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { archiveTeam, createTeam, fillTeamSessions, findTeam, manageSession, recordTeamAttendance, removeTeamMember, respondToSession, selectTeamLineup, sessionInclude, setTeamMember, TEAM_ROLES, teamInclude, updateTeamSchedule, type TeamResponse } from "../services/activity-core.js";
import { requireTeamChannel, TEAM_BUTTON_PREFIX, teamLanguage, teamRosterEmbed, teamSessionEmbed, teamText } from "../services/activity-core-discord.js";
import { runDiscordJobs } from "../services/discord-jobs.js";

const teamOption = (o: SlashCommandStringOption) => o.setName("team").setDescription("Team name").setRequired(true).setAutocomplete(true);
const sessionOption = (o: SlashCommandStringOption) => o.setName("session").setDescription("Session").setRequired(true).setAutocomplete(true);
const roleOption = (o: SlashCommandStringOption) => o.setName("role").setDescription("Role").addChoices(
  { name: "Tank", value: "TANK" }, { name: "Healer", value: "HEALER" }, { name: "DPS", value: "DPS" });
export const teamCommand = new SlashCommandBuilder().setName("team").setDescription("Weekly dungeon and PvP cores")
  .setDescriptionLocalizations({ fr: "Cores hebdomadaires de donjon et JcJ" })
  .addSubcommand(s => s.setName("create").setDescription("Create a weekly core (leaders)")
    .addStringOption(o => o.setName("name").setDescription("Team name").setRequired(true).setMinLength(2).setMaxLength(50))
    .addStringOption(o => o.setName("kind").setDescription("Activity").setRequired(true).addChoices({ name: "Dungeon", value: "DUNGEON" }, { name: "PvP / Battleground", value: "PVP" }))
    .addChannelOption(o => o.setName("channel").setDescription("Roster and signups channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("schedule").setDescription("Weekly starts: thu 20h; sat 20h").setRequired(true).setMaxLength(400))
    .addStringOption(o => o.setName("timezone").setDescription("Default: server timezone").setMaxLength(60))
    .addIntegerOption(o => o.setName("minutes").setDescription("Session duration (default 120)").setMinValue(15).setMaxValue(480))
    .addIntegerOption(o => o.setName("tanks").setDescription("PvP tank slots").setMinValue(0).setMaxValue(40))
    .addIntegerOption(o => o.setName("healers").setDescription("PvP healer slots").setMinValue(0).setMaxValue(40))
    .addIntegerOption(o => o.setName("dps").setDescription("PvP DPS slots").setMinValue(0).setMaxValue(40))
    .addStringOption(o => o.setName("goal").setDescription("Dungeons, format or goals").setMaxLength(300)))
  .addSubcommand(s => s.setName("member").setDescription("Add, change or remove a roster member (leaders)")
    .addStringOption(teamOption)
    .addUserOption(o => o.setName("player").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("action").setDescription("Change").setRequired(true).addChoices({ name: "Add / update", value: "add" }, { name: "Remove", value: "remove" }))
    .addStringOption(roleOption)
    .addBooleanOption(o => o.setName("bench").setDescription("Substitute instead of regular"))
    .addStringOption(o => o.setName("character").setDescription("Owned character name or name-realm").setMaxLength(120)))
  .addSubcommand(s => s.setName("schedule").setDescription("Change future scheduling; posted sessions stay (leaders)")
    .addStringOption(teamOption)
    .addStringOption(o => o.setName("schedule").setDescription("Weekly starts, or off to pause").setRequired(true).setMaxLength(400))
    .addStringOption(o => o.setName("timezone").setDescription("IANA timezone").setMaxLength(60))
    .addIntegerOption(o => o.setName("minutes").setDescription("Future session duration").setMinValue(15).setMaxValue(480)))
  .addSubcommand(s => s.setName("show").setDescription("Show the permanent roster").addStringOption(teamOption))
  .addSubcommand(s => s.setName("list").setDescription("List dungeon and PvP teams"))
  .addSubcommand(s => s.setName("sessions").setDescription("Upcoming sessions or recent history").addStringOption(teamOption)
    .addBooleanOption(o => o.setName("history").setDescription("Show recent sessions instead")))
  .addSubcommand(s => s.setName("view").setDescription("View a session and recorded attendance").addStringOption(sessionOption))
  .addSubcommand(s => s.setName("respond").setDescription("Confirm with a character, or change availability").addStringOption(sessionOption)
    .addStringOption(o => o.setName("response").setDescription("Availability").setRequired(true).addChoices(
      { name: "Confirm", value: "CONFIRMED" }, { name: "Absent", value: "ABSENT" }, { name: "Tentative", value: "TENTATIVE" }))
    .addStringOption(roleOption)
    .addStringOption(o => o.setName("character").setDescription("Owned character name or name-realm").setMaxLength(120)))
  .addSubcommand(s => s.setName("session").setDescription("Manage a session (leaders)").addStringOption(sessionOption)
    .addStringOption(o => o.setName("action").setDescription("Action").setRequired(true).addChoices(
      { name: "Open recruitment", value: "open" }, { name: "Close recruitment", value: "close" },
      { name: "Start", value: "start" }, { name: "Complete", value: "complete" }, { name: "Cancel", value: "cancel" }))
    .addStringOption(o => o.setName("result").setDescription("Optional result or completed runs").setMaxLength(500)))
  .addSubcommand(s => s.setName("attendance").setDescription("Record actual attendance; no points awarded (leaders)").addStringOption(sessionOption)
    .addUserOption(o => o.setName("player").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("status").setDescription("Attendance").setRequired(true).addChoices(
      { name: "Present", value: "PRESENT" }, { name: "Late", value: "LATE" }, { name: "Absent", value: "ABSENT" }, { name: "Benched", value: "BENCHED" })))
  .addSubcommand(s => s.setName("lineup").setDescription("Choose players before starting (leaders)").addStringOption(sessionOption)
    .addUserOption(o => o.setName("player").setDescription("Available member").setRequired(true))
    .addStringOption(o => o.setName("selection").setDescription("Lineup priority").setRequired(true).addChoices(
      { name: "Select", value: "SELECTED" }, { name: "Bench", value: "BENCHED" }, { name: "Automatic priority", value: "AUTO" })))
  .addSubcommand(s => s.setName("archive").setDescription("Stop a team and cancel outstanding sessions; keep history (leaders)").addStringOption(teamOption));

const leaderActions = new Set(["create", "member", "schedule", "session", "attendance", "lineup", "archive"]);
async function actor(i: ChatInputCommandInteraction | ButtonInteraction) {
  if (!i.guild) throw new Error("Use this in your server / Utilisez ceci dans votre serveur.");
  return i.guild.members.fetch(i.user.id);
}

function responseMessage(fr: boolean, result: Awaited<ReturnType<typeof respondToSession>>) {
  const statuses: Record<string, string> = { CONFIRMED: teamText(fr, "Confirmed", "Confirmé"), WAITLISTED: teamText(fr, "On the waiting list", "En attente"), ABSENT: teamText(fr, "Marked absent", "Absent"), TENTATIVE: teamText(fr, "Marked tentative", "Incertain") };
  return `${statuses[result.response.status] ?? result.response.status}.` + (result.conflicts.length ? `\n${teamText(fr, "Overlapping team sessions", "Séances en conflit")}: ${result.conflicts.join(", ")}.` : "");
}

export async function executeTeam(i: ChatInputCommandInteraction) {
  // Defer before database/network work, including context creation.
  if (!i.guild) { await i.reply({ content: "Server only / Serveur seulement.", ephemeral: true }); return; }
  await i.deferReply({ ephemeral: true });
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const member = await actor(i);
  const sub = i.options.getSubcommand();
  if (leaderActions.has(sub) && !hasPermission(member, "raidLeader")) throw new Error("Team management requires Raid Leader or higher / Responsable de raid requis.");
  const fr = await teamLanguage(prisma, ctx.guildId);
  const t = (en: string, french: string) => teamText(fr, en, french);
  if (sub === "create") {
    const channel = await requireTeamChannel(i.guild, i.options.getChannel("channel", true).id, member);
    const bot = i.guild.members.me ?? await i.guild.members.fetchMe();
    if (!channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) throw new Error("The bot needs View, Send, Embed Links and Read History in that channel.");
    const settings = await guildService.getSettings(ctx.guildId);
    const core = await createTeam(prisma, ctx.guildId, { name: i.options.getString("name", true), kind: i.options.getString("kind", true), channelId: channel.id,
      goal: i.options.getString("goal"), schedule: i.options.getString("schedule", true), timezone: i.options.getString("timezone") ?? settings?.timezone ?? "America/Toronto",
      durationMinutes: i.options.getInteger("minutes") ?? 120, tanks: i.options.getInteger("tanks"), healers: i.options.getInteger("healers"), dps: i.options.getInteger("dps") });
    await fillTeamSessions(prisma, ctx.guildId, core.id);
    await i.editReply({ content: t(`Created ${core.name}. Add regulars and substitutes with /team member. Posts are queued in <#${core.channelId}>.`, `${core.name} créé. Ajoutez les titulaires et remplaçants avec /team member. Publications en attente dans <#${core.channelId}>.`), allowedMentions: { parse: [] } });
  } else if (sub === "list") {
    const teams = await prisma.activityCore.findMany({ where: { guildId: ctx.guildId, archived: false }, orderBy: { name: "asc" } });
    const visible = [];
    for (const core of teams) if (await requireTeamChannel(i.guild, core.channelId, member).catch(() => null)) visible.push(core);
    await i.editReply({ content: visible.map(c => `• ${c.name} (${c.kind}) · ${c.weeklySchedule ?? t("Paused", "En pause")}`).join("\n").slice(0, 1900) || t("No teams yet. Leaders can use /team create.", "Aucun core. Les responsables peuvent utiliser /team create."), allowedMentions: { parse: [] } });
  } else if (["member", "schedule", "show", "sessions", "archive"].includes(sub)) {
    const core = await findTeam(prisma, ctx.guildId, i.options.getString("team", true));
    await requireTeamChannel(i.guild, core.channelId, member);
    if (sub === "show") {
      await i.editReply({ embeds: [teamRosterEmbed(core, fr)] });
    } else if (sub === "sessions") {
      const history = i.options.getBoolean("history") ?? false;
      const sessions = await prisma.activitySession.findMany({ where: { coreId: core.id, ...(history ? {} : { status: { in: ["PLANNED", "ACTIVE"] }, endsAt: { gt: new Date() } }) }, orderBy: { scheduledAt: history ? "desc" : "asc" }, take: 15 });
      await i.editReply({ content: sessions.map(s => `• <t:${Math.floor(s.scheduledAt.getTime() / 1000)}:F> · ${s.status} · \`${s.id}\``).join("\n") || t("No sessions. Weekly sessions open six days ahead.", "Aucune séance. Les inscriptions ouvrent six jours à l'avance.") });
    } else {
      if (sub === "member") {
        const user = i.options.getUser("player", true);
        if (i.options.getString("action", true) === "remove") {
          const target = await prisma.member.findUnique({ where: { guildId_discordUserId: { guildId: ctx.guildId, discordUserId: user.id } } });
          if (target) await removeTeamMember(prisma, ctx.guildId, core.id, target.id);
        } else {
          const live = await i.guild.members.fetch(user.id);
          if (live.user.bot) throw new Error("Bots cannot join a team.");
          await requireTeamChannel(i.guild, core.channelId, live);
          const target = await guildService.ensureMember(ctx.guildId, user.id, live.displayName);
          const existing = core.members.find(m => m.memberId === target.id);
          await setTeamMember(prisma, ctx.guildId, core.id, target.id, (i.options.getString("role") as RaidRole | null) ?? existing?.role ?? "DPS", i.options.getBoolean("bench") ?? existing?.bench ?? false, i.options.getString("character"));
        }
      } else if (sub === "schedule") {
        await updateTeamSchedule(prisma, ctx.guildId, core.id, i.options.getString("schedule", true), i.options.getString("timezone") ?? core.timezone, i.options.getInteger("minutes") ?? core.durationMinutes);
        await fillTeamSessions(prisma, ctx.guildId, core.id);
      } else await archiveTeam(prisma, ctx.guildId, core.id);
      await i.editReply({ content: sub === "schedule" ? t("Schedule saved. Published sessions keep their times; cancel individual sessions with /team session.", "Horaire enregistré. Les séances publiées gardent leur heure; annulez-les avec /team session.") : t("Team updated. Posts are queued for refresh.", "Core mis à jour. Actualisation des messages en attente.") });
    }
  } else {
    const id = i.options.getString("session", true);
    const session = await prisma.activitySession.findFirst({ where: { id, core: { guildId: ctx.guildId } }, include: sessionInclude });
    if (!session) throw new Error("Session not found in this server / Séance introuvable.");
    await requireTeamChannel(i.guild, session.core.channelId, member);
    if (sub === "view") { await i.editReply({ embeds: [teamSessionEmbed(session, fr)] }); return; }
    if (sub === "respond") {
      const result = await respondToSession(prisma, ctx.guildId, id, ctx.memberId, i.options.getString("response", true) as TeamResponse, i.options.getString("role") as RaidRole | null, i.options.getString("character"));
      await i.editReply({ content: responseMessage(fr, result), allowedMentions: { parse: [] } });
    } else {
      if (sub === "attendance" || sub === "lineup") {
        const target = await prisma.member.findUnique({ where: { guildId_discordUserId: { guildId: ctx.guildId, discordUserId: i.options.getUser("player", true).id } } });
        if (!target) throw new Error("Member not found / Membre introuvable.");
        if (sub === "lineup") await selectTeamLineup(prisma, ctx.guildId, id, target.id, i.options.getString("selection", true) as Parameters<typeof selectTeamLineup>[4]);
        else await recordTeamAttendance(prisma, ctx.guildId, id, target.id, i.options.getString("status", true) as RaidAttendanceStatus);
      } else await manageSession(prisma, ctx.guildId, id, i.options.getString("action", true) as Parameters<typeof manageSession>[3], i.options.getString("result"));
      await i.editReply({ content: t("Session updated. Attendance never awards points automatically.", "Séance mise à jour. Les présences n'attribuent jamais de points automatiquement.") });
    }
  }
  // Delivery is durable; a Discord failure does not undo the saved command.
  await runDiscordJobs(i.client);
}

export async function handleTeamButton(i: ButtonInteraction) {
  if (!i.guild) return;
  await i.deferReply({ ephemeral: true });
  const [id, action] = i.customId.slice(TEAM_BUTTON_PREFIX.length).split(":");
  if (!id || !action || ![...TEAM_ROLES, "ABSENT", "TENTATIVE"].includes(action)) throw new Error("Invalid team button.");
  const guild = await guildService.ensureGuild(i.guild.id, i.guild.name);
  const session = await prisma.activitySession.findFirst({ where: { id, core: { guildId: guild.id } }, include: { core: true } });
  if (!session || i.channelId !== session.core.channelId) throw new Error("Session not found in this channel.");
  const live = await actor(i);
  await requireTeamChannel(i.guild, session.core.channelId, live);
  const member = await guildService.ensureMember(guild.id, i.user.id, live.displayName);
  const role = TEAM_ROLES.includes(action as RaidRole) ? action as RaidRole : null;
  const result = await respondToSession(prisma, guild.id, id, member.id, role ? "CONFIRMED" : action as TeamResponse, role);
  await i.editReply({ content: responseMessage(await teamLanguage(prisma, guild.id), result), allowedMentions: { parse: [] } });
  await runDiscordJobs(i.client);
}

export async function autocompleteTeam(i: AutocompleteInteraction) {
  if (!i.guild) { await i.respond([]); return; }
  const record = await prisma.guild.findUnique({ where: { discordId: i.guild.id } });
  if (!record) { await i.respond([]); return; }
  const member = await i.guild.members.fetch(i.user.id);
  const focus = i.options.getFocused(true);
  const teams = await prisma.activityCore.findMany({ where: { guildId: record.id }, include: teamInclude, orderBy: { name: "asc" } });
  const visible: string[] = [];
  for (const core of teams) if (await requireTeamChannel(i.guild, core.channelId, member).catch(() => null)) visible.push(core.id);
  const query = String(focus.value).toLowerCase();
  if (focus.name === "team") {
    await i.respond(teams.filter(c => visible.includes(c.id) && c.name.toLowerCase().includes(query)).slice(0, 25).map(c => ({ name: `${c.name}${c.archived ? " (archived)" : ""}`.slice(0, 100), value: c.id })));
  } else {
    const sessions = await prisma.activitySession.findMany({ where: { coreId: { in: visible } }, include: { core: true }, orderBy: { scheduledAt: "desc" }, take: 100 });
    await i.respond(sessions.map(s => ({ name: `${s.core.name} · ${new Intl.DateTimeFormat("en-CA", { timeZone: s.core.timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(s.scheduledAt)} · ${s.status}`.slice(0, 100), value: s.id }))
      .filter(s => `${s.name} ${s.value}`.toLowerCase().includes(query)).slice(0, 25));
  }
}
