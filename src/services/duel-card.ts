import { EmbedBuilder } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "./../i18n.js";
import { textlessEmbed } from "./card-only.js";
import { displayCharacterName, type FullNameBook } from "./character-display.js";
import { duelPoints, streakText, type FreshDuel } from "./duels.js";
import { classOf, type ClassBook } from "./ladder-classes.js";
import { classColor, type ScoreCard } from "./score-card.js";
import { placement, ratingApplies, rateSeason, ratingSeasonName, seasonOf, showChange, showRating, type RatedDuel } from "./duel-rating.js";
import { ratingFooter } from "./duel-rules.js";
import { ratingStartOf } from "./duels.js";

// One Discord card per counted duel (9.3, owner decision 13 November 2026). Drawn on delivery from the stored definition, so it
// is queued like every other card post: a MESSAGE job on the "duelCard" route (switch and channel re-checked at delivery), delayed
// so boards and other posts go first, one render at a time, the picture retried before the text fallback. No pings.
// Burst rule (proposed numbers): a server gets at most WINDOW_CARDS single cards per WINDOW_MINUTES; every duel past that is
// folded into ONE summary card per window that keeps growing until it posts (nothing is dropped).

export const WINDOW_MINUTES = 10, WINDOW_CARDS = 5;
const POST_DELAY_MS = 90_000;
const SUMMARY_ROWS = 6, SUMMARY_KEEP = 60;
const DUEL_COLOR = 0xb91c1c;

/** From the rating start date (rating-v1) a duel moves ratings: what it did to each side, in shown-score points, and where they stand. */
export interface DuelRatingInfo { winnerDelta: number; loserDelta: number; winnerScore: number; loserScore: number; winnerPlacement: string | null; loserPlacement: string | null; rated: boolean; seasonId: string; startsAt: string }
export interface DuelCardInput extends FreshDuel { points: number; winnerScore: number; winnerStreak: number; winnerBest: number; rating?: DuelRatingInfo }

const level = (value: number | null) => value ? String(value) : "—";

/** Pure: the card of one duel. */
export function duelResultCard(duel: DuelCardInput, lang: Lang, classes: ClassBook, names: FullNameBook): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const winner = displayCharacterName(duel.winnerCharacter, names), loser = displayCharacterName(duel.loserCharacter, names);
  const fled = duel.reason === "retreat";
  if (duel.rating) {
    const r = duel.rating, lg = fr ? "fr" : "en";
    const where = (score: number, place: string | null) => place ? `placement ${place}` : showRating(score);
    const change = (value: number) => r.rated ? showChange(value) : "0";
    return {
      eyebrow: `Guilded · ${t("PvP", "JcJ")}`, title: t("Duel result", "Résultat du duel"),
      subtitle: `${fled ? t("Opponent fled", "Adversaire en fuite") : t("Won by knockout", "Victoire par K.O.")} · ${ratingSeasonName(r.seasonId, lg)}`,
      backdrop: { kind: "board", key: "duel" },
      stats: [
        { label: t("Rating", "Cote"), value: change(r.winnerDelta), accent: "gold", note: where(r.winnerScore, r.winnerPlacement) },
        { label: t("Levels", "Niveaux"), value: `${level(duel.winnerLevel)} vs ${level(duel.loserLevel)}` },
        { label: t("Opponent", "Adversaire"), value: change(r.loserDelta), ...(r.rated ? { accent: "red" as const } : {}), note: where(r.loserScore, r.loserPlacement) }
      ],
      rowsLabel: t("Duellists", "Duellistes"),
      rows: [
        { name: winner, color: classColor(classOf(classes, duel.winnerCharacter)), sub: t("Winner", "Gagnant"), right: change(r.winnerDelta), rightTone: "green" },
        { name: loser, color: classColor(classOf(classes, duel.loserCharacter)), sub: fled ? t("Fled", "A fui") : t("Defeated", "Vaincu"), right: change(r.loserDelta), rightTone: "red" }
      ],
      footer: `${r.rated ? "" : t("No rating change: the pair used its weekly allowance or the levels are too far apart · ", "Aucun changement : le duo a épuisé sa limite hebdomadaire ou l'écart de niveaux est trop grand · ")}${ratingFooter(lg, ratingSeasonName(r.seasonId, lg), new Date(r.startsAt))}`.slice(0, 300)
    };
  }
  return {
    eyebrow: `Guilded · ${t("PvP", "JcJ")}`, title: t("Duel result", "Résultat du duel"),
    subtitle: fled ? t("Opponent fled", "Adversaire en fuite") : t("Won by knockout", "Victoire par K.O."),
    backdrop: { kind: "board", key: "duel" },
    stats: [
      { label: t("Points", "Points"), value: `+${duel.points}`, accent: "gold", note: t(`${duel.winnerScore} in total`, `${duel.winnerScore} au total`) },
      { label: t("Levels", "Niveaux"), value: `${level(duel.winnerLevel)} vs ${level(duel.loserLevel)}` },
      { label: t("Streak", "Série"), value: duel.winnerStreak > 1 ? streakText(duel.winnerStreak) : "—", accent: duel.winnerStreak > 1 ? "green" : undefined, note: t(`Best ${duel.winnerBest}`, `Record ${duel.winnerBest}`) }
    ],
    rowsLabel: t("Duellists", "Duellistes"),
    rows: [
      { name: winner, color: classColor(classOf(classes, duel.winnerCharacter)), sub: t("Winner", "Gagnant"), right: `+${duel.points}`, rightTone: "green" },
      { name: loser, color: classColor(classOf(classes, duel.loserCharacter)), sub: fled ? t("Fled", "A fui") : t("Defeated", "Vaincu"), right: duel.loserLevel ? t(`Lv ${duel.loserLevel}`, `Niv ${duel.loserLevel}`) : undefined }
    ],
    footer: t("Guild duel · Score: 10 per win, ±2 per level of difference · No rewards · guildedwow.com", "Duel de guilde · Score : 10 par victoire, ±2 par niveau d'écart · Aucune récompense · guildedwow.com")
  };
}

