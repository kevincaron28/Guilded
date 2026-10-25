import { guildWhere } from "../services/guild-scope.js";
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { botOwnerId } from "./owner-season.js";
import { EVENT_GAMES, EVENT_REGIONS, EVENT_STATES, EVENT_TRANSACTION_OPTIONS, GameEventInputError, eventBoardEmbeds, eventLock, eventText, parseEventInstant, saveOfficialEvent } from "../services/game-events.js";
import { eventChannel, eventRole } from "../services/game-events-discord.js";
import { enqueueDiscordJob } from "../services/discord-jobs.js";

const gameChoices = EVENT_GAMES.map(value => ({ name: value === "POE2" ? "Path of Exile 2" : "WoW Forever", value }));
const regions = EVENT_REGIONS.filter(value => value !== "GLOBAL").map(value => ({ name: value, value }));
export const gameEventsCommand = new SlashCommandBuilder().setName("events")
  .setDescription("Manage the Upcoming Events board and opt-in game reminders.")
  .setDescriptionLocalizations({ fr: "Gérer le tableau des événements et les rappels de jeu volontaires." })
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s.setName("board").setDescription("Enable/update one board in this channel. Reminders stay off initially.")
    .addChannelOption(o => o.setName("channel").setDescription("Board channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName("games").setDescription("Games to show").setRequired(true).addChoices(...gameChoices, { name: "Both / Les deux", value: "BOTH" }))
    .addStringOption(o => o.setName("region").setDescription("WoW region (name reservation times differ)").setRequired(true).addChoices(...regions)))
  .addSubcommand(s => s.setName("reminders").setDescription("Set opt-in reminders for a game; off disables them.")
    .addChannelOption(o => o.setName("channel").setDescription("Configured board channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName("game").setDescription("Game").setRequired(true).addChoices(...gameChoices))
    .addStringOption(o => o.setName("when").setDescription("Reminder times").setRequired(true).addChoices(
      { name: "Off / Désactivés", value: "off" }, { name: "24h", value: "1440" }, { name: "1h", value: "60" }, { name: "Start / Début", value: "0" },
      { name: "24h + 1h", value: "1440,60" }, { name: "24h + start", value: "1440,0" }, { name: "1h + start", value: "60,0" }, { name: "24h + 1h + start", value: "1440,60,0" }))
    .addRoleOption(o => o.setName("role").setDescription("Mentionable game role; never everyone or a staff role"))
    .addBooleanOption(o => o.setName("opt_in_confirmed").setDescription("I confirm members voluntarily chose this role for game reminders")))
  .addSubcommand(s => s.setName("disable").setDescription("Disable/unpin this board and stop its reminders.")
    .addChannelOption(o => o.setName("channel").setDescription("Configured board channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand(s => s.setName("status").setDescription("Preview a board and its current settings.")
    .addChannelOption(o => o.setName("channel").setDescription("Configured board channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand(s => s.setName("refresh").setDescription("Repair/recreate a missing board without enabling reminders.")
    .addChannelOption(o => o.setName("channel").setDescription("Configured board channel").addChannelTypes(ChannelType.GuildText).setRequired(true)));

export const OWNER_EVENTS_COMMAND = "guilded-events";
export const ownerEventsCommand = new SlashCommandBuilder().setName(OWNER_EVENTS_COMMAND)
  .setDescription("Bot owner: manage the official game event catalogue.")
  .setDescriptionLocalizations({ fr: "Propriétaire du bot : gérer le calendrier officiel des jeux." })
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(s => s.setName("list").setDescription("List event IDs and states, including archived events."))
  .addSubcommand(s => s.setName("save").setDescription("Add/edit an event using a verified official announcement.")
    .addStringOption(o => o.setName("id").setDescription("Stable event ID (lowercase letters, digits, hyphens)").setRequired(true).setMaxLength(60))
    .addStringOption(o => o.setName("game").setDescription("Game").setRequired(true).addChoices(...gameChoices))
    .addStringOption(o => o.setName("title_en").setDescription("English title").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("title_fr").setDescription("French title").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("source").setDescription("Official announcement HTTPS link").setRequired(true).setMaxLength(220))
    .addStringOption(o => o.setName("state").setDescription("State").setRequired(true).addChoices(...EVENT_STATES.map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("region").setDescription("Region; default GLOBAL").addChoices(...EVENT_REGIONS.map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("instant").setDescription("Verified ISO date with offset, e.g. 2026-11-04T23:00:00Z"))
    .addStringOption(o => o.setName("date_en").setDescription("Known date/window in English when exact time is TBA").setMaxLength(100))
    .addStringOption(o => o.setName("date_fr").setDescription("Known date/window in French when exact time is TBA").setMaxLength(100)))
  .addSubcommand(s => s.setName("state").setDescription("Postpone, cancel, or mark TBA; clears the old countdown.")
    .addStringOption(o => o.setName("id").setDescription("Event ID").setRequired(true))
    .addStringOption(o => o.setName("state").setDescription("State").setRequired(true).addChoices(...["POSTPONED", "CANCELLED", "TBA"].map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("source").setDescription("Official announcement supporting the change").setRequired(true).setMaxLength(220)))
  .addSubcommand(s => s.setName("archive").setDescription("Hide a past/cancelled event and stop its reminders.")
    .addStringOption(o => o.setName("id").setDescription("Event ID").setRequired(true)));

export async function executeGameEvents(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !(await guild.members.fetch({ user: interaction.user.id, force: true })).permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "Manage Server is required. / La permission Gérer le serveur est requise.", flags: MessageFlags.Ephemeral }); return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const record = await prisma.guild.findUnique({ where: guildWhere(guild.id), include: { settings: true } });
  if (!record) { await interaction.editReply("Run /setup start first. / Lancez /setup start d’abord."); return; }
  const fr = record.settings?.language === "fr";
  const channelId = interaction.options.getChannel("channel", true).id;
  const sub = interaction.options.getSubcommand();
  try {
    if (sub !== "disable" && sub !== "status") await eventChannel(guild, channelId);
    const board = await prisma.$transaction(async tx => {
      await eventLock(tx);
      let current = await tx.gameEventBoard.findUnique({ where: { guildId_channelId: { guildId: record.id, channelId } } });
      if (sub === "board") {
        const games = interaction.options.getString("games", true);
        const data = { enabled: true, games: games === "BOTH" ? [...EVENT_GAMES] : [games], region: interaction.options.getString("region", true) };
        current = await tx.gameEventBoard.upsert({ where: { guildId_channelId: { guildId: record.id, channelId } },
          create: { guildId: record.id, channelId, ...data }, update: { ...data, ...(!current?.enabled ? { wowRoleId: null, poeRoleId: null, wowReminders: [], poeReminders: [], wowRemindersEnabledAt: null, poeRemindersEnabledAt: null } : {}) } });
      } else if (!current) throw new GameEventInputError(eventText(fr, "Configure /events board first.", "Configurez /events board d’abord."));
      if (!current) throw new Error("Missing board");
      if (sub === "reminders") {
        const game = interaction.options.getString("game", true);
        const when = interaction.options.getString("when", true);
        const offsets = when === "off" ? [] : when.split(",").map(Number);
        let roleId: string | null = null;
        if (offsets.length) {
          if (!current.enabled || !current.games.includes(game)) throw new GameEventInputError(eventText(fr, "Enable this game on the board first.", "Activez ce jeu sur le tableau d’abord."));
          const role = interaction.options.getRole("role");
          if (!role || interaction.options.getBoolean("opt_in_confirmed") !== true) throw new GameEventInputError(eventText(fr, "Select a game role and confirm members opted into reminders.", "Choisissez un rôle de jeu et confirmez l’accord volontaire des membres."));
          await eventRole(guild, role.id, await eventChannel(guild, channelId));
          roleId = role.id;
        }
        current = await tx.gameEventBoard.update({ where: { id: current.id }, data: {
          ...(game === "WOW_FOREVER" ? { wowRoleId: roleId, wowReminders: offsets, wowRemindersEnabledAt: new Date() } : { poeRoleId: roleId, poeReminders: offsets, poeRemindersEnabledAt: new Date() })
        } });
      } else if (sub === "disable") {
        current = await tx.gameEventBoard.update({ where: { id: current.id }, data: { enabled: false, wowRoleId: null, poeRoleId: null, wowReminders: [], poeReminders: [], wowRemindersEnabledAt: null, poeRemindersEnabledAt: null } });
      }
      if (sub !== "status") await enqueueDiscordJob(tx, record.id, `game-board:${current.id}`, "GAME_EVENT_BOARD", { boardId: current.id });
      return current;
    }, EVENT_TRANSACTION_OPTIONS);
    const events = await prisma.officialGameEvent.findMany({ where: { archived: false }, orderBy: { id: "asc" } });
    const job = await prisma.discordJob.findUnique({ where: { guildId_key: { guildId: record.id, key: `game-board:${board.id}` } } });
    const status = `WoW: ${board.wowReminders.join(" / ") || "off"}; PoE2: ${board.poeReminders.join(" / ") || "off"} (${eventText(fr, "minutes before; 0 = start", "minutes avant ; 0 = début")}).`;
    await interaction.editReply({ content: `${sub === "status" ? "" : eventText(fr, "Saved; delivery queued. ", "Enregistré ; publication en attente. ")}${status}\n${eventText(fr, "Delivery", "Publication")}: ${job?.lastError ?? job?.status ?? "—"}`, embeds: eventBoardEmbeds(events, board, fr), allowedMentions: { parse: [] } });
  } catch (error) {
    if (error instanceof GameEventInputError || error instanceof Error && /Event board needs|Choose a mentionable/.test(error.message)) { await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } }); return; }
    throw error;
  }
}

export async function executeOwnerEvents(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.user.id !== await botOwnerId(interaction.client)) {
    await interaction.reply({ content: "Only the bot owner manages official dates. / Seul le propriétaire du bot gère les dates officielles.", flags: MessageFlags.Ephemeral }); return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const str = (name: string) => interaction.options.getString(name, true);
  try {
    if (sub === "save") {
      const instant = interaction.options.getString("instant");
      await saveOfficialEvent(prisma, { id: str("id"), game: str("game"), region: interaction.options.getString("region") ?? "GLOBAL",
        titleEn: str("title_en"), titleFr: str("title_fr"), sourceUrl: str("source"), state: str("state"), startsAt: instant ? parseEventInstant(instant) : null,
        dateLabelEn: interaction.options.getString("date_en") ?? "", dateLabelFr: interaction.options.getString("date_fr") ?? "" }, interaction.user.id);
    } else if (sub === "state") {
      const old = await prisma.officialGameEvent.findUnique({ where: { id: str("id") } });
      if (!old) throw new GameEventInputError("Unknown event. / Événement inconnu.");
      await saveOfficialEvent(prisma, { ...old, state: str("state"), startsAt: null, dateLabelEn: "", dateLabelFr: "", sourceUrl: str("source") }, interaction.user.id);
    } else if (sub === "archive") {
      await prisma.$transaction(async tx => {
        await eventLock(tx);
        await tx.officialGameEvent.update({ where: { id: str("id") }, data: { archived: true, scheduleVersion: { increment: 1 }, updatedBy: interaction.user.id } });
      }, EVENT_TRANSACTION_OPTIONS);
    }
    const events = await prisma.officialGameEvent.findMany({ orderBy: { updatedAt: "desc" }, take: 20 });
    await interaction.editReply({ content: `${sub === "list" ? "" : "Saved; boards refresh within a minute. / Enregistré ; actualisation sous une minute.\n"}${events.map(e => `${e.id} · ${e.archived ? "ARCHIVED" : e.state} · ${e.startsAt?.toISOString() ?? "TBA"}`).join("\n") || "—"}`.slice(0, 1950), allowedMentions: { parse: [] } });
  } catch (error) {
    if (error instanceof GameEventInputError) { await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } }); return; }
    throw error;
  }
}
