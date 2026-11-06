import { PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterName } from "./character-display.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";

// 8.5 track C2: opt-in nickname sync. Off until an officer turns it on (/officer roster nicknames). Each member's
// server nickname becomes "Discord name (Main First)" (the officer can pick another format), capped at 32
// characters. A member can opt out any time (/character nickname off) and gets the nickname they had back.
// The bot never renames the server owner, bots or anyone it cannot manage (a role above the bot's), and it
// remembers the original nickname (MemberNickname) so turning the feature off restores everyone.

export const NICKNAME_MAX = 32;
export const DEFAULT_NICKNAME_FORMAT = "{name} ({full})";
// {name}: the Discord name, {main}: the main character's first name, {full}: the main's full name.
export const NICKNAME_FORMAT_HELP = "{name} = Discord name, {main} = main's first name, {full} = main's full name";

export function validNicknameFormat(format: string): boolean {
  return format.length <= 60 && /\{(main|full)\}/.test(format) && format.replace(/\{(name|main|full)\}/g, "").indexOf("{") === -1;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The nickname for one member. Over 32 characters it tries, in order: no space before "(", the last name shortened
 * ("Lebowski H."), the first name only, then the Discord name shortened with "…" keeping "(First)". The Discord name
 * is never dropped; null when nothing fits.
 */
export function nicknameFor(baseName: string, mainName: string, format = DEFAULT_NICKNAME_FORMAT): string | null {
  const main = mainName.trim().replace(/\s+/g, " ");
  const base = baseName.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!base || !main) return null;
  const fill = (name: string, fmt: string, full: string) => fmt.replace(/\{name\}/g, name).replace(/\{main\}/g, firstName(main)).replace(/\{full\}/g, full).replace(/\s+/g, " ").trim();
  const words = main.split(" ");
  const short = words.length > 1 ? `${words[0]} ${words[words.length - 1]!.charAt(0)}.` : main;
  const tight = format.replace(/\s+\(/, "(");
  const fits = (value: string) => value.length <= NICKNAME_MAX ? value : null;
  const whole = fits(fill(base, format, main));
  if (whole) return whole;
  if (!format.includes("{name}")) return null;
  const tries = [fill(base, tight, main), fill(base, tight, short), fill(base, tight, firstName(main))];
  for (const attempt of tries) if (attempt.length <= NICKNAME_MAX) return attempt;
  // Shorten the Discord name, keeping "(First)".
  const room = NICKNAME_MAX - fill("", tight.replace(/\{name\}/g, ""), firstName(main)).length - 1;
  if (room < 3) return null;
  return fits(fill(`${[...base].slice(0, room).join("").trimEnd()}…`, tight, firstName(main)));
}

export interface NicknamePerson {
  discordUserId: string;
  /** Discord's global name or username, never the current server nickname. */
  accountName: string;
  /** Current server nickname (null: none). */
  nickname: string | null;
  mainName: string | null;
  skip: boolean;
  record: { originalNickname: string | null; appliedNickname: string | null; optedOut: boolean } | null;
}
export interface NicknameChange { discordUserId: string; nickname: string; originalNickname: string | null }

export function planNicknames(people: readonly NicknamePerson[], format = DEFAULT_NICKNAME_FORMAT): NicknameChange[] {
  const changes: NicknameChange[] = [];
  for (const person of people) {
    if (person.skip || person.record?.optedOut || !person.mainName) continue;
    // Our own earlier rename is not the member's nickname; a different current nickname is theirs (they changed it).
    const ours = person.record?.appliedNickname != null && person.nickname === person.record.appliedNickname;
    const original = ours ? person.record!.originalNickname : person.nickname;
    // The name part is the Discord account name, never the current nickname, so a re-sync does not nest.
    const target = nicknameFor(person.accountName, person.mainName, format);
    if (!target || target === person.nickname) continue;
    changes.push({ discordUserId: person.discordUserId, nickname: target, originalNickname: original });
  }
  return changes;
}

// A member's main: the one marked main, else the first by name.
export function mainCharacterName(characters: readonly { name: string; displayName?: string | null; isMain: boolean }[]): string | null {
  const sorted = [...characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || characterName(a).localeCompare(characterName(b)));
  return sorted[0] ? characterName(sorted[0]) : null;
}

export const botCanRename = (guild: Guild) => Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames));
const canRename = (guild: Guild, member: GuildMember) => member.id !== guild.ownerId && !member.user.bot && member.manageable;

export interface NicknameSyncResult { changes: NicknameChange[]; applied: number; failed: number; skipped: string | null }

