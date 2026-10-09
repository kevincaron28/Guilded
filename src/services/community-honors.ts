import { ChannelType, EmbedBuilder, PermissionFlagsBits, escapeMarkdown, type Guild, type OverwriteResolvable } from "discord.js";
import type { CommunityHonors, Prisma, PrismaClient } from "@prisma/client";
import { BRAND } from "../brand.js";
import { asLang, type Lang } from "../i18n.js";
import { COMMUNITY_CHANNEL_SPECS } from "../setup-names.js";
import { standings, type Standing } from "./community-rules.js";
import { communitySeasonLabel } from "./community-display.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { dateAfter, dayStart, participationDay, participationWeek } from "./participation-rules.js";
import { monthlyRookie, rookieMemberLookup, ROOKIE_ROLE, type MonthlyRookie, type RookieMemberLookup } from "./monthly-rookie.js";
import { weekStart as resetWeekStart } from "./dungeon-rules.js";

// Community recognition, on top of the public Discord seasons:
// - every week (Monday guild time, or the WoW reset), the weekly MVP role moves to whoever
//   earned the most community points in the week that just ended, and the hall-of-fame channel
//   gets the winner and a short recap of the guild's week;
// - when a monthly season ends, its top 3 get the gold, silver and bronze roles until the next
//   month ends, alongside a once-per-member Rookie of the Month award.
// Every award is kept (CommunityHonorAward) for "3rd time MVP" and /community honors.
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

// "MONDAY": Monday to Sunday, guild time. "RESET": from one WoW weekly reset to the next
// (Tuesday 15:00 UTC, as the dungeon and raid weeks).
export type WeekMode = "MONDAY" | "RESET";
export const weekMode = (value: string | null | undefined): WeekMode => value === "RESET" ? "RESET" : "MONDAY";

// A week is named by its first day ("YYYY-MM-DD"): its Monday, or the date of its reset.
export function honorsWeekOf(now: Date, timezone: string, mode: WeekMode = "MONDAY"): string {
  return mode === "RESET" ? resetWeekStart(now).toISOString().slice(0, 10) : participationWeek(now, timezone);
}

export function honorsWindow(week: string, timezone: string, mode: WeekMode = "MONDAY"): { start: Date; end: Date } {
  if (mode === "RESET") { const start = new Date(`${week}T15:00:00Z`); return { start, end: new Date(start.getTime() + 7 * 86_400_000) }; }
  return { start: dayStart(week, timezone), end: dayStart(dateAfter(week, 7), timezone) };
}

