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
import { duelLeaderboard, percent, streakText, type DuelStanding } from "./duels.js";
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
  aliases?: string[] }
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
  /** Counted guild duels of the request's edition (8.4.5), for the guild's duel page. */
  guildDuels?(guildId: string): Promise<{ standings: DuelStanding[]; duels: number }>;
  /** Counts for the guild leaderboard (GuildStats), for guilds already returned by guilds(). */
  guildStats?(guildIds: string[]): Promise<GuildStats[]>;
}
export interface PublicGuild { id: string; name: string; slug?: string | null }

// A guild's score in a bracket: its GUILD_COUNT best members' scores added up (Raider.IO-style
// team ranking), so one strong player cannot carry a guild alone.
export const GUILD_COUNT = 5;
export interface GuildRank { guild: PublicGuild; bracket: string; points: number; rated: number; best: ScoreRow; runs: number }
export function rankGuilds(entries: { guild: PublicGuild; runs: LeaderRun[]; roster: string[] }[], rules = publicRules()): GuildRank[] {
  const ranks: GuildRank[] = [];
  for (const { guild, runs, roster } of entries) {
    const members = new Set(roster.map((name) => name.toLowerCase()));
    const scores = characterScores(runs, rules).filter((row) => onRoster(members, row.player, rules.gameEdition ?? "forever"));
    for (const bracket of rules.brackets) {
      const rows = scores.filter((row) => row.bracket === bracket.key).sort((a, b) => b.points - a.points);
      if (!rows.length) continue;
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
  const fastest = new Map<number, LeaderRun>();
  for (const run of allRuns) {
    if (run.challenge) continue;
    const best = fastest.get(run.instanceId);
    if (!best || run.durationSec < best.durationSec || (run.durationSec === best.durationSec && run.endedAt < best.endedAt)) fastest.set(run.instanceId, run);
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
      const rows = await database.guildSettings.findMany({ where: { publicDungeonRuns: true, guild: { gameEdition: currentEdition(), isTestServer: false } }, select: { guildId: true, guild: { select: { name: true, discordId: true, page: { select: { slug: true, published: true } } } } }, take: 200 });
      return rows.filter((row) => allows(row.guild.discordId))
        .map((row) => ({ id: row.guildId, name: row.guild.name, slug: row.guild.page?.published ? row.guild.page.slug : null })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async guildRoster(guildId) {
      const rows = await database.character.findMany({ where: { member: { guildId, status: "ACTIVE" } }, select: { name: true, realm: true, gameEdition: true }, take: 5_000 });
      return rows.map((row) => characterKey(row.name, row.realm, row.gameEdition ?? "forever"));
    },
    async guildRuns(guildId, query) {
      return (await every({ ...range(query), uploads: { some: { uploaderKey: `guild:${guildId}` } } })).sort(newestFirst);
    },
    async guildDuels(guildId) {
      return duelLeaderboard(database, guildId, currentEdition(), { limit: 100 });
    },
    async guildStats(guildIds) {
      if (!guildIds.length) return [];
      const edition = currentEdition();
      const [members, characters, listings, duels] = await Promise.all([
        database.member.groupBy({ by: ["guildId"], where: { guildId: { in: guildIds }, status: "ACTIVE", isTest: false }, _count: { _all: true } }),
        database.character.findMany({ where: { gameEdition: edition, member: { guildId: { in: guildIds }, status: "ACTIVE", isTest: false } },
          select: { memberId: true, level: true, realm: true, member: { select: { guildId: true, raceHidden: true } } }, take: 50_000 }),
        database.recruitmentListing.findMany({ where: { guildId: { in: guildIds }, open: true }, select: { guildId: true, faction: true, realm: true }, take: 2_000 }),
        database.duelResult.groupBy({ by: ["guildId"], where: { guildId: { in: guildIds }, gameEdition: edition, counted: true }, _count: { _all: true } })
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
.run-card{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}.best-runs a{margin-right:6px}</style>`;

export interface LeaderboardDeps { store: LeaderboardStore; personal: PersonalStore | null; now?: () => Date; cacheMs?: number;
  /** The owner's season calendar (official-seasons.ts); the seeded Season 1 when left out. */
  calendar?: () => Promise<OfficialWindow[]>;
  /** The character's Public picture (public-pictures.ts), shown on its page and card; none when left out. */
  picture?: (name: string, realm: string | null) => Promise<PublicPicture | null> }

export function createLeaderboardPages(deps: LeaderboardDeps): { route: WebRoute; meSection: (context: WebContext) => Promise<string> } {
  const now = deps.now ?? (() => new Date());
  const cacheMs = deps.cacheMs ?? 60_000;
  const cache = new Map<string, { at: number; value: unknown }>();
  async function cached<T>(id: string, load: () => Promise<T>): Promise<T> {
    id = `${currentEdition()}:${id}`;
    const hit = cache.get(id);
    if (hit && now().getTime() - hit.at < cacheMs) return hit.value as T;
    const value = await load();
    cache.set(id, { at: now().getTime(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
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
  const table = (head: string[], rows: string[], numeric: number[] = []) => `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

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
    return table(["#", t("Character", "Personnage"), t("Class", "Classe"), t("Role", "Rôle"), t("Score", "Score"), t("Routes", "Parcours")],
      rows.slice(0, limit).map((row, i) => `<tr><td>${rankCell(i + 1)}</td><td>${who(ctx, row.player)}</td><td>${row.player.className ? escapeHtml(classLabel(row.player.className, lang)) : ""}</td>`
        + `<td>${row.player.role ? escapeHtml(roleLabel(row.player.role, lang)) : ""}</td><td class="num score">${row.points}</td><td class="num">${row.routes.filter((r) => r.counted).length}/${row.routes.length}</td></tr>`), [4, 5]);
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
    + `<a class="${active === "characters" ? "on" : ""}" href="${link("/leaderboards/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null })}">${ctx.t("Overview", "Aperçu")}</a>`
    + `<a class="${active === "rankings" ? "on" : ""}" href="${link("/leaderboards/characters/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null, bracket: filters.bracket })}">${ctx.t("Characters", "Personnages")}</a>`
    + `<a class="${active === "guilds" ? "on" : ""}" href="${link("/leaderboards/guilds/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null })}">${ctx.t("Guilds", "Guildes")}</a></nav>`;
  const guildRuns = (id: string, period: PublicPeriod) => cached(`g:${id}:${period.id}:${period.from?.getTime() ?? ""}`, () => deps.store.guildRuns(id, { from: period.from, to: period.to }));
  async function guildEntries(period: PublicPeriod) {
    const guilds = await cached("guilds", () => deps.store.guilds());
    return Promise.all(guilds.map(async (guild) => ({ guild, runs: await guildRuns(guild.id, period), roster: await cached(`roster:${guild.id}`, () => deps.store.guildRoster(guild.id)) })));
  }
  async function guildRanks(period: PublicPeriod): Promise<GuildRank[]> {
    return rankGuilds(await guildEntries(period), periodRules(period));
  }
  const guildLink = (ctx: WebContext, guild: PublicGuild) => `<a href="${link(`/leaderboards/guild/${encodeURIComponent(guild.id)}`, ctx.lang)}">${escapeHtml(guild.name)}</a>`;
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
          + (withStats ? `<td class="num">${num(s?.duels)}</td>` : "") + `</tr>`;
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
  const CHARACTERS_PER_PAGE = 50;
  async function charactersBoard(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { periods, filters, period } = await pageFilters(ctx);
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
    const list = rows.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>#</th><th>${t("Character", "Personnage")}</th><th>${t("Class", "Classe")}</th><th>${t("Role", "Rôle")}</th><th class="num">${t("Score", "Score")}</th><th class="num">${t("Routes", "Parcours")}</th><th>${t("Best runs", "Meilleurs essais")}</th></tr></thead><tbody>`
      + rows.slice((page - 1) * CHARACTERS_PER_PAGE, page * CHARACTERS_PER_PAGE).map((row, i) => `<tr><td>${rankCell((page - 1) * CHARACTERS_PER_PAGE + i + 1)}</td><td>${who(ctx, row.player)}</td>`
        + `<td class="c-${classSlug(row.player.className)}">${row.player.className ? escapeHtml(classLabel(row.player.className, lang)) : ""}</td><td>${row.player.role ? escapeHtml(roleLabel(row.player.role, lang)) : ""}</td>`
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
    const entries = await guildEntries(period);
    const ranks = rankGuilds(entries, periodRules(period));
    const stats = deps.store.guildStats ? await cached("guild-stats", () => deps.store.guildStats!(entries.map((e) => e.guild.id))) : [];
    const overview = guildOverview(entries, ranks, stats, await periodRuns(period), currentEdition());
    const base = "/leaderboards/guilds/";
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), null]], escapeHtml)
      + `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${t("Guild rankings", "Classement des guildes")}</h1>`
      + `<p class="muted">${t(`A guild's score in a level bracket is its ${GUILD_COUNT} best members' scores added up. Only characters linked to the guild's members count; guilds choose to publish their runs.`, `Le score d'une guilde dans une tranche de niveaux additionne les scores de ses ${GUILD_COUNT} meilleurs membres. Seuls les personnages liés aux membres de la guilde comptent; les guildes choisissent de publier leurs essais.`)}</p>`
      + periodDates(ctx, period) + views(ctx, "guilds", filters)
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, lang, { season: filters.season })}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, lang, { period: "week" })}">${t("This week", "Cette semaine")}</a></nav>`
      + guildOverviewSection(ctx, overview, filters, !!deps.store.guildStats)
      + `<h2>${t("By level bracket", "Par tranche de niveaux")}</h2>`
      + `<div class="grid2">` + periodRules(period).brackets.map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))}</h3>${guildTable(ctx, ranks.filter((r) => r.bracket === b.key), 50)}</section>`).join("") + `</div>`
      + `<p class="muted">${t("Officers publish their guild's runs with /mod leaderboard in Discord.", "Les officiers publient les essais de leur guilde avec /mod leaderboard dans Discord.")}</p>`;
    return kit.page(200, t("Guild rankings", "Classement des guildes"), body, { description: t("WoW Forever guild rankings by dungeon score: each guild's five best members per level bracket.", "Classement des guildes WoW Forever par score de donjon : les cinq meilleurs membres de chaque guilde par tranche de niveaux.") });
  }

  async function board(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { periods, filters, period } = await pageFilters(ctx);
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
        ? table(["#", t("Character", "Personnage"), t("Class", "Classe"), t("Role", "Rôle"), t("Time", "Temps"), t("Score", "Score"), t("Deaths", "Morts"), t("Party", "Groupe"), t("Date", "Date"), ""],
          ranked.map((entry, index) => `<tr><td>${index + 1}</td><td>${who(ctx, entry.player)}</td>`
            + `<td>${entry.player.className ? escapeHtml(classLabel(entry.player.className, lang)) : ""}</td><td>${entry.player.role ? escapeHtml(roleLabel(entry.player.role, lang)) : ""}</td>`
            + `<td class="num">${time(entry.run.durationSec)}</td><td class="num score">${scoreCell(ctx, entry.run, periodRules(period), entry.player)}</td><td class="num">${entry.run.deaths ?? "?"}</td><td>${party(ctx, entry.run)}</td><td>${date(entry.run.endedAt)}</td><td>${trust(ctx, entry.run)}</td></tr>`), [4, 5, 6])
        : `<p class="muted">${t("No run matches these filters yet.", "Aucun essai ne correspond encore à ces filtres.")}</p>`);
    } else {
      const weekPeriod = filterPeriod({ season: filters.season, week: true }, now(), periods);
      const week = filters.week ? all : await periodRuns(weekPeriod);
      const scores = characterScores(all, periodRules(period), keepPlayer(filters, periodRules(period)));
      const brackets = periodRules(period).brackets.filter((b) => !filters.bracket || b.key === filters.bracket);
      const ranks = await guildRanks(period);
      // With nobody ranked yet, one line replaces a grid of empty level brackets.
      const ranked = brackets.some((b) => scores.some((row) => row.bracket === b.key));
      const weekHtml = topRuns(ctx, week, filters, periodRules(weekPeriod));
      // A week with no rated runs is one sentence and a link, not a "0 this week" headline above the season table.
      const weekBlock = weekHtml.includes('class="empty-cta"') ? weekHtml
        : `<h2>${t("Top runs this week", "Meilleurs essais de la semaine")}</h2><p class="muted">${t("A weekly snapshot; character and guild rankings below use your selected period.", "Aperçu hebdomadaire; les classements des personnages et des guildes ci-dessous utilisent la période choisie.")}</p>${weekHtml}`;
      body = weekBlock
        + `<h2>${t("Top characters", "Meilleurs personnages")} · ${escapeHtml(periodName(ctx, period))}</h2><p class="muted">${t("Score adds a character’s best distinct rated routes in each level bracket. Higher is better.", "Le score additionne les meilleurs parcours classés distincts du personnage dans chaque tranche de niveaux. Plus il est élevé, mieux c’est.")}</p>`
        + (ranked || !brackets.length ? `<div class="grid2">` + brackets.map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))} <span class="tag">${t(`best ${b.bestCount} routes`, `${b.bestCount} meilleurs parcours`)}</span></h3>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 25)}<p><a href="${link("/leaderboards/characters/", lang, { season: filters.season, period: filters.week ? "week" : null, bracket: b.key, class: filters.className, role: filters.role, realm: filters.realm })}">${t("Full ranking →", "Classement complet →")}</a></p></section>`).join("") + `</div>`
          : `<p class="muted">${t("Nobody is ranked yet in this period: your first ranked clear puts you on the board.", "Personne n'est encore classé pour cette période : votre premier essai classé vous place au classement.")}</p>`)
        + (filters.bracket && !brackets.length ? `<p class="muted">${t("This bracket is not rated yet (launch data needed).", "Cette tranche n'est pas encore classée (données de lancement requises).")}</p>` : "")
        + `<h2>${t("Dungeon records", "Records des donjons")}</h2>` + (dungeons.length
          ? table([t("Dungeon", "Donjon"), t("Record", "Record"), t("Runs", "Essais")], dungeons.map((d) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(d.instanceId), season: filters.season, period: filters.week ? "week" : null, bracket: filters.bracket })}">${escapeHtml(d.dungeonName)}</a></td><td class="num">${time(d.bestSec)}</td><td class="num">${d.runs}</td></tr>`), [1, 2])
          : `<p class="muted">${t("No standard dungeon record in this period yet. Install Guilded Dungeons, sign in and connect the companion from your page.", "Aucun record de donjon standard pour cette période. Installez Guilded Dungeons, connectez-vous et reliez le compagnon depuis votre page.")} <a href="${link("/me/", lang)}">${t("My page", "Ma page")}</a></p>`)
        // Guild scores are whole-guild totals: hidden while a character filter narrows the page.
        + (ranks.length && !filters.className && !filters.role && !filters.realm && !filters.confirmed ? `<h2>${t("Top guilds", "Meilleures guildes")}</h2><div class="grid2">${brackets.map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))}</h3>${guildTable(ctx, ranks.filter((r) => r.bracket === b.key), 5)}</section>`).join("")}</div>`
          + `<p><a href="${link("/leaderboards/guilds/", lang, { season: filters.season, period: filters.week ? "week" : null })}">${t("All guild rankings →", "Tout le classement des guildes →")}</a></p>` : "");
    }
    const scoreExample = `<p class="muted">${t("Standard dungeon score example: two counted routes worth 150 and 200 points give 350. Unranked reports add no points; provisional targets may still change before rules are frozen.", "Exemple de score des donjons standards : deux parcours comptabilisés à 150 et 200 points donnent 350. Les rapports non classés n'ajoutent aucun point; les cibles provisoires peuvent évoluer avant le gel des règles.")}</p>`;
    return kit.page(200, t("Dungeon leaderboards", "Classements des donjons"), PAGE_CSS + intro(ctx, period) + periodDates(ctx, period) + `<p><a href="${link("/me/", lang)}">${t("Find your characters in My Guilded →", "Retrouvez vos personnages dans Mon Guilded →")}</a></p>` + views(ctx, "characters", filters) + filterForm(ctx, filters, filterDungeons, periods) + scoreExample + body,
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
        footer: t("Community reports · Provisional targets · Not Blizzard verified · guilded.kcaron.top", "Rapports communautaires · Cibles provisoires · Non vérifié par Blizzard · guilded.kcaron.top")
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
        footer: t("Community report · Provisional targets · Not Blizzard verified · guilded.kcaron.top", "Rapport communautaire · Cibles provisoires · Non vérifié par Blizzard · guilded.kcaron.top")
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

  async function guildPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    const guild = (await cached("guilds", () => deps.store.guilds())).find((g) => g.id === id);
    if (!guild) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Guild not found", "Guilde introuvable")}</h1><p class="muted">${t("Only guilds that publish their runs have a page.", "Seules les guildes qui publient leurs essais ont une page.")}</p><p><a href="${link("/leaderboards/guilds/", lang)}">${t("Guild rankings", "Classement des guildes")}</a></p>`, { noindex: true });
    const { filters, period } = await pageFilters(ctx);
    const runs = await guildRuns(id, period);
    const roster = new Set((await cached(`roster:${id}`, () => deps.store.guildRoster(id))).map((name) => name.toLowerCase()));
    // Members only: pickup players in the guild's runs keep their own character pages.
    const scores = characterScores(runs, periodRules(period)).filter((row) => onRoster(roster, row.player, currentEdition()));
    const ranks = await guildRanks(period);
    const standing = periodRules(period).brackets.flatMap((b) => {
      const inBracket = ranks.filter((r) => r.bracket === b.key);
      const index = inBracket.findIndex((r) => r.guild.id === id);
      return index < 0 ? [] : [`<span class="badge">${escapeHtml(bracketName(ctx, b.key))}</span> <span class="score">${inBracket[index]!.points}</span> <span class="tag">#${index + 1} / ${inBracket.length}</span>`];
    });
    const base = `/leaderboards/guild/${encodeURIComponent(id)}`;
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), link("/leaderboards/guilds/", lang)], [guild.name, null]], escapeHtml)
      + `<p class="eyebrow">${t("Guild", "Guilde")} · ${escapeHtml(periodName(ctx, period))}</p><div class="hero"><h1>${escapeHtml(guild.name)}</h1>`
      + (guild.slug ? `<a href="/g/${encodeURIComponent(guild.slug)}/">${t("Guild page →", "Page de guilde →")}</a>` : "") + `</div>`
      + (standing.length ? `<p>${standing.join(" &nbsp; ")}</p>` : "")
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, lang)}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, lang, { period: "week" })}">${t("This week", "Cette semaine")}</a>${deps.store.guildDuels ? `<a href="${link(`${base}/duels`, lang)}">${t("Duels", "Duels")}</a>` : ""}</nav>`
      + periodRules(period).brackets.map((b) => `<h2>${escapeHtml(bracketName(ctx, b.key))}</h2>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 100)}`).join("")
      + `<h2>${t("Recent runs", "Essais récents")}</h2>` + (runs.length
        ? table([t("Date", "Date"), t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), ""], runs.slice(0, 20).map((run) => `<tr><td>${date(run.endedAt)}</td><td><a href="${link(runPath(run.runId), lang)}">${escapeHtml(run.dungeonName)}</a></td><td class="num">${time(run.durationSec)}</td><td class="num score">${scoreCell(ctx, run, periodRules(period))}</td><td>${party(ctx, run)}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3])
        : `<p class="muted">${t("No public run in this period yet.", "Aucun essai public pour cette période.")}</p>`);
    return kit.page(200, guild.name, body, { description: t(`${guild.name}: members' dungeon scores and guild ranking on Guilded.`, `${guild.name} : scores de donjon des membres et classement de la guilde sur Guilded.`) });
  }

  // /leaderboards/guild/<id>/duels: the guild's duel board (members of the guild only, counted duels).
  async function guildDuelsPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    const guild = (await cached("guilds", () => deps.store.guilds())).find((g) => g.id === id);
    if (!guild || !deps.store.guildDuels) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Guild not found", "Guilde introuvable")}</h1>`, { noindex: true });
    const { standings, duels } = await cached(`duels:${id}`, () => deps.store.guildDuels!(id));
    const base = `/leaderboards/guild/${encodeURIComponent(id)}`;
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), link("/leaderboards/guilds/", lang)], [guild.name, link(base, lang)], [t("Duels", "Duels"), null]], escapeHtml)
      + `<p class="eyebrow">${t("Guild", "Guilde")} · ${t("Duels", "Duels")}</p><h1>${escapeHtml(guild.name)}</h1>`
      + `<nav class="tabs"><a href="${link(base, lang)}">${t("Dungeons", "Donjons")}</a><a class="on" href="${link(`${base}/duels`, lang)}">${t("Duels", "Duels")}</a></nav>`
      + (standings.length ? table([t("#", "#"), t("Player", "Joueur"), t("Score", "Score"), t("Wins", "Victoires"), t("Losses", "Défaites"), t("Win rate", "Taux"), t("Streak", "Série"), t("Best streak", "Meilleure série")],
        standings.map((row, index) => `<tr><td class="num">${index + 1}</td><td>${escapeHtml(row.name)}</td><td class="num score">${row.score}</td><td class="num">${row.wins}</td><td class="num">${row.losses}</td><td class="num">${percent(row.winRate)}</td><td class="num">${streakText(row.streak)}</td><td class="num">${row.bestStreak}</td></tr>`), [2, 3, 4, 5, 6, 7])
        : `<p class="muted">${t("No duel recorded yet.", "Aucun duel enregistré.")}</p>`)
      + `<p class="muted">${t(`${duels} counted duels between members of this guild, reported by their own Guilded companions. At most 5 duels per pair of players per day count. Score: 10 per win, +2 per level the opponent was above the winner, -2 per level below (0 to 20). No rewards.`, `${duels} duels comptés entre membres de cette guilde, rapportés par leurs compagnons Guilded. 5 duels par paire de joueurs et par jour au maximum comptent. Score : 10 par victoire, +2 par niveau de l'adversaire au-dessus du gagnant, -2 en dessous (0 à 20). Aucune récompense.`)}</p>`;
    return kit.page(200, `${guild.name} · ${t("Duels", "Duels")}`, body, { description: t(`${guild.name}: guild duel leaderboard on Guilded.`, `${guild.name} : classement des duels de la guilde sur Guilded.`) });
  }

  // /me/: the personal companion code.
  async function pairingPage(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    if (!deps.personal) return kit.redirect(link("/me/", lang));
    const { code, expiresAt } = await issuePersonalCode(deps.personal, ctx.account!.id, now());
    const body = `<p class="eyebrow">${t("Guilded companion", "Compagnon Guilded")}</p><h1>${t("Your companion code", "Votre code de compagnon")}</h1>`
      + `<p class="code">${escapeHtml(code)}</p><p class="muted">${t("Valid 15 minutes, once. Do not share it.", "Valable 15 minutes, une fois. Ne le partagez pas.")} (${expiresAt.toISOString().slice(11, 16)} UTC)</p>`
      + `<ol><li>${t("Install Guilded Dungeons (or Guilded) and play a dungeon once, so its saved file exists.", "Installez Guilded Dungeons (ou Guilded) et faites un donjon, pour que son fichier de sauvegarde existe.")}</li>`
      + `<li>${t("In the Guilded companion, open Connection &amp; setup, then <em>Older companions or your guild's own bot</em>: paste this code and press Connect. Then choose your <code>GuildedDungeons.lua</code> or <code>Guilded.lua</code> in <code>WTF\\Account\\…\\SavedVariables</code>.", "Dans le compagnon Guilded, ouvrez Connexion et configuration, puis <em>Anciens compagnons ou bot de votre guilde</em> : collez ce code et appuyez sur Connecter. Choisissez ensuite votre <code>GuildedDungeons.lua</code> ou <code>Guilded.lua</code> dans <code>WTF\\Account\\…\\SavedVariables</code>.")}</li>`
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
    const rules = periodRules(period);
    const all = (await periodRuns(period)).filter((run) => !run.challenge);
    const scores = characterScores(all, rules, keepPlayer(filters, rules));
    const ranks = await guildRanks(period);
    const body = JSON.stringify({
      season: periodName(ctx, period),
      brackets: rules.brackets.map((b) => ({
        key: b.key, name: bracketName(ctx, b.key),
        characters: scores.filter((row) => row.bracket === b.key).slice(0, 10).map((row, i) => ({ rank: i + 1, name: (row.player as LeaderPlayer).displayName || row.player.character, realm: row.player.realm || null, className: row.player.className ?? null, role: row.player.role ?? null, points: row.points })),
        guilds: ranks.filter((r) => r.bracket === b.key).slice(0, 10).map((r, i) => ({ rank: i + 1, id: r.guild.id, name: r.guild.name, slug: r.guild.slug ?? null, points: r.points, rated: r.rated }))
      }))
    });
    return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" }, body: ctx.request.method === "HEAD" ? "" : body };
  }

  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path;
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
      + `<li>${t("Open the companion, go to Connection &amp; setup and choose <strong>Sign in with Discord</strong>, then <strong>Public dungeon leaderboards only</strong> under Other choices. Nothing to type.", "Ouvrez le compagnon, allez dans Connexion et configuration et choisissez <strong>Connexion avec Discord</strong>, puis <strong>Classements publics des donjons seulement</strong> sous Autres choix. Rien à taper.")}</li>`
      + `<li>${t("In step 2, choose your <code>WTF\\Account\\…\\SavedVariables</code> folder (or the file in it): the companion reads <code>GuildedDungeons.lua</code> and <code>Guilded.lua</code>, whichever addon you use.", "À l'étape 2, choisissez votre dossier <code>WTF\\Account\\…\\SavedVariables</code> (ou le fichier qu'il contient) : le compagnon lit <code>GuildedDungeons.lua</code> et <code>Guilded.lua</code>, selon l'addon que vous utilisez.")}</li>`
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
