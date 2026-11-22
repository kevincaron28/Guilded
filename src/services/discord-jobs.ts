import { seasonCardChannel } from "./season-cards.js";
import { siteUrl } from "../site-url.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { currentGuildScope, withGuildScope } from "./guild-scope.js";
import { randomUUID } from "node:crypto";
import type { DiscordJob, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AttachmentBuilder, EmbedBuilder, type Client, type Guild, type MessageCreateOptions } from "discord.js";
import { prisma } from "../database.js";
import { cardAltText } from "./card-alt.js";
import { messageForDelivery } from "./card-only.js";
import { participationDay } from "./participation-rules.js";

type Db = Pick<PrismaClient, "discordJob">;
export type JobKind = "GAME_EVENT_BOARD" | "GAME_EVENT_REMINDER" | "RAID_REMINDER" | "POLL_REFRESH" | "DUNGEON_BOARD" | "DUEL_BOARD" | "ACTIVITY_BOARD" | "WHOS_WHO_BOARD" | "RACE_BOARD" | "BG_LADDER" | "PROFESSIONS" | "RAID_POST" | "CORE_ROSTER" | "CALENDAR" | "SIGNUP_ANSWERS" | "MESSAGE" | "COMMUNITY_POST" | "SCHEDULED_EVENT" | "TEAM_ROSTER" | "TEAM_SESSION" | "TEAM_REMINDER" | "PUG_POST" | "PUG_NOTICE" | "PVP_CALL" | "PVP_RECAP" | "GAME_REMINDER" | "INVITE_CLEANUP";
export async function enqueueDiscordJob(database: Db, guildId: string, key: string, kind: JobKind, payload: Prisma.InputJsonValue = {}, notBefore?: Date) {
  return database.discordJob.upsert({ where: { guildId_key: { guildId, key } },
    create: { guildId, key, kind, payload, ...(notBefore ? { nextAttemptAt: notBefore } : {}) },
    // Never clear an active lease. Its owner notices a newer revision when settling.
    update: { kind, payload, revision: { increment: 1 }, status: "PENDING", attempts: 0, nextAttemptAt: notBefore ?? new Date(), lastError: null } });
}

export function retryDelay(attempt: number): number { return Math.min(3_600_000, 30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7)); }

// Discord answers that will not change by retrying: the channel or server is gone, the bot may not post there, or DMs are closed.
// They used to retry every hour forever (each one an invalid request counted against the bot). After about a day of
// attempts the job stops as FAILED; a newer refresh of the same post, or an officer's /system retry, revives it.
const PERMANENT_DISCORD_CODES = new Set(["10003", "10004", "50001", "50007", "50013"]);
export const PERMANENT_FAILURE_ATTEMPTS = 24;
export function givesUp(code: string, attempts: number): boolean { return PERMANENT_DISCORD_CODES.has(code) && attempts >= PERMANENT_FAILURE_ATTEMPTS; }
const available = (now: Date): Prisma.DiscordJobWhereInput => ({ status: "PENDING", nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] });

// Atomic lease + revision check protects a refresh enqueued during a slow Discord call.
export async function deliverDiscordJob(database: Db, id: string, send: (job: DiscordJob) => Promise<void>, now = new Date()): Promise<boolean> {
  const token = randomUUID();
  const claim = await database.discordJob.updateMany({ where: { id, ...available(now) }, data: { leaseToken: token, lockedUntil: new Date(now.getTime() + 5 * 60_000), attempts: { increment: 1 } } });
  if (!claim.count) return false;
  const job = await database.discordJob.findUnique({ where: { id } });
  if (!job || job.leaseToken !== token) return false;
  try {
    await send(job);
    await database.discordJob.updateMany({ where: { id, leaseToken: token, revision: job.revision }, data: { status: "DONE", deliveredAt: new Date(), lastError: null } });
  } catch (error) {
    // Do not store request bodies, credentials or arbitrary exception text in the dashboard.
    const code = error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 30) : "delivery-unavailable";
    await database.discordJob.updateMany({ where: { id, leaseToken: token, revision: job.revision }, data: { lastError: code, nextAttemptAt: new Date(Date.now() + retryDelay(job.attempts)), ...(givesUp(code, job.attempts) ? { status: "FAILED" } : {}) } });
  } finally {
    await database.discordJob.updateMany({ where: { id, leaseToken: token }, data: { leaseToken: null, lockedUntil: null } });
  }
  return true;
}

