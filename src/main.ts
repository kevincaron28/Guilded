import { ensureCoreDiscord } from "./services/raid-core.js";
import { fillGuildWeeklyRaids } from "./services/core-weekly-raids.js";
import { guildService } from "./commands/context.js";
import { adoptCommunityHonors } from "./services/community-honors.js";
import { rememberRookieJoin } from "./services/monthly-rookie.js";
import { COMMUNITY_PREFIX, executeCommunity, handleCommunityButton, handleCommunityModal, runCommunityActivities } from "./commands/community.js";
import { handleCommunityHub } from "./commands/community-hub.js";
import { COMMUNITY_HUB_PREFIX } from "./services/community-panels.js";
import { pendingSignupRaidIds, syncSignupEmbed } from "./commands/raid.js";
import { runDiscordJobs } from "./services/discord-jobs.js";
import { queueGuildScheduledEvents } from "./services/scheduled-events.js";
import { queueCharacterDisplayRefresh } from "./services/character-display-refresh.js";
import { executeSystem } from "./commands/system.js";
import { executeConfig } from "./commands/settings.js";
import { updateProfessionDirectory } from "./services/profession-directory.js";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction
} from "discord.js";
import { commands } from "./commands/index.js";
import { legacyView, resolveCommand } from "./commands/router.js";
import { executeProfile } from "./commands/profile.js";
import { replyWithCommandError } from "./commands/context.js";
import { handleRaidSignupButton, RAID_SIGNUP_PREFIX } from "./commands/raid.js";
import { executeLoot } from "./commands/loot.js";
import { executeEpgp } from "./commands/epgp.js";
import { APPLY_PREFIX, executeApply, handleApplyButton, handleApplyModal } from "./commands/application.js";
import { executeTag } from "./commands/tag.js";
import { handleSelfRoleButton, SELF_ROLE_PREFIX } from "./commands/selfroles.js";
import { EP_AWARD_PREFIX, handleEpAwardButton } from "./commands/ep-award.js";
import { executeCore } from "./commands/core.js";
import { executePoll, handlePollButton, POLL_PREFIX } from "./commands/poll.js";
import { CRAFT_PREFIX, handleCraftButton, handleCraftModal } from "./commands/craft-board.js";
import {
  cleanupDungeonGroups, DUNGEON_GROUP_PREFIX, handleDungeonGroupButton, handleDungeonGuideButton, handleDungeonGuideModal, handleDungeonGuideSelect
} from "./commands/dungeon-group.js";
import { DUNGEON_GUIDE_PREFIX } from "./services/dungeon-guide.js";
import { answerMessage, FAQ_MODAL_PREFIX, handleFaqModal } from "./commands/faq.js";
import { GROUP_ALERT_OPEN_ID, GROUP_ALERT_PREFIX, handleGroupAlertComponent, openGroupAlerts } from "./commands/group-alerts.js";
import { runWeeklyReports } from "./commands/stats.js";
import { runAutoDecay } from "./services/auto-decay.js";
import { executeBank } from "./commands/bank.js";
import { executeCraft } from "./commands/craft.js";
import { greetNewGuild, logSetupStatus } from "./commands/setup.js";
import { announceVersionUpdates } from "./services/version-announce.js";
import { executeUninstall } from "./commands/uninstall.js";
import { executeHelp } from "./commands/help.js";
import { handleAutocomplete } from "./commands/autocomplete.js";
import { prisma } from "./database.js";
import { runRaidReminders } from "./services/reminders.js";
import { runCooldownPings } from "./services/recipes.js";
import { DUNGEON_SEASON_SELECT, handleDungeonSeasonSelect, updateDungeonLeaderboard } from "./services/dungeon-leaderboard.js";
import { runBackup } from "./services/backup.js";
import { updateCommunityLeaderboard } from "./services/community-leaderboard.js";
import { cleanupPastRaidPosts } from "./services/raid-post-cleanup.js";
import { cleanupRaidAlerts } from "./services/raid-alert-cleanup.js";
import { runWclDiscovery } from "./services/wcl-check.js";
import { config } from "./config.js";
import { startCompanionApi } from "./companion-api.js";
import { executePoe } from "./commands/poe.js";
import { executeParticipation } from "./commands/participation.js";
import { createParticipationTracker } from "./services/participation-discord.js";
import { handleOnboardingInteraction, ONBOARD_PREFIX, runOnboardingNudges } from "./services/onboarding.js";
import { handleMemberJoin, handleMemberRolesChange, handleMemberLeave, handleWelcomeRoleButton, WELCOME_ROLE_PREFIX } from "./services/housekeeping.js";
import { createErrorReportService } from "./services/error-report.js";
import { buildGuildedReference } from "./services/guilded-reference.js";
import { runRetention } from "./services/retention.js";