/** Pure: the card of the duels past the per-upload limit, one row each (up to six) and the count of the rest. */
/** `omitted`: older duels the summary no longer lists but still counts ("and N more"). */
export function duelSummaryCard(duels: readonly DuelCardInput[], lang: Lang, classes: ClassBook, names: FullNameBook, omitted = 0, omittedPoints = 0): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const shown = duels.slice(0, SUMMARY_ROWS);
  return {
    eyebrow: `Guilded · ${t("PvP", "JcJ")}`, title: t("More duels", "Autres duels"),
    subtitle: t(`${duels.length + omitted} more duels counted`, `${duels.length + omitted} autres duels comptés`),
    backdrop: { kind: "board", key: "duel" },
    stats: [{ label: t("Duels", "Duels"), value: String(duels.length + omitted), accent: "gold" }, ...(duels.some(duel => duel.rating) ? [] : [{ label: t("Points", "Points"), value: String(omittedPoints + duels.reduce((sum, duel) => sum + duel.points, 0)) }])],
    rowsLabel: t("Results", "Résultats"),
    rows: shown.map(duel => ({ name: displayCharacterName(duel.winnerCharacter, names), color: classColor(classOf(classes, duel.winnerCharacter)),
      sub: t(`beat ${displayCharacterName(duel.loserCharacter, names)}`, `bat ${displayCharacterName(duel.loserCharacter, names)}`), right: duel.rating ? (duel.rating.rated ? showChange(duel.rating.winnerDelta) : "0") : `+${duel.points}`, rightTone: "green" as const })),
    ...(duels.length + omitted > shown.length ? { badges: [{ text: t(`and ${duels.length + omitted - shown.length} more`, `et ${duels.length + omitted - shown.length} autres`), tone: "muted" as const }] } : {}),
    footer: t("Guild duels · No rewards · guildedwow.com", "Duels de guilde · Aucune récompense · guildedwow.com")
  };
}

/** The text a post falls back to when the picture cannot be drawn (and the alt of what the card holds). */
export function duelFallbackEmbed(duel: DuelCardInput, lang: Lang, names: FullNameBook): EmbedBuilder {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const winner = displayCharacterName(duel.winnerCharacter, names), loser = displayCharacterName(duel.loserCharacter, names);
  const verb = duel.reason === "retreat" ? t("won (opponent fled) against", "gagne (adversaire en fuite) contre") : t("beat", "bat");
  return new EmbedBuilder().setColor(DUEL_COLOR).setDescription(`⚔️ **${winner}** ${verb} ${loser} — ${duel.rating ? `${duel.rating.rated ? showChange(duel.rating.winnerDelta) : "0"} ${t("rating", "cote")}` : `+${duel.points} pts`}${duel.winnerStreak > 1 ? ` · ${streakText(duel.winnerStreak)}` : ""}`.slice(0, 400));
}