// The last complete week still to announce, or null.
export function honorsWeekDue(now: Date, timezone: string, lastWeek: string | null, mode: WeekMode = "MONDAY"): string | null {
  const week = dateAfter(honorsWeekOf(now, timezone, mode), -7);
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

// "2nd", "3rd"… / "2e", "3e"…
const ordinal = (lang: Lang, value: number) => lang === "fr" ? `${value}e`
  : `${value}${[11, 12, 13].includes(value % 100) ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th"}`;

export interface WeeklyMessageInput {
  week: string; board: Standing[]; mvps: string[]; recap: WeekRecap; names?: Names;
  rookie?: Standing | null;
  // MVP titles won so far, this week included.
  mvpCounts?: ReadonlyMap<string, number>;
  // The MVP is notified: the text mentions them (the delivery allows exactly those users).
  ping?: boolean;
  mode?: WeekMode;
  // Officer preview of the week in progress.
  partial?: boolean;
}

export function weeklyHonorsMessage(lang: Lang, input: WeeklyMessageInput) {
  const names = input.names ?? new Map<string, string>();
  const n = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const { recap, mvps } = input;
  const first = dayLabel(lang, input.week), last = dayLabel(lang, dateAfter(input.week, 6));
  const top = input.board.filter(row => row.points > 0).slice(0, 3);
  const times = (id: string) => {
    const count = input.mvpCounts?.get(id) ?? 1;
    return count > 1 ? say(lang, ` (${ordinal(lang, count)} time!)`, ` (${ordinal(lang, count)} fois !)`) : "";
  };
  const until = input.mode === "RESET" ? say(lang, "the next weekly reset", "la prochaine réinitialisation") : say(lang, "next Monday", "lundi prochain");
  const mvpList = mvps.map(id => `${who(names, id)}${times(id)}`).join(", ");
  const embed = new EmbedBuilder().setColor(ROLE_COLORS.weekly)
    .setTitle(say(lang, `⭐ The week of ${first} to ${last}`, `⭐ La semaine du ${first} au ${last}`) + (input.partial ? say(lang, " (so far)", " (jusqu’ici)") : ""))
    .setDescription(mvps.length
      ? say(lang, `**MVP of the week:** ${mvpList} with **${n(top[0]!.points)} pts**. The ${HONOR_ROLES.en.weekly} role is theirs until ${until}!`,
        `**MVP de la semaine :** ${mvpList} avec **${n(top[0]!.points)} pts**. Le rôle ${HONOR_ROLES.fr.weekly} est à eux jusqu’à ${until} !`)
      : say(lang, "Nobody earned community points this week, so the MVP role stays free. Next week is yours!", "Personne n’a gagné de points cette semaine : le rôle MVP reste libre. La semaine prochaine est à toi !"));
  if (top.length) embed.addFields({ name: say(lang, "🏆 Top of the week", "🏆 Le top de la semaine"),
    value: top.map((row, i) => `${MEDALS[i]} ${who(names, row.userId)} — **${n(row.points)} pts**`).join("\n") });
  if (input.rookie) embed.addFields({ name: say(lang, "🌱 Rookie of the week", "🌱 Recrue de la semaine"),
    value: say(lang, `${who(names, input.rookie.userId)} — **${n(input.rookie.points)} pts**, new to the community. Welcome!`,
      `${who(names, input.rookie.userId)} — **${n(input.rookie.points)} pts**, nouveau dans la gang. Bienvenue !`) });
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
  const winners = mvps.map(id => input.ping ? `${who(names, id)} (<@${id}>)` : who(names, id)).join(", ");
  return { content: mvps.length && !input.partial ? say(lang, `⭐ Congratulations ${winners}!`, `⭐ Bravo ${winners} !`) : "", embeds: [embed.toJSON()] };
}

export function monthlyHonorsMessage(lang: Lang, season: { name: string; number: number }, board: Standing[], names: Names = new Map(), rookie: MonthlyRookie | null = null) {
  const places = podiumPlaces(board);
  const points = new Map(board.map(row => [row.userId, row.points]));
  const n = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const embed = new EmbedBuilder().setColor(ROLE_COLORS.month[0]!)
    .setTitle(say(lang, `🏆 Top 3 of ${communitySeasonLabel(season, lang)}`, `🏆 Le top 3 de la ${communitySeasonLabel(season, lang)}`))
    .setDescription(places.map((winners, i) => winners.length ? `${MEDALS[i]} ${winners.map(id => who(names, id)).join(", ")} — **${n(points.get(winners[0]!) ?? 0)} pts** · ${HONOR_ROLES[lang].month[i]}` : "").filter(Boolean).join("\n") || say(lang, "No podium this month.", "Aucun podium ce mois-ci."))
    .addFields({ name: say(lang, "✨ Well played", "✨ Bien joué"), value: say(lang,
      "They keep their podium role until the end of next month. A new season has started: everyone is back at zero!",
      "Ils gardent leur rôle du podium jusqu’à la fin du mois prochain. Une nouvelle saison commence : tout le monde repart à zéro !") })
    .setFooter({ text: say(lang, "Guilded · Hall of fame", "Guilded · Palmarès") });
  if (rookie) embed.addFields({ name: ROOKIE_ROLE[lang], value: say(lang,
    `${who(names, rookie.userId)} — **${n(rookie.points)} pts** across **${rookie.activeDays} active days**. ${n(rookie.messages)} messages · ${n(rookie.reactions)} reactions · ${n(rookie.voiceHours)} h in voice. They hold the role until the next monthly award!`,
    `${who(names, rookie.userId)} — **${n(rookie.points)} pts**, **${rookie.activeDays} jours actifs**. ${n(rookie.messages)} messages · ${n(rookie.reactions)} réactions · ${n(rookie.voiceHours)} h en vocal. Le rôle est à toi jusqu’au prochain palmarès mensuel !`) });
  return { content: say(lang, `🏆 Congratulations to the community's top 3: ${places.flat().map(id => who(names, id)).join(", ")}!`, `🏆 Bravo au top 3 de la gang : ${places.flat().map(id => who(names, id)).join(", ")} !`), embeds: [embed.toJSON()] };
}

export interface HonorsHistory {
  recent: { kind: string; period: string; userId: string; points: number | null }[];
  champions: { userId: string; wins: number }[];
  podium: { place: number; userId: string; points: number | null }[];
  monthlyRookie?: { userId: string; points: number | null } | null;
}

// /community honors: recent weekly winners, the most MVP titles and the last monthly podium.
export function honorsHistoryMessage(lang: Lang, history: HonorsHistory, names: Names = new Map()) {
  const n = (value: number | null) => value === null ? "" : ` — **${value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA")} pts**`;
  const embed = new EmbedBuilder().setColor(ROLE_COLORS.weekly).setTitle(say(lang, "🏅 Hall of fame", "🏅 Palmarès"));
  const weeks = [...new Set(history.recent.map(row => row.period))].slice(0, 8);
  embed.setDescription(weeks.map(week => {
    const rows = history.recent.filter(row => row.period === week);
    const mvp = rows.filter(row => row.kind === "WEEK").map(row => `⭐ ${who(names, row.userId)}${n(row.points)}`).join(", ");
    const rookie = rows.filter(row => row.kind === "ROOKIE").map(row => `🌱 ${who(names, row.userId)}`).join(", ");
    return `**${dayLabel(lang, week)}** · ${[mvp, rookie].filter(Boolean).join(" · ")}`;
  }).join("\n") || say(lang, "No weekly MVP yet. The first one is announced after the first complete week.", "Pas encore de MVP. Le premier est annoncé après la première semaine complète."));
  if (history.champions.length) embed.addFields({ name: say(lang, "👑 Most MVP titles", "👑 Le plus de titres MVP"),
    value: history.champions.map(row => `${who(names, row.userId)} — ${row.wins}×`).join("\n") });
  if (history.podium.length) embed.addFields({ name: say(lang, "🏆 Last monthly podium", "🏆 Dernier podium du mois"),
    value: history.podium.map(row => `${MEDALS[row.place - 1] ?? ""} ${who(names, row.userId)}${n(row.points)}`).join("\n") });
  if (history.monthlyRookie) embed.addFields({ name: ROOKIE_ROLE[lang], value: `${who(names, history.monthlyRookie.userId)}${n(history.monthlyRookie.points)}` });
  return { embeds: [embed.toJSON()] };
}

// /setup: the hall-of-fame channel (in the Community category, read-only for members, same
// visibility as the category) and the five roles. Existing ones are reused, even renamed.
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
    const made = await guild.roles.create({ name: wanted[lang === "fr" ? 1 : 0], colors: { primaryColor: color }, permissions: [], mentionable: false, reason });
    created.push(`<@&${made.id}>`);
    return made.id;
  };
  const weeklyRoleId = await role(current?.weeklyRoleId, [HONOR_ROLES.en.weekly, HONOR_ROLES.fr.weekly], ROLE_COLORS.weekly);
  const stored = strings(current?.monthRoleIds);
  const monthRoleIds: string[] = [];
  for (let i = 0; i < 3; i++) monthRoleIds.push(await role(stored[i], [HONOR_ROLES.en.month[i]!, HONOR_ROLES.fr.month[i]!], ROLE_COLORS.month[i]!));
  const rookieRoleId = await role(current?.rookieRoleId, [ROOKIE_ROLE.en, ROOKIE_ROLE.fr], 0x2ecc71);
  const data = { channelId: channel.id, weeklyRoleId, monthRoleIds, rookieRoleId };
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

