import { characterKey } from "../../companion/character-identity.mjs";
import type { PrismaClient } from "../generated/prisma/client.js";
import { className as classFromText } from "./recruitment.js";
import { killDeathRatio, weekKeyOf, weekRange } from "./world-pvp.js";
import { escapeHtml, link, options, type Lang } from "./web-layout.js";
import { emptyBox, strip, type PodiumEntry } from "./leaderboard-hub.js";
import { foldZoneName, PVP_ZONES, zoneOf, type Continent, type PvpZone } from "./pvp-zones.js";
import { CONTINENT_IMAGES, ZONE_POSITIONS } from "./pvp-zone-positions.js";

// The PvP tab of the public leaderboards: the world PvP board (kills, deaths, K/D), the battleground ladder and results, and the zones where
// players called for help. Only guilds that publish their runs, members who are not hidden or test accounts, no Discord IDs: this module reads
// character names, classes, levels and counts only. Aggregation is pure; the page strings are built from escaped values.

type T = (en: string, fr: string) => string;

export interface PvpPlayer { key: string; name: string; short: string; realm: string; className: string | null; level: number | null; guildId: string }
export interface PvpWorldRow extends PvpPlayer { kills: number; deaths: number; defends: number; helped: number }
export interface PvpGame extends PvpPlayer { mode: string; bracket: string; mapId: number; outcome: string; endedAt: Date; /** One value per battleground match, shared by every member who reported it. */ matchKey: string }
export interface PvpCall { guildId: string; zone: string; mapId?: number | null; subzone?: string; calledAt: Date }
export interface PvpData { weekKey: number; week: PvpWorldRow[]; total: PvpWorldRow[]; games: PvpGame[]; calls: PvpCall[]; /** Kills and deaths per zone, when the zone of each is sent (none today). */ zoneActivity?: PvpZoneActivity[] }
export const emptyPvp = (weekKey: number): PvpData => ({ weekKey, week: [], total: [], games: [], calls: [] });

export const PVP_LEVEL_BANDS: { key: string; from: number; to: number }[] = [
  { key: "1-19", from: 1, to: 19 }, { key: "20-39", from: 20, to: 39 }, { key: "40-59", from: 40, to: 59 }, { key: "60", from: 60, to: 60 }
];
export const PVP_MODES = ["casual", "rated", "blitz"] as const;
const BG_DAYS = 30, WORLD_ROWS = 5_000, GAME_ROWS = 5_000, CALL_ROWS = 2_000, CALL_DAYS = 28;

const MAPS: Record<number, [string, string]> = {
  30: ["Alterac Valley", "Vallée d'Alterac"], 489: ["Warsong Gulch", "Goulet des Chanteguerres"], 529: ["Arathi Basin", "Bassin d'Arathi"],
  566: ["Eye of the Storm", "Œil du cyclone"], 607: ["Strand of the Ancients", "Rivage des Anciens"], 628: ["Isle of Conquest", "Île des Conquérants"]
};
export const mapTitle = (id: number, lang: Lang) => MAPS[id]?.[lang === "fr" ? 1 : 0] ?? (lang === "fr" ? `Carte ${id}` : `Map ${id}`);

// ----- the store query (public guilds only) -----

const VISIBLE = { status: { in: ["ACTIVE" as const, "TRIAL" as const] }, isTest: false, raceHidden: false };
/** One battleground match is one key: the premade id when the reports carry it, else guild + map + mode + the end time rounded to ten minutes. */
export const matchKeyOf = (guildId: string, mapId: number, mode: string, endedAt: Date, nonce: string | null) => `${guildId}|${mapId}|${mode}|${nonce || Math.round(endedAt.getTime() / 600_000)}`;

