import type { PrismaClient } from "@prisma/client";
import { CLASSES } from "../wow-data.js";
import { DEFAULT_DUNGEON_BRACKETS } from "./dungeon-november-rules.js";
import { formatDuration } from "./dungeon-rules.js";
import { issuePersonalCode, type PersonalStore } from "./personal-pairing.js";
import { classLabel, className as classFromText, roleLabel, ROLES } from "./recruitment.js";
import { characterId, characterScores, publicRules, publicSeasons, publicWeek, scoreRun, type PublicPeriod, type ScoreRow, type ScoreRun } from "./public-score.js";
import { escapeHtml, link, options } from "./web-layout.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";

// Public dungeon leaderboards (7.0, roadmap request 6; 7.1 season pages). Layout inspired by
// Raider.IO, built from our own data and words: /leaderboards/ (this week's top runs and top
// characters per bracket, with season, week, bracket, dungeon, class, role and realm filters),
// /leaderboards/?dungeon=<id> (one dungeon), /leaderboards/character/<Name-Realm> (score, best run
// per dungeon, recent runs, score history) and /leaderboards/guild/<id> (an opted-in guild's
// members). Server-rendered, no scripts, cached 60 s. Scores: public-score.ts.

export interface LeaderPlayer { character: string; realm: string; className: string | null; role: string | null; level: number | null }
export interface LeaderRun extends ScoreRun {
  deaths: number | null; bracket: string | null; season: string; players: LeaderPlayer[];
}
export interface DungeonSummary { instanceId: number; dungeonName: string; bestSec: number; runs: number }
export interface RunQuery { from: Date | null; to: Date | null; instanceId?: number | null }

export interface LeaderboardStore {
  runs(query: RunQuery): Promise<LeaderRun[]>;
  characterRuns(character: string, realm: string | null): Promise<LeaderRun[]>;
  guilds(): Promise<{ id: string; name: string }[]>;
  guildRuns(guildId: string, query: RunQuery): Promise<LeaderRun[]>;
}

export interface LeaderFilters {
  instanceId: number | null; season: string; week: boolean; bracket: string | null; className: string | null; role: string | null; realm: string | null; confirmed: boolean;
}
const BRACKETS = DEFAULT_DUNGEON_BRACKETS.map((bracket) => bracket.key as string);

export function readLeaderFilters(query: URLSearchParams, now = new Date()): LeaderFilters {
  const dungeon = Number(query.get("dungeon"));
  const season = query.get("season") ?? "";
  const role = query.get("role")?.toUpperCase() ?? "";
  const realm = (query.get("realm") ?? "").trim().slice(0, 60);
  const known = season === "all" || publicSeasons(now).some((p) => p.id === season);
  return {
    instanceId: Number.isInteger(dungeon) && dungeon > 0 ? dungeon : null,
    season: known ? season : publicSeasons(now)[0]!.id,
    week: query.get("period") === "week",
    bracket: BRACKETS.includes(query.get("bracket") ?? "") ? query.get("bracket") : null,
    className: query.get("class") ? classFromText(query.get("class")!) : null,
    role: (ROLES as readonly string[]).includes(role) ? role : null,
    realm: realm || null,
    confirmed: query.get("confirmed") === "1"
  };
}

/** The time span the filters ask for: this week, one season, or all time. */
export function filterPeriod(filters: Pick<LeaderFilters, "season" | "week">, now: Date): PublicPeriod {
  if (filters.week) return publicWeek(now);
  return publicSeasons(now).find((p) => p.id === filters.season) ?? { id: "all", label: "All time", labelFr: "Depuis le début", from: null, to: null };
}

type PlayerFilters = Pick<LeaderFilters, "className" | "role" | "confirmed"> & { realm?: string | null };
const keepPlayer = (filters: PlayerFilters) => (player: LeaderPlayer, run: ScoreRun) =>
  (!filters.confirmed || run.confirmations >= 2)
  && (!filters.className || player.className?.toLowerCase() === filters.className.toLowerCase())
  && (!filters.role || player.role?.toUpperCase() === filters.role)
  && (!filters.realm || player.realm.toLowerCase() === filters.realm.toLowerCase());

