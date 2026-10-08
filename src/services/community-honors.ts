import { ChannelType, EmbedBuilder, PermissionFlagsBits, escapeMarkdown, type Guild, type OverwriteResolvable } from "discord.js";
import type { CommunityHonors, Prisma, PrismaClient } from "@prisma/client";
import { BRAND } from "../brand.js";
import { asLang, type Lang } from "../i18n.js";
import { COMMUNITY_CHANNEL_SPECS } from "../setup-names.js";
import { standings, type Standing } from "./community-rules.js";
import { communitySeasonLabel } from "./community-display.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { dateAfter, dayStart, participationWeek } from "./participation-rules.js";

// Community recognition, on top of the public Discord seasons:
// - every Monday (guild time), the weekly MVP role moves to whoever earned the most community
//   points in the week that just ended, and the hall-of-fame channel gets the winner and a
//   short recap of the guild's week;
// - when a monthly season ends, its top 3 get the gold, silver and bronze roles until the next
//   month ends, and the channel announces them.
// /setup creates the channel and the roles; the community job only moves roles and posts.

const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const PUBLIC_DISCORD = { game: "DISCORD", audienceRoleId: null } as const;
const NO_POSTING = PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads;
const BOT_POST = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;
const MEDALS = ["🥇", "🥈", "🥉"];

export const HONOR_ROLES: Record<Lang, { weekly: string; month: [string, string, string] }> = {
  en: { weekly: "⭐ MVP of the week", month: ["🥇 Champion of the month", "🥈 Runner-up of the month", "🥉 Third of the month"] },
  fr: { weekly: "⭐ MVP de la semaine", month: ["🥇 Champion du mois", "🥈 Deuxième du mois", "🥉 Troisième du mois"] }
};
const ROLE_COLORS = { weekly: 0x9b59b6, month: [0xf1c40f, 0xbdc3c7, 0xcd7f32] };

// Everyone tied for the most points (more than zero) shares the weekly role.
export function weeklyMvps(board: Standing[]): string[] {
  const best = Math.max(0, ...board.map(row => row.points));
  return best > 0 ? board.filter(row => row.points === best).map(row => row.userId) : [];
}

// Podium places as on the leaderboard: ties share a rank, so two tied for first are both gold
// and the next one is third.
export function podiumPlaces(board: Standing[]): [string[], string[], string[]] {
  const ranked = board.filter(row => row.points > 0);
  const places: [string[], string[], string[]] = [[], [], []];
  for (const row of ranked) {
    const rank = 1 + ranked.filter(other => other.points > row.points).length;
    if (rank <= 3) places[rank - 1]!.push(row.userId);
  }
  return places;
}

// The last complete Monday-to-Sunday week (guild time) still to announce, as its Monday, or null.
export function honorsWeekDue(now: Date, timezone: string, lastWeek: string | null): string | null {
  const week = dateAfter(participationWeek(now, timezone), -7);
  return !lastWeek || lastWeek < week ? week : null;
}

export interface WeekRecap {
  points: number; members: number; messages: number; reactions: number; voiceHours: number;
  activities: number; raids: number; bossKills: number; dungeonRuns: number; newMembers: number;
}

const ids = (value: Prisma.JsonValue, length: number): string[][] => {
  const rows = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, i) => Array.isArray(rows[i]) ? (rows[i] as unknown[]).filter((id): id is string => typeof id === "string") : []);
};
const strings = (value: Prisma.JsonValue | undefined): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
// Posts show names, never mentions (as the leaderboard does). Deliveries allow no mentions, so
// Discord sends no member data with the message, and a reader whose app has not seen that
// member yet would get "unknown user", in the text as in an embed.
export type Names = ReadonlyMap<string, string>;
const who = (names: Names, id: string) => `**${escapeMarkdown((names.get(id) || `…${id.slice(-4)}`).replace(/[\r\n]/g, " ").slice(0, 32))}**`;
const dayLabel = (lang: Lang, day: string) => new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

