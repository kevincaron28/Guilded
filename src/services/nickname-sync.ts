import { PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterName } from "./character-display.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";

// 8.5 track C2: nickname sync. Each member's server nickname becomes "Name (Main First Last)", where Name is the member's
// OWN server nickname when they set one (9.0, owner decision), else their global display name, else their username
// (the officer can pick another format), capped at 32
// characters. Turning the sync off restores everyone's previous nickname.
// The bot never renames the server owner, bots or anyone it cannot manage (a role above the bot's), and it
// remembers the original nickname (MemberNickname) so turning the feature off restores everyone.
// Owner decision, 10 November 2026: "reported" counts the same as "confirmed" everywhere except in a conflict between
// two members (character-move.ts). So ANY linked main renames, however it was linked (character-trust.ts only labels).

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

/**
 * Removes a trailing "(...)" that names one of the member's characters (full, first, or "First L." short form; case and
 * accents ignored), so our "(Main)" replaces it and can never double up. That covers a nickname kept from our rename and a
 * character the member typed in parentheses themselves (owner request, 7 Nov). Anything else in parentheses is theirs.
 */
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toLowerCase();

export function stripMainSuffix(nickname: string, mainName: string | null, earlier: readonly (string | null | undefined)[] = []): string {
  const clean = nickname.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!mainName && !earlier.length) return clean;
  const forms = new Set<string>();
  for (const name of [mainName, ...earlier]) {
    const main = fold(name ?? "");
    if (!main) continue;
    const words = main.split(" ");
    forms.add(main); forms.add(words[0]!); forms.add(words.length > 1 ? `${words[0]} ${words[words.length - 1]!.charAt(0)}.` : main);
  }
  let current = clean;
  for (;;) {
    const match = /^(.*?)\s*\(([^()]*)\)$/u.exec(current);
    if (!match || !forms.has(fold(match[2]!))) return current;
    current = match[1]!.trim();
  }
}

export interface NicknamePerson {
  discordUserId: string;
  /** Discord's global name or username, never the current server nickname. */
  accountName: string;
  /** Current server nickname (null: none). */
  nickname: string | null;
  mainName: string | null;
  /** Every character of the member in this edition: a trailing "(...)" naming any of them gives way to our suffix. */
  characterNames?: readonly string[];
  skip: boolean;
  record: { originalNickname: string | null; appliedNickname: string | null; optedOut: boolean } | null;
}
export interface NicknameChange { discordUserId: string; nickname: string; originalNickname: string | null }

export function planNicknames(people: readonly NicknamePerson[], format = DEFAULT_NICKNAME_FORMAT): NicknameChange[] {
  const changes: NicknameChange[] = [];
  for (const person of people) {
    if (person.skip || !person.mainName) continue; // an old opt-out flag is ignored: everyone is renamed
    // Our own earlier rename is not the member's nickname: their own one is the stored original. A different current
    // nickname is theirs (they changed it), so it becomes the new base and the new original. Either way a trailing "(main)"
    // is dropped before reuse, so the suffix can never double.
    const ours = person.record?.appliedNickname != null && person.nickname === person.record.appliedNickname;
    // A main that changed since our last rename leaves the old "(Main)" behind: it is stripped too.
    const earlier = [person.record?.appliedNickname?.match(/\(([^()]*)\)$/u)?.[1], ...(person.characterNames ?? [])];
    const raw = (ours ? person.record!.originalNickname : person.nickname)?.trim();
    const own = raw ? stripMainSuffix(raw, person.mainName, earlier) : "";
    const original = own || null;
    // Base name: their own server nickname, else the global display name, else the username (never the applied nickname).
    const target = nicknameFor(own || person.accountName, person.mainName, format);
    if (!target) continue;
    // Already right: nothing to rename, but a changed base is still written down (record only).
    if (target === person.nickname && person.record && person.record.originalNickname === original && person.record.appliedNickname === target) continue;
    if (target === person.nickname && !person.record) continue;
    changes.push({ discordUserId: person.discordUserId, nickname: target, originalNickname: original });
  }
  return changes;
}

