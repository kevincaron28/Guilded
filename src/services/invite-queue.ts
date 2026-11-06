import type { PrismaClient } from "../generated/prisma/client.js";

// 8.5 batch 3 (#13/#14): the guild-invite queue. A player writes their full character name (WoW Forever names have a
// first and a last name) in the invite channel; the bot records it, officers see it in /mod invites and in the
// addon's "To invite" panel, and it is done when the character shows up in a roster upload or an officer reacts.

type Database = Pick<PrismaClient, "inviteRequest">;

export interface ParsedInviteName { displayName: string; nameKey: string }

const WORD = String.raw`[\p{L}][\p{L}'’-]{1,23}`;
const NAME = new RegExp(String.raw`^(${WORD})\s+(${WORD})$`, "u");
// "Name: ...", "Perso - ...", "/ginvite ..." and similar lead-ins.
const LEAD_IN = /^(?:\/?g(?:uild)?invite|\/?ginv|(?:nom|name|perso(?:nnage)?|personnage|character|char|pseudo|ign)\s*[:=-])\s*/iu;

/** The full "First Last" name in a message, or null when it does not look like one. */
export function parseInviteName(content: string | null | undefined): ParsedInviteName | null {
  let text = (content ?? "").split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  text = text.replace(/<a?:\w+:\d+>|<[@#&!]+\d+>|https?:\/\/\S+/g, " ").replace(/[*_`~|>"“”«»]/g, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[.!?,;]+$/u, "").replace(/\s+/g, " ").trim();
  text = text.replace(LEAD_IN, "").trim();
  const match = NAME.exec(text);
  if (!match) return null;
  const displayName = `${match[1]} ${match[2]}`;
  return { displayName, nameKey: displayName.normalize("NFC").toLowerCase() };
}

export const nameKeyOf = (name: string): string => name.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();

export interface NewInvite { guildId: string; parsed: ParsedInviteName; discordUserId: string; channelId: string; messageId: string; answers?: string | null; source?: string }

/** Records a post once per message; a repeat of a name already waiting is kept as its own row (the extra message gets its own check mark). */
export async function recordInviteRequest(database: Database, input: NewInvite) {
  return database.inviteRequest.upsert({
    where: { guildId_messageId: { guildId: input.guildId, messageId: input.messageId } },
    create: { guildId: input.guildId, nameKey: input.parsed.nameKey, displayName: input.parsed.displayName, discordUserId: input.discordUserId, channelId: input.channelId, messageId: input.messageId, answers: input.answers ?? null, source: input.source ?? "discord" },
    update: { nameKey: input.parsed.nameKey, displayName: input.parsed.displayName, ...(input.answers ? { answers: input.answers } : {}) }
  });
}

/** Waiting names, oldest first, one row per name (the oldest post wins). */
export async function pendingInvites(database: Database, guildId: string, limit = 50) {
  const rows = await database.inviteRequest.findMany({ where: { guildId, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 500 });
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.nameKey) && seen.add(row.nameKey)).slice(0, limit);
}

export interface InvitedRow { id: string; channelId: string; messageId: string; displayName: string }

/** Marks every waiting post of these names as invited and returns them, so the bot can add the check marks. */
export async function markInvitedByName(database: Database, guildId: string, names: readonly string[], by: string): Promise<InvitedRow[]> {
  const keys = [...new Set(names.map(nameKeyOf).filter(Boolean))];
  if (!keys.length) return [];
  const rows = await database.inviteRequest.findMany({ where: { guildId, status: "PENDING", nameKey: { in: keys } }, select: { id: true, channelId: true, messageId: true, displayName: true } });
  if (!rows.length) return [];
  await database.inviteRequest.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { status: "INVITED", invitedBy: by, invitedAt: new Date() } });
  return rows;
}

/** An officer's check mark on one post: that name is done (all its waiting posts). */
export async function markInvitedByMessage(database: Database, guildId: string, messageId: string, by: string): Promise<InvitedRow[]> {
  const row = await database.inviteRequest.findUnique({ where: { guildId_messageId: { guildId, messageId } }, select: { nameKey: true, status: true } });
  if (!row || row.status !== "PENDING") return [];
  return markInvitedByName(database, guildId, [row.nameKey], by);
}

/** What the addon's "To invite" panel receives: names only, never Discord IDs. */
export function inviteListForAddon(rows: readonly { displayName: string; createdAt: Date }[]): { name: string; at: string }[] {
  return rows.slice(0, 30).map((row) => ({ name: row.displayName, at: row.createdAt.toISOString() }));
}

export function formatInviteList(rows: readonly { displayName: string; discordUserId: string; createdAt: Date; channelId: string; messageId: string; source?: string; note?: string | null; answers?: string | null }[], guildDiscordId: string): string {
  if (!rows.length) return "Nobody is waiting for an invite.";
  // Officer-only reply: notes and answers are shown here and never leave the officers' view.
  const extra = (row: { source?: string; note?: string | null; answers?: string | null }) =>
    `${row.source && row.source !== "discord" ? ` (${row.source})` : ""}${row.note ? `\n  📝 ${row.note.slice(0, 120)}` : ""}${row.answers ? `\n  💬 ${row.answers.replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
  const lines = rows.slice(0, 15).map((row) => `• **${row.displayName}** — <@${row.discordUserId}> <t:${Math.floor(row.createdAt.getTime() / 1000)}:R> [post](https://discord.com/channels/${guildDiscordId}/${row.channelId}/${row.messageId})${extra(row)}\n  \`/ginvite ${row.displayName}\``);
  return `${rows.length} waiting for a guild invite:\n${lines.join("\n")}${rows.length > 15 ? `\n…and ${rows.length - 15} more` : ""}`;
}