export function weeklyHonorsMessage(lang: Lang, input: { week: string; board: Standing[]; mvps: string[]; recap: WeekRecap; names?: Names }) {
  const names = input.names ?? new Map<string, string>();
  const n = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const { recap, mvps } = input;
  const first = dayLabel(lang, input.week), last = dayLabel(lang, dateAfter(input.week, 6));
  const top = input.board.filter(row => row.points > 0).slice(0, 3);
  const embed = new EmbedBuilder().setColor(ROLE_COLORS.weekly)
    .setTitle(say(lang, `⭐ The week of ${first} to ${last}`, `⭐ La semaine du ${first} au ${last}`))
    .setDescription(mvps.length
      ? say(lang, `**MVP of the week:** ${mvps.map(id => who(names, id)).join(", ")} with **${n(top[0]!.points)} pts**. The ${HONOR_ROLES.en.weekly} role is theirs until next Monday!`,
        `**MVP de la semaine :** ${mvps.map(id => who(names, id)).join(", ")} avec **${n(top[0]!.points)} pts**. Le rôle ${HONOR_ROLES.fr.weekly} est à eux jusqu’à lundi prochain !`)
      : say(lang, "Nobody earned community points this week, so the MVP role stays free. Next week is yours!", "Personne n’a gagné de points cette semaine : le rôle MVP reste libre. La semaine prochaine est à toi !"));
  if (top.length) embed.addFields({ name: say(lang, "🏆 Top of the week", "🏆 Le top de la semaine"),
    value: top.map((row, i) => `${MEDALS[i]} ${who(names, row.userId)} — **${n(row.points)} pts**`).join("\n") });
  const lines = [
    recap.points ? say(lang, `🎯 **${n(recap.points)} pts** earned by **${n(recap.members)}** members`, `🎯 **${n(recap.points)} pts** gagnés par **${n(recap.members)}** membres`) : "",
    recap.messages || recap.reactions ? say(lang, `💬 ${n(recap.messages)} messages · ${n(recap.reactions)} reactions`, `💬 ${n(recap.messages)} messages · ${n(recap.reactions)} réactions`) : "",
    recap.voiceHours ? say(lang, `🎙️ ${n(recap.voiceHours)} h together in voice`, `🎙️ ${n(recap.voiceHours)} h ensemble en vocal`) : "",
    recap.activities ? say(lang, `🎮 ${n(recap.activities)} community activities`, `🎮 ${n(recap.activities)} activités communautaires`) : "",
    recap.raids ? say(lang, `⚔️ ${n(recap.raids)} raids · ${n(recap.bossKills)} bosses down`, `⚔️ ${n(recap.raids)} raids · ${n(recap.bossKills)} boss vaincus`) : "",
    recap.dungeonRuns ? say(lang, `🗝️ ${n(recap.dungeonRuns)} dungeon runs`, `🗝️ ${n(recap.dungeonRuns)} donjons complétés`) : "",
    recap.newMembers ? say(lang, `👋 ${n(recap.newMembers)} new members`, `👋 ${n(recap.newMembers)} nouveaux membres`) : ""
  ].filter(Boolean);
  if (lines.length) embed.addFields({ name: say(lang, "📊 The guild's week", "📊 La semaine de la guilde"), value: lines.join("\n") });
  embed.setFooter({ text: say(lang, "Guilded · Hall of fame", "Guilded · Palmarès") });
  return { content: mvps.length ? say(lang, `⭐ Congratulations ${mvps.map(id => who(names, id)).join(", ")}!`, `⭐ Bravo ${mvps.map(id => who(names, id)).join(", ")} !`) : "", embeds: [embed.toJSON()] };
}

