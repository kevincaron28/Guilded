import type { DiscordJob, PrismaClient } from "../generated/prisma/client.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

// Guild-invite channel clean-up (owner request, 12 Nov 2026): about an hour after a request is handled the bot removes
// that request's message and its own follow-ups, so what stays is who still needs an invite. Officer switch:
// /mod invites settings cleanup:false (on by default).
//
// When the clock starts (cleanupAt, set in invite-queue.ts / recruiting-kit.ts): a full first+last name match in a
// roster, or an officer's own action (check mark, button, /mod invites record). A first-name-only roster guess marks the
// request invited but never schedules a deletion. Requests handled before this shipped are never touched (migration backfill).
//
// Only messages stored on the request are touched: the request post (the bot's own, or the member's own post the row
// names), the bot's tag message (notifyMessageId) and the bot's thank-you (doneNoteMessageId). Never a pending request,
// a pinned message, an officer's own note. Deletions go through the Discord job queue (paced, retried with backoff).

export { CLEANUP_DELAY_MS } from "./invite-queue.js";
/** Requests handed to the job queue per server per sweep. */
export const CLEANUP_BATCH = 25;
/** Job attempts (the queue backs off 30 s, 1 min, 2 min ...) before a refused/failed clean-up is set aside. */
export const MAX_ATTEMPTS = 6;
/** A failed clean-up is retried once a day, this many times, so granting Manage Messages later still takes effect. */
export const MAX_CYCLES = 3;
export const RETRY_LATER_MS = 24 * 3_600_000;
/** A request queued this long ago with no result is queued again (a lost job). */
const STALE_QUEUE_MS = 6 * 3_600_000;
const HANDLED = ["INVITED", "JOINED", "PROMOTED", "DECLINED"];

type Database = Pick<PrismaClient, "guildSettings" | "inviteRequest" | "discordJob">;
type Message = { id: string; pinned: boolean; author?: { id: string } | null; delete: () => Promise<unknown> };
type GuildLike = { channels: { fetch: (id: string) => Promise<unknown> }; client: { user?: { id: string } | null } };

const warned = new Set<string>();
const warnOnce = (key: string, text: string, error?: unknown) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`Invite clean-up: ${text}`, error ?? "");
};
export const resetCleanupWarnings = () => warned.clear();
const code = (error: unknown): number | undefined => (error as { code?: number } | null)?.code;
const refused = (error: unknown) => code(error) === 50001 || code(error) === 50013;

export type CleanOutcome = { deleted: number; retry: null | "permission" | "transient" };

/** Removes one handled request's stored messages. Never throws; says whether a retry could help. */
export async function cleanRequest(guild: GuildLike, inviteChannelId: string,
  row: { channelId: string; messageId: string; discordUserId: string; notifyMessageId: string | null; doneNoteMessageId: string | null }): Promise<CleanOutcome> {
  const me = guild.client.user?.id;
  // Only the configured invite channel: a row from before the channel was moved is left alone.
  if (!me || row.channelId !== inviteChannelId) return { deleted: 0, retry: null };
  let channel: { isTextBased: () => boolean; messages?: { fetch: (id: string) => Promise<unknown> } } | null;
  try { channel = await guild.channels.fetch(row.channelId) as typeof channel; } catch (error) {
    if (code(error) === 10003) return { deleted: 0, retry: null };
    warnOnce(`fetch:${row.channelId}`, "the invite channel could not be read, will retry", error);
    return { deleted: 0, retry: refused(error) ? "permission" : "transient" };
  }
  if (!channel?.isTextBased() || !channel.messages) return { deleted: 0, retry: null };
  const messages = channel.messages;
  let deleted = 0;
  let retry: CleanOutcome["retry"] = null;
  const one = async (id: string): Promise<Message | null> => {
    try { return await messages.fetch(id) as Message; } catch (error) {
      if (code(error) === 10008) return null; // already gone
      retry ??= refused(error) ? "permission" : "transient";
      return null;
    }
  };
  const remove = async (message: Message): Promise<void> => {
    if (message.pinned) return;
    try { await message.delete(); deleted++; } catch (error) {
      if (code(error) === 10008) return;
      if (refused(error)) {
        retry = "permission";
        warnOnce(`perm:${row.channelId}`, `the bot cannot delete messages in <#${row.channelId}> (needs View Channel, Read Message History and Manage Messages)`, error);
      } else { retry ??= "transient"; warnOnce(`err:${row.channelId}:${String(code(error))}`, "a message could not be deleted, will retry", error); }
    }
  };
  const post = await one(row.messageId);
  if (post && (post.author?.id === me || post.author?.id === row.discordUserId)) await remove(post);
  for (const id of [row.notifyMessageId, row.doneNoteMessageId]) {
    if (!id) continue;
    const note = await one(id);
    if (note?.author?.id === me) await remove(note);
  }
  return { deleted, retry };
}

