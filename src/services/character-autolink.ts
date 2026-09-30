import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient, UnclaimedCharacter } from "@prisma/client";
import { createGuildService } from "./guild.js";
import { nameKey } from "./roster-discovery.js";

// Linking discovered characters to Discord members without anyone typing:
//   1. automatically, when a member's Discord name (nickname, display name or
//      username) is the character's name, e.g. "Ray", "[GOLD] Ray", "Ray | Priest";
//   2. otherwise the owner runs /character claim (a pick from a list, no code);
//   3. or an officer links it with /character link.

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

// Character -> the one Discord member whose name matches. A name that fits
// nobody, or more than one member, is left for /character claim.
export function matchUnclaimed(unclaimed: { id: string; name: string }[], people: DiscordPerson[]): { characterId: string; discordId: string }[] {
  const matches: { characterId: string; discordId: string }[] = [];
  for (const character of unclaimed) {
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
    ...(unclaimed.spec ? { spec: unclaimed.spec } : {}), ...(unclaimed.level ? { level: unclaimed.level } : {}), ...(unclaimed.race ? { race: unclaimed.race } : {})
  });
  const created = await database.character.findFirst({ where: { memberId, name: unclaimed.name } });
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

// Links what can be linked by Discord name. Returns who was linked.
export async function autoLinkUnclaimed(discordGuild: DiscordGuild, database: Db, guildId: string): Promise<{ character: string; member: string }[]> {
  const unclaimed = await database.unclaimedCharacter.findMany({ where: { guildId } });
  if (unclaimed.length === 0) return [];
  const members = await discordGuild.members.fetch();
  const people: (DiscordPerson & { display: string; username: string })[] = [];
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const names = new Set([...nameCandidates(member.displayName), ...nameCandidates(member.user.username), ...nameCandidates(member.user.globalName ?? "")]);
    people.push({ id: member.id, names: [...names], display: member.displayName, username: member.user.username });
  }
  const guild = createGuildService(database);
  const linked: { character: string; member: string }[] = [];
  for (const match of matchUnclaimed(unclaimed, people)) {
    const character = unclaimed.find((row) => row.id === match.characterId);
    const person = people.find((row) => row.id === match.discordId);
    if (!character || !person) continue;
    // A linked character with that name already exists (linked by hand meanwhile): drop the stale row.
    const taken = await database.character.findFirst({ where: { member: { guildId }, name: { equals: character.name, mode: "insensitive" } } });
    if (taken) { await database.unclaimedCharacter.delete({ where: { id: character.id } }); continue; }
    const member = await guild.ensureMember(guildId, person.id, person.display);
    await linkUnclaimed(database, member.id, character);
    linked.push({ character: character.name, member: person.display });
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
  if (!row) throw new Error(`No unclaimed character called "${wanted}". Log in with it (the addon reports it), then an officer's companion uploads and an officer runs /import apply (or turns on /setup config auto-import). /character list shows what is linked.`);
  const taken = await database.character.findFirst({ where: { member: { guildId }, name: { equals: row.name, mode: "insensitive" } } });
  if (taken) throw new Error(`${row.name} is already linked to someone.`);
  const outcome = await linkUnclaimed(database, memberId, row);
  return { row, ...outcome };
}
