import type { PrismaClient } from "../generated/prisma/client.js";

// 8.5 batch 3 (#13/#14): the guild-invite queue. A player writes their full character name (WoW Forever names have a
// first and a last name) in the invite channel; the bot records it, officers see it in /mod invites and in the
// addon's "To invite" panel, and it is done when the character shows up in a roster upload or an officer reacts.



type Database = Pick<PrismaClient, "inviteRequest">;

/** How long after a request is handled its messages are removed from the invite channel (invite-cleanup.ts). Easy to change. */
export const CLEANUP_DELAY_MS = 60 * 60_000;

/** The bot's "seen, waiting for an invite" reaction. */
export const SEEN = "👀";

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
  // A dash in the last word is kept ("Anna Smith-Jones" is a real surname); a "-Realm" the player typed is matched against
  // the roster's own "Name-Realm" spelling in markInvitedByName.
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
  const byName = rows.filter((row) => !seen.has(row.nameKey) && seen.add(row.nameKey));
  // One row per requester: a second post (a corrected spelling or another name) replaces their earlier one, so a
  // typo ("Aslash Labash" after "Ashlash Labash") never stays beside the fix. Owner report 10 Nov 2026.
  const latest = new Map<string, string>();
  for (const row of byName) latest.set(row.discordUserId, row.id);
  return byName.filter((row) => latest.get(row.discordUserId) === row.id).slice(0, limit);
}

export interface InvitedRow { id: string; channelId: string; messageId: string; displayName: string; notifyMessageId?: string | null }

/** Case, accents and surrounding spaces ignored: "Drakka  Whitefang" and "drakka whitefang" are the same character. */
// The addon folds the same letters (Modules/InviteQueue.lua, generated from this rule; tests/lua/invite-queue.test.ts compares them).
export const foldKey = (name: string): string => nameKeyOf(name).normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[øØ]/gu, "o").replace(/[đĐ]/gu, "d").replace(/[łŁ]/gu, "l").replace(/[ıİ]/gu, "i");

const REALM_SPLIT = /^(.+ .+)-([^\s-]+)$/u;
/**
 * The realm names in use, read from a roster: a dash suffix after a complete "First Last" pair that at least two names carry
 * and that half or more of all the names carry. "Anna Smith-Jones" (a hyphenated surname, no realm) is never a realm.
 * The addon applies the same rule (Modules/InviteQueue.lua, guildKeys).
 */
export function knownRealms(names: readonly string[]): Set<string> {
  const folded = names.map(foldKey).filter(Boolean);
  const counts = new Map<string, number>();
  for (const name of folded) { const m = REALM_SPLIT.exec(name); if (m) counts.set(m[2]!, (counts.get(m[2]!) ?? 0) + 1); }
  return new Set([...counts].filter(([, count]) => count >= 2 && count * 2 >= folded.length).map(([suffix]) => suffix));
}
/** A folded "first last-realm" without its realm; any other dash is part of the name. */
export function stripRealm(folded: string, realms: ReadonlySet<string>): string {
  const m = REALM_SPLIT.exec(folded);
  return m && realms.has(m[2]!) ? m[1]! : folded;
}

/**
 * Marks every waiting post of these names as invited and returns them, so the bot can add the check marks.
 * A roster name matches a post when they are the same after folding case and accents, with a known "-Realm" suffix
 * dropped (never a hyphenated surname); a first-name-only roster entry (older uploads) matches only when exactly one waiting name starts with it.
 */
export async function markInvitedByName(database: Database, guildId: string, names: readonly string[], by: string, realms: ReadonlySet<string> = knownRealms(names)): Promise<InvitedRow[]> {
  const wanted = [...new Set(names.map(foldKey).filter(Boolean))];
  if (!wanted.length) return [];
  const waiting = await database.inviteRequest.findMany({ where: { guildId, status: "PENDING" }, select: { id: true, nameKey: true, channelId: true, messageId: true, displayName: true, notifyMessageId: true }, take: 1000 });
  if (!waiting.length) return [];
  const byFold = new Map<string, typeof waiting>();
  // A request typed with the realm ("Anna Smith-RealmName") is also indexed without it.
  for (const row of waiting) { const full = foldKey(row.nameKey); for (const key of new Set([full, stripRealm(full, realms)])) byFold.set(key, [...(byFold.get(key) ?? []), row]); }
  const hit = new Set<string>();
  const certain = new Set<string>(); // a full first+last name match: the only kind that starts the clean-up clock
  for (const name of wanted) {
    const bare = stripRealm(name, realms);
    const exact = byFold.get(name) ?? byFold.get(bare);
    if (exact) { exact.forEach((row) => { hit.add(row.id); certain.add(row.id); }); continue; }
    if (bare.includes(" ")) continue;
    const loose = [...byFold.keys()].filter((key) => key.startsWith(`${bare} `));
    if (loose.length === 1) byFold.get(loose[0]!)!.forEach((row) => hit.add(row.id));
  }
  const rows = waiting.filter((row) => hit.has(row.id)).map(({ id, channelId, messageId, displayName, notifyMessageId }) => ({ id, channelId, messageId, displayName, notifyMessageId }));
  if (!rows.length) return [];
  const now = new Date();
  await database.inviteRequest.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { status: "INVITED", invitedBy: by, invitedAt: now, cleanupAt: null } });
  // The clean-up clock starts on a full name match, or on an officer's own action (by is not "roster"); a first-name-only roster guess only marks.
  const due = rows.filter((row) => by !== "roster" || certain.has(row.id)).map((row) => row.id);
  if (due.length) await database.inviteRequest.updateMany({ where: { id: { in: due } }, data: { cleanupAt: new Date(now.getTime() + CLEANUP_DELAY_MS) } });
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