// A member's main: the one marked main, else the first by name.
export function mainCharacter<T extends { name: string; displayName?: string | null; isMain: boolean }>(characters: readonly T[]): T | null {
  return [...characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || characterName(a).localeCompare(characterName(b)))[0] ?? null;
}
export function mainCharacterName(characters: readonly { name: string; displayName?: string | null; isMain: boolean }[]): string | null {
  const main = mainCharacter(characters);
  return main ? characterName(main) : null;
}

export const botCanRename = (guild: Guild) => Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames));
const canRename = (guild: Guild, member: GuildMember) => member.id !== guild.ownerId && !member.user.bot && member.manageable;

/** Cached members the bot could rename but cannot because their top role is at or above the bot's (for the /setup checklist). */
export const blockedMemberCount = (guild: Guild): number => guild.members.cache?.filter((member) => member.id !== guild.ownerId && !member.user.bot && !member.manageable).size ?? 0;

/** Why a sync did what it did: every member counted exactly once, so a quiet run can be explained from the log line. */
export interface NicknameSyncStats {
  /** Active, non-test members with a character in the server's edition. */
  eligible: number;
  /** Eligible members who are no longer in the Discord server. */
  notInServer: number;
  /** Not renamable: the owner, a bot, or a role at or above the bot's. */
  notManageable: number;
  /** Opted out, or no usable nickname (too long). */
  optedOutOrNoFit: number;
  /** Already carrying the right nickname. */
  upToDate: number;
}
const emptyStats = (): NicknameSyncStats => ({ eligible: 0, notInServer: 0, notManageable: 0, optedOutOrNoFit: 0, upToDate: 0 });

export interface NicknameSyncResult { changes: NicknameChange[]; applied: number; failed: number; skipped: string | null; stats: NicknameSyncStats }

export function describeNicknameSync(guildId: string, result: NicknameSyncResult | undefined): string {
  if (!result) return `Nickname sync ${guildId}: did not run (error reported)`;
  const { stats } = result;
  const reason = result.skipped ? `reason: ${result.skipped}` : result.changes.length ? "reason: changes made" : stats.eligible === 0 ? "reason: no eligible members" : "reason: nothing to change";
  return `Nickname sync ${guildId}: eligible ${stats.eligible}, planned ${result.changes.length}, renamed ${result.applied}, failed ${result.failed}, skipped (not manageable) ${stats.notManageable}, not in server ${stats.notInServer}, opted out/no fit ${stats.optedOutOrNoFit}, up to date ${stats.upToDate}; ${reason}`;
}

/** Which one member a sync is limited to (event-driven refresh): by Discord user id or by our member row id. */
export type OnlyMember = { discordUserId: string } | { memberId: string };
const onlyWhere = (only: OnlyMember | undefined) => !only ? {} : "memberId" in only ? { id: only.memberId } : { discordUserId: only.discordUserId };

// Nicknames the bot just wrote, so the GuildMemberUpdate our own rename causes does not start another refresh.
const ownNicknames = new Map<string, { nickname: string | null; at: number }>();
const OWN_NICKNAME_MS = 60_000;
export function noteOwnNickname(guildDiscordId: string, discordUserId: string, nickname: string | null, now = Date.now()): void {
  ownNicknames.set(`${guildDiscordId}:${discordUserId}`, { nickname, at: now });
  if (ownNicknames.size > 2000) for (const [key, value] of ownNicknames) if (now - value.at > OWN_NICKNAME_MS) ownNicknames.delete(key);
}
export function isOwnNickname(guildDiscordId: string, discordUserId: string, nickname: string | null, now = Date.now()): boolean {
  const seen = ownNicknames.get(`${guildDiscordId}:${discordUserId}`);
  return Boolean(seen && now - seen.at <= OWN_NICKNAME_MS && seen.nickname === nickname);
}