async function weekRecap(tx: Db, guildId: string, window: { start: Date; end: Date }, timezone: string, board: Standing[]): Promise<WeekRecap> {
  const range = { gte: window.start, lt: window.end };
  const season = { guildId, ...PUBLIC_DISCORD };
  // Participation is counted per guild-time day; a reset week takes the days it touches.
  const days = { gte: participationDay(window.start, timezone), lt: participationDay(window.end, timezone) };
  const [participation, activities, raids, dungeonRuns, newMembers] = await Promise.all([
    tx.communityParticipationDay.findMany({ where: { season, day: days }, select: { messages: true, reactions: true, voiceMs: true } }),
    tx.communityActivity.count({ where: { season, kind: { not: "DICE" }, status: { notIn: ["OPEN", "CANCELLED"] }, endsAt: range } }),
    tx.raid.findMany({ where: { guildId, status: "COMPLETED", isTest: false, endedAt: range }, select: { bosses: { select: { status: true } } } }),
    tx.dungeonRun.count({ where: { guildId, valid: true, createdAt: range } }),
    tx.member.count({ where: { guildId, isTest: false, createdAt: range } })
  ]);
  const ranked = board.filter(row => row.points > 0);
  return {
    points: ranked.reduce((sum, row) => sum + row.points, 0), members: ranked.length,
    messages: participation.reduce((sum, d) => sum + d.messages, 0), reactions: participation.reduce((sum, d) => sum + d.reactions, 0),
    voiceHours: Math.round(participation.reduce((sum, d) => sum + d.voiceMs, 0) / 3_600_000), activities,
    raids: raids.length, bossKills: raids.reduce((sum, r) => sum + r.bosses.filter(b => b.status === "KILLED").length, 0), dungeonRuns, newMembers
  };
}

