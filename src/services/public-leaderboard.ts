import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { integrityRole, readDungeonIntegrity, readPlayerIntegrity } from "./dungeon-integrity.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { readChallenge } from "./challenge-evidence.js";
import { rankChallenges, challengeClock } from "./challenge-leaderboard.js";
import { challengeScores, challengePolicyText } from "./challenge-rating.js";
import { DEFAULT_DUNGEON_BRACKETS } from "./dungeon-november-rules.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLASSES } from "../wow-data.js";
import { formatDuration } from "./dungeon-rules.js";
import { issuePersonalCode, type PersonalStore } from "./personal-pairing.js";
import { GAIN_STEP, planImprovements, roleScores, type ImprovementPlan, type RoutePlan } from "./public-guidance.js";
import { classLabel, className as classFromText, roleLabel, ROLES } from "./recruitment.js";
import type { OfficialWindow } from "./official-seasons.js";
import type { BracketedRules } from "./dungeon-november-rules.js";
import { characterId, characterScores, DEFAULT_OFFICIAL, periodRules, publicRules, publicSeasons, publicWeek, rateRun, rulesAt, type PublicPeriod, type ScoreRow, type ScoreRun } from "./public-score.js";
import { breadcrumbs } from "./site-header.js";
import { editionSelect, escapeHtml, link, options } from "./web-layout.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";
import { scoreCardResponse } from "./score-card.js";
import { currentEdition, withEdition } from "./edition-context.js";
import { gameEditionOf } from "./game-edition.js";

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

