import { escapeMarkdown, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { t, type Lang } from "../i18n.js";
import { displayCharacterName, fullNameBook } from "./character-display.js";

// 8.5 track F3, owner decision (6 November 2026): after a member's FIRST companion link, one Discord DM
// ("You're linked: First Last, Second Last"), on by default. "First" means the upload took the member
// from no linked character to some, so it needs no stored flag and is sent once per member in practice.
// Closed DMs are skipped silently, like the /guilded verify DM (character-verify.ts tellVerified).

type Database = Pick<PrismaClient, "character" | "member">;
type Messenger = Pick<Client, "users" | "guilds">;
const MAX_NAMES = 10;

/** How many characters the member has linked right now (read before linking the upload's characters). */
export function linkedCharacterCount(database: Pick<PrismaClient, "character">, memberId: string): Promise<number> {
  return database.character.count({ where: { memberId } });
}

/** The DM text: main first, then by name; at most ten names. */
export function firstLinkMessage(lang: Lang, server: string, names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES).map((name) => `**${escapeMarkdown(name)}**`).join(", ");
  const more = names.length > MAX_NAMES ? t(lang, "companion.firstLinkMore", { count: names.length - MAX_NAMES }) : "";
  return t(lang, "companion.firstLink", { server: escapeMarkdown(server), names: shown + more });
}

/**
 * Sends the DM when the member had no linked character before this upload and has some now.
 * Returns whether a DM was sent. Never throws.
 */
export async function tellFirstCompanionLink(client: Messenger | null | undefined, database: Database,
  { guildDiscordId, memberId, lang, before }: { guildDiscordId: string; memberId: string; lang: Lang; before: number }): Promise<boolean> {
  if (!client || before > 0) return false;
  try {
    const characters = await database.character.findMany({ where: { memberId }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { name: true, displayName: true } });
    if (!characters.length) return false;
    const book = fullNameBook(characters);
    const member = await database.member.findUnique({ where: { id: memberId }, select: { discordUserId: true } });
    if (!member) return false;
    const server = (await client.guilds.fetch(guildDiscordId).catch(() => null))?.name ?? "Discord";
    const content = firstLinkMessage(lang, server, characters.map((character) => displayCharacterName(character, book)));
    await client.users.send(member.discordUserId, { content, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false; // DMs closed, user gone, or Discord unavailable: say nothing
  }
}
