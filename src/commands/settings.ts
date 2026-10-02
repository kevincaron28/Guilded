import { prisma } from "../database.js";
import { syncAllCoreRosters } from "../services/raid-core.js";
import { asLootMode, LOOT_MODE_HELP, LOOT_MODE_LABEL, LOOT_MODES } from "../services/core-rules.js";
import { updateDungeonLeaderboard } from "../services/dungeon-leaderboard.js";
import { ensureDungeonSignupGuide } from "../services/dungeon-guide.js";
import { ChannelType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { permissionRoles, hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { sendWelcome, welcomeDelivery } from "../services/housekeeping.js";
import { isValidTimeZone } from "../services/raid-time.js";
import { BRAND } from "../brand.js";
import { config } from "../config.js";
import { createWclClient, parseGuildRef } from "../integrations/warcraftlogs.js";
import { ensureBotGuide } from "./setup.js";
import { asLang } from "../i18n.js";

export const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription(`View or update ${BRAND.name} guild settings.`)
  .addSubcommand((subcommand) => subcommand
    .setName("view")
    .setDescription("View current guild settings."))
  .addSubcommand((subcommand) => subcommand
    .setName("set")
    .setDescription("Update one guild setting.")
    .addStringOption((option) => option
      .setName("setting")
      .setDescription("Setting to update")
      .setRequired(true)
      .addChoices(
        { name: "Attendance DKP", value: "attendanceDkp" },
        { name: "Late attendance DKP", value: "lateAttendanceDkp" },
        { name: "Boss kill DKP", value: "bossKillDkp" },
        { name: "Minimum bid", value: "minimumBid" },
        { name: "Bid increment", value: "bidIncrement" },
        { name: "Auction duration (seconds)", value: "auctionDurationSec" },
        { name: "EPGP decay percent (0-100)", value: "epgpDecayPercent" },
        { name: "EPGP base GP (PR = EP / (GP + base))", value: "baseGp" },
        { name: "Raid reminder minutes before start (0 = off)", value: "raidReminderMinutes" },
        { name: "EP bonus for a full clear", value: "epCompletionBonus" }
      ))
    .addIntegerOption((option) => option.setName("value").setDescription("New non-negative value").setMinValue(0).setRequired(true)))
  .addSubcommand((sub) => sub.setName("welcome").setDescription("Configure the welcome message for new members.")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel to post welcome messages in")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName("message").setDescription("Template. Variables: {mention} {username} {guild} {membercount}").setMaxLength(1000))
    .addStringOption((o) => o.setName("send_to").setDescription("Where new members get it")
      .addChoices({ name: "Channel", value: "CHANNEL" }, { name: "Private message (DM)", value: "DM" }, { name: "Both", value: "BOTH" }))
    .addStringOption((o) => o.setName("role_prompt").setDescription("Text above the game menu, e.g. Which game are you here for?").setMaxLength(300))
    .addBooleanOption((o) => o.setName("preview").setDescription("Send me the welcome exactly as a new member gets it"))
    .addBooleanOption((o) => o.setName("disable").setDescription("Turn off welcome messages")))
  .addSubcommand((sub) => sub.setName("farewell").setDescription("Configure the farewell message for departing members.")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel to post farewell messages in")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName("message").setDescription("Template. Variables: {username} {guild} {membercount}").setMaxLength(1000))
    .addBooleanOption((o) => o.setName("disable").setDescription("Turn off farewell messages")))
  .addSubcommand((sub) => sub.setName("roles").setDescription("Configure automatic role assignment.")
    .addRoleOption((o) => o.setName("applicant").setDescription("Role auto-assigned when someone joins the Discord server"))
    .addRoleOption((o) => o.setName("member").setDescription("Role assigned automatically when an application is approved")))
  .addSubcommand((sub) => sub.setName("channel").setDescription("Choose which channel the bot posts to.")
    .addStringOption((o) => o.setName("which").setDescription("Which channel to set").setRequired(true).addChoices(
      { name: "Announcements (raids, bosses, loot, EPGP)", value: "notify-channel" },
      { name: "Raid signups and reminders", value: "raid-channel" },
      { name: "Officer log (joins, leaves, moderation)", value: "log-channel" },
      { name: "Raid core rosters", value: "core-channel" },
      { name: "Raid readiness (private)", value: "readiness-channel" },
      { name: "Craft board", value: "craft-channel" },
      { name: "Dungeon runs and records", value: "dungeon-channel" },
      { name: "Dungeon leaderboard", value: "dungeon-leaderboard-channel" },
      { name: "Dungeon signups", value: "dungeon-signup-channel" },
      { name: "Applications (private)", value: "application-channel" },
      { name: "Bot guide", value: "guide" }))
    .addChannelOption((o) => o.setName("channel").setDescription("The channel (a forum works for the craft board)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum))
    .addBooleanOption((o) => o.setName("disable").setDescription("Clear this setting")))
  .addSubcommand((sub) => sub.setName("timezone").setDescription("Timezone for typing raid times (e.g. America/Toronto). /setup has a picker too.")
    .addStringOption((o) => o.setName("zone").setDescription("IANA name, e.g. America/Toronto, Europe/Paris").setRequired(true)))
  .addSubcommand((sub) => sub.setName("weekly-report").setDescription("Post a weekly guild activity report in the notify channel.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("Turn the weekly report on or off").setRequired(true)))
  .addSubcommand((sub) => sub.setName("auto-import").setDescription("Apply addon uploads from the companion by itself (no /import apply).")
    .addBooleanOption((o) => o.setName("enabled").setDescription("Apply uploads automatically").setRequired(true)))
  .addSubcommand((sub) => sub.setName("wcl-guild").setDescription("Warcraft Logs: find the guild's new reports by itself and check them against attendance.")
    .addStringOption((o) => o.setName("guild").setDescription("The guild's page link on warcraftlogs.com (.../guild/id/12345) or its number"))
    .addBooleanOption((o) => o.setName("off").setDescription("Stop looking for new reports")))
  .addSubcommand((sub) => sub.setName("loot-mode").setDescription("How loot is decided by default. A raid core can choose its own with /core rules or /core setup.")
    .addStringOption((o) => o.setName("mode").setDescription("Loot system").setRequired(true).addChoices(
      ...LOOT_MODES.map((mode) => ({ name: `${LOOT_MODE_LABEL[mode]}`, value: mode })))))
  .addSubcommand((sub) => sub.setName("merit").setDescription("Rank /epgp leaderboard by PR x 30-day attendance instead of raw PR.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("Use merit ranking").setRequired(true)));

export async function executeConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  let subcommand = interaction.options.getSubcommand();
  // One "channel" command with a choice; the code below is keyed by the choice.
  if (subcommand === "channel") {
    subcommand = interaction.options.getString("which", true);
    const picked = interaction.options.getChannel("channel");
    if (picked?.type === ChannelType.GuildForum && subcommand !== "craft-channel") {
      throw new Error("A forum channel only works for the craft board. Pick a text channel for this one.");
    }
  }
  const settings = await guildService.getSettings(context.guildId);
  if (!settings) throw new Error("Guild settings have not been initialized.");
  if (subcommand === "view") {
    await interaction.reply({
      content: [
        `Attendance: ${settings.attendanceDkp} DKP`,
        `Late attendance: ${settings.lateAttendanceDkp} DKP`,
        `Boss kill: ${settings.bossKillDkp} DKP`,
        `Minimum bid: ${settings.minimumBid} DKP`,
        `Bid increment: ${settings.bidIncrement} DKP`,
        `Auction duration: ${settings.auctionDurationSec}s`,
        `EPGP decay: ${(settings.epgpDecayPercent * 100).toFixed(0)}% (run \`/epgp decay\` to apply)`,
        `EPGP base GP: ${settings.baseGp} (PR = EP / (GP + base))`,
        `Full-clear EP bonus: ${settings.epCompletionBonus}`,
        `Raid reminders: ${settings.raidReminderMinutes > 0 ? `${settings.raidReminderMinutes} min before start` : "off"}`,
        `Notifications: ${settings.notifyChannelId ? `<#${settings.notifyChannelId}>` : "disabled"}`,
        `Dungeon posts: ${settings.dungeonChannelId ? `<#${settings.dungeonChannelId}>` : "notify channel"}`,
        "Raid reports and loot logs: each raid core's own channels",
        `Auto-apply addon uploads: ${settings.autoApplyImports ? "on" : "off (officers run /import apply)"}`,
        settings.coreLootOnly ? "Butin : chaque core choisit sa méthode; EP/GP et prix séparés (/core edit)." : `Loot system: ${LOOT_MODE_LABEL[asLootMode(settings.lootMode)]} (cores can differ: /core rules)`,
        `WoW weekly report: ${settings.weeklyReportChannelId ? `<#${settings.weeklyReportChannelId}>` : "notify channel"}`,
        `Raid roster channel: ${settings.coreChannelId ? `<#${settings.coreChannelId}>` : "not set"}`,
        `Readiness channel: ${settings.readinessChannelId ? `<#${settings.readinessChannelId}>` : "not set"}`,
        `Applications channel: ${settings.applicationChannelId ? `<#${settings.applicationChannelId}>` : "officer log"}`,
        `Craft board: ${settings.craftChannelId ? `<#${settings.craftChannelId}>` : "officer log"}`,
        `Dungeon leaderboard: ${settings.dungeonLeaderboardChannelId ? `<#${settings.dungeonLeaderboardChannelId}>` : "not set"}`,
        `Dungeon signups: ${settings.dungeonSignupChannelId ? `<#${settings.dungeonSignupChannelId}>` : "not set"}`,
        `Welcome messages: ${settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : "disabled"}`,
        `Farewell messages: ${settings.farewellChannelId ? `<#${settings.farewellChannelId}>` : "disabled"}`,
        `Applicant role: ${settings.applicantRoleId ? `<@&${settings.applicantRoleId}>` : "not set"}`,
        `Member role: ${settings.memberRoleId ? `<@&${settings.memberRoleId}>` : "not set"}`,
        `Raid signup channel: ${settings.raidSignupChannelId ? `<#${settings.raidSignupChannelId}>` : "disabled"}`,
        `Log channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : "disabled"}`,
        `Merit ranking: ${settings.meritEnabled ? "on" : "off"}`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (!interaction.guild || !interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
    await interaction.reply({
      content: `Only members with the ${permissionRoles.officer} role can change settings.`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "welcome") {
    if (interaction.options.getBoolean("disable")) {
      await guildService.updateSettings(context.guildId, { welcomeChannelId: null, welcomeMessageTemplate: null, welcomeDelivery: "CHANNEL" });
      await interaction.reply({ content: "Welcome messages disabled.", ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    const message = interaction.options.getString("message");
    const sendTo = interaction.options.getString("send_to");
    const prompt = interaction.options.getString("role_prompt");
    const updated = await guildService.updateSettings(context.guildId, {
      ...(channel ? { welcomeChannelId: channel.id } : {}),
      ...(message === null ? {} : { welcomeMessageTemplate: message }),
      ...(sendTo === null ? {} : { welcomeDelivery: sendTo }),
      ...(prompt === null ? {} : { welcomeRolePrompt: prompt })
    });
    if (interaction.options.getBoolean("preview") && interaction.guild) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const result = await sendWelcome(interaction.guild, member, updated);
      await interaction.reply({
        content: result.dm || result.channel
          ? `Preview sent${result.dm ? " to your DMs" : ""}${result.dm && result.channel ? " and" : ""}${result.channel ? ` in <#${updated.welcomeChannelId}>` : ""}.`
          : "Nothing was sent: pick a channel, or choose send_to: Private message (DM). If you chose DM, your DMs from server members may be closed.",
        ephemeral: true
      });
      return;
    }
    const where = welcomeDelivery(updated) === "DM" ? "by private message"
      : welcomeDelivery(updated) === "BOTH" ? `by private message and in ${updated.welcomeChannelId ? `<#${updated.welcomeChannelId}>` : "(no channel set yet)"}`
        : updated.welcomeChannelId ? `in <#${updated.welcomeChannelId}>` : "nowhere yet (pick a channel or send_to: DM)";
    await interaction.reply({ content: `Welcome messages go ${where}. Game roles: ${updated.welcomeRoleIds.length ? updated.welcomeRoleIds.map((id) => `<@&${id}>`).join(", ") : "none (pick them in /setup start, step 5)"}. Try \`/setup config welcome preview:true\`.`, ephemeral: true });
    return;
  }

  if (subcommand === "farewell") {
    const disable = interaction.options.getBoolean("disable");
    if (disable) {
      await guildService.updateSettings(context.guildId, { farewellChannelId: null, farewellMessageTemplate: null });
      await interaction.reply({ content: "Farewell messages disabled.", ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    const message = interaction.options.getString("message");
    if (!channel) throw new Error("Provide a channel, or use disable:true to turn messages off.");
    await guildService.updateSettings(context.guildId, { farewellChannelId: channel.id, ...(message === null ? {} : { farewellMessageTemplate: message }) });
    await interaction.reply({ content: `Farewell messages will post in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === "log-channel") {
    if (interaction.options.getBoolean("disable")) {
      await guildService.updateSettings(context.guildId, { logChannelId: null });
      await interaction.reply({ content: "Logging disabled.", ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) throw new Error("Provide a channel, or use disable:true to turn logging off.");
    await guildService.updateSettings(context.guildId, { logChannelId: channel.id });
    await interaction.reply({ content: `Logs will post in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === "timezone") {
    const zone = interaction.options.getString("zone", true).trim();
    if (!isValidTimeZone(zone)) {
      throw new Error(`"${zone}" isn't a timezone I know. Use a name like America/Toronto, America/Vancouver, Europe/Paris (list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).`);
    }
    await guildService.updateSettings(context.guildId, { timezone: zone });
    await interaction.reply({ content: `Timezone set to **${zone}**. "friday 8pm" in /raid create now means 8pm there.`, ephemeral: true });
    return;
  }

  if (subcommand === "weekly-report") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await guildService.updateSettings(context.guildId, { weeklyReportEnabled: enabled });
    await interaction.reply({
      content: enabled
        ? `Weekly report on. It posts in ${settings.notifyChannelId ? `<#${settings.notifyChannelId}>` : "the notify channel (set one with `/setup config channel` first)"} within the hour, then every 7 days.`
        : "Weekly report off.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "notify-channel") {
    if (interaction.options.getBoolean("disable")) {
      await guildService.updateSettings(context.guildId, { notifyChannelId: null });
      await interaction.reply({ content: "Announcements disabled.", ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) throw new Error("Provide a channel, or use disable:true to turn announcements off.");
    await guildService.updateSettings(context.guildId, { notifyChannelId: channel.id });
    await interaction.reply({ content: `Raid, boss, loot, and EPGP announcements will post in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === "dungeon-channel") {
    if (interaction.options.getBoolean("disable")) {
      await guildService.updateSettings(context.guildId, { dungeonChannelId: null });
      await interaction.reply({ content: "Dungeon runs and records will post in the notify channel.", ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) throw new Error("Provide a channel, or use disable:true to go back to the notify channel.");
    await guildService.updateSettings(context.guildId, { dungeonChannelId: channel.id });
    await interaction.reply({ content: `Dungeon runs and records will post in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  const channelSettings: Record<string, { field: "dungeonLeaderboardChannelId" | "dungeonSignupChannelId" | "craftChannelId" | "readinessChannelId" | "coreChannelId" | "applicationChannelId" | "guideChannelId"; label: string }> = {
    "core-channel": { field: "coreChannelId", label: "Raid core rosters" },
    "readiness-channel": { field: "readinessChannelId", label: "Raid readiness" },
    "craft-channel": { field: "craftChannelId", label: "Craft requests" },
    "dungeon-leaderboard-channel": { field: "dungeonLeaderboardChannelId", label: "The dungeon leaderboard" },
    "dungeon-signup-channel": { field: "dungeonSignupChannelId", label: "Dungeon signups" },
    "application-channel": { field: "applicationChannelId", label: "Applications" },
    "guide": { field: "guideChannelId", label: "Bot guide" }
  };
  const channelSetting = channelSettings[subcommand];
  if (channelSetting) {
    if (interaction.options.getBoolean("disable")) {
      await guildService.updateSettings(context.guildId, {
        [channelSetting.field]: null,
        ...(channelSetting.field === "dungeonLeaderboardChannelId" ? { dungeonLeaderboardMessageId: null } : {})
      });
      await interaction.reply({ content: `${channelSetting.label}: channel cleared.`, ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) throw new Error("Provide a channel, or use disable:true to clear it.");
    await guildService.updateSettings(context.guildId, {
      [channelSetting.field]: channel.id,
      ...(channelSetting.field === "dungeonLeaderboardChannelId" ? { dungeonLeaderboardMessageId: null } : {})
    });
    if (channelSetting.field === "dungeonLeaderboardChannelId") await updateDungeonLeaderboard(interaction.guild);
    if (channelSetting.field === "coreChannelId") await syncAllCoreRosters(interaction.guild, prisma, context.guildId);
    if (channelSetting.field === "guideChannelId") {
      const fetched = await interaction.guild?.channels.fetch(channel.id).catch(() => null);
      if (fetched?.isTextBased()) await ensureBotGuide(fetched, asLang((await guildService.getSettings(context.guildId))?.language));
    }
    if (channelSetting.field === "dungeonSignupChannelId") {
      const fetched = await interaction.guild?.channels.fetch(channel.id).catch(() => null);
      if (fetched?.isTextBased() && "send" in fetched) {
        await ensureDungeonSignupGuide(fetched, asLang((await guildService.getSettings(context.guildId))?.language));
      }
    }
    await interaction.reply({ content: `${channelSetting.label} will use <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === "auto-import") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await guildService.updateSettings(context.guildId, { autoApplyImports: enabled });
    await interaction.reply({
      content: enabled
        ? "Auto-apply is on: whatever the companion uploads (EPGP ledger, attendance, loot, dungeon runs, gear checks, discovered characters) is applied right away and announced. Duplicates are still skipped. Turn it off to review uploads with `/import apply` again."
        : "Auto-apply is off: uploads wait for an officer's `/import apply`.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "wcl-guild") {
    if (interaction.options.getBoolean("off")) {
      await guildService.updateSettings(context.guildId, { wclGuildId: null, wclBaseUrl: null });
      await interaction.reply({ content: "Warcraft Logs: no longer looking for new reports. `/raid wcl report` still works by hand.", ephemeral: true });
      return;
    }
    const input = interaction.options.getString("guild");
    const settings = await guildService.getSettings(context.guildId);
    if (!input) {
      await interaction.reply({
        content: settings?.wclGuildId
          ? `Warcraft Logs guild #${settings.wclGuildId} is watched. New public reports are posted in the raid logs channel and checked against attendance (details go to the officer log). Turn it off with off:true.`
          : "No Warcraft Logs guild is set. Open your guild's page on warcraftlogs.com and run `/setup config wcl-guild guild:<that link>`.",
        ephemeral: true
      });
      return;
    }
    if (!config.WCL_CLIENT_ID || !config.WCL_CLIENT_SECRET) throw new Error("Warcraft Logs isn't set up: put WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env.local and restart the bot.");
    await interaction.deferReply({ ephemeral: true });
    const ref = parseGuildRef(input, config.WCL_BASE_URL);
    const found = await createWclClient({ clientId: config.WCL_CLIENT_ID, clientSecret: config.WCL_CLIENT_SECRET }).findGuild(ref);
    await guildService.updateSettings(context.guildId, { wclGuildId: found.id, wclBaseUrl: ref.baseUrl });
    await interaction.editReply(`Watching **${found.name}**${found.server ? ` (${found.server})` : ""} on Warcraft Logs. Every few minutes the bot looks for new public reports from the last 3 days, posts each in the raid logs channel, matches it to the raid by time, and sends an officer-only check (attendance, flasks, food, deaths) to the officer log.`);
    return;
  }

  if (subcommand === "loot-mode") {
    if ((await guildService.getSettings(context.guildId))?.coreLootOnly) {
      await interaction.reply({ content: "Chaque core choisit sa méthode de butin. Utilise /core edit → Méthode de butin, ou /core rules loot_mode:... pour le core voulu.", ephemeral: true });
      return;
    }
    const mode = asLootMode(interaction.options.getString("mode", true));
    await guildService.updateSettings(context.guildId, { lootMode: mode });
    await interaction.reply({
      content: `Loot system for the guild: **${LOOT_MODE_LABEL[mode]}**. ${LOOT_MODE_HELP[mode]}`
        + (mode === "EPGP" ? " `/loot auction` and `/loot bid` work." : " `/loot auction` and `/loot bid` are off; officers use `/loot award`.")
        + (mode === "PRIORITY" ? " Set the prices with `/core items`." : "")
        + "\nA raid core can use another system: `/core rules` or `/core setup`.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "merit") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await guildService.updateSettings(context.guildId, { meritEnabled: enabled });
    await interaction.reply({ content: `Merit ranking ${enabled ? "enabled" : "disabled"}. This only changes how /epgp leaderboard is ordered; the EPGP ledger is never touched.`, ephemeral: true });
    return;
  }

  if (subcommand === "raid-channel") {
    const disable = interaction.options.getBoolean("disable");
    if (disable) {
      await guildService.updateSettings(context.guildId, { raidSignupChannelId: null });
      await interaction.reply({ content: "Raid signup embeds disabled.", ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel");
    if (!channel) throw new Error("Provide a channel, or use disable:true to turn raid signup embeds off.");
    await guildService.updateSettings(context.guildId, { raidSignupChannelId: channel.id });
    await interaction.reply({ content: `Raid signup embeds will post in <#${channel.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === "roles") {
    const applicantRole = interaction.options.getRole("applicant");
    const memberRole = interaction.options.getRole("member");
    if (!applicantRole && !memberRole) throw new Error("Provide at least one role to update.");
    await guildService.updateSettings(context.guildId, {
      ...(applicantRole ? { applicantRoleId: applicantRole.id } : {}),
      ...(memberRole ? { memberRoleId: memberRole.id } : {})
    });
    await interaction.reply({
      content: [
        applicantRole ? `Applicant role set to <@&${applicantRole.id}>.` : null,
        memberRole ? `Member role set to <@&${memberRole.id}>.` : null
      ].filter(Boolean).join("\n"),
      ephemeral: true
    });
    return;
  }

  const setting = interaction.options.getString("setting", true) as keyof typeof settings;
  const value = interaction.options.getInteger("value", true);
  if (setting === "id" || setting === "guildId" || setting === "createdAt" || setting === "updatedAt") {
    throw new Error("That setting cannot be changed.");
  }
  if (setting === "epgpDecayPercent") {
    if (value > 100) throw new Error("EPGP decay percent must be between 0 and 100.");
    await guildService.updateSettings(context.guildId, { epgpDecayPercent: value / 100 });
    await interaction.reply({ content: `Updated EPGP decay to ${value}%.`, ephemeral: true });
    return;
  }
  await guildService.updateSettings(context.guildId, { [setting]: value });
  await interaction.reply({ content: `Updated ${setting} to ${value}.`, ephemeral: true });
}
