import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { integrityRole, readDungeonIntegrity, readPlayerIntegrity } from "./dungeon-integrity.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { displayCharacterName } from "./character-display.js";
import { normalizeLeaderRuns } from "./public-run-merge.js";
import { challengeClock, readChallenge } from "./challenge-evidence.js";
import { DEFAULT_DUNGEON_BRACKETS, routeTargetAt } from "./dungeon-november-rules.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLASSES } from "../wow-data.js";
import { formatDuration } from "./dungeon-rules.js";
import { issuePersonalCode, type PersonalStore } from "./personal-pairing.js";
import { GAIN_STEP, planImprovements, roleScores, type ImprovementPlan, type RoutePlan } from "./public-guidance.js";
import { classLabel, className as classFromText, factionLabel, FACTIONS, roleLabel, ROLES } from "./recruitment.js";
import type { OfficialWindow } from "./official-seasons.js";
import type { BracketedRules } from "./dungeon-november-rules.js";
import { characterId, characterScores, DEFAULT_OFFICIAL, periodRules, publicRules, publicSeasons, publicWeek, rateRun, rulesAt, type PublicPeriod, type ScoreRow, type ScoreRun } from "./public-score.js";
import { breadcrumbs } from "./site-header.js";
import { escapeHtml, link, options } from "./web-layout.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";
import { classColor, scoreCardResponse, type CardRow, type CardStat } from "./score-card.js";
import { currentEdition, withEdition } from "./edition-context.js";
import { gameEditionOf } from "./game-edition.js";
import { freeSlug, guildPageStats, guildSlugs, routeKeyOf, unrankedReason } from "./guild-public-stats.js";
import { duelPoints, percent, ratingStartOf, streakText } from "./duels.js";
import { ADDON_SHOWS_RATING, DUEL_RULES, duelRuleLines, ratingRuleLines } from "./duel-rules.js";
import { RATING, RATING_START, ratingApplies, ratingSeasonName, seasonOf, showChange } from "./duel-rating.js";
import { buildDuelBoard, buildRatingBoard, DUEL_LEVEL_BANDS, headToHead, type DuelFilters, type DuelRow, type PublicDuel } from "./public-duels.js";
import { loadFullNameBook } from "./character-display.js";
import { buildGlobalBoard, globalHeadToHead, GLOBAL_RANK_OUTSIDERS, type GlobalDuel } from "./duel-global.js";
import { pictureUrl } from "./character-picture.js";
import type { PublicPicture } from "./public-pictures.js";

// WoW Forever's classes (no Death Knight, Monk, Demon Hunter or Evoker).
const FOREVER_CLASSES = CLASSES.filter(name => !["Death Knight", "Monk", "Demon Hunter", "Evoker"].includes(name));

// Public dungeon leaderboards (7.0, roadmap request 6; 7.1 season pages). Layout inspired by
// Raider.IO, built from our own data and words: /leaderboards/ (this week's top runs and top
// characters per bracket, with season, week, bracket, dungeon, class, role and realm filters),
// /leaderboards/?dungeon=<id> (one dungeon), /leaderboards/character/<Name-Realm> (score, best run
// per dungeon, recent runs, score history), /leaderboards/guilds/ (7.3: guilds ranked by their five
// best members per bracket) and /leaderboards/guild/<id> (an opted-in guild's members).
// Server-rendered, no scripts, cached 60 s. Scores: public-score.ts; each season is scored with the
// rules it froze. The stores read every matching run (pages of 5,000) so a personal best is never
// cut off by a row limit. Character pages add the best next improvement and role scores
// (public-guidance.ts).

export interface LeaderPlayer { character: string; displayName?: string | null; realm: string; className: string | null; role: string | null; level: number | null; minLevel?: number | null; presentSec?: number | null; integrity?: unknown;
  /** Other stored names of this same character (lowercase), e.g. the first name an older upload used. */
  aliases?: string[];
  /** In-game guild name the uploader saw for this player (optional, arrives with addon 9.3.0): only enriches pages. */
  guild?: string | null }
export interface LeaderRun extends ScoreRun {
  deaths: number | null; bracket: string | null; season: string; players: LeaderPlayer[];
  /** Set when several uploads of one clear were read as this run (public-run-merge.ts). */
  mergedIds?: string[];
}
/** Whether the guild roster (lowercase character keys) lists this player under its name or an older name of it. */
export const onRoster = (roster: ReadonlySet<string>, player: LeaderPlayer, edition: string) =>
  [player.character, ...(player.aliases ?? [])].some((name) => roster.has(characterKey(name, player.realm, edition)));
export interface DungeonSummary { instanceId: number; dungeonName: string; bestSec: number; runs: number }
export interface RunQuery { from: Date | null; to: Date | null; instanceId?: number | null }

export interface LeaderboardStore {
  /** Look up only accepted public runs, never guild-private or rejected uploads. */
  run?(id: string): Promise<LeaderRun | null>;
  runs(query: RunQuery): Promise<LeaderRun[]>;
  characterRuns(character: string, realm: string | null): Promise<LeaderRun[]>;
  /** Guilds that publish their runs; slug is their public guild page, when published. */
  guilds(): Promise<PublicGuild[]>;
  guildRuns(guildId: string, query: RunQuery): Promise<LeaderRun[]>;
  /** Character names linked to the guild's members (lowercase): only they count for the guild. */
  guildRoster(guildId: string): Promise<string[]>;
  /** Counted guild duels of the request's edition (8.4.5) between members who may be listed, for the guild's duel page and JSON. */
  guildDuelRows?(guildId: string): Promise<PublicDuel[]>;
  /** When this guild's duels start to be scored by rating (its own marker, else the built-in 1 December 2026 UTC). */
  guildDuelRatingStart?(guildId: string): Promise<Date>;
  /** Every counted duel of the global ladder that may be public (hidden members, excluded devices and servers without public pages already left out). */
  globalDuelRows?(): Promise<GlobalDuel[]>;
  /** Counts for the guild leaderboard (GuildStats), for guilds already returned by guilds(). */
  guildStats?(guildIds: string[]): Promise<GuildStats[]>;
}
export interface PublicGuild { id: string; name: string; slug?: string | null; /** Stored address of the guild's leaderboard page, assigned once. */ publicSlug?: string | null }

// A guild's score in a bracket: its GUILD_COUNT best members' scores added up (Raider.IO-style
// team ranking), so one strong player cannot carry a guild alone.
export const GUILD_COUNT = 5;
/** Rated members a guild needs to be ranked on the guild boards (1 = today's behaviour; the owner may raise it to 3). */
export const GUILD_MIN_RATED = 1;
export interface GuildRank { guild: PublicGuild; bracket: string; points: number; rated: number; best: ScoreRow; runs: number }
export function rankGuilds(entries: { guild: PublicGuild; runs: LeaderRun[]; roster: string[] }[], rules = publicRules()): GuildRank[] {
  const ranks: GuildRank[] = [];
  for (const { guild, runs, roster } of entries) {
    const members = new Set(roster.map((name) => name.toLowerCase()));
    const scores = characterScores(runs, rules).filter((row) => onRoster(members, row.player, rules.gameEdition ?? "forever"));
    for (const bracket of rules.brackets) {
      const rows = scores.filter((row) => row.bracket === bracket.key).sort((a, b) => b.points - a.points);
      if (rows.length < GUILD_MIN_RATED) continue;
      const counted = new Set(rows.flatMap((row) => row.routes.filter((r) => r.counted).map((r) => (r.run as LeaderRun).runId)));
      ranks.push({ guild, bracket: bracket.key, points: rows.slice(0, GUILD_COUNT).reduce((sum, row) => sum + row.points, 0), rated: rows.length, best: rows[0]!, runs: counted.size });
    }
  }
  return ranks.sort((a, b) => b.points - a.points || b.rated - a.rated || a.guild.name.localeCompare(b.guild.name));
}

/**
 * A listed guild's counts for the guild leaderboard (docs/plans/WEBSITE_RANKINGS.md). Numbers only, never names:
 * active non-test members, members with a linked character, and the levels of linked characters of this edition
 * (members hidden from the race to 60 board are left out of the level counts). Faction and realm come from the
 * guild's open recruitment listing; realm falls back to its members' most common realm.
 */
export interface GuildStats { guildId: string; faction: string | null; realm: string | null; members: number; linked: number; levelled: number; at60: number; levelSum: number; duels: number }
export const LEVEL_CAP = 60;

/** One row of the guild leaderboard. `points` is the guild's best bracket score in the period (null: no rated member). */
export interface GuildOverviewRow { guild: PublicGuild; stats: GuildStats | null; points: number | null; bracket: string | null; rated: number; runs: number; records: number }
export const GUILD_SORTS = ["score", "members", "at60", "level", "runs", "records", "duels", "name"] as const;
export type GuildSort = typeof GUILD_SORTS[number];
export interface GuildOverviewFilters { q: string; faction: string | null; realm: string | null; sort: GuildSort; page: number }

const foldText = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function readGuildOverviewFilters(query: URLSearchParams): GuildOverviewFilters {
  const faction = (query.get("faction") ?? "").toUpperCase();
  const sort = query.get("sort") ?? "";
  const page = Math.trunc(Number(query.get("page")));
  return {
    q: (query.get("q") ?? "").trim().slice(0, 40),
    faction: faction === "ALLIANCE" || faction === "HORDE" ? faction : null,
    realm: (query.get("realm") ?? "").trim().slice(0, 60) || null,
    sort: (GUILD_SORTS as readonly string[]).includes(sort) ? sort as GuildSort : "score",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 1_000) : 1
  };
}

export const averageLevel = (stats: GuildStats | null) => stats && stats.levelled ? Math.round(10 * stats.levelSum / stats.levelled) / 10 : null;

/**
 * Every listed guild, one row each: its best bracket score (rankGuilds), public runs in the period, and the
 * dungeon records its members hold (the period's fastest public clear of a dungeon has one of its members).
 */
export function guildOverview(entries: { guild: PublicGuild; runs: LeaderRun[]; roster: string[] }[], ranks: GuildRank[], stats: GuildStats[], allRuns: LeaderRun[], edition = "forever"): GuildOverviewRow[] {
  const fastest = new Map<string, LeaderRun>();
  for (const run of allRuns) {
    if (run.challenge) continue;
    const best = fastest.get(routeKeyOf(run));
    if (!best || run.durationSec < best.durationSec || (run.durationSec === best.durationSec && run.endedAt < best.endedAt)) fastest.set(routeKeyOf(run), run);
  }
  return entries.map(({ guild, runs, roster }) => {
    const members = new Set(roster.map((name) => name.toLowerCase()));
    const best = ranks.filter((rank) => rank.guild.id === guild.id).sort((a, b) => b.points - a.points)[0];
    const records = [...fastest.values()].filter((run) => run.players.some((player) => onRoster(members, player, edition))).length;
    return { guild, stats: stats.find((row) => row.guildId === guild.id) ?? null, points: best?.points ?? null, bracket: best?.bracket ?? null, rated: best?.rated ?? 0, runs: runs.length, records };
  });
}

export function filterGuildOverview(rows: GuildOverviewRow[], filters: Pick<GuildOverviewFilters, "q" | "faction" | "realm" | "sort">): GuildOverviewRow[] {
  const q = foldText(filters.q);
  const kept = rows.filter((row) => (!q || foldText(row.guild.name).includes(q))
    && (!filters.faction || row.stats?.faction === filters.faction)
    && (!filters.realm || (row.stats?.realm ?? "").toLowerCase() === filters.realm.toLowerCase()));
  const value = (row: GuildOverviewRow): number => {
    switch (filters.sort) {
      case "members": return row.stats?.members ?? -1;
      case "at60": return row.stats?.at60 ?? -1;
      case "level": return averageLevel(row.stats) ?? -1;
      case "runs": return row.runs;
      case "records": return row.records;
      case "duels": return row.stats?.duels ?? -1;
      default: return row.points ?? -1;
    }
  };
  return kept.sort((a, b) => (filters.sort === "name" ? 0 : value(b) - value(a)) || (b.points ?? -1) - (a.points ?? -1) || a.guild.name.localeCompare(b.guild.name));
}

/** Top-3 medal for a rank (1-based), or the plain number. */
export const rankCell = (rank: number) => rank <= 3 ? `<span class="medal m${rank}" aria-label="#${rank}">${rank}</span>` : `${rank}`;

/** Numbered page links: first, last and up to two pages each side of the current one. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

/**
 * The dungeon section of a guild's public page (/g/<slug>/): its members' top scores this season, its recent public
 * runs and its fastest clear of each dungeon. Only what /leaderboards/guild/<id> already shows; paths are edition-free.
 */
export interface GuildDungeonSummary {
  season: { en: string; fr: string };
  top: { name: string; realm: string; className: string | null; bracket: string; points: number; path: string }[];
  recent: { dungeon: string; time: string; date: string; points: number | null; path: string }[];
  records: { dungeon: string; time: string; date: string; path: string }[];
}
export async function guildDungeonSummary(store: LeaderboardStore, guildId: string, windows: OfficialWindow[] = DEFAULT_OFFICIAL, now = new Date(), limit = 10): Promise<GuildDungeonSummary> {
  const season = publicSeasons(now, windows)[0]!;
  const rules = periodRules(season);
  const runs = (await store.guildRuns(guildId, { from: season.from, to: season.to })).filter((run) => !run.challenge);
  const roster = new Set((await store.guildRoster(guildId)).map((name) => name.toLowerCase()));
  const top = characterScores(runs, rules).filter((row) => onRoster(roster, row.player as LeaderPlayer, currentEdition()))
    .sort((a, b) => b.points - a.points).slice(0, limit)
    .map((row) => ({ name: (row.player as LeaderPlayer).displayName || row.player.character, realm: row.player.realm, className: row.player.className, bracket: row.bracket, points: row.points, path: characterPath(row.player) }));
  const day = (value: Date) => value.toISOString().slice(0, 10);
  const recent = [...runs].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime()).slice(0, limit)
    .map((run) => ({ dungeon: run.dungeonName, time: formatDuration(run.durationSec), date: day(run.endedAt), points: rateRun(run, rules).score?.points ?? null, path: runPath(run.runId) }));
  const fastest = new Map<number, LeaderRun>();
  for (const run of runs) { const best = fastest.get(run.instanceId); if (!best || run.durationSec < best.durationSec) fastest.set(run.instanceId, run); }
  const records = [...fastest.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName))
    .map((run) => ({ dungeon: run.dungeonName, time: formatDuration(run.durationSec), date: day(run.endedAt), path: runPath(run.runId) }));
  return { season: { en: season.label, fr: season.labelFr }, top, recent, records };
}

export interface LeaderFilters {
  instanceId: number | null; season: string; week: boolean; bracket: string | null; className: string | null; role: string | null; realm: string | null; confirmed: boolean;
}
const brackets = () => (currentEdition() === "forever" ? DEFAULT_DUNGEON_BRACKETS : publicRules().brackets).map(bracket => bracket.key as string);

// Why a run is unranked (public-score.ts rateRun and the guild seasons' shared check), in French too.
const UNRANKED_FR: Record<string, string> = {
  "Automatic final-boss completion required": "Fin automatique au dernier boss requise",
  "Required encounter evidence missing": "Boss requis non enregistrés",
  "Dungeon route unknown": "Parcours du donjon inconnu",
  "Route not rated yet": "Parcours pas encore classé",
  "Participation-only route": "Parcours de participation seulement",
  "Target not calibrated": "Cible pas encore fixée",
  "Level range not configured": "Niveaux non configurés",
  "Different difficulty": "Autre difficulté",
  "Party levels unknown": "Niveaux du groupe inconnus",
  "Overlevel carry": "Groupe de trop haut niveau",
  "Below level range": "Sous les niveaux du parcours",
  "Presence under 80%": "Présence sous 80 %",
  "Current evidence required by this season": "Preuves actuelles requises pour cette saison",
  "Observed start provenance required": "Origine du début observé requise",
  "Observed first-combat start required": "Début au premier combat observé requis",
  "Native completion checkpoints required": "Boss de fin requis non observés par les événements du jeu",
  "Known in-instance presence under 80%": "Présence observée dans le donjon sous 80 %",
  "Run crosses season boundary": "Essai à cheval sur deux saisons",
  "Season upload grace expired": "Délai d'envoi de la saison expiré",
  "Run observation interrupted": "Observation de l'essai interrompue",
  "Official season window unavailable": "Période officielle de la saison indisponible",
  "Current-v2 evidence required": "Observations de la version actuelle requises"
};
export function unrankedText(ctx: Pick<WebContext, "t">, reason: string | undefined): string {
  const text = reason ?? "Not rated";
  return ctx.t(`Unranked: ${text}`, `Non classé : ${UNRANKED_FR[text] ?? text}`);
}

export function readLeaderFilters(query: URLSearchParams, now = new Date(), periods: PublicPeriod[] = publicSeasons(now)): LeaderFilters {
  const dungeon = Number(query.get("dungeon"));
  const season = query.get("season") ?? "";
  const role = dungeonRole(query.get("role")) ?? "";
  const realm = (query.get("realm") ?? "").trim().slice(0, 60);
  const known = season === "all" || periods.some((p) => p.id === season);
  return {
    instanceId: Number.isInteger(dungeon) && dungeon > 0 ? dungeon : null,
    season: known ? season : periods[0]!.id,
    week: query.get("period") === "week",
    bracket: periods.some(period => periodRules(period).brackets.some(bracket => bracket.key === query.get("bracket"))) || brackets().includes(query.get("bracket") ?? "") ? query.get("bracket") : null,
    className: query.get("class") ? classFromText(query.get("class")!) : null,
    role: (ROLES as readonly string[]).includes(role) ? role : null,
    realm: realm || null,
    confirmed: query.get("confirmed") === "1"
  };
}

/** The time span the filters ask for: this week, one season, or all time. */
export function filterPeriod(filters: Pick<LeaderFilters, "season" | "week">, now: Date, periods: PublicPeriod[] = publicSeasons(now)): PublicPeriod {
  if (filters.week) return { ...publicWeek(now), ...(periods[0] ? { rules: periodRules(periods[0]) } : {}) };
  return periods.find((p) => p.id === filters.season) ?? { id: "all", label: "All time", labelFr: "Depuis le début", from: null, to: null };
}

type PlayerFilters = Pick<LeaderFilters, "className" | "role" | "confirmed"> & { realm?: string | null };
const keepPlayer = (filters: PlayerFilters, rules?: BracketedRules) => (player: LeaderPlayer, run: ScoreRun) =>
  (!filters.confirmed || run.confirmations >= 2)
  && (!filters.className || player.className?.toLowerCase() === filters.className.toLowerCase())
  && (!filters.role || (rules?.evidencePolicy === "current-v2" ? integrityRole(player.integrity) : dungeonRole(player.role)) === dungeonRole(filters.role))
  && (!filters.realm || player.realm.toLowerCase() === filters.realm.toLowerCase());

export interface RankedEntry { player: LeaderPlayer; run: LeaderRun }

// Best run per character (name + realm), fastest first; an earlier finish wins a tie.
export function rankCharacters(runs: LeaderRun[], filters: PlayerFilters, limit = 100, rules?: BracketedRules): RankedEntry[] {
  const best = new Map<string, RankedEntry>();
  const keep = keepPlayer(filters, rules);
  for (const run of runs) {
    if (run.challenge) continue;
    for (const player of run.players) {
      if (!keep(player, run) || rules?.evidencePolicy && !rateRun(run, rules, player).score) continue;
      const id = characterId(player);
      const current = best.get(id);
      if (!current || run.durationSec < current.run.durationSec || (run.durationSec === current.run.durationSec && run.endedAt < current.run.endedAt)) best.set(id, { player, run });
    }
  }
  return [...best.values()].sort((a, b) => a.run.durationSec - b.run.durationSec || a.run.endedAt.getTime() - b.run.endedAt.getTime()).slice(0, limit);
}