export function monthlyHonorsMessage(lang: Lang, season: { name: string; number: number }, board: Standing[], names: Names = new Map()) {
  const places = podiumPlaces(board);
  const points = new Map(board.map(row => [row.userId, row.points]));
  const n = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const embed = new EmbedBuilder().setColor(ROLE_COLORS.month[0]!)
    .setTitle(say(lang, `🏆 Top 3 of ${communitySeasonLabel(season, lang)}`, `🏆 Le top 3 de la ${communitySeasonLabel(season, lang)}`))
    .setDescription(places.map((winners, i) => winners.length ? `${MEDALS[i]} ${winners.map(id => who(names, id)).join(", ")} — **${n(points.get(winners[0]!) ?? 0)} pts** · ${HONOR_ROLES[lang].month[i]}` : "").filter(Boolean).join("\n"))
    .addFields({ name: say(lang, "✨ Well played", "✨ Bien joué"), value: say(lang,
      "They keep their podium role until the end of next month. A new season has started: everyone is back at zero!",
      "Ils gardent leur rôle du podium jusqu’à la fin du mois prochain. Une nouvelle saison commence : tout le monde repart à zéro !") })
    .setFooter({ text: say(lang, "Guilded · Hall of fame", "Guilded · Palmarès") });
  return { content: say(lang, `🏆 Congratulations to the community's top 3: ${places.flat().map(id => who(names, id)).join(", ")}!`, `🏆 Bravo au top 3 de la gang : ${places.flat().map(id => who(names, id)).join(", ")} !`), embeds: [embed.toJSON()] };
}

// /setup: the hall-of-fame channel (in the Community category, read-only for members, same
// visibility as the category) and the four roles. Existing ones are reused, even renamed.
export async function ensureCommunityHonors(guild: Guild, database: PrismaClient, guildId: string, lang: Lang, categoryId: string): Promise<string[]> {
  const me = guild.members.me;
  if (!me) throw new Error("Bot member unavailable.");
  const reason = `${BRAND.name} /setup`;
  const created: string[] = [];
  const current = await database.communityHonors.findUnique({ where: { guildId } });
  const names = [COMMUNITY_CHANNEL_SPECS.en.honors.name, COMMUNITY_CHANNEL_SPECS.fr.honors.name];
  let channel = (current?.channelId ? guild.channels.cache.get(current.channelId) : undefined)
    ?? guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.parentId === categoryId && names.includes(c.name));
  if (!channel) {
    const category = guild.channels.cache.get(categoryId);
    const overwrites = new Map<string, { id: string; type: number; allow: bigint; deny: bigint }>();
    if (category && "permissionOverwrites" in category) for (const o of category.permissionOverwrites.cache.values()) overwrites.set(o.id, { id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield });
    const entry = (id: string, type: number) => { const found = overwrites.get(id) ?? { id, type, allow: 0n, deny: 0n }; overwrites.set(id, found); return found; };
    for (const o of overwrites.values()) o.allow &= ~NO_POSTING;
    const everyone = entry(guild.roles.everyone.id, 0);
    everyone.deny |= NO_POSTING;
    const bot = entry(me.id, 1);
    bot.allow |= BOT_POST; bot.deny &= ~BOT_POST;
    const spec = COMMUNITY_CHANNEL_SPECS[lang].honors;
    channel = await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, topic: spec.topic, parent: categoryId, permissionOverwrites: [...overwrites.values()] as OverwriteResolvable[], reason });
    created.push(`<#${channel.id}>`);
  }

  const role = async (id: string | null | undefined, wanted: [string, string], color: number) => {
    const found = (id ? guild.roles.cache.get(id) : undefined) ?? guild.roles.cache.find(r => wanted.includes(r.name));
    if (found) return found.id;
    const made = await guild.roles.create({ name: wanted[lang === "fr" ? 1 : 0], colors: { primaryColor: color }, mentionable: false, reason });
    created.push(`<@&${made.id}>`);
    return made.id;
  };
  const weeklyRoleId = await role(current?.weeklyRoleId, [HONOR_ROLES.en.weekly, HONOR_ROLES.fr.weekly], ROLE_COLORS.weekly);
  const stored = strings(current?.monthRoleIds);
  const monthRoleIds: string[] = [];
  for (let i = 0; i < 3; i++) monthRoleIds.push(await role(stored[i], [HONOR_ROLES.en.month[i]!, HONOR_ROLES.fr.month[i]!], ROLE_COLORS.month[i]!));
  const data = { channelId: channel.id, weeklyRoleId, monthRoleIds };
  await database.communityHonors.upsert({ where: { guildId }, create: { guildId, ...data }, update: { ...data, rolesPending: true } });
  return created;
}