// GuildMembers is a privileged intent: it must also be enabled for this bot
// application under "Server Members Intent" in the Discord Developer Portal,
// or login will fail with "Used disallowed intents". The same goes for
// MessageContent ("Message Content Intent"), asked for only when
// MESSAGE_CONTENT_INTENT=true (5.0 answer channel, /mod faq).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions,
    ...(config.MESSAGE_CONTENT_INTENT ? [GatewayIntentBits.MessageContent] : [])
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User]
});
const participationTracker = createParticipationTracker(prisma, config.MESSAGE_CONTENT_INTENT);
const answerCommandList = buildGuildedReference(commands);
const errorReportService = createErrorReportService(prisma);
const companionApi = startCompanionApi(client);
// Background jobs run unattended (no interaction to reply to), so this is
// their only way to surface a failure beyond the console/journalctl.
const reportJobError = (source: string) => (error: unknown) => {
  console.warn(`${source} failed`, error);
  void errorReportService.report(client, error, { source });
};
// Same idea for a button/select/modal handler, with the guild and user it happened to.
const reportInteractionError = (source: string, interaction: { guildId: string | null; guild: { name: string } | null; user: { id: string } }, error: unknown): void => {
  console.error(`${source} failed`, error);
  void errorReportService.report(client, error, { source, guildId: interaction.guildId, guildName: interaction.guild?.name, userId: interaction.user.id });
};

// Stops cleanly: no new companion requests, Discord and the database closed. systemd sends
// SIGTERM on every redeploy; without this an import could be cut off mid-request.
let stopping = false;
async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  // Never hang on a stuck connection: systemd would wait, then kill it anyway.
  setTimeout(() => process.exit(code), 10_000).unref();
  await new Promise<void>((resolve) => companionApi.close(() => resolve()));
  await client.destroy().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(code);
}
process.on("SIGTERM", () => { void shutdown(0); });
process.on("SIGINT", () => { void shutdown(0); });

// After an uncaught exception the process is in an unknown state (the companion API may not
// even be listening). The cause is saved and reported first, then the process exits so systemd
// starts a clean one; staying up half-broken is worse than a ten-second restart.
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception, restarting", error);
  const reported = errorReportService.report(client, error, { source: "uncaughtException" });
  void Promise.race([reported, new Promise((resolve) => setTimeout(resolve, 5_000))]).finally(() => shutdown(1));
});
// A rejected promise nobody awaited is a bug in one handler, not a broken process: report it and carry on.
process.on("unhandledRejection", (error) => { void errorReportService.report(client, error, { source: "unhandledRejection" }); });
const handlers = new Collection<string, (interaction: ChatInputCommandInteraction) => Promise<void>>();
handlers.set("profile", executeProfile);
handlers.set("config", executeConfig);
handlers.set("loot", executeLoot);
handlers.set("epgp", executeEpgp);
handlers.set("apply", executeApply);
handlers.set("tag", executeTag);
handlers.set("core", executeCore);
handlers.set("poll", executePoll);
handlers.set("bank", executeBank);
handlers.set("craft", executeCraft);
handlers.set("help", executeHelp);
handlers.set("uninstall", executeUninstall);
handlers.set("system", executeSystem);
handlers.set("community", executeCommunity);
handlers.set("poe", executePoe);
handlers.set("participation", executeParticipation);