export interface LeaderPlayer { character: string; displayName?: string | null; realm: string; className: string | null; role: string | null; level: number | null; minLevel?: number | null; presentSec?: number | null; integrity?: unknown }
export interface LeaderRun extends ScoreRun {
  deaths: number | null; bracket: string | null; season: string; players: LeaderPlayer[];
}
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
    const scores = characterScores(runs, rules).filter((row) => members.has(characterKey(row.player.character, row.player.realm, rules.gameEdition ?? "forever")));
    for (const bracket of rules.brackets) {
      const rows = scores.filter((row) => row.bracket === bracket.key).sort((a, b) => b.points - a.points);
      if (!rows.length) continue;
      const counted = new Set(rows.flatMap((row) => row.routes.filter((r) => r.counted).map((r) => (r.run as LeaderRun).runId)));
      ranks.push({ guild, bracket: bracket.key, points: rows.slice(0, GUILD_COUNT).reduce((sum, row) => sum + row.points, 0), rated: rows.length, best: rows[0]!, runs: counted.size });
    }
  }
  return ranks.sort((a, b) => b.points - a.points || b.rated - a.rated || a.guild.name.localeCompare(b.guild.name));
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
    if (run.gameEdition === "retail" && run.difficultyId === 8) continue;
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
    if (run.gameEdition === "retail" && run.difficultyId === 8) continue;
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
      if (page.length < 5_000) return runs;
      cursor = page[page.length - 1]!.id;
    }
  }
  return {
    async run(id) {
      const row = await database.publicRun.findFirst({ where: { id, status: "ACCEPTED", gameEdition: currentEdition() }, select: PUBLIC_RUN_SELECT });
      return row ? leaderRun(row) : null;
    },
    async runs(query) {
      return (await every(range(query))).sort((a, b) => a.durationSec - b.durationSec || a.endedAt.getTime() - b.endedAt.getTime());
    },
    async characterRuns(character, realm) {
      return (await every({ status: "ACCEPTED", players: { some: { character: { equals: character, mode: "insensitive" }, ...(realm !== null ? { realm: { equals: realm, mode: "insensitive" } } : {}) } } })).sort(newestFirst);
    },
    async guilds() {
      const rows = await database.guildSettings.findMany({ where: { publicDungeonRuns: true, guild: { gameEdition: currentEdition() } }, select: { guildId: true, guild: { select: { name: true, discordId: true, page: { select: { slug: true, published: true } } } } }, take: 200 });
      return rows.filter((row) => allows(row.guild.discordId))
        .map((row) => ({ id: row.guildId, name: row.guild.name, slug: row.guild.page?.published ? row.guild.page.slug : null })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async guildRoster(guildId) {
      const rows = await database.character.findMany({ where: { member: { guildId, status: "ACTIVE" } }, select: { name: true, realm: true, gameEdition: true }, take: 5_000 });
      return rows.map((row) => characterKey(row.name, row.realm, row.gameEdition ?? "forever"));
    },
    async guildRuns(guildId, query) {
      return (await every({ ...range(query), uploads: { some: { uploaderKey: `guild:${guildId}` } } })).sort(newestFirst);
    }
  };
}

const PAGE_CSS = `<style>details.rules{margin:0 0 20px}details.rules>summary{display:inline-flex;align-items:center;min-height:44px;cursor:pointer;color:var(--gold)}details.rules p{margin-top:4px}.empty-cta{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px 18px}.empty-cta p{margin:0 0 6px}.c-warrior{color:#c69b6d}.c-paladin{color:#f48cba}.c-hunter{color:#aad372}.c-rogue{color:#fff468}.c-priest{color:#fff}.c-shaman{color:#2a8cff}
.c-mage{color:#3fc7eb}.c-warlock{color:#8788ee}.c-druid{color:#ff7c0a}.c-deathknight{color:#c41e3a}.c-monk{color:#00ff98}.c-demonhunter{color:#a330c9}.c-evoker{color:#33937f}
a.char{text-decoration:none;font-weight:600}.score{font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums}.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:12px;color:var(--muted)}
.badge.ok{border-color:#4f7a4a;color:#9fd49a}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tabs a{border:1px solid var(--line);border-radius:6px;padding:4px 12px;text-decoration:none}.tabs a.on{background:var(--gold);color:#111;border-color:var(--gold)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}.hero{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline}.bar-cell{width:40%}.meter{height:8px;background:var(--gold);border-radius:4px}
.tabs.views a{font-weight:700;padding:6px 16px}.guild-list{columns:2;padding-left:18px}.grid2 section h2{margin-top:24px}</style>`;

export interface LeaderboardDeps { store: LeaderboardStore; personal: PersonalStore | null; now?: () => Date; cacheMs?: number;
  /** The owner's season calendar (official-seasons.ts); the seeded Season 1 when left out. */
  calendar?: () => Promise<OfficialWindow[]> }

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
    return `<form class="filters" method="get" action="/leaderboards/"><input type="hidden" name="lang" value="${lang}">`
      + editionSelect(lang)
      + `<div><label for="season">${t("Season", "Saison")}</label><select id="season" name="season">${options([...seasons, { value: "all", label: t("All time", "Depuis le début") }], filters.season)}</select></div>`
      + `<div><label for="period">${t("Period", "Période")}</label><select id="period" name="period">${options([{ value: "", label: t("Whole season", "Toute la saison") }, { value: "week", label: t("This week", "Cette semaine") }], filters.week ? "week" : "")}</select></div>`
      + `<div><label for="bracket">${t("Levels", "Niveaux")}</label><select id="bracket" name="bracket">${options([any, ...[...new Set([...brackets(), ...periods.flatMap(period => periodRules(period).brackets.map(b => b.key))])].map((value) => ({ value, label: bracketName(ctx, value) }))], filters.bracket)}</select></div>`
      + `<div><label for="dungeon">${t("Dungeon", "Donjon")}</label><select id="dungeon" name="dungeon">${options([{ value: "", label: t("All dungeons", "Tous les donjons") }, ...dungeons.map((d) => ({ value: String(d.instanceId), label: d.dungeonName }))], filters.instanceId ? String(filters.instanceId) : "")}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([any, ...CLASSES.map((name) => ({ value: name, label: classLabel(name, lang) }))], filters.className)}</select></div>`
      + `<div><label for="role">${t("Role", "Rôle")}</label><select id="role" name="role">${options([any, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], filters.role)}</select></div>`
      + `<div><label for="realm">${t("Realm", "Royaume")}</label><input id="realm" name="realm" maxlength="60" value="${escapeHtml(filters.realm ?? "")}"></div>`
      + `<div><label><input type="checkbox" style="width:auto" name="confirmed" value="1"${filters.confirmed ? " checked" : ""}> ${t("Confirmed by the party", "Confirmés par le groupe")}</label></div>`
      + `<div><button class="button" type="submit">${t("Show", "Afficher")}</button></div></form>`;
  }

  function scoreTable(ctx: WebContext, rows: ScoreRow[], limit: number): string {
    const { t, lang } = ctx;
    if (!rows.length) return `<p class="muted">${t("No rated run yet.", "Aucun essai classé pour l'instant.")}</p>`;
    return table(["#", t("Character", "Personnage"), t("Class", "Classe"), t("Role", "Rôle"), t("Score", "Score"), t("Routes", "Parcours")],
      rows.slice(0, limit).map((row, i) => `<tr><td>${i + 1}</td><td>${who(ctx, row.player)}</td><td>${row.player.className ? escapeHtml(classLabel(row.player.className, lang)) : ""}</td>`
        + `<td>${row.player.role ? escapeHtml(roleLabel(row.player.role, lang)) : ""}</td><td class="num score">${row.points}</td><td class="num">${row.routes.filter((r) => r.counted).length}/${row.routes.length}</td></tr>`), [4, 5]);
  }

  function topRuns(ctx: WebContext, runs: LeaderRun[], filters: LeaderFilters, rules: BracketedRules, limit = 10): string {
    const { t } = ctx;
    const keep = keepPlayer(filters, rules);
    const rated = runs.flatMap((run) => { const s = rateRun(run, rules).score; return s && (!filters.bracket || s.bracket === filters.bracket)
      && run.players.some((p) => keep(p, run) && (rules.evidencePolicy !== "current-v2" || rateRun(run, rules, p).score)) ? [{ run, s }] : []; })
      .sort((a, b) => b.s.points - a.s.points || a.run.durationSec - b.run.durationSec).slice(0, limit);
    if (!rated.length) return `<div class="empty-cta"><p><strong>${t("No rated run this week yet. Be the first on the board.", "Aucun essai classé cette semaine. Soyez le premier au classement.")}</strong></p>`
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
  const tabs = (ctx: WebContext, filters: LeaderFilters) => `<nav class="tabs">`
    + `<a class="${filters.week ? "" : "on"}" href="${link("/leaderboards/", ctx.lang, { season: filters.season, bracket: filters.bracket })}">${ctx.t("Season", "Saison")}</a>`
    + `<a class="${filters.week ? "on" : ""}" href="${link("/leaderboards/", ctx.lang, { period: "week", bracket: filters.bracket })}">${ctx.t("This week", "Cette semaine")}</a></nav>`;

  // Characters | Guilds: the two rankings, like Raider.IO's top tabs.
  const views = (ctx: WebContext, active: "characters" | "guilds", filters: LeaderFilters) => `<nav class="tabs views" aria-label="${ctx.t("Rankings", "Classements")}">`
    + `<a class="${active === "characters" ? "on" : ""}" href="${link("/leaderboards/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null })}">${ctx.t("Characters", "Personnages")}</a>`
    + `<a class="${active === "guilds" ? "on" : ""}" href="${link("/leaderboards/guilds/", ctx.lang, { season: filters.season, period: filters.week ? "week" : null })}">${ctx.t("Guilds", "Guildes")}</a></nav>`;
  const guildRuns = (id: string, period: PublicPeriod) => cached(`g:${id}:${period.id}:${period.from?.getTime() ?? ""}`, () => deps.store.guildRuns(id, { from: period.from, to: period.to }));
  async function guildRanks(period: PublicPeriod): Promise<GuildRank[]> {
    const guilds = await cached("guilds", () => deps.store.guilds());
    return rankGuilds(await Promise.all(guilds.map(async (guild) => ({ guild, runs: await guildRuns(guild.id, period), roster: await cached(`roster:${guild.id}`, () => deps.store.guildRoster(guild.id)) }))), periodRules(period));
  }
  const guildLink = (ctx: WebContext, guild: PublicGuild) => `<a href="${link(`/leaderboards/guild/${encodeURIComponent(guild.id)}`, ctx.lang)}">${escapeHtml(guild.name)}</a>`;
  function guildTable(ctx: WebContext, ranks: GuildRank[], limit: number): string {
    const { t } = ctx;
    if (!ranks.length) return `<p class="muted">${t("No rated guild yet.", "Aucune guilde classée pour l'instant.")}</p>`;
    return table(["#", t("Guild", "Guilde"), t("Score", "Score"), t("Rated", "Classés"), t("Best character", "Meilleur personnage")],
      ranks.slice(0, limit).map((rank, i) => `<tr><td>${i + 1}</td><td>${guildLink(ctx, rank.guild)}</td><td class="num score">${rank.points}</td><td class="num">${rank.rated}</td><td>${who(ctx, rank.best.player)} <span class="tag">${rank.best.points}</span></td></tr>`), [2, 3]);
  }

  async function guildsBoard(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { filters, period } = await pageFilters(ctx);
    const ranks = await guildRanks(period);
    const guilds = await cached("guilds", () => deps.store.guilds());
    const base = "/leaderboards/guilds/";
    const body = PAGE_CSS + breadcrumbs(lang, [[t("Leaderboards", "Classements"), link("/leaderboards/", lang)], [t("Guilds", "Guildes"), null]], escapeHtml)
      + `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${t("Guild rankings", "Classement des guildes")}</h1>`
      + `<p class="muted">${t(`A guild's score in a level bracket is its ${GUILD_COUNT} best members' scores added up. Only characters linked to the guild's members count; guilds choose to publish their runs.`, `Le score d'une guilde dans une tranche de niveaux additionne les scores de ses ${GUILD_COUNT} meilleurs membres. Seuls les personnages liés aux membres de la guilde comptent; les guildes choisissent de publier leurs essais.`)}</p>`
      + views(ctx, "guilds", filters)
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, lang, { season: filters.season })}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, lang, { period: "week" })}">${t("This week", "Cette semaine")}</a></nav>`
      + `<div class="grid2">` + periodRules(period).brackets.map((b) => `<section><h2>${escapeHtml(bracketName(ctx, b.key))}</h2>${guildTable(ctx, ranks.filter((r) => r.bracket === b.key), 50)}</section>`).join("") + `</div>`
      + (guilds.length ? `<h2>${t("All guilds", "Toutes les guildes")}</h2><ul class="guild-list">${guilds.map((g) => `<li>${guildLink(ctx, g)}${g.slug ? ` · <a class="tag" href="/g/${encodeURIComponent(g.slug)}/">${t("guild page", "page de guilde")}</a>` : ""}</li>`).join("")}</ul>` : "")
      + `<p class="muted">${t("Officers publish their guild's runs with /mod leaderboard in Discord.", "Les officiers publient les essais de leur guilde avec /mod leaderboard dans Discord.")}</p>`;
    return kit.page(200, t("Guild rankings", "Classement des guildes"), body, { description: t("WoW Forever guild rankings by dungeon score: each guild's five best members per level bracket.", "Classement des guildes WoW Forever par score de donjon : les cinq meilleurs membres de chaque guilde par tranche de niveaux.") });
  }

  async function board(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const { periods, filters, period } = await pageFilters(ctx);
    const periodResults = await periodRuns(period);
    const all = periodResults.filter(run => !(run.gameEdition === "retail" && run.difficultyId === 8));
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
      body = `<h2>${t("Top runs this week", "Meilleurs essais de la semaine")}</h2>${topRuns(ctx, week, filters, periodRules(weekPeriod))}`
        + `<h2>${t("Top characters", "Meilleurs personnages")} · ${escapeHtml(periodName(ctx, period))}</h2>`
        + (ranked || !brackets.length ? `<div class="grid2">` + brackets.map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))} <span class="tag">${t(`best ${b.bestCount} routes`, `${b.bestCount} meilleurs parcours`)}</span></h3>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 25)}</section>`).join("") + `</div>`
          : `<p class="muted">${t("Nobody is ranked yet in this period: your first ranked clear puts you on the board.", "Personne n'est encore classé pour cette période : votre premier essai classé vous place au classement.")}</p>`)
        + (filters.bracket && !brackets.length ? `<p class="muted">${t("This bracket is not rated yet (launch data needed).", "Cette tranche n'est pas encore classée (données de lancement requises).")}</p>` : "")
        + `<h2>${t("Dungeon records", "Records des donjons")}</h2>` + (dungeons.length
          ? table([t("Dungeon", "Donjon"), t("Record", "Record"), t("Runs", "Essais")], dungeons.map((d) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(d.instanceId), season: filters.season, period: filters.week ? "week" : null, bracket: filters.bracket })}">${escapeHtml(d.dungeonName)}</a></td><td class="num">${time(d.bestSec)}</td><td class="num">${d.runs}</td></tr>`), [1, 2])
          : `<p class="muted">${t("No public run in this period yet. Install Guilded Dungeons, sign in and connect the companion from your page.", "Aucun essai public pour cette période. Installez Guilded Dungeons, connectez-vous et reliez le compagnon depuis votre page.")} <a href="${link("/me/", lang)}">${t("My page", "Ma page")}</a></p>`)
        // Guild scores are whole-guild totals: hidden while a character filter narrows the page.
        + (ranks.length && !filters.className && !filters.role && !filters.realm && !filters.confirmed ? `<h2>${t("Top guilds", "Meilleures guildes")}</h2><div class="grid2">${brackets.map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))}</h3>${guildTable(ctx, ranks.filter((r) => r.bracket === b.key), 5)}</section>`).join("")}</div>`
          + `<p><a href="${link("/leaderboards/guilds/", lang, { season: filters.season, period: filters.week ? "week" : null })}">${t("All guild rankings →", "Tout le classement des guildes →")}</a></p>` : "");
    }
    if (currentEdition() === "retail") {
      const eligible = periodResults.filter(run => !filters.instanceId || run.instanceId === filters.instanceId);
      const ranks = rankChallenges(eligible, keepPlayer(filters));
      const ratingRules = periodRules(period).keystoneRating;
      const scores = challengeScores(eligible, ratingRules, keepPlayer(filters));
      const rating = ratingRules ? `<h2>${t("Guilded Mythic+ rating", "Cote Guilded Mythic+")} · ${escapeHtml(ratingRules.pool)}</h2><p>${t("Provisional rating inspired by Raider.IO: your best score per dungeon, summed across this pool. Each dungeon counts once across affixes and roles. This is Guilded's own formula, not an official Raider.IO or Blizzard score.", "Cote provisoire inspirée de Raider.IO : somme du meilleur score de chaque donjon. Chaque donjon compte une fois, tous affixes et rôles confondus. Formule propre à Guilded, sans cote officielle Raider.IO ou Blizzard.")}</p><p>${escapeHtml(challengePolicyText(ratingRules.model, ctx.lang))}</p>`
        + `<p>${t("Base points by key level, plus up to 25 points for speed (full bonus at 40% under the timer). Supported keys: +2 to +30. Repeats cannot lower your score.", "Points de base selon la clé, plus un bonus de vitesse de 25 points maximum (bonus complet à 40 % sous le délai). Clés prises en charge : +2 à +30. Une répétition ne réduit jamais la cote.")}</p>`
        + (scores.length ? `<table><thead><tr><th>${t("Character", "Personnage")}</th><th>${t("Rating", "Cote")}</th><th>${t("Dungeons", "Donjons")}</th></tr></thead><tbody>${scores.slice(0,100).map(r => `<tr><td>${escapeHtml(r.character)}-${escapeHtml(r.realm)}<details><summary>${t("Contributing runs", "Essais comptabilisés")}</summary>${r.best.map(b => `<div>${escapeHtml(b.run.dungeonName)} · +${b.challenge.level} · ${challengeClock(b.challenge.durationMs)} · ${b.points.toFixed(1)}</div>`).join("")}</details></td><td>${r.points.toFixed(1)}</td><td>${r.completed}/${ratingRules.dungeons.length}</td></tr>`).join("")}</tbody></table>` : `<p>${t("No eligible seasonal rating yet.", "Aucune cote de saison admissible pour le moment.")}</p>`) : "";
      const groups = [...new Set(ranks.map(r => r.group))];
      const keystones = `<h2>Mythic+ · ${escapeHtml(periodName(ctx, period))}</h2><p>${t("Highest key finished in time, then the official timer. Separate rankings by dungeon and affixes. At least 80% presence; practice runs and overtime runs do not rank. These are community reports, not Blizzard verification.", "Plus haute clé terminée à temps, puis chrono officiel. Classements séparés par donjon et affixes. Présence d'au moins 80 %; entraînement et hors délai exclus. Rapports communautaires, sans vérification Blizzard.")}</p>`
        + (groups.length ? groups.map(group => {
          const rows = ranks.filter(r => r.group === group);
          const first = rows[0]!;
          return `<h3>${escapeHtml(first.run.dungeonName)} · ${t("Affixes", "Affixes")} ${first.challenge.affixIds.join(", ") || "—"}</h3>`
            + table(["#", t("Character", "Personnage"), t("Key", "Clé"), t("Official time", "Temps officiel"), t("Run", "Essai")],
              rows.slice(0, 50).map((r, i) => `<tr><td>${i + 1}</td><td>${who(ctx, r.player)}</td><td>+${r.challenge.level}</td><td>${challengeClock(r.challenge.durationMs)}</td><td><a href="${link(runPath(r.run.runId), lang)}">${date(r.run.endedAt)}</a></td></tr>`), [2, 3]);
        }).join("") : `<p class="muted">${t("No eligible keys in this period.", "Aucune clé admissible dans cette période.")}</p>`);
      body = rating + keystones + body;
    }
    return kit.page(200, t("Dungeon leaderboards", "Classements des donjons"), PAGE_CSS + intro(ctx, period) + views(ctx, "characters", filters) + tabs(ctx, filters) + filterForm(ctx, filters, filterDungeons, periods) + body,
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
    const isMe = (player: LeaderPlayer) => player.character.toLowerCase() === name.toLowerCase() && (realm === null || player.realm.toLowerCase() === realm.toLowerCase());
    const me = runs.flatMap((run) => run.players.filter(isMe))[0];
    const title = `${me?.displayName || me?.character || name}${realm ? `-${realm}` : ""}`;
    const seasons = await seasonsNow();
    const inPeriod = (p: PublicPeriod) => runs.filter((run) => (!p.from || run.endedAt >= p.from) && (!p.to || run.endedAt < p.to));
    const mine = (rows: ScoreRow[]) => rows.filter((row) => isMe(row.player));
    const season = seasons[0]!;
    const seasonRuns = inPeriod(season);
    const current = mine(characterScores(seasonRuns, periodRules(season)));
    const keyRules = periodRules(season).keystoneRating;
    const keyScores = challengeScores(seasonRuns, keyRules, isMe);
    const keySection = keyScores.length ? `<h2>${t("Provisional Guilded Mythic+ rating", "Cote Guilded Mythic+ provisoire")}</h2>`
      + keyScores.map(r => `<p><strong>${r.points.toFixed(1)}</strong> · ${r.completed}/${keyRules!.dungeons.length} · ${escapeHtml(r.realm)}</p><ul>${r.best.map(b => `<li><a href="${link(runPath(b.run.runId),lang)}">${escapeHtml(b.run.dungeonName)}</a> · +${b.challenge.level} · ${challengeClock(b.challenge.durationMs)} · ${b.points.toFixed(1)}</li>`).join("")}</ul>`).join("")
      + `<p>${t("Best score per dungeon across affixes. Guilded's own provisional formula; not an official Raider.IO or Blizzard score.", "Meilleur score de chaque donjon, tous affixes confondus. Formule provisoire propre à Guilded; sans cote officielle Raider.IO ou Blizzard.")}</p><p>${escapeHtml(challengePolicyText(keyRules!.model, lang))}</p>` : "";
    const imagePath = link(`/leaderboards/character/${raw}/card.png`, lang);
    if (image) {
      if (!runs.length) return kit.page(404, t("Not found", "Introuvable"), "", { noindex: true });
      return scoreCardResponse({ title, subtitle: periodName(ctx, season),
        value: keyScores.length ? keyScores.map(r => `${r.points.toFixed(1)} Mythic+`).join(" · ") : current.length ? current.map(row => `${row.points} (${row.bracket})`).join(" · ") : t("Not rated this season", "Non classé cette saison"),
        detail: t("Dungeon score by level bracket", "Score de donjon par tranche de niveaux"),
        footer: t("Community reports · Provisional targets · guilded.kcaron.top", "Rapports communautaires · Cibles provisoires · guilded.kcaron.top")
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
      if (run.gameEdition === "retail" && run.difficultyId === 8) continue;
      const b = best.get(run.instanceId); if (!b || run.durationSec < b.durationSec) best.set(run.instanceId, run);
    }
    const history = seasons.map((p) => ({ p, rows: mine(characterScores(inPeriod(p), periodRules(p))) })).filter((h) => h.rows.length);
    const top = Math.max(1, ...history.flatMap((h) => h.rows.map((r) => r.points)));
    const body = PAGE_CSS + `<p class="eyebrow">${t("Character", "Personnage")}</p><div class="hero"><h1 class="c-${classSlug(me?.className ?? null)}">${escapeHtml(title)}</h1>`
      + (me?.className ? `<span>${escapeHtml(classLabel(me.className, lang))}${me.level ? ` · ${t("level", "niveau")} ${me.level}` : ""}</span>` : "") + `</div>`
      + keySection
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
    if (image) return scoreCardResponse({ title, subtitle, value: `${displayedTime} · ${score}`,
      detail: `${evidence} · ${run.players.length} ${t("players", "joueurs")}${run.evidence ? "" : t(" · Older evidence check", " · Ancienne vérification")}`,
      footer: t("Community report · Provisional targets · Not Blizzard verified", "Rapport communautaire · Cibles provisoires · Non vérifié par Blizzard")
    }, ctx.request.method === "HEAD");
    const description = `${title} · ${displayedTime} · ${score} · ${evidence}`;
    return kit.page(200, title, PAGE_CSS + `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p><p class="score">${escapeHtml(displayedTime)} · ${escapeHtml(score)}</p>`
      + (run.challenge ? `<p>${t("Official timer", "Chrono officiel")} · affixes ${run.challenge.affixIds.join(", ") || "—"}${run.challenge.practiceRun ? ` · ${t("Practice run", "Entraînement")}` : ""}</p>` : "")
      + (verdict.reason ? `<p>${escapeHtml(verdict.reason)}</p>` : "")
      + `<p>${trust(ctx, run)}</p><p>${party(ctx, run)}</p><p>${t("Scores use this run's season rules. Targets are provisional; community uploads are not Blizzard verification.", "Les scores suivent les règles de la saison du donjon. Les cibles sont provisoires; les envois communautaires ne sont pas vérifiés par Blizzard.")}</p>`
      + `<p><a href="${imagePath}">${t("Download run card", "Télécharger la carte du donjon")}</a></p>`, { description, shareImage: imagePath });
  }

  async function guildPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    const guild = (await cached("guilds", () => deps.store.guilds())).find((g) => g.id === id);
    if (!guild) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Guild not found", "Guilde introuvable")}</h1><p class="muted">${t("Only guilds that publish their runs have a page.", "Seules les guildes qui publient leurs essais ont une page.")}</p><p><a href="${link("/leaderboards/guilds/", lang)}">${t("Guild rankings", "Classement des guildes")}</a></p>`, { noindex: true });
    const { filters, period } = await pageFilters(ctx);
    const runs = await guildRuns(id, period);
    const roster = new Set((await cached(`roster:${id}`, () => deps.store.guildRoster(id))).map((name) => name.toLowerCase()));
    // Members only: pickup players in the guild's runs keep their own character pages.
    const scores = characterScores(runs, periodRules(period)).filter((row) => roster.has(characterKey(row.player.character, row.player.realm, currentEdition())));
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
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, lang)}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, lang, { period: "week" })}">${t("This week", "Cette semaine")}</a></nav>`
      + periodRules(period).brackets.map((b) => `<h2>${escapeHtml(bracketName(ctx, b.key))}</h2>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 100)}`).join("")
      + `<h2>${t("Recent runs", "Essais récents")}</h2>` + (runs.length
        ? table([t("Date", "Date"), t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), ""], runs.slice(0, 20).map((run) => `<tr><td>${date(run.endedAt)}</td><td>${escapeHtml(run.dungeonName)}</td><td class="num">${time(run.durationSec)}</td><td class="num score">${scoreCell(ctx, run, periodRules(period))}</td><td>${party(ctx, run)}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3])
        : `<p class="muted">${t("No public run in this period yet.", "Aucun essai public pour cette période.")}</p>`);
    return kit.page(200, guild.name, body, { description: t(`${guild.name}: members' dungeon scores and guild ranking on Guilded.`, `${guild.name} : scores de donjon des membres et classement de la guilde sur Guilded.`) });
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
    const rated = (await periodRuns(weekPeriod)).filter((run) => !(run.gameEdition === "retail" && run.difficultyId === 8)).flatMap((run) => {
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

  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path;
    if (path === "/leaderboards/summary.json" && ["GET", "HEAD"].includes(ctx.request.method)) return summary(ctx);
    const card = /^\/leaderboards\/character\/([^/]{1,200})\/card\.png$/.exec(path);
    if (card && ["GET", "HEAD"].includes(ctx.request.method)) return character(ctx, kit, card[1]!, true);
    const run = /^\/leaderboards\/run\/([A-Za-z0-9_-]{1,40})(\/card\.png)?$/.exec(path);
    if (run && ["GET", "HEAD"].includes(ctx.request.method)) return runPage(ctx, kit, run[1]!, !!run[2]);
    if (path === "/leaderboards/" && ctx.request.method !== "POST") return board(ctx, kit);
    const match = /^\/leaderboards\/character\/([^/]{1,200})$/.exec(path);
    if (match && ctx.request.method !== "POST") return character(ctx, kit, match[1]!);
    if ((path === "/leaderboards/guilds/" || path === "/leaderboards/guilds") && ctx.request.method !== "POST") return guildsBoard(ctx, kit);
    const guild = /^\/leaderboards\/guild\/([A-Za-z0-9_-]{1,40})\/?$/.exec(path);
    if (guild && ctx.request.method !== "POST") return guildPage(ctx, kit, guild[1]!);
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
      + `<li>${t("Open the companion, go to Connection &amp; setup and choose <strong>Sign in with Discord</strong>, then <strong>Public dungeon leaderboards only</strong>. Nothing to type: the short code on that page only shows it is your companion.", "Ouvrez le compagnon, allez dans Connexion et configuration et choisissez <strong>Connexion avec Discord</strong>, puis <strong>Classements publics des donjons seulement</strong>. Rien à taper : le code court affiché sert seulement à reconnaître votre compagnon.")}</li>`
      + `<li>${t("In step 2, choose your <code>WTF\\Account\\…\\SavedVariables</code> folder (or the file in it): the companion reads <code>GuildedDungeons.lua</code> and <code>Guilded.lua</code>, whichever addon you use.", "À l'étape 2, choisissez votre dossier <code>WTF\\Account\\…\\SavedVariables</code> (ou le fichier qu'il contient) : le compagnon lit <code>GuildedDungeons.lua</code> et <code>Guilded.lua</code>, selon l'addon que vous utilisez.")}</li>`
      + `<li>${t("After a dungeon, /reload: the Windows companion sends your runs by itself; online, choose Sync now.", "Après un donjon, /reload : le compagnon Windows envoie vos donjons tout seul; en ligne, choisissez Synchroniser.")}</li></ol>`
      + `<p><a class="button" href="/companion/?tab=settings">${t("Open the online companion", "Ouvrir le compagnon en ligne")}</a></p>`
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
