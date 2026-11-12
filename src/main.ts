import { readFileSync } from "node:fs";
import { executeAutomation } from "./commands/automation.js";
import { runRecurringDeliveries } from "./services/recurring-discord.js";
import { dispatchGroupWatches } from "./services/group-watch-discord.js";
import { BG_PREFIX, executeBattleground, handleBattlegroundComponent } from "./commands/battleground.js";
import "./services/diagnostic-console.js";
import { withEdition } from "./services/edition-context.js";
import { guildWhere, interactionGuildScope, entityGuildScope, runInGuildScope, withGuildScope, forEachGuildScope } from "./services/guild-scope.js";
import { executeWow } from "./commands/wow.js";
import type { Interaction } from "discord.js";
import { hostedPilot, pilotGuildScope, replacePilotApprovals, replacePilotLite } from "./hosted-pilot.js";
import { runRaidNightChecks } from "./services/raid-night-check.js";
import { createPilotRequests, PILOT_REQUEST_PREFIX } from "./services/pilot-requests.js";
import { warnIdleLite, welcomeApprovedOwner } from "./services/pilot-welcome.js";
import { PILOT_DENIED, PILOT_LITE_DENIED } from "./services/pilot-policy.js";
import { allowsLite, commandSetFor } from "./commands/lite.js";
import { ensureCoreDiscord } from "./services/raid-core.js";
import { fillGuildWeeklyRaids } from "./services/core-weekly-raids.js";
import { runTeamSchedules } from "./services/activity-core.js";
import { autocompleteTeam, executeTeam, handleTeamButton } from "./commands/team.js";
import { TEAM_BUTTON_PREFIX } from "./services/activity-core-discord.js";
import { guildService } from "./commands/context.js";
import { adoptCommunityHonors } from "./services/community-honors.js";
import { rememberRookieJoin } from "./services/monthly-rookie.js";
import { COMMUNITY_PREFIX, executeCommunity, handleCommunityButton, handleCommunityModal, runCommunityActivities } from "./commands/community.js";
import { handleCommunityHub } from "./commands/community-hub.js";
import { COMMUNITY_HUB_PREFIX } from "./services/community-panels.js";
import { pendingSignupRaidIds, syncSignupEmbed } from "./commands/raid.js";
import { runDiscordJobs } from "./services/discord-jobs.js";
import { queueGuildScheduledEvents } from "./services/scheduled-events.js";
import { commandRegistration } from "./services/command-registration.js";
import { interactionLabel, interactionReportOrigin, withReportContext, type InteractionReportInput, type ReportScope } from "./services/report-context.js";
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
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { commands } from "./commands/index.js";
import { legacyView, resolveCommand } from "./commands/router.js";
import { executeProfile } from "./commands/profile.js";
import { isExpiredInteraction, replyWithCommandError } from "./commands/context.js";
import { handleRaidSignupButton, handleRaidSpecSelect, RAID_SIGNUP_PREFIX, RAID_SPEC_PREFIX } from "./commands/raid.js";
import { handleOfficerButton, handleOfficerModal } from "./commands/officer-tools.js";
import { OFFICER_PREFIX } from "./services/officer-buttons.js";
import { executeLoot } from "./commands/loot.js";
import { executeEpgp } from "./commands/epgp.js";
import { APPLY_PREFIX, executeApply, handleApplyButton, handleApplyModal } from "./commands/application.js";
import { executeTag } from "./commands/tag.js";
import { handleSelfRoleButton, SELF_ROLE_PREFIX } from "./commands/selfroles.js";
import { EP_AWARD_PREFIX, handleEpAwardButton } from "./commands/ep-award.js";
import { executeCore } from "./commands/core.js";
import { ACHIEVEMENT_SHARE_PREFIX, handleAchievementShare } from "./commands/achievements.js";
import { handleDungeonTimeline } from "./commands/dungeon-post.js";
import { DUNGEON_TIMELINE_PREFIX } from "./services/dungeon-announce.js";
import { syncAllRankRoles } from "./services/rank-roles.js";
import { syncAllNicknames } from "./services/nickname-sync.js";
import { postAllWeeklyPromotions } from "./services/promotion.js";
import { sendRecruitReminders } from "./services/recruiting-kit.js";
import { handleLinkedButton, LINKED_PREFIX } from "./services/companion-link-dm.js";
import { handlePanelInteraction, PANEL_PREFIX } from "./services/character-panel.js";
import { handleLinkMoveButton, LINK_MOVE_PREFIX } from "./services/link-conflict-dm.js";
import { handleInviteDm, handleInviteRequestInteraction, INVITE_REQUEST_PREFIX } from "./services/invite-request.js";
import { postAllWeeklyGuildBanks } from "./services/guild-bank.js";
import { scheduleInviteCleanups } from "./services/invite-cleanup.js";
import { backCheckAllInvites, handleInviteDoneButton, handleInviteMessage, handleInviteReaction, handleWowRoleGiven } from "./services/invite-channel.js";
import { ROSTER_BUTTON_PREFIX, handleRosterButton } from "./commands/roster.js";
import { RANK_ROLES_BUTTON_PREFIX, handleRankRolesButton } from "./commands/rank-roles.js";
import { sweepAchievementAnnouncements } from "./services/achievement-announce.js";
import { sweepServerAnniversaries } from "./services/server-anniversary.js";
import { executePoll, handlePollButton, handleWeeklyQuestionButton, POLL_PREFIX, WEEKLY_QUESTION_PREFIX } from "./commands/poll.js";
import { CRAFT_PREFIX, handleCraftButton, handleCraftModal, handleCraftSelect } from "./commands/craft-board.js";
import { handleProfessionDetails } from "./commands/profession-details.js";
import { PROFESSION_DETAILS_PREFIX } from "./services/profession-details.js";
import {
  cleanupDungeonGroups, DUNGEON_GROUP_PREFIX, handleDungeonGroupButton, handleDungeonGuideButton, handleDungeonGuideModal, handleDungeonGuideSelect
} from "./commands/dungeon-group.js";
import { DUNGEON_GUIDE_PREFIX } from "./services/dungeon-guide.js";
import { answerMessage, FAQ_MODAL_PREFIX, handleFaqModal } from "./commands/faq.js";
import { GROUP_ALERT_OPEN_ID, GROUP_ALERT_PREFIX, handleGroupAlertComponent, openGroupAlerts } from "./commands/group-alerts.js";
import { runDailyRecaps, runWeeklyReports } from "./commands/stats.js";
import { runAutoDecay } from "./services/auto-decay.js";
import { executeBank, handleBankRequestButton } from "./commands/bank.js";
import { BANK_REQUEST_PREFIX } from "./services/guild-bank-member.js";
import { executeCraft } from "./commands/craft.js";
import { OFFER_PREFIX, handleOfferButton, sweepCraftOffers } from "./commands/craft-offers.js";
import { greetNewGuild, isLiveSetupMessage, logSetupStatus } from "./commands/setup.js";
import { announceVersionUpdates } from "./services/version-announce.js";
import { announceAvailableUpdate } from "./services/update-check.js";
import { executeUninstall } from "./commands/uninstall.js";
import { executeHelp } from "./commands/help.js";
import { handleAutocomplete } from "./commands/autocomplete.js";
import { prisma } from "./database.js";
import { runRaidReminders } from "./services/reminders.js";
import { runMobileAlerts } from "./services/mobile-alerts.js";
import { queueExpiredPolls } from "./services/poll-expiry.js";
import { runCooldownPings } from "./services/recipes.js";
import { DUNGEON_SEASON_SELECT, handleDungeonSeasonSelect, updateDungeonLeaderboard } from "./services/dungeon-leaderboard.js";
import { updateDuelBoard } from "./services/duel-board.js";
import { updateActivityBoard } from "./services/guild-activity.js";
import { updateRaceBoard } from "./services/race-board.js";
import { updateBgLadder } from "./services/bg-ladder.js";
import { scheduleWeeklyRecap } from "./services/world-pvp-extras.js";
import { refreshExistingBotGuides } from "./services/bot-messages.js";
import { refreshBgPanels } from "./services/battleground-setup.js";
import { BACKUP_DIR, runBackup } from "./services/backup.js";
import { freezeSeasonRules, loadOfficialWindows, rotateOfficialSeasons, startOfficialSeason } from "./services/official-seasons.js";
import { finalizeClosingSeasons } from "./services/dungeon-admin.js";
import { executeOwnerPreviews, handleItemPreviewButton, OWNER_PREVIEWS_COMMAND, ownerPreviewsCommand } from "./commands/owner-previews.js";
import { ITEM_PREVIEW_PREFIX } from "./services/item-preview-step0.js";
import { handlePreviewMessage } from "./services/item-preview.js";
import { professionCardFor } from "./services/profession-link-card-live.js";
import { PreviewGate } from "./services/item-preview-data.js";
import { itemData } from "./item-data.js";
import { withDeadline } from "./services/blizzard-items.js";
import { botOwnerId, executeOwnerSeason, OWNER_SEASON_COMMAND, ownerSeasonCommand } from "./commands/owner-season.js";
import { executeOwnerConsole, OWNER_CONSOLE_COMMAND, ownerConsoleCommand } from "./commands/owner-console.js";
import { createOwnerConsole } from "./services/owner-console.js";
import { consoleTools } from "./services/owner-console-tools.js";
import { CONSOLE_PREFIX } from "./services/owner-console-model.js";
import { updateCommunityLeaderboard } from "./services/community-leaderboard.js";
import { cleanupPastRaidPosts } from "./services/raid-post-cleanup.js";
import { cleanupRaidAlerts } from "./services/raid-alert-cleanup.js";
import { runWclDiscovery } from "./services/wcl-check.js";
import { config } from "./config.js";
import { startCompanionApi } from "./companion-api.js";
import { handleWebApplicationButton, WEB_APPLY_PREFIX } from "./services/recruitment-discord.js";
import { refreshPugBoard } from "./services/pug-board.js";
import { handlePugComponent } from "./commands/pug-requests.js";
import { PUG_PREFIX } from "./services/pug-discord.js";
import { sweepPugRequests } from "./services/pug-requests.js";
import { prismaWebStore } from "./services/web-store.js";
import { publishGuildRuns } from "./services/public-runs.js";
import { keepStampsOnDisk, standingsFeed } from "./services/standings-feed.js";
import { executePoe } from "./commands/poe.js";
import { POE_TRACKING_ENABLED } from "../companion/active-games.mjs";
import { executeParticipation } from "./commands/participation.js";
import { createParticipationTracker } from "./services/participation-discord.js";
import { createActivityTracker, VOICE_TICK_MS } from "./services/activity-totals.js";
import { handleGameReminderButton, GAME_REMINDER_PREFIX } from "./commands/game-reminders.js";
import { handleOnboardingInteraction, ONBOARD_PREFIX, runOnboardingNudges, runGameReminders } from "./services/onboarding.js";
import { handleMemberJoin, handleMemberRolesChange, handleMemberLeave, handleWelcomeRoleButton, WELCOME_ROLE_PREFIX } from "./services/housekeeping.js";
import { createErrorReportService, isMemberAnswer } from "./services/error-report.js";
import { buildGuildedReference } from "./services/guilded-reference.js";
import { runRetention } from "./services/retention.js";
import { runStatSnapshots } from "./services/stat-snapshots.js";
import { discordTrialDelivery, remindEndedTrials } from "./services/trial-reminders.js";
import { warnDoNotInvite } from "./services/do-not-invite.js";
import { handleStarReaction } from "./services/starboard.js";
import { logMessageDelete, logMessageEdit } from "./services/message-log.js";