async function repairCoreRaids(guild: import("discord.js").Guild, provision = false): Promise<void> {
  const record = await guildService.ensureGuild(guild.id, guild.name);
  if (provision) {
    const cores = await prisma.raidCore.findMany({ where: { guildId: record.id } });
    for (const core of cores) await ensureCoreDiscord(guild, prisma, record.id, core.id);
  }
  await fillGuildWeeklyRaids(prisma, record.id, reportJobError("Core weekly raid schedule"));
  const raids = await prisma.raid.findMany({ where: { guildId: record.id, coreId: { not: null }, OR: [
    // Only upcoming raids need missing signup posts recreated.
    { status: "PLANNED", scheduledAt: { gt: new Date() }, ...(provision ? {} : { OR: [{ signupMessageId: null }, { mirrorSignupMessageId: null }] }) },
    { id: { in: pendingSignupRaidIds(record.id) } }
  ] }, select: { id: true } });
  for (const raid of raids) await syncSignupEmbed(guild, record.id, raid.id);
}

client.once(Events.ClientReady, (readyClient) => {
  const voice = async () => { for (const guild of readyClient.guilds.cache.values()) await participationTracker.sampleVoice(guild); };
  void voice().catch(reportJobError("Participation voice checkpoint"));
  setInterval(() => void voice().catch(reportJobError("Participation voice checkpoint")), 30_000);
  const communityActivities = () => runCommunityActivities(readyClient.guilds.cache.values(), reportJobError("Community honors")).catch(reportJobError("Community activities"));
  void (async () => {
    for (const guild of readyClient.guilds.cache.values()) {
      const created = await adoptCommunityHonors(guild, prisma).catch(reportJobError("Community honors setup"));
      if (created?.length) console.info(`Community honors added in ${guild.name}: ${created.join(", ")}`);
    }
  })().finally(() => void communityActivities());
  setInterval(() => void communityActivities(), 60_000);
  const communityRest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  let refreshingCommunityBoards = false;
  const refreshCommunityBoards = async () => {
    if (refreshingCommunityBoards) return;
    refreshingCommunityBoards = true;
    try {
      for (const guild of readyClient.guilds.cache.values()) {
        await updateCommunityLeaderboard(communityRest, prisma, guild.id, readyClient.user.id).catch(reportJobError("Community leaderboard"));
      }
    } finally { refreshingCommunityBoards = false; }
  };
  void refreshCommunityBoards();
  setInterval(() => void refreshCommunityBoards(), 5 * 60_000);
  void runDiscordJobs(readyClient).catch(reportJobError("Discord delivery queue"));
  setInterval(() => void runDiscordJobs(readyClient).catch(reportJobError("Discord delivery queue")), 60_000);
  // Repair missing event jobs after a restart and advance game nights at their times.
  let reconcilingEvents = false;
  const reconcileEvents = async () => {
    if (reconcilingEvents) return;
    reconcilingEvents = true;
    try {
      for (const guild of readyClient.guilds.cache.values()) {
        const record = await prisma.guild.findUnique({ where: { discordId: guild.id } });
        if (record) await queueGuildScheduledEvents(prisma, record.id);
      }
    } finally { reconcilingEvents = false; }
  };
  void reconcileEvents().catch(reportJobError("Discord scheduled events"));
  setInterval(() => void reconcileEvents().catch(reportJobError("Discord scheduled events")), 60_000);
  registerCommandsEverywhere().catch(reportJobError("Command registration"));
  console.info(`Logged in as ${readyClient.user.tag}`);
  for (const guild of readyClient.guilds.cache.values()) {
    void updateDungeonLeaderboard(guild);
    void updateProfessionDirectory(guild);
    repairCoreRaids(guild, true).catch(reportJobError("Core channels and raid posts"));
  }
  logSetupStatus(readyClient.guilds.cache.values()).catch(reportJobError("Setup status log"));
  // One-shot: the running version only changes on a redeploy/restart, so a
  // per-ClientReady check is enough (safe on reconnect too: it marks each
  // guild before posting, so it won't repeat once it's caught up).
  announceVersionUpdates(readyClient).catch(reportJobError("Version announcement"));
  // Daily database backup to backups/ (keeps 14 days). Runs now if today's
  // file is missing, then checks hourly.
  const backup = () => runBackup(prisma)
    .then((result) => { if (result) console.info(`Backup saved: backups/${result.file} (${result.rows} rows).`); })
    .catch(reportJobError("Database backup"));
  void backup();
  setInterval(() => void backup(), 60 * 60 * 1000);
  // Old uploads, repeated gear checks and old error reports are pruned (services/retention.ts).
  const retention = () => runRetention(prisma)
    .then((removed) => { if (removed.imports || removed.snapshots || removed.errors) console.info(`Retention: removed ${removed.imports} old upload(s), ${removed.snapshots} old gear check(s), ${removed.errors} old error report(s).`); })
    .catch(reportJobError("Data retention"));
  setTimeout(() => void retention(), 5 * 60 * 1000);
  setInterval(() => void retention(), 6 * 60 * 60 * 1000);
  // A free hosted database goes to sleep when idle and the first command after
  // that takes over Discord's 3 second limit ("Unknown interaction"). A tiny
  // query every 2 minutes keeps it awake.
  setInterval(() => void prisma.$queryRaw`SELECT 1`.catch(reportJobError("Keep-awake query")), 2 * 60 * 1000);
  // Raid reminders: checked every 5 minutes so a "60 minutes before" ping
  // lands within a few minutes of that mark.
  setInterval(() => {
    runRaidReminders(readyClient, prisma).catch(reportJobError("Raid reminder check"));
  }, 5 * 60 * 1000);
  // Profession cooldowns: a DM to members who asked for it, when one of theirs is ready.
  setInterval(() => {
    runCooldownPings(readyClient, prisma).catch(reportJobError("Cooldown pings"));
  }, 10 * 60 * 1000);
  // Warcraft Logs: new reports of the guild set with /config wcl-guild, every 10 minutes.
  setInterval(() => {
    runWclDiscovery(readyClient, prisma).catch(reportJobError("Warcraft Logs check"));
  }, 10 * 60 * 1000);
  // Signup posts of raids that ended more than a day ago are removed (the raid itself is kept).
  const cleanupRaids = async () => {
    await cleanupPastRaidPosts(readyClient, prisma).catch(reportJobError("Past raid signup posts"));
    await cleanupRaidAlerts(readyClient, prisma).catch(reportJobError("Past raid alerts"));
  };
  void cleanupRaids();
  setInterval(() => void cleanupRaids(), 6 * 60 * 60 * 1000);
  // Dungeon group voice channels: deleted after a few empty minutes.
  setInterval(() => {
    cleanupDungeonGroups(readyClient).catch(reportJobError("Dungeon group cleanup"));
  }, 2 * 60 * 1000);
  let repairing = false;
  setInterval(() => {
    if (repairing) return;
    repairing = true;
    (async () => { for (const guild of readyClient.guilds.cache.values()) await repairCoreRaids(guild); })()
      .catch(reportJobError("Raid signup repair")).finally(() => { repairing = false; });
  }, 5 * 60 * 1000);
  // Weekly guild report (if enabled): checked hourly.
  setInterval(() => {
    // Re-evaluate snapshot age even when nobody clicks a signup or uploads new gear.
    (async () => {
      for (const guild of readyClient.guilds.cache.values()) {
        const record = await guildService.ensureGuild(guild.id, guild.name);
        await queueCharacterDisplayRefresh(prisma, record.id);
      }
    })().catch(reportJobError("Character display refresh"));
    runWeeklyReports(readyClient).catch(reportJobError("Weekly report check"));
    // Automatic EPGP decay after each weekly reset (guilds that turned it on).
    runAutoDecay(prisma).catch(reportJobError("Automatic decay"));
    // One private reminder to new members who have not finished onboarding (guilds that turned it on).
    runOnboardingNudges(readyClient).catch(reportJobError("Onboarding reminders"));
  }, 60 * 60 * 1000);
});