const summaryFallback = (duels: readonly DuelCardInput[], lang: Lang, names: FullNameBook, omitted = 0) => new EmbedBuilder().setColor(DUEL_COLOR).setDescription(
  `⚔️ ${lang === "fr" ? `${duels.length + omitted} autres duels comptés` : `${duels.length + omitted} more duels counted`}\n${duels.slice(0, SUMMARY_ROWS).map(duel =>
    `${displayCharacterName(duel.winnerCharacter, names)} › ${displayCharacterName(duel.loserCharacter, names)} (${duel.rating ? (duel.rating.rated ? showChange(duel.rating.winnerDelta) : "0") : `+${duel.points}`})`).join("\n")}`.slice(0, 1800));

export interface Standing { score: number; streak: number; bestStreak: number }
export interface HistoryRow { reportKey: string; winnerId: string; loserId: string; winnerLevel: number | null; loserLevel: number | null }

/** Pure: the winner's standing right AFTER each wanted duel, replaying the counted history oldest first (so three wins in one upload show 1, 2, 3 wins). */
export function standingsAfterEach(history: readonly HistoryRow[], wanted: ReadonlySet<string>): Map<string, Standing> {
  const run = new Map<string, { score: number; streak: number; best: number }>();
  const entry = (id: string) => { let row = run.get(id); if (!row) { row = { score: 0, streak: 0, best: 0 }; run.set(id, row); } return row; };
  const out = new Map<string, Standing>();
  for (const duel of history) {
    const w = entry(duel.winnerId), l = entry(duel.loserId);
    w.score += duelPoints(duel.winnerLevel, duel.loserLevel); w.streak = w.streak > 0 ? w.streak + 1 : 1; w.best = Math.max(w.best, w.streak);
    l.streak = l.streak < 0 ? l.streak - 1 : -1;
    if (wanted.has(duel.reportKey)) out.set(duel.reportKey, { score: w.score, streak: w.streak, bestStreak: w.best });
  }
  return out;
}

/** Pure: the fresh duels with their points and the winner's standing after each. */
export function withStandings(fresh: readonly FreshDuel[], after: ReadonlyMap<string, Standing>): DuelCardInput[] {
  return fresh.map(duel => { const at = after.get(duel.reportKey); return { ...duel, points: duelPoints(duel.winnerLevel, duel.loserLevel), winnerScore: at?.score ?? 0, winnerStreak: at?.streak ?? 0, winnerBest: at?.bestStreak ?? 0 }; });
}

/**
 * Pure: for the duels that ended on or after the rating start, what each moved. The season's counted history is re-rated in date
 * order (the same as the boards), so a duel that arrived late shows the change it really made in its place; a card posted earlier
 * is not edited and may differ slightly from today's board. Duels before the start keep their points card.
 */
export function withRatings(duels: readonly DuelCardInput[], history: readonly (HistoryRow & { winnerCharacter: string; loserCharacter: string; endedAt: Date })[], startsAt: Date): DuelCardInput[] {
  if (!duels.some(duel => ratingApplies(duel.endedAt, startsAt))) return [...duels];
  const bySeason = new Map<string, ReturnType<typeof rateSeason>>();
  const keys = new Map<RatedDuel, string>();
  const seasonResult = (id: string) => {
    let result = bySeason.get(id);
    if (!result) {
      const rows: RatedDuel[] = history.filter(row => seasonOf(row.endedAt, startsAt).id === id).map(row => {
        const duel: RatedDuel = { winnerKey: row.winnerId, loserKey: row.loserId, winnerName: row.winnerCharacter, loserName: row.loserCharacter, winnerLevel: row.winnerLevel, loserLevel: row.loserLevel, endedAt: row.endedAt };
        keys.set(duel, row.reportKey);
        return duel;
      });
      result = rateSeason(rows);
      bySeason.set(id, result);
    }
    return result;
  };
  return duels.map(duel => {
    if (!ratingApplies(duel.endedAt, startsAt)) return duel;
    const season = seasonOf(duel.endedAt, startsAt), result = seasonResult(season.id);
    const index = result.ordered.findIndex(row => keys.get(row) === duel.reportKey);
    const change = result.changes[index];
    const w = result.players.get(duel.winnerId), l = result.players.get(duel.loserId);
    if (!change || !w || !l) return duel;
    const place = (p: typeof w) => p.ranked ? null : `${placement(p.rated, p.opponents).duels}/${placement(p.rated, p.opponents).needDuels}`;
    return { ...duel, points: Math.round(change.winnerDelta), winnerScore: Math.round(w.score),
      rating: { winnerDelta: change.winnerDelta, loserDelta: change.loserDelta, winnerScore: w.score, loserScore: l.score, winnerPlacement: place(w), loserPlacement: place(l), rated: change.rated, seasonId: season.id, startsAt: startsAt.toISOString() } };
  });
}

