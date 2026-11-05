import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient, UnclaimedCharacter } from "../generated/prisma/client.js";
import { createGuildService } from "./guild.js";
import { nameKey } from "./roster-discovery.js";
import { cacheAllMembers } from "./member-cache.js";
import { characterKey } from "../../companion/character-identity.mjs";

// Linking discovered characters to Discord members without anyone typing:
//   1. automatically, when a member's Discord name (nickname, display name or
//      username) is the character's name, e.g. "Ray", "[GOLD] Ray", "Ray | Priest";
//   2. otherwise the owner runs /character claim (a pick from a list, no code);
//   3. or an officer links it with /officer character link.

const strip = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// The names a Discord display name could stand for: the whole thing with
// tags removed, and each word of three or more letters ("Ray | Priest" -> ray, priest).
export function nameCandidates(display: string): string[] {
  const withoutTags = display.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ");
  const words = strip(withoutTags).split(/[^a-z]+/).filter((word) => word.length >= 3);
  const whole = words.join("");
  return [...new Set([...(whole ? [whole] : []), ...words])];
}

export interface DiscordPerson { id: string; names: string[]; }

// A Forever character has a first AND a last name ("Lebowski Holyroller"): the letters of both, run together.
const fullNameKey = (displayName: string | null | undefined) => {
  const words = strip(displayName ?? "").split(/[^a-z]+/).filter(Boolean);
  return words.length >= 2 ? words : null;
};

// Character -> the one Discord member whose name matches. The full name (first and last) is the
// stronger match and decides alone; otherwise the first name must fit exactly one member. A name
// that fits nobody, or more than one member, is left for /character claim.
export function matchUnclaimed(unclaimed: { id: string; name: string; displayName?: string | null }[], people: DiscordPerson[]): { characterId: string; discordId: string }[] {
  const matches: { characterId: string; discordId: string }[] = [];
  for (const character of unclaimed) {
    const words = fullNameKey(character.displayName);
    if (words && words.every((word) => word.length >= 3)) {
      const whole = words.join("");
      const full = people.filter((person) => person.names.some((candidate) => candidate === whole) || words.every((word) => person.names.includes(word)));
      if (full.length === 1 && full[0]) { matches.push({ characterId: character.id, discordId: full[0].id }); continue; }
      if (full.length > 1) continue;
    }
    const wanted = strip(character.name).replace(/[^a-z]/g, "");
    if (wanted.length < 3) continue;
    const fits = people.filter((person) => person.names.some((candidate) => candidate === wanted));
    if (fits.length === 1 && fits[0]) matches.push({ characterId: character.id, discordId: fits[0].id });
  }
  return matches;
}

type Db = PrismaClient;

// Turns an unclaimed character into a linked one for `memberId` (main if it is their first).
export async function linkUnclaimed(database: Db, memberId: string, unclaimed: UnclaimedCharacter): Promise<{ isMain: boolean }> {
  const hasMain = (await database.character.count({ where: { memberId, isMain: true } })) > 0;
  const guild = createGuildService(database);
  await guild.addCharacter({
    memberId, name: unclaimed.name, realm: unclaimed.realm, className: unclaimed.className, isMain: !hasMain,
    gameEdition: unclaimed.gameEdition ?? "forever",
    ...(unclaimed.displayName ? { displayName: unclaimed.displayName } : {}),
    ...(unclaimed.spec ? { spec: unclaimed.spec } : {}), ...(unclaimed.level ? { level: unclaimed.level } : {}), ...(unclaimed.race ? { race: unclaimed.race } : {})
  });
  const created = await database.character.findFirst({ where: { memberId, name: unclaimed.name, realm: unclaimed.realm, gameEdition: unclaimed.gameEdition ?? "forever" } });
  const professions = Array.isArray(unclaimed.professions) ? unclaimed.professions as { name: string; skillLevel: number }[] : [];
  if (created) {
    for (const profession of professions) {
      if (!profession?.name) continue;
      await database.professionSkill.upsert({
        where: { characterId_profession: { characterId: created.id, profession: profession.name } },
        create: { characterId: created.id, profession: profession.name, skillLevel: Number(profession.skillLevel) || 0 },
        update: { skillLevel: Number(profession.skillLevel) || 0 }
      });
    }
    await database.character.update({ where: { id: created.id }, data: { lastSeenAt: unclaimed.lastSeenAt, professionsUpdatedAt: unclaimed.professionsUpdatedAt } });
  }
  await database.unclaimedCharacter.delete({ where: { id: unclaimed.id } });
  return { isMain: !hasMain };
}

// Someone unlinked (or an officer removed) this character from that member: automation must not link it back.
async function declined(database: Db, guildId: string, memberId: string, row: UnclaimedCharacter): Promise<boolean> {
  const claim = await database.characterVerifyClaim.findFirst({
    where: { guildId, memberId, nameKey: characterKey(row.name, row.realm, row.gameEdition ?? "forever"), status: { in: ["BLOCKED", "REMOVED"] } },
    select: { id: true }
  });
  return Boolean(claim);
}