export interface RankedEntry { player: LeaderPlayer; run: LeaderRun }

// Best run per character (name + realm), fastest first; an earlier finish wins a tie.
export function rankCharacters(runs: LeaderRun[], filters: PlayerFilters, limit = 100): RankedEntry[] {
  const best = new Map<string, RankedEntry>();
  const keep = keepPlayer(filters);
  for (const run of runs) {
    for (const player of run.players) {
      if (!keep(player, run)) continue;
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
    const row = map.get(run.instanceId) ?? { instanceId: run.instanceId, dungeonName: run.dungeonName, bestSec: run.durationSec, runs: 0 };
    row.runs += 1; row.bestSec = Math.min(row.bestSec, run.durationSec);
    map.set(run.instanceId, row);
  }
  return [...map.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName));
}

export const characterPath = (player: { character: string; realm: string }) => `/leaderboards/character/${encodeURIComponent(player.realm ? `${player.character}-${player.realm}` : player.character)}`;
const classSlug = (name: string | null) => (name ?? "").toLowerCase().replace(/[^a-z]/g, "");

export function prismaLeaderboardStore(database: PrismaClient): LeaderboardStore {
  const select = { id: true, instanceId: true, routeKey: true, difficultyId: true, dungeonName: true, durationSec: true, endedAt: true, deaths: true, bracket: true, season: true, confirmations: true,
    players: { select: { character: true, realm: true, className: true, role: true, level: true } } } as const;
  type Row = { id: string; instanceId: number; routeKey: string | null; difficultyId: number; dungeonName: string; durationSec: number; endedAt: Date; deaths: number | null; bracket: string | null; season: string; confirmations: number; players: LeaderPlayer[] };
  const view = ({ id, ...row }: Row): LeaderRun => ({ runId: id, ...row });
  const range = (query: RunQuery) => ({ status: "ACCEPTED", ...(query.from || query.to ? { endedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
    ...(query.instanceId ? { instanceId: query.instanceId } : {}) });
  return {
    async runs(query) {
      return (await database.publicRun.findMany({ where: range(query), orderBy: [{ durationSec: "asc" }, { endedAt: "asc" }], take: 5_000, select })).map(view);
    },
    async characterRuns(character, realm) {
      const rows = await database.publicRun.findMany({
        where: { status: "ACCEPTED", players: { some: { character: { equals: character, mode: "insensitive" }, ...(realm !== null ? { realm: { equals: realm, mode: "insensitive" } } : {}) } } },
        orderBy: { endedAt: "desc" }, take: 500, select
      });
      return rows.map(view);
    },
    async guilds() {
      const rows = await database.guildSettings.findMany({ where: { publicDungeonRuns: true }, select: { guildId: true, guild: { select: { name: true } } }, take: 200 });
      return rows.map((row) => ({ id: row.guildId, name: row.guild.name })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async guildRuns(guildId, query) {
      return (await database.publicRun.findMany({ where: { ...range(query), uploads: { some: { uploaderKey: `guild:${guildId}` } } }, orderBy: { endedAt: "desc" }, take: 2_000, select })).map(view);
    }
  };
}

const PAGE_CSS = `<style>.c-warrior{color:#c69b6d}.c-paladin{color:#f48cba}.c-hunter{color:#aad372}.c-rogue{color:#fff468}.c-priest{color:#fff}.c-shaman{color:#2a8cff}
.c-mage{color:#3fc7eb}.c-warlock{color:#8788ee}.c-druid{color:#ff7c0a}.c-deathknight{color:#c41e3a}.c-monk{color:#00ff98}.c-demonhunter{color:#a330c9}.c-evoker{color:#33937f}
a.char{text-decoration:none;font-weight:600}.score{font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums}.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:12px;color:var(--muted)}
.badge.ok{border-color:#4f7a4a;color:#9fd49a}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tabs a{border:1px solid var(--line);border-radius:6px;padding:4px 12px;text-decoration:none}.tabs a.on{background:var(--gold);color:#111;border-color:var(--gold)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}.hero{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline}.bar-cell{width:40%}.meter{height:8px;background:var(--gold);border-radius:4px}</style>`;

export interface LeaderboardDeps { store: LeaderboardStore; personal: PersonalStore | null; now?: () => Date; cacheMs?: number }

export function createLeaderboardPages(deps: LeaderboardDeps): { route: WebRoute; meSection: (context: WebContext) => Promise<string> } {
  const now = deps.now ?? (() => new Date());
  const cacheMs = deps.cacheMs ?? 60_000;
  const cache = new Map<string, { at: number; value: unknown }>();
  async function cached<T>(id: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(id);
    if (hit && now().getTime() - hit.at < cacheMs) return hit.value as T;
    const value = await load();
    cache.set(id, { at: now().getTime(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
  }
  const periodRuns = (period: PublicPeriod) =>
    cached(`r:${period.id}:${period.from?.getTime() ?? ""}`, () => deps.store.runs({ from: period.from, to: period.to }));

  const time = (seconds: number) => formatDuration(seconds);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const who = (ctx: WebContext, player: LeaderPlayer) => `<a class="char c-${classSlug(player.className)}" href="${link(characterPath(player), ctx.lang)}">${escapeHtml(player.character)}</a>`
    + (player.realm ? ` <span class="tag">${escapeHtml(player.realm)}</span>` : "");
  const party = (ctx: WebContext, run: LeaderRun) => run.players.map((player) => `<a class="c-${classSlug(player.className)}" href="${link(characterPath(player), ctx.lang)}">${escapeHtml(player.character)}</a>`).join(", ");
  const trust = (ctx: WebContext, run: LeaderRun) => run.confirmations >= 2
    ? `<span class="badge ok" title="${ctx.t("Party members' uploads agree", "Les envois des membres du groupe concordent")}">✔ ${ctx.t("Confirmed by party", "Confirmé par le groupe")} · ${run.confirmations}</span>`
    : `<span class="badge">${ctx.t("1 upload", "1 envoi")}</span>`;
  const bracketName = (ctx: WebContext, key: string) => key === "60" ? ctx.t("Level 60", "Niveau 60") : `${ctx.t("Levels", "Niveaux")} ${key.replace("-", "–")}`;
  const periodName = (ctx: WebContext, period: PublicPeriod) => ctx.t(period.label, period.labelFr);
  const runScore = (run: LeaderRun) => scoreRun(run)?.points ?? null;
  const table = (head: string[], rows: string[], numeric: number[] = []) => `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

  function filterForm(ctx: WebContext, filters: LeaderFilters, dungeons: DungeonSummary[]): string {
    const { t, lang } = ctx;
    const any = { value: "", label: t("Any", "Tous") };
    const seasons = publicSeasons(now()).map((p) => ({ value: p.id, label: periodName(ctx, p) }));
    return `<form class="filters" method="get" action="/leaderboards/"><input type="hidden" name="lang" value="${lang}">`
      + `<div><label for="season">${t("Season", "Saison")}</label><select id="season" name="season">${options([...seasons, { value: "all", label: t("All time", "Depuis le début") }], filters.season)}</select></div>`
      + `<div><label for="period">${t("Period", "Période")}</label><select id="period" name="period">${options([{ value: "", label: t("Whole season", "Toute la saison") }, { value: "week", label: t("This week", "Cette semaine") }], filters.week ? "week" : "")}</select></div>`
      + `<div><label for="bracket">${t("Levels", "Niveaux")}</label><select id="bracket" name="bracket">${options([any, ...BRACKETS.map((value) => ({ value, label: bracketName(ctx, value) }))], filters.bracket)}</select></div>`
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

  function topRuns(ctx: WebContext, runs: LeaderRun[], filters: LeaderFilters, limit = 10): string {
    const { t } = ctx;
    const keep = keepPlayer(filters);
    const rated = runs.flatMap((run) => { const s = scoreRun(run); return s && (!filters.bracket || s.bracket === filters.bracket) && run.players.some((p) => keep(p, run)) ? [{ run, s }] : []; })
      .sort((a, b) => b.s.points - a.s.points || a.run.durationSec - b.run.durationSec).slice(0, limit);
    if (!rated.length) return `<p class="muted">${t("No rated run this week yet.", "Aucun essai classé cette semaine.")}</p>`;
    return table([t("Dungeon", "Donjon"), t("Levels", "Niveaux"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), ""],
      rated.map(({ run, s }) => `<tr><td>${escapeHtml(run.dungeonName)}</td><td>${escapeHtml(bracketName(ctx, s.bracket))}</td><td class="num">${time(run.durationSec)}</td>`
        + `<td class="num score">${s.points}${s.penaltyPercent ? ` <span class="tag">−${s.penaltyPercent}%</span>` : ""}</td><td>${party(ctx, run)}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3]);
  }

  const intro = (ctx: WebContext, period: PublicPeriod) => `<p class="eyebrow">Guilded · ${escapeHtml(periodName(ctx, period))}</p><h1>${ctx.t("Dungeon leaderboards", "Classements des donjons")}</h1>`
    + `<p class="muted">${ctx.t("Scores and times from Guilded and Guilded Dungeons players. Runs are checked before they show: impossible times, duplicates and runs the party disagrees on are left out. Score per route: 200 × target ÷ time (50–400); a character's best routes in a level bracket add up. Targets are provisional until real launch times exist.",
      "Scores et temps des joueurs de Guilded et Guilded Dungeons. Les essais sont vérifiés avant d'apparaître : temps impossibles, doublons et essais contestés par le groupe sont écartés. Score par parcours : 200 × cible ÷ temps (50–400); les meilleurs parcours d'un personnage dans une tranche de niveaux s'additionnent. Cibles provisoires en attendant de vrais temps.")}</p>`;
  const tabs = (ctx: WebContext, filters: LeaderFilters) => `<nav class="tabs">`
    + `<a class="${filters.week ? "" : "on"}" href="${link("/leaderboards/", ctx.lang, { season: filters.season, bracket: filters.bracket })}">${ctx.t("Season", "Saison")}</a>`
    + `<a class="${filters.week ? "on" : ""}" href="${link("/leaderboards/", ctx.lang, { period: "week", bracket: filters.bracket })}">${ctx.t("This week", "Cette semaine")}</a></nav>`;

  async function board(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const filters = readLeaderFilters(ctx.request.query, now());
    const period = filterPeriod(filters, now());
    const all = await periodRuns(period);
    const dungeons = dungeonSummaries(all);
    let body: string;
    if (filters.instanceId) {
      const runs = all.filter((run) => run.instanceId === filters.instanceId && (!filters.bracket || run.bracket === filters.bracket));
      const ranked = rankCharacters(runs, filters);
      const name = dungeons.find((d) => d.instanceId === filters.instanceId)?.dungeonName ?? t("Dungeon", "Donjon");
      body = `<h2>${escapeHtml(name)}</h2>` + (ranked.length
        ? table(["#", t("Character", "Personnage"), t("Class", "Classe"), t("Role", "Rôle"), t("Time", "Temps"), t("Score", "Score"), t("Deaths", "Morts"), t("Party", "Groupe"), t("Date", "Date"), ""],
          ranked.map((entry, index) => `<tr><td>${index + 1}</td><td>${who(ctx, entry.player)}</td>`
            + `<td>${entry.player.className ? escapeHtml(classLabel(entry.player.className, lang)) : ""}</td><td>${entry.player.role ? escapeHtml(roleLabel(entry.player.role, lang)) : ""}</td>`
            + `<td class="num">${time(entry.run.durationSec)}</td><td class="num score">${runScore(entry.run) ?? "–"}</td><td class="num">${entry.run.deaths ?? "?"}</td><td>${party(ctx, entry.run)}</td><td>${date(entry.run.endedAt)}</td><td>${trust(ctx, entry.run)}</td></tr>`), [4, 5, 6])
        : `<p class="muted">${t("No run matches these filters yet.", "Aucun essai ne correspond encore à ces filtres.")}</p>`);
    } else {
      const week = filters.week ? all : await periodRuns(publicWeek(now()));
      const scores = characterScores(all, publicRules(), keepPlayer(filters));
      const brackets = publicRules().brackets.filter((b) => !filters.bracket || b.key === filters.bracket);
      const guilds = await cached("guilds", () => deps.store.guilds());
      body = `<h2>${t("Top runs this week", "Meilleurs essais de la semaine")}</h2>${topRuns(ctx, week, filters)}`
        + `<h2>${t("Top characters", "Meilleurs personnages")} · ${escapeHtml(periodName(ctx, period))}</h2><div class="grid2">`
        + brackets.map((b) => `<section><h3>${escapeHtml(bracketName(ctx, b.key))} <span class="tag">${t(`best ${b.bestCount} routes`, `${b.bestCount} meilleurs parcours`)}</span></h3>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 25)}</section>`).join("")
        + `</div>`
        + (filters.bracket && !brackets.length ? `<p class="muted">${t("This bracket is not rated yet (launch data needed).", "Cette tranche n'est pas encore classée (données de lancement requises).")}</p>` : "")
        + `<h2>${t("Dungeon records", "Records des donjons")}</h2>` + (dungeons.length
          ? table([t("Dungeon", "Donjon"), t("Record", "Record"), t("Runs", "Essais")], dungeons.map((d) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(d.instanceId), season: filters.season, period: filters.week ? "week" : null, bracket: filters.bracket })}">${escapeHtml(d.dungeonName)}</a></td><td class="num">${time(d.bestSec)}</td><td class="num">${d.runs}</td></tr>`), [1, 2])
          : `<p class="muted">${t("No public run in this period yet. Install Guilded Dungeons, sign in and connect the companion from your page.", "Aucun essai public pour cette période. Installez Guilded Dungeons, connectez-vous et reliez le compagnon depuis votre page.")} <a href="${link("/me/", lang)}">${t("My page", "Ma page")}</a></p>`)
        + (guilds.length ? `<h2>${t("Guilds", "Guildes")}</h2><p>${guilds.map((g) => `<a href="${link(`/leaderboards/guild/${encodeURIComponent(g.id)}`, lang)}">${escapeHtml(g.name)}</a>`).join(" · ")}</p>` : "");
    }
    return kit.page(200, t("Dungeon leaderboards", "Classements des donjons"), PAGE_CSS + intro(ctx, period) + tabs(ctx, filters) + filterForm(ctx, filters, dungeons) + body,
      { description: t("WoW Forever dungeon scores and leaderboards by season, week, level bracket, dungeon, class, role and realm.", "Scores et classements des donjons WoW Forever par saison, semaine, niveaux, donjon, classe, rôle et royaume.") });
  }

  async function character(ctx: WebContext, kit: WebKit, raw: string): Promise<WebResponse> {
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
    const title = `${me?.character ?? name}${realm ? `-${realm}` : ""}`;
    const seasons = publicSeasons(now());
    const inPeriod = (p: PublicPeriod) => runs.filter((run) => (!p.from || run.endedAt >= p.from) && (!p.to || run.endedAt < p.to));
    const mine = (rows: ScoreRow[]) => rows.filter((row) => isMe(row.player));
    const current = mine(characterScores(inPeriod(seasons[0]!)));
    const best = new Map<number, LeaderRun>();
    for (const run of runs) { const b = best.get(run.instanceId); if (!b || run.durationSec < b.durationSec) best.set(run.instanceId, run); }
    const history = seasons.map((p) => ({ p, rows: mine(characterScores(inPeriod(p))) })).filter((h) => h.rows.length);
    const top = Math.max(1, ...history.flatMap((h) => h.rows.map((r) => r.points)));
    const body = PAGE_CSS + `<p class="eyebrow">${t("Character", "Personnage")}</p><div class="hero"><h1 class="c-${classSlug(me?.className ?? null)}">${escapeHtml(title)}</h1>`
      + (me?.className ? `<span>${escapeHtml(classLabel(me.className, lang))}${me.level ? ` · ${t("level", "niveau")} ${me.level}` : ""}</span>` : "") + `</div>`
      + (runs.length ? `<h2>${t("Score", "Score")} · ${escapeHtml(periodName(ctx, seasons[0]!))}</h2>`
        + (current.length ? `<p>${current.map((row) => `<span class="badge">${escapeHtml(bracketName(ctx, row.bracket))}</span> <span class="score">${row.points}</span>`).join(" &nbsp; ")}</p>` : `<p class="muted">${t("No rated run this season yet.", "Aucun essai classé cette saison.")}</p>`)
        + `<h2>${t("Best run per dungeon", "Meilleur essai par donjon")}</h2>`
        + table([t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), t("Date", "Date"), ""],
          [...best.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName)).map((run) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(run.instanceId), season: "all" })}">${escapeHtml(run.dungeonName)}</a></td><td class="num">${time(run.durationSec)}</td><td class="num score">${runScore(run) ?? "–"}</td><td>${party(ctx, run)}</td><td>${date(run.endedAt)}</td><td>${trust(ctx, run)}</td></tr>`), [1, 2])
        + `<h2>${t("Recent runs", "Essais récents")}</h2>`
        + table([t("Date", "Date"), t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Deaths", "Morts"), t("Levels", "Niveaux"), ""],
          runs.slice(0, 30).map((run) => `<tr><td>${date(run.endedAt)}</td><td>${escapeHtml(run.dungeonName)}</td><td class="num">${time(run.durationSec)}</td><td class="num score">${runScore(run) ?? "–"}</td><td class="num">${run.deaths ?? "?"}</td><td>${escapeHtml(run.bracket ?? "?")}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3, 4])
        + `<h2>${t("Score history", "Historique du score")}</h2>` + (history.length
          ? table([t("Season", "Saison"), t("Levels", "Niveaux"), t("Score", "Score"), ""], history.flatMap((h) => h.rows.map((row) => `<tr><td>${escapeHtml(periodName(ctx, h.p))}</td><td>${escapeHtml(bracketName(ctx, row.bracket))}</td><td class="num score">${row.points}</td><td class="bar-cell"><div class="meter" style="width:${Math.round(100 * row.points / top)}%"></div></td></tr>`)), [2])
          : `<p class="muted">${t("No rated season yet.", "Aucune saison classée.")}</p>`)
        : `<p class="muted">${t("No public run for this character yet.", "Aucun essai public pour ce personnage.")}</p>`);
    return kit.page(runs.length ? 200 : 404, title, body, { description: t(`${title}: dungeon score and times on Guilded's public leaderboards.`, `${title} : score et temps de donjon sur les classements publics de Guilded.`), ...(runs.length ? {} : { noindex: true }) });
  }

  async function guildPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t } = ctx;
    const guild = (await cached("guilds", () => deps.store.guilds())).find((g) => g.id === id);
    if (!guild) return kit.page(404, t("Not found", "Introuvable"), PAGE_CSS + `<h1>${t("Guild not found", "Guilde introuvable")}</h1><p class="muted">${t("Only guilds that publish their runs have a page.", "Seules les guildes qui publient leurs essais ont une page.")}</p>`, { noindex: true });
    const filters = readLeaderFilters(ctx.request.query, now());
    const period = filterPeriod(filters, now());
    const runs = await cached(`g:${id}:${period.id}`, () => deps.store.guildRuns(id, { from: period.from, to: period.to }));
    const scores = characterScores(runs);
    const base = `/leaderboards/guild/${encodeURIComponent(id)}`;
    const body = PAGE_CSS + `<p class="eyebrow">${t("Guild", "Guilde")} · ${escapeHtml(periodName(ctx, period))}</p><h1>${escapeHtml(guild.name)}</h1>`
      + `<nav class="tabs"><a class="${filters.week ? "" : "on"}" href="${link(base, ctx.lang)}">${t("Season", "Saison")}</a><a class="${filters.week ? "on" : ""}" href="${link(base, ctx.lang, { period: "week" })}">${t("This week", "Cette semaine")}</a></nav>`
      + publicRules().brackets.map((b) => `<h2>${escapeHtml(bracketName(ctx, b.key))}</h2>${scoreTable(ctx, scores.filter((row) => row.bracket === b.key), 100)}`).join("")
      + `<h2>${t("Recent runs", "Essais récents")}</h2>` + (runs.length
        ? table([t("Date", "Date"), t("Dungeon", "Donjon"), t("Time", "Temps"), t("Score", "Score"), t("Party", "Groupe"), ""], runs.slice(0, 20).map((run) => `<tr><td>${date(run.endedAt)}</td><td>${escapeHtml(run.dungeonName)}</td><td class="num">${time(run.durationSec)}</td><td class="num score">${runScore(run) ?? "–"}</td><td>${party(ctx, run)}</td><td>${trust(ctx, run)}</td></tr>`), [2, 3])
        : `<p class="muted">${t("No public run in this period yet.", "Aucun essai public pour cette période.")}</p>`);
    return kit.page(200, guild.name, body, { description: t(`${guild.name}: members' dungeon scores on Guilded.`, `${guild.name} : scores de donjon des membres sur Guilded.`) });
  }

  // /me/: the personal companion code.
  async function pairingPage(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    if (!deps.personal) return kit.redirect(link("/me/", lang));
    const { code, expiresAt } = await issuePersonalCode(deps.personal, ctx.account!.id, now());
    const body = `<p class="eyebrow">${t("Guilded companion", "Compagnon Guilded")}</p><h1>${t("Your companion code", "Votre code de compagnon")}</h1>`
      + `<p class="code">${escapeHtml(code)}</p><p class="muted">${t("Valid 15 minutes, once. Do not share it.", "Valable 15 minutes, une fois. Ne le partagez pas.")} (${expiresAt.toISOString().slice(11, 16)} UTC)</p>`
      + `<ol><li>${t("Install Guilded Dungeons (or Guilded) and play a dungeon once, so its saved file exists.", "Installez Guilded Dungeons (ou Guilded) et faites un donjon, pour que son fichier de sauvegarde existe.")}</li>`
      + `<li>${t("In the Guilded companion, choose your <code>GuildedDungeons.lua</code> in <code>WTF\\Account\\…\\SavedVariables</code>, paste this code and press Connect.", "Dans le compagnon Guilded, choisissez votre <code>GuildedDungeons.lua</code> dans <code>WTF\\Account\\…\\SavedVariables</code>, collez ce code et appuyez sur Connecter.")}</li>`
      + `<li>${t("Your finished runs appear on the leaderboards after the next upload.", "Vos donjons terminés apparaissent dans les classements après le prochain envoi.")}</li></ol>`
      + `<p><a href="${link("/me/", lang)}">${t("Back to my page", "Retour à ma page")}</a></p>`;
    return kit.page(200, t("Companion code", "Code du compagnon"), body, { noindex: true });
  }

  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path;
    if (path === "/leaderboards/" && ctx.request.method !== "POST") return board(ctx, kit);
    const match = /^\/leaderboards\/character\/([^/]{1,200})$/.exec(path);
    if (match && ctx.request.method !== "POST") return character(ctx, kit, match[1]!);
    const guild = /^\/leaderboards\/guild\/([A-Za-z0-9_-]{1,40})$/.exec(path);
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
    return `<h2>${t("Public dungeon leaderboards", "Classements publics des donjons")}</h2>`
      + `<p class="muted">${t("Connect the Guilded companion to your account (no guild needed) and it sends your finished dungeon runs to the", "Reliez le compagnon Guilded à votre compte (sans guilde) et il envoie vos donjons terminés aux")} <a href="${link("/leaderboards/", lang)}">${t("leaderboards", "classements")}</a>.</p>`
      + (ctx.request.query.get("done") === "companion-off" ? `<p class="notice">${t("Companion disconnected.", "Compagnon déconnecté.")}</p>` : "")
      + (connected ? `<p>✔ ${t("A companion is connected.", "Un compagnon est connecté.")}</p><form method="post" action="/me/pair/revoke">${csrf}<button class="link" type="submit">${t("Disconnect it", "Le déconnecter")}</button></form>` : "")
      + `<form method="post" action="/me/pair">${csrf}<p><button class="button" type="submit">${connected ? t("Get a new companion code", "Obtenir un nouveau code") : t("Get a companion code", "Obtenir un code de compagnon")}</button></p></form>`;
  }

  return { route, meSection };
}