type Db = Prisma.TransactionClient;

// Everything a weekly post shows, for a finished week or (preview) the week so far.
async function summarizeWeek(tx: Db, guildId: string, window: { start: Date; end: Date }, timezone: string) {
  const rows = await tx.communityPoint.findMany({ where: { season: { guildId, ...PUBLIC_DISCORD }, createdAt: { gte: window.start, lt: window.end } }, select: { userId: true, kind: true, amount: true } });
  const board = standings(rows);
  const mvps = weeklyMvps(board);
  return { board, mvps, rookie: null, recap: await weekRecap(tx, guildId, window, timezone, board) };
}

// MVP titles per member, including the current week when it is not saved yet.
async function mvpCounts(tx: Db, guildId: string, mvps: string[], plusOne: boolean): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const userId of mvps) counts.set(userId, await tx.communityHonorAward.count({ where: { guildId, kind: "WEEK", userId } }) + (plusOne ? 1 : 0));
  return counts;
}

const names3 = (summary: { board: Standing[]; rookie: Standing | null }) =>
  [...new Set([...summary.board.filter(row => row.points > 0).slice(0, 3).map(row => row.userId), ...(summary.rookie ? [summary.rookie.userId] : [])])];

// Looking up a few names from Discord happens inside the transaction, hence the longer timeout.
const locked = <T>(database: PrismaClient, guildId: string, work: (tx: Db) => Promise<T>) => database.$transaction(async tx => {
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

const SNOWFLAKE = /^\d{17,20}$/;

// Decides the new holders, records the awards and queues the announcements. Each week and each
// season is handled once: the decision, the history and the message are saved together.
export async function advanceCommunityHonors(database: PrismaClient, guildId: string, now = new Date(), lookup: NameLookup = async () => new Map(), memberLookup: RookieMemberLookup = async () => null): Promise<{ week: string | null; seasonId: string | null }> {
  return locked(database, guildId, async tx => {
    const honors = await tx.communityHonors.findUnique({ where: { guildId } });
    if (!honors) return { week: null, seasonId: null };
    const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { timezone: true, language: true } });
    const timezone = settings?.timezone ?? "America/Toronto", lang = asLang(settings?.language);
    const mode = weekMode(honors.weekStart);
    const result = { week: null as string | null, seasonId: null as string | null };

    const week = honorsWeekDue(now, timezone, honors.week, mode);
    if (week && honors.weeklyEnabled === false) {
      // Turned off: the role is freed and nothing is announced or recorded.
      await tx.communityHonors.update({ where: { guildId }, data: { week, weeklyHolderIds: [], rolesPending: true } });
      result.week = week;
    } else if (week) {
      const summary = await summarizeWeek(tx, guildId, honorsWindow(week, timezone, mode), timezone);
      const { board, mvps, rookie, recap } = summary;
      const points = new Map(board.map(row => [row.userId, row.points]));
      await tx.communityHonors.update({ where: { guildId }, data: { week, weeklyHolderIds: mvps, rolesPending: true } });
      await tx.communityHonorAward.createMany({ skipDuplicates: true, data: [
        ...mvps.map(userId => ({ guildId, kind: "WEEK", period: week, userId, points: points.get(userId) ?? null }))
      ] });
      // A silent week only frees the role; there is nothing to announce.
      if (honors.channelId && Object.values(recap).some(Boolean)) {
        const ping = honors.pingMvp && mvps.length > 0;
        const message = weeklyHonorsMessage(lang, { week, board, mvps, recap, rookie, mode, ping, mvpCounts: await mvpCounts(tx, guildId, mvps, false), names: await lookup(names3(summary)) });
        await enqueueDiscordJob(tx, guildId, `community-week:${week}`, "MESSAGE", { channelId: honors.channelId, message: JSON.parse(JSON.stringify(message)),
          ...(ping ? { mentionUsers: mvps.filter(id => SNOWFLAKE.test(id)) } : {}) });
      }
      result.week = week;
    }

    const ended = await tx.communitySeason.findFirst({ where: { guildId, ...PUBLIC_DISCORD, monthly: true, status: "ENDED" }, orderBy: [{ endedAt: "desc" }, { id: "desc" }] });
    if (ended && ended.id !== honors.monthSeasonId) {
      const board = (ended.finalStandings ?? []) as unknown as Standing[];
      const places = podiumPlaces(board);
      const rookie = await monthlyRookie(tx, guildId, ended, board, timezone, memberLookup);
      const points = new Map(board.map(row => [row.userId, row.points]));
      await tx.communityHonors.update({ where: { guildId }, data: { monthSeasonId: ended.id, monthHolderIds: places, rookieHolderId: rookie?.userId ?? null, rolesPending: true } });
      await tx.communityHonorAward.createMany({ skipDuplicates: true, data: places.flatMap((ids, i) => ids.map(userId => ({ guildId, kind: "MONTH", period: ended.id, place: i + 1, userId, points: points.get(userId) ?? null }))) });
      if (rookie) await tx.communityHonorAward.createMany({ skipDuplicates: true, data: [{ guildId, kind: "MONTH_ROOKIE", period: ended.id, userId: rookie.userId, points: rookie.points }] });
      if (honors.channelId && (places[0].length || rookie)) {
        await enqueueDiscordJob(tx, guildId, `community-month:${ended.id}`, "MESSAGE", { channelId: honors.channelId, message: JSON.parse(JSON.stringify(monthlyHonorsMessage(lang, ended, board, await lookup([...new Set([...places.flat(), ...(rookie ? [rookie.userId] : [])])]), rookie))) });
      }
      result.seasonId = ended.id;
    }
    return result;
  });
}