// Servers whose community section was set up before the honors existed get them once, at
// startup, without anyone running /setup again. A server without a single Community category or
// a public Discord season is left for /setup.
export async function adoptCommunityHonors(guild: Guild, database: PrismaClient): Promise<string[] | null> {
  const record = await database.guild.findUnique({ where: { discordId: guild.id }, include: { settings: true, communityHonors: true } });
  if (!record || record.communityHonors) return null;
  if (!await database.communitySeason.findFirst({ where: { guildId: record.id, ...PUBLIC_DISCORD } })) return null;
  await guild.channels.fetch();
  await guild.roles.fetch();
  const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory && /community|communaut/i.test(c.name));
  if (categories.size !== 1) return null;
  return ensureCommunityHonors(guild, database, record.id, asLang(record.settings?.language), categories.first()!.id);
}

async function weekRecap(tx: Prisma.TransactionClient, guildId: string, week: string, timezone: string, board: Standing[]): Promise<WeekRecap> {
  const window = { gte: dayStart(week, timezone), lt: dayStart(dateAfter(week, 7), timezone) };
  const season = { guildId, ...PUBLIC_DISCORD };
  const [days, activities, raids, dungeonRuns, newMembers] = await Promise.all([
    tx.communityParticipationDay.findMany({ where: { season, day: { gte: week, lt: dateAfter(week, 7) } }, select: { messages: true, reactions: true, voiceMs: true } }),
    tx.communityActivity.count({ where: { season, kind: { not: "DICE" }, status: { notIn: ["OPEN", "CANCELLED"] }, endsAt: window } }),
    tx.raid.findMany({ where: { guildId, status: "COMPLETED", isTest: false, endedAt: window }, select: { bosses: { select: { status: true } } } }),
    tx.dungeonRun.count({ where: { guildId, valid: true, createdAt: window } }),
    tx.member.count({ where: { guildId, isTest: false, createdAt: window } })
  ]);
  const ranked = board.filter(row => row.points > 0);
  return {
    points: ranked.reduce((sum, row) => sum + row.points, 0), members: ranked.length,
    messages: days.reduce((sum, d) => sum + d.messages, 0), reactions: days.reduce((sum, d) => sum + d.reactions, 0),
    voiceHours: Math.round(days.reduce((sum, d) => sum + d.voiceMs, 0) / 3_600_000), activities,
    raids: raids.length, bossKills: raids.reduce((sum, r) => sum + r.bosses.filter(b => b.status === "KILLED").length, 0), dungeonRuns, newMembers
  };
}

