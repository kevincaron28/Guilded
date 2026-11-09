import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, MessageFlags,
  type ButtonInteraction, type Client
} from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { CLASS_NAMES_FR } from "../permissions.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";

// 8.5 track F3 + ROADMAP 5 (owner decisions, 6 November 2026): after a companion link, one Discord DM lists every
// linked character by full name (class, level, which one is the main), on by default. It is sent on the first link and
// again whenever NEW characters get linked, at most once per change: MemberLinkNotice remembers which character ids the
// member was already told about, and uploads within a short window are merged into one DM. Closed DMs are skipped
// silently, like the /guilded verify DM (character-verify.ts tellVerified).
// The "My linked characters" button (also on the welcome DM) answers privately with the current list. It carries no
// server id, so it works in a DM: the member is resolved from the Discord user plus every guild they are linked in.

export const LINKED_PREFIX = "linked:";
const MINE = `${LINKED_PREFIX}mine`;
const MAX_NAMES = 25;
export const LINK_DM_DELAY_MS = 30_000;

type Database = Pick<PrismaClient, "character" | "member" | "memberLinkNotice">;
type Messenger = Pick<Client, "users" | "guilds">;
export type LinkedCharacter = { name: string; displayName: string | null; className: string; level: number | null; isMain: boolean };

/** The "My linked characters" button, usable in a DM (no server id in the custom id). */
export function linkedCharactersRow(lang: Lang): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MINE).setLabel(t(lang, "linked.button")).setStyle(ButtonStyle.Secondary));
}

/** One line per character: main first, full name, class and level. */
export function linkedLines(lang: Lang, characters: readonly LinkedCharacter[], book: Parameters<typeof displayCharacterName>[1]): string {
  const ordered = [...characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
  const lines = ordered.slice(0, MAX_NAMES).map((character) => {
    const klass = lang === "fr" ? (CLASS_NAMES_FR[character.className] ?? character.className) : character.className;
    const level = character.level ? ` ${t(lang, "linked.level", { level: character.level })}` : "";
    return `${character.isMain ? "⭐" : "•"} **${escapeMarkdown(displayCharacterName(character, book))}** — ${klass}${level}${character.isMain ? ` (${t(lang, "linked.main")})` : ""}`;
  });
  if (ordered.length > MAX_NAMES) lines.push(t(lang, "linked.more", { count: ordered.length - MAX_NAMES }));
  return lines.join("\n");
}

/** The DM text. `added` is empty for the first link. */
export function linkedMessage(lang: Lang, server: string, list: string, added: readonly string[]): string {
  const head = added.length
    ? t(lang, "linked.added", { server: escapeMarkdown(server), names: added.map((name) => `**${escapeMarkdown(name)}**`).join(", ") })
    : t(lang, "linked.first", { server: escapeMarkdown(server) });
  return `${head}\n${list}\n\n${t(lang, "linked.hint")}`;
}

/**
 * Sends the DM when the member now has linked characters they were not told about. Returns whether a DM was attempted.
 * `before` is how many characters the member had before the upload: with no notice recorded yet, a member who already
 * had characters (linked before this feature) is only recorded, never DMed. Never throws.
 */
export async function tellLinkedCharacters(client: Messenger | null | undefined, database: Database,
  { guildDiscordId, memberId, lang, before }: { guildDiscordId: string; memberId: string; lang: Lang; before: number }): Promise<boolean> {
  if (!client) return false;
  try {
    const characters = await database.character.findMany({
      where: { memberId }, orderBy: [{ isMain: "desc" }, { name: "asc" }],
      select: { id: true, name: true, displayName: true, className: true, level: true, isMain: true, member: { select: { guildId: true, discordUserId: true } } }
    });
    const notice = await database.memberLinkNotice.findUnique({ where: { memberId } });
    const told = new Set((notice?.characterIds ?? "").split(",").filter(Boolean));
    const current = characters.map((character) => character.id).join(",");
    const fresh = characters.filter((character) => !told.has(character.id));
    const save = () => database.memberLinkNotice.upsert({
      where: { memberId }, create: { memberId, characterIds: current }, update: { characterIds: current, notifiedAt: new Date() }
    });
    if (!characters.length || !fresh.length || (!notice && before > 0)) {
      if (notice ? current !== notice.characterIds : characters.length > 0) await save(); // unlinks and the pre-feature baseline
      return false;
    }
    await save(); // marked before sending, so a closed DM or a crash never makes it repeat
    const book = await loadFullNameBook(database, characters[0]!.member.guildId);
    const server = (await client.guilds.fetch(guildDiscordId).catch(() => null))?.name ?? "Discord";
    const added = notice ? fresh.map((character) => displayCharacterName(character, book)) : [];
    await client.users.send(characters[0]!.member.discordUserId, {
      content: linkedMessage(lang, server, linkedLines(lang, characters, book), added), components: [linkedCharactersRow(lang)], allowedMentions: { parse: [] }
    });
    return true;
  } catch {
    return false; // DMs closed, user gone, or Discord unavailable: say nothing
  }
}

// One companion sync can link several characters across a few requests (two devices, chunked uploads). Calls for the
// same member inside the window share a single DM that reads the final state.
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; before: number }>();
export function scheduleLinkedCharacters(client: Messenger | null | undefined, database: Database,
  input: { guildDiscordId: string; memberId: string; lang: Lang; before: number }, delayMs = LINK_DM_DELAY_MS): void {
  if (!client) return;
  const key = `${input.guildDiscordId}:${input.memberId}`;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const before = existing?.before ?? input.before;
  const timer = setTimeout(() => { pending.delete(key); void tellLinkedCharacters(client, database, { ...input, before }); }, delayMs);
  timer.unref?.();
  pending.set(key, { timer, before });
}

/** How many characters the member has linked right now (read before linking the upload's characters). */
export function linkedCharacterCount(database: Pick<PrismaClient, "character">, memberId: string): Promise<number> {
  return database.character.count({ where: { memberId } });
}

type AnswerDatabase = Pick<PrismaClient, "character" | "member" | "guildSettings">;

/** The private answer to the button: every guild the Discord user is linked in (only this one when clicked in a server). */
export async function linkedCharactersAnswer(database: AnswerDatabase, discordUserId: string, discordGuildId?: string | null): Promise<string> {
  const members = await database.member.findMany({
    where: { discordUserId, ...(discordGuildId ? { guild: { discordId: discordGuildId } } : {}), characters: { some: {} } },
    select: { guildId: true, guild: { select: { name: true } }, characters: { select: { name: true, displayName: true, className: true, level: true, isMain: true } } },
    take: 10
  });
  if (!members.length) return `${t("en", "linked.none")}\n${t("fr", "linked.none")}`;
  const sections: string[] = [];
  for (const member of members) {
    const settings = await database.guildSettings.findUnique({ where: { guildId: member.guildId }, select: { language: true } });
    const lang = asLang(settings?.language);
    const book = await loadFullNameBook(database, member.guildId);
    sections.push(`**${escapeMarkdown(member.guild.name)}**\n${linkedLines(lang, member.characters, book)}\n${t(lang, "linked.hint")}`);
  }
  return sections.join("\n\n").slice(0, 1990);
}

export async function handleLinkedButton(interaction: ButtonInteraction, database: AnswerDatabase): Promise<void> {
  if (interaction.customId !== MINE) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ content: await linkedCharactersAnswer(database, interaction.user.id, interaction.guildId), allowedMentions: { parse: [] } });
}