/** The member id inside a `promotion-congrats:<userId>:<rank>:<day>` key. */
const promotionUserId = (key: string) => key.split(":")[1] ?? "";

let portraitCache: import("./character-portrait.js").CharacterPortraits | undefined;
/** One shared portrait cache (the Battle.net client is only used when credentials are configured). */
async function sharedPortraits() {
  if (portraitCache) return portraitCache;
  const [{ createCharacterPortraits, defaultPortraitDir }, { armoryClientFromEnv }, { config }] = await Promise.all([import("./character-portrait.js"), import("./blizzard-armory.js"), import("../config.js")]);
  return portraitCache = createCharacterPortraits({ cacheDir: defaultPortraitDir(), armory: armoryClientFromEnv({ BATTLENET_CLIENT_ID: config.BATTLENET_CLIENT_ID, BATTLENET_CLIENT_SECRET: config.BATTLENET_CLIENT_SECRET }) });
}

export async function dispatchDiscordJob(guild: Guild, job: DiscordJob): Promise<void> {
  const pending = job.payload as Record<string, unknown>;
  if (job.kind === "MESSAGE" && pending["route"] === "readiness" && pending["day"]
    && pending["day"] !== participationDay(new Date(), typeof pending["timezone"] === "string" ? pending["timezone"] : "America/Toronto")) return;
  if (currentGuildScope()?.guild.id !== job.guildId) return withGuildScope(prisma, job.guildId, () => dispatchDiscordJob(guild, job));
  const payload = job.payload as Record<string, unknown>;
  if (job.kind === "POLL_REFRESH") {
    const poll = await prisma.poll.findFirst({ where: { id: String(payload["pollId"] ?? ""), guildId: job.guildId }, select: { id: true } });
    if (!poll) return;
    const { syncPoll } = await import("../commands/poll.js");
    if (!await syncPoll(guild, poll.id)) throw new Error("Poll message unavailable");
  } else if (job.kind === "RAID_REMINDER") {
    const { deliverRaidReminder } = await import("./reminders.js");
    await deliverRaidReminder(guild, prisma, job);
  } else if (job.kind === "GAME_EVENT_BOARD" || job.kind === "GAME_EVENT_REMINDER") {
    // Countdowns were removed (9.0.2). A job queued before the update finishes without posting anything.
  } else if (["TEAM_ROSTER", "TEAM_SESSION", "TEAM_REMINDER"].includes(job.kind)) {
    const { deliverTeamPost } = await import("./activity-core-discord.js");
    await deliverTeamPost(guild, prisma, job.guildId, job.kind, String(payload[job.kind === "TEAM_ROSTER" ? "coreId" : "sessionId"] ?? ""));
  } else if (job.kind === "PUG_POST") {
    const { deliverPugPost } = await import("./pug-discord.js");
    await deliverPugPost(guild, prisma, job);
  } else if (job.kind === "PUG_NOTICE") {
    const { deliverPugNotice } = await import("./pug-discord.js");
    await deliverPugNotice(guild, prisma, job);
  } else if (job.kind === "GAME_REMINDER") {
    // A private message to a member who has not picked a game; everything is re-checked at delivery.
    const { deliverGameReminder } = await import("./game-reminder.js");
    const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId } });
    await deliverGameReminder(guild, prisma, settings, job);
  } else if (job.kind === "DUNGEON_BOARD") {
    const { updateDungeonLeaderboard } = await import("./dungeon-leaderboard.js");
    if (!await updateDungeonLeaderboard(guild, true)) throw new Error("Board unavailable");
  } else if (job.kind === "PVP_CALL") {
    // Retired 13 November 2026: a call-post job queued before the update finishes quietly and posts nothing.
  } else if (job.kind === "PVP_RECAP") {
    const { deliverWeeklyRecap } = await import("./world-pvp-extras.js");
    await deliverWeeklyRecap(guild, prisma, job.guildId, Number(payload["week"] ?? 0));
  } else if (job.kind === "DUEL_BOARD") {
    const { updateDuelBoard } = await import("./duel-board.js");
    if (!await updateDuelBoard(guild, true)) throw new Error("Duel board unavailable");
  } else if (job.kind === "ACTIVITY_BOARD") {
    // Retired on 14 November 2026 (merged into the community leaderboard): a job queued before the update finishes quietly.
  } else if (job.kind === "WHOS_WHO_BOARD") {
    // Retired in 9.0.2: a job queued before the update finishes quietly and posts nothing.
  } else if (job.kind === "BG_LADDER") {
    const { updateBgLadder } = await import("./bg-ladder.js");
    if (!await updateBgLadder(guild, true)) throw new Error("Battleground ladder unavailable");
  } else if (job.kind === "RACE_BOARD") {
    const { updateRaceBoard } = await import("./race-board.js");
    if (!await updateRaceBoard(guild, true)) throw new Error("Race board unavailable");
  } else if (job.kind === "PROFESSIONS") {
    const { updateProfessionDirectory } = await import("./profession-directory.js");
    if (!await updateProfessionDirectory(guild, true)) throw new Error("Directory unavailable");
  } else if (job.kind === "CORE_ROSTER") {
    const coreId = String(payload["coreId"] ?? "");
    const core = await prisma.raidCore.findFirst({ where: { id: coreId, guildId: job.guildId }, select: { id: true, rosterChannelId: true } });
    if (!core) return;
    const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { coreChannelId: true } });
    if (!core.rosterChannelId && !settings?.coreChannelId) return;
    const { syncCoreRoster } = await import("./raid-core.js");
    if (!await syncCoreRoster(guild, prisma, job.guildId, core.id)) throw new Error("Core roster unavailable");
  } else if (job.kind === "RAID_POST") {
    const raidId = String(payload["raidId"] ?? "");
    const raid = await prisma.raid.findFirst({ where: { id: raidId, guildId: job.guildId }, select: { id: true } });
    if (!raid) return; // Deleted raid jobs have nothing left to publish.
    const { syncSignupEmbed } = await import("../commands/raid.js");
    await syncSignupEmbed(guild, job.guildId, raid.id, true);
    const { queueScheduledEvent } = await import("./scheduled-events.js");
    await queueScheduledEvent(prisma, job.guildId, "raid", raid.id);
  } else if (job.kind === "CALENDAR") {
    const { runCalendarPlan } = await import("./calendar-sync.js");
    const plan = payload["plan"] as unknown as import("./calendar-sync.js").CalendarPlan;
    const planned = await prisma.raid.findMany({ where: { guildId: job.guildId, status: "PLANNED", isTest: false, id: { in: plan.matches.map(match => match.raidId) } }, select: { id: true } });
    const eligible = new Set(planned.map(raid => raid.id));
    const summary = await runCalendarPlan(prisma, job.guildId, { ...plan, matches: plan.matches.filter(match => eligible.has(match.raidId)), unmatched: plan.unmatched.map(event => ({ ...event, startsAt: new Date(event.startsAt) })) });
    for (const raidId of summary.changedRaidIds) await enqueueDiscordJob(prisma, job.guildId, `raid:${raidId}`, "RAID_POST", { raidId });
    if (summary.failed) throw new Error("Calendar signup retry required");
  } else if (job.kind === "SIGNUP_ANSWERS") {
    // Raid answers given in game: the latest change per member wins, then the Discord signup post is refreshed.
    const { applySignupAnswers } = await import("./signup-answers.js");
    const answers = Array.isArray(payload["answers"]) ? payload["answers"] as unknown as import("./signup-answers.js").SignupAnswerJob[] : [];
    const summary = await applySignupAnswers(prisma, job.guildId, answers);
    for (const raidId of summary.changedRaidIds) await enqueueDiscordJob(prisma, job.guildId, `raid:${raidId}`, "RAID_POST", { raidId });
  } else if (job.kind === "COMMUNITY_POST") {
    const { publishCommunityActivity } = await import("../commands/community.js");
    await publishCommunityActivity(guild, job.guildId, String(payload["activityId"] ?? ""));
    const { queueScheduledEvent } = await import("./scheduled-events.js");
    await queueScheduledEvent(prisma, job.guildId, "community", String(payload["activityId"] ?? ""));
  } else if (job.kind === "SCHEDULED_EVENT") {
    const type = payload["sourceType"];
    if (type !== "raid" && type !== "community") throw new Error("Unknown scheduled event source");
    const { syncScheduledEvent } = await import("./scheduled-events.js");
    await syncScheduledEvent(guild, prisma, job.guildId, type, String(payload["sourceId"] ?? ""));
  } else if (job.kind === "MESSAGE") {
    let channelId = String(payload["channelId"]);
    if (job.key.startsWith("community-reminder:")) {
      const activity = await prisma.communityActivity.findFirst({ where: { id: job.key.slice("community-reminder:".length), season: { guildId: job.guildId } }, include: { season: true } });
      if (!activity || activity.status !== "OPEN" || activity.season.status !== "ACTIVE") return;
      const { communityActivityChannel } = await import("./community-display.js");
      const { assertCommunityChannelAudience } = await import("./community-access.js");
      channelId = communityActivityChannel(activity);
      await assertCommunityChannelAudience(guild, activity.season.channelId, channelId);
    }
    if (job.key.startsWith("promotion-congrats:")) {
      // An officer who switched the congratulations off after a card was queued stops it here too.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { promotionCongratsEnabled: true, language: true } });
      if (settings?.promotionCongratsEnabled === false) return;
      // Cards queued before a wording change carry the old text: rebuild it from the stored card with the current wording.
      const [{ refreshPromotionText }, { promotionCongratsText }] = await Promise.all([import("./character-portrait.js"), import("./promotion.js")]);
      refreshPromotionText(payload, promotionUserId(job.key), settings?.language === "fr" ? "fr" : "en", promotionCongratsText);
    }
    if (job.key.startsWith("bank-donation:")) {
      // Guild bank donor cards (21 Nov 2026): an officer who switched them off after a card was queued stops it here too.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { guildBankDonationCards: true } });
      if (settings?.guildBankDonationCards === false) return;
    }
    const route = payload["route"];
    if (route === "dungeon") {
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { dungeonChannelId: true, notifyChannelId: true } });
      const current = settings?.dungeonChannelId ?? settings?.notifyChannelId;
      if (!current) throw new Error("Configure dungeon announcements first");
      channelId = current;
    } else if (route === "wowWeekly") {
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { weeklyReportChannelId: true, notifyChannelId: true, weeklyReportEnabled: true, weeklyRecordsEnabled: true } });
      if (!wowWeeklyStillWanted(job.key, settings)) return; // the weekly report was switched off since it was queued
      if (job.key.startsWith("weekly-records:") && settings && !settings.weeklyRecordsEnabled) return; // the records post was switched off since it was queued
      const current = settings?.weeklyReportChannelId ?? settings?.notifyChannelId;
      if (!current) throw new Error("Configure WoW weekly reports first");
      channelId = current;
    } else if (route === "seasonCard") {
      // 9.3: only season-card jobs follow the season cards switch and the dungeon leaderboard channel, checked now.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { seasonCardsEnabled: true, dungeonLeaderboardChannelId: true } });
      const current = seasonCardChannel(job.key, settings);
      if (!current) return;
      channelId = current;
    } else if (route === "duelCard") {
      // 9.3: re-checked at delivery, so a card queued before an officer turned the cards off, or moved the duel channel, never posts to the old place.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { duelCardsEnabled: true, duelBoardChannelId: true } });
      if (!settings?.duelCardsEnabled || !settings.duelBoardChannelId) return;
      channelId = settings.duelBoardChannelId;
    } else if (route === "readiness") {
      // Don't deliver yesterday's failed summary alongside today's message.
      const timezone = typeof payload["timezone"] === "string" ? payload["timezone"] : "America/Toronto";
      if (payload["day"] !== participationDay(new Date(), timezone)) return;
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { readinessChannelId: true, readinessPostsEnabled: true } });
      if (!settings?.readinessChannelId || !settings.readinessPostsEnabled) return;
      channelId = settings.readinessChannelId;
    } else if (route === "raidCheck") {
      // 9.1 raid night check: re-checked at delivery (switch, channel, and the raid still planned and not long past).
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { readinessChannelId: true, readinessPostsEnabled: true } });
      if (!settings?.readinessChannelId || !settings.readinessPostsEnabled) return;
      const raid = await prisma.raid.findFirst({ where: { id: String(payload["raidId"] ?? ""), guildId: job.guildId }, select: { status: true, scheduledAt: true } });
      if (!raid || raid.status !== "PLANNED" || raid.scheduledAt.getTime() < Date.now() - 60 * 60_000) return;
      channelId = settings.readinessChannelId;
    } else if (route === "achievements") {
      // Re-checked at delivery: switching announcements off (or the channel) takes effect for queued posts too.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { achievementAnnounceEnabled: true, achievementChannelId: true, achievementsEnabled: true } });
      if (!settings?.achievementAnnounceEnabled || !settings.achievementsEnabled || !settings.achievementChannelId) return;
      channelId = settings.achievementChannelId;
    } else if (route === "officerReport") {
      const { resolveNotifyAddress, officerReportDestination } = await import("./notify.js");
      const address = await resolveNotifyAddress(guild, "officer");
      // Consent binds the channel. Fail closed on permission or destination drift,
      // including retries; never redirect private report text to another channel.
      if (!address || address.guildId !== job.guildId || address.channelId !== channelId
        || (await officerReportDestination(guild))?.id !== channelId) return;
    } else if (route !== undefined) {
      if (!["notify", "raidLog", "loot", "officer", "application", "attendance"].includes(String(route))) throw new Error("Unknown notification route");
      const { resolveNotifyAddress } = await import("./notify.js");
      const address = await resolveNotifyAddress(guild, route as "notify" | "raidLog" | "loot" | "officer" | "application" | "attendance", typeof payload["coreId"] === "string" ? payload["coreId"] : null);
      if (!address) throw new Error("Configure the notification channel first");
      if (address.guildId !== job.guildId) return; // A reset retired this guild identity.
      channelId = address.channelId;
    }
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error("Channel unavailable");
    // Discord only retains nonce deduplication briefly, so the post also carries the job id, checked after a crash so a
    // delayed retry never posts twice. Until 9.0.5 it sat in the footer ("Guilded delivery <id>", seen by members); it
    // now sits in the link of an embed without a title, which Discord does not show. Old footers still match.
    const marker = `Guilded delivery ${job.id}`, link = deliveryLink(job.id);
    const recent = await channel.messages.fetch({ limit: 100 });
    if (recent.some(message => message.author.id === guild.client.user?.id && message.embeds.some(embed => embed.footer?.text.includes(marker) || embed.url === link))) return;
    // The card is drawn first: a post may carry a reduced card-only message for when the picture is available.
    // An optional card is drawn here from its stored definition; without an image the post still goes out.
    const { scoreCardPng } = await import("./score-card.js");
    const draw = async (stored: unknown, memberId: unknown) => {
      let definition = stored && typeof stored === "object" ? stored as import("./score-card.js").ScoreCard : null;
      // Optional: show the member's server name, avatar and role on the card. Falls back to the plain card on any failure.
      if (definition && typeof memberId === "string" && /^\d{17,20}$/.test(memberId)) {
        const { withDiscordMember } = await import("./card-member.js");
        definition = await withDiscordMember(guild, definition, memberId);
      }
      // Promotion cards (20 Nov 2026): the promoted character's Armory picture, else the member's Discord avatar, else the card's emblem.
      if (definition?.promotion && job.key.startsWith("promotion-congrats:")) {
        const userId = promotionUserId(job.key);
        const { withCharacterPortrait, portraitSourcesFor } = await import("./character-portrait.js");
        const { downloadImage } = await import("./card-member.js");
        const avatar = async () => {
          const member = await guild.members.fetch(userId);
          return await downloadImage(member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true })).catch(() => null);
        };
        const base = definition;
        definition = await withCharacterPortrait(base, portraitSourcesFor(prisma, await sharedPortraits(), job.guildId, definition.promotion.character || definition.promotion.name, userId, avatar)).catch(() => base);
        return { definition, png: await scoreCardPng(definition).catch(() => null) };
      }
      // Guild bank donor cards (21 Nov 2026): the items' game icons, and the donor's Armory picture, else the linked member's Discord
      // avatar, else the card's chest emblem. Best effort: any failure draws the card without them.
      if (definition?.donation && job.key.startsWith("bank-donation:")) {
        const { withDonationIcons } = await import("./card-donation.js");
        const { itemData } = await import("../item-data.js");
        const base = definition;
        definition = await withDonationIcons(base, async (itemId) => (await itemData.lookup({ itemId, name: "", verified: true }))?.iconUrl).catch(() => base);
        const character = definition.donation?.character;
        if (character && !definition.donation?.combined) {
          const donorUserId = typeof payload["donorUserId"] === "string" && /^\d{17,20}$/.test(payload["donorUserId"]) ? payload["donorUserId"] : "";
          const { withCharacterPortrait, portraitSourcesFor } = await import("./character-portrait.js");
          const { downloadImage } = await import("./card-member.js");
          const avatar = async () => {
            if (!donorUserId) return null;
            const member = await guild.members.fetch(donorUserId).catch(() => null);
            return member ? await downloadImage(member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true })).catch(() => null) : null;
          };
          const withIcons = definition;
          definition = await withCharacterPortrait(withIcons, portraitSourcesFor(prisma, await sharedPortraits(), job.guildId, character, donorUserId, avatar)).catch(() => withIcons);
        }
        return { definition, png: await scoreCardPng(definition).catch(() => null) };
      }
      // Duel face-off cards (21 Nov 2026): a round portrait per fighter (Armory picture, else the owner's Discord avatar, else a ring).
      if (definition?.duel && job.key.startsWith("duel-card:one:")) {
        const { withDuelPortraits } = await import("./character-portrait.js");
        const { downloadImage } = await import("./card-member.js");
        const base = definition;
        definition = await withDuelPortraits(base, prisma, await sharedPortraits(), job.guildId, async (userId) => {
          const member = await guild.members.fetch(userId).catch(() => null);
          return member ? await downloadImage(member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true })).catch(() => null) : null;
        }).catch(() => base);
        return { definition, png: await scoreCardPng(definition).catch(() => null) };
      }
      // Armory character pictures (20 Nov 2026, best effort, time-boxed): a dungeon party's round portraits, or the member's main character
      // on a card about one member. Order: Armory picture -> Discord avatar -> none. Member-uploaded pictures no longer exist.
      if (definition) {
        const { withArmoryCardPortraits } = await import("./card-portraits.js");
        const base = definition;
        definition = await withArmoryCardPortraits(prisma, await sharedPortraits(), job.guildId, base, typeof memberId === "string" ? memberId : undefined).catch(() => base);
      }
      return { definition, png: definition ? await scoreCardPng(definition).catch(() => null) : null };
    };
    const { definition: cardDefinition, png: card } = await draw(payload["card"], payload["cardMember"]);
    // A second card in the same post (the weekly honors' rookie card, 16 Nov 2026): drawn only when the first one was, shown in the second
    // picture-less embed of the reduced message, and it takes its text line (`dropField`) off the post. Without it the text line stays.
    const extraStored = payload["extraCard"] && typeof payload["extraCard"] === "object" ? payload["extraCard"] as { card?: unknown; member?: unknown; dropField?: unknown } : null;
    const extra = card && extraStored ? await draw(extraStored.card, extraStored.member) : { definition: null, png: null };
    // Every card post tries again later when the picture could not be drawn (the renderer draws two at a time and answers busy), before
    // settling for the text. Only duel and season cards did (`retryCard`); the 20 Nov daily recap went out as text (21 Nov 2026).
    if (cardDefinition && !card && job.attempts < 3) throw Object.assign(new Error("Card renderer busy"), { code: "card-busy" });
    // Nobody is notified, except the users a job names explicitly (the hall of fame's opt-in MVP ping).
    const users = Array.isArray(payload["mentionUsers"]) ? payload["mentionUsers"].filter((id): id is string => typeof id === "string" && /^\d{17,20}$/.test(id)).slice(0, 10) : [];
    // The post as it goes out with the picture (the reduced card-only message) or, when the picture is refused, as the full text post.
    const compose = (withPicture: boolean): MessageCreateOptions => {
      const message = messageForDelivery(payload["message"] as MessageCreateOptions, payload["cardOnly"], withPicture);
      const embeds = (message.embeds ?? []).map(embed => new EmbedBuilder("toJSON" in embed ? embed.toJSON() : embed));
      if (!embeds.length) embeds.push(new EmbedBuilder().setDescription(message.content || "Guilded update"));
      const last = embeds[embeds.length - 1]!;
      // An embed without a title keeps its link invisible; with titles everywhere, an extra empty-looking embed would
      // show, so the last one gets the link and its title simply links to the website.
      const carrier = embeds.find(embed => !embed.data.title && !embed.data.url) ?? embeds.find(embed => !embed.data.url) ?? last;
      if (!carrier.data.url) carrier.setURL(link);
      // The picture sits in the first embed that has no text of its own (so a card can head a post with text embeds under it), else the last one.
      const bare = embeds.filter(embed => !embed.data.title && !embed.data.description && !embed.data.fields?.length);
      if (withPicture) (bare[0] ?? last).setImage("attachment://card.png");
      const second = withPicture && extra.png && extra.definition ? bare[1] : undefined;
      if (second) {
        second.setImage("attachment://card2.png");
        const drop = typeof extraStored?.dropField === "string" ? extraStored.dropField : "";
        if (drop) for (const embed of embeds) if (embed.data.fields?.some(field => field.name === drop)) embed.setFields(embed.data.fields.filter(field => field.name !== drop));
      }
      // The second picture-less embed exists for the second card only: without that card it would show as an empty box.
      const shown = withPicture && extraStored && bare[1] && !second ? embeds.filter(embed => embed !== bare[1]) : embeds;
      return { ...message, embeds: shown, ...(withPicture ? { files: [new AttachmentBuilder(card!, { name: "card.png" }).setDescription(cardAltText(cardDefinition!)), ...(second ? [new AttachmentBuilder(extra.png!, { name: "card2.png" }).setDescription(cardAltText(extra.definition!))] : [])] } : {}), allowedMentions: { parse: [], users }, nonce: job.id.slice(-25), enforceNonce: true };
    };
    await sendWithPictureFallback(options => channel.send(options), compose(Boolean(card)), card ? () => compose(false) : null);
  } else if (job.kind === "INVITE_CLEANUP") {
    const { runInviteCleanupJob } = await import("./invite-cleanup.js");
    await runInviteCleanupJob(guild, prisma, job);
  } else throw new Error("Unknown job type");
}