// Looking up a few names from Discord happens inside the transaction, hence the longer timeout.
const locked = <T>(database: PrismaClient, guildId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => database.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`community-honors:${guildId}`}))`;
  return work(tx);
}, { timeout: 60_000 });

export type NameLookup = (ids: string[]) => Promise<Names>;
// Server nickname, else Discord display name, one REST call per member not already cached.
export const discordNames = (guild: Guild): NameLookup => async ids => {
  const names = new Map<string, string>();
  for (const id of ids) {
    const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    const name = member?.displayName ?? (await guild.client.users.fetch(id).catch(() => null))?.displayName;
    if (name) names.set(id, name);
  }
  return names;
};

// Decides the new holders and queues the announcements. Each week and each season is handled
// once: the decision and its message are saved together.
export async function advanceCommunityHonors(database: PrismaClient, guildId: string, now = new Date(), lookup: NameLookup = async () => new Map()): Promise<{ week: string | null; seasonId: string | null }> {
  return locked(database, guildId, async tx => {
    const honors = await tx.communityHonors.findUnique({ where: { guildId } });
    if (!honors) return { week: null, seasonId: null };
    const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { timezone: true, language: true } });
    const timezone = settings?.timezone ?? "America/Toronto", lang = asLang(settings?.language);
    const result = { week: null as string | null, seasonId: null as string | null };

    const week = honorsWeekDue(now, timezone, honors.week);
    if (week) {
      const rows = await tx.communityPoint.findMany({ where: { season: { guildId, ...PUBLIC_DISCORD }, createdAt: { gte: dayStart(week, timezone), lt: dayStart(dateAfter(week, 7), timezone) } }, select: { userId: true, kind: true, amount: true } });
      const board = standings(rows);
      const mvps = weeklyMvps(board);
      const recap = await weekRecap(tx, guildId, week, timezone, board);
      await tx.communityHonors.update({ where: { guildId }, data: { week, weeklyHolderIds: mvps, rolesPending: true } });
      // A silent week only frees the role; there is nothing to announce.
      if (honors.channelId && Object.values(recap).some(Boolean)) {
        await enqueueDiscordJob(tx, guildId, `community-week:${week}`, "MESSAGE", { channelId: honors.channelId, message: JSON.parse(JSON.stringify(weeklyHonorsMessage(lang, { week, board, mvps, recap, names: await lookup(board.filter(r => r.points > 0).slice(0, 3).map(r => r.userId)) }))) });
      }
      result.week = week;
    }

    const ended = await tx.communitySeason.findFirst({ where: { guildId, ...PUBLIC_DISCORD, monthly: true, status: "ENDED" }, orderBy: [{ endedAt: "desc" }, { id: "desc" }] });
    if (ended && ended.id !== honors.monthSeasonId) {
      const board = (ended.finalStandings ?? []) as unknown as Standing[];
      const places = podiumPlaces(board);
      await tx.communityHonors.update({ where: { guildId }, data: { monthSeasonId: ended.id, monthHolderIds: places, rolesPending: true } });
      if (honors.channelId && places[0].length) {
        await enqueueDiscordJob(tx, guildId, `community-month:${ended.id}`, "MESSAGE", { channelId: honors.channelId, message: JSON.parse(JSON.stringify(monthlyHonorsMessage(lang, ended, board, await lookup(places.flat())))) });
      }
      result.seasonId = ended.id;
    }
    return result;
  });
}

// Makes the Discord roles match the saved holders: whoever has a role without holding it loses
// it, the holders get it. Members who left are skipped.
export async function syncCommunityHonorRoles(guild: Guild, database: PrismaClient, honors: CommunityHonors): Promise<void> {
  const plan: [string | null, string[]][] = [[honors.weeklyRoleId, strings(honors.weeklyHolderIds)]];
  const roles = strings(honors.monthRoleIds), holders = ids(honors.monthHolderIds, 3);
  for (let i = 0; i < 3; i++) plan.push([roles[i] ?? null, holders[i]!]);
  const reason = `${BRAND.name}: community honors`;
  await guild.members.fetch();
  for (const [roleId, wanted] of plan) {
    const role = roleId ? guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null) : null;
    if (!role) continue;
    const keep = new Set(wanted);
    for (const member of role.members.values()) if (!keep.has(member.id)) await member.roles.remove(role, reason);
    for (const id of keep) {
      const member = guild.members.cache.get(id);
      if (member && !member.roles.cache.has(role.id)) await member.roles.add(role, reason);
    }
  }
  // A newer decision made meanwhile keeps the flag for the next pass.
  await database.communityHonors.updateMany({ where: { guildId: honors.guildId, updatedAt: honors.updatedAt }, data: { rolesPending: false } });
}

// A role sync that keeps failing (missing Manage Roles, role above the bot) retries every 15 minutes.
const lastSyncAttempt = new Map<string, number>();
export async function runCommunityHonors(guild: Guild, database: PrismaClient, guildId: string, now = new Date()): Promise<void> {
  await advanceCommunityHonors(database, guildId, now, discordNames(guild));
  const honors = await database.communityHonors.findUnique({ where: { guildId } });
  if (!honors?.rolesPending || now.getTime() - (lastSyncAttempt.get(guildId) ?? 0) < 15 * 60_000) return;
  lastSyncAttempt.set(guildId, now.getTime());
  await syncCommunityHonorRoles(guild, database, honors);
  lastSyncAttempt.delete(guildId);
}