/** The queued job: one request. Throws on a retryable failure so the job queue backs off and tries again. */
export async function runInviteCleanupJob(guild: GuildLike, database: Pick<PrismaClient, "guildSettings" | "inviteRequest">,
  job: Pick<DiscordJob, "guildId" | "attempts" | "payload">, now = new Date()): Promise<void> {
  const requestId = String((job.payload as Record<string, unknown> | null)?.["requestId"] ?? "");
  const row = await database.inviteRequest.findFirst({ where: { id: requestId, guildId: job.guildId },
    select: { id: true, status: true, cleanupAt: true, cleanedAt: true, channelId: true, messageId: true, discordUserId: true, notifyMessageId: true, doneNoteMessageId: true, cleanTries: true } });
  if (!row || row.cleanedAt) return;
  const release = () => database.inviteRequest.updateMany({ where: { id: row.id }, data: { cleanQueuedAt: null } });
  const settings = await database.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { inviteCleanupEnabled: true, inviteChannelId: true } });
  // Re-checked when the job runs: a request put back to waiting, one with no deadline, or the switch turned off is left alone.
  if (!HANDLED.includes(row.status) || !row.cleanupAt || row.cleanupAt > now || !settings?.inviteCleanupEnabled || !settings.inviteChannelId) { await release(); return; }
  const outcome = await cleanRequest(guild, settings.inviteChannelId, row);
  if (!outcome.retry) { await database.inviteRequest.updateMany({ where: { id: row.id }, data: { cleanedAt: now } }); return; }
  if (job.attempts < MAX_ATTEMPTS) throw new Error(`invite clean-up ${outcome.retry}`);
  // Out of quick retries: not marked cleaned. Tried again tomorrow, a few times (so Manage Messages granted later still works), then dropped.
  await database.inviteRequest.updateMany({ where: { id: row.id }, data: { cleanQueuedAt: null, cleanupAt: new Date(now.getTime() + RETRY_LATER_MS), cleanTries: { increment: 1 } } });
  if (row.cleanTries + 1 >= MAX_CYCLES) warnOnce(`giveup:${job.guildId}`, "gave up on a request that could not be cleaned");
}

/**
 * The one-time clean-up of requests handled before this feature shipped (the migration marked them cleaned so nothing is purged
 * on deploy). Officer-only action (/mod invites tidy): they are the handled requests of this server's invitation channel that
 * were never scheduled. Same job, same rules (stored ids, channel check, pins and officers' messages skipped).
 */
const oldHandled = (guildId: string, channelId: string) => ({ guildId, channelId, status: { in: HANDLED }, cleanedAt: { not: null }, cleanupAt: null });
export async function countOldHandled(database: Pick<PrismaClient, "inviteRequest">, guildId: string, channelId: string): Promise<number> {
  return database.inviteRequest.count({ where: oldHandled(guildId, channelId) });
}
export async function queueOldHandled(database: Database, guildId: string, channelId: string, now = new Date()): Promise<number> {
  const marked = await database.inviteRequest.updateMany({ where: oldHandled(guildId, channelId), data: { cleanedAt: null, cleanupAt: now, cleanTries: 0, cleanQueuedAt: null } });
  await scheduleInviteCleanups(database, new Date(now.getTime() + 1000)); // the first batch now; the 10-minute sweep takes the rest
  return marked.count;
}

/** Every few minutes: hand the requests that are due to the Discord job queue. The deadline is stored (cleanupAt), so a restart loses nothing. */
export async function scheduleInviteCleanups(database: Database, now = new Date()): Promise<number> {
  const guilds = await database.guildSettings.findMany({ where: { inviteQueueEnabled: true, inviteCleanupEnabled: true, inviteChannelId: { not: null } }, select: { guildId: true } });
  let queued = 0;
  for (const { guildId } of guilds) {
    // Not already queued (or queued so long ago the job must have been lost, e.g. a crash before it was enqueued).
    const due = await database.inviteRequest.findMany({ where: { guildId, status: { in: HANDLED }, cleanedAt: null, cleanTries: { lt: MAX_CYCLES }, cleanupAt: { lte: now },
      OR: [{ cleanQueuedAt: null }, { cleanQueuedAt: { lte: new Date(now.getTime() - STALE_QUEUE_MS) } }] }, orderBy: { cleanupAt: "asc" }, take: CLEANUP_BATCH, select: { id: true, cleanQueuedAt: true } });
    for (const { id, cleanQueuedAt } of due) {
      const claim = await database.inviteRequest.updateMany({ where: { id, cleanedAt: null, cleanQueuedAt }, data: { cleanQueuedAt: now } });
      if (!claim.count) continue;
      try { await enqueueDiscordJob(database, guildId, `invite-cleanup:${id}:${now.getTime()}`, "INVITE_CLEANUP", { requestId: id }); queued++; } catch (error) {
        await database.inviteRequest.updateMany({ where: { id }, data: { cleanQueuedAt } }).catch(() => undefined);
        warnOnce(`enqueue:${guildId}`, "could not queue a clean-up", error);
      }
    }
  }
  return queued;
}