/** The public PvP data of this edition for the guilds given (already the ones that publish). Bounded: at most a few thousand rows per table. */
export async function loadPvpData(database: PrismaClient, guildIds: readonly string[], edition: string, now: Date): Promise<PvpData> {
  const weekKey = weekKeyOf(now);
  const data = emptyPvp(weekKey);
  if (!guildIds.length) return data;
  const ids = [...guildIds];
  const since = new Date(now.getTime() - BG_DAYS * 86_400_000);
  const callsSince = new Date(now.getTime() - CALL_DAYS * 86_400_000);
  const [weekRows, totalRows, reports, calls] = await Promise.all([
    database.worldPvpWeek.findMany({ where: { guildId: { in: ids }, weekKey, member: VISIBLE }, select: { memberId: true, guildId: true, kills: true, deaths: true, defends: true, helped: true }, orderBy: { kills: "desc" }, take: WORLD_ROWS }),
    database.worldPvpWeek.groupBy({ by: ["memberId", "guildId"], where: { guildId: { in: ids }, member: VISIBLE }, _sum: { kills: true, deaths: true, defends: true, helped: true }, orderBy: { _sum: { kills: "desc" } }, take: WORLD_ROWS }),
    database.battlegroundReport.findMany({ where: { guildId: { in: ids }, gameEdition: edition, status: "PROVISIONAL", endedAt: { gte: since, lt: now }, member: VISIBLE }, orderBy: { endedAt: "desc" }, take: GAME_ROWS,
      select: { guildId: true, mode: true, bracket: true, mapId: true, outcome: true, endedAt: true, premadeNonce: true, character: { select: { name: true, displayName: true, realm: true, className: true, level: true } } } }),
    database.guildHelpCall.findMany({ where: { guildId: { in: ids }, calledAt: { gte: callsSince, lt: now }, member: VISIBLE }, select: { guildId: true, zone: true, subzone: true, mapId: true, calledAt: true }, orderBy: { calledAt: "desc" }, take: CALL_ROWS })
  ]);
  const worldWeek = weekRows.map((row) => ({ memberId: row.memberId, guildId: row.guildId, kills: row.kills, deaths: row.deaths, defends: row.defends, helped: row.helped }));
  const worldTotal = totalRows.map((row) => ({ memberId: row.memberId, guildId: row.guildId, kills: row._sum.kills ?? 0, deaths: row._sum.deaths ?? 0, defends: row._sum.defends ?? 0, helped: row._sum.helped ?? 0 }));
  const top = (rows: typeof worldWeek) => rows.filter((row) => row.kills || row.defends || row.helped).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const shown = { week: top(worldWeek), total: top(worldTotal) };
  const memberIds = [...new Set([...shown.week, ...shown.total].map((row) => row.memberId))];
  const characters = memberIds.length ? await database.character.findMany({ where: { memberId: { in: memberIds }, gameEdition: edition }, orderBy: [{ isMain: "desc" }, { name: "asc" }],
    select: { memberId: true, name: true, displayName: true, realm: true, className: true, level: true }, take: 10_000 }) : [];
  const mainOf = new Map<string, (typeof characters)[number]>();
  for (const character of characters) if (!mainOf.has(character.memberId)) mainOf.set(character.memberId, character);
  const player = (c: { name: string; displayName: string | null; realm: string | null; className: string | null; level: number | null }, guildId: string): PvpPlayer =>
    ({ key: characterKey(c.name, c.realm ?? "", edition), name: c.displayName?.trim() || c.name, short: c.name, realm: c.realm ?? "", className: c.className, level: c.level, guildId });
  const world = (rows: typeof worldWeek): PvpWorldRow[] => {
    const merged = new Map<string, PvpWorldRow>();
    for (const row of rows) {
      const c = mainOf.get(row.memberId);
      if (!c) continue;
      const one = { ...player(c, row.guildId), kills: row.kills, deaths: row.deaths, defends: row.defends, helped: row.helped };
      const seen = merged.get(one.key);
      if (!seen) merged.set(one.key, one);
      else { seen.kills += one.kills; seen.deaths += one.deaths; seen.defends += one.defends; seen.helped += one.helped; }
    }
    return [...merged.values()];
  };
  data.week = world(shown.week);
  data.total = world(shown.total);
  data.games = reports.map((row) => ({ ...player(row.character, row.guildId), mode: row.mode, bracket: row.bracket, mapId: row.mapId, outcome: row.outcome, endedAt: row.endedAt, matchKey: matchKeyOf(row.guildId, row.mapId, row.mode, row.endedAt, row.premadeNonce) }));
  data.calls = calls.map((row) => ({ guildId: row.guildId, zone: row.zone.trim().slice(0, 60), mapId: row.mapId, subzone: (row.subzone ?? "").trim().slice(0, 60), calledAt: row.calledAt })).filter((row) => row.zone && row.zone !== "?");
  return data;
}

// ----- filters and aggregation (pure) -----

export interface PvpFilters { className: string | null; band: { key: string; from: number; to: number } | null; period: "week" | "all"; mode: string | null }
/** Read from the address: anything unknown is ignored, so a hostile value never reaches a query or the page. */
export function readPvpFilters(query: URLSearchParams): PvpFilters {
  const classText = (query.get("class") ?? "").trim().slice(0, 30);
  return {
    className: classText ? classFromText(classText) : null,
    band: PVP_LEVEL_BANDS.find((band) => band.key === query.get("levels")) ?? null,
    period: query.get("period") === "all" ? "all" : "week",
    mode: (PVP_MODES as readonly string[]).includes(query.get("mode") ?? "") ? query.get("mode") : null
  };
}
const sameClass = (name: string | null, wanted: string | null) => !wanted || (name !== null && name.toLowerCase() === wanted.toLowerCase());
const inBand = (level: number | null, band: PvpFilters["band"]) => !band || (level !== null && level >= band.from && level <= band.to);
const matches = (player: PvpPlayer, f: Pick<PvpFilters, "className" | "band">) => sameClass(player.className, f.className) && inBand(player.level, f.band);

