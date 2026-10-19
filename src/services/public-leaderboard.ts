import type { PrismaClient } from "@prisma/client";
import { CLASSES } from "../wow-data.js";
import { DEFAULT_DUNGEON_BRACKETS } from "./dungeon-november-rules.js";
import { formatDuration } from "./dungeon-rules.js";
import { issuePersonalCode, type PersonalStore } from "./personal-pairing.js";
import { classLabel, className as classFromText, roleLabel, ROLES } from "./recruitment.js";
import { seasonOf } from "./public-runs.js";
import { escapeHtml, link, options } from "./web-layout.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";

// Public dungeon leaderboards (7.0, roadmap request 6): /leaderboards/ by dungeon, level bracket
// (rules v6 brackets), class, role and season, and /leaderboards/character/<Name-Realm>.
// Runs come from personal companions and opted-in guilds, after the checks in public-runs.ts.

export interface LeaderPlayer { character: string; realm: string; className: string | null; role: string | null; level: number | null }
export interface LeaderRun {
  runId: string; instanceId: number; dungeonName: string; durationSec: number; endedAt: Date; deaths: number | null;
  bracket: string | null; season: string; confirmations: number; players: LeaderPlayer[];
}
export interface DungeonSummary { instanceId: number; dungeonName: string; bestSec: number; runs: number }

export interface LeaderboardStore {
  dungeons(season: string | null, bracket: string | null): Promise<DungeonSummary[]>;
  runs(instanceId: number, season: string | null, bracket: string | null): Promise<LeaderRun[]>;
  characterRuns(character: string, realm: string | null): Promise<LeaderRun[]>;
  seasons(): Promise<string[]>;
}

export interface LeaderFilters { instanceId: number | null; season: string | null; bracket: string | null; className: string | null; role: string | null; confirmed: boolean }
const SEASON = /^\d{4}-Q[1-4]$/;
const BRACKETS = DEFAULT_DUNGEON_BRACKETS.map((bracket) => bracket.key as string);

export function readLeaderFilters(query: URLSearchParams, now = new Date()): LeaderFilters {
  const dungeon = Number(query.get("dungeon"));
  const season = query.get("season");
  const role = query.get("role")?.toUpperCase() ?? "";
  return {
    instanceId: Number.isInteger(dungeon) && dungeon > 0 ? dungeon : null,
    season: season === "all" ? null : season && SEASON.test(season) ? season : seasonOf(now),
    bracket: BRACKETS.includes(query.get("bracket") ?? "") ? query.get("bracket") : null,
    className: query.get("class") ? classFromText(query.get("class")!) : null,
    role: (ROLES as readonly string[]).includes(role) ? role : null,
    confirmed: query.get("confirmed") === "1"
  };
}

export interface RankedEntry { player: LeaderPlayer; run: LeaderRun }

// Best run per character (name + realm), fastest first; an earlier finish wins a tie.
export function rankCharacters(runs: LeaderRun[], filters: Pick<LeaderFilters, "className" | "role" | "confirmed">, limit = 100): RankedEntry[] {
  const best = new Map<string, RankedEntry>();
  for (const run of runs) {
    if (filters.confirmed && run.confirmations < 2) continue;
    for (const player of run.players) {
      if (filters.className && player.className?.toLowerCase() !== filters.className.toLowerCase()) continue;
      if (filters.role && player.role?.toUpperCase() !== filters.role) continue;
      const id = `${player.character.toLowerCase()}\0${player.realm.toLowerCase()}`;
      const current = best.get(id);
      if (!current || run.durationSec < current.run.durationSec || (run.durationSec === current.run.durationSec && run.endedAt < current.run.endedAt)) best.set(id, { player, run });
    }
  }
  return [...best.values()].sort((a, b) => a.run.durationSec - b.run.durationSec || a.run.endedAt.getTime() - b.run.endedAt.getTime()).slice(0, limit);
}

export const characterPath = (player: { character: string; realm: string }) => `/leaderboards/character/${encodeURIComponent(player.realm ? `${player.character}-${player.realm}` : player.character)}`;

