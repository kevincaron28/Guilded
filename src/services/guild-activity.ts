import { AttachmentBuilder, EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { seasonLabel } from "./season-label.js";
import { isOwnBoard } from "./board-identity.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { weekStart } from "./dungeon-rules.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { classOf, loadClassBook, type ClassBook } from "./ladder-classes.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";

// The "Guild activity" ladder (9.1): ONE bot message in the dungeon leaderboard channel (else the duel ladder channel), edited in
// place, that adds up three kinds of in-game participation per member: dungeon points (the season ledger, unchanged), duels and
// battlegrounds. The dungeon, duel and battleground boards keep their own numbers; this ladder only reads them, awards nothing
// and stores nothing besides its message id and the daily rank snapshot for the arrows. On by default
// (GuildSettings.activityBoardEnabled), officers turn it off with /stats activity-board:false or in the companion.

const guildService = createGuildService(prisma);
export const ACTIVITY_BOARD_MARKER = "Guilded activity board";
export const ACTIVITY_CARD_FILE = "guild-activity.png";
const CARD_TOP = 25, EMBED_TOP = 3, FALLBACK_DAYS = 28;

/**
 * The weights, shown in the card's footer. A dungeon's points are its ledger points (a completion is worth 50 by default), so a
 * battleground game (about the time of half a dungeon) is worth 15 and a duel (a minute or two) a few points. Duel and battleground
 * points are capped per member per reset week so they cannot be farmed; dungeon points already have their own weekly rules.
 */
export const WEIGHTS = { duelWin: 5, duelLoss: 2, bgGame: 15, bgWin: 5, duelWeekCap: 100, bgWeekCap: 300 } as const;

export type ActivityView = "week" | "season";
export interface ActivityEvent { memberId: string; win: boolean; at: Date }
export interface ActivityRow { memberId: string; name: string; dungeons: number; duels: number; battlegrounds: number; total: number }
export interface ActivityData { view: ActivityView; label: string; since: Date; rows: ActivityRow[] }

const weekKey = (at: Date) => weekStart(at).toISOString();

/** Pure: points per member from one kind of event, capped per member per reset week. */
export function cappedPoints(events: readonly ActivityEvent[], win: number, other: number, weekCap: number): Map<string, number> {
  const weekly = new Map<string, number>();
  for (const event of events) {
    const key = `${event.memberId}\u0000${weekKey(event.at)}`;
    weekly.set(key, Math.min(weekCap, (weekly.get(key) ?? 0) + (event.win ? win : other)));
  }
  const totals = new Map<string, number>();
  for (const [key, points] of weekly) {
    const memberId = key.split("\u0000")[0]!;
    totals.set(memberId, (totals.get(memberId) ?? 0) + points);
  }
  return totals;
}

/** Pure: the ladder rows, highest total first, then dungeon points, then name. Members with nothing are left out. */
export function activityRows(input: { dungeons: ReadonlyMap<string, number>; duels: readonly ActivityEvent[]; battlegrounds: readonly ActivityEvent[]; names: ReadonlyMap<string, string> }): ActivityRow[] {
  const duels = cappedPoints(input.duels, WEIGHTS.duelWin, WEIGHTS.duelLoss, WEIGHTS.duelWeekCap);
  const battlegrounds = cappedPoints(input.battlegrounds, WEIGHTS.bgGame + WEIGHTS.bgWin, WEIGHTS.bgGame, WEIGHTS.bgWeekCap);
  const ids = new Set([...input.dungeons.keys(), ...duels.keys(), ...battlegrounds.keys()]);
  return [...ids].map(memberId => {
    const dungeons = Math.max(0, Math.round(input.dungeons.get(memberId) ?? 0)), duel = duels.get(memberId) ?? 0, bg = battlegrounds.get(memberId) ?? 0;
    return { memberId, name: input.names.get(memberId) ?? "?", dungeons, duels: duel, battlegrounds: bg, total: dungeons + duel + bg };
  }).filter(row => row.total > 0)
    .sort((a, b) => b.total - a.total || b.dungeons - a.dungeons || a.name.localeCompare(b.name));
}

/** Pure: the footer line that states the weights. */
export function weightsText(lang: Lang): string {
  const w = WEIGHTS;
  return lang === "fr"
    ? `Donjons : leurs points de saison · Champ de bataille : ${w.bgGame} par partie, +${w.bgWin} par victoire (max ${w.bgWeekCap}/sem.) · Duel : ${w.duelWin} gagné, ${w.duelLoss} perdu (max ${w.duelWeekCap}/sem.)`
    : `Dungeons: their season points · Battleground: ${w.bgGame} a game, +${w.bgWin} a win (max ${w.bgWeekCap}/week) · Duel: ${w.duelWin} a win, ${w.duelLoss} a loss (max ${w.duelWeekCap}/week)`;
}

/**
 * Pure: the ladder picture (shared ladder layout from #518): top 25, one column per source, the total in gold, and the
 * "since yesterday" arrows (#532) when there is an earlier day for this view.
 */
export function activityCard(data: ActivityData, lang: Lang, classes: ClassBook = new Map(), updatedAt = new Date(), moves: Movements | null = null): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: fr ? "Guilded · Participation" : "Guilded · Participation", title: fr ? "Activité de la guilde" : "Guild activity",
    subtitle: data.view === "week"
      ? fr ? `Cette semaine · ${data.rows.length} membres actifs` : `This week · ${data.rows.length} active members`
      : fr ? `${seasonLabel(data.label, lang)} · ${data.rows.length} membres actifs` : `${data.label} · ${data.rows.length} active members`,
    stats: [], footer: weightsText(lang),
    ladder: {
      meta: ladderMeta(lang, updatedAt, data.view === "season" ? seasonLabel(data.label, lang) : null),
      empty: fr ? "Aucune activité comptée pour l'instant." : "No activity counted yet.",
      columns: [{ label: fr ? "Donjons" : "Dungeons", width: 70 }, { label: "Duels", width: 56 }, { label: fr ? "CdB" : "BGs", width: 56 },
        { label: "Total", width: 64, primary: true }, ...(moves ? [moveColumn(lang)] : [])],
      boards: [{ rows: data.rows.slice(0, CARD_TOP).map((row, index) => ({ rank: index + 1, name: row.name, color: classColor(classOf(classes, row.name)),
        values: [String(row.dungeons), String(row.duels), String(row.battlegrounds), String(row.total), ""], ...moveFields(moves, row.memberId, lang) })) }]
    }
  };
}