export interface PvpWorldBoard { rows: PvpWorldRow[]; kills: number; deaths: number }
export function worldBoard(data: PvpData, f: PvpFilters): PvpWorldBoard {
  const rows = (f.period === "all" ? data.total : data.week).filter((row) => matches(row, f))
    .sort((a, b) => b.kills - a.kills || b.defends - a.defends || b.helped - a.helped || a.deaths - b.deaths || a.name.localeCompare(b.name));
  return { rows, kills: rows.reduce((sum, row) => sum + row.kills, 0), deaths: rows.reduce((sum, row) => sum + row.deaths, 0) };
}

export interface BgRow extends PvpPlayer { games: number; wins: number; losses: number; draws: number; winRate: number }
export interface BgMapRow { mapId: number; games: number; wins: number }
export interface PvpBgBoard { rows: BgRow[]; games: number; byMap: BgMapRow[]; recent: PvpGame[] }
export function bgBoard(data: PvpData, f: PvpFilters): PvpBgBoard {
  const games = data.games.filter((game) => matches(game, f) && (!f.mode || game.mode === f.mode));
  const by = new Map<string, BgRow>();
  const maps = new Map<number, BgMapRow>();
  const seenMatch = new Set<string>();
  let matches_ = 0;
  for (const game of games) {
    const row = by.get(game.key) ?? { ...game, games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
    row.games += 1;
    if (game.outcome === "win") row.wins += 1; else if (game.outcome === "loss") row.losses += 1; else if (game.outcome === "draw") row.draws += 1;
    by.set(game.key, row);
    if (seenMatch.has(game.matchKey)) continue;
    seenMatch.add(game.matchKey);
    matches_ += 1;
    const map = maps.get(game.mapId) ?? { mapId: game.mapId, games: 0, wins: 0 };
    map.games += 1;
    if (game.outcome === "win") map.wins += 1;
    maps.set(game.mapId, map);
  }
  const rows = [...by.values()].map((row) => ({ ...row, winRate: row.games ? row.wins / row.games : 0 }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name));
  return { rows, games: matches_, byMap: [...maps.values()].sort((a, b) => b.games - a.games || a.mapId - b.mapId),
    recent: [...games].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime()).slice(0, 30) };
}

// ----- the zone map: heat per zone -----

/** What a zone's activity is made of: calls for help today; kills and deaths too once the zone of each is sent (zoneActivity). */
export interface PvpZoneActivity { weekKey: number; mapId: number | null; zone: string; guildId: string; kills: number; deaths: number; className: string | null; level: number | null }
export interface ZoneStat {
  key: string; zone: PvpZone | null; en: string; fr: string; calls: number; kills: number; deaths: number; heat: number;
  guilds: { guildId: string; count: number }[]; recent: { at: Date; guildId: string; subzone: string }[];
}
/** Pure: every catalogue zone (lit or not) plus any named zone the catalogue does not know, for the chosen period and, when given, one guild. */
export function zoneStats(data: PvpData, f: PvpFilters, guildId: string | null = null): ZoneStat[] {
  const from = f.period === "week" ? weekRange(data.weekKey).from : null;
  const stats = new Map<string, ZoneStat & { by: Map<string, number> }>();
  const slot = (zone: PvpZone | null, name: string) => {
    const key = zone ? `z${zone.id}` : `n${foldZoneName(name)}`;
    let stat = stats.get(key);
    if (!stat) { stat = { key, zone, en: zone?.en ?? name, fr: zone?.fr ?? name, calls: 0, kills: 0, deaths: 0, heat: 0, guilds: [], recent: [], by: new Map() }; stats.set(key, stat); }
    return stat;
  };
  for (const zone of PVP_ZONES) slot(zone, zone.en);
  for (const call of data.calls) {
    if ((guildId && call.guildId !== guildId) || (from && call.calledAt < from)) continue;
    const stat = slot(zoneOf(call.mapId, call.zone), call.zone);
    stat.calls += 1;
    stat.by.set(call.guildId, (stat.by.get(call.guildId) ?? 0) + 1);
    stat.recent.push({ at: call.calledAt, guildId: call.guildId, subzone: call.subzone ?? "" });
  }
  for (const row of data.zoneActivity ?? []) {
    if ((guildId && row.guildId !== guildId) || (f.period === "week" && row.weekKey !== data.weekKey) || !matches({ className: row.className, level: row.level } as PvpPlayer, f)) continue;
    const stat = slot(zoneOf(row.mapId, row.zone), row.zone);
    stat.kills += row.kills; stat.deaths += row.deaths;
    stat.by.set(row.guildId, (stat.by.get(row.guildId) ?? 0) + row.kills + row.deaths);
  }
  return [...stats.values()].map(({ by, ...stat }) => ({ ...stat, heat: stat.calls + stat.kills + stat.deaths,
    guilds: [...by].map(([id, count]) => ({ guildId: id, count })).sort((a, b) => b.count - a.count || a.guildId.localeCompare(b.guildId)).slice(0, 3),
    recent: stat.recent.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8) }))
    .sort((a, b) => b.heat - a.heat || a.en.localeCompare(b.en));
}