export async function syncNicknames(prisma: PrismaClient, guild: Guild, options: { dryRun?: boolean; only?: OnlyMember } = {}): Promise<NicknameSyncResult> {
  const none = (skipped: string | null): NicknameSyncResult => ({ changes: [], applied: 0, failed: 0, skipped, stats: emptyStats() });
  const row = await prisma.guild.findUnique({ where: guildWhere(guild.id), select: { id: true, gameEdition: true, settings: { select: { nicknameSyncEnabled: true, nicknameFormat: true } } } });
  if (!row) return none("This server is not set up yet.");
  if (row.settings?.nicknameSyncEnabled === false) return none("Nickname sync is off.");
  if (!botCanRename(guild)) return none(NICKNAME_PERMISSION_SKIP);
  const format = row.settings?.nicknameFormat && validNicknameFormat(row.settings?.nicknameFormat) ? row.settings?.nicknameFormat : DEFAULT_NICKNAME_FORMAT;
  const [members, records] = await Promise.all([
    prisma.member.findMany({
      where: { guildId: row.id, ...onlyWhere(options.only), status: "ACTIVE", isTest: false, characters: { some: { gameEdition: row.gameEdition ?? "forever" } } },
      select: { discordUserId: true, characters: { where: { gameEdition: row.gameEdition ?? "forever" },
        select: { id: true, memberId: true, name: true, displayName: true, realm: true, gameEdition: true, isMain: true, confirmedAt: true, linkEvidence: true } } }
    }),
    prisma.memberNickname.findMany({ where: { guildId: row.id, ...(options.only && "discordUserId" in options.only ? { discordUserId: options.only.discordUserId } : {}) } })
  ]);
  const byUser = new Map(records.map((record) => [record.discordUserId, record]));
  const people: NicknamePerson[] = [];
  const stats = emptyStats();
  stats.eligible = members.length;
  for (const member of members) {
    const discordMember = guild.members.cache.get(member.discordUserId) ?? await guild.members.fetch(member.discordUserId).catch(() => null);
    if (!discordMember) { stats.notInServer++; continue; }
    const main = mainCharacter(member.characters);
    people.push({ discordUserId: member.discordUserId, accountName: discordMember.user.globalName ?? discordMember.user.username, nickname: discordMember.nickname,
      mainName: main ? characterName(main) : null, characterNames: member.characters.map((character) => characterName(character)), skip: !canRename(guild, discordMember), record: byUser.get(member.discordUserId) ?? null });
  }
  const changes = planNicknames(people, format);
  stats.notManageable = people.filter((person) => person.skip).length;
  const planned = new Set(changes.map((change) => change.discordUserId));
  const rest = people.filter((person) => !person.skip && !planned.has(person.discordUserId));
  stats.optedOutOrNoFit = rest.filter((person) => !person.mainName || !nicknameFor(person.nickname ?? person.accountName, person.mainName, format)).length;
  stats.upToDate = rest.length - stats.optedOutOrNoFit;
  if (options.dryRun) return { changes, applied: 0, failed: 0, skipped: null, stats };
  let applied = 0, failed = 0;
  for (const change of changes) {
    const member = guild.members.cache.get(change.discordUserId);
    if (!member) { failed++; continue; }
    try {
      if (member.nickname !== change.nickname) { noteOwnNickname(guild.id, change.discordUserId, change.nickname); await member.setNickname(change.nickname, "Guilded nickname sync"); }
      await prisma.memberNickname.upsert({
        where: { guildId_discordUserId: { guildId: row.id, discordUserId: change.discordUserId } },
        create: { guildId: row.id, discordUserId: change.discordUserId, originalNickname: change.originalNickname, appliedNickname: change.nickname },
        update: { originalNickname: change.originalNickname, appliedNickname: change.nickname }
      });
      applied++;
    } catch { failed++; }
  }
  return { changes, applied, failed, skipped: null, stats };
}