// Bot just added to a server: point whoever invited it at /setup.
client.on(Events.GuildCreate, (guild) => {
  registerCommands(guild.id).catch(reportJobError("Registering commands for new guild"));
  greetNewGuild(guild).catch((error: unknown) => { console.error("Greeting new guild failed", error); void errorReportService.report(client, error, { source: "Greeting new guild", guildId: guild.id, guildName: guild.name }); });
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const record = await prisma.guild.findUnique({ where: { discordId: member.guild.id }, select: { id: true } });
    if (record && member.joinedAt && !member.user.bot) await rememberRookieJoin(prisma, record.id, member.id, member.joinedAt);
    await handleMemberJoin(member.guild, member);
  } catch (error) {
    console.error("GuildMemberAdd handling failed", error);
    void errorReportService.report(client, error, { source: "GuildMemberAdd", guildId: member.guild.id, guildName: member.guild.name, userId: member.id });
  }
});

// Preserve tenure before a leave/rejoin, independently of character and roster resets.
client.on(Events.GuildMemberRemove, async member => {
  try {
    const record = await prisma.guild.findUnique({ where: { discordId: member.guild.id }, select: { id: true } });
    if (record && member.joinedAt && !member.user.bot) await rememberRookieJoin(prisma, record.id, member.id, member.joinedAt);
  } catch (error) { console.error("Rookie membership history failed", error); }
});