/** Pure: the board's embed (the week's podium and the season's), plus the weights. With `image`, the card holds the season ladder. */
export function activityEmbed(week: ActivityData, season: ActivityData, lang: Lang, image?: string): EmbedBuilder {
  const fr = lang === "fr";
  const line = (row: ActivityRow, index: number) => `${["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`} ${escapeMarkdown(row.name).slice(0, 40)} — **${row.total}**`
    + ` (${fr ? "donjons" : "dungeons"} ${row.dungeons} · duels ${row.duels} · ${fr ? "CdB" : "BGs"} ${row.battlegrounds})`;
  const embed = new EmbedBuilder().setColor(0x16a34a).setTitle(fr ? "🏅 Activité de la guilde" : "🏅 Guild activity")
    .setDescription(fr ? "Donjons, duels et champs de bataille en un seul classement. Chaque tableau garde ses propres chiffres."
      : "Dungeons, duels and battlegrounds in one ladder. Each board keeps its own numbers.");
  const field = (data: ActivityData, name: string, top: number) => embed.addFields({ name, value: (data.rows.length ? data.rows.slice(0, top).map(line).join("\n")
    : fr ? "Rien encore." : "Nothing yet.").slice(0, 1024) });
  // Early in a season the week and the season hold the same people and numbers: one field then, not two copies.
  const same = week.rows.length === season.rows.length && week.rows.every((row, i) => row.memberId === season.rows[i]!.memberId && row.total === season.rows[i]!.total);
  if (same) field(season, `${seasonLabel(season.label, lang)} · ${fr ? "cette semaine aussi" : "this week too"}`, image ? EMBED_TOP : 10);
  else {
    field(week, fr ? "Cette semaine" : "This week", EMBED_TOP);
    field(season, seasonLabel(season.label, lang), image ? EMBED_TOP : 10);
  }
  if (image && season.rows.length) embed.setImage(`attachment://${image}`);
  return embed.setFooter({ text: weightsText(lang).slice(0, 2048) });
}

type Db = Pick<PrismaClient, "dungeonPointTransaction" | "dungeonSeason" | "duelResult" | "battlegroundReport" | "member">
  & Partial<Pick<PrismaClient, "character" | "unclaimedCharacter" | "guildRosterEntry">>;

/**
 * Loads one view. "week" is the current reset week (Tuesday 15:00 UTC, like the dungeon week); "season" is the active dungeon
 * season, or the last four weeks when there is none. Only active members, counted duels and consented battleground reports.
 */