/** A post carrying a picture is refused when the bot lacks Attach Files (50013) or the file is too large (40005). */
const pictureRefused = (error: unknown) => { const code = (error as { code?: unknown } | null)?.code; return code === 50013 || code === 40005; };
/** Sends the post with its picture; when Discord refuses the picture, the same post goes out once as text so a missing permission never loses it. */
export async function sendWithPictureFallback(send: (options: MessageCreateOptions) => Promise<unknown>, withPicture: MessageCreateOptions, plain: (() => MessageCreateOptions) | null): Promise<void> {
  try { await send(withPicture); }
  catch (error) { if (!plain || !pictureRefused(error)) throw error; console.error("Card picture refused, posting the text instead", error); await send(plain()); }
}

/** Only the weekly report (key weekly-wow:) follows its switch; the daily recap shares the route and has its own. */
export const wowWeeklyStillWanted = (key: string, settings: { weeklyReportEnabled: boolean } | null) => !key.startsWith("weekly-wow:") || !settings || settings.weeklyReportEnabled;

/** The invisible marker a delivered post carries: the website address with the job id. */
export const deliveryLink = (jobId: string) => siteUrl(`/?delivery=${encodeURIComponent(jobId)}`);

let running = false;
const DELIVERY_BATCH_SIZE = 25;
const DELIVERY_BATCH_BUDGET_MS = 20_000;
export async function runDiscordJobs(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const query = { orderBy: { nextAttemptAt: "asc" as const }, include: { guild: { select: { discordId: true as const } } } };
    // Boards and other posts first; the duel cards (key duel-card:) only fill what is left of the batch, however old they are.
    const first = await prisma.discordJob.findMany({ ...query, where: { ...available(now), ...pilotGuildScope, NOT: { key: { startsWith: "duel-card:" } } }, take: DELIVERY_BATCH_SIZE });
    const later = first.length < DELIVERY_BATCH_SIZE ? await prisma.discordJob.findMany({ ...query, where: { ...available(now), ...pilotGuildScope, key: { startsWith: "duel-card:" } }, take: DELIVERY_BATCH_SIZE - first.length }) : [];
    const jobs = [...first, ...later];
    for (const job of jobs) {
      // Finish an in-flight delivery normally; do not start another after the
      // budget is spent. The next tick resumes pending jobs, with fresh content.
      if (Date.now() - now.getTime() >= DELIVERY_BATCH_BUDGET_MS) break;
      await deliverDiscordJob(prisma, job.id, async current => {
        const guild = await client.guilds.fetch(job.guild.discordId);
        await dispatchDiscordJob(guild, current);
      });
    }
  } finally { running = false; }
}
