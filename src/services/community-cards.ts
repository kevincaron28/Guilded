import type { Lang } from "../i18n.js";
import { TIER_COLOR, TIER_LABEL, type AchievementTier } from "./achievements-catalogue.js";
import { availableEmblems, badgeToken, hasFrame } from "./badge-art.js";
import { badgeLabel, COMMUNITY_MILESTONES } from "./community-badge-rules.js";
import { ladderMeta, type CardRow, type CardUnlock, type ScoreCard } from "./score-card.js";

// Cards for the community side (24 Nov 2026, card coverage audit): the milestone badge a member just earned, a member's badge shelf, the card of a
// new monthly season and the final top of a season that ended. They reuse the achievement cards' layouts and their painted badges
// (site/badge-art), and the same paintings as the other season cards: nothing here needs new art.

const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;

/** The painted emblem and tier of each community badge code. A code the table does not know draws no badge (the row keeps its text). */
const MILESTONE_TIER: Record<number, AchievementTier> = { [COMMUNITY_MILESTONES[0]]: "bronze", [COMMUNITY_MILESTONES[1]]: "silver", [COMMUNITY_MILESTONES[2]]: "gold" };
const REVIEWED: Record<string, { emblem: string; tier: AchievementTier }> = {
  helper: { emblem: "seasons-helper", tier: "silver" }, attendee: { emblem: "seasons-attendee", tier: "bronze" }, organizer: { emblem: "seasons-organizer", tier: "gold" }
};
const LEGACY_TIER: Record<number, AchievementTier> = { 50: "bronze", 150: "silver", 300: "gold" };

export function communityBadgeLook(code: string): { emblem: string; tier: AchievementTier } | null {
  if (code.startsWith("community-")) {
    const tier = MILESTONE_TIER[Number(code.slice(10))];
    return tier ? { emblem: "guild-pouch", tier } : null;
  }
  if (code.startsWith("legacy-")) {
    const tier = LEGACY_TIER[Number(code.slice(7))];
    return tier ? { emblem: "seasons-laurel", tier } : null;
  }
  return REVIEWED[code] ?? null;
}

/** The painted badge token of a community badge, or "" when its picture is not on disk (the card then shows the text alone). */
export function communityBadgeIcon(code: string): string {
  const look = communityBadgeLook(code);
  return look && hasFrame(look.tier) && availableEmblems().has(look.emblem) ? badgeToken(look.emblem, look.tier, true) : "";
}

const TIER_FOR = (code: string): AchievementTier => communityBadgeLook(code)?.tier ?? "bronze";

function unlockOf(code: string, lang: Lang, season: string, detail: string): CardUnlock {
  const tier = TIER_FOR(code);
  return { name: badgeLabel(code, lang), group: season, detail, tier: TIER_LABEL[tier][lang], color: TIER_COLOR[tier], icon: communityBadgeIcon(code) };
}

const REVIEWED_DETAIL: Record<string, [string, string]> = {
  helper: ["Helped a guildmate and an organizer confirmed it", "A aidé un membre, confirmé par un organisateur"],
  attendee: ["Took part in a confirmed activity", "A participé à une activité confirmée"],
  organizer: ["Organized a community activity", "A organisé une activité de la communauté"]
};

/** The one-line meaning of a badge code on a card. */
export function communityBadgeDetail(code: string, lang: Lang): string {
  if (code.startsWith("community-")) return say(lang, `${code.slice(10)} community points in one season`, `${code.slice(10)} points de communauté en une saison`);
  if (code.startsWith("legacy-")) return say(lang, `${code.slice(7)} points, from before the badges existed`, `${code.slice(7)} points, d'avant les badges`);
  const text = REVIEWED_DETAIL[code];
  return text ? say(lang, text[0], text[1]) : "";
}

/** The celebration card of a member who reached a community milestone (the post that used to be one text line). */
export function communityMilestoneCard(lang: Lang, name: string, threshold: number, season?: string): ScoreCard {
  const code = `community-${threshold}`, unlock = unlockOf(code, lang, season ?? say(lang, "Community season", "Saison de la communauté"), communityBadgeDetail(code, lang));
  return {
    eyebrow: say(lang, "Guilded · Community badge", "Guilded · Badge de communauté"), title: name.replace(/[\r\n]/g, " ").slice(0, 40), subtitle: "",
    backdrop: { kind: "board", key: "achievement-unlocked" },
    stats: [{ label: say(lang, "Community points", "Points de communauté"), value: String(threshold), accent: "gold" }],
    unlocks: [unlock], unlocksMore: 0, moreLabel: say(lang, "more", "autres"),
    footer: say(lang, "Cosmetic badge · Shown in /community badges", "Badge décoratif · Visible dans /community badges")
  };
}

