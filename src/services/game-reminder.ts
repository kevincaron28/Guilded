import type { Client, Guild as DiscordGuild, GuildMember } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { DiscordJob, GuildSettings, MemberOnboarding, PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { findWowRoleId } from "./invite-channel.js";
import { selfRoleProblem } from "./selfrole.js";

// Members who joined the Discord server but have not picked a game.
//
// A "game role" is any role the server lists for the onboarding game menu (GuildSettings.welcomeRoleIds,
// picked in /setup step 5) plus the server's World of Warcraft role (the invite settings' role, or the
// role named like World of Warcraft): the same two sets the game menu and the welcome role buttons accept.
// Nothing here is hard-coded to a server.
//
// Reminders are private messages with a "Pick my games" button and a "Stop reminders" button. They go
// through the Discord job queue (kind GAME_REMINDER, one job per member and reminder number), which paces
// them. The count of reminders queued is saved in MemberOnboarding before anything is sent, so a restart,
// a retry or a second click can never send one more.
//
//   Automatic (GuildSettings.onboardingNudge, off by default): the first reminder 24 hours after joining
//   (never to someone who joined more than 72 hours before the first check, so turning the switch on does
//   not message the whole server), and one more a week after the first at most. Never a third.
//   Manual (an officer from /report games): one member or everyone listed, at most one per member per 24 hours.
//   Never: bots, members with a game role, members who pressed Stop, members whose DMs are closed.

type Db = Pick<PrismaClient, "memberOnboarding" | "discordJob">;
export type ReminderState = Pick<MemberOnboarding, "reminderCount" | "lastReminderAt" | "lastReminderSource" | "lastSentAt" | "remindersStopped" | "dmClosedAt" | "rulesAcceptedAt">;
export type ReminderSource = "AUTO" | "OFFICER";

export const HOUR = 3_600_000;
export const AUTO_FIRST_AFTER_MS = 24 * HOUR;
// Someone who joined long before the switch was turned on is left alone.
export const AUTO_FIRST_UNTIL_MS = 72 * HOUR;
export const AUTO_SECOND_AFTER_MS = 7 * 24 * HOUR;
export const AUTO_SECOND_UNTIL_MS = 21 * 24 * HOUR;
export const AUTO_MAX_REMINDERS = 2;
export const MANUAL_SPACING_MS = 24 * HOUR;
// A hourly run queues at most this many; the job queue paces the delivery.
export const AUTO_PER_RUN = 25;
export const PAGE_SIZE = 10;
// Discord's "cannot send messages to this user".
const DM_CLOSED_CODE = 50007;

export const GAME_REMINDER_STOP_ID = (discordGuildId: string) => `onboard:stop:${discordGuildId}`;

export interface NoGameRow {
  id: string;
  name: string;
  joinedAt: Date | null;
  rulesAccepted: boolean | null; // null when this server has no rules channel
  reminders: number;
  lastSentAt: Date | null;
  stopped: boolean;
  dmClosed: boolean;
}

type RoleSource = Pick<GuildSettings, "welcomeRoleIds" | "inviteWowRoleId">;

/** The ids of the roles that count as "has picked a game" in this server. */
export function gameRoleIds(settings: RoleSource, discordGuild: Pick<DiscordGuild, "id" | "roles">): string[] {
  const ids = new Set<string>();
  for (const id of settings.welcomeRoleIds) {
    const role = discordGuild.roles.cache.get(id);
    if (role && !selfRoleProblem({ id: role.id, managed: role.managed, permissions: role.permissions.bitfield }, discordGuild.id)) ids.add(id);
  }
  const wow = findWowRoleId(discordGuild.roles.cache.values(), settings.inviteWowRoleId);
  if (wow && settings.welcomeRoleIds.length > 0) ids.add(wow);
  return [...ids];
}

export const hasGameRole = (member: Pick<GuildMember, "roles">, roleIds: string[]) => roleIds.some((id) => member.roles.cache.has(id));

async function loadMembers(discordGuild: DiscordGuild): Promise<GuildMember[] | null> {
  // The member cache is kept current by the GuildMembers intent; fetch only when it is incomplete.
  const members = discordGuild.members.cache.size >= discordGuild.memberCount
    ? discordGuild.members.cache
    : await discordGuild.members.fetch().catch(() => null);
  return members ? [...members.values()] : null;
}

/** Members without a game role, newest first. Bots are left out. `null` when the member list cannot be read. */
export async function listNoGame(db: Pick<PrismaClient, "memberOnboarding">, guildId: string, discordGuild: DiscordGuild, settings: Pick<GuildSettings, "welcomeRoleIds" | "inviteWowRoleId" | "rulesChannelId">): Promise<{ rows: NoGameRow[]; configured: boolean } | null> {
  const roleIds = gameRoleIds(settings, discordGuild);
  if (roleIds.length === 0) return { rows: [], configured: false };
  const members = await loadMembers(discordGuild);
  if (!members) return null;
  const candidates = members.filter((member) => !member.user.bot && !hasGameRole(member, roleIds));
  const states = candidates.length
    ? await db.memberOnboarding.findMany({ where: { guildId, discordUserId: { in: candidates.map((member) => member.id) } } })
    : [];
  const byUser = new Map(states.map((state) => [state.discordUserId, state]));
  const rows = candidates.map((member): NoGameRow => {
    const state = byUser.get(member.id);
    return {
      id: member.id,
      name: member.displayName ?? member.user.username,
      joinedAt: member.joinedTimestamp ? new Date(member.joinedTimestamp) : null,
      rulesAccepted: settings.rulesChannelId ? !!state?.rulesAcceptedAt : null,
      reminders: state?.reminderCount ?? 0,
      lastSentAt: state?.lastSentAt ?? null,
      stopped: !!state?.remindersStopped,
      dmClosed: !!state?.dmClosedAt
    };
  });
  return { rows: rows.sort((a, b) => (b.joinedAt?.getTime() ?? 0) - (a.joinedAt?.getTime() ?? 0)), configured: true };
}

/** Can an officer's reminder go to this member now? */
export function manualBlock(row: Pick<NoGameRow, "stopped" | "dmClosed">, state: Pick<ReminderState, "lastReminderAt"> | null, now: Date): "stopped" | "dmClosed" | "recent" | null {
  if (row.stopped) return "stopped";
  if (row.dmClosed) return "dmClosed";
  if (state?.lastReminderAt && now.getTime() - state.lastReminderAt.getTime() < MANUAL_SPACING_MS) return "recent";
  return null;
}

/** The automatic schedule: which reminder, if any, is due for a member who joined `ageMs` ago. */
export function autoDue(state: ReminderState | null, ageMs: number, now: Date): boolean {
  const count = state?.reminderCount ?? 0;
  if (state?.remindersStopped || state?.dmClosedAt || count >= AUTO_MAX_REMINDERS) return false;
  if (count === 0) return ageMs >= AUTO_FIRST_AFTER_MS && ageMs < AUTO_FIRST_UNTIL_MS;
  // The second one only follows an automatic first one that was delivered, a week later.
  return state?.lastReminderSource === "AUTO" && !!state.lastSentAt && !!state.lastReminderAt
    && now.getTime() - state.lastReminderAt.getTime() >= AUTO_SECOND_AFTER_MS && ageMs < AUTO_SECOND_UNTIL_MS;
}

/**
 * Counts a reminder and queues it, once. The conditional update means two runs (or a run and a click) that
 * both read "no reminder yet" cannot both win. Returns false when someone else got there first.
 */
async function claim(db: Db, guildId: string, discordUserId: string, state: ReminderState | null, source: ReminderSource, now: Date): Promise<number | null> {
  const next = (state?.reminderCount ?? 0) + 1;
  const data = { reminderCount: next, lastReminderAt: now, lastReminderSource: source };
  if (!state) {
    try { await db.memberOnboarding.create({ data: { guildId, discordUserId, ...data } }); } catch { return null; }
  } else {
    const won = await db.memberOnboarding.updateMany({ where: { guildId, discordUserId, reminderCount: state.reminderCount, remindersStopped: false }, data });
    if (won.count !== 1) return null;
  }
  await enqueueDiscordJob(db, guildId, `game-reminder:${discordUserId}:${next}`, "GAME_REMINDER", { discordUserId, source, n: next });
  return next;
}

export interface QueueResult { queued: number; stopped: number; dmClosed: number; recent: number; gone: number }

/** An officer's reminder to these members. Re-checks every one against the live roles and saved state. */
export async function queueManualReminders(db: Db & Pick<PrismaClient, "memberOnboarding">, guildId: string, discordGuild: DiscordGuild, settings: RoleSource, userIds: string[], now = new Date()): Promise<QueueResult> {
  const result: QueueResult = { queued: 0, stopped: 0, dmClosed: 0, recent: 0, gone: 0 };
  const roleIds = gameRoleIds(settings, discordGuild);
  if (roleIds.length === 0) return result;
  for (const userId of userIds) {
    const member = discordGuild.members.cache.get(userId) ?? await discordGuild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot || hasGameRole(member, roleIds)) { result.gone += 1; continue; }
    const state = await db.memberOnboarding.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId: userId } } });
    const block = manualBlock({ stopped: !!state?.remindersStopped, dmClosed: !!state?.dmClosedAt }, state, now);
    if (block) { result[block] += 1; continue; }
    if (await claim(db, guildId, userId, state, "OFFICER", now) !== null) result.queued += 1; else result.recent += 1;
  }
  return result;
}