export async function syncNicknames(prisma: PrismaClient, guild: Guild, options: { dryRun?: boolean } = {}): Promise<NicknameSyncResult> {
  const none = (skipped: string | null): NicknameSyncResult => ({ changes: [], applied: 0, failed: 0, skipped });
  const row = await prisma.guild.findUnique({ where: guildWhere(guild.id), select: { id: true, gameEdition: true, settings: { select: { nicknameSyncEnabled: true, nicknameFormat: true } } } });
  if (!row) return none("This server is not set up yet.");
  if (row.settings?.nicknameSyncEnabled === false) return none("Nickname sync is off.");
  if (!botCanRename(guild)) return none("I need the Manage Nicknames permission.");
  const format = row.settings?.nicknameFormat && validNicknameFormat(row.settings?.nicknameFormat) ? row.settings?.nicknameFormat : DEFAULT_NICKNAME_FORMAT;
  const [members, records] = await Promise.all([
    prisma.member.findMany({
      where: { guildId: row.id, status: "ACTIVE", isTest: false, characters: { some: { gameEdition: row.gameEdition ?? "forever" } } },
      select: { discordUserId: true, characters: { where: { gameEdition: row.gameEdition ?? "forever" }, select: { name: true, displayName: true, isMain: true } } }
    }),
    prisma.memberNickname.findMany({ where: { guildId: row.id } })
  ]);
  const byUser = new Map(records.map((record) => [record.discordUserId, record]));
  const people: NicknamePerson[] = [];
  for (const member of members) {
    const discordMember = guild.members.cache.get(member.discordUserId) ?? await guild.members.fetch(member.discordUserId).catch(() => null);
    if (!discordMember) continue;
    people.push({ discordUserId: member.discordUserId, accountName: discordMember.user.globalName ?? discordMember.user.username, nickname: discordMember.nickname,
      mainName: mainCharacterName(member.characters), skip: !canRename(guild, discordMember), record: byUser.get(member.discordUserId) ?? null });
  }
  const changes = planNicknames(people, format);
  if (options.dryRun) return { changes, applied: 0, failed: 0, skipped: null };
  let applied = 0, failed = 0;
  for (const change of changes) {
    const member = guild.members.cache.get(change.discordUserId);
    if (!member) { failed++; continue; }
    try {
      await member.setNickname(change.nickname, "Guilded nickname sync");
      await prisma.memberNickname.upsert({
        where: { guildId_discordUserId: { guildId: row.id, discordUserId: change.discordUserId } },
        create: { guildId: row.id, discordUserId: change.discordUserId, originalNickname: change.originalNickname, appliedNickname: change.nickname },
        update: { originalNickname: change.originalNickname, appliedNickname: change.nickname }
      });
      applied++;
    } catch { failed++; }
  }
  return { changes, applied, failed, skipped: null };
}

/** Puts one member's nickname back (only if it is still the one we set) and records the choice. Returns whether it was restored. */
export async function restoreNickname(prisma: PrismaClient, guild: Guild, guildId: string, discordUserId: string, optedOut: boolean | null): Promise<boolean> {
  const record = await prisma.memberNickname.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } } });
  let restored = false;
  if (record?.appliedNickname != null) {
    const member = guild.members.cache.get(discordUserId) ?? await guild.members.fetch(discordUserId).catch(() => null);
    if (member && member.nickname === record.appliedNickname && botCanRename(guild) && canRename(guild, member)) {
      restored = await member.setNickname(record.originalNickname, "Guilded nickname sync: restored").then(() => true, () => false);
    } else if (member && member.nickname !== record.appliedNickname) restored = true; // The member already changed it themselves.
    if (restored) await prisma.memberNickname.update({ where: { id: record.id }, data: { appliedNickname: null, ...(optedOut === null ? {} : { optedOut }) } });
    else if (optedOut !== null) await prisma.memberNickname.update({ where: { id: record.id }, data: { optedOut } });
    return restored;
  }
  if (optedOut !== null) {
    await prisma.memberNickname.upsert({ where: { guildId_discordUserId: { guildId, discordUserId } }, create: { guildId, discordUserId, optedOut }, update: { optedOut } });
  }
  return false;
}

/** The officer turned the sync off: every renamed member gets the previous nickname back. */
export async function restoreAllNicknames(prisma: PrismaClient, guild: Guild, guildId: string): Promise<number> {
  const records = await prisma.memberNickname.findMany({ where: { guildId, appliedNickname: { not: null } }, select: { discordUserId: true } });
  let restored = 0;
  for (const record of records) if (await restoreNickname(prisma, guild, guildId, record.discordUserId, null)) restored++;
  return restored;
}

// The scheduled run, next to the hourly rank roles.
export async function syncAllNicknames(prisma: PrismaClient, guilds: Iterable<Guild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) {
    await forEachGuildScope(prisma, guild.id, () => syncNicknames(prisma, guild)).catch(report);
  }
}