// Links one unclaimed row to a member unless a linked character already owns the name.
async function linkIfFree(database: Db, guildId: string, memberId: string, row: UnclaimedCharacter): Promise<boolean> {
  // A linked character with that name already exists (linked by hand meanwhile): drop the stale row.
  const taken = await database.character.findFirst({ where: { member: { guildId }, name: { equals: row.name, mode: "insensitive" } } });
  if (taken) { await database.unclaimedCharacter.delete({ where: { id: row.id } }); return false; }
  if (await declined(database, guildId, memberId, row)) return false;
  await linkUnclaimed(database, memberId, row);
  return true;
}

/**
 * Elimination for one upload: when exactly one character arrived from it and exactly one active
 * member who has a companion credential has no character yet, those two belong together. Anything
 * less clear (two newcomers, two candidates, a declined link) is left for /character claim.
 */
export async function linkSoleNewcomer(database: Db, guildId: string, since: Date): Promise<{ character: string; member: string } | null> {
  const arrived = await database.unclaimedCharacter.findMany({ where: { guildId, lastSeenAt: { gte: since }, gameEdition: "forever" } });
  if (arrived.length !== 1 || !arrived[0]) return null;
  const waiting = await database.member.findMany({
    where: { guildId, status: "ACTIVE", characters: { none: {} }, companionCredentials: { some: { revokedAt: null } } },
    select: { id: true, displayName: true },
    take: 2
  });
  if (waiting.length !== 1 || !waiting[0]) return null;
  if (!await linkIfFree(database, guildId, waiting[0].id, arrived[0])) return null;
  return { character: arrived[0].name, member: waiting[0].displayName };
}

// Links what can be linked by Discord name (first name, or first AND last name), and, with `since`
// (the start of the upload that brought characters), the one-newcomer-one-waiting-member case.
export async function autoLinkUnclaimed(discordGuild: DiscordGuild, database: Db, guildId: string, options: { since?: Date } = {}): Promise<{ character: string; member: string }[]> {
  const unclaimed = await database.unclaimedCharacter.findMany({ where: { guildId } });
  if (unclaimed.length === 0) return [];
  await cacheAllMembers(discordGuild);
  const members = discordGuild.members.cache;
  const people: (DiscordPerson & { display: string; username: string })[] = [];
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const names = new Set([...nameCandidates(member.displayName), ...nameCandidates(member.user.username), ...nameCandidates(member.user.globalName ?? "")]);
    people.push({ id: member.id, names: [...names], display: member.displayName, username: member.user.username });
  }
  const guild = createGuildService(database);
  const linked: { character: string; member: string }[] = [];
  // A Discord nickname cannot prove which realm owns a same-named character.
  // Blizzard characters use explicit pairing/claiming; retain legacy Forever linking.
  for (const match of matchUnclaimed(unclaimed.filter(row => (row.gameEdition ?? "forever") === "forever"), people)) {
    const character = unclaimed.find((row) => row.id === match.characterId);
    const person = people.find((row) => row.id === match.discordId);
    if (!character || !person) continue;
    const member = await guild.ensureMember(guildId, person.id, person.display);
    if (await linkIfFree(database, guildId, member.id, character)) linked.push({ character: character.name, member: person.display });
  }
  if (options.since) {
    const sole = await linkSoleNewcomer(database, guildId, options.since).catch(() => null);
    if (sole) linked.push(sole);
  }
  return linked;
}

// /character claim: the caller links one discovered character to themselves.
export async function claimCharacter(database: Db, guildId: string, memberId: string, nameOrId: string) {
  const wanted = nameOrId.trim();
  const row = await database.unclaimedCharacter.findFirst({ where: { guildId, OR: [{ id: wanted }, { nameKey: nameKey(wanted) }] } });
  if (!row) {
    const linked = await database.character.findFirst({ where: { member: { guildId }, name: { equals: wanted, mode: "insensitive" } }, include: { member: true } });
    if (linked) throw new Error(`${linked.name} is already linked${linked.memberId === memberId ? " to you" : ` to ${linked.member.displayName}`}. /character list shows what is linked.`);
  }
  if (!row) throw new Error(`No unclaimed character called "${wanted}" yet. Log in with it once and sync; it then shows up in the /character claim list. /character list shows what is linked.`);
  const taken = await database.character.findFirst({ where: { member: { guildId }, name: { equals: row.name, mode: "insensitive" }, ...((row.gameEdition ?? "forever") !== "forever" ? { realm: { equals: row.realm, mode: "insensitive" }, gameEdition: row.gameEdition } : {}) } });
  if (taken) throw new Error(`${row.name} is already linked to someone.`);
  const outcome = await linkUnclaimed(database, memberId, row);
  return { row, ...outcome };
}
