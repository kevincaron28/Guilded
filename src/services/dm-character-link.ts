import { escapeMarkdown, type Message } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { hostedPilot } from "../hosted-pilot.js";
import { claimCharacter } from "./character-autolink.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { linkUndoRows } from "./companion-link-dm.js";
import { foldKey, parseInviteName, type ParsedInviteName } from "./invite-queue.js";

// Owner request (17 November 2026): "why when I message the bot my character name it doesn't link it". A DM that is a full
// character name ("First Last") links that character to the member, the same as /character link with a typed name: the weakest
// proof ("named"), so a character another member holds is never moved (the companion sign-in proves ownership). Replies are
// in each server's language, name no other member, and carry the "This isn't my character" undo of every automatic link.

type Database = Pick<PrismaClient, "member" | "character" | "unclaimedCharacter" | "guildSettings" | "memberLinkNotice" | "characterVerifyClaim" | "guildRosterEntry" | "publicRunPlayer" | "$transaction">;

export const DM_LINK_REPLY_GAP_MS = 10_000;
const lastReply = new Map<string, number>();

type Found = { id: string; name: string; displayName: string | null };
export type Outcome = { kind: "linked"; character: Found } | { kind: "mine"; character: Found } | { kind: "other" } | { kind: "none" };

interface Place { memberId: string; guildId: string; server: string; lang: Lang }

/** One server's answer for a typed name. `apply` false only looks (nothing is linked). */
export async function linkNamedCharacter(database: Database, place: Pick<Place, "memberId" | "guildId">, parsed: ParsedInviteName, apply = true): Promise<Outcome> {
  const wanted = foldKey(parsed.displayName);
  const first = parsed.displayName.split(" ")[0]!;
  const same = (row: { name: string; displayName?: string | null }) => foldKey(row.name) === wanted || (row.displayName ? foldKey(row.displayName) === wanted : false);
  const held = (await database.character.findMany({ where: { guildId: place.guildId, name: { startsWith: first, mode: "insensitive" } }, select: { id: true, name: true, displayName: true, memberId: true }, take: 200 }))
    .filter(same);
  if (held.length) {
    const mine = held.find((row) => row.memberId === place.memberId);
    return mine ? { kind: "mine", character: mine } : { kind: "other" };
  }
  const unclaimed = (await database.unclaimedCharacter.findMany({ where: { guildId: place.guildId }, select: { id: true, name: true, displayName: true }, take: 5_000 })).filter(same);
  if (unclaimed.length > 1) return { kind: "none" }; // two reported characters spell the same: not guessing
  if (!apply) return unclaimed.length ? { kind: "linked", character: unclaimed[0]! } : { kind: "none" };
  try {
    // /character link: an unclaimed row, else one this member unlinked themselves (it comes back). Throws when there is nothing.
    const result = await claimCharacter(database as never, place.guildId, place.memberId, unclaimed[0]?.id ?? parsed.displayName);
    const row = result.row as { name: string; displayName?: string | null };
    const created = await database.character.findFirst({ where: { memberId: place.memberId, name: row.name }, select: { id: true, name: true, displayName: true } });
    return { kind: "linked", character: created ?? { id: "", name: row.name, displayName: row.displayName ?? null } };
  } catch {
    return { kind: "none" };
  }
}

async function placesOf(database: Database, discordUserId: string): Promise<Place[]> {
  const rows = await database.member.findMany({
    where: { discordUserId, status: { not: "LEFT" }, isTest: false },
    select: { id: true, guildId: true, guild: { select: { discordId: true, name: true, settings: { select: { language: true } } } } }
  });
  return rows.filter((row) => hostedPilot.allows(row.guild.discordId)).map((row) => ({
    memberId: row.id, guildId: row.guildId, server: row.guild.name ?? "Discord", lang: asLang(row.guild.settings?.language)
  }));
}

/** The reply and the characters it offers an undo for, or null when the user belongs to no server using Guilded. */
export async function answerCharacterDm(database: Database, discordUserId: string, parsed: ParsedInviteName, options: { offerOnly?: boolean } = {}) {
  const places = await placesOf(database, discordUserId);
  if (!places.length) return null;
  const lang = places[0]!.lang;
  const name = escapeMarkdown(parsed.displayName);
  const lines: string[] = [];
  const undo: Found[] = [];
  let bookGuildId = "";
  let linked = 0;
  let known = 0;
  let someoneElse = false;
  for (const place of places) {
    const server = escapeMarkdown(place.server);
    const outcome = await linkNamedCharacter(database, place, parsed, !options.offerOnly);
    if (outcome.kind === "linked" && options.offerOnly) { linked++; lines.push(t(place.lang, "dmlink.offer", { name, server })); }
    else if (outcome.kind === "linked") {
      linked++; undo.push(outcome.character); bookGuildId ||= place.guildId;
      lines.push(t(place.lang, "dmlink.linked", { name: escapeMarkdown(displayCharacterName(outcome.character)), server }));
    } else if (outcome.kind === "mine") { known++; lines.push(t(place.lang, "dmlink.mine", { name, server })); }
    else if (outcome.kind === "other") { someoneElse = true; lines.push(t(place.lang, "dmlink.other", { name, server })); }
  }
  if (options.offerOnly) return linked ? { content: lines.filter((line) => line.length).join("\n"), undo, lang, bookGuildId } : null;
  if (!linked && !known && !someoneElse) lines.push(t(lang, "dmlink.none", { name }));
  else if (someoneElse) lines.push(t(lang, "dmlink.otherHow"));
  if (linked) lines.push(t(lang, "dmlink.hint"));
  return { content: lines.join("\n").slice(0, 1900), undo, lang, bookGuildId };
}

/**
 * A DM that is a full character name links it. Returns true when the DM was a name (answered or rate limited).
 * `afterInvite`: the DM already became a guild invite request, so nothing is linked; a matching known character is only offered.
 */
export async function handleCharacterDm(message: Message, database: Database, options: { afterInvite?: boolean; now?: number } = {}): Promise<boolean> {
  if (message.guildId || message.author.bot) return false;
  const parsed = parseInviteName(message.content);
  if (!parsed) return false;
  if (!options.afterInvite) {
    const now = options.now ?? Date.now();
    if (now - (lastReply.get(message.author.id) ?? 0) < DM_LINK_REPLY_GAP_MS) return true; // no reply loops, no spam
    lastReply.set(message.author.id, now);
    if (lastReply.size > 5_000) for (const [id, at] of lastReply) if (now - at > DM_LINK_REPLY_GAP_MS) lastReply.delete(id);
  }
  const answer = await answerCharacterDm(database, message.author.id, parsed, { offerOnly: options.afterInvite === true });
  if (!answer) return !options.afterInvite;
  const components = answer.undo.length ? linkUndoRows(answer.lang, answer.undo, await loadFullNameBook(database as never, answer.bookGuildId)) : [];
  await message.reply({ content: answer.content, components, allowedMentions: { parse: [] } }).catch(() => undefined);
  return true;
}

/** Test hook. */
export const resetDmLinkRateLimit = () => lastReply.clear();