/** A character's PvP, found by name (and realm when the page knows it): this week and all weeks, and the battleground record. */
export function playerPvp(data: PvpData, character: string, realm: string | null) {
  const name = character.trim().toLowerCase();
  const fold = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const same = (p: PvpPlayer) => (p.name.toLowerCase() === name || p.short.toLowerCase() === name) && (!realm || !p.realm || fold(p.realm) === fold(realm));
  const week = data.week.find(same) ?? null, total = data.total.find(same) ?? null;
  const games = data.games.filter(same);
  const wins = games.filter((g) => g.outcome === "win").length, losses = games.filter((g) => g.outcome === "loss").length;
  return { week, total, games: games.slice(0, 5), record: { games: games.length, wins, losses } };
}

export function guildPvp(data: PvpData, guildId: string) {
  const own = (rows: readonly PvpWorldRow[]) => rows.filter((row) => row.guildId === guildId);
  const week = own(data.week), total = own(data.total);
  const sum = (rows: readonly PvpWorldRow[]) => ({ kills: rows.reduce((n, r) => n + r.kills, 0), deaths: rows.reduce((n, r) => n + r.deaths, 0) });
  const seen = new Set<string>();
  const games = data.games.filter((g) => g.guildId === guildId && !seen.has(g.matchKey) && !!seen.add(g.matchKey));
  return { week: sum(week), total: sum(total), top: [...total].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)).slice(0, 5),
    games: games.length, wins: games.filter((g) => g.outcome === "win").length, zones: zoneStats(data, { className: null, band: null, period: "week", mode: null }, guildId).filter((z) => z.heat > 0).slice(0, 3) };
}

// ----- page strings (every value escaped) -----

export interface PvpEnv {
  t: T; lang: Lang; edition: string; duelsOpen: boolean;
  table: (head: string[], rows: string[], numeric?: number[], className?: string) => string;
  person: (player: PvpPlayer) => string;
  guild: (guildId: string) => string;
  classLabel: (name: string) => string;
  classSlug: (name: string | null) => string;
}
const date = (value: Date) => value.toISOString().slice(0, 10);
const outcomeText = (t: T, outcome: string) => outcome === "win" ? `<span class="up">${t("Won", "Gagné")}</span>` : outcome === "loss" ? `<span class="down">${t("Lost", "Perdu")}</span>` : `<span class="muted">${t("Draw", "Nul")}</span>`;
const modeText = (t: T, mode: string) => mode === "rated" ? t("Rated", "Classé") : mode === "blitz" ? t("Blitz", "Blitz") : t("Casual", "Libre");