// The officer log's "joined the guild" line: someone got the Member role or a leadership role.
client.on(Events.GuildMemberUpdate, async (before, after) => {
  try {
    await handleMemberRolesChange(after.guild, before, after);
  } catch (error) {
    console.error("GuildMemberUpdate handling failed", error);
    void errorReportService.report(client, error, { source: "GuildMemberUpdate", guildId: after.guild.id, guildName: after.guild.name, userId: after.id });
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await handleMemberLeave(member.guild, member);
  } catch (error) {
    console.error("GuildMemberRemove handling failed", error);
    void errorReportService.report(client, error, { source: "GuildMemberRemove", guildId: member.guild.id, guildName: member.guild.name, userId: member.id });
  }
});

client.on(Events.MessageCreate, message => { void participationTracker.message(message).catch(reportJobError("Participation messages")); });
client.on(Events.MessageReactionAdd, (reaction, user) => { void participationTracker.reaction(reaction, user).catch(reportJobError("Participation reactions")); });
client.on(Events.MessageDelete, message => { void participationTracker.deleted(message).catch(reportJobError("Participation deleted message")); });
client.on(Events.MessageBulkDelete, messages => { void (async () => { for (const message of messages.values()) await participationTracker.deleted(message); })().catch(reportJobError("Participation deleted messages")); });
client.on(Events.VoiceStateUpdate, (_before, after) => { void participationTracker.sampleVoice(after.guild).catch(reportJobError("Participation voice change")); });
client.on(Events.GuildMemberUpdate, (_before, after) => { void participationTracker.sampleVoice(after.guild).catch(reportJobError("Participation eligibility change")); });
client.on(Events.GuildMemberRemove, member => { void participationTracker.sampleVoice(member.guild).catch(reportJobError("Participation member left")); });
client.on(Events.GuildRoleUpdate, (_before, role) => { void participationTracker.sampleVoice(role.guild).catch(reportJobError("Participation role permissions")); });
client.on(Events.ChannelUpdate, (_before, channel) => { if ("guild" in channel) void participationTracker.sampleVoice(channel.guild).catch(reportJobError("Participation channel permissions")); });
client.on(Events.GuildUpdate, (_before, guild) => { void participationTracker.sampleVoice(guild).catch(reportJobError("Participation guild settings")); });
client.on(Events.GuildUnavailable, guild => participationTracker.reset(guild.id));
client.on(Events.ShardDisconnect, () => participationTracker.reset());
client.on(Events.ShardReconnecting, () => participationTracker.reset());
client.on(Events.ShardResume, () => participationTracker.reset());
// The answer channel (5.0): only when the bot may read message text.
if (config.MESSAGE_CONTENT_INTENT) {
  client.on(Events.MessageCreate, (message) => {
    void answerMessage(message, answerCommandList).catch((error: unknown) => {
      console.warn("Answer channel failed", error);
      void errorReportService.report(client, error, { source: "Answer channel", guildId: message.guildId, guildName: message.guild?.name, userId: message.author.id });
    });
  });
}