export function dungeonSummaries(runs: LeaderRun[]): DungeonSummary[] {
  const map = new Map<number, DungeonSummary>();
  for (const run of runs) {
    if (run.challenge) continue;
    const row = map.get(run.instanceId) ?? { instanceId: run.instanceId, dungeonName: run.dungeonName, bestSec: run.durationSec, runs: 0 };
    row.runs += 1; row.bestSec = Math.min(row.bestSec, run.durationSec);
    map.set(run.instanceId, row);
  }
  return [...map.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName));
}

export const characterPath = (player: { character: string; realm: string }) => `/leaderboards/character/${encodeURIComponent(player.realm ? `${player.character}-${player.realm}` : player.character)}`;
export const runPath = (id: string) => `/leaderboards/run/${encodeURIComponent(id)}`;
const classSlug = (name: string | null) => (name ?? "").toLowerCase().replace(/[^a-z]/g, "");

// What the pages read of a public run, evidence included (player-profiles.ts reads the same).
export const PUBLIC_RUN_SELECT = { id: true, challenge: true, gameEdition: true, instanceId: true, routeKey: true, difficultyId: true, dungeonName: true, durationSec: true, startedAt: true, endedAt: true, deaths: true, bracket: true, season: true,
  confirmations: true, evidenceVersion: true, completedBy: true, encounters: true, integrity: true, evidenceReceivedAt: true,
  players: { select: { character: true, displayName: true, realm: true, className: true, role: true, level: true, minLevel: true, presentSec: true } } } as const satisfies Prisma.PublicRunSelect;
type PublicRunRow = Prisma.PublicRunGetPayload<{ select: typeof PUBLIC_RUN_SELECT }>;
export function leaderRun({ id, startedAt, evidenceVersion, completedBy, encounters, challenge, integrity, evidenceReceivedAt, ...row }: PublicRunRow): LeaderRun {
  const native = readChallenge(challenge);
  const data = integrity as { run?: unknown; players?: { character: string; realm: string; observation?: unknown }[] } | null;
  const observation = evidenceVersion >= 2 ? readDungeonIntegrity(data?.run) : null;
  const players = row.players.map(p => ({ ...p, ...(observation ? { integrity: readPlayerIntegrity(data?.players?.find(q => characterId(q) === characterId(p))?.observation) } : {}) }));
  return { runId: id, ...row, players, ...(native ? { challenge: native } : {}), evidence: evidenceVersion >= 1 ? { startedAt, completedBy, encounters: Array.isArray(encounters) ? encounters : [], ...(observation ? { integrity: observation, receivedAt: evidenceReceivedAt } : {}) } : null };
}
/**
 * Older uploads name a Forever character by its first name only ("El"). Where the same set of
 * runs also shows that character's full name ("El Pirata"), the bare one is displayed in full (the
 * `character` key, which identifies the score, is never changed).
 */
export function withFullDisplayNames(runs: LeaderRun[]): LeaderRun[] {
  const known = [...new Set(runs.flatMap(run => run.players.flatMap(p => [p.displayName, p.character])).filter((v): v is string => !!v && v.includes(" ")))];
  if (!known.length) return runs;
  return runs.map(run => ({ ...run, players: run.players.map(p => {
    const shown = p.displayName || p.character;
    const full = displayCharacterName(shown, known);
    return full === shown ? p : { ...p, displayName: full };
  }) }));
}
const newestFirst = (a: LeaderRun, b: LeaderRun) => b.endedAt.getTime() - a.endedAt.getTime();

