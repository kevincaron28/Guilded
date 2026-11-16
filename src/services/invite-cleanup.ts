import type { DiscordJob, PrismaClient } from "../generated/prisma/client.js";
import { resolve } from "node:path";
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
// CLOSED (9.3.5: left Discord, cancelled, expired, removed by an officer) is handled too: its messages go like a joined request's.
const HANDLED = ["INVITED", "JOINED", "PROMOTED", "DECLINED", "CLOSED"];

type Database = Pick<PrismaClient, "guildSettings" | "inviteRequest" | "discordJob">;
type Message = { id: string; pinned: boolean; author?: { id: string } | null; delete: () => Promise<unknown> };
type GuildLike = { id?: string; channels: { fetch: (id: string) => Promise<unknown> }; client: { user?: { id: string } | null } };

const warned = new Set<string>();
const warnOnce = (key: string, text: string, error?: unknown) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`Invite clean-up: ${text}`, error ?? "");
};
const said = new Set<string>();
export const resetCleanupWarnings = () => { warned.clear(); said.clear(); };
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
      warnOnce(`read:${row.channelId}:${String(code(error))}`, "a message could not be read, will retry", error);
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
const oldHandled = (guildId: string, channelId: string) => ({ guildId, channelId, status: { in: HANDLED }, legacyHandled: true, cleanedAt: { not: null }, cleanupAt: null });
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

// ---------------------------------------------------------------------------------------------------------------------
// /mod invites tidy also sweeps the channel itself (owner, 12 Nov 2026). The row-driven clean-up above never sees clutter tied
// to no row (old thank-you replies, hint replies whose timers died on a restart, tag messages with no stored id, posts with
// no row). The sweep reads the channel's recent history instead. Kept always: the pinned guide, every pinned message, and the
// messages of requests still waiting or not yet cleaned. Deleted: the bot's own messages older than 2 hours, and - only with
// `members:true` - anyone else's messages older than 24 hours. Never anything newer from members.
// ---------------------------------------------------------------------------------------------------------------------
export const SWEEP_CAP = 1000;
export const SWEEP_BOT_MIN_AGE_MS = 2 * 3_600_000;
export const SWEEP_MEMBER_MIN_AGE_MS = 24 * 3_600_000;
/** Discord refuses bulk deletes of messages 14 days old or more; one hour of margin. */
export const BULK_MAX_AGE_MS = 14 * 86_400_000 - 3_600_000;
/** One run stops deleting after this long (the interaction answers within 15 minutes); the officer runs it again for the rest. */
export const SWEEP_BUDGET_MS = 10 * 60_000;
const SINGLE_DELETE_PAUSE_MS = 400;

type ScanMessage = { id: string; pinned: boolean; createdTimestamp: number; content?: string; author?: { id: string; username?: string } | null; components?: unknown[]; delete: () => Promise<unknown> };
type ScanPage = { size: number; values: () => Iterable<ScanMessage>; last: () => ScanMessage | undefined };
type SweepChannel = {
  id?: string; guildId?: string;
  isTextBased: () => boolean;
  messages?: { fetch: (options: { limit: number; before?: string } | string) => Promise<unknown> };
  bulkDelete?: (ids: string[], filterOld?: boolean) => Promise<unknown>;
  permissionsFor?: (user: unknown) => { has: (permission: string) => boolean } | null;
};

export interface SweepOptions {
  /** Ages (ms) before the bot's own / members' messages may go. Defaults: 2 hours and 24 hours. */
  botMinAgeMs?: number; memberMinAgeMs?: number;
  /** Keep only the messages of requests still waiting (not every request not yet cleaned). */
  onlyOpen?: boolean;
  /** Called with the messages about to be deleted; throwing stops the deletion (the copy could not be saved). */
  backup?: (messages: ScanMessage[]) => Promise<void>;
  /** Saves the backup of what would go, then stops: nothing is deleted (the first run on a server). */
  backupOnly?: boolean;
  /** Extra messages never to delete (the bot's own request panel). */
  protect?: (message: ScanMessage) => boolean;
  /** The guide/panel message must exist in this channel, else nothing is attempted (status "panel"). */
  requireGuide?: boolean;
  members?: boolean; confirm?: boolean; now?: Date; cap?: number; budgetMs?: number; pauseMs?: number; sleep?: (ms: number) => Promise<void> }