/** The hourly run for servers that switched the automatic reminder on. Queues, never sends directly. */
export async function runAutoGameReminders(client: Client, db: Db, guildFor: (discordGuild: DiscordGuild) => Promise<{ id: string; settings: GuildSettings | null }>, allowed: (discordGuildId: string) => boolean, now = new Date()): Promise<number> {
  let queued = 0;
  for (const discordGuild of client.guilds.cache.values()) {
    if (!allowed(discordGuild.id)) continue;
    const { id: guildId, settings } = await guildFor(discordGuild);
    if (!settings?.onboardingNudge) continue;
    const roleIds = gameRoleIds(settings, discordGuild);
    if (roleIds.length === 0) continue;
    const members = await loadMembers(discordGuild);
    if (!members) continue;
    let inGuild = 0;
    for (const member of members) {
      if (inGuild >= AUTO_PER_RUN) break;
      if (member.user.bot || !member.joinedTimestamp || hasGameRole(member, roleIds)) continue;
      const age = now.getTime() - member.joinedTimestamp;
      if (age < AUTO_FIRST_AFTER_MS || age >= AUTO_SECOND_UNTIL_MS) continue;
      const state = await db.memberOnboarding.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId: member.id } } });
      if (!autoDue(state, age, now)) continue;
      if (await claim(db, guildId, member.id, state, "AUTO", now) !== null) { inGuild += 1; queued += 1; }
    }
  }
  return queued;
}