// GuildMembers is a privileged intent: it must also be enabled for this bot
// application under "Server Members Intent" in the Discord Developer Portal,
// or login will fail with "Used disallowed intents". The same goes for
// MessageContent ("Message Content Intent"), asked for only when
// MESSAGE_CONTENT_INTENT=true (5.0 answer channel, /mod faq).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessages,
    ...(config.MESSAGE_CONTENT_INTENT ? [GatewayIntentBits.MessageContent] : [])
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel]
});
const participationTracker = createParticipationTracker(prisma, config.MESSAGE_CONTENT_INTENT);
// Numbers-only activity totals for the message, voice and reaction achievements (never message text).
const activityTotals = createActivityTracker(prisma);
const answerCommandList = buildGuildedReference(commands);
const errorReportService = createErrorReportService(prisma);
// Before the companion API answers: unchanged standings keep their stamp across restarts.
const standingsStamps = await keepStampsOnDisk(standingsFeed);
const companionApi = startCompanionApi(client);
// Background jobs run unattended (no interaction to reply to), so this is
// their only way to surface a failure beyond the console/journalctl.
const reportJobError = (source: string, origin: ReportScope = {}) => (error: unknown) => {
  console.warn(`${source} failed`, error);
  void errorReportService.report(client, error, { source, ...origin });
};
// Same idea for a button/select/modal handler, with the guild and user it happened to.
// An answer to the member's own mistake (see isMemberAnswer) is logged, not reported.
const reportInteractionError = (source: string, interaction: InteractionReportInput & { guildId: string | null; guild: { name: string } | null; user: { id: string } }, error: unknown): void => {
  if (isMemberAnswer(error)) { console.warn(`${source}: ${(error as Error).message}`); return; }
  // 10062: Discord dropped the interaction before the bot could answer (more than 3 s after the click, usually event
  // loop or gateway lag). Nothing can be sent back and it is not a code bug, so it is logged, not filed as a report.
  if (isExpiredInteraction(error)) { console.warn(`${source}: answered too late, Discord already dropped the interaction (10062)`); return; }
  console.error(`${source} failed`, error);
  void errorReportService.report(client, error, { source, guildId: interaction.guildId, guildName: interaction.guild?.name, userId: interaction.user.id, ...interactionReportOrigin(interaction), operation: `${source} ${interactionLabel(interaction)}`.trim() });
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
  await standingsStamps.flush().catch(() => undefined);
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
handlers.set("wow", executeWow);
handlers.set("profile", executeProfile);
handlers.set("config", executeConfig);
handlers.set("loot", executeLoot);
handlers.set("epgp", executeEpgp);
handlers.set("apply", executeApply);
handlers.set("tag", executeTag);
handlers.set("core", executeCore);
handlers.set("team", executeTeam);
handlers.set("bg", executeBattleground);
handlers.set("automation", executeAutomation);
handlers.set("poll", executePoll);
handlers.set("bank", executeBank);
handlers.set("craft", executeCraft);
handlers.set("help", executeHelp);
handlers.set("uninstall", executeUninstall);
handlers.set("system", executeSystem);
handlers.set("community", executeCommunity);
if (POE_TRACKING_ENABLED) handlers.set("poe", executePoe); // Forever-only focus: companion/active-games.mjs
handlers.set("participation", executeParticipation);

async function repairCoreRaids(guild: import("discord.js").Guild, provision = false): Promise<void> {
  const record = await guildService.ensureGuild(guild.id, guild.name);
  if (provision) {
    const cores = await prisma.raidCore.findMany({ where: { guildId: record.id } });
    for (const core of cores) await ensureCoreDiscord(guild, prisma, record.id, core.id);
  }
  await fillGuildWeeklyRaids(prisma, record.id, reportJobError("Core weekly raid schedule"));
  await runTeamSchedules(prisma, record.id, reportJobError("Weekly dungeon/PvP teams"));
  const raids = await prisma.raid.findMany({ where: { guildId: record.id, coreId: { not: null }, OR: [
    // Only upcoming raids need missing signup posts recreated.
    { status: "PLANNED", scheduledAt: { gt: new Date() }, ...(provision ? {} : { OR: [{ signupMessageId: null }, { mirrorSignupMessageId: null }] }) },
    { id: { in: pendingSignupRaidIds(record.id) } }
  ] }, select: { id: true } });
  for (const raid of raids) await syncSignupEmbed(guild, record.id, raid.id);
}

client.once(Events.ClientReady, (readyClient) => {
  let refreshingPugs = false;
  const refreshPugs = async () => {
    if (refreshingPugs) return;
    refreshingPugs = true;
    try {
      for (const guild of readyClient.guilds.cache.values()) {
        await forEachGuildScope(prisma, guild.id, () => refreshPugBoard(guild, prisma, hostedPilot.allows)).catch(reportJobError("Open raid board"));
      }
    } finally { refreshingPugs = false; }
  };
  void refreshPugs();
  setInterval(() => void ownerConsole.refresh().catch(reportJobError("Owner console board")), 5 * 60_000);
  setInterval(() => void refreshPugs(), 60_000);
  let mobileAlertsRunning = false;
  let mobileSchemaUnavailable = false;
  const mobileAlerts = async () => {
    if (mobileAlertsRunning || mobileSchemaUnavailable) return;
    mobileAlertsRunning = true;
    try { await runMobileAlerts(prisma, readyClient); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && ["P2021", "P2022"].includes(String(error.code))) {
        mobileSchemaUnavailable = true;
        console.warn("Mobile alerts paused: apply database migrations and restart the bot.");
      } else throw error;
    }
    finally { mobileAlertsRunning = false; }
  };
  void mobileAlerts().catch(reportJobError("Mobile raid alerts"));
  setInterval(() => void mobileAlerts().catch(reportJobError("Mobile raid alerts")), 60_000);
  // Cross-guild PUG requests: close finished ones, retire orphaned posts (delivery itself runs in the job queue).
  const sweepPugs = () => void sweepPugRequests(prisma, hostedPilot.allows).catch(reportJobError("PUG board sweep"));
  sweepPugs();
  setInterval(sweepPugs, 60_000);
  // Lite list first, then servers that joined while offline, then commands (full or Lite per server).
  void (async () => {
    await pilotRequests.restore();
    for (const guild of readyClient.guilds.cache.values()) {
      if (!hostedPilot.allows(guild.id)) await pilotRequests.request(guild).catch(reportJobError("Pilot approval DM"));
    }
    await registerCommandsEverywhere();
  })().catch((error: unknown) => { commandRegistration.failed("startup", error); reportJobError("Command registration")(error); });
  const voice = async () => { for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) await participationTracker.sampleVoice(guild); };
  void voice().catch(reportJobError("Participation voice checkpoint"));
  setInterval(() => void voice().catch(reportJobError("Participation voice checkpoint")), 30_000);
  setInterval(() => void (async () => {
    for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) await activityTotals.voice(guild);
    await activityTotals.flush();
  })().catch(reportJobError("Activity totals")), VOICE_TICK_MS);
  const communityActivities = () => runCommunityActivities(readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values(), reportJobError("Community honors"), reportJobError("Community activities"));
  void (async () => {
    for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) {
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
      for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) {
        await updateCommunityLeaderboard(communityRest, prisma, guild.id, readyClient.user.id).catch(reportJobError("Community leaderboard"));
      }
    } finally { refreshingCommunityBoards = false; }
  };
  void refreshCommunityBoards();
  setInterval(() => void refreshCommunityBoards(), 5 * 60_000);
  void runDiscordJobs(readyClient).catch(reportJobError("Discord delivery queue"));
  setInterval(() => void runDiscordJobs(readyClient).catch(reportJobError("Discord delivery queue")), 60_000);
  // Opt-in achievement celebrations: hourly evaluation of guilds that turned them on (no-op otherwise).
  setInterval(() => void sweepAchievementAnnouncements(prisma, new Date(), reportJobError("Achievement announcements")).catch(reportJobError("Achievement announcements")), 60 * 60_000);
  // The server's birthday: one card per anniversary, to the same opt-in channel (no-op until announcements are on).
  setInterval(() => void sweepServerAnniversaries(prisma, new Date(), reportJobError("Server anniversary")).catch(reportJobError("Server anniversary")), 60 * 60_000);
  // WoW guild rank to Discord role: on by default, inert for a guild until an officer maps a rank.
  setInterval(() => void syncAllRankRoles(prisma, readyClient.guilds.cache.values(), reportJobError("Rank roles")), 60 * 60_000);
  // Opt-in (off until an officer turns it on): member nicknames follow "Name (Main)".
  // On by default: at most one weekly "Ready to promote" list per server, only when someone is ready.
  // Waiting guild-invite requests whose character is already in the stored roster get their check mark (start-up, then hourly).
  void backCheckAllInvites(readyClient, prisma).catch(reportJobError("Guild invite back-check"));
  setInterval(() => void backCheckAllInvites(readyClient, prisma).catch(reportJobError("Guild invite back-check")), 60 * 60_000);
  // About an hour after a request is handled its messages are removed from the invite channel (the deadline is stored on the row).
  setInterval(() => void scheduleInviteCleanups(prisma).catch(reportJobError("Guild invite clean-up")), 10 * 60_000).unref?.();
  setInterval(() => void sendRecruitReminders(readyClient, prisma).catch(reportJobError("Recruiting cooldown reminders")), 60 * 60_000);
  setInterval(() => void postAllWeeklyPromotions(prisma, readyClient.guilds.cache.values(), reportJobError("Weekly promotions")), 60 * 60_000);
  // 9.0, on by default: at most one weekly guild bank summary per server, only when the bank moved.
  setInterval(() => void postAllWeeklyGuildBanks(prisma, readyClient.guilds.cache.values(), reportJobError("Weekly guild bank")), 60 * 60_000);
  // First run a few minutes after start-up (a deploy restarts the hourly clock), then hourly.
  setTimeout(() => void syncAllNicknames(prisma, readyClient.guilds.cache.values(), reportJobError("Nickname sync")), 3 * 60_000);
  setInterval(() => void syncAllNicknames(prisma, readyClient.guilds.cache.values(), reportJobError("Nickname sync")), 60 * 60_000);
  // Crafter offers past their time are closed (a no-op for servers that never turned them on).
  setInterval(() => void sweepCraftOffers(readyClient).catch(reportJobError("Craft offer expiry")), 10 * 60_000);
  void queueExpiredPolls(prisma).catch(reportJobError("Poll expiry"));
  setInterval(() => void queueExpiredPolls(prisma).catch(reportJobError("Poll expiry")), 60_000);
  // Repair missing event jobs after a restart and advance game nights at their times.
  let reconcilingEvents = false;
  const reconcileEvents = async () => {
    if (reconcilingEvents) return;
    reconcilingEvents = true;
    try {
      for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) {
        await withReportContext({ guildId: guild.id, guildName: guild.name, operation: "scheduled-events.reconcile" }, () => forEachGuildScope(prisma, guild.id, async () => {
          const record = await prisma.guild.findUnique({ where: guildWhere(guild.id), select: { id: true } });
          if (record) await queueGuildScheduledEvents(prisma, record.id);
        }));
      }
    } finally { reconcilingEvents = false; }
  };
  void reconcileEvents().catch(reportJobError("Discord scheduled events"));
  setInterval(() => void reconcileEvents().catch(reportJobError("Discord scheduled events")), 60_000);
  console.info(`Logged in as ${readyClient.user.tag}`);
  // One server at a time: starting every server's boards and raid repair at once, next to the
  // other startup jobs, used up the database connection pool on 19 October 2026.
  void (async () => {
    for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) {
      const origin = { guildId: guild.id, guildName: guild.name };
      await forEachGuildScope(prisma, guild.id, async () => {
        await updateDungeonLeaderboard(guild).catch(reportJobError("Dungeon leaderboard", origin));
        await updateDuelBoard(guild).catch(reportJobError("Duel board", origin));
        await updateRaceBoard(guild).catch(reportJobError("Race board", origin));
        await updateBgLadder(guild).catch(reportJobError("Battleground ladder", origin));
        await updateActivityBoard(guild).catch(reportJobError("Activity board", origin));
        await updateProfessionDirectory(guild).catch(reportJobError("Profession directory", origin));
        await repairCoreRaids(guild, true).catch(reportJobError("Core channels and raid posts", origin));
      });
      await refreshExistingBotGuides(guild, prisma).catch(reportJobError("Pinned bot guides", origin));
      await refreshBgPanels(guild, prisma).catch(reportJobError("PvP panels", origin));
    }
  })();
  // The live boards are edited in place every 30 minutes (and after uploads), so a season change or a missed
  // refresh never leaves a stale panel for long. Both are no-ops for a server without the channel/opt-in.
  let refreshingBoards = false;
  const refreshBoards = async () => {
    if (refreshingBoards) return;
    refreshingBoards = true;
    try {
      for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) {
        const origin = { guildId: guild.id, guildName: guild.name };
        await forEachGuildScope(prisma, guild.id, async () => {
          await updateDungeonLeaderboard(guild).catch(reportJobError("Dungeon leaderboard refresh", origin));
          await updateDuelBoard(guild).catch(reportJobError("Duel board refresh", origin));
          await updateRaceBoard(guild).catch(reportJobError("Race board refresh", origin));
          await updateBgLadder(guild).catch(reportJobError("Battleground ladder refresh", origin));
          await scheduleWeeklyRecap(prisma, guild.id).catch(reportJobError("World PvP recap", origin));
          await updateActivityBoard(guild).catch(reportJobError("Activity board refresh", origin));
        });
      }
    } finally { refreshingBoards = false; }
  };
  setInterval(() => void refreshBoards(), 30 * 60 * 1000);
  logSetupStatus(readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()).catch(reportJobError("Setup status log"));
  // One-shot: the running version only changes on a redeploy/restart, so a
  // per-ClientReady check is enough (safe on reconnect too: it marks each
  // guild before posting, so it won't repeat once it's caught up).
  announceVersionUpdates(readyClient).catch(reportJobError("Version announcement"));
  // A self-hosted bot learns about newer releases here (start, then daily).
  const updateCheck = () => announceAvailableUpdate(readyClient).catch(reportJobError("Update check"));
  void updateCheck();
  setInterval(() => void updateCheck(), 24 * 60 * 60 * 1000);
  // Daily database backup to backups/ (keeps 14 days). Its one long transaction holds a
  // connection, so the first check waits until the startup jobs above are done; then hourly.
  const backup = () => runBackup(prisma)
    .then((result) => { if (result) console.info(`Backup saved: backups/${result.file} (${result.rows} rows).`); })
    .catch(reportJobError("Database backup"));
  setTimeout(() => void backup(), 3 * 60 * 1000);
  setInterval(() => void backup(), 60 * 60 * 1000);
  // Old uploads, repeated gear checks and old error reports are pruned (services/retention.ts).
  const retention = () => runRetention(prisma)
    .then((removed) => { if (removed.imports || removed.snapshots || removed.errors) console.info(`Retention: removed ${removed.imports} old upload(s), ${removed.snapshots} old gear check(s), ${removed.errors} old error report(s).`); })
    .catch(reportJobError("Data retention"));
  setTimeout(() => void retention(), 5 * 60 * 1000);
  setInterval(() => void retention(), 6 * 60 * 60 * 1000);
  // 8.5 track G: one statistics row per guild per UTC day (stat-snapshots.ts); a run later the same day refreshes it.
  const statSnapshots = () => runStatSnapshots(prisma, (id) => readyClient.guilds.cache.get(id)?.memberCount ?? null)
    .catch(reportJobError("Statistics snapshots"));
  setTimeout(() => void statSnapshots(), 7 * 60 * 1000);
  setInterval(() => void statSnapshots(), 6 * 60 * 60 * 1000);
  // Ended trial periods are announced once in the core's officer log (services/trial-reminders.ts).
  const trials = () => remindEndedTrials(prisma, discordTrialDelivery(readyClient, prisma, (id) => hostedPilot.allows(id)))
    .catch(reportJobError("Trial reminders"));
  setTimeout(() => void trials(), 6 * 60 * 1000);
  setInterval(() => void trials(), 60 * 60 * 1000);
  // Opted-in guilds' dungeon runs go to the public leaderboards (/mod leaderboard, 7.0).
  setInterval(() => void publishGuildRuns(prisma).catch(reportJobError("Public dungeon runs")), 15 * 60 * 1000);
  // Dungeon seasons follow the owner's calendar (/guilded-season, official-seasons.ts): every guild
  // rotates at a season's start, after a backup to backups/seasons. Idempotent across restarts.
  let rotating = false;
  const rotateSeasons = () => {
    if (rotating) return;
    rotating = true;
    // The public leaderboards' rules freeze when a season starts, then only gain new routes.
    // WoW Forever only (the Classic Era quarterly calendar job is retired; stored seasons stay as they are).
    (async () => { await withEdition("forever", () => freezeSeasonRules(prisma, new Date())
      .then((change) => {
        if (change?.frozen) console.info(`Public dungeon rules frozen for ${change.season}.`);
        else if (change) console.info(`Public dungeon rules for ${change.season} gained routes ${change.routes.join(", ") || "-"}, brackets ${change.brackets.join(", ") || "-"}.`);
      })
      .catch(reportJobError("Public season rules"))
      .then(() => loadOfficialWindows(prisma))
      .then((windows) => rotateOfficialSeasons(prisma, windows, new Date(), (discordId) => hostedPilot.allows(discordId), () => runBackup(prisma, new Date(), `${BACKUP_DIR}/seasons`, 24), startOfficialSeason(prisma)))
      .then(async (rotated) => {
        const finalized = await finalizeClosingSeasons(prisma, new Date(), id => hostedPilot.allows(id));
        for (const guildId of finalized) if (!rotated.some(row=>row.guildId===guildId)) rotated.push({ guildId, season: "Upload grace finalized", ended: null });
        for (const row of rotated) {
          console.info(`Dungeon season rotated: ${row.ended ?? "none"} -> ${row.season} (guild ${row.guildId}).`);
          const guild = await prisma.guild.findUnique({ where: { id: row.guildId }, select: { discordId: true } });
          const discordGuild = guild ? readyClient.guilds.cache.get(guild.discordId) ?? null : null;
          await withGuildScope(prisma, row.guildId, () => updateDungeonLeaderboard(discordGuild)).catch(reportJobError("Dungeon leaderboard after season rotation"));
        }
      })
      .catch(reportJobError("Dungeon seasons"))); })().finally(() => { rotating = false; });
  };
  setTimeout(rotateSeasons, 60_000);
  setInterval(rotateSeasons, 5 * 60 * 1000);
  let recurringBusy = false;
  const recurring = async () => {
    if (recurringBusy) return;
    recurringBusy = true;
    try {
      await runRecurringDeliveries(readyClient, prisma).catch(reportJobError("Opt-in recurring delivery"));
      await dispatchGroupWatches(readyClient, prisma).catch(reportJobError("Opt-in vacancy delivery"));
    } finally { recurringBusy = false; }
  };
  void recurring();
  setInterval(() => void recurring(), 5 * 60_000);
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
    (async () => { for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) await withReportContext({ guildId: guild.id, guildName: guild.name, operation: "raid-signup.repair" }, () => forEachGuildScope(prisma, guild.id, () => repairCoreRaids(guild))); })()
      .catch(reportJobError("Raid signup repair")).finally(() => { repairing = false; });
  }, 5 * 60 * 1000);
  // Weekly guild report (if enabled): checked hourly.
  setInterval(() => {
    // Retry failed approval DMs without querying Postgres or resending delivered requests.
    for (const guild of readyClient.guilds.cache.values()) {
      if (!hostedPilot.allows(guild.id)) void pilotRequests.request(guild).catch(reportJobError("Pilot approval DM", { guildId: guild.id, guildName: guild.name }));
    }
    // Lite servers nobody used for 30 days are told, then left 7 days later.
    pilotRequests.sweepIdle().catch(reportJobError("Idle Lite servers"));
    // Set-up, active Lite servers are approved by themselves when HOSTED_AUTO_APPROVE_DAYS is set.
    pilotRequests.sweepAutoApprove().catch(reportJobError("Automatic Lite approval"));
    // The owner console's optional daily digest (off unless the owner turned it on).
    ownerConsole.digestTick().catch(reportJobError("Owner console digest"));
    // Re-evaluate snapshot age even when nobody clicks a signup or uploads new gear.
    (async () => {
      for (const guild of readyClient.guilds.cache.filter(guild => hostedPilot.allows(guild.id)).values()) {
        await withReportContext({ guildId: guild.id, guildName: guild.name, operation: "character-display.refresh" }, () => forEachGuildScope(prisma, guild.id, async () => {
          const record = await guildService.ensureGuild(guild.id, guild.name);
          await queueCharacterDisplayRefresh(prisma, record.id);
        }));
      }
    })().catch(reportJobError("Character display refresh"));
    runWeeklyReports(readyClient).catch(reportJobError("Weekly report check"));
    // 9.1: the daily recap card, once per server day (on by default, officers switch it off with /stats recap-posts:false).
    runDailyRecaps(readyClient).catch(reportJobError("Daily recap check"));
    // 9.1: the raid night check card, once per planned raid about four hours before it starts (officers switch it off).
    runRaidNightChecks(readyClient, prisma, pilotGuildScope).catch(reportJobError("Raid night check"));
    // Automatic EPGP decay after each weekly reset (guilds that turned it on).
    runAutoDecay(prisma).catch(reportJobError("Automatic decay"));
    // One private reminder to new members who have not finished onboarding (guilds that turned it on).
    runOnboardingNudges(readyClient).catch(reportJobError("Onboarding reminders"));
    runGameReminders(readyClient).catch(reportJobError("Game reminders"));
  }, 60 * 60 * 1000);
});