/** The PvP tab. `here` is its address; the filters ride in the URL. */
export function pvpPageBody(env: PvpEnv, data: PvpData, f: PvpFilters, classes: string[]): string {
  const { t, lang } = env;
  const world = worldBoard(data, f), bg = bgBoard(data, f), zones = zoneStats(data, f);
  const here = "/leaderboards/pvp/";
  const form = `<form class="filters" method="get" action="${here}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="edition" value="${escapeHtml(env.edition)}">`
    + `<div><label for="pvp-period">${t("World PvP", "PvP mondial")}</label><select id="pvp-period" name="period">${options([{ value: "week", label: t("This week", "Cette semaine") }, { value: "all", label: t("All weeks", "Toutes les semaines") }], f.period)}</select></div>`
    + `<div><label for="pvp-class">${t("Class", "Classe")}</label><select id="pvp-class" name="class">${options([{ value: "", label: t("Any", "Toutes") }, ...classes.map((name) => ({ value: name, label: env.classLabel(name) }))], f.className ?? "")}</select></div>`
    + `<div><label for="pvp-levels">${t("Levels", "Niveaux")}</label><select id="pvp-levels" name="levels">${options([{ value: "", label: t("All levels", "Tous") }, ...PVP_LEVEL_BANDS.map((b) => ({ value: b.key, label: b.key === "60" ? t("Level 60", "Niveau 60") : `${t("Levels", "Niveaux")} ${b.key.replace("-", "–")}` }))], f.band?.key ?? "")}</select></div>`
    + `<div><label for="pvp-mode">${t("Battlegrounds", "Champs de bataille")}</label><select id="pvp-mode" name="mode">${options([{ value: "", label: t("All modes", "Tous les modes") }, ...PVP_MODES.map((m) => ({ value: m, label: modeText(t, m) }))], f.mode ?? "")}</select></div>`
    + `<div><button class="button" type="submit">${t("Show", "Afficher")}</button></div></form>`;
  const tile = (k: string, v: string) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const tiles = `<div class="tiles">${tile(f.period === "all" ? t("Kills", "Victimes") : t("Kills this week", "Victimes cette semaine"), String(world.kills))}${tile(t("Deaths", "Morts"), String(world.deaths))}${tile(t("K/D", "V/M"), killDeathRatio(world.kills, world.deaths))}${tile(t("Battlegrounds, last 30 days", "Champs de bataille, 30 derniers jours"), String(bg.games))}</div>`;
  const worldTable = world.rows.length ? env.table([t("#", "#"), t("Player", "Joueur"), t("Guild", "Guilde"), t("Level", "Niveau"), t("Kills", "Victimes"), t("Deaths", "Morts"), t("K/D", "V/M"), t("Defends", "Défenses"), t("Helped", "Aides")],
    world.rows.slice(0, 100).map((row, index) => `<tr><td class="num">${index + 1}</td><td>${env.person(row)}</td><td>${env.guild(row.guildId)}</td><td class="num">${row.level ?? "–"}</td><td class="num score">${row.kills}</td><td class="num">${row.deaths}</td><td class="num">${killDeathRatio(row.kills, row.deaths)}</td><td class="num">${row.defends}</td><td class="num">${row.helped}</td></tr>`), [0, 3, 4, 5, 6, 7, 8], "dense")
    : emptyBox(t("No open-world PvP yet", "Aucun PvP mondial"), [t("Kills and deaths in the open world appear here as players update the Guilded addon and the companion sends them.", "Les victimes et les morts en monde ouvert apparaissent ici quand les joueurs mettent à jour l'addon Guilded et que le compagnon les envoie.")]);
  const bgTable = bg.rows.length ? env.table([t("#", "#"), t("Player", "Joueur"), t("Guild", "Guilde"), t("Wins", "Victoires"), t("Losses", "Défaites"), t("Draws", "Nuls"), t("Win rate", "Taux")],
    bg.rows.slice(0, 100).map((row, index) => `<tr><td class="num">${index + 1}</td><td>${env.person(row)}</td><td>${env.guild(row.guildId)}</td><td class="num score">${row.wins}</td><td class="num">${row.losses}</td><td class="num">${row.draws}</td><td class="num">${Math.round(row.winRate * 100)}%</td></tr>`), [0, 3, 4, 5, 6], "dense")
    : emptyBox(t("No battleground yet", "Aucun champ de bataille"), [t("Play a battleground with the Guilded addon and your result shows up here.", "Jouez un champ de bataille avec l'addon Guilded et votre résultat apparaît ici.")]);
  const mapTable = bg.byMap.length ? env.table([t("Battleground", "Champ de bataille"), t("Games", "Parties"), t("Wins", "Victoires")], bg.byMap.map((m) => `<tr><td>${escapeHtml(mapTitle(m.mapId, lang))}</td><td class="num">${m.games}</td><td class="num">${m.wins}</td></tr>`), [1, 2], "dense") : "";
  const recent = bg.recent.length ? env.table([t("Date", "Date"), t("Player", "Joueur"), t("Battleground", "Champ de bataille"), t("Mode", "Mode"), t("Result", "Résultat")],
    bg.recent.map((g) => `<tr><td>${date(g.endedAt)}</td><td>${env.person(g)}</td><td>${escapeHtml(mapTitle(g.mapId, lang))}</td><td>${escapeHtml(modeText(t, g.mode))}</td><td>${outcomeText(t, g.outcome)}</td></tr>`), [], "dense") : "";
  return `<p class="eyebrow">PvP</p><h1>${t("PvP", "PvP")}</h1><p class="muted">${t("Open-world kills and deaths, battleground results and the zones where players called for help, across guilds that publish.", "Victimes et morts en monde ouvert, résultats de champs de bataille et zones où des joueurs ont appelé à l'aide, dans les guildes qui publient.")}</p>`
    + tiles + form
    + `<h2>${t("World PvP", "PvP mondial")} · ${f.period === "all" ? t("all weeks", "toutes les semaines") : t("this week", "cette semaine")}</h2><p class="muted">${t("Shown on each player's main character.", "Affiché sur le personnage principal de chaque joueur.")}</p>${worldTable}`
    + zoneMapHtml(env, zones, f)
    + `<h2>${t("Battleground ladder", "Classement des champs de bataille")}</h2><p class="muted">${t("Last 30 days.", "30 derniers jours.")}</p>${bgTable}`
    + (mapTable ? `<h2>${t("By battleground", "Par champ de bataille")}</h2>${mapTable}` : "")
    + (recent ? `<h2>${t("Latest results", "Derniers résultats")}</h2>${recent}` : "")
    + (env.duelsOpen ? `<p><a class="button" href="${link("/leaderboards/duels/", lang)}">${t("Duel ladder →", "Classement des duels →")}</a></p>` : "");
}