// Officer preview: the post as it would look if the week ended now. Nothing is saved.
export async function previewCommunityHonors(database: PrismaClient, guildId: string, now = new Date(), lookup: NameLookup = async () => new Map()) {
  const honors = await database.communityHonors.findUnique({ where: { guildId } });
  if (!honors) return null;
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { timezone: true, language: true } });
  const timezone = settings?.timezone ?? "America/Toronto", lang = asLang(settings?.language);
  const mode = weekMode(honors.weekStart);
  const week = honorsWeekOf(now, timezone, mode);
  const summary = await summarizeWeek(database, guildId, { start: honorsWindow(week, timezone, mode).start, end: now }, timezone);
  return weeklyHonorsMessage(lang, { week, ...summary, mode, partial: true, mvpCounts: await mvpCounts(database, guildId, summary.mvps, true), names: await lookup(names3(summary)) });
}

export async function communityHonorsHistory(database: PrismaClient, guildId: string): Promise<HonorsHistory> {
  const recent = await database.communityHonorAward.findMany({ where: { guildId, kind: { in: ["WEEK", "ROOKIE"] } }, orderBy: [{ period: "desc" }, { kind: "desc" }], take: 24, select: { kind: true, period: true, userId: true, points: true } });
  const wins = await database.communityHonorAward.groupBy({ by: ["userId"], where: { guildId, kind: "WEEK" }, _count: { _all: true } });
  const lastMonth = await database.communityHonorAward.findFirst({ where: { guildId, kind: "MONTH" }, orderBy: { createdAt: "desc" }, select: { period: true } });
  const podium = lastMonth ? await database.communityHonorAward.findMany({ where: { guildId, kind: "MONTH", period: lastMonth.period }, orderBy: [{ place: "asc" }, { userId: "asc" }], select: { place: true, userId: true, points: true } }) : [];
  const champions = wins.map(row => ({ userId: row.userId, wins: row._count._all })).sort((a, b) => b.wins - a.wins || a.userId.localeCompare(b.userId)).slice(0, 5);
  const monthlyRookie = await database.communityHonorAward.findFirst({ where: { guildId, kind: "MONTH_ROOKIE" }, orderBy: { createdAt: "desc" }, select: { userId: true, points: true } });
  return { recent, champions, podium, monthlyRookie };
}