export interface SweepResult {
  /** "unreadable": the channel could not be read at all; "permission": Discord refused reading or deleting. */
  status: "ok" | "unreadable" | "permission" | "backup" | "panel";
  scanned: number;
  /** The scan or the deleting stopped at a limit: run it again for the rest. */
  capped: boolean;
  protectedCount: number;
  /** The bot's own messages that are (or were) due for removal. */
  mine: number;
  /** Members' messages older than 24 hours (removed only with members:true). */
  memberOld: number;
  /** Members' messages newer than that: never touched. */
  memberFresh: number;
  deleted: number;
}

export const MISSING_PERMISSIONS = "View Channel, Read Message History and Manage Messages";

export async function sweepInviteChannel(guild: GuildLike, database: Pick<PrismaClient, "inviteRequest">, guildId: string, channelId: string,
  guideMessageId: string | null, options: SweepOptions = {}): Promise<SweepResult> {
  const now = (options.now ?? new Date()).getTime();
  const cap = options.cap ?? SWEEP_CAP;
  const result: SweepResult = { status: "ok", scanned: 0, capped: false, protectedCount: 0, mine: 0, memberOld: 0, memberFresh: 0, deleted: 0 };
  const me = guild.client.user?.id;
  let channel: SweepChannel | null;
  try {
    channel = await guild.channels.fetch(channelId) as SweepChannel | null;
    if (!me || !channel?.isTextBased() || !channel.messages) return { ...result, status: "unreadable" };
    // Must be exactly the configured invite channel of this server.
    if (options.requireGuide && (channel.id !== channelId || (channel.guildId && guild.id && channel.guildId !== guild.id))) return { ...result, status: "unreadable" };
    if (options.requireGuide) {
      const panel = guideMessageId ? await channel.messages.fetch(guideMessageId) as { id?: string; author?: { id: string } } | null : null;
      if (!panel || panel.id !== guideMessageId || panel.author?.id !== me) return { ...result, status: "panel" };
    }
  } catch (error) {
    return { ...result, status: refused(error) ? "permission" : (options.requireGuide ? "panel" : "unreadable") };
  }
  // Without Manage Messages (or View Channel / Read Message History) nothing is attempted: quietly nothing to do.
  const permissions = channel.permissionsFor?.(guild.client.user);
  if (permissions && !(permissions.has("ManageMessages") && permissions.has("ReadMessageHistory") && permissions.has("ViewChannel"))) return { ...result, status: "permission" };
  const botMin = options.botMinAgeMs ?? SWEEP_BOT_MIN_AGE_MS;
  const memberMin = options.memberMinAgeMs ?? SWEEP_MEMBER_MIN_AGE_MS;

  // Messages of requests still waiting, or handled but not cleaned yet (the normal clean-up owns those).
  const rows = await database.inviteRequest.findMany({ where: { guildId, channelId, ...(options.onlyOpen ? { status: "PENDING" } : { OR: [{ status: "PENDING" }, { cleanedAt: null }] }) }, select: { messageId: true, notifyMessageId: true, doneNoteMessageId: true } });
  const keep = new Set<string>(guideMessageId ? [guideMessageId] : []);
  for (const row of rows) for (const id of [row.messageId, row.notifyMessageId, row.doneNoteMessageId]) if (id) keep.add(id);

  const targets: ScanMessage[] = [];
  let before: string | undefined;
  scan: for (;;) {
    let page: ScanPage;
    try { page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }) as ScanPage; } catch (error) {
      return { ...result, status: refused(error) ? "permission" : "unreadable" };
    }
    if (!page.size) break;
    for (const message of page.values()) {
      if (result.scanned >= cap) { result.capped = true; break scan; }
      result.scanned++;
      const age = now - message.createdTimestamp;
      if (message.pinned || keep.has(message.id) || options.protect?.(message)) { result.protectedCount++; continue; }
      if (message.author?.id === me) {
        if (age > botMin) { result.mine++; targets.push(message); }
        continue;
      }
      if (age > memberMin) { result.memberOld++; if (options.members) targets.push(message); } else result.memberFresh++;
    }
    before = page.last()?.id;
    if (page.size < 100 || !before) break;
  }
  if (options.backupOnly && options.backup && targets.length) {
    try { await options.backup(targets); } catch (error) { warnOnce(`backup:${channelId}`, "the copy of the messages could not be saved", error); return { ...result, status: "backup" }; }
    return result;
  }
  if (!options.confirm || !targets.length) return result;
  if (options.backup) { try { await options.backup(targets); } catch (error) { warnOnce(`backup:${channelId}`, "the copy of the messages could not be saved, nothing was deleted", error); return { ...result, status: "backup" }; } }

  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.budgetMs ?? SWEEP_BUDGET_MS);
  const outOfTime = () => Date.now() > deadline;
  const single = async (message: ScanMessage): Promise<void> => {
    try { await message.delete(); result.deleted++; } catch (error) {
      if (code(error) === 10008) return; // already gone
      if (refused(error)) result.status = "permission";
    }
  };
  const young = targets.filter((message) => now - message.createdTimestamp < BULK_MAX_AGE_MS);
  const old = targets.filter((message) => now - message.createdTimestamp >= BULK_MAX_AGE_MS);
  for (let at = 0; at < young.length && result.status === "ok"; at += 100) {
    if (outOfTime()) { result.capped = true; break; }
    const chunk = young.slice(at, at + 100);
    if (chunk.length === 1 || !channel.bulkDelete) { for (const message of chunk) await single(message); continue; }
    try {
      const done = await channel.bulkDelete(chunk.map((message) => message.id), true) as { size?: number } | null;
      result.deleted += typeof done?.size === "number" ? done.size : chunk.length;
    } catch (error) {
      if (refused(error)) { result.status = "permission"; break; }
      for (const message of chunk) await single(message); // e.g. one of them vanished: fall back to single deletes
    }
  }
  // Messages 14 days old or more cannot be bulk deleted: one at a time, throttled.
  for (const message of old) {
    if (result.status !== "ok") break;
    if (outOfTime()) { result.capped = true; break; }
    await single(message);
    await sleep(options.pauseMs ?? SINGLE_DELETE_PAUSE_MS);
  }
  return result;
}

