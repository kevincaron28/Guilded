import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { linkUnclaimed } from "./character-autolink.js";
import { createGuildService } from "./guild.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";
import type { DiscoveredCharacter } from "./battlenet.js";

// Blizzard proved these characters belong to this person, so a guild character the addons already
// reported (an unclaimed roster entry with the same name, realm and edition) is linked to them with
// no code and no officer. Nothing is created from Blizzard's list alone: a character the guild has
// never seen stays private, and one that is already linked to someone else is never moved.
// Each link is remembered as a "BNET" claim so the member can undo it in one click.

export const BNET_CLAIM = "BNET";
export const UNDO_WINDOW_MS = 24 * 60 * 60_000;

// Blizzard spells a realm as a slug ("tarren-mill", "malganis") where the game and the addon say
// "Tarren Mill" and "Mal'Ganis". Compare names and realms with punctuation and spaces removed.
const loose = (value: string) => value.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const looseKey = (name: string, realm: string) => `${loose(name)}-${loose(realm)}`;

export interface AutoLinked { guildId: string; guildName: string; name: string; realm: string; isMain: boolean }

export async function autoLinkBattleNet(database: PrismaClient, discordUserId: string, discovered: readonly DiscoveredCharacter[]): Promise<AutoLinked[]> {
  if (!discovered.length) return [];
  const members = await database.member.findMany({
    where: { discordUserId, status: { in: ["ACTIVE", "TRIAL"] }, isTest: false },
    select: { id: true, guildId: true, guild: { select: { name: true, gameEdition: true } } }
  });
  const linked: AutoLinked[] = [];
  for (const member of members) {
    const mine = discovered.filter(c => c.gameEdition === member.guild.gameEdition);
    if (!mine.length) continue;
    const wanted = new Set(mine.map(c => looseKey(c.name, c.realm)));
    const candidates = await database.unclaimedCharacter.findMany({
      where: { guildId: member.guildId, OR: mine.map(c => ({ nameKey: { startsWith: `${c.name.normalize("NFC").toLowerCase()}-` } })) }
    });
    const unclaimed = candidates.filter(row => {
      const cut = row.nameKey.indexOf("-");
      return cut > 0 && wanted.has(looseKey(row.nameKey.slice(0, cut), row.nameKey.slice(cut + 1)));
    });
    const refused = new Set((await database.characterVerifyClaim.findMany({
      where: { guildId: member.guildId, memberId: member.id, status: { in: ["BLOCKED", "REMOVED"] } }, select: { nameKey: true }
    })).map(claim => claim.nameKey));
    const anchors = new Map<string, string>(); // loose realm -> the realm as the guild spells it
    for (const row of unclaimed) {
      if (refused.has(row.nameKey)) continue;
      const { isMain } = await linkUnclaimed(database, member.id, row);
      await database.characterVerifyClaim.upsert({
        where: { guildId_memberId_nameKey: { guildId: member.guildId, memberId: member.id, nameKey: row.nameKey } },
        create: { guildId: member.guildId, memberId: member.id, nameKey: row.nameKey, status: BNET_CLAIM }, update: { status: BNET_CLAIM }
      });
      linked.push({ guildId: member.guildId, guildName: member.guild.name, name: row.name, realm: row.realm, isMain });
      anchors.set(loose(row.realm), row.realm);
    }
    // Alts on the same realm as a character the guild knows are theirs too (Blizzard lists them
    // under the same account), so they are added with the class Blizzard reports. Anything on a
    // realm the guild has not seen this member on stays private.
    const known = await database.character.findMany({ where: { member: { guildId: member.guildId } }, select: { name: true, realm: true, memberId: true } });
    for (const own of known) if (own.memberId === member.id) anchors.set(loose(own.realm), own.realm);
    const taken = new Set(known.map(c => looseKey(c.name, c.realm)));
    const service = createGuildService(database);
    for (const c of mine) {
      const realm = anchors.get(loose(c.realm));
      const key = looseKey(c.name, c.realm);
      if (!realm || !c.className || taken.has(key)) continue;
      const nameKey = characterKey(c.name, realm, c.gameEdition);
      if (refused.has(nameKey)) continue;
      const hasMain = (await database.character.count({ where: { memberId: member.id, isMain: true } })) > 0;
      await service.addCharacter({ memberId: member.id, name: c.name, realm, className: normalizeClassName(c.className), gameEdition: c.gameEdition, isMain: !hasMain,
        ...(c.level ? { level: c.level } : {}), ...(c.race ? { race: normalizeRaceName(c.race) } : {}) });
      await database.characterVerifyClaim.upsert({
        where: { guildId_memberId_nameKey: { guildId: member.guildId, memberId: member.id, nameKey } },
        create: { guildId: member.guildId, memberId: member.id, nameKey, status: BNET_CLAIM }, update: { status: BNET_CLAIM }
      });
      taken.add(key);
      linked.push({ guildId: member.guildId, guildName: member.guild.name, name: c.name, realm, isMain: !hasMain });
    }
  }
  return linked;
}

/** What a recent Battle.net connection linked, for the summary and its undo button. */
export async function recentBattleNetLinks(database: PrismaClient, discordUserId: string, now = new Date()): Promise<AutoLinked[]> {
  const claims = await database.characterVerifyClaim.findMany({
    where: { status: BNET_CLAIM, updatedAt: { gt: new Date(now.getTime() - UNDO_WINDOW_MS) }, member: { discordUserId } },
    select: { nameKey: true, guildId: true, memberId: true, guild: { select: { name: true } } }
  });
  const out: AutoLinked[] = [];
  for (const claim of claims) {
    const character = await findClaimed(database, claim.memberId, claim.guildId, claim.nameKey);
    if (character) out.push({ guildId: claim.guildId, guildName: claim.guild.name, name: character.name, realm: character.realm, isMain: character.isMain });
  }
  return out;
}

async function findClaimed(database: PrismaClient, memberId: string, guildId: string, nameKey: string) {
  const owned = await database.character.findMany({ where: { memberId, member: { guildId } }, select: { id: true, name: true, realm: true, gameEdition: true, isMain: true } });
  return owned.find(c => characterKey(c.name, c.realm, c.gameEdition) === nameKey) ?? null;
}

/**
 * Unlinks the characters the last connection linked (only while they are still the member's and
 * within a day, so history built since is not lost) and stops them relinking by themselves.
 */
export async function undoBattleNetLinks(database: PrismaClient, discordUserId: string, now = new Date()): Promise<number> {
  const claims = await database.characterVerifyClaim.findMany({
    where: { status: BNET_CLAIM, updatedAt: { gt: new Date(now.getTime() - UNDO_WINDOW_MS) }, member: { discordUserId } },
    select: { nameKey: true, guildId: true, memberId: true }
  });
  let undone = 0;
  for (const claim of claims) {
    const character = await findClaimed(database, claim.memberId, claim.guildId, claim.nameKey);
    if (character) { await database.character.delete({ where: { id: character.id } }); undone++; }
    await database.characterVerifyClaim.update({ where: { guildId_memberId_nameKey: { guildId: claim.guildId, memberId: claim.memberId, nameKey: claim.nameKey } }, data: { status: "BLOCKED" } });
  }
  return undone;
}