// Bot just added to a server: point whoever invited it at /setup.
client.on(Events.GuildCreate, (guild) => {
  if (!hostedPilot.allows(guild.id)) {
    // Waiting for approval: Guilded Lite when a slot is free (recorded before the owner DM is sent).
    void pilotRequests.request(guild).catch(reportJobError("Pilot approval DM", { guildId: guild.id, guildName: guild.name })).then(async () => {
      const lite = hostedPilot.tier(guild.id) === "lite" ? commandSetFor("lite", commands) : null;
      if (!lite) return;
      await registerCommands(guild.id, lite);
      await greetNewGuild(guild, true);
    }).catch(reportJobError("Registering Lite commands for new guild", { guildId: guild.id, guildName: guild.name }));
    return;
  }
  registerCommands(guild.id).catch(reportJobError("Registering commands for new guild", { guildId: guild.id, guildName: guild.name }));
  greetNewGuild(guild).catch((error: unknown) => { console.error("Greeting new guild failed", error); void errorReportService.report(client, error, { source: "Greeting new guild", guildId: guild.id, guildName: guild.name }); });
});

// Removed from a waiting server (an outage is GuildUnavailable instead): free its Lite slot.
client.on(Events.GuildDelete, (guild) => {
  if (!hostedPilot.allows(guild.id)) void pilotRequests.forget(guild.id).catch(reportJobError("Pilot request cleanup", { guildId: guild.id }));
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (!hostedPilot.allows(member.guild.id)) return;
  try {
    const record = await prisma.guild.findUnique({ where: guildWhere(member.guild.id), select: { id: true } });
    if (record && member.joinedAt && !member.user.bot) await rememberRookieJoin(prisma, record.id, member.id, member.joinedAt);
    await handleMemberJoin(member.guild, member);
    if (!member.user.bot) await warnDoNotInvite(member.guild, { discordUserId: member.id }, `<@${member.id}> (${member.user.tag})`, "join");
  } catch (error) {
    console.error("GuildMemberAdd handling failed", error);
    void errorReportService.report(client, error, { source: "GuildMemberAdd", guildId: member.guild.id, guildName: member.guild.name, userId: member.id });
  }
});