// ----- the zone map (no script: an inline SVG of links, CSS :hover / :focus for the tip, :target for the details) -----

export const PVP_MAP_CSS = `<style>
.pvp-maps{display:grid;gap:16px;grid-template-columns:minmax(0,1fr);margin:8px 0 16px}@media(min-width:900px){.pvp-maps{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pvp-map{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#12171a;min-width:0}.pvp-map h3{margin:10px 14px 4px;font-size:16px}
.pvp-map svg{display:block;width:100%;height:auto}.pvp-map .sea{fill:#0f1519}.pvp-map .land{fill:#1c2529;stroke:#34433f;stroke-width:.3}
.pvp-map .dot{fill:#3a4543;stroke:#16130b;stroke-width:.25;opacity:.7}.pvp-map .h1 .dot{fill:#7a6a3a;opacity:1}.pvp-map .h2 .dot{fill:#a98c3f;opacity:1}.pvp-map .h3 .dot{fill:#d6aa46;opacity:1}.pvp-map .h4 .dot{fill:#ee8a3d;opacity:1}.pvp-map .h5 .dot{fill:#e5523f;opacity:1}
.pvp-map .hit{fill:transparent}.pvp-map a.z{outline:none;cursor:pointer}.pvp-map a.z:hover .dot,.pvp-map a.z:focus .dot{stroke:#fff;stroke-width:.5}
.pvp-map .tip{display:none;pointer-events:none}.pvp-map a.z:hover .tip,.pvp-map a.z:focus .tip{display:block}
.pvp-map .tip rect{fill:#0d1012;stroke:var(--gold);stroke-width:.25}.pvp-map .tip text{font-size:2.5px;fill:#f2ead6}.pvp-map .tip .t1{font-weight:700;fill:#e8c47c}
.zone-panel{display:none;border:1px solid var(--gold);border-radius:12px;padding:12px 16px;margin:12px 0;background:var(--panel);scroll-margin-top:80px}.zone-panel:target{display:block}.zone-panel h3{margin:0 0 6px}.zone-panel ul{margin:6px 0;padding-left:18px}
.heat-legend{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:13px;color:var(--muted);margin:0 0 8px}.heat-legend i{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-1px;margin-right:4px}
</style>`;
const HEAT_COLOURS = ["#7a6a3a", "#a98c3f", "#d6aa46", "#ee8a3d", "#e5523f"];
const LAND: Record<Continent, string> = {
  kalimdor: "M16 4 L46 3 L62 7 L82 4 L90 12 L76 24 L82 34 L72 44 L66 54 L50 56 L34 53 L20 50 L12 38 L16 26 L10 14 Z",
  eastern: "M24 5 L52 3 L70 8 L76 22 L72 34 L78 46 L68 56 L50 55 L34 56 L24 48 L28 36 L18 26 L20 14 Z"
};
const CONTINENT_NAMES: Record<Continent, [string, string]> = { kalimdor: ["Kalimdor", "Kalimdor"], eastern: ["Eastern Kingdoms", "Royaumes de l'Est"] };
const HEIGHT = 56.25;

const levelOf = (heat: number, max: number) => heat <= 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((5 * heat) / Math.max(1, max))));
const zoneName = (env: PvpEnv, stat: ZoneStat) => env.lang === "fr" ? stat.fr : stat.en;
function zoneNumbers(env: PvpEnv, stat: ZoneStat, kd: boolean): string {
  const { t } = env;
  return [`${stat.calls} ${t("calls for help", "appels à l'aide")}`, ...(kd ? [`${stat.kills} ${t("kills", "victimes")}`, `${stat.deaths} ${t("deaths", "morts")}`] : [])].join(" · ");
}