export async function loadActivity(db: Db, guildId: string, edition: string, view: ActivityView, lang: Lang, now = new Date()): Promise<ActivityData> {
  const season = view === "season" ? await db.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" }, select: { id: true, name: true, startsAt: true } }) : null;
  const since = view === "week" ? weekStart(now) : season?.startsAt ?? new Date(now.getTime() - FALLBACK_DAYS * 86_400_000);
  const label = view === "week" ? (lang === "fr" ? "Cette semaine" : "This week") : season?.name ?? (lang === "fr" ? "4 dernières semaines" : "Last 4 weeks");
  const active = { guildId, status: "ACTIVE" as const };
  const pointsWhere = view === "season" && season ? { guildId, seasonId: season.id, member: active }
    : { guildId, member: active, OR: [{ run: { endedAt: { gte: since } } }, { runId: null, createdAt: { gte: since } }] };
  const [points, duels, bgs] = await Promise.all([
    db.dungeonPointTransaction.groupBy({ by: ["memberId"], where: pointsWhere, _sum: { amount: true } }),
    db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, endedAt: { gte: since, lte: now } }, take: 20_000,
      select: { winnerId: true, loserId: true, endedAt: true, winner: { select: { status: true } }, loser: { select: { status: true } } } }),
    db.battlegroundReport.findMany({ where: { guildId, gameEdition: edition, status: "PROVISIONAL", endedAt: { gte: since, lte: now }, member: active }, take: 20_000,
      select: { memberId: true, outcome: true, endedAt: true } })
  ]);
  const duelEvents: ActivityEvent[] = duels.flatMap(duel => [
    ...(duel.winner.status === "ACTIVE" ? [{ memberId: duel.winnerId, win: true, at: duel.endedAt }] : []),
    ...(duel.loser.status === "ACTIVE" ? [{ memberId: duel.loserId, win: false, at: duel.endedAt }] : [])]);
  const bgEvents: ActivityEvent[] = bgs.map(report => ({ memberId: report.memberId, win: report.outcome === "win", at: report.endedAt }));
  const dungeons = new Map(points.map(row => [row.memberId, row._sum?.amount ?? 0] as const));
  const ids = [...new Set([...dungeons.keys(), ...duelEvents.map(event => event.memberId), ...bgEvents.map(event => event.memberId)])];
  const members = ids.length ? await db.member.findMany({ where: { id: { in: ids }, guildId }, select: { id: true, displayName: true,
    characters: { where: { gameEdition: edition }, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 1, select: { name: true, displayName: true } } } }) : [];
  const book = await loadFullNameBook(db as never, guildId);
  const names = new Map(members.map(member => [member.id, member.characters?.[0] ? displayCharacterName(member.characters[0], book) : member.displayName] as const));
  return { view, label, since, rows: activityRows({ dungeons, duels: duelEvents, battlegrounds: bgEvents, names }) };
}

/** The board's channel: the dungeon leaderboard channel, else the duel ladder channel. Null when neither exists. */
export const activityChannelId = (settings: { dungeonLeaderboardChannelId?: string | null; duelBoardChannelId?: string | null }) =>
  settings.dungeonLeaderboardChannelId ?? settings.duelBoardChannelId ?? null;

const isBoard = (message: Message, botId: string) => isOwnBoard(message, botId, ACTIVITY_BOARD_MARKER, ["🏅 Guild activity", "🏅 Activité de la guilde"]);

/** The picture and embed for one guild (also used by /stats activity). Never throws on drawing: no picture just means embed only. */
export async function activityPayload(guildId: string, edition: string, lang: Lang, view: ActivityView = "season", snapshot = true) {
  const [week, season] = await Promise.all([loadActivity(prisma, guildId, edition, "week", lang), loadActivity(prisma, guildId, edition, "season", lang)]);
  const shown = view === "week" ? week : season;
  // Each view is its own snapshot board; a new dungeon season starts a new one, so arrows never compare two seasons.
  const moves = snapshot && shown.rows.length ? await trackRanks(prisma, guildId, `activity:${view}:${view === "week" ? week.since.toISOString().slice(0, 10) : season.label}`.slice(0, 120), shown.rows.map(row => row.memberId)) : null;
  const png = shown.rows.length ? await scoreCardPng(activityCard(shown, lang, await loadClassBook(prisma, guildId).catch(() => new Map<string, string>()), new Date(), moves)).catch(() => null) : null;
  const embed = activityEmbed(week, season, lang, png ? ACTIVITY_CARD_FILE : undefined).setTimestamp(new Date());
  return { embeds: [embed], files: png ? [new AttachmentBuilder(png, { name: ACTIVITY_CARD_FILE })] : [], allowedMentions: { parse: [] as never[] } };
}

/**
 * Edits the saved board message in place; if it is gone, adopts an existing bot board in the channel before ever posting a new
 * one. Never throws: a failed refresh must not undo anything. `delivery` is the job worker's call; any other call queues it.
 */
export async function updateActivityBoard(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.activityBoardEnabled || !activityChannelId(settings)) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "activity-board", "ACTIVITY_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    const channelId = settings?.activityBoardEnabled ? activityChannelId(settings) : null;
    if (!settings || !channelId) return false;
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const payload = await activityPayload(guild.id, guild.gameEdition ?? "forever", asLang(settings.language));
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.activityBoardMessageId ? await channel.messages.fetch(settings.activityBoardMessageId).catch(() => null) : null;
    if (existing && (existing.author.id !== botId || existing.channelId !== channel.id)) existing = null;
    if (!existing) existing = (await channel.messages.fetch({ limit: 50 }).catch(() => null))?.find(message => isBoard(message, botId)) ?? null;
    if (existing?.editable) {
      await existing.edit({ ...payload, attachments: [] });
      if (existing.id !== settings.activityBoardMessageId) await prisma.guildSettings.update({ where: { guildId: guild.id }, data: { activityBoardMessageId: existing.id } });
    } else {
      const sent = await channel.send(payload);
      await prisma.guildSettings.update({ where: { guildId: guild.id }, data: { activityBoardMessageId: sent.id } });
    }
    return true;
  } catch (error) {
    console.error("Failed to update the guild activity board", error);
    return false;
  }
}