// Preserve tenure before a leave/rejoin, independently of character and roster resets.
client.on(Events.GuildMemberRemove, async member => {
  if (!hostedPilot.allows(member.guild.id)) return;
  try {
    const record = await prisma.guild.findUnique({ where: guildWhere(member.guild.id), select: { id: true } });
    if (record && member.joinedAt && !member.user.bot) await rememberRookieJoin(prisma, record.id, member.id, member.joinedAt);
  } catch (error) { console.error("Rookie membership history failed", error); }
});

// The officer log's "joined the guild" line: someone got the Member role or a leadership role.
client.on(Events.GuildMemberUpdate, async (before, after) => {
  if (!hostedPilot.allows(after.guild.id)) return;
  try {
    await forEachGuildScope(prisma, after.guild.id, () => handleMemberRolesChange(after.guild, before, after));
  } catch (error) {
    console.error("GuildMemberUpdate handling failed", error);
    void errorReportService.report(client, error, { source: "GuildMemberUpdate", guildId: after.guild.id, guildName: after.guild.name, userId: after.id });
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (!hostedPilot.allows(member.guild.id)) return;
  try {
    await forEachGuildScope(prisma, member.guild.id, () => handleMemberLeave(member.guild, member));
  } catch (error) {
    console.error("GuildMemberRemove handling failed", error);
    void errorReportService.report(client, error, { source: "GuildMemberRemove", guildId: member.guild.id, guildName: member.guild.name, userId: member.id });
  }
});

// The guild-invite channel (8.5 batch 3): reactions and the World of Warcraft role DM do not need message text.
client.on(Events.MessageReactionAdd, (reaction, user) => { if (reaction.message.guildId && hostedPilot.allows(reaction.message.guildId)) void handleInviteReaction(client, prisma, reaction, user).catch(reportJobError("Guild invite reaction", { guildId: reaction.message.guildId, channelId: reaction.message.channelId })); });
client.on(Events.GuildMemberUpdate, (before, after) => { if (hostedPilot.allows(after.guild.id)) void handleWowRoleGiven(before, after, prisma).catch(reportJobError("Guild invite DM", { guildId: after.guild.id })); });
// A plain DM that looks like a full name, from a member the role DM asked (DirectMessages is not a privileged intent).
client.on(Events.MessageCreate, message => { if (!message.guildId && !message.author.bot) void handleInviteDm(message, prisma).catch(reportJobError("Guild invite DM reply")); });
client.on(Events.MessageCreate, message => { if (message.guildId && hostedPilot.allows(message.guildId)) void activityTotals.message(message).catch(reportJobError("Activity totals messages", { guildId: message.guildId, channelId: message.channelId })); });
client.on(Events.MessageReactionAdd, (reaction, user) => { if (reaction.message.guildId && hostedPilot.allows(reaction.message.guildId)) void activityTotals.reaction(reaction, user).catch(reportJobError("Activity totals reactions", { guildId: reaction.message.guildId, channelId: reaction.message.channelId })); });
client.on(Events.MessageCreate, message => { if (message.guildId && hostedPilot.allows(message.guildId)) void participationTracker.message(message).catch(reportJobError("Participation messages", { guildId: message.guildId, channelId: message.channelId, messageId: message.id })); });
client.on(Events.MessageReactionAdd, (reaction, user) => { if (reaction.message.guildId && hostedPilot.allows(reaction.message.guildId)) void participationTracker.reaction(reaction, user).catch(reportJobError("Participation reactions", { guildId: reaction.message.guildId, channelId: reaction.message.channelId, messageId: reaction.message.id })); });
client.on(Events.MessageDelete, message => { if (message.guildId && hostedPilot.allows(message.guildId)) void participationTracker.deleted(message).catch(reportJobError("Participation deleted message", { guildId: message.guildId, channelId: message.channelId })); });
// Opt-in per server (/config starboard, /config message-log); both do nothing until turned on.
client.on(Events.MessageReactionAdd, reaction => { if (reaction.message.guildId && hostedPilot.allows(reaction.message.guildId)) void handleStarReaction(reaction).catch(reportJobError("Starboard", { guildId: reaction.message.guildId, channelId: reaction.message.channelId })); });
client.on(Events.MessageReactionRemove, reaction => { if (reaction.message.guildId && hostedPilot.allows(reaction.message.guildId)) void handleStarReaction(reaction).catch(reportJobError("Starboard", { guildId: reaction.message.guildId, channelId: reaction.message.channelId })); });
client.on(Events.MessageUpdate, (before, after) => { if (after.guildId && hostedPilot.allows(after.guildId)) void logMessageEdit(before, after).catch(reportJobError("Message log", { guildId: after.guildId, channelId: after.channelId })); });
client.on(Events.MessageDelete, message => { if (message.guildId && hostedPilot.allows(message.guildId)) void logMessageDelete(message).catch(reportJobError("Message log", { guildId: message.guildId, channelId: message.channelId })); });
client.on(Events.MessageBulkDelete, messages => { void (async () => { for (const message of messages.values()) if (message.guildId && hostedPilot.allows(message.guildId)) await withReportContext({ guildId: message.guildId, channelId: message.channelId }, () => participationTracker.deleted(message)); })().catch(reportJobError("Participation deleted messages")); });
client.on(Events.VoiceStateUpdate, (_before, after) => { if (hostedPilot.allows(after.guild.id)) void participationTracker.sampleVoice(after.guild).catch(reportJobError("Participation voice change", { guildId: after.guild.id, channelId: after.channelId })); });
client.on(Events.GuildMemberUpdate, (_before, after) => { if (hostedPilot.allows(after.guild.id)) void participationTracker.sampleVoice(after.guild).catch(reportJobError("Participation eligibility change", { guildId: after.guild.id })); });
client.on(Events.GuildMemberRemove, member => { if (hostedPilot.allows(member.guild.id)) void participationTracker.sampleVoice(member.guild).catch(reportJobError("Participation member left", { guildId: member.guild.id })); });
client.on(Events.GuildRoleUpdate, (_before, role) => { if (hostedPilot.allows(role.guild.id)) void participationTracker.sampleVoice(role.guild).catch(reportJobError("Participation role permissions", { guildId: role.guild.id })); });
client.on(Events.ChannelUpdate, (_before, channel) => { if ("guild" in channel && hostedPilot.allows(channel.guild.id)) void participationTracker.sampleVoice(channel.guild).catch(reportJobError("Participation channel permissions", { guildId: channel.guild.id, channelId: channel.isTextBased() ? channel.id : null })); });
client.on(Events.GuildUpdate, (_before, guild) => { if (hostedPilot.allows(guild.id)) void participationTracker.sampleVoice(guild).catch(reportJobError("Participation guild settings", { guildId: guild.id })); });
client.on(Events.GuildUnavailable, guild => participationTracker.reset(guild.id));
client.on(Events.ShardDisconnect, () => participationTracker.reset());
client.on(Events.ShardReconnecting, () => participationTracker.reset());
client.on(Events.ShardResume, () => participationTracker.reset());
// The answer channel (5.0): only when the bot may read message text.
if (config.MESSAGE_CONTENT_INTENT) {
  client.on(Events.MessageCreate, (message) => { if (message.guildId && hostedPilot.allows(message.guildId)) void handleInviteMessage(message, prisma).catch(reportJobError("Guild invite post", { guildId: message.guildId, channelId: message.channelId, messageId: message.id })); });
  // Discord-only item previews (docs/ITEM_PREVIEWS.md): inert until an owner enables a server.
  const previewGate = new PreviewGate();
  // Cached and rate-limited; the null provider without a Battle.net app. At most 4 s per lookup: a slow Battle.net
  // (12 s on 8 Nov) posts the preview with a Wowhead search link instead of holding it back.
  const previewProvider = withDeadline(itemData, 4_000);
  const previewBackoff = new Map<string, number>();
  client.on(Events.MessageCreate, (message) => {
    if (!message.guildId || !hostedPilot.allows(message.guildId) || !message.content.includes("[")) return; // every item link has a bracket
    void handlePreviewMessage({
      loadConfig: (discordGuildId) => prisma.itemPreviewConfig.findUnique({ where: { discordGuildId } }),
      disable: async (discordGuildId, reason) => { await prisma.itemPreviewConfig.updateMany({ where: { discordGuildId }, data: { enabled: false, disabledReason: reason } }); },
      secret: config.ITEM_PREVIEW_SECRET, botUserId: client.user?.id,
      fetch: (url, init) => fetch(url, init), provider: previewProvider, gate: previewGate, backoff: previewBackoff,
      language: async (discordId) => (await prisma.guildSettings.findFirst({ where: { guild: { discordId } }, select: { language: true } }))?.language === "fr" ? "fr" : "en",
      ...(config.PUBLIC_SITE_URL ? { siteUrl: config.PUBLIC_SITE_URL } : {}),
      professionCard: (discordGuildId, profession, names, discordUserId) => professionCardFor(prisma, previewProvider, discordGuildId, profession, names, discordUserId)
    }, { guildId: message.guildId, channelId: message.channelId, content: message.content, authorId: message.author.id, webhookId: message.webhookId,
      authorName: message.webhookId ? message.author.username : message.member?.displayName ?? message.author.displayName }).catch((error: unknown) => {
      console.warn("Item preview failed", error instanceof Error ? error.name : "error");
    });
  });
  client.on(Events.MessageCreate, (message) => {
    if (!message.guildId || !hostedPilot.allows(message.guildId)) return;
    void (async () => {
      const scope = await interactionGuildScope(prisma, {discordId:message.guildId!,userId:message.author.id,channelId:message.channelId,parentId:"parentId" in message.channel ? message.channel.parentId : null});
      if (scope) await runInGuildScope(scope, () => answerMessage(message, answerCommandList));
      else await answerMessage(message, answerCommandList);
    })().catch((error: unknown) => {
      console.warn("Answer channel failed", error);
      void errorReportService.report(client, error, { source: "Answer channel", guildId: message.guildId, guildName: message.guild?.name, userId: message.author.id, channelId: message.channelId, messageId: message.id, operation: "answer-channel.reply" });
    });
  });
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    const serverCommands = ["wow", "community", "organize", "poe", "participation", "events", "guilded-season", "guilded-events", OWNER_PREVIEWS_COMMAND, OWNER_CONSOLE_COMMAND];
    const globalButton = "customId" in interaction && [PILOT_REQUEST_PREFIX, COMMUNITY_PREFIX, WELCOME_ROLE_PREFIX, SELF_ROLE_PREFIX, ONBOARD_PREFIX, GAME_REMINDER_PREFIX, INVITE_REQUEST_PREFIX, LINKED_PREFIX, PUG_PREFIX, CONSOLE_PREFIX, ITEM_PREVIEW_PREFIX].some(prefix => interaction.customId.startsWith(prefix));

    const wowOrganize = interaction.isChatInputCommand() && interaction.commandName === "organize" && interaction.options.getSubcommandGroup(false) === "dungeon-seasons";
    const globalCommand = "commandName" in interaction && serverCommands.includes(interaction.commandName) && !wowOrganize;
    const scope = interaction.guildId && hostedPilot.allows(interaction.guildId) && !globalCommand && !globalButton
      ? ("customId" in interaction ? await entityGuildScope(prisma, interaction.guildId, interaction.customId) : null)
        ?? await interactionGuildScope(prisma, { discordId: interaction.guildId, userId: interaction.user.id, channelId: interaction.channelId, parentId: interaction.channel && "parentId" in interaction.channel ? interaction.channel.parentId : null }) : null;
    if (scope && interaction.guild) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (scope.memberRoleId && !member.permissions.has("Administrator") && !member.roles.cache.has(scope.memberRoleId)) throw new Error("You need this in-game guild's member role.");
      await runInGuildScope(scope, () => handleGuildInteraction(interaction));
    } else await handleGuildInteraction(interaction);
  } catch (error) {
    if (interaction.isAutocomplete()) await interaction.respond([]).catch(() => undefined);
    else if (interaction.isRepliable()) {
      const content = error instanceof Error && error.message.length < 220 ? error.message : "Could not select the in-game guild. Use /wow list and /wow use.";
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
});