client.on(Events.InteractionCreate, async (interaction) => {
  if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(COMMUNITY_PREFIX)) {
    try {
      if (interaction.customId.startsWith(COMMUNITY_HUB_PREFIX)) await handleCommunityHub(interaction);
      else if (interaction.isButton()) await handleCommunityButton(interaction);
      else if (interaction.isModalSubmit()) await handleCommunityModal(interaction);
    } catch (error) {
      reportInteractionError("Community interaction", interaction, error);
      const content = error instanceof Error && error.message.length < 200 ? error.message : "Impossible de traiter cette demande / Could not process this request.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === DUNGEON_SEASON_SELECT) {
    await handleDungeonSeasonSelect(interaction).catch((error: unknown) => reportInteractionError("Dungeon season history", interaction, error));
    return;
  }
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(WELCOME_ROLE_PREFIX)) {
    await handleWelcomeRoleButton(interaction).catch(async (error: unknown) => {
      reportInteractionError("Welcome role button", interaction, error);
      if (!interaction.replied) await interaction.reply({ content: "That didn't work, try again or ask an officer.", ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(ONBOARD_PREFIX)) {
    await handleOnboardingInteraction(interaction).catch(async (error: unknown) => {
      reportInteractionError("Onboarding", interaction, error);
      if (!interaction.replied) await interaction.reply({ content: "That didn't work, try again or ask an officer.", ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(FAQ_MODAL_PREFIX)) {
    await handleFaqModal(interaction).catch((error: unknown) => {
      if (!(error instanceof Error && error.message.length < 200)) reportInteractionError("Answer form", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: error instanceof Error ? error.message : "Could not save the answer.", ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(CRAFT_PREFIX)) {
    await handleCraftModal(interaction).catch((error: unknown) => reportInteractionError("Craft form", interaction, error));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${DUNGEON_GUIDE_PREFIX}create`)) {
    await handleDungeonGuideModal(interaction).catch((error: unknown) => {
      reportInteractionError("Dungeon group form", interaction, error);
      if (interaction.deferred) {
        void interaction.editReply({ content: error instanceof Error ? error.message : "Could not post the dungeon group." }).catch(() => undefined);
      } else if (!interaction.replied) {
        void interaction.reply({ content: error instanceof Error ? error.message : "Could not post the dungeon group.", ephemeral: true }).catch(() => undefined);
      }
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(CRAFT_PREFIX)) {
    await handleCraftButton(interaction).catch((error: unknown) => reportInteractionError("Craft button", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(POLL_PREFIX)) {
    await handlePollButton(interaction).catch((error: unknown) => reportInteractionError("Poll button", interaction, error));
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === `${DUNGEON_GUIDE_PREFIX}kind`) {
    await handleDungeonGuideSelect(interaction).catch((error: unknown) => {
      reportInteractionError("Group finder menu", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "Could not open the group form.", ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId === GROUP_ALERT_OPEN_ID) {
    await openGroupAlerts(interaction).catch((error: unknown) => {
      reportInteractionError("Group alerts button", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "Could not open your group alerts.", ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(GROUP_ALERT_PREFIX)) {
    await handleGroupAlertComponent(interaction).catch((error: unknown) => {
      reportInteractionError("Group alerts", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "Could not save your group alerts.", ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId === `${DUNGEON_GUIDE_PREFIX}create`) {
    await handleDungeonGuideButton(interaction).catch((error: unknown) => {
      reportInteractionError("Dungeon signup guide button", interaction, error);
      if (!interaction.replied) {
        void interaction.reply({ content: "Could not open the dungeon group form.", ephemeral: true }).catch(() => undefined);
      }
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(DUNGEON_GROUP_PREFIX)) {
    try {
      await handleDungeonGroupButton(interaction);
    } catch (error) {
      reportInteractionError("Dungeon group button", interaction, error);
      const content = error instanceof Error && error.message.length < 200 ? error.message : "Could not update the group.";
      if (!interaction.replied) await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(RAID_SIGNUP_PREFIX)) {
    try {
      await handleRaidSignupButton(interaction);
    } catch (error) {
      reportInteractionError("Raid signup button", interaction, error);
      const content = error instanceof Error ? error.message : "Could not update your signup.";
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content, components: [] }).catch(() => undefined);
      else await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(EP_AWARD_PREFIX)) {
    try {
      await handleEpAwardButton(interaction);
    } catch (error) {
      reportInteractionError("EP award button", interaction, error);
      const content = error instanceof Error ? error.message : "Could not record the EP award.";
      if (!interaction.replied) await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(APPLY_PREFIX)) {
    await handleApplyModal(interaction).catch((error: unknown) => reportInteractionError("Application form", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(APPLY_PREFIX)) {
    await handleApplyButton(interaction).catch(async (error: unknown) => {
      reportInteractionError("Application button", interaction, error);
      const content = error instanceof Error ? error.message : "Impossible d'ouvrir ta candidature.";
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content, components: [] }).catch(() => undefined);
      else await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(SELF_ROLE_PREFIX)) {
    try {
      await handleSelfRoleButton(interaction);
    } catch (error) {
      reportInteractionError("Self-role button", interaction, error);
      if (!interaction.replied) {
        if (interaction.deferred) {
          await interaction.editReply({ content: "Could not update that role. Please try again or contact an officer." }).catch(() => undefined);
        } else {
          await interaction.reply({ content: "Could not update that role. Please try again or contact an officer.", ephemeral: true }).catch(() => undefined);
        }
      }
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const found = resolveCommand(commands, interaction);
  const handler = found.handler ?? handlers.get(found.legacy);
  if (!handler) {
    await interaction.reply({ content: "That command is not available.", ephemeral: true });
    return;
  }
  try {
    await handler(found.merged ? legacyView(interaction, found.legacy, found.sub) : interaction);
  } catch (error) {
    await replyWithCommandError(interaction, error);
  }
});

async function registerCommands(guildId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
    { body: commands.map((command) => command.toJSON()) }
  );
}

// Commands are per-guild, so every server the bot is in needs them registered.
async function registerCommandsEverywhere(): Promise<void> {
  const guildIds = new Set<string>([config.DISCORD_GUILD_ID, ...client.guilds.cache.keys()]);
  for (const guildId of guildIds) {
    await registerCommands(guildId).catch((error: unknown) => console.warn(`Command registration failed for guild ${guildId}`, error));
  }
}

await client.login(config.DISCORD_TOKEN);