export function prismaLeaderboardStore(database: PrismaClient, allows: (discordId: string) => boolean = () => true): LeaderboardStore {
  const range = (query: RunQuery) => ({ status: "ACCEPTED", ...(query.from || query.to ? { endedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
    ...(query.instanceId ? { instanceId: query.instanceId } : {}) });
  // Every matching run, a page at a time: scores need each character's whole history.
  async function every(where: Prisma.PublicRunWhereInput): Promise<LeaderRun[]> {
    const runs: LeaderRun[] = [];
    for (let cursor: string | null = null; ;) {
      const page: PublicRunRow[] = await database.publicRun.findMany({ where: { ...where, gameEdition: currentEdition() }, orderBy: { id: "asc" }, take: 5_000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: PUBLIC_RUN_SELECT });
      runs.push(...page.map(leaderRun));
      if (page.length < 5_000) return normalizeLeaderRuns(runs);
      cursor = page[page.length - 1]!.id;
    }
  }
  const guildsLoading = new Map<string, Promise<PublicGuild[]>>();
  async function loadGuilds(): Promise<PublicGuild[]> {
      const rows = await database.guildSettings.findMany({ where: { publicDungeonRuns: true, guild: { gameEdition: currentEdition(), isTestServer: false } }, select: { guildId: true, publicSlug: true, guild: { select: { name: true, discordId: true, page: { select: { slug: true, published: true } } } } }, take: 200 });
      const listed = rows.filter((row) => allows(row.guild.discordId));
      // A guild's address is stored the first time it is listed and never changes (a rename keeps it, old links keep working).
      if (listed.some((row) => !row.publicSlug)) {
        const taken = new Set((await database.guildSettings.findMany({ where: { publicSlug: { not: null } }, select: { publicSlug: true }, take: 5_000 })).flatMap((row) => row.publicSlug ?? []));
        for (const row of listed.filter((r) => !r.publicSlug).sort((a, b) => a.guildId.localeCompare(b.guildId))) {
          for (let attempt = 0; attempt < 4 && !row.publicSlug; attempt++) {
            const slug = freeSlug(row.guild.name, row.guildId, taken);
            try {
              // Only while still empty: a slug that was stored (here or by another process) is never overwritten.
              const done = await database.guildSettings.updateMany({ where: { guildId: row.guildId, publicSlug: null }, data: { publicSlug: slug } });
              if (done.count === 1) { row.publicSlug = slug; taken.add(slug); }
              else {
                const stored = await database.guildSettings.findUnique({ where: { guildId: row.guildId }, select: { publicSlug: true } });
                if (stored?.publicSlug) { row.publicSlug = stored.publicSlug; taken.add(stored.publicSlug); } else break;
              }
            } catch (error) {
              // Another guild took this slug: try the next one. Anything else is not a slug problem: leave the guild on its id for now.
              if ((error as { code?: string }).code === "P2002") taken.add(slug); else break;
            }
          }
        }
      }
      return listed.map((row) => ({ id: row.guildId, name: row.guild.name, publicSlug: row.publicSlug, slug: row.guild.page?.published ? row.guild.page.slug : null })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    async run(id) {
      const row = await database.publicRun.findFirst({ where: { id, status: "ACCEPTED", gameEdition: currentEdition() }, select: PUBLIC_RUN_SELECT });
      if (!row) return null;
      // Read it with the copies of the same clear around it, so every link to any copy shows the one merged run.
      const near = 600_000;
      const around = await every({ status: "ACCEPTED", instanceId: row.instanceId, difficultyId: row.difficultyId,
        endedAt: { gte: new Date(row.endedAt.getTime() - near), lte: new Date(row.endedAt.getTime() + near) } });
      return around.find((run) => run.runId === id || run.mergedIds?.includes(id)) ?? leaderRun(row);
    },
    async runs(query) {
      return (await every(range(query))).sort((a, b) => a.durationSec - b.durationSec || a.endedAt.getTime() - b.endedAt.getTime());
    },
    async characterRuns(character, realm) {
      // Older uploads store the first name only: "Hulke Hogan" is also found under "Hulke", and "Hulke" under "Hulke Hogan".
      const first = character.split(" ")[0]!;
      const names: Prisma.PublicRunPlayerWhereInput[] = [{ character: { equals: character, mode: "insensitive" } }, { character: { equals: first, mode: "insensitive" } },
        { character: { startsWith: `${character} `, mode: "insensitive" } }];
      return (await every({ status: "ACCEPTED", players: { some: { OR: names, ...(realm !== null ? { realm: { equals: realm, mode: "insensitive" } } : {}) } } })).sort(newestFirst);
    },
    async guilds() {
      // One load at a time per edition: concurrent cold requests share it.
      const edition = currentEdition();
      let load = guildsLoading.get(edition);
      if (!load) { load = loadGuilds().finally(() => guildsLoading.delete(edition)); guildsLoading.set(edition, load); }
      return load;
    },
    async guildRoster(guildId) {
      const rows = await database.character.findMany({ where: { member: { guildId, status: "ACTIVE" } }, select: { name: true, realm: true, gameEdition: true }, take: 5_000 });
      return rows.map((row) => characterKey(row.name, row.realm, row.gameEdition ?? "forever"));
    },
    async guildRuns(guildId, query) {
      return (await every({ ...range(query), uploads: { some: { uploaderKey: `guild:${guildId}` } } })).sort(newestFirst);
    },
    async guildDuelRatingStart(guildId) { return ratingStartOf(database, guildId); },
    async globalDuelRows() {
      const edition = currentEdition();
      const [rows, excluded, open, hiddenMembers] = await Promise.all([
        database.publicDuel.findMany({ where: { gameEdition: edition, counted: true }, orderBy: { endedAt: "desc" }, take: 50_000,
          select: { winnerKey: true, loserKey: true, winnerName: true, loserName: true, winnerRealm: true, loserRealm: true, winnerClass: true, loserClass: true, winnerLevel: true, loserLevel: true, winnerGuild: true, loserGuild: true,
            winnerMemberId: true, loserMemberId: true, endedAt: true, reason: true, zone: true, durationSec: true, reports: { select: { reporterCharacterKey: true, deviceId: true, guildId: true } } } }),
        database.publicDuelExclusion.findMany({ select: { deviceId: true }, take: 5_000 }),
        database.guildSettings.findMany({ where: { publicDungeonRuns: true, guild: { isTestServer: false } }, select: { guildId: true }, take: 5_000 }),
        database.member.findMany({ where: { OR: [{ raceHidden: true }, { isTest: true }] }, select: { id: true }, take: 20_000 })
      ]);
      const out = new Set(excluded.map((row) => row.deviceId)), allowed = new Set(open.map((row) => row.guildId)), hidden = new Set(hiddenMembers.map((row) => row.id));
      return rows.reverse().flatMap((row): GlobalDuel[] => {
        if ((row.winnerMemberId && hidden.has(row.winnerMemberId)) || (row.loserMemberId && hidden.has(row.loserMemberId))) return [];
        // A report counts when its device is not excluded and, for a guild server, that server shows public pages (a standalone addon has no server).
        const valid = row.reports.filter((report) => !(report.deviceId && out.has(report.deviceId)) && (!report.guildId || allowed.has(report.guildId)));
        if (!valid.length) return [];
        const reporters = [...new Set(valid.map((report) => report.reporterCharacterKey))];
        return [{ winnerKey: row.winnerKey, loserKey: row.loserKey, winner: row.winnerName, loser: row.loserName, winnerRealm: row.winnerRealm, loserRealm: row.loserRealm, winnerClass: row.winnerClass, loserClass: row.loserClass,
          winnerLevel: row.winnerLevel, loserLevel: row.loserLevel, winnerGuild: row.winnerGuild, loserGuild: row.loserGuild, endedAt: row.endedAt, reason: row.reason, zone: row.zone, durationSec: row.durationSec,
          reporters, confirmed: reporters.includes(row.winnerKey) && reporters.includes(row.loserKey) }];
      });
    },
    async guildDuelRows(guildId) {
      const edition = currentEdition();
      // Test members and members hidden from public boards never appear (the 8.5 "everything is shared" rule leaves raceHidden as the only per-member hide).
      const visible = { isTest: false, raceHidden: false };
      const [rows, characters, book] = await Promise.all([
        database.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, winner: visible, loser: visible }, orderBy: { endedAt: "desc" }, take: 20_000,
          select: { winnerId: true, loserId: true, winnerCharacter: true, loserCharacter: true, winnerLevel: true, loserLevel: true, endedAt: true, reason: true, winner: { select: { status: true } }, loser: { select: { status: true } } } }),
        database.character.findMany({ where: { gameEdition: edition, member: { guildId } }, select: { memberId: true, name: true, className: true }, take: 10_000 }),
        loadFullNameBook(database, guildId)
      ]);
      // The newest 20,000 duels, oldest first (a very busy guild loses its oldest results, never its latest).
      rows.reverse();
      const byMember = new Map<string, typeof characters>();
      for (const c of characters) { const list = byMember.get(c.memberId); if (list) list.push(c); else byMember.set(c.memberId, [c]); }
      const classOf = (memberId: string, name: string) => {
        const own = byMember.get(memberId) ?? [];
        const first = name.split(" ")[0]!.toLowerCase();
        return (own.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? own.find((c) => c.name.split(" ")[0]!.toLowerCase() === first) ?? (own.length === 1 ? own[0] : undefined))?.className ?? null;
      };
      const listed = (status: string) => status === "ACTIVE" || status === "TRIAL";
      return rows.map((row) => ({
        winnerKey: row.winnerId, loserKey: row.loserId,
        winner: displayCharacterName(row.winnerCharacter, book), loser: displayCharacterName(row.loserCharacter, book),
        winnerLevel: row.winnerLevel, loserLevel: row.loserLevel,
        winnerClass: classOf(row.winnerId, row.winnerCharacter), loserClass: classOf(row.loserId, row.loserCharacter),
        winnerShown: listed(row.winner.status), loserShown: listed(row.loser.status), endedAt: row.endedAt, reason: row.reason
      }));
    },
    async guildStats(guildIds) {
      if (!guildIds.length) return [];
      const edition = currentEdition();
      const [members, characters, listings, duels] = await Promise.all([
        database.member.groupBy({ by: ["guildId"], where: { guildId: { in: guildIds }, status: "ACTIVE", isTest: false }, _count: { _all: true } }),
        database.character.findMany({ where: { gameEdition: edition, member: { guildId: { in: guildIds }, status: "ACTIVE", isTest: false } },
          select: { memberId: true, level: true, realm: true, member: { select: { guildId: true, raceHidden: true } } }, take: 50_000 }),
        database.recruitmentListing.findMany({ where: { guildId: { in: guildIds }, open: true }, select: { guildId: true, faction: true, realm: true }, take: 2_000 }),
        database.duelResult.groupBy({ by: ["guildId"], where: { guildId: { in: guildIds }, gameEdition: edition, counted: true, winner: { isTest: false, raceHidden: false }, loser: { isTest: false, raceHidden: false } }, _count: { _all: true } })
      ]);
      return guildIds.map((guildId) => {
        const own = characters.filter((row) => row.member.guildId === guildId);
        const levels = own.filter((row) => !row.member.raceHidden && row.level !== null).map((row) => row.level!);
        const listing = listings.find((row) => row.guildId === guildId && (row.faction || row.realm));
        const realms = new Map<string, number>();
        for (const row of own) if (row.realm) realms.set(row.realm, (realms.get(row.realm) ?? 0) + 1);
        const commonRealm = [...realms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
        return {
          guildId, faction: listing?.faction ?? null, realm: listing?.realm ?? commonRealm,
          members: members.find((row) => row.guildId === guildId)?._count._all ?? 0,
          linked: new Set(own.map((row) => row.memberId)).size,
          levelled: levels.length, at60: levels.filter((level) => level >= LEVEL_CAP).length, levelSum: levels.reduce((sum, level) => sum + level, 0),
          duels: duels.find((row) => row.guildId === guildId)?._count._all ?? 0
        };
      });
    }
  };
}

const PAGE_CSS = `<style>.advanced-filters>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--gold)}.advanced-filters[open]>summary{margin-bottom:8px}details.rules{margin:0 0 20px}details.rules>summary{display:inline-flex;align-items:center;min-height:44px;cursor:pointer;color:var(--gold)}details.rules p{margin-top:4px}.empty-cta{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px 18px}.empty-cta p{margin:0 0 6px}.c-warrior{color:#c69b6d}.c-paladin{color:#f48cba}.c-hunter{color:#aad372}.c-rogue{color:#fff468}.c-priest{color:#fff}.c-shaman{color:#2a8cff}
.c-mage{color:#3fc7eb}.c-warlock{color:#8788ee}.c-druid{color:#ff7c0a}.c-deathknight{color:#c41e3a}.c-monk{color:#00ff98}.c-demonhunter{color:#a330c9}.c-evoker{color:#33937f}
a.char{text-decoration:none;font-weight:600}.score{font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums}.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:12px;color:var(--muted)}
.badge.ok{border-color:#4f7a4a;color:#9fd49a}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tabs a{border:1px solid var(--line);border-radius:6px;padding:4px 12px;text-decoration:none}.tabs a.on{background:var(--gold);color:#111;border-color:var(--gold)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}.hero{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline}.bar-cell{width:40%}.meter{height:8px;background:var(--gold);border-radius:4px}
.tabs.views a{font-weight:700;padding:6px 16px}.guild-list{columns:2;padding-left:18px}.grid2 section h2{margin-top:24px}
table.dense td,table.dense th{padding:5px 8px;font-size:14px;white-space:nowrap}table.dense td.wrap{white-space:normal}table.dense tbody tr:nth-child(odd){background:rgba(255,255,255,.025)}
.medal{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-weight:800;font-size:13px;color:#111}.medal.m1{background:#e8c47c}.medal.m2{background:#c7ccd1}.medal.m3{background:#c98b55}
.fac-alliance{color:#6fa8ff}.fac-horde{color:#ff6b5e}.pager{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:14px 0}.pager a,.pager span{min-width:36px;min-height:36px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:6px;padding:0 8px;text-decoration:none}.pager .on{background:var(--gold);color:#111;border-color:var(--gold)}.pager .gap{border:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0}.tile{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px}.tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.tile .v{font-size:22px;font-weight:700}
.run-card{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}.best-runs a{margin-right:6px}
thead th{position:sticky;top:0;background:var(--bg);z-index:1}
.bracket-switch{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}.bracket-switch a{min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border:1px solid var(--line);border-radius:6px;text-decoration:none;color:var(--text)}.bracket-switch a.on{background:var(--gold);color:#111;border-color:var(--gold)}
.class-name{font-weight:600}
@media(max-width:480px){.table-wrap{overflow-x:visible}table.rank-cards,table.rank-cards tbody,table.rank-cards tr,table.rank-cards td{display:block;width:auto;white-space:normal}table.rank-cards thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}table.rank-cards tr{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:0 0 8px}table.rank-cards td{border:0;padding:2px 0}table.rank-cards td.num{text-align:left}}</style>`;

export interface LeaderboardDeps { store: LeaderboardStore; personal: PersonalStore | null; now?: () => Date; cacheMs?: number;
  /** The owner's season calendar (official-seasons.ts); the seeded Season 1 when left out. */
  calendar?: () => Promise<OfficialWindow[]>;
  /** The character's Public picture (public-pictures.ts), shown on its page and card; none when left out. */
  picture?: (name: string, realm: string | null) => Promise<PublicPicture | null> }

export function createLeaderboardPages(deps: LeaderboardDeps): { route: WebRoute; meSection: (context: WebContext) => Promise<string> } {
  const now = deps.now ?? (() => new Date());
  const cacheMs = deps.cacheMs ?? 60_000;
  const cache = new Map<string, { at: number; value: unknown }>();
  const coldLoads = new Map<string, Promise<unknown>>();
  async function cached<T>(id: string, load: () => Promise<T>): Promise<T> {
    id = `${currentEdition()}:${id}`;
    const hit = cache.get(id);
    if (hit && now().getTime() - hit.at < cacheMs) return hit.value as T;
    // Concurrent cold requests for the same key share one load.
    const running = coldLoads.get(id);
    if (running) return running as Promise<T>;
    const loading = (async () => {
      const value = await load();
      cache.set(id, { at: now().getTime(), value });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return value;
    })();
    coldLoads.set(id, loading);
    try { return await loading; } finally { coldLoads.delete(id); }
  }
  // This request's seasons: the calendar, read at most once a minute.
  const seasonsNow = async () => publicSeasons(now(), await cached("calendar", () => deps.calendar?.() ?? Promise.resolve(DEFAULT_OFFICIAL)));
  const pageFilters = async (ctx: WebContext) => {
    const periods = await seasonsNow();
    const filters = readLeaderFilters(ctx.request.query, now(), periods);
    return { periods, filters, period: filterPeriod(filters, now(), periods) };
  };
  const periodRuns = (period: PublicPeriod) =>
    cached(`r:${period.id}:${period.from?.getTime() ?? ""}`, () => deps.store.runs({ from: period.from, to: period.to }));

  const time = (seconds: number) => formatDuration(seconds);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const who = (ctx: WebContext, player: LeaderPlayer) => `<a class="char c-${classSlug(player.className)}" href="${link(characterPath(player), ctx.lang)}">${escapeHtml(player.displayName || player.character)}</a>`
    + (player.realm ? ` <span class="tag">${escapeHtml(player.realm)}</span>` : "");
  const party = (ctx: WebContext, run: LeaderRun) => run.players.map((player) => `<a class="c-${classSlug(player.className)}" href="${link(characterPath(player), ctx.lang)}">${escapeHtml(player.displayName || player.character)}</a>`).join(", ");
  const trust = (ctx: WebContext, run: LeaderRun) => (run.confirmations >= 2
    ? `<span class="badge ok" title="${ctx.t("Party members' uploads agree", "Les envois des membres du groupe concordent")}">✔ ${ctx.t("Confirmed by party", "Confirmé par le groupe")} · ${run.confirmations}</span>`
    : `<span class="badge">${ctx.t("1 upload", "1 envoi")}</span>`)
    + (run.evidence ? "" : ` <span class="tag" title="${ctx.t("Uploaded before Guilded kept completion evidence: checked on route, difficulty and levels only.", "Envoyé avant que Guilded garde les preuves de fin : vérifié sur le parcours, la difficulté et les niveaux seulement.")}">${ctx.t("older check", "ancienne vérif.")}</span>`);
  const bracketName = (ctx: WebContext, key: string) => key === "60" ? ctx.t("Level 60", "Niveau 60") : `${ctx.t("Levels", "Niveaux")} ${key.replace("-", "–")}`;
  const periodName = (ctx: WebContext, period: PublicPeriod) => ctx.t(period.label, period.labelFr);
  // A run's score cell: its points, or a dash that says why it is unranked.
  const scoreCell = (ctx: WebContext, run: LeaderRun, rules: BracketedRules, player?: LeaderPlayer) => {
    const verdict = rateRun(run, rules, player);
    return verdict.score ? `${verdict.score.points}` : `<span title="${escapeHtml(unrankedText(ctx, verdict.reason))}">–</span>`;
  };
  const table = (head: string[], rows: string[], numeric: number[] = [], className = "") => `<div class="table-wrap"><table${className ? ` class="${className}"` : ""}><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  // Class once: the name keeps its class colour and the word sits beside it, in normal case.
  const identity = (ctx: WebContext, player: LeaderPlayer) => {
    const label = player.className ? classLabel(player.className, ctx.lang) : "";
    return `${who(ctx, player)}${label ? ` <span class="class-name c-${classSlug(player.className)}">${escapeHtml(label)}</span>` : ""}${guildTag(ctx, player)}`;
  };
  const chosenBracket = <T extends { key: string }>(list: T[], asked: string | null) => list.find((item) => item.key === asked) ?? list[0] ?? null;
  const bracketSwitch = (ctx: WebContext, list: { key: string }[], selected: string | null, href: (key: string) => string) => list.length < 2 ? ""
    : `<nav class="bracket-switch" aria-label="${ctx.t("Level bracket", "Tranche de niveaux")}">${list.map((item) => `<a class="${item.key === selected ? "on" : ""}" href="${href(item.key)}">${escapeHtml(bracketName(ctx, item.key))}</a>`).join("")}</nav>`;

  function filterForm(ctx: WebContext, filters: LeaderFilters, dungeons: DungeonSummary[], periods: PublicPeriod[]): string {
    const { t, lang } = ctx;
    const any = { value: "", label: t("Any", "Tous") };
    const seasons = periods.map((p) => ({ value: p.id, label: periodName(ctx, p) }));
    const classes = FOREVER_CLASSES;
    const advanced = Boolean(filters.instanceId || filters.className || filters.role || filters.realm || filters.confirmed);
    return `<form class="filters" method="get" action="/leaderboards/"><input type="hidden" name="lang" value="${lang}">`
      + `<input type="hidden" name="edition" value="${escapeHtml(currentEdition())}">`
      + `<div><label for="season">${t("Season", "Saison")}</label><select id="season" name="season">${options([...seasons, { value: "all", label: t("All time", "Depuis le début") }], filters.season)}</select></div>`
      + `<div><label for="period">${t("Period", "Période")}</label><select id="period" name="period">${options([{ value: "", label: t("Whole season", "Toute la saison") }, { value: "week", label: t("This week", "Cette semaine") }], filters.week ? "week" : "")}</select></div>`
      + `<div><label for="bracket">${t("Levels", "Niveaux")}</label><select id="bracket" name="bracket">${options([any, ...[...new Set([...brackets(), ...periods.flatMap(period => periodRules(period).brackets.map(b => b.key))])].map((value) => ({ value, label: bracketName(ctx, value) }))], filters.bracket)}</select></div>`
      + `<div><button class="button" type="submit">${t("Show rankings", "Afficher le classement")}</button></div>`
      + `<details class="advanced-filters" style="grid-column:1/-1"${advanced ? " open" : ""}><summary>${t("More filters", "Plus de filtres")}${advanced ? ` · ${t("active", "actifs")}` : ""}</summary><div class="filters">`
      + `<div><label for="dungeon">${t("Dungeon", "Donjon")}</label><select id="dungeon" name="dungeon">${options([{ value: "", label: t("All dungeons", "Tous les donjons") }, ...dungeons.map((d) => ({ value: String(d.instanceId), label: d.dungeonName }))], filters.instanceId ? String(filters.instanceId) : "")}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([any, ...classes.map((name) => ({ value: name, label: classLabel(name, lang) }))], filters.className)}</select></div>`
      + `<div><label for="role">${t("Role", "Rôle")}</label><select id="role" name="role">${options([any, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], filters.role)}</select></div>`
      + `<div><label for="realm">${t("Realm", "Royaume")}</label><input id="realm" name="realm" maxlength="60" value="${escapeHtml(filters.realm ?? "")}"></div>`
      + `<div><label><input type="checkbox" style="width:auto" name="confirmed" value="1"${filters.confirmed ? " checked" : ""}> ${t("Confirmed by the party", "Confirmés par le groupe")}</label></div>`
      + `<div><button class="button" type="submit">${t("Apply filters", "Appliquer les filtres")}</button></div></div></details></form>`;
  }

  function scoreTable(ctx: WebContext, rows: ScoreRow[], limit: number): string {
    const { t, lang } = ctx;
    if (!rows.length) return `<p class="muted">${t("No rated run yet.", "Aucun essai classé pour l'instant.")}</p>`;
    return table(["#", t("Character", "Personnage"), t("Role", "Rôle"), t("Score", "Score"), t("Routes", "Parcours")],
      rows.slice(0, limit).map((row, i) => `<tr><td>${rankCell(i + 1)}</td><td>${identity(ctx, row.player)}</td>`
        + `<td>${row.player.role ? escapeHtml(roleLabel(row.player.role, lang)) : ""}</td><td class="num score">${row.points}</td><td class="num">${row.routes.filter((r) => r.counted).length}/${row.routes.length}</td></tr>`), [3, 4], "rank-cards");
  }

  function topRuns(ctx: WebContext, runs: LeaderRun[], filters: LeaderFilters, rules: BracketedRules, limit = 10): string {
    const { t } = ctx;
    const keep = keepPlayer(filters, rules);
    const rated = runs.flatMap((run) => { const s = rateRun(run, rules).score; return s && (!filters.bracket || s.bracket === filters.bracket)
      && run.players.some((p) => keep(p, run) && (rules.evidencePolicy !== "current-v2" || rateRun(run, rules, p).score)) ? [{ run, s }] : []; })
      .sort((a, b) => b.s.points - a.s.points || a.run.durationSec - b.run.durationSec).slice(0, limit);
    if (!rated.length) return `<div class="empty-cta"><p><strong>${t("No rated standard dungeon run this week yet. Be the first on the board.", "Aucun essai de donjon standard classé cette semaine. Soyez le premier au classement.")}</strong></p>`
      + `<p class="muted">${t("Install Guilded Dungeons, clear a dungeon with your group, then sync your runs with the companion.", "Installez Guilded Dungeons, terminez un donjon en groupe, puis synchronisez vos essais avec le compagnon.")} `
      + `<a href="${link("/editions/", ctx.lang)}">${t("Download", "Télécharger")}</a> · <a href="/docs/DUNGEONS_GUIDE.html${ctx.lang === "fr" ? "#fr" : ""}">${t("How it works", "Comment ça marche")}</a></p></div>`;
    return table([t("Dungeon", "Donjon"), t("Levels", "Niveaux"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), ""],
      rated.map(({ run, s }) => `<tr><td>${escapeHtml(run.dungeonName)}</td><td>${escapeHtml(bracketName(ctx, s.bracket))}</td><td class="num">${time(run.durationSec)}</td>`
        + `<td class="num score">${s.points}${s.penaltyPercent ? ` <span class="tag">−${s.penaltyPercent}%</span>` : ""}</td><td>${party(ctx, run)}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3]);
  }

  // Best next improvement (public-guidance.ts): scenarios under the season's rules, not predictions.
  function planSection(ctx: WebContext, plan: ImprovementPlan, rules: BracketedRules): string {
    const { t } = ctx;
    const n = plan.bestCount;
    const nameOf = (key: string) => escapeHtml(plan.routes.find((r) => r.key === key)?.name ?? key);
    const season = (total: number) => `(${t("season", "saison")} ${total})`;
    const levels = (r: RoutePlan) => (r.band.min === r.band.max ? `${r.band.min}` : `${r.band.min}–${r.band.max}`)
      + (r.penaltyPercent ? ` <span class="tag" title="${t(`Over-level penalty at level ${plan.level}`, `Pénalité de niveau au niveau ${plan.level}`)}">−${r.penaltyPercent}%</span>` : "");
    const nextGain = (r: RoutePlan): string => {
      if (r.fit === "carry") return t(`Not ranked at level ${plan.level}: more than ${rules.overlevelPenalty.maxLevels} levels above this route.`, `Non classé au niveau ${plan.level} : plus de ${rules.overlevelPenalty.maxLevels} niveaux au-dessus de ce parcours.`);
      const next = r.next;
      if (!next) return r.best?.points === 400 ? t("Already 400, the maximum.", "Déjà 400, le maximum.") : t("No run here can raise the season score.", "Aucun essai ici ne peut faire monter le score de saison.");
      const from = r.fit === "below" ? t(`From level ${r.band.min}: `, `Dès le niveau ${r.band.min} : `) : "";
      const when = next.durationSec === null ? t("Any ranked clear", "Tout essai classé") : time(next.durationSec);
      const out = next.pushedOut.map((o) => ` · ${t("replaces", "remplace")} ${nameOf(o.key)} (${o.points})`).join("");
      // Outside best N, a faster run raises the route alone: say plainly that it adds nothing yet.
      const nothing = plan.weakest && r.best && !r.best.counted && next.durationSec !== null
        ? `<br><span class="muted">${t(`Beating ${time(r.best.durationSec)} adds nothing until the run scores over ${plan.weakest.points}.`, `Battre ${time(r.best.durationSec)} n'ajoute rien tant que l'essai ne dépasse pas ${plan.weakest.points}.`)}</span>` : "";
      return `${from}<strong>${when}</strong> → +${next.gain} ${season(next.total)}${out}${nothing}`;
    };
    const lead = plan.counted < n
      ? t(`Places filled in the best ${n}: ${plan.counted}. Any ranked clear of a route not counted yet adds its whole score.`, `Places remplies parmi les ${n} meilleurs : ${plan.counted}. Tout essai classé d'un parcours qui ne compte pas encore ajoute tout son score.`)
      : plan.easiest?.next ? (plan.easiest.next.durationSec === null
        ? t(`Most within reach: any ranked clear of ${nameOf(plan.easiest.key)} adds at least ${plan.easiest.next.gain} (season score ${plan.total} → ${plan.easiest.next.total}).`, `Le plus accessible : tout essai classé de ${nameOf(plan.easiest.key)} ajoute au moins ${plan.easiest.next.gain} (score de saison ${plan.total} → ${plan.easiest.next.total}).`)
        : t(`Most within reach: ${nameOf(plan.easiest.key)} in ${time(plan.easiest.next.durationSec)} adds ${plan.easiest.next.gain} (season score ${plan.total} → ${plan.easiest.next.total}).`, `Le plus accessible : ${nameOf(plan.easiest.key)} en ${time(plan.easiest.next.durationSec)} ajoute ${plan.easiest.next.gain} (score de saison ${plan.total} → ${plan.easiest.next.total}).`))
        : t("No run in this bracket can raise the season score.", "Aucun essai de cette tranche ne peut faire monter le score de saison.");
    const outside = plan.weakest ? ` ${t(`Outside the best ${n}, a run adds nothing until it scores over ${plan.weakest.points} (${nameOf(plan.weakest.key)}, the lowest counted route).`, `Hors des ${n} meilleurs, un essai n'ajoute rien tant qu'il ne dépasse pas ${plan.weakest.points} (${nameOf(plan.weakest.key)}, le plus bas des parcours comptés).`)}` : "";
    const assumed = plan.level !== null ? t(` Level ${plan.level} is taken as the party's highest.`, ` Le niveau ${plan.level} est pris comme le plus haut du groupe.`) : "";
    const status = (r: RoutePlan) => {
      const eligibility = r.fit === "unknown" ? t("Level unknown; eligibility unverified.", "Niveau inconnu; admissibilité non vérifiée.")
        : r.fit === "below" ? t(`Eligible from level ${r.band.min}.`, `Admissible dès le niveau ${r.band.min}.`)
          : r.fit === "carry" ? t("Overlevel: unranked.", "Niveau trop élevé : non classé.")
            : t("Level fits; boss evidence and 80% presence still required.", "Niveau admissible; preuve des boss et présence de 80 % requises.");
      const best = r.best ? (r.best.evidence === "legacy" ? t("Current best: legacy evidence.", "Meilleur actuel : preuves anciennes.")
        : t("Current best: ranked evidence.", "Meilleur actuel : preuves de classement.")) + " "
        + t(`${r.best.confirmations} independent report(s).`, `${r.best.confirmations} rapport(s) indépendant(s).`) : t("No ranked best yet.", "Aucun meilleur essai classé.");
      return `${eligibility}<br>${best}<br>${t("Scenario: no run or confirmation yet.", "Scénario : aucun essai ni confirmation pour l'instant.")}`;
    };
    return `<h2>${t("Best next improvement", "Meilleure prochaine amélioration")} · ${escapeHtml(bracketName(ctx, plan.bracket))}</h2>`
      + `<p class="muted">${t(`Scenarios, not predictions. For each route: the slowest clear that would add at least ${GAIN_STEP} points to the season score (or all that is left) once the best ${n} routes are picked again, and exactly what that clear adds; a faster one adds more. The run must be ranked (final boss seen, 80% presence); targets are this season's.`,
        `Des scénarios, pas des prédictions. Pour chaque parcours : le temps le plus lent qui ajouterait au moins ${GAIN_STEP} points au score de saison (ou ce qui reste) une fois les ${n} meilleurs parcours choisis de nouveau, et ce que ce temps ajoute exactement; plus rapide ajoute plus. L'essai doit être classé (dernier boss vu, présence de 80 %); les cibles sont celles de la saison.`)}${assumed}</p>`
      + `<p>${lead}${outside}</p>`
      + table([t("Dungeon", "Donjon"), t("Levels", "Niveaux"), t("Target", "Cible"), t("Best", "Meilleur"), t(`In best ${n}`, `Dans les ${n} meilleurs`), t("Next gain (scenario)", "Prochain gain (scénario)"), t("Eligibility and trust", "Admissibilité et confiance")],
        plan.routes.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${levels(r)}</td><td class="num">${time(r.targetSec)}</td>`
          + `<td class="num">${r.best ? `${time(r.best.durationSec)} · <span class="score">${r.best.points}</span>` : "–"}</td><td>${r.best ? (r.best.counted ? "✔" : t("no", "non")) : "–"}</td><td>${nextGain(r)}</td><td>${status(r)}</td></tr>`), [2, 3]);
  }

  // Tank, healer and DPS scores, each from that role's runs only: separate, never added together.
  function roleSection(ctx: WebContext, period: PublicPeriod, scores: ReturnType<typeof roleScores>, brackets: string[]): string {
    const { t, lang } = ctx;
    const n = scores.unknownRuns;
    return `<h2>${t("Score by role", "Score par rôle")} · ${escapeHtml(periodName(ctx, period))}</h2>`
      + `<p class="muted">${t("Each role's score uses only the runs played in that role. They are separate scores, never added together.", "Le score de chaque rôle n'utilise que les essais joués dans ce rôle. Ce sont des scores séparés, jamais additionnés.")}</p>`
      + table([t("Role", "Rôle"), ...brackets.map((b) => escapeHtml(bracketName(ctx, b)))],
        scores.roles.map(({ role, rows }) => `<tr><td>${escapeHtml(roleLabel(role, lang))}</td>${brackets.map((b) => { const row = rows.find((r) => r.bracket === b); return `<td class="num${row ? " score" : ""}">${row?.points ?? "–"}</td>`; }).join("")}</tr>`),
        brackets.map((_, i) => i + 1))
      + (n ? `<p class="muted">${n === 1
        ? t("1 ranked run has no recorded role: it counts in the overall score only.", "1 essai classé n'a pas de rôle enregistré : il compte seulement dans le score global.")
        : t(`${n} ranked runs have no recorded role: they count in the overall score only.`, `${n} essais classés n'ont pas de rôle enregistré : ils comptent seulement dans le score global.`)}</p>` : "");
  }

  const utcBoundary = (value: Date) => value.toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const periodDates = (ctx: WebContext, period: PublicPeriod) => `<p class="muted">${ctx.t("Selected period", "Période sélectionnée")}: ${escapeHtml(periodName(ctx, period))} · ${period.from ? utcBoundary(period.from) : ctx.t("earliest records", "premiers essais")} → ${period.to ? utcBoundary(period.to) + " (" + ctx.t("exclusive", "exclu") + ")" : ctx.t("ongoing", "en cours")}</p>`;
  const intro = (ctx: WebContext, period: PublicPeriod) => currentEdition() !== "forever"
    ? `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${ctx.t("Dungeon leaderboards", "Classements des donjons")}</h1><p>${ctx.t("Runs from this WoW edition only. Dungeon ratings require reviewed season routes and targets; Mythic+ has a separate keystone leaderboard.", "Essais de cette version de WoW seulement. Les cotes nécessitent des parcours et cibles de saison vérifiés; Mythic+ possède son propre classement de clés.")}</p>`
    : `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${ctx.t("Dungeon leaderboards", "Classements des donjons")}</h1>`
    // One plain sentence first; the full scoring and evidence rules stay one click away.
    + `<p>${ctx.t("The fastest dungeon clears by players and guilds using Guilded. Beat the final boss with your group, sync your runs and climb the board.", "Les donjons les plus rapides des joueurs et des guildes qui utilisent Guilded. Battez le boss final en groupe, synchronisez vos essais et montez au classement.")}</p>`
    + `<details class="rules"><summary>${ctx.t("How scores work", "Comment les scores sont calculés")}</summary><p class="muted">${ctx.t("Team-clear scores and times from Guilded and Guilded Dungeons. Current evidence requires detected final-boss completion and at least 80% recorded presence per credited player. Presence is an observer report, not proof of individual contribution. Round(200 × target ÷ time), clamp to 50–400 before the level penalty, then round again: 50 becomes 35 with a 30% penalty. Ranked runs stay in the route's bracket, including allowed overlevel players. Best distinct routes count; targets remain provisional.",
      "Scores et temps d'équipe de Guilded et Guilded Dungeons. Les preuves actuelles exigent le boss final détecté et au moins 80 % de présence enregistrée par joueur crédité. Cette présence est une observation, pas une preuve de contribution individuelle. Arrondi(200 × cible ÷ temps), limité à 50–400 avant pénalité de niveau, puis nouvel arrondi : 50 devient 35 avec 30 % de pénalité. Les essais classés restent dans la tranche du parcours, même avec un dépassement de niveau autorisé. Les meilleurs parcours distincts comptent; les cibles restent provisoires.")}`
    + (periodRules(period).evidencePolicy ? ` ${ctx.t("This season requires current stored evidence; legacy records remain visible without competitive credit.", "Cette saison exige les preuves actuelles enregistrées; les anciens essais restent visibles sans crédit compétitif.")}`
      : ` ${ctx.t("Compatibility history retains its original evidence rules; it is not current-evidence official scoring.", "L'historique compatible conserve ses règles de preuve originales; ce n'est pas le classement officiel avec preuves actuelles.")}`)
    + (periodRules(period).evidencePolicy === "current-v2" ? ` ${ctx.t("Native boss events are the foundation. Coverage follows this season's catalog; provisional final-boss routes do not prove a full untouched instance. Freshness remains unknown. Participation uses sourced observation intervals, with mixed roles counted overall only.", "Les événements de boss du jeu sont la base. La couverture suit le catalogue de cette saison; les parcours provisoires au boss final ne prouvent pas une instance complète et intacte. L'état initial reste inconnu. La participation utilise des intervalles d'observation avec leur source; les rôles mixtes comptent seulement au total.")}` : "")
    + (period.frozenAt ? ` ${ctx.t(`This season's rules were frozen on ${date(period.frozenAt)}.`, `Les règles de cette saison sont figées depuis le ${date(period.frozenAt)}.`)}` : "") + `</p></details>`;

  // Characters | Guilds: the two rankings, like Raider.IO's top tabs.
  const views = (ctx: WebContext, active: "characters" | "guilds" | "rankings", filters: LeaderFilters) => `<nav class="tabs views" aria-label="${ctx.t("Rankings", "Classements")}">`
    + `<a class="${active === "characters" && !filters.week ? "on" : ""}" href="${link("/leaderboards/", ctx.lang, { season: filters.season })}">${ctx.t("Overview", "Aperçu")}</a>`
    + `<a class="${active === "rankings" ? "on" : ""}" href="${link("/leaderboards/characters/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null, bracket: filters.bracket })}">${ctx.t("Characters", "Personnages")}</a>`
    + `<a class="${active === "guilds" ? "on" : ""}" href="${link("/leaderboards/guilds/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null })}">${ctx.t("Guilds", "Guildes")}</a>`
    + `<a class="${active === "characters" && filters.week ? "on" : ""}" href="${link("/leaderboards/", ctx.lang, { period: "week" })}">${ctx.t("This week", "Cette semaine")}</a></nav>`;
  const guildRuns = (id: string, period: PublicPeriod) => cached(`g:${id}:${period.id}:${period.from?.getTime() ?? ""}`, () => deps.store.guildRuns(id, { from: period.from, to: period.to }));
  async function guildEntries(period: PublicPeriod) {
    const guilds = await cached("guilds", () => deps.store.guilds());
    return Promise.all(guilds.map(async (guild) => ({ guild, runs: await guildRuns(guild.id, period), roster: await cached(`roster:${guild.id}`, () => deps.store.guildRoster(guild.id)) })));
  }
  async function guildRanks(period: PublicPeriod): Promise<GuildRank[]> {
    return rankGuilds(await guildEntries(period), periodRules(period));
  }
  // Per request: readable guild addresses and "which public guild is this character in". Only characters on a listed
  // guild's roster with at least one public run of that guild in the period are tagged (what the guild page already
  // shows); a character found in two guilds gets no tag. Built only for pages that need it, shared by concurrent
  // requests of the same edition and period, and never able to fail a page (an error leaves addresses as ids, no tags).
  interface GuildIndex { slugs: Map<string, string>; byKey: Map<string, PublicGuild | null> }
  const emptyIndex = (): GuildIndex => ({ slugs: new Map(), byKey: new Map() });
  const indexes = new WeakMap<WebContext, GuildIndex>();
  const inflight = new Map<string, Promise<GuildIndex>>();
  async function ensureIndex(ctx: WebContext, period?: PublicPeriod): Promise<GuildIndex> {
    const edition = currentEdition();
    const chosen = period ?? (await pageFilters(ctx)).period;
    const key = `guild-index:${edition}:${chosen.id}:${chosen.from?.getTime() ?? ""}`;
    let promise = inflight.get(key);
    if (!promise) {
      promise = cached(key, async (): Promise<GuildIndex> => {
        const guilds = await cached("guilds", () => deps.store.guilds());
        const entries = await Promise.all(guilds.map(async (guild) => ({ guild, runs: await guildRuns(guild.id, chosen), roster: await cached(`roster:${guild.id}`, () => deps.store.guildRoster(guild.id)) })));
        const byKey = new Map<string, PublicGuild | null>();
        for (const { guild, runs, roster } of entries) {
          const members = new Set(roster.map((name) => name.toLowerCase()));
          for (const run of runs) for (const player of run.players) {
            if (!onRoster(members, player, edition)) continue;
            for (const name of [player.character, ...(player.aliases ?? [])]) {
              const k = characterKey(name, player.realm, edition);
              byKey.set(k, byKey.has(k) && byKey.get(k)?.id !== guild.id ? null : guild);
            }
          }
        }
        return { slugs: guildSlugs(guilds), byKey };
      });
      inflight.set(key, promise);
      promise.then(() => inflight.delete(key), () => inflight.delete(key));
    }
    let index: GuildIndex;
    try { index = await promise; } catch { index = emptyIndex(); }
    indexes.set(ctx, index);
    return index;
  }
  const indexOf = (ctx: WebContext) => indexes.get(ctx) ?? emptyIndex();
  // Counts for every listed guild in one cached list: each page picks its guild(s) by guildId.
  const allGuildStats = (): Promise<GuildStats[]> => deps.store.guildStats
    ? cached(`guild-stats:${currentEdition()}`, async () => deps.store.guildStats!((await cached("guilds", () => deps.store.guilds())).map((g) => g.id)))
    : Promise.resolve([]);
  const guildPath = (ctx: WebContext, guild: PublicGuild) => `/leaderboards/guild/${encodeURIComponent(indexOf(ctx).slugs.get(guild.id) ?? guild.publicSlug ?? guild.id)}`;
  const guildLink = (ctx: WebContext, guild: PublicGuild) => `<a href="${link(guildPath(ctx, guild), ctx.lang)}">${escapeHtml(guild.name)}</a>`;
  const guildOf = (ctx: WebContext, player: LeaderPlayer): PublicGuild | null => {
    const index = indexOf(ctx);
    // Only a roster character with a public run of that guild is tagged. The uploader-supplied player.guild text is stored for later, validated use and never printed.
    return [player.character, ...(player.aliases ?? [])].map((name) => index.byKey.get(characterKey(name, player.realm, currentEdition()))).find((guild) => guild) ?? null;
  };
  const guildTag = (ctx: WebContext, player: LeaderPlayer) => {
    const guild = guildOf(ctx, player);
    return guild ? ` <span class="tag guild-tag">&lt;${guildLink(ctx, guild)}&gt;</span>` : "";
  };
  function guildTable(ctx: WebContext, ranks: GuildRank[], limit: number): string {
    const { t } = ctx;
    if (!ranks.length) return `<p class="muted">${t("No rated guild yet.", "Aucune guilde classée pour l'instant.")}</p>`;
    return table(["#", t("Guild", "Guilde"), t("Score", "Score"), t("Rated", "Classés"), t("Best character", "Meilleur personnage")],
      ranks.slice(0, limit).map((rank, i) => `<tr><td>${rankCell(i + 1)}</td><td>${guildLink(ctx, rank.guild)}</td><td class="num score">${rank.points}</td><td class="num">${rank.rated}</td><td>${who(ctx, rank.best.player)} <span class="tag">${rank.best.points}</span></td></tr>`), [2, 3]);
  }

  // The guild leaderboard table: every listed guild in one dense, filterable, sortable table.
  const GUILDS_PER_PAGE = 50;
  function guildOverviewSection(ctx: WebContext, rows: GuildOverviewRow[], period: LeaderFilters, withStats: boolean): string {
    const { t, lang } = ctx;
    const filters = readGuildOverviewFilters(ctx.request.query);
    const shown = filterGuildOverview(rows, filters);
    const pages = Math.max(1, Math.ceil(shown.length / GUILDS_PER_PAGE));
    const page = Math.min(filters.page, pages);
    const keep = { season: period.season, period: period.week ? "week" : null, q: filters.q || null, faction: filters.faction, realm: filters.realm, sort: filters.sort === "score" ? null : filters.sort };
    const realms = [...new Set(rows.flatMap((row) => row.stats?.realm ?? []))].sort((a, b) => a.localeCompare(b));
    const sortLabels: Record<GuildSort, string> = { score: t("Dungeon score", "Score de donjon"), members: t("Members", "Membres"), at60: t("Characters at 60", "Personnages au niveau 60"),
      level: t("Average level", "Niveau moyen"), runs: t("Public runs", "Essais publics"), records: t("Dungeon records", "Records de donjon"), duels: t("Duels", "Duels"), name: t("Name", "Nom") };
    const any = { value: "", label: t("Any", "Tous") };
    const form = `<form class="filters" method="get" action="/leaderboards/guilds/"><input type="hidden" name="lang" value="${lang}">`
      + (period.week ? `<input type="hidden" name="period" value="week">` : `<input type="hidden" name="season" value="${escapeHtml(period.season)}">`)
      + `<div><label for="gq">${t("Guild name", "Nom de la guilde")}</label><input id="gq" name="q" type="search" maxlength="40" value="${escapeHtml(filters.q)}"></div>`
      + `<div><label for="gfaction">${t("Faction", "Faction")}</label><select id="gfaction" name="faction">${options([any, ...FACTIONS.map((value) => ({ value, label: factionLabel(value, lang) }))], filters.faction)}</select></div>`
      + `<div><label for="grealm">${t("Realm", "Royaume")}</label><select id="grealm" name="realm">${options([any, ...realms.map((value) => ({ value, label: value }))], filters.realm)}</select></div>`
      + `<div><label for="gsort">${t("Sort by", "Trier par")}</label><select id="gsort" name="sort">${options(GUILD_SORTS.map((value) => ({ value, label: sortLabels[value] })), filters.sort)}</select></div>`
      + `<div><button class="button" type="submit">${t("Show guilds", "Afficher les guildes")}</button></div></form>`;
    const dash = `<span class="muted">–</span>`;
    const num = (value: number | null | undefined) => value === null || value === undefined ? dash : String(value);
    const faction = (value: string | null | undefined) => value ? `<span class="fac-${value.toLowerCase()}">${escapeHtml(factionLabel(value, lang))}</span>` : dash;
    const head = ["#", t("Guild", "Guilde"), t("Faction", "Faction"), t("Realm", "Royaume"),
      ...(withStats ? [t("Members", "Membres"), t("Linked", "Liés"), t("At 60", "Niv. 60"), t("Avg. level", "Niv. moyen")] : []),
      t("Dungeon score", "Score de donjon"), t("Rated", "Classés"), t("Runs", "Essais"), t("Records", "Records"), ...(withStats ? [t("Duels", "Duels")] : [])];
    const numeric = withStats ? [4, 5, 6, 7, 8, 9, 10, 11, 12] : [4, 5, 6, 7];
    const table = shown.length ? `<div class="table-wrap"><table class="dense"><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>`
      + shown.slice((page - 1) * GUILDS_PER_PAGE, page * GUILDS_PER_PAGE).map((row, index) => {
        const rank = (page - 1) * GUILDS_PER_PAGE + index + 1;
        const s = row.stats;
        const name = `${guildLink(ctx, row.guild)}${row.guild.slug ? ` <a class="tag" href="/g/${encodeURIComponent(row.guild.slug)}/">${t("page", "page")}</a>` : ""}`;
        return `<tr><td>${rankCell(rank)}</td><td class="wrap">${name}</td><td>${faction(s?.faction)}</td><td>${s?.realm ? escapeHtml(s.realm) : dash}</td>`
          + (withStats ? `<td class="num">${num(s?.members)}</td><td class="num">${num(s?.linked)}</td><td class="num" title="${t("Linked characters at level 60, out of those with a known level", "Personnages liés au niveau 60, sur ceux dont le niveau est connu")}">${s ? `${s.at60}<span class="tag">/${s.levelled}</span>` : dash}</td><td class="num">${num(averageLevel(s))}</td>` : "")
          + `<td class="num score">${row.points === null ? dash : `${row.points}`}${row.bracket ? ` <span class="tag">${escapeHtml(row.bracket.replace("-", "–"))}</span>` : ""}</td><td class="num">${row.rated}</td><td class="num">${row.runs}</td><td class="num">${row.records}</td>`
          + (withStats ? `<td class="num">${s?.duels ? `<a href="${link(`${guildPath(ctx, row.guild)}/duels`, lang)}">${num(s.duels)}</a>` : num(s?.duels)}</td>` : "") + `</tr>`;
      }).join("") + `</tbody></table></div>`
      : `<p class="muted">${t("No guild matches these filters.", "Aucune guilde ne correspond à ces filtres.")}</p>`;
    return `<h2>${t("All guilds", "Toutes les guildes")} <span class="tag">(${shown.length})</span></h2>` + form + table + pager(ctx, "/leaderboards/guilds/", keep, page, pages)
      + `<p class="muted">${t("Dungeon score: the guild's best level bracket this period (its five best members). Records: dungeons whose fastest public clear this period has one of its members. Members, linked and levels are counts from the guild's Guilded data, never names; members hidden from the race to 60 board are not counted in levels. Faction and realm come from the guild's recruitment listing. Gear score is not shown: Guilded has no gear data yet.",
        "Score de donjon : la meilleure tranche de niveaux de la guilde pour la période (ses cinq meilleurs membres). Records : donjons dont l'essai public le plus rapide de la période compte un de ses membres. Membres, liés et niveaux sont des nombres tirés des données Guilded de la guilde, jamais des noms; les membres masqués de la course au 60 ne comptent pas dans les niveaux. Faction et royaume viennent de l'annonce de recrutement de la guilde. Le score d'équipement n'est pas affiché : Guilded n'a pas encore de données d'équipement.")}</p>`;
  }

  // Previous / numbered / next page links, keeping the page's filters.
  function pager(ctx: WebContext, path: string, keep: Record<string, string | null | undefined>, page: number, pages: number): string {
    if (pages <= 1) return "";
    const { t, lang } = ctx;
    const to = (n: number) => link(path, lang, { ...keep, page: n > 1 ? String(n) : null });
    return `<nav class="pager" aria-label="${t("Pages", "Pages")}">`
      + (page > 1 ? `<a href="${to(page - 1)}" rel="prev">${t("Previous", "Précédent")}</a>` : "")
      + pageNumbers(page, pages).map((n) => n === null ? `<span class="gap">…</span>` : n === page ? `<span class="on" aria-current="page">${n}</span>` : `<a href="${to(n)}">${n}</a>`).join("")
      + (page < pages ? `<a href="${to(page + 1)}" rel="next">${t("Next", "Suivant")}</a>` : "") + `</nav>`;
  }

  // /leaderboards/characters/: every rated character of one bracket, ranked, 50 per page (class, role and realm filters).
  const CHARACTERS_PER_PAGE = 25;
  async function charactersBoard(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { periods, filters, period } = await pageFilters(ctx);
    await ensureIndex(ctx, period);
    const rules = periodRules(period);
    const bracketKeys = rules.brackets.map((b) => b.key as string);
    const bracket = filters.bracket && bracketKeys.includes(filters.bracket) ? filters.bracket : bracketKeys[0] ?? null;
    const all = (await periodRuns(period)).filter((run) => !run.challenge);
    const rows = bracket ? characterScores(all, rules, keepPlayer(filters, rules)).filter((row) => row.bracket === bracket) : [];
    const pageAsked = Math.trunc(Number(ctx.request.query.get("page")));
    const pages = Math.max(1, Math.ceil(rows.length / CHARACTERS_PER_PAGE));
    const page = Math.min(Number.isFinite(pageAsked) && pageAsked > 1 ? pageAsked : 1, pages);
    const keep = { season: filters.season, period: filters.week ? "week" : null, bracket, class: filters.className, role: filters.role, realm: filters.realm, confirmed: filters.confirmed ? "1" : null };
    const classes = FOREVER_CLASSES;
    const any = { value: "", label: t("Any", "Tous") };
    const form = `<form class="filters" method="get" action="/leaderboards/characters/"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="edition" value="${escapeHtml(currentEdition())}">`
      + `<div><label for="season">${t("Season", "Saison")}</label><select id="season" name="season">${options([...periods.map((p) => ({ value: p.id, label: periodName(ctx, p) })), { value: "all", label: t("All time", "Depuis le début") }], filters.season)}</select></div>`
      + `<div><label for="period">${t("Period", "Période")}</label><select id="period" name="period">${options([{ value: "", label: t("Whole season", "Toute la saison") }, { value: "week", label: t("This week", "Cette semaine") }], filters.week ? "week" : "")}</select></div>`
      + `<div><label for="bracket">${t("Levels", "Niveaux")}</label><select id="bracket" name="bracket">${options(bracketKeys.map((value) => ({ value, label: bracketName(ctx, value) })), bracket)}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([any, ...classes.map((name) => ({ value: name, label: classLabel(name, lang) }))], filters.className)}</select></div>`
      + `<div><label for="role">${t("Role", "Rôle")}</label><select id="role" name="role">${options([any, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], filters.role)}</select></div>`
      + `<div><label for="realm">${t("Realm", "Royaume")}</label><input id="realm" name="realm" maxlength="60" value="${escapeHtml(filters.realm ?? "")}"></div>`
      + `<div><button class="button" type="submit">${t("Show rankings", "Afficher le classement")}</button></div></form>`;
    const bestRuns = (row: ScoreRow) => row.routes.filter((r) => r.counted).sort((a, b) => b.points - a.points).slice(0, 3)
      .map((r) => `<a href="${link(runPath(r.run.runId), lang)}">${escapeHtml(r.run.dungeonName)}</a> <span class="tag">${r.points}</span>`).join(" ");
    const list = rows.length ? `<div class="table-wrap"><table class="dense rank-cards"><thead><tr><th>#</th><th>${t("Character", "Personnage")}</th><th>${t("Role", "Rôle")}</th><th class="num">${t("Score", "Score")}</th><th class="num">${t("Routes", "Parcours")}</th><th>${t("Best runs", "Meilleurs essais")}</th></tr></thead><tbody>`
      + rows.slice((page - 1) * CHARACTERS_PER_PAGE, page * CHARACTERS_PER_PAGE).map((row, i) => `<tr><td>${rankCell((page - 1) * CHARACTERS_PER_PAGE + i + 1)}</td><td>${identity(ctx, row.player)}</td>`
        + `<td>${row.player.role ? escapeHtml(roleLabel(row.player.role, lang)) : ""}</td>`
        + `<td class="num score">${row.points}</td><td class="num">${row.routes.filter((r) => r.counted).length}/${row.routes.length}</td><td class="wrap best-runs">${bestRuns(row)}</td></tr>`).join("")
      + `</tbody></table></div>`
      : `<p class="muted">${t("Nobody is ranked with these filters yet: your first ranked clear puts you on the board.", "Personne n'est encore classé avec ces filtres : votre premier essai classé vous place au classement.")}</p>`;
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Characters", "Personnages"), null]], escapeHtml)
      + `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${t("Character rankings", "Classement des personnages")}${bracket ? ` · ${escapeHtml(bracketName(ctx, bracket))}` : ""}</h1>`
      + `<p class="muted">${t("Score adds a character’s best distinct rated routes in the level bracket. Best runs are the counted routes with their points; open one for its party and time.", "Le score additionne les meilleurs parcours classés distincts du personnage dans la tranche. Les meilleurs essais sont les parcours comptés avec leurs points; ouvrez-en un pour voir le groupe et le temps.")}</p>`
      + periodDates(ctx, period) + views(ctx, "rankings", { ...filters, bracket }) + form
      + `<h2>${t("Ranked characters", "Personnages classés")} <span class="tag">(${rows.length})</span></h2>` + list + pager(ctx, "/leaderboards/characters/", keep, page, pages);
    return kit.page(200, t("Character rankings", "Classement des personnages"), body, { description: t("WoW Forever dungeon score rankings by season and level bracket, with class, role and realm filters.", "Classement des scores de donjon WoW Forever par saison et tranche de niveaux, avec filtres de classe, rôle et royaume.") });
  }

  async function guildsBoard(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { filters, period } = await pageFilters(ctx);
    await ensureIndex(ctx, period);
    const entries = await guildEntries(period);
    const ranks = rankGuilds(entries, periodRules(period));
    const stats = await allGuildStats();
    const overview = guildOverview(entries, ranks, stats, await periodRuns(period), currentEdition());
    const base = "/leaderboards/guilds/";
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), null]], escapeHtml)
      + `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${t("Guild rankings", "Classement des guildes")}</h1>`
      + `<p class="muted">${t(`A guild's score in a level bracket is its ${GUILD_COUNT} best members' scores added up. Only characters linked to the guild's members count; guilds choose to publish their runs.`, `Le score d'une guilde dans une tranche de niveaux additionne les scores de ses ${GUILD_COUNT} meilleurs membres. Seuls les personnages liés aux membres de la guilde comptent; les guildes choisissent de publier leurs essais.`)}</p>`
      + periodDates(ctx, period) + views(ctx, "guilds", filters)
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, lang, { season: filters.season })}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, lang, { period: "week" })}">${t("This week", "Cette semaine")}</a></nav>`
      + guildOverviewSection(ctx, overview, filters, !!deps.store.guildStats)
      + `<h2>${t("By level bracket", "Par tranche de niveaux")}</h2>`
      + bracketSwitch(ctx, periodRules(period).brackets, (chosenBracket(periodRules(period).brackets, filters.bracket))?.key ?? null, (key) => link(base, lang, { season: filters.season, period: filters.week ? "week" : null, bracket: key }))
      + periodRules(period).brackets.filter((b) => b.key === (chosenBracket(periodRules(period).brackets, filters.bracket)?.key ?? b.key)).slice(0, 1).map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))}</h3>${guildTable(ctx, ranks.filter((r) => r.bracket === b.key), 50)}</section>`).join("")
      + `<p class="muted">${t("Officers publish their guild's runs with /mod leaderboard in Discord.", "Les officiers publient les essais de leur guilde avec /mod leaderboard dans Discord.")}</p>`;
    return kit.page(200, t("Guild rankings", "Classement des guildes"), body, { description: t("WoW Forever guild rankings by dungeon score: each guild's five best members per level bracket.", "Classement des guildes WoW Forever par score de donjon : les cinq meilleurs membres de chaque guilde par tranche de niveaux.") });
  }

  async function board(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { periods, filters, period } = await pageFilters(ctx);
    await ensureIndex(ctx, period);
    const periodResults = await periodRuns(period);
    const all = periodResults.filter(run => !run.challenge);
    const activeRules = periodRules(period);
    const dungeons = dungeonSummaries(activeRules.evidencePolicy ? all.filter(run => rateRun(run, activeRules).score) : all);
    const filterDungeons = [...dungeons];
    for (const run of periodResults) if (!filterDungeons.some(d => d.instanceId === run.instanceId)) {
      filterDungeons.push({ instanceId: run.instanceId, dungeonName: run.dungeonName, bestSec: run.durationSec, runs: 1 });
    }
    let body: string;
    if (filters.instanceId) {
      const runs = all.filter((run) => run.instanceId === filters.instanceId && (!filters.bracket || run.bracket === filters.bracket));
      const ranked = rankCharacters(runs, filters, 100, activeRules);
      const name = dungeons.find((d) => d.instanceId === filters.instanceId)?.dungeonName ?? t("Dungeon", "Donjon");
      body = `<h2>${escapeHtml(name)}</h2>` + (ranked.length
        ? table(["#", t("Character", "Personnage"), t("Role", "Rôle"), t("Time", "Temps"), t("Score", "Score"), t("Deaths", "Morts"), t("Party", "Groupe"), t("Date", "Date"), ""],
          ranked.map((entry, index) => `<tr><td>${index + 1}</td><td>${identity(ctx, entry.player)}</td>`
            + `<td>${entry.player.role ? escapeHtml(roleLabel(entry.player.role, lang)) : ""}</td>`
            + `<td class="num">${time(entry.run.durationSec)}</td><td class="num score">${scoreCell(ctx, entry.run, periodRules(period), entry.player)}</td><td class="num">${entry.run.deaths ?? "?"}</td><td>${party(ctx, entry.run)}</td><td>${date(entry.run.endedAt)}</td><td>${trust(ctx, entry.run)}</td></tr>`), [3, 4, 5], "rank-cards")
        : `<p class="muted">${t("No run matches these filters yet.", "Aucun essai ne correspond encore à ces filtres.")}</p>`);
    } else {
      const weekPeriod = filterPeriod({ season: filters.season, week: true }, now(), periods);
      const week = filters.week ? all : await periodRuns(weekPeriod);
      const scores = characterScores(all, periodRules(period), keepPlayer(filters, periodRules(period)));
      const allBrackets = periodRules(period).brackets;
      const shown = chosenBracket(allBrackets, filters.bracket);
      const ranks = await guildRanks(period);
      const weekHtml = topRuns(ctx, week, filters, periodRules(weekPeriod));
      // A week with no rated runs is one sentence and a link, not a "0 this week" headline above the season table.
      const weekBlock = weekHtml.includes('class="empty-cta"') ? weekHtml
        : `<h2>${t("Top runs this week", "Meilleurs essais de la semaine")}</h2><p class="muted">${t("A weekly snapshot; character and guild rankings below use your selected period.", "Aperçu hebdomadaire; les classements des personnages et des guildes ci-dessous utilisent la période choisie.")}</p>${weekHtml}`;
      const bracketHref = (key: string) => link("/leaderboards/", lang, { season: filters.season, period: filters.week ? "week" : null, bracket: key, class: filters.className, role: filters.role, realm: filters.realm });
      const rankedHere = shown ? scores.some((row) => row.bracket === shown.key) : false;
      const characters = !shown ? "" : rankedHere
        ? `${bracketSwitch(ctx, allBrackets, shown.key, bracketHref)}<section><h2>${escapeHtml(bracketName(ctx, shown.key))} <span class="tag">${t(`best ${shown.bestCount} routes`, `${shown.bestCount} meilleurs parcours`)}</span></h2>${scoreTable(ctx, scores.filter((row) => row.bracket === shown.key), 25)}<p><a href="${link("/leaderboards/characters/", lang, { season: filters.season, period: filters.week ? "week" : null, bracket: shown.key, class: filters.className, role: filters.role, realm: filters.realm })}">${t("Full ranking →", "Classement complet →")}</a></p></section>`
        : `${bracketSwitch(ctx, allBrackets, shown.key, bracketHref)}<p class="muted">${t("Nobody is ranked yet in this period: your first ranked clear puts you on the board.", "Personne n'est encore classé pour cette période : votre premier essai classé vous place au classement.")}</p>`;
      const guildsBlock = ranks.length && shown && !filters.className && !filters.role && !filters.realm && !filters.confirmed
        ? `<h2>${t("Top guilds", "Meilleures guildes")}</h2>${bracketSwitch(ctx, allBrackets, shown.key, (key) => link("/leaderboards/", lang, { season: filters.season, period: filters.week ? "week" : null, bracket: key }))}<section><h3>${escapeHtml(bracketName(ctx, shown.key))}</h3>${guildTable(ctx, ranks.filter((r) => r.bracket === shown.key), 5)}</section><p><a href="${link("/leaderboards/guilds/", lang, { season: filters.season, period: filters.week ? "week" : null, bracket: shown.key })}">${t("All guild rankings →", "Tout le classement des guildes →")}</a></p>`
        : "";
      body = `<h2>${t("Top characters", "Meilleurs personnages")} · ${escapeHtml(periodName(ctx, period))}</h2><p class="muted">${t("Score adds a character’s best distinct rated routes in each level bracket. Higher is better.", "Le score additionne les meilleurs parcours classés distincts du personnage dans chaque tranche de niveaux. Plus il est élevé, mieux c’est.")}</p>`
        + characters
        + (filters.bracket && !allBrackets.some((b) => b.key === filters.bracket) ? `<p class="muted">${t("This bracket is not rated yet (launch data needed).", "Cette tranche n'est pas encore classée (données de lancement requises).")}</p>` : "")
        + weekBlock
        + `<h2>${t("Dungeon records", "Records des donjons")}</h2>` + (dungeons.length
          ? table([t("Dungeon", "Donjon"), t("Record", "Record"), t("Runs", "Essais")], dungeons.map((d) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(d.instanceId), season: filters.season, period: filters.week ? "week" : null, bracket: filters.bracket })}">${escapeHtml(d.dungeonName)}</a></td><td class="num">${time(d.bestSec)}</td><td class="num">${d.runs}</td></tr>`), [1, 2], "rank-cards")
          : `<p class="muted">${t("No standard dungeon record in this period yet. Install Guilded Dungeons, sign in and connect the companion from your page.", "Aucun record de donjon standard pour cette période. Installez Guilded Dungeons, connectez-vous et reliez le compagnon depuis votre page.")} <a href="${link("/me/", lang)}">${t("My page", "Ma page")}</a></p>`)
        + guildsBlock;
    }
    const scoreExample = `<p class="muted">${t("Standard dungeon score example: two counted routes worth 150 and 200 points give 350. Unranked reports add no points; provisional targets may still change before rules are frozen.", "Exemple de score des donjons standards : deux parcours comptabilisés à 150 et 200 points donnent 350. Les rapports non classés n'ajoutent aucun point; les cibles provisoires peuvent évoluer avant le gel des règles.")}</p>`;
    return kit.page(200, t("Dungeon leaderboards", "Classements des donjons"), PAGE_CSS + intro(ctx, period) + body + periodDates(ctx, period) + `<p><a href="${link("/me/", lang)}">${t("Find your characters in My Guilded →", "Retrouvez vos personnages dans Mon Guilded →")}</a></p>` + views(ctx, "characters", filters) + filterForm(ctx, filters, filterDungeons, periods) + scoreExample,
      { description: t("WoW Forever dungeon scores and leaderboards by season, week, level bracket, dungeon, class, role and realm.", "Scores et classements des donjons WoW Forever par saison, semaine, niveaux, donjon, classe, rôle et royaume.") });
  }

  async function character(ctx: WebContext, kit: WebKit, raw: string, image = false): Promise<WebResponse> {
    const { t, lang } = ctx;
    let decoded: string;
    try { decoded = decodeURIComponent(raw).trim(); } catch { decoded = ""; }
    const dash = decoded.indexOf("-");
    const name = (dash > 0 ? decoded.slice(0, dash) : decoded).slice(0, 40);
    const realm = dash > 0 ? decoded.slice(dash + 1).slice(0, 60) : null;
    if (!name) return kit.page(404, t("Not found", "Introuvable"), `<h1>${t("Character not found", "Personnage introuvable")}</h1>`, { noindex: true });
    const runs = await cached(`c:${name.toLowerCase()}:${realm?.toLowerCase() ?? ""}`, () => deps.store.characterRuns(name, realm));
    const isMe = (player: LeaderPlayer) => [player.character, ...(player.aliases ?? [])].some((n) => n.toLowerCase() === name.toLowerCase())
      && (realm === null || player.realm.toLowerCase() === realm.toLowerCase());
    const me = runs.flatMap((run) => run.players.filter(isMe))[0];
    const title = `${me?.displayName || me?.character || name}${realm ? `-${realm}` : ""}`;
    const face = deps.picture && runs.length ? await cached(`p:${name.toLowerCase()}:${realm?.toLowerCase() ?? ""}`, () => deps.picture!(name, realm).catch(() => null)) : null;
    const seasons = await seasonsNow();
    const inPeriod = (p: PublicPeriod) => runs.filter((run) => (!p.from || run.endedAt >= p.from) && (!p.to || run.endedAt < p.to));
    const mine = (rows: ScoreRow[]) => rows.filter((row) => isMe(row.player));
    const season = seasons[0]!;
    const seasonRuns = inPeriod(season);
    const current = mine(characterScores(seasonRuns, periodRules(season)));
    const imagePath = link(`/leaderboards/character/${raw}/card.png`, lang);
    if (image) {
      if (!runs.length) return kit.page(404, t("Not found", "Introuvable"), "", { noindex: true });
      const scoreStats: CardStat[] = current.length ? current.slice(0, 2).map(row => ({ label: bracketName(ctx, row.bracket), value: String(row.points), note: t("Season score", "Score de saison") }))
        : [{ label: t("Season score", "Score de saison"), value: "—", note: t("Not rated yet", "Pas encore classé"), accent: "red" as const }];
      const runPoints = (r: LeaderRun) => rateRun(r, rulesAt(seasons, r.endedAt), r.players.find(isMe)).score?.points;
      const bestRun = runs.flatMap((r) => { const points = runPoints(r); return points === undefined ? [] : [{ r, points }]; }).sort((a, b) => b.points - a.points)[0];
      const stats: CardStat[] = [scoreStats[0]!, ...(bestRun ? [{ label: t("Best dungeon", "Meilleur donjon"), value: bestRun.r.dungeonName, note: `${time(bestRun.r.durationSec)} · ${bestRun.points}` }] : []), ...scoreStats.slice(1)];
      const rows: CardRow[] = runs.slice(0, 5).map((r) => {
        const points = runPoints(r);
        return { name: r.dungeonName, color: r.challenge ? (r.challenge.onTime ? "#8fd19e" : "#ee8a7a") : undefined, sub: `${date(r.endedAt)} · ${r.challenge ? challengeClock(r.challenge.durationMs) : time(r.durationSec)}`,
          right: r.challenge ? `+${r.challenge.level}` : points === undefined ? "—" : String(points), rightTone: r.challenge ? (r.challenge.onTime ? "green" as const : "red" as const) : undefined };
      });
      return scoreCardResponse({ eyebrow: t("Guilded · Dungeons · Character", "Guilded · Donjons · Personnage"), title, ...(face ? { portrait: face.thumb.toString("base64") } : {}),
        subtitle: [me?.className ? classLabel(me.className, lang) : null, me?.level ? `${t("level", "niveau")} ${me.level}` : null, periodName(ctx, season)].filter(Boolean).join(" · "), stats,
        rows, rowsLabel: t("Recent runs", "Essais récents"),
        badges: [{ text: t(`${runs.length} public ${runs.length === 1 ? "run" : "runs"}`, `${runs.length} ${runs.length === 1 ? "essai public" : "essais publics"}`), tone: "muted" }],
        footer: t("Community reports · Provisional targets · Not Blizzard verified · guildedwow.com", "Rapports communautaires · Cibles provisoires · Non vérifié par Blizzard · guildedwow.com")
      }, ctx.request.method === "HEAD");
    }
    // Guidance for the running season: the highest level seen is the character's level now.
    const levels = runs.flatMap((run) => run.players.filter(isMe).flatMap((p) => p.level ?? []));
    const level = levels.length ? Math.max(...levels) : null;
    const running = !season.to || now() < season.to;
    const plan = me && running ? planImprovements({ runs: seasonRuns, rules: periodRules(season), me, level, now: now() }) : null;
    const guidance = plan ? planSection(ctx, plan, periodRules(season))
      : me && running && level !== null ? `<h2>${t("Best next improvement", "Meilleure prochaine amélioration")}</h2><p class="muted">${t(`No rated bracket at level ${level} yet (launch data needed).`, `Aucune tranche classée au niveau ${level} pour l'instant (données de lancement requises).`)}</p>` : "";
    const previous = seasons.slice(1).find(p => inPeriod(p).length > 0);
    const previousRows = previous ? mine(characterScores(inPeriod(previous), periodRules(previous))) : [];
    const roles = (me && current.length ? roleSection(ctx, season, roleScores(seasonRuns, periodRules(season), me), current.map((row) => row.bracket)) : "")
      + (me && previous && previousRows.length ? `<details><summary>${t("Previous-season role context", "Rôles de la saison précédente")}</summary>`
        + `<p class="muted">${t("Each season uses its own rules; totals from different brackets or seasons are not directly comparable.", "Chaque saison utilise ses propres règles; les totaux de tranches ou de saisons différentes ne sont pas directement comparables.")}</p>`
        + roleSection(ctx, previous, roleScores(inPeriod(previous), periodRules(previous), me), previousRows.map(row => row.bracket)) + `</details>` : "");
    const cell = (run: LeaderRun) => scoreCell(ctx, run, rulesAt(seasons, run.endedAt), run.players.find(isMe));
    const best = new Map<number, LeaderRun>();
    for (const run of runs) {
      if (run.challenge) continue;
      const b = best.get(run.instanceId); if (!b || run.durationSec < b.durationSec) best.set(run.instanceId, run);
    }
    const history = seasons.map((p) => ({ p, rows: mine(characterScores(inPeriod(p), periodRules(p))) })).filter((h) => h.rows.length);
    const top = Math.max(1, ...history.flatMap((h) => h.rows.map((r) => r.points)));
    const body = PAGE_CSS + `<p class="eyebrow">${t("Character", "Personnage")}</p><div class="hero">${face ? `<img src="${escapeHtml(pictureUrl(face.characterId, face.version, "thumb"))}" alt="" width="64" height="64" style="border-radius:50%;align-self:center">` : ""}<h1 class="c-${classSlug(me?.className ?? null)}">${escapeHtml(title)}</h1>`
      + (me?.className ? `<span>${escapeHtml(classLabel(me.className, lang))}${me.level ? ` · ${t("level", "niveau")} ${me.level}` : ""}</span>` : "") + `</div>`
      + (runs.length ? `<h2>${t("Score", "Score")} · ${escapeHtml(periodName(ctx, seasons[0]!))}</h2>`
        + (current.length ? `<p>${current.map((row) => `<span class="badge">${escapeHtml(bracketName(ctx, row.bracket))}</span> <span class="score">${row.points}</span>`).join(" &nbsp; ")}</p>` : `<p class="muted">${t("No rated run this season yet.", "Aucun essai classé cette saison.")}</p>`)
        + roles + guidance
        + `<h2>${t("Routes", "Parcours")}</h2><p class="muted">${t(`${best.size} ${best.size === 1 ? "dungeon" : "dungeons"} with a public best time.`, `${best.size} ${best.size === 1 ? "donjon" : "donjons"} avec un meilleur temps public.`)}</p>`
        + `<h2>${t("Best run per dungeon", "Meilleur essai par donjon")}</h2>`
        + table([t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), t("Date", "Date"), ""],
          [...best.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName)).map((run) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(run.instanceId), season: "all" })}">${escapeHtml(run.dungeonName)}</a></td><td class="num">${time(run.durationSec)}</td><td class="num score">${cell(run)}</td><td>${party(ctx, run)}</td><td>${date(run.endedAt)}</td><td>${trust(ctx, run)}</td></tr>`), [1, 2])
        + `<h2>${t("Recent runs", "Essais récents")}</h2>`
        + table([t("Date", "Date"), t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Deaths", "Morts"), t("Levels", "Niveaux"), ""],
          runs.slice(0, 30).map((run) => `<tr><td>${date(run.endedAt)}</td><td><a href="${link(runPath(run.runId), lang)}">${escapeHtml(run.dungeonName)}</a></td><td class="num">${time(run.durationSec)}</td><td class="num score">${cell(run)}</td><td class="num">${run.deaths ?? "?"}</td><td>${escapeHtml(run.bracket ?? "?")}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3, 4])
        + `<h2>${t("Score history", "Historique du score")}</h2>` + (history.length
          ? table([t("Season", "Saison"), t("Levels", "Niveaux"), t("Score", "Score"), ""], history.flatMap((h) => h.rows.map((row) => `<tr><td>${escapeHtml(periodName(ctx, h.p))}</td><td>${escapeHtml(bracketName(ctx, row.bracket))}</td><td class="num score">${row.points}</td><td class="bar-cell"><div class="meter" style="width:${Math.round(100 * row.points / top)}%"></div></td></tr>`)), [2])
          : `<p class="muted">${t("No rated season yet.", "Aucune saison classée.")}</p>`)
        : `<p class="muted">${t("No public run for this character yet.", "Aucun essai public pour ce personnage.")}</p>`);
    // The link preview leads with this season's score per bracket, so a pasted link shows it.
    const scoreLine = current.map((row) => `${row.points} (${bracketName(ctx, row.bracket)})`).join(", ");
    const description = scoreLine
      ? t(`${title}: dungeon score ${scoreLine} · ${periodName(ctx, seasons[0]!)} · Guilded leaderboards.`, `${title} : score de donjon ${scoreLine} · ${periodName(ctx, seasons[0]!)} · classements Guilded.`)
      : t(`${title}: dungeon score and times on Guilded's public leaderboards.`, `${title} : score et temps de donjon sur les classements publics de Guilded.`);
    return kit.page(runs.length ? 200 : 404, title, body + (runs.length ? `<p><a href="${imagePath}">${t("Download score card", "Télécharger la carte de score")}</a></p>` : ""), { description, ...(runs.length ? { shareImage: imagePath } : { noindex: true }) });
  }

  async function runPage(ctx: WebContext, kit: WebKit, id: string, image: boolean): Promise<WebResponse> {
    // Recheck visibility even when the rendered image is cached.
    const run = await deps.store.run?.(id);
    if (!run) return kit.page(404, ctx.t("Not found", "Introuvable"), "", { noindex: true });
    const { t, lang } = ctx;
    const seasons = await seasonsNow();
    const rules = rulesAt(seasons, run.endedAt);
    const verdict = rateRun(run, rules);
    const period = seasons.find(p => (!p.from || run.endedAt >= p.from) && (!p.to || run.endedAt < p.to));
    const score = run.challenge ? `+${run.challenge.level} · ${run.challenge.onTime ? t("In time", "À temps") : t("Overtime", "Hors délai")}`
      : verdict.score ? `${verdict.score.points} · ${verdict.score.bracket}` : t("Unrated", "Non classé");
    const displayedTime = run.challenge ? challengeClock(run.challenge.durationMs) : time(run.durationSec);
    const evidence = run.confirmations >= 2 ? t("Party confirmed", "Confirmé par le groupe") : t("One upload", "Un envoi");
    const title = run.dungeonName;
    const subtitle = `${period ? periodName(ctx, period) : t("Past run", "Ancien donjon")} · ${date(run.endedAt)} UTC`;
    const imagePath = link(`${runPath(id)}/card.png`, lang);
    if (image) {
      const target = verdict.score ? routeTargetAt(rules, verdict.score.key, run.endedAt) : undefined;
      const delta = target ? Math.abs(run.durationSec - target) : 0;
      const timeNote = run.challenge ? (run.challenge.onTime ? t("Finished in time", "Terminé à temps") : t("Finished over the timer", "Terminé hors délai"))
        : target ? (run.durationSec <= target ? t(`Target ${time(target)} · ${time(delta)} faster`, `Cible ${time(target)} · ${time(delta)} plus vite`) : t(`Target ${time(target)} · ${time(delta)} slower`, `Cible ${time(target)} · ${time(delta)} plus lent`))
          : t("No target for this route yet", "Pas encore de cible pour ce parcours");
      const levels = run.players.flatMap((p) => p.level ?? []);
      const levelRange = levels.length ? (Math.min(...levels) === Math.max(...levels) ? `${levels[0]}` : `${Math.min(...levels)}–${Math.max(...levels)}`) : null;
      const stats: CardStat[] = run.challenge ? [
        { label: t("Time", "Temps"), value: displayedTime, note: timeNote, accent: run.challenge.onTime ? "green" : "red" },
        { label: t("Keystone level", "Niveau de clé"), value: `+${run.challenge.level}`, note: run.challenge.onTime ? t("Timed", "À temps") : t("Overtime", "Hors délai") },
        { label: t("Deaths", "Morts"), value: run.deaths === null ? "?" : String(run.deaths), note: run.deaths === null ? t("Not reported", "Non rapporté") : undefined }
      ] : [
        { label: t("Clear time", "Temps de complétion"), value: displayedTime, note: timeNote, accent: target ? (run.durationSec <= target ? "green" : "gold") : "gold" },
        verdict.score ? { label: t("Run score", "Score de l'essai"), value: String(verdict.score.points), note: t("200 = target pace", "200 = rythme cible") }
          : { label: t("Run score", "Score de l'essai"), value: "—", note: verdict.reason ?? t("Unrated", "Non classé"), accent: "red" },
        { label: t("Level bracket", "Tranche de niveaux"), value: (run.bracket ?? "?").replace("-", "–"), note: levelRange ? t(`Party levels ${levelRange}`, `Niveaux du groupe ${levelRange}`) : undefined }
      ];
      const roleName = (role: string | null) => role === "TANK" ? t("Tank", "Tank") : role === "HEALER" ? t("Healer", "Soigneur") : role === "DPS" ? t("DPS", "DPS") : null;
      return scoreCardResponse({ eyebrow: t("Guilded · Dungeons · Run", "Guilded · Donjons · Essai"), title, subtitle, stats,
        rows: run.players.map((p) => ({ name: p.displayName || p.character, color: classColor(p.className), sub: p.className ? classLabel(p.className, lang) : undefined, right: roleName(p.role) ?? undefined })),
        rowsLabel: `${t("Party", "Groupe")} · ${run.players.length} ${t("players", "joueurs")}`,
        badges: [
          { text: run.confirmations >= 2 ? t(`Party confirmed · ${run.confirmations} uploads agree`, `Confirmé par le groupe · ${run.confirmations} envois concordent`) : t("One upload · not yet confirmed", "Un envoi · pas encore confirmé"), tone: run.confirmations >= 2 ? "ok" : "warn" },
          ...(!run.challenge && run.deaths !== null ? [{ text: run.deaths === 1 ? t("1 death", "1 mort") : t(`${run.deaths} deaths`, `${run.deaths} morts`), tone: "muted" as const }] : []),
          ...(run.evidence ? [] : [{ text: t("Older evidence check", "Ancienne vérification"), tone: "warn" as const }])
        ],
        footer: t("Community report · Provisional targets · Not Blizzard verified · guildedwow.com", "Rapport communautaire · Cibles provisoires · Non vérifié par Blizzard · guildedwow.com")
      }, ctx.request.method === "HEAD");
    }
    const description = `${title} · ${displayedTime} · ${score} · ${evidence}`;
    const target = verdict.score ? routeTargetAt(rules, verdict.score.key, run.endedAt) : undefined;
    const tile = (key: string, value: string, note = "") => `<div class="tile"><div class="k">${key}</div><div class="v">${value}</div>${note ? `<div class="tag">${note}</div>` : ""}</div>`;
    const tiles = `<div class="tiles">`
      + tile(t("Time", "Temps"), escapeHtml(displayedTime), !run.challenge && target ? escapeHtml(t(`target ${time(target)}`, `cible ${time(target)}`)) : "")
      + tile(run.challenge ? t("Key", "Clé") : t("Score", "Score"), run.challenge ? `+${run.challenge.level}` : verdict.score ? `<span class="score">${verdict.score.points}</span>` : "–",
        run.challenge ? escapeHtml(run.challenge.onTime ? t("In time", "À temps") : t("Overtime", "Hors délai")) : verdict.score?.penaltyPercent ? `−${verdict.score.penaltyPercent}%` : "")
      + tile(t("Levels", "Niveaux"), escapeHtml((verdict.score?.bracket ?? run.bracket ?? "?").replace("-", "–")))
      + tile(t("Deaths", "Morts"), run.deaths === null ? "?" : String(run.deaths))
      + tile(t("Season", "Saison"), escapeHtml(period ? periodName(ctx, period) : t("Past run", "Ancien donjon")), escapeHtml(`${date(run.endedAt)} UTC`)) + `</div>`;
    const presence = (p: LeaderPlayer) => p.presentSec === null || p.presentSec === undefined || !run.durationSec ? "–" : `${Math.min(100, Math.round(100 * p.presentSec / run.durationSec))}%`;
    const partyTable = table([t("Character", "Personnage"), t("Class", "Classe"), t("Role", "Rôle"), t("Level", "Niveau"), t("Present", "Présent")],
      run.players.map((p) => `<tr><td>${who(ctx, p)}</td><td class="c-${classSlug(p.className)}">${p.className ? escapeHtml(classLabel(p.className, lang)) : ""}</td><td>${p.role ? escapeHtml(roleLabel(p.role, lang)) : ""}</td><td class="num">${p.level ?? "?"}</td><td class="num">${presence(p)}</td></tr>`), [3, 4]);
    return kit.page(200, title, PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [title, null]], escapeHtml)
      + `<p class="eyebrow">${t("Dungeon run", "Essai de donjon")}</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(subtitle)}</p>` + tiles
      + (run.challenge ? `<p>${t("Official timer", "Chrono officiel")} · affixes ${run.challenge.affixIds.join(", ") || "—"}${run.challenge.practiceRun ? ` · ${t("Practice run", "Entraînement")}` : ""}</p>` : "")
      + (verdict.reason ? `<p>${escapeHtml(unrankedText(ctx, verdict.reason))}</p>` : "")
      + `<p>${trust(ctx, run)}</p>`
      + `<h2>${t("Party", "Groupe")} <span class="tag">(${run.players.length})</span></h2>` + partyTable
      + `<p class="muted">${t("Present: share of the run's time the player's own client saw them inside the dungeon, when recorded.", "Présent : part du temps de l'essai où le jeu du joueur l'a vu dans le donjon, quand c'est enregistré.")}</p>`
      + `<h2>${t("Run card", "Carte de l'essai")}</h2><p><img class="run-card" src="${imagePath}" alt="${escapeHtml(t(`Run card: ${title}, ${displayedTime}`, `Carte de l'essai : ${title}, ${displayedTime}`))}" loading="lazy"></p>`
      + `<p><a href="${imagePath}">${t("Download run card", "Télécharger la carte du donjon")}</a> · <a href="${link("/leaderboards/", lang, { dungeon: String(run.instanceId), season: "all" })}">${t("This dungeon's ranking", "Classement de ce donjon")}</a></p>`
      + `<p class="muted">${t("Scores use this run's season rules. Targets are provisional; community uploads are not Blizzard verification.", "Les scores suivent les règles de la saison du donjon. Les cibles sont provisoires; les envois communautaires ne sont pas vérifiés par Blizzard.")}</p>`, { description, shareImage: imagePath });
  }

  const findGuild = (ctx: WebContext, guilds: PublicGuild[], key: string) => guilds.find((g) => indexOf(ctx).slugs.get(g.id) === key.toLowerCase()) ?? guilds.find((g) => g.id === key);
  async function guildPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    await ensureIndex(ctx);
    const guild = findGuild(ctx, await cached("guilds", () => deps.store.guilds()), id);
    if (guild && id !== indexOf(ctx).slugs.get(guild.id)) return kit.redirect(link(guildPath(ctx, guild), lang, Object.fromEntries([...ctx.request.query].filter(([k]) => k !== "lang"))));
    if (!guild) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Guild not found", "Guilde introuvable")}</h1><p class="muted">${t("Only guilds that publish their runs have a page.", "Seules les guildes qui publient leurs essais ont une page.")}</p><p><a href="${link("/leaderboards/guilds/", lang)}">${t("Guild rankings", "Classement des guildes")}</a></p>`, { noindex: true });
    const { filters, period } = await pageFilters(ctx);
    const runs = await guildRuns(guild.id, period);
    const rosterKeys = await cached(`roster:${guild.id}`, () => deps.store.guildRoster(guild.id));
    const roster = new Set(rosterKeys.map((name) => name.toLowerCase()));
    // Members only: pickup players in the guild's runs keep their own character pages.
    const rules = periodRules(period);
    const scores = characterScores(runs, rules).filter((row) => onRoster(roster, row.player, currentEdition()));
    const ranks = await guildRanks(period);
    const standing = rules.brackets.flatMap((b) => {
      const inBracket = ranks.filter((r) => r.bracket === b.key);
      const index = inBracket.findIndex((r) => r.guild.id === guild.id);
      return index < 0 ? [] : [`<span class="badge">${escapeHtml(bracketName(ctx, b.key))}</span> <span class="score">${inBracket[index]!.points}</span> <span class="tag">#${index + 1} / ${inBracket.length}</span>`];
    });
    const stats = guildPageStats(runs, rosterKeys, rules, (await periodRuns(period)).filter((run) => !run.challenge), currentEdition());
    const info = (await allGuildStats()).find((row) => row.guildId === guild.id) ?? null;
    const reason = unrankedReason(runs, stats);
    const reasonText = {
      "no-runs": t("This guild publishes its dungeon runs, but none has been received this period yet.", "Cette guilde publie ses donjons, mais aucun n'a encore été reçu pour cette période."),
      "no-member-in-runs": t("Runs were received, but none has a member of this guild linked to a character yet.", "Des donjons ont été reçus, mais aucun n'a de membre de cette guilde lié à un personnage."),
      "no-ranked-member": t("Not ranked yet: a ranked clear needs the final boss and 80% presence from a member of this guild.", "Pas encore classée : un essai classé demande le boss final et 80 % de présence d'un membre de cette guilde.")
    };
    const tile = (k: string, v: string) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const dash = `<span class="muted">–</span>`;
    const tiles = `<div class="tiles">`
      + tile(t("Faction", "Faction"), info?.faction ? `<span class="fac-${info.faction.toLowerCase()}">${escapeHtml(factionLabel(info.faction, lang))}</span>` : dash)
      + tile(t("Realm", "Royaume"), info?.realm ? escapeHtml(info.realm) : dash)
      + tile(t("Ranked players", "Joueurs classés"), String(stats.ranked))
      + tile(t("Public runs", "Essais publics"), String(stats.runs))
      + tile(t("Dungeon records", "Records de donjon"), String(stats.records))
      + (info ? tile(t("Members", "Membres"), String(info.members)) + tile(t("At level 60", "Niveau 60"), `${info.at60}<span class="tag">/${info.levelled}</span>`) : "") + `</div>`;
    const dungeonTable = stats.dungeons.length ? table([t("Dungeon", "Donjon"), t("Clears", "Réussites"), t("Best time", "Meilleur temps"), t("Date", "Date"), ""],
      stats.dungeons.map((d) => `<tr><td>${escapeHtml(d.name)}${stats.dungeons.some((o) => o !== d && o.instanceId === d.instanceId) ? ` <span class="tag">${escapeHtml(d.routeKey ?? (d.difficultyId === null ? "" : `${t("difficulty", "difficulté")} ${d.difficultyId}`))}</span>` : ""}</td><td class="num">${d.runs}</td><td class="num"><a href="${link(runPath(d.bestRunId), lang)}">${time(d.bestSec)}</a></td><td>${date(d.bestAt)}</td><td>${d.record ? `<span class="badge ok" title="${t("Fastest public clear of this dungeon this period", "Essai public le plus rapide de ce donjon pour la période")}">${t("Record", "Record")}</span>` : ""}</td></tr>`), [1, 2])
      : `<p class="muted">${t("No dungeon cleared by a member in this period yet.", "Aucun donjon terminé par un membre pour cette période.")}</p>`;
    const roleRows = stats.topByRole.length ? table([t("Role", "Rôle"), t("Player", "Joueur"), t("Levels", "Niveaux"), t("Score", "Score")],
      stats.topByRole.map(({ role, row }) => `<tr><td>${escapeHtml(roleLabel(role, lang))}</td><td>${who(ctx, row.player)}</td><td>${escapeHtml(bracketName(ctx, row.bracket))}</td><td class="num score">${row.points}</td></tr>`), [3]) : "";
    const peak = Math.max(1, ...stats.activity.map((w) => w.runs));
    const activity = stats.activity.length ? table([t("Week of", "Semaine du"), t("Runs", "Essais"), ""], stats.activity.map((w) => `<tr><td>${w.week}</td><td class="num">${w.runs}</td><td class="bar-cell"><div class="meter" style="width:${Math.round(100 * w.runs / peak)}%"></div></td></tr>`), [1]) : "";
    const base = guildPath(ctx, guild);
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), link("/leaderboards/guilds/", lang)], [guild.name, null]], escapeHtml)
      + `<p class="eyebrow">${t("Guild", "Guilde")} · ${escapeHtml(periodName(ctx, period))}</p><div class="hero"><h1>${escapeHtml(guild.name)}</h1>`
      + (guild.slug ? `<a href="/g/${encodeURIComponent(guild.slug)}/">${t("Guild page →", "Page de guilde →")}</a>` : "") + `</div>`
      + (standing.length ? `<p>${standing.join(" &nbsp; ")}</p>` : "")
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, lang)}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, lang, { period: "week" })}">${t("This week", "Cette semaine")}</a>${deps.store.guildDuelRows ? `<a href="${link(`${base}/duels`, lang)}">${t("Duels", "Duels")}</a>` : ""}</nav>`
      + tiles + (reason ? `<p class="notice">${reasonText[reason]}</p>` : "")
      + `<h2>${t("Dungeons", "Donjons")}</h2>` + dungeonTable
      + (roleRows ? `<h2>${t("Top player per role", "Meilleur joueur par rôle")}</h2>${roleRows}` : "")
      + (activity ? `<h2>${t("Activity", "Activité")}</h2>${activity}` : "")
      + rules.brackets.map((b) => `<h2>${escapeHtml(bracketName(ctx, b.key))}</h2>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 100)}`).join("")
      + `<h2>${t("Recent runs", "Essais récents")}</h2>` + (runs.length
        ? table([t("Date", "Date"), t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), ""], runs.slice(0, 20).map((run) => `<tr><td>${date(run.endedAt)}</td><td><a href="${link(runPath(run.runId), lang)}">${escapeHtml(run.dungeonName)}</a></td><td class="num">${time(run.durationSec)}</td><td class="num score">${scoreCell(ctx, run, periodRules(period))}</td><td>${party(ctx, run)}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3])
        : `<p class="muted">${t("No public run in this period yet.", "Aucun essai public pour cette période.")}</p>`);
    return kit.page(200, guild.name, body, { description: t(`${guild.name}: members' dungeon scores and guild ranking on Guilded.`, `${guild.name} : scores de donjon des membres et classement de la guilde sur Guilded.`) });
  }

  // The duel page's filters, read from the query. Before the rating start: when (all time, this season, this week). From it: which
  // duel season (a month, or "s0" = the frozen old points); class, level range and two names for a head-to-head either way.
  async function duelFilters(ctx: WebContext, startsAt: Date) {
    const q = ctx.request.query;
    const rating = ratingApplies(now(), startsAt);
    const periods = await seasonsNow();
    const season = periods[0] ?? null;
    let when: string, seasonId: string | null = null;
    if (rating) {
      const asked = q.get("when") ?? "";
      const ok = asked === "s0" || (/^\d{4}-\d{2}$/.test(asked) && seasonOf(new Date(`${asked}-01T00:00:00Z`), startsAt).rated && new Date(`${asked}-01T00:00:00Z`) <= now());
      seasonId = ok ? asked : seasonOf(now(), startsAt).id; when = seasonId;
    } else when = ["season", "week"].includes(q.get("when") ?? "") ? q.get("when")! : "all";
    const span = rating ? null : when === "week" ? publicWeek(now()) : when === "season" && season ? season : null;
    const className = q.get("class") ? classFromText(q.get("class")!) : null;
    const band = DUEL_LEVEL_BANDS.find((b) => b.key === q.get("levels")) ?? null;
    const filters: DuelFilters = { since: span?.from ?? null, until: seasonId === "s0" ? startsAt : span?.to ?? null, className, levels: band ? [band.from, band.to] : null };
    return { when, season, seasonId, rating, filters, band, className, a: (q.get("a") ?? "").trim().slice(0, 60), b: (q.get("b") ?? "").trim().slice(0, 60) };
  }
  const duelStart = async (guildId: string) => cached(`duel-start:${guildId}`, async () => (await deps.store.guildDuelRatingStart?.(guildId)) ?? RATING_START);
  /** The board for the chosen season under the rules that apply to it. */
  function duelBoardFor(all: PublicDuel[], f: Awaited<ReturnType<typeof duelFilters>>, startsAt: Date) {
    const ratedSeason = f.rating && f.seasonId && f.seasonId !== "s0";
    return ratedSeason ? buildRatingBoard(all, f.seasonId!, startsAt, f.filters) : buildDuelBoard(all, f.filters);
  }
  /** The duels the chosen season covers, for the head to head. */
  const duelsIn = (all: PublicDuel[], f: Awaited<ReturnType<typeof duelFilters>>, startsAt: Date) =>
    f.rating && f.seasonId ? all.filter((d) => seasonOf(d.endedAt, startsAt).id === f.seasonId) : all.filter((d) => (!f.filters.since || d.endedAt >= f.filters.since) && (!f.filters.until || d.endedAt < f.filters.until));

  // /leaderboards/guild/<slug>/duels/: the guild's public duel board (counted duels between members; names only).
  async function guildDuelsPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    await ensureIndex(ctx);
    const guild = findGuild(ctx, await cached("guilds", () => deps.store.guilds()), id);
    if (guild && deps.store.guildDuelRows && id !== indexOf(ctx).slugs.get(guild.id)) return kit.redirect(link(`${guildPath(ctx, guild)}/duels`, lang, Object.fromEntries([...ctx.request.query].filter(([k]) => k !== "lang"))));
    if (!guild || !deps.store.guildDuelRows) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Guild not found", "Guilde introuvable")}</h1>`, { noindex: true });
    const all = await cached(`duels:${guild.id}`, () => deps.store.guildDuelRows!(guild.id));
    const startsAt = await duelStart(guild.id);
    const f = await duelFilters(ctx, startsAt);
    const board = duelBoardFor(all, f, startsAt);
    const ratingView = !!board.season;
    const base = guildPath(ctx, guild);
    const here = `${base}/duels`;
    const presentClasses = [...new Set(duelBoardFor(all, { ...f, filters: { ...f.filters, className: null } }, startsAt).rows.map((row) => row.className).filter((c): c is string => !!c))].sort();
    const seasonOptions = (() => {
      if (!f.rating) return [{ value: "all", label: t("All time", "Depuis le début") }, ...(f.season ? [{ value: "season", label: periodName(ctx, f.season) }] : []), { value: "week", label: t("This week", "Cette semaine") }];
      const out: { value: string; label: string }[] = [];
      for (let at = seasonOf(now(), startsAt).from, i = 0; i < 24; i++) {
        out.push({ value: seasonOf(at < startsAt ? startsAt : at, startsAt).id, label: ratingSeasonName(seasonOf(at < startsAt ? startsAt : at, startsAt).id, lang) });
        if (at <= startsAt) break;
        at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1));
      }
      return [...out, { value: "s0", label: ratingSeasonName("s0", lang) }];
    })();
    const form = `<form class="filters" method="get" action="${escapeHtml(link(here, lang).split("?")[0]!)}"><input type="hidden" name="lang" value="${lang}">`
      + `<div><label for="when">${f.rating ? t("Season", "Saison") : t("Period", "Période")}</label><select id="when" name="when">${options(seasonOptions, f.when)}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([{ value: "", label: t("Any", "Toutes") }, ...presentClasses.map((name) => ({ value: name, label: classLabel(name, lang) }))], f.className ?? "")}</select></div>`
      + `<div><label for="levels">${t("Levels", "Niveaux")}</label><select id="levels" name="levels">${options([{ value: "", label: t("All levels", "Tous") }, ...DUEL_LEVEL_BANDS.map((b) => ({ value: b.key, label: b.key === "60" ? t("Level 60", "Niveau 60") : `${t("Levels", "Niveaux")} ${b.key.replace("-", "–")}` }))], f.band?.key ?? "")}</select></div>`
      + `<div><button class="button" type="submit">${t("Show", "Afficher")}</button></div></form>`;
    const person = (row: { name: string; className: string | null }) => `<span class="c-${classSlug(row.className)}">${escapeHtml(row.name)}</span>`;
    const scoreCellText = (row: DuelRow) => row.rating?.placement ? `<span class="muted" title="${t("Ranked after 8 duels against 4 different opponents", "Classé après 8 duels contre 4 adversaires différents")}">${t("placement", "placement")} ${row.rating.placement.duels}/${row.rating.placement.needDuels}</span>` : String(row.points);
    const ranking = board.rows.length ? table([t("#", "#"), t("Player", "Joueur"), t("Level", "Niveau"), ratingView ? t("Rating", "Cote") : t("Points", "Points"), t("W–L", "V–D"), t("Win rate", "Taux"), t("Streak", "Série"), t("Last duel", "Dernier duel")],
      board.rows.slice(0, 100).map((row) => `<tr><td class="num">${row.rank || "·"}</td><td>${person(row)}${row.className ? ` <span class="class-name c-${classSlug(row.className)}">${escapeHtml(classLabel(row.className, lang))}</span>` : ""}</td><td class="num">${row.level ?? "–"}</td><td class="num score">${scoreCellText(row)}</td><td class="num">${row.wins}–${row.losses}</td><td class="num">${percent(row.winRate)}</td><td class="num">${streakText(row.streak)}</td><td>${date(row.lastAt)}</td></tr>`), [0, 2, 3, 4, 5, 6], "dense")
      : `<p class="muted">${t("No duel recorded for these filters yet.", "Aucun duel enregistré pour ces filtres.")}</p>`;
    const change = (value: number, rated: boolean) => rated ? showChange(value) : "0";
    const recent = board.recent.length ? table([t("Date", "Date"), t("Winner", "Gagnant"), t("Loser", "Perdant"), ratingView ? t("Rating", "Cote") : t("Points", "Points"), ""],
      board.recent.map((d) => `<tr><td>${date(d.endedAt)}</td><td>${person({ name: d.winner, className: d.winnerClass })}</td><td>${person({ name: d.loser, className: d.loserClass })}</td><td class="num">${d.change ? `${change(d.change.winner, d.change.rated)} / ${change(d.change.loser, d.change.rated)}` : duelPoints(d.winnerLevel, d.loserLevel)}</td><td>${d.reason === "retreat" ? `<span class="tag">${t("opponent fled", "adversaire en fuite")}</span>` : ""}</td></tr>`), [3], "dense")
      : "";
    const scoped = duelsIn(all, f, startsAt);
    const names = [...new Set(scoped.filter((d) => d.winnerShown && d.loserShown).flatMap((d) => [d.winner, d.loser]))].sort((x, y) => x.localeCompare(y));
    const meeting = f.a && f.b ? headToHead(scoped, f.a, f.b) : null;
    const h2hForm = `<form class="filters" method="get" action="${escapeHtml(link(here, lang).split("?")[0]!)}"><input type="hidden" name="lang" value="${lang}">`
      + (f.when !== "all" ? `<input type="hidden" name="when" value="${escapeHtml(f.when)}">` : "")
      + `<div><label for="a">${t("Player", "Joueur")} 1</label><input id="a" name="a" list="duel-names" maxlength="60" value="${escapeHtml(f.a)}"></div>`
      + `<div><label for="b">${t("Player", "Joueur")} 2</label><input id="b" name="b" list="duel-names" maxlength="60" value="${escapeHtml(f.b)}"></div>`
      + `<datalist id="duel-names">${names.slice(0, 300).map((name) => `<option value="${escapeHtml(name)}">`).join("")}</datalist>`
      + `<div><button class="button" type="submit">${t("Compare", "Comparer")}</button></div></form>`;
    const h2h = !f.a || !f.b ? "" : meeting
      ? `<p><strong>${escapeHtml(meeting.a)}</strong> ${meeting.aWins} – ${meeting.bWins} <strong>${escapeHtml(meeting.b)}</strong></p>`
        + (meeting.last.length ? table([t("Date", "Date"), t("Winner", "Gagnant"), t("Loser", "Perdant")], meeting.last.map((d) => `<tr><td>${date(d.endedAt)}</td><td>${escapeHtml(d.winner)}</td><td>${escapeHtml(d.loser)}</td></tr>`), [], "dense") : `<p class="muted">${t("These two have not dueled yet.", "Ces deux joueurs ne se sont pas encore affrontés.")}</p>`)
      : `<p class="muted">${t("Both names must be players on this board.", "Les deux noms doivent être des joueurs de ce classement.")}</p>`;
    const lines = ratingView ? ratingRuleLines(lang, startsAt) : f.rating ? [lang === "fr" ? `Saison 0 : les duels terminés avant le ${date(startsAt)} (UTC), comptés avec les anciens points. Cette saison est figée.` : `Season 0: duels that ended before ${date(startsAt)} (UTC), scored with the old points. This season is frozen.`, ...duelRuleLines(lang)] : duelRuleLines(lang);
    const transition = ratingView && !ADDON_SHOWS_RATING ? `<p class="notice">${t("The game still shows the old points until the Guilded addon is updated: this page and the Discord board are the reference.", "Le jeu affiche encore les anciens points tant que l'addon Guilded n'est pas à jour : cette page et le tableau Discord font foi.")}</p>` : "";
    const rules = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), link("/leaderboards/guilds/", lang)], [guild.name, link(base, lang)], [t("Duels", "Duels"), null]], escapeHtml)
      + `<p class="eyebrow">${t("Guild", "Guilde")} · ${t("Duels", "Duels")}${f.rating && f.seasonId ? ` · ${escapeHtml(ratingSeasonName(f.seasonId, lang))}` : ""}</p><h1>${escapeHtml(guild.name)}</h1>`
      + `<nav class="tabs"><a href="${link(base, lang)}">${t("Dungeons", "Donjons")}</a><a class="on" href="${link(here, lang)}">${t("Duels", "Duels")}</a></nav>`
      + `<div class="tiles"><div class="tile"><div class="k">${t("Counted duels", "Duels comptés")}</div><div class="v">${board.duels}</div></div><div class="tile"><div class="k">${t("Duellists", "Duellistes")}</div><div class="v">${board.rows.length}</div></div>`
      + (f.rating && f.seasonId ? `<div class="tile"><div class="k">${t("Rules", "Règles")}</div><div class="v">${f.seasonId === "s0" ? t("Points", "Points") : t("Rating", "Cote")}</div></div>` : "") + `</div>`
      + transition + form + `<h2>${t("Ranking", "Classement")}</h2>` + ranking
      + `<details class="rules" open><summary>${t("How scoring works", "Comment fonctionne le score")}</summary><ul>${rules}</ul></details>`
      + (recent ? `<h2>${t("Recent duels", "Duels récents")}</h2>${recent}` : "")
      + `<h2>${t("Head to head", "Face à face")}</h2>` + h2hForm + h2h
      + `<p class="muted">${t("Duels between members of this guild, reported by their own Guilded companions.", "Duels entre membres de cette guilde, rapportés par leurs compagnons Guilded.")} <a href="${link(`${here}.json`, lang, f.rating ? { when: f.when } : {})}">JSON</a></p>`;
    return kit.page(200, `${guild.name} · ${t("Duels", "Duels")}`, body, { description: t(`${guild.name}: guild duel leaderboard on Guilded.`, `${guild.name} : classement des duels de la guilde sur Guilded.`) });
  }

  // /leaderboards/guild/<slug>/duels.json: the same board for the phone app. Names, classes and numbers only.
  async function guildDuelsJson(ctx: WebContext, key: string): Promise<WebResponse> {
    const send = (status: number, value: unknown): WebResponse => ({ status, headers: jsonHeaders(), body: ctx.request.method === "HEAD" ? "" : JSON.stringify(value) });
    await ensureIndex(ctx);
    const guild = findGuild(ctx, await cached("guilds", () => deps.store.guilds()), key);
    if (!guild || !deps.store.guildDuelRows) return send(404, { error: "not found" });
    // An old id URL moves to the stable slug address, like the page.
    if (key !== indexOf(ctx).slugs.get(guild.id)) return { status: 302, headers: { location: link(`${guildPath(ctx, guild)}/duels.json`, ctx.lang, Object.fromEntries([...ctx.request.query].filter(([k]) => k !== "lang"))), "cache-control": "public, max-age=300" }, body: "" };
    const all = await cached(`duels:${guild.id}`, () => deps.store.guildDuelRows!(guild.id));
    const startsAt = await duelStart(guild.id);
    const f = await duelFilters(ctx, startsAt);
    const board = duelBoardFor(all, f, startsAt);
    const ratingView = !!board.season;
    return send(200, {
      slug: indexOf(ctx).slugs.get(guild.id) ?? null, name: guild.name,
      rules: ratingView ? { id: RATING.id, since: startsAt.toISOString(), text: ratingRuleLines(ctx.lang, startsAt) } : { id: DUEL_RULES.id, since: DUEL_RULES.since, text: duelRuleLines(ctx.lang) },
      ratingStartsAt: startsAt.toISOString(), season: f.rating ? f.seasonId : null, when: f.when, duels: board.duels,
      players: board.rows.slice(0, 100).map((row) => ({ rank: row.rank || null, name: row.name, className: row.className, level: row.level, points: row.points, ...(row.rating ? { rating: Math.round(row.rating.score), ranked: row.rating.ranked, placement: row.rating.placement } : {}),
        wins: row.wins, losses: row.losses, winRate: Math.round(row.winRate * 1000) / 1000, streak: row.streak, bestStreak: row.bestStreak, lastDuelAt: row.lastAt.toISOString() })),
      recent: board.recent.map((d) => ({ at: d.endedAt.toISOString(), winner: d.winner, loser: d.loser, points: d.change ? null : duelPoints(d.winnerLevel, d.loserLevel), ...(d.change ? { winnerChange: Math.round(d.change.winner), loserChange: Math.round(d.change.loser), rated: d.change.rated } : {}), fled: d.reason === "retreat" }))
    });
  }

  // /leaderboards/duels/: the global duel ladder (rating-v1, from 1 December 2026 UTC; before that the page does not exist).
  const globalOpen = () => !!deps.store.globalDuelRows && ratingApplies(now(), RATING_START);
  async function globalBoard(ctx: WebContext) {
    const all = await cached("duels:global", () => deps.store.globalDuelRows!());
    const f = await duelFilters(ctx, RATING_START);
    const seasonId = f.seasonId && f.seasonId !== "s0" ? f.seasonId : seasonOf(now(), RATING_START).id;
    const scoped = all.filter((d) => seasonOf(d.endedAt, RATING_START).id === seasonId);
    return { all, scoped, f, seasonId, board: buildGlobalBoard(all, seasonId, RATING_START, { className: f.className, levels: f.filters.levels }) };
  }
  // Guild text from a client: plain, clipped and escaped; it links only when it is exactly the name of a listed guild.
  const guildLinkFor = async (ctx: WebContext, text: string | null): Promise<string> => {
    if (!text) return "";
    const clipped = escapeHtml(text.slice(0, 60));
    const guilds = await cached("guilds", () => deps.store.guilds());
    const match = guilds.find((g) => g.name.trim().toLowerCase() === text.trim().toLowerCase());
    return match ? `<a href="${link(guildPath(ctx, match), ctx.lang)}">${clipped}</a>` : clipped;
  };
  async function globalDuelsPage(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    if (!globalOpen()) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Page not found", "Page introuvable")}</h1>`, { noindex: true });
    await ensureIndex(ctx);
    const { scoped, f, seasonId, board } = await globalBoard(ctx);
    const here = "/leaderboards/duels/";
    const classesNow = [...new Set(buildGlobalBoard(scoped, seasonId, RATING_START, { className: null, levels: f.filters.levels }).rows.map((row) => row.className).filter((c): c is string => !!c))].sort();
    const seasons: { value: string; label: string }[] = [];
    for (let at = seasonOf(now(), RATING_START).from, i = 0; i < 24; i++) {
      const id = seasonOf(at < RATING_START ? RATING_START : at, RATING_START).id;
      seasons.push({ value: id, label: ratingSeasonName(id, lang) });
      if (at <= RATING_START) break;
      at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1));
    }
    const form = `<form class="filters" method="get" action="${escapeHtml(here)}"><input type="hidden" name="lang" value="${lang}">`
      + `<div><label for="when">${t("Season", "Saison")}</label><select id="when" name="when">${options(seasons, seasonId)}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([{ value: "", label: t("Any", "Toutes") }, ...classesNow.map((name) => ({ value: name, label: classLabel(name, lang) }))], f.className ?? "")}</select></div>`
      + `<div><label for="levels">${t("Levels", "Niveaux")}</label><select id="levels" name="levels">${options([{ value: "", label: t("All levels", "Tous") }, ...DUEL_LEVEL_BANDS.map((b) => ({ value: b.key, label: b.key === "60" ? t("Level 60", "Niveau 60") : `${t("Levels", "Niveaux")} ${b.key.replace("-", "–")}` }))], f.band?.key ?? "")}</select></div>`
      + `<div><button class="button" type="submit">${t("Show", "Afficher")}</button></div></form>`;
    const person = (name: string, className: string | null, realm: string) => `<span class="c-${classSlug(className)}">${escapeHtml(name)}</span>${realm ? ` <span class="muted">${escapeHtml(realm)}</span>` : ""}`;
    const guildCells = new Map<string, string>();
    for (const row of board.rows.slice(0, 100)) guildCells.set(row.key, await guildLinkFor(ctx, row.guild));
    const ranking = board.rows.length ? table([t("#", "#"), t("Player", "Joueur"), t("Guild", "Guilde"), t("Level", "Niveau"), t("Rating", "Cote"), t("W–L", "V–D"), t("Win rate", "Taux"), t("Streak", "Série"), t("Last duel", "Dernier duel")],
      board.rows.slice(0, 100).map((row) => `<tr><td class="num">${row.rank || "·"}</td><td>${person(row.name, row.className, row.realm)}${row.className ? ` <span class="class-name c-${classSlug(row.className)}">${escapeHtml(classLabel(row.className, lang))}</span>` : ""}</td><td>${guildCells.get(row.key) ?? ""}</td><td class="num">${row.level ?? "–"}</td><td class="num score">${row.placement ? `<span class="muted" title="${t("Ranked after 8 duels against 4 different opponents", "Classé après 8 duels contre 4 adversaires différents")}">${t("placement", "placement")} ${row.placement.duels}/${row.placement.needDuels}</span>` : String(Math.round(row.score))}</td><td class="num">${row.wins}–${row.losses}</td><td class="num">${percent(row.winRate)}</td><td class="num">${streakText(row.streak)}</td><td>${date(row.lastAt)}</td></tr>`), [0, 3, 4, 5, 6, 7], "dense")
      : `<p class="muted">${t("No duel recorded for these filters yet.", "Aucun duel enregistré pour ces filtres.")}</p>`;
    const change = (value: number, rated: boolean) => rated ? showChange(value) : "0";
    const recent = board.recent.length ? table([t("Date", "Date"), t("Winner", "Gagnant"), t("Loser", "Perdant"), t("Rating", "Cote"), ""],
      board.recent.map((d) => `<tr><td>${date(d.endedAt)}</td><td>${person(d.winner, d.winnerClass, d.winnerRealm)}</td><td>${person(d.loser, d.loserClass, d.loserRealm)}</td><td class="num">${change(d.change.winner, d.change.rated)} / ${change(d.change.loser, d.change.rated)}</td><td>${d.confirmed ? `<span class="tag" title="${t("Both players' addons reported this duel", "Les addons des deux joueurs ont rapporté ce duel")}">${t("confirmed by both", "confirmé par les deux")}</span>` : `<span class="tag muted">${t("reported", "rapporté")}</span>`}${d.reason === "retreat" ? ` <span class="tag">${t("opponent fled", "adversaire en fuite")}</span>` : ""}</td></tr>`), [3], "dense")
      : "";
    const names = [...new Set(scoped.flatMap((d) => [d.winner, d.loser]))].sort((x, y) => x.localeCompare(y));
    const meeting = f.a && f.b ? globalHeadToHead(scoped, f.a, f.b) : null;
    const h2hForm = `<form class="filters" method="get" action="${escapeHtml(here)}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="when" value="${escapeHtml(seasonId)}">`
      + `<div><label for="a">${t("Player", "Joueur")} 1</label><input id="a" name="a" list="duel-names" maxlength="60" value="${escapeHtml(f.a)}"></div>`
      + `<div><label for="b">${t("Player", "Joueur")} 2</label><input id="b" name="b" list="duel-names" maxlength="60" value="${escapeHtml(f.b)}"></div>`
      + `<datalist id="duel-names">${names.slice(0, 300).map((name) => `<option value="${escapeHtml(name)}">`).join("")}</datalist>`
      + `<div><button class="button" type="submit">${t("Compare", "Comparer")}</button></div></form>`;
    const h2h = !f.a || !f.b ? "" : meeting
      ? `<p><strong>${escapeHtml(meeting.a)}</strong> ${meeting.aWins} – ${meeting.bWins} <strong>${escapeHtml(meeting.b)}</strong></p>`
        + (meeting.last.length ? table([t("Date", "Date"), t("Winner", "Gagnant"), t("Loser", "Perdant")], meeting.last.map((d) => `<tr><td>${date(d.endedAt)}</td><td>${escapeHtml(d.winner)}</td><td>${escapeHtml(d.loser)}</td></tr>`), [], "dense") : "")
      : `<p class="muted">${t("Both names must appear in this season's duels.", "Les deux noms doivent apparaître dans les duels de cette saison.")}</p>`;
    const outsiders = GLOBAL_RANK_OUTSIDERS ? [] : [lang === "fr"
      ? "Seuls les joueurs dont l'addon Guilded a rapporté au moins un duel sont classés ; leurs adversaires sans addon apparaissent dans les duels."
      : "Only players whose own Guilded addon reported at least one duel are ranked; opponents without the addon appear in the duels."];
    const rules = [...ratingRuleLines(lang, RATING_START), ...outsiders].map((line) => `<li>${escapeHtml(line)}</li>`).join("");
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Duels", "Duels"), null]], escapeHtml)
      + `<p class="eyebrow">${t("Duels", "Duels")} · ${escapeHtml(ratingSeasonName(seasonId, lang))}</p><h1>${t("Duel ladder", "Classement des duels")}</h1>`
      + `<div class="tiles"><div class="tile"><div class="k">${t("Counted duels", "Duels comptés")}</div><div class="v">${board.duels}</div></div><div class="tile"><div class="k">${t("Ranked players", "Joueurs classés")}</div><div class="v">${board.rows.filter((row) => row.rank).length}</div></div></div>`
      + form + `<h2>${t("Ranking", "Classement")}</h2>` + ranking
      + `<details class="rules" open><summary>${t("How scoring works", "Comment fonctionne le score")}</summary><ul>${rules}</ul></details>`
      + `<p class="muted">${t("Results are reported by the players' own Guilded addons; a result seen by one addon only is marked reported. This is not cheat-proof: a modified addon could report a false duel. Names, classes, levels and guild names come from those reports.", "Les résultats sont rapportés par les addons Guilded des joueurs ; un résultat vu par un seul addon est marqué rapporté. Ce n'est pas à l'épreuve de la triche : un addon modifié pourrait rapporter un faux duel. Les noms, classes, niveaux et noms de guilde viennent de ces rapports.")}</p>`
      + (recent ? `<h2>${t("Recent duels", "Duels récents")}</h2>${recent}` : "")
      + `<h2>${t("Head to head", "Face à face")}</h2>` + h2hForm + h2h
      + `<p class="muted"><a href="${link("/leaderboards/duels.json", lang, { when: seasonId })}">JSON</a></p>`;
    return kit.page(200, t("Duel ladder", "Classement des duels"), body, { description: t("The Guilded duel ladder: rating, record and recent duels of players across guilds.", "Le classement des duels de Guilded : cote, bilan et duels récents des joueurs de toutes les guildes.") });
  }
  async function globalDuelsJson(ctx: WebContext): Promise<WebResponse> {
    const send = (status: number, value: unknown): WebResponse => ({ status, headers: jsonHeaders(), body: ctx.request.method === "HEAD" ? "" : JSON.stringify(value) });
    if (!globalOpen()) return send(404, { error: "not found" });
    await ensureIndex(ctx);
    const { board, seasonId } = await globalBoard(ctx);
    return send(200, {
      rules: { id: RATING.id, since: RATING_START.toISOString(), text: ratingRuleLines(ctx.lang, RATING_START) }, season: seasonId, duels: board.duels,
      players: board.rows.slice(0, 100).map((row) => ({ rank: row.rank || null, name: row.name, realm: row.realm, className: row.className, level: row.level, guild: row.guild, rating: Math.round(row.score), ranked: row.ranked, placement: row.placement,
        wins: row.wins, losses: row.losses, winRate: Math.round(row.winRate * 1000) / 1000, streak: row.streak, bestStreak: row.bestStreak, lastDuelAt: row.lastAt.toISOString() })),
      recent: board.recent.map((d) => ({ at: d.endedAt.toISOString(), winner: d.winner, winnerRealm: d.winnerRealm, loser: d.loser, loserRealm: d.loserRealm, winnerChange: Math.round(d.change.winner), loserChange: Math.round(d.change.loser), rated: d.change.rated, confirmedByBoth: d.confirmed, fled: d.reason === "retreat" }))
    });
  }

  // /me/: the personal companion code.
  async function pairingPage(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    if (!deps.personal) return kit.redirect(link("/me/", lang));
    const { code, expiresAt } = await issuePersonalCode(deps.personal, ctx.account!.id, now());
    const body = `<p class="eyebrow">${t("Guilded companion", "Compagnon Guilded")}</p><h1>${t("Your companion code", "Votre code de compagnon")}</h1>`
      + `<p class="code">${escapeHtml(code)}</p><p class="muted">${t("Valid 15 minutes, once. Do not share it.", "Valable 15 minutes, une fois. Ne le partagez pas.")} (${expiresAt.toISOString().slice(11, 16)} UTC)</p>`
      + `<ol><li>${t("Install Guilded Dungeons (or Guilded) and play a dungeon once, so its saved file exists.", "Installez Guilded Dungeons (ou Guilded) et faites un donjon, pour que son fichier de sauvegarde existe.")}</li>`
      + `<li>${t("This code only works with companions older than 7.2 (the current companion has nothing to paste: press <strong>Sign in with Discord</strong> in its window instead). Older companions: paste it and press Connect, then choose your <code>GuildedDungeons.lua</code> or <code>Guilded.lua</code> in <code>WTF\\Account\\…\\SavedVariables</code>.", "Ce code ne sert qu'aux compagnons plus anciens que 7.2 (le compagnon actuel n'a rien à coller : appuyez plutôt sur <strong>Se connecter avec Discord</strong> dans sa fenêtre). Anciens compagnons : collez-le et appuyez sur Connecter, puis choisissez votre <code>GuildedDungeons.lua</code> ou <code>Guilded.lua</code> dans <code>WTF\\Account\\…\\SavedVariables</code>.")}</li>`
      + `<li>${t("Your finished runs appear on the leaderboards after the next upload.", "Vos donjons terminés apparaissent dans les classements après le prochain envoi.")}</li></ol>`
      + `<p><a href="${link("/me/", lang)}">${t("Back to my page", "Retour à ma page")}</a></p>`;
    return kit.page(200, t("Companion code", "Code du compagnon"), body, { noindex: true });
  }

  // The website homepage's "This week on Guilded" strip (site/site.js): counts and the week's top
  // rated runs, with the same rating rules as the board. Dungeon, levels, time and score only: no names.
  async function summary(ctx: WebContext): Promise<WebResponse> {
    const { periods, filters, period } = await pageFilters(ctx);
    const weekPeriod = filterPeriod({ season: filters.season, week: true }, now(), periods);
    const rules = periodRules(weekPeriod);
    const keep = keepPlayer(filters, rules);
    const rated = (await periodRuns(weekPeriod)).filter((run) => !run.challenge).flatMap((run) => {
      const s = rateRun(run, rules).score;
      return s && run.players.some((p) => keep(p, run) && (rules.evidencePolicy !== "current-v2" || rateRun(run, rules, p).score)) ? [{ run, s }] : [];
    }).sort((a, b) => b.s.points - a.s.points || a.run.durationSec - b.run.durationSec);
    const guilds = await cached("guilds", () => deps.store.guilds());
    const body = JSON.stringify({
      season: periodName(ctx, period), ratedRunsThisWeek: rated.length, guilds: guilds.length,
      topRuns: rated.slice(0, 3).map(({ run, s }) => ({ dungeon: run.dungeonName, levels: bracketName(ctx, s.bracket), time: time(run.durationSec), score: s.points }))
    });
    return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "x-content-type-options": "nosniff" }, body: ctx.request.method === "HEAD" ? "" : body };
  }

  // The phone app's boards: the same public ratings as the website's top tables, as JSON (10 characters per level
  // bracket, 10 guilds per bracket). Names are the public display names already on the page; nothing private.
  async function boardsJson(ctx: WebContext): Promise<WebResponse> {
    const { filters, period } = await pageFilters(ctx);
    await ensureIndex(ctx, period);
    const rules = periodRules(period);
    const all = (await periodRuns(period)).filter((run) => !run.challenge);
    const scores = characterScores(all, rules, keepPlayer(filters, rules));
    const ranks = await guildRanks(period);
    const body = JSON.stringify({
      season: periodName(ctx, period),
      brackets: rules.brackets.map((b) => ({
        key: b.key, name: bracketName(ctx, b.key),
        characters: scores.filter((row) => row.bracket === b.key).slice(0, 10).map((row, i) => ({ rank: i + 1, name: (row.player as LeaderPlayer).displayName || row.player.character, realm: row.player.realm || null, className: row.player.className ?? null, role: row.player.role ?? null, points: row.points })),
        guilds: ranks.filter((r) => r.bracket === b.key).slice(0, 10).map((r, i) => ({ rank: i + 1, id: r.guild.id, name: r.guild.name, slug: r.guild.slug ?? null, path: guildPath(ctx, r.guild), points: r.points, rated: r.rated }))
      }))
    });
    return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" }, body: ctx.request.method === "HEAD" ? "" : body };
  }

  const jsonHeaders = () => ({ "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" });
  // /leaderboards/guilds.json: every listed guild's rank per bracket; /leaderboards/guild/<slug>.json: one guild's public stats.
  async function guildsJson(ctx: WebContext, key: string | null): Promise<WebResponse> {
    const { period } = await pageFilters(ctx);
    await ensureIndex(ctx, period);
    const rules = periodRules(period);
    const entries = await guildEntries(period);
    const ranks = rankGuilds(entries, rules);
    const send = (status: number, value: unknown): WebResponse => ({ status, headers: jsonHeaders(), body: ctx.request.method === "HEAD" ? "" : JSON.stringify(value) });
    if (key === null) {
      return send(200, { season: periodName(ctx, period), guilds: entries.map(({ guild }) => ({ slug: indexOf(ctx).slugs.get(guild.id) ?? null, name: guild.name, path: guildPath(ctx, guild),
        ranks: ranks.filter((r) => r.guild.id === guild.id).map((r) => ({ bracket: r.bracket, rank: ranks.filter((o) => o.bracket === r.bracket).findIndex((o) => o.guild.id === guild.id) + 1, points: r.points, rated: r.rated })) })) });
    }
    const entry = entries.find(({ guild }) => indexOf(ctx).slugs.get(guild.id) === key.toLowerCase() || guild.id === key);
    if (!entry) return send(404, { error: "not found" });
    const stats = guildPageStats(entry.runs, entry.roster, rules, (await periodRuns(period)).filter((run) => !run.challenge), currentEdition());
    const info = (await allGuildStats()).find((row) => row.guildId === entry.guild.id) ?? null;
    return send(200, {
      season: periodName(ctx, period), slug: indexOf(ctx).slugs.get(entry.guild.id) ?? null, name: entry.guild.name, faction: info?.faction ?? null, realm: info?.realm ?? null,
      ranks: ranks.filter((r) => r.guild.id === entry.guild.id).map((r) => ({ bracket: r.bracket, rank: ranks.filter((o) => o.bracket === r.bracket).findIndex((o) => o.guild.id === entry.guild.id) + 1, of: ranks.filter((o) => o.bracket === r.bracket).length, points: r.points, rated: r.rated })),
      rankedPlayers: stats.ranked, runs: stats.runs, records: stats.records, unranked: unrankedReason(entry.runs, stats),
      dungeons: stats.dungeons.map((d) => ({ instanceId: d.instanceId, difficultyId: d.difficultyId, routeKey: d.routeKey, name: d.name, clears: d.runs, bestSec: d.bestSec, record: d.record })),
      topByRole: stats.topByRole.map(({ role, row }) => ({ role, name: row.player.displayName || row.player.character, realm: row.player.realm || null, bracket: row.bracket, points: row.points })),
      activity: stats.activity
    });
  }

  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path;
    if (path === "/leaderboards/guilds.json" && ["GET", "HEAD"].includes(ctx.request.method)) return guildsJson(ctx, null);
    const guildJson = /^\/leaderboards\/guild\/([A-Za-z0-9_-]{1,40})\.json$/.exec(path);
    if (guildJson && ["GET", "HEAD"].includes(ctx.request.method)) return guildsJson(ctx, guildJson[1]!);
    if (path === "/leaderboards/summary.json" && ["GET", "HEAD"].includes(ctx.request.method)) return summary(ctx);
    if (path === "/leaderboards/boards.json" && ["GET", "HEAD"].includes(ctx.request.method)) return boardsJson(ctx);
    const card = /^\/leaderboards\/character\/([^/]{1,200})\/card\.png$/.exec(path);
    if (card && ["GET", "HEAD"].includes(ctx.request.method)) return character(ctx, kit, card[1]!, true);
    const run = /^\/leaderboards\/run\/([A-Za-z0-9_-]{1,40})(\/card\.png)?$/.exec(path);
    if (run && ["GET", "HEAD"].includes(ctx.request.method)) return runPage(ctx, kit, run[1]!, !!run[2]);
    if (path === "/leaderboards/" && ctx.request.method !== "POST") return board(ctx, kit);
    const match = /^\/leaderboards\/character\/([^/]{1,200})$/.exec(path);
    if (match && ctx.request.method !== "POST") return character(ctx, kit, match[1]!);
    if ((path === "/leaderboards/guilds/" || path === "/leaderboards/guilds") && ctx.request.method !== "POST") return guildsBoard(ctx, kit);
    if ((path === "/leaderboards/characters/" || path === "/leaderboards/characters") && ctx.request.method !== "POST") return charactersBoard(ctx, kit);
    const guild = /^\/leaderboards\/guild\/([A-Za-z0-9_-]{1,40})\/?$/.exec(path);
    if (guild && ctx.request.method !== "POST") return guildPage(ctx, kit, guild[1]!);
    if ((path === "/leaderboards/duels/" || path === "/leaderboards/duels") && ctx.request.method !== "POST") return globalDuelsPage(ctx, kit);
    if (path === "/leaderboards/duels.json" && ["GET", "HEAD"].includes(ctx.request.method)) return globalDuelsJson(ctx);
    const duelsJson = /^\/leaderboards\/guild\/([A-Za-z0-9_-]{1,40})\/duels\.json$/.exec(path);
    if (duelsJson && ["GET", "HEAD"].includes(ctx.request.method)) return guildDuelsJson(ctx, duelsJson[1]!);
    const duelsPage = /^\/leaderboards\/guild\/([A-Za-z0-9_-]{1,40})\/duels\/?$/.exec(path);
    if (duelsPage && ctx.request.method !== "POST") return guildDuelsPage(ctx, kit, duelsPage[1]!);
    if (path === "/me/pair" && ctx.request.method === "POST") return pairingPage(ctx, kit);
    if (path === "/me/pair/revoke" && ctx.request.method === "POST") {
      await deps.personal?.revokeCredentials(ctx.account!.id);
      return kit.redirect(link("/me/", ctx.lang, { done: "companion-off" }));
    }
    return null;
  };

  async function meSection(ctx: WebContext): Promise<string> {
    if (!deps.personal || !ctx.account) return "";
    const { t, lang } = ctx;
    const connected = await deps.personal.hasCredential(ctx.account.id);
    const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}">`;
    // Sign in with Discord (7.2) is the way to connect; the code stays for companions older than 7.2.
    return `<h2>${t("Public dungeon leaderboards", "Classements publics des donjons")}</h2>`
      + `<p class="muted">${t("Connect the Guilded companion to your account (no guild needed) and it sends your finished dungeon runs to the", "Reliez le compagnon Guilded à votre compte (sans guilde) et il envoie vos donjons terminés aux")} <a href="${link("/leaderboards/", lang)}">${t("leaderboards", "classements")}</a>.</p>`
      + (ctx.request.query.get("done") === "companion-off" ? `<p class="notice">${t("Companion disconnected.", "Compagnon déconnecté.")}</p>` : "")
      + (connected ? `<p>✔ ${t("A companion is connected.", "Un compagnon est connecté.")}</p><form method="post" action="/me/pair/revoke">${csrf}<button class="link" type="submit">${t("Disconnect it", "Le déconnecter")}</button></form>` : "")
      + `<ol><li>${t("Install Guilded Dungeons (or Guilded) and log in once, so its saved file exists.", "Installez Guilded Dungeons (ou Guilded) et connectez-vous une fois au jeu, pour que son fichier de sauvegarde existe.")}</li>`
      + `<li>${t("Open the companion window and press <strong>Sign in with Discord</strong>. On the page that opens, choose <strong>Public dungeon leaderboards only</strong> if you have no guild. Nothing to type: it finds your saved file and sends your finished runs by itself.", "Ouvrez la fenêtre du compagnon et appuyez sur <strong>Se connecter avec Discord</strong>. Sur la page qui s'ouvre, choisissez <strong>Classements publics des donjons seulement</strong> si vous n'avez pas de guilde. Rien à taper : il trouve votre fichier de sauvegarde et envoie vos donjons terminés tout seul.")}</li>`
      + `<li>${t("If the companion cannot find the game, press <strong>Choose WoW folder</strong> in its window.", "Si le compagnon ne trouve pas le jeu, appuyez sur <strong>Choisir le dossier WoW</strong> dans sa fenêtre.")}</li>`
      + `<li>${t("After a dungeon, /reload: the Windows companion sends your runs by itself.", "Après un donjon, /reload : le compagnon Windows envoie vos donjons tout seul.")}</li></ol>`
      + `<p><a class="button" href="/companion/">${t("Get the Windows companion", "Obtenir le compagnon Windows")}</a></p>`
      + `<details><summary>${t("Companion older than 7.2? Use a code", "Compagnon plus ancien que 7.2 ? Utilisez un code")}</summary>`
      + `<form method="post" action="/me/pair">${csrf}<p><button class="link" type="submit">${connected ? t("Get a new companion code", "Obtenir un nouveau code") : t("Get a companion code", "Obtenir un code de compagnon")}</button></p></form></details>`;
  }

  return { route: (ctx, kit) => {
    let edition;
    try { edition = gameEditionOf({ gameEdition: ctx.request.query.get("edition") ?? "forever" }); }
    catch { return Promise.resolve(kit.page(400, "Unknown WoW edition", "")); }
    return withEdition(edition, () => route(ctx, kit));
  }, meSection };
}