export interface ShelfBadge { code: string; earnedAt: Date | null }
const SHELF_MAX = 8;
/** One member's badge shelf for a season (`/community badges`): the painted badges, newest first, up to eight and a count. */
export function communityShelfCard(lang: Lang, name: string, season: string, badges: readonly ShelfBadge[]): ScoreCard {
  const ordered = badges.slice().sort((a, b) => (b.earnedAt?.getTime() ?? 0) - (a.earnedAt?.getTime() ?? 0) || a.code.localeCompare(b.code));
  const shown = ordered.slice(0, SHELF_MAX);
  return {
    eyebrow: say(lang, "Guilded · Community badges", "Guilded · Badges de communauté"), title: name.replace(/[\r\n]/g, " ").slice(0, 40), subtitle: season,
    backdrop: { kind: "board", key: "achievements" },
    stats: [{ label: say(lang, "Badges", "Badges"), value: String(badges.length), accent: "gold" }],
    rowsLabel: say(lang, "Season badges", "Badges de saison"),
    rows: shown.map((badge): CardRow => ({ name: badgeLabel(badge.code, lang), sub: communityBadgeDetail(badge.code, lang), color: TIER_COLOR[TIER_FOR(badge.code)], right: TIER_LABEL[TIER_FOR(badge.code)][lang], icon: communityBadgeIcon(badge.code) })),
    unlocks: shown.map(badge => unlockOf(badge.code, lang, season, communityBadgeDetail(badge.code, lang))), unlocksMore: Math.max(0, ordered.length - SHELF_MAX), moreLabel: say(lang, "more", "autres"),
    footer: say(lang, "Cosmetic only · Shared with members who can see this season", "Décoratif seulement · Visible aux membres de cette saison")
  };
}

/** The card of the community season that just began (the monthly rotation): everyone is back at zero, and what counts. */
export function communitySeasonStartCard(lang: Lang, season: string, endedSeason: string): ScoreCard {
  return {
    eyebrow: say(lang, "Guilded · Community", "Guilded · Communauté"), title: say(lang, `${season} begins`, `${season} commence`),
    subtitle: say(lang, `${endedSeason} is over: the final standings are archived`, `${endedSeason} est terminée : le classement final est archivé`),
    backdrop: { kind: "board", key: "season-start", fallbackKey: "dungeon-season" },
    stats: [
      { label: say(lang, "Everyone starts at", "Tout le monde repart à"), value: "0", note: say(lang, "points", "point"), accent: "gold" },
      { label: say(lang, "New season", "Nouvelle saison"), value: season }
    ],
    rowsLabel: say(lang, "What counts", "Ce qui compte"),
    rows: [
      { name: say(lang, "Chat, reactions and voice", "Jasette, réactions et vocal"), sub: say(lang, "Genuine contributions earn points", "Les vraies contributions rapportent des points") },
      { name: say(lang, "Dungeons, duels and PvP", "Donjons, duels et JcJ"), sub: say(lang, "In-game results count on the same board", "Les résultats en jeu comptent au même classement") },
      { name: say(lang, "Gaming nights and challenges", "Soirées de jeu et défis"), sub: say(lang, "Confirmed by the organizers", "Confirmés par les organisateurs") }
    ],
    footer: say(lang, "A new season starts every month · No rewards", "Une nouvelle saison commence chaque mois · Aucune récompense")
  };
}

export interface FinalRow { userId: string; points: number; discord?: number | undefined; dungeons?: number | undefined; pvp?: number | undefined }
const FINAL_TOP = 10;
/**
 * The final top of a community season, in the podium layout of the community leaderboard (card-podium.ts reads the backdrop key `community`
 * and the four columns: Discord, dungeons, PvP, total). The rows come from the season's final standings, ranked with ties.
 */
export function communityFinalCard(lang: Lang, season: string, board: readonly FinalRow[], names: ReadonlyMap<string, string>, endedAt: Date, timeZone?: string): ScoreCard {
  const ranked = board.filter(row => row.points > 0).slice().sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
  const figure = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const nameOf = (id: string) => (names.get(id) || say(lang, `Member …${id.slice(-4)}`, `Membre …${id.slice(-4)}`)).replace(/[\r\n]/g, " ");
  return {
    eyebrow: say(lang, "Community · Hall of fame", "Communauté · Palmarès"), title: say(lang, `Top 3 of ${season}`, `Top 3 · ${season}`),
    subtitle: say(lang, `Final standings · ${ranked.length} members`, `Classement final · ${ranked.length} membres`),
    backdrop: { kind: "board", key: "community", fallbackKey: "season-podium" }, stats: [],
    footer: say(lang, "Discord, dungeons, duels, battlegrounds and open-world PvP all count on the same board.", "Discord, donjons, duels, champs de bataille et JcJ en monde ouvert : tout compte au même classement."),
    ladder: {
      meta: ladderMeta(lang, endedAt, null, timeZone), empty: say(lang, "No points this season.", "Aucun point cette saison."),
      ...(ranked.length > FINAL_TOP ? { more: say(lang, `+${ranked.length - FINAL_TOP} more`, `+${ranked.length - FINAL_TOP} autres`) } : {}),
      columns: [{ label: "Discord", width: 64 }, { label: say(lang, "Dungeons", "Donjons"), width: 70 }, { label: say(lang, "PvP", "JcJ"), width: 56 }, { label: "Total", width: 70, primary: true }],
      boards: [{ rows: ranked.slice(0, FINAL_TOP).map(row => {
        const discord = row.discord ?? row.points - (row.dungeons ?? 0) - (row.pvp ?? 0);
        return { rank: 1 + ranked.filter(other => other.points > row.points).length, name: nameOf(row.userId), color: "#f3ead2", values: [figure(discord), figure(row.dungeons ?? 0), figure(row.pvp ?? 0), figure(row.points)] };
      }) }]
    }
  };
}