type Database = Pick<PrismaClient, "discordJob" | "duelResult"> & { guildSettings?: Pick<PrismaClient["guildSettings"], "findUnique"> };
const jsonOf = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function put(database: Pick<PrismaClient, "discordJob">, guildId: string, key: string, payload: Record<string, unknown>, now: Date) {
  const nextAttemptAt = new Date(now.getTime() + POST_DELAY_MS);
  return database.discordJob.upsert({ where: { guildId_key: { guildId, key } }, create: { guildId, key, kind: "MESSAGE", payload: jsonOf(payload), nextAttemptAt },
    update: { kind: "MESSAGE", payload: jsonOf(payload), revision: { increment: 1 }, status: "PENDING", attempts: 0, nextAttemptAt, lastError: null } });
}
const base = (card: ScoreCard, fallback: EmbedBuilder) => ({ route: "duelCard", retryCard: true, message: { embeds: [fallback.toJSON()] }, card, cardOnly: { embeds: [textlessEmbed(DUEL_COLOR)] } });

/**
 * Queues the cards for the duels one upload newly counted. Runs OUTSIDE the import transaction (it reads the duel history).
 * Single cards while the server's window allowance lasts, then one growing summary card per window. The summary job holds the
 * duels it covers (`duels`, newest SUMMARY_KEEP) so a later upload in the same window adds to it while it is still queued.
 */
export async function queueDuelCards(database: Database, guildId: string, edition: string, lang: Lang, fresh: readonly FreshDuel[], classes: ClassBook, names: FullNameBook, now = new Date()): Promise<number> {
  if (!fresh.length) return 0;
  const history = await database.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, archived: false }, orderBy: { endedAt: "asc" }, take: 20_000,
    select: { reportKey: true, winnerId: true, loserId: true, winnerCharacter: true, loserCharacter: true, winnerLevel: true, loserLevel: true, endedAt: true } });
  const startsAt = await ratingStartOf(database, guildId);
  const duels = withRatings(withStandings([...fresh].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime()), standingsAfterEach(history, new Set(fresh.map(duel => duel.reportKey)))), history, startsAt);
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const used = await database.discordJob.count({ where: { guildId, key: { startsWith: "duel-card:one:" }, createdAt: { gte: since } } });
  const room = Math.max(0, WINDOW_CARDS - used), single = duels.slice(0, room), rest = duels.slice(room);
  for (const duel of single) await put(database, guildId, `duel-card:one:${duel.reportKey}`, base(duelResultCard(duel, lang, classes, names), duelFallbackEmbed(duel, lang, names)), now);
  if (!rest.length) return single.length;
  // One summary per window while it is still waiting; once it has posted, the next overflow starts a new one.
  const bucket = Math.floor(now.getTime() / (WINDOW_MINUTES * 60_000));
  let key = `duel-card:more:${bucket}`, merged: DuelCardInput[] = rest, omitted = 0, omittedPoints = 0;
  const existing = await database.discordJob.findUnique({ where: { guildId_key: { guildId, key } }, select: { status: true, payload: true } });
  if (existing?.status === "DONE") key = `duel-card:more:${bucket}:${rest[0]!.reportKey}`;
  else if (existing) {
    const stored = existing.payload as { duels?: DuelCardInput[]; omitted?: number; omittedPoints?: number } | null;
    if (Array.isArray(stored?.duels)) {
      const all = [...stored.duels.map(duel => ({ ...duel, endedAt: new Date(duel.endedAt) })), ...rest];
      merged = all.slice(-SUMMARY_KEEP); omitted = (stored.omitted ?? 0) + all.length - merged.length;
      omittedPoints = (stored.omittedPoints ?? 0) + all.slice(0, all.length - merged.length).reduce((sum, duel) => sum + duel.points, 0);
    }
  }
  await put(database, guildId, key, { ...base(duelSummaryCard(merged, lang, classes, names, omitted, omittedPoints), summaryFallback(merged, lang, names, omitted)), duels: jsonOf(merged), omitted, omittedPoints }, now);
  return single.length + 1;
}
