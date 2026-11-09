import type { Guild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t } from "../i18n.js";
import { isPermissionRoleName } from "../permissions.js";

// 9.1: someone posts their character name in the invite channel -> tag the people who can invite them
// right now. "Online" is the game's own roster as the companion or addon last uploaded it (a roster row
// whose last-online time is recent), never Discord presence (a privileged intent we do not require).
// Who can invite: every member of the in-game guild can (owner decision, 7 Nov), so any guildmate whose
// character is linked to a Discord member and shows online is a candidate, most recently online first.
// Nobody known online: the officer role once. When the character joins, markPostsDone edits the tag message.
// At most 3 people, once per request. Officers turn it off with /mod invites settings notify:false.

type Database = Pick<PrismaClient, "guildSettings" | "inviteRequest" | "guildRosterEntry" | "character">;

export const MAX_TAGGED = 3;
/** A roster row counts as online when the game said so within this long ago. */
export const ONLINE_WINDOW_MS = 10 * 60 * 1000;

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Discord IDs of linked guild characters the roster shows online, most recently online first. */
export async function onlineInviters(database: Pick<PrismaClient, "guildRosterEntry" | "character">, guildId: string, exceptDiscordUserId: string, now = new Date()): Promise<string[]> {
  const online = await database.guildRosterEntry.findMany({
    where: { guildId, inGuild: true, lastOnlineAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) } },
    select: { name: true }, orderBy: [{ lastOnlineAt: "desc" }, { rankIndex: "asc" }], take: 200
  });
  if (!online.length) return [];
  const linked = await database.character.findMany({ where: { member: { guildId } }, select: { name: true, member: { select: { discordUserId: true } } } });
  const owner = new Map(linked.map((row) => [fold(row.name), row.member.discordUserId]));
  const ids: string[] = [];
  for (const row of online) {
    const id = owner.get(fold(row.name));
    if (id && id !== exceptDiscordUserId && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_TAGGED) break;
  }
  return ids;
}

/** Keep the tag message's ID so it can be edited once the invite is done. Best effort. */
async function remember(database: Database, input: { guildId: string; requestMessageId: string }, sent: unknown): Promise<void> {
  const id = (sent as { id?: unknown } | null)?.id;
  if (typeof id !== "string") return;
  await database.inviteRequest.updateMany({ where: { guildId: input.guildId, messageId: input.requestMessageId }, data: { notifyMessageId: id } }).catch(() => undefined);
}

/**
 * Tag the online inviters (or the officer role) under a new request, once. Returns what it did.
 * Never throws: a failure only means no tag.
 */
export async function notifyInviters(database: Database, input: {
  guildId: string; discordGuild: Pick<Guild, "roles"> | null; channel: { send: (options: unknown) => Promise<unknown> };
  requestMessageId: string; requesterId: string; displayName: string; now?: Date
}): Promise<"people" | "role" | "none"> {
  try {
    const settings = await database.guildSettings.findUnique({ where: { guildId: input.guildId }, select: { inviteNotifyEnabled: true, language: true } });
    if (!settings || settings.inviteNotifyEnabled === false) return "none";
    // Once per request: whoever flips notifiedAt first sends; the rest stop.
    const claimed = await database.inviteRequest.updateMany({ where: { guildId: input.guildId, messageId: input.requestMessageId, notifiedAt: null, status: "PENDING" }, data: { notifiedAt: input.now ?? new Date() } });
    if (!claimed.count) return "none";
    const lang = asLang(settings.language);
    const reply = { messageReference: input.requestMessageId, failIfNotExists: false };
    const people = await onlineInviters(database, input.guildId, input.requesterId, input.now);
    if (people.length) {
      const sent = await input.channel.send({ content: t(lang, "invite.notify.people", { mentions: people.map((id) => `<@${id}>`).join(" "), name: input.displayName }), reply, allowedMentions: { parse: [], users: people } });
      await remember(database, input, sent);
      return "people";
    }
    const role = input.discordGuild ? [...(await input.discordGuild.roles.fetch().catch(() => null) ?? new Map<string, { id: string; name: string }>()).values()].find((r) => isPermissionRoleName("officer", r.name)) : undefined;
    if (!role) return "none";
    const sentRole = await input.channel.send({ content: t(lang, "invite.notify.role", { role: `<@&${role.id}>`, name: input.displayName }), reply, allowedMentions: { parse: [], roles: [role.id] } });
    await remember(database, input, sentRole);
    return "role";
  } catch (error) {
    console.warn("Invite notify failed", error);
    return "none";
  }
}