/** The officer-facing text of a sweep: counts for the preview, or what was done. */
export function sweepSummary(channelId: string, result: SweepResult, membersOption: boolean, confirmed: boolean): string {
  if (result.status === "unreadable") return `I cannot read <#${channelId}>. Check that it exists and that I have ${MISSING_PERMISSIONS}.`;
  const lines: string[] = [];
  if (result.status === "permission") lines.push(`Discord refused: I am missing a permission in <#${channelId}>. I need ${MISSING_PERMISSIONS}.`);
  const memberLine = result.memberOld || result.memberFresh
    ? `Member posts: ${result.memberOld} older than 24 hours (${membersOption ? (confirmed ? "removed" : "will be removed") : "kept; add `members:true` to remove them"}), ${result.memberFresh} newer (always kept).`
    : "";
  if (confirmed) lines.push(`Removed ${result.deleted} message${result.deleted === 1 ? "" : "s"} from <#${channelId}> (looked at ${result.scanned}; kept ${result.protectedCount} pinned or still needed).`);
  else lines.push(`In the last ${result.scanned} messages of <#${channelId}>: ${result.mine} of mine older than 2 hours can be removed; ${result.protectedCount} pinned or still needed are kept.`);
  if (memberLine) lines.push(memberLine);
  if (result.capped) lines.push(confirmed ? "I stopped at my limit for one run: run it again for the rest." : "That is only the newest part of the channel; run it again afterwards for the rest.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// The hourly tidy of the whole channel (owner, 15 Nov 2026): the invite channel ends up holding only the pinned guide/panel and
// the messages of requests still waiting. Everything else older than 10 minutes goes: closed requests, chat, old bot notices,
// members' messages. A plain-text copy of each message (author, time, text; no attachments) is written to backups/ first, and if
// that cannot be written nothing is deleted. Each run logs a dry-run count before it deletes. At most once an hour per server
// (the time is stored, so a restart does not run it again). Officer switch: the same tidy switch as the per-request clean-up (/mod invites settings cleanup:false).
// ---------------------------------------------------------------------------------------------------------------------
export const CHANNEL_SWEEP_MIN_AGE_MS = 10 * 60_000;
export const CHANNEL_SWEEP_EVERY_MS = 3_600_000;
export const CHANNEL_SWEEP_DELETE_PAUSE_MS = 1000;
/** Absolute, next to the bot's other backups (the bot runs from its install folder, /opt/guilded on Oracle). */
export const defaultBackupDir = (): string => resolve(process.cwd(), "backups", "invite-channel");
/** The bot's own request panel (the "Request an invite" button): never deleted. */
export const isInvitePanel = (message: { author?: { id: string } | null; components?: unknown[] }, botId: string | undefined): boolean =>
  !!botId && message.author?.id === botId && JSON.stringify(message.components ?? []).includes(`"invite:ask:`);

/** One plain line per message: `[ISO time] author (id): text`. No attachments, no embeds. */
export function backupLine(message: { createdTimestamp: number; content?: string; author?: { id: string; username?: string } | null }): string {
  const text = (message.content ?? "").replace(/\r?\n/g, " ⏎ ");
  return `[${new Date(message.createdTimestamp).toISOString()}] ${message.author?.username ?? "unknown"} (${message.author?.id ?? "?"}): ${text}`;
}

/** Saves the messages to backups/ (a file per run). Throws when it cannot, which stops the deletion. */
export async function writeBackup(messages: readonly Parameters<typeof backupLine>[0][], channelId: string, now: Date, dir = defaultBackupDir()): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${channelId}-${now.toISOString().replace(/[:.]/g, "-")}.txt`);
  const ordered = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  await writeFile(file, `${ordered.map(backupLine).join("\n")}\n`, "utf8");
  return file;
}

type ChannelSweepClient = { guilds: { fetch: (id: string) => Promise<GuildLike | null> } };
export interface ChannelSweepOptions { now?: Date; backupDir?: string; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void }

/** One pass over every server with the switch on and no run in the last hour. Returns how many messages were removed. */
export async function runInviteChannelSweeps(client: ChannelSweepClient, database: Pick<PrismaClient, "guildSettings" | "inviteRequest">, options: ChannelSweepOptions = {}): Promise<number> {
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));
  const due = new Date(now.getTime() - CHANNEL_SWEEP_EVERY_MS);
  const servers = await database.guildSettings.findMany({
    where: { inviteQueueEnabled: true, inviteCleanupEnabled: true, inviteChannelId: { not: "" }, OR: [{ inviteSweptAt: null }, { inviteSweptAt: { lte: due } }] },
    select: { guildId: true, inviteChannelId: true, inviteGuideMessageId: true, inviteSweptAt: true, guild: { select: { discordId: true } } }
  });
  // Every reason for not tidying a server is written to the log once (per server and reason), so a silent tidy never happens.
  const sayOnce = (key: string, line: string) => { if (said.has(key)) return; said.add(key); log(line); };
  if (!servers.length) {
    const [withChannel, off, queueOff] = await Promise.all([
      database.guildSettings.count({ where: { inviteChannelId: { not: null } } }),
      database.guildSettings.count({ where: { inviteChannelId: { not: null }, inviteCleanupEnabled: false } }),
      database.guildSettings.count({ where: { inviteChannelId: { not: null }, inviteQueueEnabled: false } })
    ]).catch(() => [-1, -1, -1]);
    sayOnce("none-due", `Invite channel tidy: no server is due (servers with an invite channel: ${withChannel}; tidy switched off: ${off}; invite queue off: ${queueOff}; the rest ran within the last hour).`);
  }
  let removed = 0;
  for (const server of servers) {
    if (!server.inviteChannelId?.trim()) continue;
    const skip = (reason: string) => sayOnce(`${server.guildId}:${reason}`, `Invite channel tidy ${server.guild.discordId}: skipped, ${reason}.`);
    const firstRun = server.inviteSweptAt === null;
    // Claimed first: a second pass (or a restart) within the hour finds nothing due.
    const claim = await database.guildSettings.updateMany({ where: { guildId: server.guildId, OR: [{ inviteSweptAt: null }, { inviteSweptAt: { lte: due } }] }, data: { inviteSweptAt: now } });
    if (!claim.count) continue;
    // A first run that did not finish its dry run and backup does not count: the next pass is a first run again.
    const unclaim = async () => { if (firstRun) await database.guildSettings.updateMany({ where: { guildId: server.guildId }, data: { inviteSweptAt: null } }); };
    const guild = await Promise.resolve(client.guilds.fetch(server.guild.discordId)).catch(() => null);
    if (!guild) { skip("the Discord server could not be fetched"); await unclaim(); continue; }
    const botId = (guild as { client?: { user?: { id?: string } | null } }).client?.user?.id;
    const common = { now, onlyOpen: true, requireGuide: true, protect: (message: ScanMessage) => isInvitePanel(message, botId), members: true, botMinAgeMs: CHANNEL_SWEEP_MIN_AGE_MS, memberMinAgeMs: CHANNEL_SWEEP_MIN_AGE_MS,
      pauseMs: CHANNEL_SWEEP_DELETE_PAUSE_MS, ...(options.sleep ? { sleep: options.sleep } : {}) };
    const dry = await sweepInviteChannel(guild, database, server.guildId, server.inviteChannelId, server.inviteGuideMessageId ?? null, { ...common, confirm: false });
    if (dry.status === "permission") { skip(`the bot needs ${MISSING_PERMISSIONS} in channel ${server.inviteChannelId}`); await unclaim(); continue; }
    if (dry.status === "panel") { skip(`the pinned invite guide message ${server.inviteGuideMessageId ?? "(none was ever posted)"} was not found in channel ${server.inviteChannelId}; post it again with /mod invites questions`); await unclaim(); continue; }
    if (dry.status !== "ok") { skip(`channel ${server.inviteChannelId} is not readable as the configured invite text channel (${dry.status})`); await unclaim(); continue; }
    const count = dry.mine + dry.memberOld;
    log(`Invite channel tidy (dry run) ${server.guild.discordId}: ${count} message${count === 1 ? "" : "s"} would be removed, ${dry.protectedCount} kept (pinned, the panel or open requests), ${dry.scanned} read.`);
    if (!count) { await unclaim(); continue; }
    const saveCopy = async (messages: ScanMessage[]) => { const file = await writeBackup(messages, server.inviteChannelId!, now, options.backupDir); log(`Invite channel tidy: copy of ${messages.length} message${messages.length === 1 ? "" : "s"} saved to ${file}`); };
    if (firstRun) {
      // The very first run on a server only counts and saves a copy; real deleting starts with the next hourly run.
      const saved = await sweepInviteChannel(guild, database, server.guildId, server.inviteChannelId, server.inviteGuideMessageId ?? null, { ...common, confirm: false, backupOnly: true, backup: saveCopy });
      if (saved.status !== "ok") { await unclaim(); continue; }
      log(`Invite channel tidy ${server.guild.discordId}: first run, nothing deleted (${count} counted and saved); deleting starts with the next hourly run.`);
      continue;
    }
    const real = await sweepInviteChannel(guild, database, server.guildId, server.inviteChannelId, server.inviteGuideMessageId ?? null,
      { ...common, confirm: true, backup: saveCopy });
    removed += real.deleted;
    log(`Invite channel tidy ${server.guild.discordId}: removed ${real.deleted}${real.status === "ok" ? "" : ` (stopped: ${real.status})`}.`);
  }
  return removed;
}
