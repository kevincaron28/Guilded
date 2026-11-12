import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";

// Guild-invite channel clean-up (owner request, 12 Nov 2026): about an hour after a request is handled (invited,
// joined or promoted: a roster upload, an officer's check mark or /mod invites record) the bot removes that request's
// message and its own follow-ups (the tag message, the "done" thank-you), so what stays is who still needs an invite.
// Per server officer switch: /mod invites settings cleanup:false (on by default).
//
// Only messages the bot can attribute to the handled request are touched: the request row names the post (a member's
// own post, or the bot's post made by the Request button) and the bot's replies to it. Never a pending request, a
// pinned message, an officer's own note, or the pinned guide. One attempt per request (cleanedAt), so a missing
// permission or a vanished message is logged once and never retried.

/** How long after a request is handled its messages are removed. Easy to change. */
export const CLEANUP_DELAY_MS = 60 * 60_000;
/** At most this many requests per server per sweep, so a first run over old rows stays gentle on Discord's limits. */
export const CLEANUP_BATCH = 15;
const HANDLED = ["INVITED", "JOINED", "PROMOTED"];

type Database = Pick<PrismaClient, "guildSettings" | "inviteRequest">;
type Message = { id: string; pinned: boolean; author?: { id: string } | null; reference?: { messageId?: string | null } | null; delete: () => Promise<unknown> };
type Channel = { isTextBased: () => boolean; messages?: { fetch: (arg: unknown) => Promise<unknown> } };

const warned = new Set<string>();
const warnOnce = (key: string, text: string, error?: unknown) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`Invite clean-up: ${text}`, error ?? "");
};
export const resetCleanupWarnings = () => warned.clear();

const code = (error: unknown): number | undefined => (error as { code?: number } | null)?.code;

/** Removes one handled request's messages. Returns how many were deleted. Never throws. */
export async function cleanRequest(client: Pick<Client, "channels" | "user">, inviteChannelId: string,
  row: { channelId: string; messageId: string; discordUserId: string; notifyMessageId: string | null }): Promise<number> {
  const me = client.user?.id;
  // Only the configured invite channel: a row from before the channel was moved is left alone.
  if (!me || row.channelId !== inviteChannelId) return 0;
  const channel = await client.channels.fetch(row.channelId).catch(() => null) as unknown as Channel | null;
  if (!channel?.isTextBased() || !channel.messages) return 0;
  const messages = channel.messages;
  const one = async (id: string): Promise<Message | null> => (await messages.fetch(id).catch(() => null)) as Message | null;
  let deleted = 0;
  const remove = async (message: Message): Promise<void> => {
    if (message.pinned) return;
    try { await message.delete(); deleted++; } catch (error) {
      if (code(error) === 10008) return; // already gone
      if (code(error) === 50013 || code(error) === 50001) warnOnce(`perm:${row.channelId}`, `the bot cannot delete messages in <#${row.channelId}> (needs View Channel, Read Message History and Manage Messages)`, error);
      else warnOnce(`err:${row.channelId}:${String(code(error))}`, "a message could not be deleted", error);
    }
  };
  // 1. The request itself: the bot's own post, or the member's own post that the request row names.
  const post = await one(row.messageId);
  if (post && (post.author?.id === me || post.author?.id === row.discordUserId)) await remove(post);
  // 2. The bot's follow-ups: the tag message, and its replies to the request (the thank-you under a member's post).
  const followUps = new Map<string, Message>();
  if (row.notifyMessageId) { const note = await one(row.notifyMessageId); if (note) followUps.set(note.id, note); }
  const after = (await messages.fetch({ after: row.messageId, limit: 50 }).catch(() => null)) as Map<string, Message> | null;
  for (const message of after?.values() ?? []) if (message.reference?.messageId === row.messageId) followUps.set(message.id, message);
  for (const message of followUps.values()) if (message.author?.id === me) await remove(message);
  return deleted;
}

/** One server's sweep: handled requests older than the delay, oldest first, a limited batch. */
export async function cleanInviteChannel(client: Pick<Client, "channels" | "user">, database: Database, guildId: string, inviteChannelId: string, now = new Date()): Promise<number> {
  const due = await database.inviteRequest.findMany({
    where: { guildId, status: { in: HANDLED }, cleanedAt: null, invitedAt: { lte: new Date(now.getTime() - CLEANUP_DELAY_MS) } },
    orderBy: { invitedAt: "asc" }, take: CLEANUP_BATCH,
    select: { id: true, channelId: true, messageId: true, discordUserId: true, notifyMessageId: true }
  });
  let deleted = 0;
  for (const row of due) {
    // Marked first: a crash or an error never makes the same request loop.
    const claimed = await database.inviteRequest.updateMany({ where: { id: row.id, cleanedAt: null }, data: { cleanedAt: now } });
    if (!claimed.count) continue;
    deleted += await cleanRequest(client, inviteChannelId, row).catch((error) => { warnOnce(`fail:${guildId}`, "a request could not be cleaned", error); return 0; });
  }
  return deleted;
}

/** Start-up and every few minutes: every server with the queue and the clean-up on. The deadline is stored (invitedAt), so a restart loses nothing. */
export async function cleanAllInviteChannels(client: Pick<Client, "channels" | "user">, database: Database, now = new Date()): Promise<number> {
  const rows = await database.guildSettings.findMany({ where: { inviteQueueEnabled: true, inviteCleanupEnabled: true, inviteChannelId: { not: null } }, select: { guildId: true, inviteChannelId: true } });
  let deleted = 0;
  for (const row of rows) deleted += await cleanInviteChannel(client, database, row.guildId, row.inviteChannelId!, now).catch(() => 0);
  return deleted;
}