async function handleGuildInteraction(interaction: Interaction): Promise<void> {
  // The owner's private console: every id is owner-checked inside, in the home server only.
  if ("customId" in interaction && interaction.customId.startsWith(CONSOLE_PREFIX)) {
    await ownerConsole.handle(interaction).catch((error: unknown) => reportInteractionError("Owner console", interaction, error));
    return;
  }
  // A setup wizard screen whose collector is gone (bot restarted, or the wizard timed out): say so instead of "This interaction failed".
  if (interaction.isMessageComponent() && interaction.customId.startsWith("setup:") && !isLiveSetupMessage(interaction.message.id)) {
    await interaction.reply({ content: "This setup screen has expired. Run `/setup start` again; your choices are saved. / Cet écran de configuration a expiré. Relancez `/setup start`; vos choix sont enregistrés.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(ITEM_PREVIEW_PREFIX)) {
    await handleItemPreviewButton(interaction).catch((error: unknown) => reportInteractionError("Item preview step 0", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(PILOT_REQUEST_PREFIX)) {
    try { await pilotRequests.handle(interaction); }
    catch (error) {
      reportInteractionError("Pilot approval", interaction, error);
      const content = "Unable to apply this decision. Check the pilot capacity and host configuration, then retry. / Décision impossible : vérifiez la limite du pilote et la configuration, puis réessayez.";
      if (interaction.deferred) await interaction.editReply(content).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  const tier = interaction.guildId ? hostedPilot.tier(interaction.guildId) : "approved";
  // Lite: only the Lite slash commands (stale registrations included); its own buttons and modals pass.
  const liteBlocked = tier === "lite" && (interaction.isChatInputCommand() || interaction.isAutocomplete())
    && !allowsLite(interaction.commandName, interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand(false));
  if (tier === "lite") void pilotRequests.touch(interaction.guildId!).catch(reportJobError("Lite activity", { guildId: interaction.guildId, channelId: interaction.channelId }));
  if (tier === "blocked" || liteBlocked) {
    if (interaction.isAutocomplete()) await interaction.respond([]).catch(() => undefined);
    else if (interaction.isRepliable()) await interaction.reply({ content: tier === "lite" ? PILOT_LITE_DENIED : PILOT_DENIED, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(PUG_PREFIX)) {
    try { await handlePugComponent(interaction); }
    catch (error) {
      reportInteractionError("PUG board interaction", interaction, error);
      const content = "Could not update the PUG board. / Impossible de mettre à jour le tableau PUG.";
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(BG_PREFIX)) {
    try {
      if (tier === "lite") throw new Error(PILOT_LITE_DENIED);
      await handleBattlegroundComponent(interaction);
    } catch (error) {
      reportInteractionError("Battleground interaction", interaction, error);
      const content = error instanceof Error && error.message.length < 250 ? error.message : "Could not update BG / Impossible de modifier le groupe JcJ.";
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isAutocomplete() && interaction.commandName === "team") {
    await autocompleteTeam(interaction).catch(async () => { if (!interaction.responded) await interaction.respond([]).catch(() => undefined); });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(TEAM_BUTTON_PREFIX)) {
    try { await handleTeamButton(interaction); }
    catch (error) {
      reportInteractionError("Team interaction", interaction, error);
      const content = error instanceof Error && error.message.length < 250 ? error.message : "Could not update the session / Impossible de modifier la séance.";
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(COMMUNITY_PREFIX)) {
    try {
      if (interaction.customId.startsWith(COMMUNITY_HUB_PREFIX)) await handleCommunityHub(interaction);
      else if (interaction.isButton()) await handleCommunityButton(interaction);
      else if (interaction.isModalSubmit()) await handleCommunityModal(interaction);
    } catch (error) {
      reportInteractionError("Community interaction", interaction, error);
      const content = error instanceof Error && error.message.length < 200 ? error.message : "Impossible de traiter cette demande / Could not process this request.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
      const content = "That didn't work, try again or ask an officer.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(LINK_MOVE_PREFIX)) {
    await handleLinkMoveButton(interaction, prisma).catch(async (error: unknown) => {
      reportInteractionError("Character move undo button", interaction, error);
      const content = "That didn't work, try again or ask an officer. / Ça n'a pas fonctionné; réessaie ou demande à un officier.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith(PANEL_PREFIX)) {
    await handlePanelInteraction(interaction, prisma).catch(async (error: unknown) => {
      reportInteractionError("Character panel", interaction, error);
      const content = "That didn't work, try again or ask an officer. / Ça n'a pas fonctionné; réessaie ou demande à un officier.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(LINKED_PREFIX)) {
    await handleLinkedButton(interaction, prisma).catch(async (error: unknown) => {
      reportInteractionError("Linked characters button", interaction, error);
      const content = "That didn't work, try again or ask an officer. / Ça n'a pas fonctionné; réessaie ou demande à un officier.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(INVITE_REQUEST_PREFIX)) {
    const handler = interaction.isButton() && interaction.customId.startsWith(`${INVITE_REQUEST_PREFIX}done:`) ? handleInviteDoneButton(interaction, prisma) : handleInviteRequestInteraction(interaction, prisma);
    await handler.catch(async (error: unknown) => {
      reportInteractionError("Guild invite request", interaction, error);
      const content = "That didn't work, try again or ask an officer. / Ça n'a pas fonctionné; réessaie ou demande à un officier.";
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ content }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(GAME_REMINDER_PREFIX)) {
    await handleGameReminderButton(interaction).catch(async (error: unknown) => {
      reportInteractionError("Game reminders", interaction, error);
      const content = "That didn't work, try again or ask an officer. / Ça n'a pas fonctionné; réessaie ou demande à un officier.";
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ content, components: [] }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(ONBOARD_PREFIX)) {
    await handleOnboardingInteraction(interaction).catch(async (error: unknown) => {
      reportInteractionError("Onboarding", interaction, error);
      const content = "That didn't work, try again or ask an officer. / Ça n'a pas fonctionné; réessaie ou demande à un officier.";
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ content, components: [], embeds: [] }).catch(() => undefined);
      else if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(FAQ_MODAL_PREFIX)) {
    await handleFaqModal(interaction).catch((error: unknown) => {
      if (!(error instanceof Error && error.message.length < 200)) reportInteractionError("Answer form", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: error instanceof Error ? error.message : "Could not save the answer.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
        void interaction.reply({ content: error instanceof Error ? error.message : "Could not post the dungeon group.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(BANK_REQUEST_PREFIX)) {
    await handleBankRequestButton(interaction).catch((error: unknown) => reportInteractionError("Bank request button", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(OFFER_PREFIX)) {
    await handleOfferButton(interaction).catch((error: unknown) => reportInteractionError("Craft offer button", interaction, error));
    return;
  }
  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith(`${CRAFT_PREFIX}askwho:`) || interaction.customId === `${CRAFT_PREFIX}notifypick`)) {
    await handleCraftSelect(interaction).catch((error: unknown) => reportInteractionError("Craft menu", interaction, error));
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(PROFESSION_DETAILS_PREFIX)) {
    await handleProfessionDetails(interaction).catch((error: unknown) => reportInteractionError("Profession details", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(CRAFT_PREFIX)) {
    await handleCraftButton(interaction).catch((error: unknown) => reportInteractionError("Craft button", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(DUNGEON_TIMELINE_PREFIX)) {
    await handleDungeonTimeline(interaction).catch((error: unknown) => reportInteractionError("Dungeon timeline", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(ACHIEVEMENT_SHARE_PREFIX)) {
    await handleAchievementShare(interaction).catch((error: unknown) => reportInteractionError("Achievement share", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(POLL_PREFIX)) {
    await handlePollButton(interaction).catch((error: unknown) => reportInteractionError("Poll button", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(WEEKLY_QUESTION_PREFIX)) {
    await handleWeeklyQuestionButton(interaction).catch((error: unknown) => reportInteractionError("Weekly question review", interaction, error));
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === `${DUNGEON_GUIDE_PREFIX}kind`) {
    await handleDungeonGuideSelect(interaction).catch((error: unknown) => {
      reportInteractionError("Group finder menu", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "Could not open the group form.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId === GROUP_ALERT_OPEN_ID) {
    await openGroupAlerts(interaction).catch((error: unknown) => {
      reportInteractionError("Group alerts button", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "Could not open your group alerts.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(GROUP_ALERT_PREFIX)) {
    await handleGroupAlertComponent(interaction).catch((error: unknown) => {
      reportInteractionError("Group alerts", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "Could not save your group alerts.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId === `${DUNGEON_GUIDE_PREFIX}create`) {
    await handleDungeonGuideButton(interaction).catch((error: unknown) => {
      reportInteractionError("Dungeon signup guide button", interaction, error);
      if (!interaction.replied) {
        void interaction.reply({ content: "Could not open the dungeon group form.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
      if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(RANK_ROLES_BUTTON_PREFIX)) {
    await handleRankRolesButton(interaction).catch((error: unknown) => {
      reportInteractionError("Rank roles preview", interaction, error);
      if (!interaction.replied) void interaction.reply({ content: "That didn't work, try again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(ROSTER_BUTTON_PREFIX)) {
    await handleRosterButton(interaction).catch((error: unknown) => {
      reportInteractionError("Roster gaps", interaction, error);
      const content = "That didn't work, try again.";
      if (interaction.replied || interaction.deferred) void interaction.editReply({ content, components: [] }).catch(() => undefined);
      else void interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(OFFICER_PREFIX)) {
    try {
      if (interaction.isButton()) await handleOfficerButton(interaction);
      else await handleOfficerModal(interaction);
    } catch (error) {
      reportInteractionError("Officer tools", interaction, error);
      const content = error instanceof Error && error.message.length < 200 ? error.message : "Could not apply that change.";
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content, components: [] }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(RAID_SPEC_PREFIX)) {
    try {
      await handleRaidSpecSelect(interaction);
    } catch (error) {
      reportInteractionError("Raid spec choice", interaction, error);
      const content = error instanceof Error ? error.message : "Could not change your spec.";
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content, components: [] }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(EP_AWARD_PREFIX)) {
    try {
      await handleEpAwardButton(interaction);
    } catch (error) {
      reportInteractionError("EP award button", interaction, error);
      const content = error instanceof Error ? error.message : "Could not record the EP award.";
      if (!interaction.replied) await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(APPLY_PREFIX)) {
    await handleApplyModal(interaction).catch((error: unknown) => reportInteractionError("Application form", interaction, error));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(WEB_APPLY_PREFIX)) {
    await handleWebApplicationButton(interaction, prismaWebStore(prisma)).catch(async (error: unknown) => {
      reportInteractionError("Website application button", interaction, error);
      if (!interaction.replied) await interaction.reply({ content: "Could not save this answer, try again. / Réponse non enregistrée, réessayez.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(APPLY_PREFIX)) {
    await handleApplyButton(interaction).catch(async (error: unknown) => {
      reportInteractionError("Application button", interaction, error);
      const content = error instanceof Error ? error.message : "Impossible d'ouvrir ta candidature.";
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content, components: [] }).catch(() => undefined);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
          await interaction.reply({ content: "Could not update that role. Please try again or contact an officer.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
      }
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === OWNER_CONSOLE_COMMAND) {
    await executeOwnerConsole(interaction, ownerConsole, () => botOwnerId(client)).catch((error: unknown) => replyWithCommandError(interaction, error));
    return;
  }
  if (interaction.commandName === OWNER_PREVIEWS_COMMAND) {
    await executeOwnerPreviews(interaction).catch((error: unknown) => replyWithCommandError(interaction, error));
    return;
  }
  if (interaction.commandName === OWNER_SEASON_COMMAND) {
    await executeOwnerSeason(interaction).catch((error: unknown) => replyWithCommandError(interaction, error));
    return;
  }
  const found = resolveCommand(commands, interaction);
  const handler = found.handler ?? handlers.get(found.legacy);
  if (!handler) {
    await interaction.reply({ content: "That command is not available.", flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    await handler(found.merged ? legacyView(interaction, found.legacy, found.sub) : interaction);
  } catch (error) {
    await replyWithCommandError(interaction, error);
  }
}

// Replaces the server's whole command list: the full set, or Guilded Lite's (commands/lite.ts).
// The bot owner's /guilded-season exists only in the home server (DISCORD_GUILD_ID).
async function registerCommands(guildId: string, body: unknown[] = commands.map((command) => command.toJSON())): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const full = [...body, ...(guildId === config.DISCORD_GUILD_ID ? [ownerSeasonCommand.toJSON(), ownerPreviewsCommand.toJSON()] : []), ...(guildId === config.OWNER_CONSOLE_GUILD_ID ? [ownerConsoleCommand.toJSON()] : [])];
  await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId), { body: full });
}

// Commands are per-guild, so every server the bot is in needs them registered.
// The outcome is shown on /health (commandRegistration) for deploy/update.sh.
async function registerCommandsEverywhere(): Promise<void> {
  commandRegistration.start();
  const guildIds = new Set<string>([config.DISCORD_GUILD_ID, config.OWNER_CONSOLE_GUILD_ID, ...client.guilds.cache.keys()]);
  for (const guildId of guildIds) {
    const body = commandSetFor(hostedPilot.tier(guildId), commands);
    if (!body) continue;
    await registerCommands(guildId, body).catch((error: unknown) => {
      console.warn(`Command registration failed for guild ${guildId}`, error);
      commandRegistration.failed(guildId, error);
      void errorReportService.report(client, error, { source: "Command registration", guildId, guildName: client.guilds.cache.get(guildId)?.name, operation: "commands.register" });
    });
  }
  commandRegistration.finish();
}

const pilotRequests = createPilotRequests(client, { enabled: hostedPilot.enabled, allows: hostedPilot.allows, replace: replacePilotApprovals,
  liteLimit: config.HOSTED_LITE_LIMIT, replaceLite: replacePilotLite,
  activate: async guild => { await registerCommands(guild.id); await greetNewGuild(guild); },
  demote: async guild => { const lite = commandSetFor("lite", commands); if (lite) await registerCommands(guild.id, lite).catch(reportJobError("Registering Lite commands after demotion", { guildId: guild.id, guildName: guild.name })); },
  welcome: guild => welcomeApprovedOwner(client, guild), warnIdle: guild => warnIdleLite(client, guild),
  autoApprove: { days: config.HOSTED_AUTO_APPROVE_DAYS, members: config.HOSTED_AUTO_APPROVE_MEMBERS,
    // Settings exist after any command; the bot-guide channel only after /setup start.
    ready: async id => Boolean(await prisma.guildSettings.findFirst({ where: { guild: { discordId: id }, guideChannelId: { not: null } }, select: { guildId: true } })) } });
const ownerConsole = createOwnerConsole({ db: prisma, client, homeGuildId: config.OWNER_CONSOLE_GUILD_ID, ownerId: () => botOwnerId(client),
  tier: id => hostedPilot.tier(id), setTier: (id, tier) => pilotRequests.setTier(id, tier), version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string, tools: consoleTools });
await client.login(config.DISCORD_TOKEN);
