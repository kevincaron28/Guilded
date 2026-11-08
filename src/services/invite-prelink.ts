import { escapeMarkdown, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AddonCharacter } from "../integrations/addon.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { asLang, t } from "../i18n.js";
import { gameEditionOf } from "./game-edition.js";
import { linkPairedCharacter } from "./character-pairing.js";
import { postToLogChannel } from "./housekeeping.js";

// Pre-linking from the invite channel (9.1): a member who asks for a guild invite names their
// character to the bot ("First Last", button or typed). That request is the provisional claim. When
// the character shows up in the guild (any member's upload brings the roster or guildmates'
// digests), it is linked to the member who asked, provisionally (a PROVISIONAL claim, so the next
// officer upload or /guilded verify can still confirm or move it), and they get one DM.
//
// Never links a name that is already linked to anyone, one that two different people asked for
// (ambiguous: those wait for /guilded verify), one the member unlinked, or a first name only.

type Database = Pick<PrismaClient, "inviteRequest" | "member" | "character" | "characterVerifyClaim" | "guildRosterEntry" | "$transaction">;

/** Lowercase, accents and spacing folded, so "Élodie  Rose" matches "elodie rose". */
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface PrelinkResult { discordUserId: string; name: string; isMain: boolean }

/**
 * Link every waiting or invited request whose full character name is among `seen` (characters with a
 * class, from an upload) or in the stored guild roster. Returns the new links. Safe to repeat.
 */
export async function prelinkInvitedCharacters(database: Database, guildId: string, seen: readonly AddonCharacter[]): Promise<PrelinkResult[]> {
  const requests = await database.inviteRequest.findMany({ where: { guildId, status: { in: ["PENDING", "INVITED"] } }, select: { nameKey: true, discordUserId: true }, take: 1000 });
  if (!requests.length) return [];
  // A name asked for by two different people is ambiguous: nobody gets it automatically.
  const askers = new Map<string, Set<string>>();
  for (const request of requests) { const key = fold(request.nameKey); askers.set(key, (askers.get(key) ?? new Set()).add(request.discordUserId)); }
  const candidates = new Map<string, AddonCharacter>();
  for (const entry of seen) {
    const key = fold(entry.name);
    if (entry.class && askers.has(key) && key.includes(" ") && !candidates.has(key)) candidates.set(key, entry);
  }
  const roster = await database.guildRosterEntry.findMany({ where: { guildId, inGuild: true, gameEdition: "forever", nameKey: { in: [...askers.keys()] } }, select: { name: true, level: true, className: true } });
  for (const row of roster) {
    const key = fold(row.name);
    if (row.className && askers.has(key) && !candidates.has(key)) candidates.set(key, { name: row.name, realm: "forever", class: row.className, race: "", level: row.level ?? 0, spec: "", professions: [], gameEdition: "forever" });
  }
  const results: PrelinkResult[] = [];
  for (const [key, entry] of candidates) {
    const people = askers.get(key)!;
    if (people.size !== 1) continue;
    const member = await database.member.findFirst({ where: { guildId, discordUserId: [...people][0]! }, select: { id: true } });
    if (!member) continue;
    const claimKey = characterKey(entry.name, entry.realm, gameEditionOf(entry));
    const claims = await database.characterVerifyClaim.findMany({ where: { guildId, memberId: member.id, nameKey: claimKey }, select: { status: true } });
    if (claims.some((claim) => claim.status === "BLOCKED" || claim.status === "REMOVED")) continue;
    if (await linkPairedCharacter(database as PrismaClient, guildId, member.id, entry) !== "linked") continue;
    await database.characterVerifyClaim.upsert({
      where: { guildId_memberId_nameKey: { guildId, memberId: member.id, nameKey: claimKey } },
      create: { guildId, memberId: member.id, nameKey: claimKey, status: "PROVISIONAL" }, update: { status: "PROVISIONAL" }
    });
    const created = await database.character.findFirst({ where: { memberId: member.id, name: entry.name, gameEdition: gameEditionOf(entry) }, select: { isMain: true } });
    results.push({ discordUserId: [...people][0]!, name: entry.name, isMain: created?.isMain ?? false });
  }
  return results;
}

/** One DM per new link, and one line for officers in the log channel. Never throws. */
export async function tellPrelinked(client: Client, discordGuildId: string, lang: string | null | undefined, results: readonly PrelinkResult[]): Promise<void> {
  if (!results.length) return;
  const language = asLang(lang);
  const guild = await client.guilds.fetch(discordGuildId).catch(() => null);
  const server = escapeMarkdown(guild?.name ?? "Discord");
  for (const result of results) {
    await client.users.send(result.discordUserId, {
      content: t(language, "invite.prelinked", { name: escapeMarkdown(result.name), server, kind: t(language, result.isMain ? "character.mainKind" : "character.altKind") }),
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
  }
  if (guild) {
    await postToLogChannel(guild, results.map((result) => language === "fr"
      ? `🔗 ${result.name} a été lié à <@${result.discordUserId}>, qui a demandé ce nom dans le salon d'invitation (la prochaine synchronisation d'un officier ou son code /guilded verify le confirme).`
      : `🔗 ${result.name} was linked to <@${result.discordUserId}> because they asked for that name in the invite channel (the next officer sync or their /guilded verify code confirms it).`).join("\n")).catch(() => undefined);
  }
}