/**
 * One member's nickname, right now (event-driven refresh): the same plan as the full pass, limited to this member, so it costs a
 * few small reads and at most one setNickname. Silent when the sync is off, the bot lacks Manage Nicknames, or the member is
 * the owner / a bot / above the bot's role (the hourly pass reports those). Never fetches the whole server.
 */
export function syncMemberNickname(prisma: PrismaClient, guild: Guild, who: string | { memberId: string }): Promise<NicknameSyncResult> {
  return syncNicknames(prisma, guild, { only: typeof who === "string" ? { discordUserId: who } : who });
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

/** The quiet outcomes (nothing changed) repeat every cycle: one line per server when it differs from the last one, or after a day. */
export const NICKNAME_LOG_REPEAT_MS = 24 * 60 * 60 * 1000;
const lastNicknameLines = new Map<string, { line: string; at: number }>();
export function shouldLogNicknameSync(guildId: string, line: string, result: NicknameSyncResult | undefined, now = Date.now()): boolean {
  const busy = !result || result.applied > 0 || result.failed > 0 || result.changes.length > 0;
  const last = lastNicknameLines.get(guildId);
  if (!busy && last && last.line === line && now - last.at < NICKNAME_LOG_REPEAT_MS) return false;
  lastNicknameLines.set(guildId, { line, at: now });
  return true;
}
export function resetNicknameLogThrottle(): void { lastNicknameLines.clear(); permissionNoted.clear(); }

// A server where the bot lacks Manage Nicknames is a setting, not an event: officers see it in /setup status
// ("Give the bot role the Manage Nicknames permission"). The log names those servers in ONE line, once per day
// (or when a new one joins the list), instead of one line per server.
export const NICKNAME_PERMISSION_SKIP = "I need the Manage Nicknames permission.";
const permissionNoted = new Map<string, number>();
export function permissionSkipLine(guildIds: string[], now = Date.now()): string | null {
  const fresh = guildIds.filter((id) => { const at = permissionNoted.get(id); return at === undefined || now - at >= NICKNAME_LOG_REPEAT_MS; });
  for (const id of [...permissionNoted.keys()]) if (!guildIds.includes(id)) permissionNoted.delete(id);
  if (!fresh.length) return null;
  for (const id of guildIds) permissionNoted.set(id, now);
  return `Nickname sync: waiting for the Manage Nicknames permission in ${guildIds.length} server(s) (shown in /setup start status:true): ${guildIds.join(", ")}`;
}

// The scheduled run, next to the hourly rank roles. A server with several in-game guilds is synced once per guild; the log line
// adds them up (the last guild alone used to be reported, so an empty one hid the rest).
export async function syncAllNicknames(prisma: PrismaClient, guilds: Iterable<Guild>, report: (error: unknown) => void, log: (line: string) => void = console.log): Promise<void> {
  const waitingForPermission: string[] = [];
  for (const guild of guilds) {
    const total: NicknameSyncResult = { changes: [], applied: 0, failed: 0, skipped: null, stats: emptyStats() };
    let ran = false;
    await forEachGuildScope(prisma, guild.id, async () => {
      const result = await syncNicknames(prisma, guild);
      ran = true;
      total.changes.push(...result.changes); total.applied += result.applied; total.failed += result.failed; total.skipped ??= result.skipped;
      for (const key of Object.keys(total.stats) as (keyof NicknameSyncStats)[]) total.stats[key] += result.stats[key];
    }).catch(report);
    // One line per server, always, so a quiet sync is explained in the logs.
    // (Repeats of an unchanged quiet outcome are held back: two small servers wrote the same line every cycle, 122 times in 48 h.)
    if (ran && total.skipped === NICKNAME_PERMISSION_SKIP && !total.changes.length) { waitingForPermission.push(guild.id); continue; }
    const line = describeNicknameSync(guild.id, ran ? total : undefined);
    if (shouldLogNicknameSync(guild.id, line, ran ? total : undefined)) log(line);
  }
  const waiting = permissionSkipLine(waitingForPermission);
  if (waiting) log(waiting);
}