// /community honors-settings. Changing the week start marks the last complete week of the new
// kind as already announced, so no week is announced twice or overlaps the previous one.
export async function configureCommunityHonors(database: PrismaClient, guildId: string, input: { weeklyEnabled?: boolean; weekStart?: WeekMode; pingMvp?: boolean }, now = new Date()) {
  return locked(database, guildId, async tx => {
    const honors = await tx.communityHonors.findUnique({ where: { guildId } });
    if (!honors) return null;
    const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { timezone: true } });
    const moved = input.weekStart !== undefined && input.weekStart !== weekMode(honors.weekStart);
    return tx.communityHonors.update({ where: { guildId }, data: {
      ...(input.weeklyEnabled === undefined ? {} : { weeklyEnabled: input.weeklyEnabled }),
      ...(input.pingMvp === undefined ? {} : { pingMvp: input.pingMvp }),
      ...(moved ? { weekStart: input.weekStart!, week: dateAfter(honorsWeekOf(now, settings?.timezone ?? "America/Toronto", input.weekStart!), -7) } : {})
    } });
  });
}

// Makes the Discord roles match the saved holders: whoever has a role without holding it loses
// it, the holders get it. Members who left are skipped.
export async function syncCommunityHonorRoles(guild: Guild, database: PrismaClient, honors: CommunityHonors): Promise<void> {
  const plan: [string | null, string[]][] = [[honors.weeklyRoleId, strings(honors.weeklyHolderIds)]];
  const roles = strings(honors.monthRoleIds), holders = ids(honors.monthHolderIds, 3);
  for (let i = 0; i < 3; i++) plan.push([roles[i] ?? null, holders[i]!]);
  plan.push([honors.rookieRoleId ?? null, honors.rookieHolderId ? [honors.rookieHolderId] : []]);
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
  // Adopt the new cosmetic role for existing installations without rerunning /setup.
  const current = await database.communityHonors.findUnique({ where: { guildId } });
  if (current && !current.rookieRoleId) {
    const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { language: true } });
    const roles = await guild.roles.fetch();
    const role = roles.find(role => Object.values(ROOKIE_ROLE).includes(role.name))
      ?? await guild.roles.create({ name: ROOKIE_ROLE[asLang(settings?.language)], colors: { primaryColor: 0x2ecc71 }, permissions: [], mentionable: false, reason: "Guilded: monthly rookie recognition" });
    await database.communityHonors.update({ where: { guildId }, data: { rookieRoleId: role.id, rolesPending: true } });
  }
  await advanceCommunityHonors(database, guildId, now, discordNames(guild), rookieMemberLookup(guild));
  const honors = await database.communityHonors.findUnique({ where: { guildId } });
  if (!honors?.rolesPending || now.getTime() - (lastSyncAttempt.get(guildId) ?? 0) < 15 * 60_000) return;
  lastSyncAttempt.set(guildId, now.getTime());
  await syncCommunityHonorRoles(guild, database, honors);
  lastSyncAttempt.delete(guildId);
}