function continentSvg(env: PvpEnv, continent: Continent, stats: ZoneStat[], max: number, kd: boolean): string {
  const image = CONTINENT_IMAGES[continent];
  const marks = stats.flatMap((stat) => {
    const at = stat.zone && stat.zone.continent === continent ? ZONE_POSITIONS[stat.zone.id] : undefined;
    if (!at) return [];
    const x = at[0], y = at[1] * HEIGHT / 100, level = levelOf(stat.heat, max);
    const r = level === 0 ? 1.1 : 1.5 + 0.5 * level;
    const dot = `<circle class="dot" cx="${x}" cy="${y.toFixed(2)}" r="${r}"/>`;
    if (!level) return [`<g class="z h0" aria-hidden="true">${dot}</g>`];
    const line1 = zoneName(env, stat), line2 = zoneNumbers(env, stat, kd);
    const w = Math.max(line1.length, line2.length) * 1.3 + 3, left = x > 58, down = y < 14;
    const tx = left ? x - r - 1 - w : x + r + 1, ty = down ? y - 1 : y - 7;
    return [`<a class="z h${level}" href="#zone-${stat.zone!.id}" aria-label="${escapeHtml(`${line1}: ${line2}`)}"><circle class="hit" cx="${x}" cy="${y.toFixed(2)}" r="3.4"/>${dot}`
      + `<g class="tip"><rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${w.toFixed(1)}" height="7" rx="1"/><text class="t1" x="${(tx + 1.5).toFixed(1)}" y="${(ty + 3).toFixed(1)}">${escapeHtml(line1)}</text><text x="${(tx + 1.5).toFixed(1)}" y="${(ty + 5.9).toFixed(1)}">${escapeHtml(line2)}</text></g></a>`];
  });
  const base = image ? `<image href="${escapeHtml(image)}" x="0" y="0" width="100" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>` : `<rect class="sea" width="100" height="${HEIGHT}"/><path class="land" d="${LAND[continent]}" transform="scale(1 ${(HEIGHT / 60).toFixed(4)})"/>`;
  return `<svg viewBox="0 0 100 ${HEIGHT}" role="group" aria-label="${escapeHtml(CONTINENT_NAMES[continent][env.lang === "fr" ? 1 : 0])}">${base}${marks.join("")}</svg>`;
}