export function prismaLeaderboardStore(database: PrismaClient): LeaderboardStore {
  const select = { id: true, instanceId: true, dungeonName: true, durationSec: true, endedAt: true, deaths: true, bracket: true, season: true, confirmations: true,
    players: { select: { character: true, realm: true, className: true, role: true, level: true } } } as const;
  type Row = { id: string; instanceId: number; dungeonName: string; durationSec: number; endedAt: Date; deaths: number | null; bracket: string | null; season: string; confirmations: number; players: LeaderPlayer[] };
  const view = (row: Row): LeaderRun => ({ runId: row.id, instanceId: row.instanceId, dungeonName: row.dungeonName, durationSec: row.durationSec, endedAt: row.endedAt, deaths: row.deaths, bracket: row.bracket, season: row.season, confirmations: row.confirmations, players: row.players });
  return {
    async dungeons(season, bracket) {
      const rows = await database.publicRun.groupBy({ by: ["instanceId", "dungeonName"], where: { status: "ACCEPTED", ...(season ? { season } : {}), ...(bracket ? { bracket } : {}) }, _min: { durationSec: true }, _count: { _all: true }, orderBy: { dungeonName: "asc" }, take: 200 });
      return rows.map((row) => ({ instanceId: row.instanceId, dungeonName: row.dungeonName, bestSec: row._min.durationSec ?? 0, runs: row._count._all }));
    },
    async runs(instanceId, season, bracket) {
      const rows = await database.publicRun.findMany({ where: { instanceId, status: "ACCEPTED", ...(season ? { season } : {}), ...(bracket ? { bracket } : {}) }, orderBy: [{ durationSec: "asc" }, { endedAt: "asc" }], take: 1_000, select });
      return rows.map(view);
    },
    async characterRuns(character, realm) {
      const rows = await database.publicRun.findMany({
        where: { status: "ACCEPTED", players: { some: { character: { equals: character, mode: "insensitive" }, ...(realm !== null ? { realm: { equals: realm, mode: "insensitive" } } : {}) } } },
        orderBy: { endedAt: "desc" }, take: 200, select
      });
      return rows.map(view);
    },
    async seasons() {
      const rows = await database.publicRun.findMany({ where: { status: "ACCEPTED" }, distinct: ["season"], select: { season: true }, orderBy: { season: "desc" }, take: 20 });
      return rows.map((row) => row.season);
    }
  };
}

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

  const time = (seconds: number) => formatDuration(seconds);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const party = (ctx: WebContext, run: LeaderRun) => run.players.map((player) => `<a href="${link(characterPath(player), ctx.lang)}">${escapeHtml(player.character)}</a>`).join(", ");
  const trust = (ctx: WebContext, run: LeaderRun) => run.confirmations >= 2
    ? `<span class="tag" title="${ctx.t("Party members' uploads agree", "Les envois des membres du groupe concordent")}">✔ ${run.confirmations}</span>`
    : `<span class="tag">${ctx.t("1 upload", "1 envoi")}</span>`;

  function filterForm(ctx: WebContext, filters: LeaderFilters, seasons: string[], dungeons: DungeonSummary[]): string {
    const { t, lang } = ctx;
    const any = { value: "", label: t("Any", "Tous") };
    const seasonOptions = [...new Set([seasonOf(now()), ...seasons])].map((value) => ({ value, label: value }));
    return `<form class="filters" method="get" action="/leaderboards/"><input type="hidden" name="lang" value="${lang}">`
      + `<div><label for="dungeon">${t("Dungeon", "Donjon")}</label><select id="dungeon" name="dungeon">${options([{ value: "", label: t("All dungeons", "Tous les donjons") }, ...dungeons.map((d) => ({ value: String(d.instanceId), label: d.dungeonName }))], filters.instanceId ? String(filters.instanceId) : "")}</select></div>`
      + `<div><label for="season">${t("Season", "Saison")}</label><select id="season" name="season">${options([...seasonOptions, { value: "all", label: t("All time", "Depuis le début") }], filters.season ?? "all")}</select></div>`
      + `<div><label for="bracket">${t("Levels", "Niveaux")}</label><select id="bracket" name="bracket">${options([any, ...BRACKETS.map((value) => ({ value, label: value }))], filters.bracket)}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([any, ...CLASSES.map((name) => ({ value: name, label: classLabel(name, lang) }))], filters.className)}</select></div>`
      + `<div><label for="role">${t("Role", "Rôle")}</label><select id="role" name="role">${options([any, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], filters.role)}</select></div>`
      + `<div><label><input type="checkbox" style="width:auto" name="confirmed" value="1"${filters.confirmed ? " checked" : ""}> ${t("Confirmed by the party", "Confirmés par le groupe")}</label></div>`
      + `<div><button class="button" type="submit">${t("Show", "Afficher")}</button></div></form>`;
  }

  async function board(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const filters = readLeaderFilters(ctx.request.query, now());
    const [seasons, dungeons] = await Promise.all([cached("seasons", () => deps.store.seasons()), cached(`d:${filters.season}:${filters.bracket}`, () => deps.store.dungeons(filters.season, filters.bracket))]);
    const intro = `<p class="eyebrow">Guilded</p><h1>${t("Dungeon leaderboards", "Classements des donjons")}</h1>`
      + `<p class="muted">${t("Fastest finished runs from Guilded and Guilded Dungeons players. Runs are checked before they show: impossible times, duplicates and runs the party disagrees on are left out. ✔ means party members' uploads agree.", "Les donjons terminés les plus rapides des joueurs de Guilded et Guilded Dungeons. Les essais sont vérifiés avant d'apparaître : temps impossibles, doublons et essais contestés par le groupe sont écartés. ✔ : les envois des membres du groupe concordent.")}</p>`;
    let body: string;
    const chosen = filters.instanceId ? dungeons.find((d) => d.instanceId === filters.instanceId) : null;
    if (filters.instanceId) {
      const runs = await cached(`r:${filters.instanceId}:${filters.season}:${filters.bracket}`, () => deps.store.runs(filters.instanceId!, filters.season, filters.bracket));
      const ranked = rankCharacters(runs, filters);
      const name = chosen?.dungeonName ?? runs[0]?.dungeonName ?? t("Dungeon", "Donjon");
      body = `<h2>${escapeHtml(name)}</h2>` + (ranked.length
        ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>${t("Character", "Personnage")}</th><th>${t("Class", "Classe")}</th><th>${t("Role", "Rôle")}</th><th class="num">${t("Time", "Temps")}</th><th class="num">${t("Deaths", "Morts")}</th><th>${t("Party", "Groupe")}</th><th>${t("Date", "Date")}</th><th></th></tr></thead><tbody>`
          + ranked.map((entry, index) => `<tr><td>${index + 1}</td><td><a href="${link(characterPath(entry.player), lang)}">${escapeHtml(entry.player.character)}</a>${entry.player.realm ? ` <span class="tag">${escapeHtml(entry.player.realm)}</span>` : ""}</td>`
            + `<td>${entry.player.className ? escapeHtml(classLabel(entry.player.className, lang)) : ""}</td><td>${entry.player.role ? escapeHtml(roleLabel(entry.player.role, lang)) : ""}</td>`
            + `<td class="num">${time(entry.run.durationSec)}</td><td class="num">${entry.run.deaths ?? "?"}</td><td>${party(ctx, entry.run)}</td><td>${date(entry.run.endedAt)}</td><td>${trust(ctx, entry.run)}</td></tr>`).join("")
          + "</tbody></table></div>"
        : `<p class="muted">${t("No run matches these filters yet.", "Aucun essai ne correspond encore à ces filtres.")}</p>`);
    } else {
      body = dungeons.length
        ? `<div class="table-wrap"><table><thead><tr><th>${t("Dungeon", "Donjon")}</th><th class="num">${t("Record", "Record")}</th><th class="num">${t("Runs", "Essais")}</th></tr></thead><tbody>`
          + dungeons.map((d) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(d.instanceId), season: filters.season ?? "all", bracket: filters.bracket })}">${escapeHtml(d.dungeonName)}</a></td><td class="num">${time(d.bestSec)}</td><td class="num">${d.runs}</td></tr>`).join("")
          + "</tbody></table></div>"
        : `<p class="muted">${t("No public run this season yet. Install Guilded Dungeons, sign in and connect the companion from your page.", "Aucun essai public cette saison. Installez Guilded Dungeons, connectez-vous et reliez le compagnon depuis votre page.")} <a href="${link("/me/", lang)}">${t("My page", "Ma page")}</a></p>`;
    }
    return kit.page(200, t("Dungeon leaderboards", "Classements des donjons"), intro + filterForm(ctx, filters, seasons, dungeons) + body, { description: t("WoW Forever dungeon leaderboards by dungeon, level bracket, class, role and season.", "Classements des donjons WoW Forever par donjon, niveaux, classe, rôle et saison.") });
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
    const mine = (run: LeaderRun) => run.players.find((player) => player.character.toLowerCase() === name.toLowerCase() && (realm === null || player.realm.toLowerCase() === realm.toLowerCase()));
    const best = new Map<number, LeaderRun>();
    for (const run of runs) { const current = best.get(run.instanceId); if (!current || run.durationSec < current.durationSec) best.set(run.instanceId, run); }
    const me = runs.map(mine).find(Boolean);
    const title = `${me?.character ?? name}${realm ? `-${realm}` : ""}`;
    const body = `<p class="eyebrow">${t("Character", "Personnage")}</p><h1>${escapeHtml(title)}</h1>`
      + (me?.className ? `<p>${escapeHtml(classLabel(me.className, lang))}${me.level ? ` · ${t("level", "niveau")} ${me.level}` : ""}</p>` : "")
      + (runs.length ? `<h2>${t("Best time per dungeon", "Meilleur temps par donjon")}</h2><div class="table-wrap"><table><thead><tr><th>${t("Dungeon", "Donjon")}</th><th class="num">${t("Time", "Temps")}</th><th>${t("Party", "Groupe")}</th><th>${t("Date", "Date")}</th><th></th></tr></thead><tbody>`
        + [...best.values()].sort((a, b) => a.dungeonName.localeCompare(b.dungeonName)).map((run) => `<tr><td><a href="${link("/leaderboards/", lang, { dungeon: String(run.instanceId), season: "all" })}">${escapeHtml(run.dungeonName)}</a></td><td class="num">${time(run.durationSec)}</td><td>${party(ctx, run)}</td><td>${date(run.endedAt)}</td><td>${trust(ctx, run)}</td></tr>`).join("")
        + `</tbody></table></div><h2>${t("Recent runs", "Essais récents")}</h2><div class="table-wrap"><table><thead><tr><th>${t("Date", "Date")}</th><th>${t("Dungeon", "Donjon")}</th><th class="num">${t("Time", "Temps")}</th><th class="num">${t("Deaths", "Morts")}</th><th>${t("Levels", "Niveaux")}</th></tr></thead><tbody>`
        + runs.slice(0, 30).map((run) => `<tr><td>${date(run.endedAt)}</td><td>${escapeHtml(run.dungeonName)}</td><td class="num">${time(run.durationSec)}</td><td class="num">${run.deaths ?? "?"}</td><td>${escapeHtml(run.bracket ?? "?")}</td></tr>`).join("") + "</tbody></table></div>"
        : `<p class="muted">${t("No public run for this character yet.", "Aucun essai public pour ce personnage.")}</p>`);
    return kit.page(runs.length ? 200 : 404, title, body, { description: t(`${title}: dungeon times on Guilded's public leaderboards.`, `${title} : temps de donjon sur les classements publics de Guilded.`), ...(runs.length ? {} : { noindex: true }) });
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