export function reminderMessage(settings: Pick<GuildSettings, "welcomeChannelId" | "language">, discordGuild: Pick<DiscordGuild, "id" | "name">, n: number) {
  const lang: Lang = asLang(settings.language);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`onboard:games:${discordGuild.id}`).setLabel(t(lang, "onboard.button.games")).setStyle(ButtonStyle.Primary));
  if (settings.welcomeChannelId) {
    row.addComponents(new ButtonBuilder().setLabel(t(lang, "gamerem.button.channel")).setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${discordGuild.id}/${settings.welcomeChannelId}`));
  }
  row.addComponents(new ButtonBuilder().setCustomId(GAME_REMINDER_STOP_ID(discordGuild.id)).setLabel(t(lang, "gamerem.button.stop")).setStyle(ButtonStyle.Secondary));
  return { content: t(lang, n > 1 ? "gamerem.dm.again" : "gamerem.dm", { guild: discordGuild.name }), components: [row], allowedMentions: { parse: [] as never[] } };
}

/** Delivers one queued reminder. Re-checks everything now; a member who has since picked a game gets nothing. */
export async function deliverGameReminder(discordGuild: DiscordGuild, db: Db, settings: GuildSettings | null, job: Pick<DiscordJob, "guildId" | "payload" | "createdAt">): Promise<"sent" | "skipped" | "dmClosed"> {
  const payload = job.payload as { discordUserId?: string; source?: ReminderSource; n?: number };
  const userId = String(payload.discordUserId ?? "");
  if (!settings || !userId) return "skipped";
  if (payload.source === "AUTO" && !settings.onboardingNudge) return "skipped";
  const roleIds = gameRoleIds(settings, discordGuild);
  const member = await discordGuild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot || roleIds.length === 0 || hasGameRole(member, roleIds)) return "skipped";
  const key = { guildId_discordUserId: { guildId: job.guildId, discordUserId: userId } };
  const state = await db.memberOnboarding.findUnique({ where: key });
  if (state?.remindersStopped || state?.dmClosedAt) return "skipped";
  // Delivered already (a crash between the send and the job's "done" must not send it twice).
  if (state?.lastSentAt && state.lastSentAt >= job.createdAt) return "skipped";
  try {
    await member.send(reminderMessage(settings, discordGuild, payload.n ?? 1));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === DM_CLOSED_CODE) {
      await db.memberOnboarding.updateMany({ where: { guildId: job.guildId, discordUserId: userId }, data: { dmClosedAt: new Date() } });
      return "dmClosed";
    }
    throw error;
  }
  await db.memberOnboarding.updateMany({ where: { guildId: job.guildId, discordUserId: userId }, data: { lastSentAt: new Date() } });
  return "sent";
}

/** The "Stop reminders" button: remembered for good, and it also ends the automatic schedule for this member. */
export async function stopReminders(db: Pick<PrismaClient, "memberOnboarding">, guildId: string, discordUserId: string): Promise<void> {
  await db.memberOnboarding.upsert({
    where: { guildId_discordUserId: { guildId, discordUserId } },
    create: { guildId, discordUserId, remindersStopped: true },
    update: { remindersStopped: true }
  });
}