/** The zone map section: a heat map of both continents, the details of each lit zone, and the plain table of the same numbers. */
export function zoneMapHtml(env: PvpEnv, stats: ZoneStat[], f: PvpFilters): string {
  const { t, lang } = env;
  const kd = stats.some((s) => s.kills > 0 || s.deaths > 0);
  const lit = stats.filter((s) => s.heat > 0);
  const max = Math.max(0, ...stats.map((s) => s.heat));
  const period = f.period === "all" ? t("last 4 weeks", "4 dernières semaines") : t("this week", "cette semaine");
  const heatOf = kd ? t("kills, deaths and calls for help", "victimes, morts et appels à l'aide") : t("calls for help", "appels à l'aide");
  const legend = `<p class="heat-legend"><span>${t("Colour and size show", "La couleur et la taille montrent")}: ${escapeHtml(heatOf)}.</span>${HEAT_COLOURS.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? t("fewer", "moins") : i === 4 ? t("more", "plus") : ""}</span>`).join("")}</p>`;
  const maps = (["kalimdor", "eastern"] as Continent[]).map((continent) => `<figure class="pvp-map" style="margin:0"><h3>${escapeHtml(CONTINENT_NAMES[continent][lang === "fr" ? 1 : 0])}</h3>${continentSvg(env, continent, stats, max, kd)}</figure>`).join("");
  const panels = lit.filter((s) => s.zone).map((stat) => `<section class="zone-panel" id="zone-${stat.zone!.id}"><h3>${escapeHtml(zoneName(env, stat))}</h3><p>${escapeHtml(zoneNumbers(env, stat, kd))}</p>`
    + (stat.guilds.length ? `<p>${t("Most active guilds", "Guildes les plus actives")}: ${stat.guilds.map((g) => `${env.guild(g.guildId) || "–"} (${g.count})`).join(", ")}</p>` : "")
    + (stat.recent.length ? `<p>${t("Recent calls for help", "Derniers appels à l'aide")}</p><ul>${stat.recent.map((r) => `<li>${date(r.at)}${r.subzone ? ` · ${escapeHtml(r.subzone)}` : ""}${env.guild(r.guildId) ? ` · ${env.guild(r.guildId)}` : ""}</li>`).join("")}</ul>` : "")
    + `<p><a href="#zone-map">${t("Back to the map", "Retour à la carte")}</a></p></section>`).join("");
  const continentOf = (stat: ZoneStat) => stat.zone ? CONTINENT_NAMES[stat.zone.continent][lang === "fr" ? 1 : 0] : "";
  const table = lit.length ? env.table([t("Zone", "Zone"), t("Continent", "Continent"), t("Calls for help", "Appels à l'aide"), ...(kd ? [t("Kills", "Victimes"), t("Deaths", "Morts")] : []), t("Most active guild", "Guilde la plus active")],
    lit.slice(0, 40).map((s) => `<tr><td>${s.zone ? `<a href="#zone-${s.zone.id}">${escapeHtml(zoneName(env, s))}</a>` : escapeHtml(zoneName(env, s).slice(0, 60))}</td><td>${escapeHtml(continentOf(s))}</td><td class="num">${s.calls}</td>${kd ? `<td class="num">${s.kills}</td><td class="num">${s.deaths}</td>` : ""}<td>${s.guilds[0] ? env.guild(s.guilds[0].guildId) : ""}</td></tr>`), kd ? [2, 3, 4] : [2], "dense")
    : `<p class="muted">${t("No call for help in this period.", "Aucun appel à l'aide pour cette période.")}</p>`;
  return `${PVP_MAP_CSS}<h2 id="zone-map">${t("Zone map", "Carte des zones")} · ${period}</h2>${legend}<div class="pvp-maps">${maps}</div>${panels}<h3>${t("Zones", "Zones")}</h3>${table}`;
}

/** The hub's two PvP cards' contents: a podium of this week's top killers and the latest battleground results. */
export function pvpHubParts(env: PvpEnv, data: PvpData): { podium: PodiumEntry[]; latest: string } {
  const { t, lang } = env;
  const rows = worldBoard(data, { className: null, band: null, period: "week", mode: null }).rows.filter((row) => row.kills > 0);
  const podium = rows.slice(0, 3).map((row): PodiumEntry => ({ name: row.name, href: link(`/leaderboards/pvp/`, lang), sub: [row.className ? env.classLabel(row.className) : null, `${row.deaths} ${t("deaths", "morts")}`].filter(Boolean).join(" · "), value: `${row.kills}`, className: env.classSlug(row.className) }));
  const games = [...data.games].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime()).slice(0, 6);
  const latest = games.length ? strip(games.map((g) => ({ main: `${env.person(g)} <span class="muted">${escapeHtml(mapTitle(g.mapId, lang))}</span>`, side: outcomeText(t, g.outcome) }))) : "";
  return { podium, latest };
}

/** A character page's PvP section, or "" when the character has none. */
export function playerPvpPanel(env: PvpEnv, data: PvpData, character: string, realm: string | null): string {
  const { t, lang } = env;
  const mine = playerPvp(data, character, realm);
  if (!mine.week && !mine.total && !mine.record.games) return "";
  const world = mine.total ?? mine.week;
  return `<h2>PvP</h2>`
    + (world ? `<p><span class="score">${world.kills}</span> ${t("kills", "victimes")} · ${world.deaths} ${t("deaths", "morts")} · ${t("K/D", "V/M")} ${killDeathRatio(world.kills, world.deaths)}${mine.week ? ` <span class="muted">(${t("this week", "cette semaine")}: ${mine.week.kills} / ${mine.week.deaths})</span>` : ""}</p>` : "")
    + (mine.record.games ? `<p>${t("Battlegrounds, last 30 days", "Champs de bataille, 30 derniers jours")}: <span class="score">${mine.record.wins}</span>–${mine.record.losses} <span class="muted">${mine.record.games} ${t("games", "parties")}</span></p>`
      + strip(mine.games.map((g) => ({ main: `${outcomeText(t, g.outcome)} ${escapeHtml(mapTitle(g.mapId, lang))}`, side: date(g.endedAt) }))) : "")
    + `<p><a href="${link("/leaderboards/pvp/", lang)}">${t("PvP leaderboards →", "Classements PvP →")}</a></p>`;
}

/** A guild page's PvP section, or "" when its members have none. */
export function guildPvpPanel(env: PvpEnv, data: PvpData, guildId: string): string {
  const { t, lang } = env;
  const mine = guildPvp(data, guildId);
  if (!mine.top.length && !mine.games && !mine.zones.length) return "";
  const tile = (k: string, v: string) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<h2>PvP</h2><div class="tiles">${tile(t("Kills this week", "Victimes cette semaine"), String(mine.week.kills))}${tile(t("Deaths this week", "Morts cette semaine"), String(mine.week.deaths))}${tile(t("K/D this week", "V/M cette semaine"), killDeathRatio(mine.week.kills, mine.week.deaths))}${tile(t("Battleground wins", "Victoires en champ de bataille"), `${mine.wins}<span class="tag">/${mine.games}</span>`)}</div>`
    + (mine.top.length ? env.table([t("Player", "Joueur"), t("Kills", "Victimes"), t("Deaths", "Morts")], mine.top.map((row) => `<tr><td>${env.person(row)}</td><td class="num score">${row.kills}</td><td class="num">${row.deaths}</td></tr>`), [1, 2], "dense") : "")
    + (mine.zones.length ? `<p class="muted">${t("Most active zones", "Zones les plus actives")}: ${mine.zones.map((z) => `${escapeHtml(lang === "fr" ? z.fr : z.en)} (${z.heat})`).join(", ")}</p>` : "")
    + `<p><a href="${link("/leaderboards/pvp/", lang)}">${t("PvP leaderboards →", "Classements PvP →")}</a></p>`;
}
