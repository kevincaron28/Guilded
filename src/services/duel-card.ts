import { EmbedBuilder } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "./../i18n.js";
import { textlessEmbed } from "./card-only.js";
import { displayCharacterName, type FullNameBook } from "./character-display.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { duelLeaderboard, duelPoints, streakText, type FreshDuel } from "./duels.js";
import { classOf, type ClassBook } from "./ladder-classes.js";
import { classColor, type ScoreCard } from "./score-card.js";

// One Discord card per counted duel (9.3, owner decision 13 November 2026). Drawn on delivery from the stored definition, so it
// is queued like every other card post: low-priority job, one render at a time, a plain-text fallback when the picture cannot
// be drawn. No pings. It posts where the duel board lives and follows the duel board's own switch (GuildSettings.duelBoardEnabled).

/** Individual cards one upload may queue; the rest of its duels fold into ONE summary card (proposed number, owner may change). */
export const DUEL_CARDS_PER_IMPORT = 3;
const SUMMARY_ROWS = 6;
const DUEL_COLOR = 0xb91c1c;

export interface DuelCardInput extends FreshDuel { points: number; winnerScore: number; winnerStreak: number; winnerBest: number }

const level = (value: number | null) => value ? String(value) : "—";

/** Pure: the card of one duel. */
export function duelResultCard(duel: DuelCardInput, lang: Lang, classes: ClassBook, names: FullNameBook): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const winner = displayCharacterName(duel.winnerCharacter, names), loser = displayCharacterName(duel.loserCharacter, names);
  const fled = duel.reason === "retreat";
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
export function duelSummaryCard(duels: readonly DuelCardInput[], lang: Lang, classes: ClassBook, names: FullNameBook): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const shown = duels.slice(0, SUMMARY_ROWS);
  return {
    eyebrow: `Guilded · ${t("PvP", "JcJ")}`, title: t("More duels", "Autres duels"),
    subtitle: t(`${duels.length} more duels counted`, `${duels.length} autres duels comptés`),
    backdrop: { kind: "board", key: "duel" },
    stats: [{ label: t("Duels", "Duels"), value: String(duels.length), accent: "gold" }, { label: t("Points", "Points"), value: String(duels.reduce((sum, duel) => sum + duel.points, 0)) }],
    rowsLabel: t("Results", "Résultats"),
    rows: shown.map(duel => ({ name: displayCharacterName(duel.winnerCharacter, names), color: classColor(classOf(classes, duel.winnerCharacter)),
      sub: t(`beat ${displayCharacterName(duel.loserCharacter, names)}`, `bat ${displayCharacterName(duel.loserCharacter, names)}`), right: `+${duel.points}`, rightTone: "green" as const })),
    ...(duels.length > shown.length ? { badges: [{ text: t(`and ${duels.length - shown.length} more`, `et ${duels.length - shown.length} autres`), tone: "muted" as const }] } : {}),
    footer: t("Guild duels · No rewards · guildedwow.com", "Duels de guilde · Aucune récompense · guildedwow.com")
  };
}

/** The text a post falls back to when the picture cannot be drawn (and the alt of what the card holds). */
export function duelFallbackEmbed(duel: DuelCardInput, lang: Lang, names: FullNameBook): EmbedBuilder {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const winner = displayCharacterName(duel.winnerCharacter, names), loser = displayCharacterName(duel.loserCharacter, names);
  const verb = duel.reason === "retreat" ? t("won (opponent fled) against", "gagne (adversaire en fuite) contre") : t("beat", "bat");
  return new EmbedBuilder().setColor(DUEL_COLOR).setDescription(`⚔️ **${winner}** ${verb} ${loser} — +${duel.points} pts${duel.winnerStreak > 1 ? ` · ${streakText(duel.winnerStreak)}` : ""}`.slice(0, 400));
}

const summaryFallback = (duels: readonly DuelCardInput[], lang: Lang, names: FullNameBook) => new EmbedBuilder().setColor(DUEL_COLOR).setDescription(
  `⚔️ ${lang === "fr" ? `${duels.length} autres duels comptés` : `${duels.length} more duels counted`}\n${duels.slice(0, SUMMARY_ROWS).map(duel =>
    `${displayCharacterName(duel.winnerCharacter, names)} › ${displayCharacterName(duel.loserCharacter, names)} (+${duel.points})`).join("\n")}`.slice(0, 1800));

/** Pure: each fresh duel with what its winner's standing was after it (points, current and best streak). */
export function withStandings(fresh: readonly FreshDuel[], standings: readonly { memberId: string; score: number; streak: number; bestStreak: number }[]): DuelCardInput[] {
  const by = new Map(standings.map(row => [row.memberId, row]));
  return fresh.map(duel => ({ ...duel, points: duelPoints(duel.winnerLevel, duel.loserLevel), winnerScore: by.get(duel.winnerId)?.score ?? 0,
    winnerStreak: by.get(duel.winnerId)?.streak ?? 0, winnerBest: by.get(duel.winnerId)?.bestStreak ?? 0 }));
}

const queued = (guildId: string, key: string, channelId: string, card: ScoreCard, fallback: EmbedBuilder, database: Pick<PrismaClient, "discordJob">) =>
  enqueueDiscordJob(database, guildId, key, "MESSAGE", { channelId, message: JSON.parse(JSON.stringify({ embeds: [fallback.toJSON()] })), card: JSON.parse(JSON.stringify(card)),
    cardOnly: { embeds: [textlessEmbed(DUEL_COLOR)] } } as Prisma.InputJsonValue);

/**
 * Queues the cards of one upload's newly counted duels: one per duel up to DUEL_CARDS_PER_IMPORT, the rest in one summary card.
 * Each job's key holds the duel's report key, so a repeated upload cannot queue a card twice. Runs inside the import transaction.
 */
export async function queueDuelCards(database: Pick<PrismaClient, "discordJob" | "duelResult">, guildId: string, edition: string, channelId: string, lang: Lang,
  fresh: readonly FreshDuel[], classes: ClassBook, names: FullNameBook): Promise<number> {
  if (!fresh.length) return 0;
  const { standings } = await duelLeaderboard(database, guildId, edition, { limit: 1000 });
  const duels = withStandings(fresh, standings);
  const single = duels.slice(0, DUEL_CARDS_PER_IMPORT), rest = duels.slice(DUEL_CARDS_PER_IMPORT);
  for (const duel of single) await queued(guildId, `duel-card:${duel.reportKey}`, channelId, duelResultCard(duel, lang, classes, names), duelFallbackEmbed(duel, lang, names), database);
  if (rest.length) await queued(guildId, `duel-card:${rest[0]!.reportKey}:more`, channelId, duelSummaryCard(rest, lang, classes, names), summaryFallback(rest, lang, names), database);
  return single.length + (rest.length ? 1 : 0);
}
