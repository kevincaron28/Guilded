import type { PrismaClient } from "../generated/prisma/client.js";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";
import { currentEdition } from "./edition-context.js";
import { factionLabel, FACTIONS, languageLabel } from "./recruitment.js";
import { editionSelect, escapeHtml, link, options } from "./web-layout.js";
import type { WebContext, WebKit, WebRoute } from "./web-app.js";

// /recruitment/guilds/: every guild a player can find on Guilded, in one list (the "Guilds" menu
// entry). A guild is listed when it published its guild page, has an open recruitment listing or
// publishes its dungeon runs. It lives under /recruitment/ because the Cloudflare Worker already
// forwards that path to the bot. Names and settings only; nothing about members.

export interface DirectoryGuild {
  id: string; name: string; gameEdition: string; language: string | null;
  /** The published guild page's address (/g/<slug>/), or null. */
  slug: string | null;
  /** Officers let search engines index the published page (/guildpage); false keeps it out of the sitemap. */
  indexable?: boolean;
  /** Publishes dungeon runs: /leaderboards/guild/<id>/. */
  dungeons: boolean;
  cores: string[];
  listings: { id: string; faction: string | null; realm: string | null; language: string | null }[];
}
export interface GuildDirectoryStore { guilds(edition: string): Promise<DirectoryGuild[]> }

// Upper bounds: guilds read per edition, and shown per page (a search narrows the rest).
const MAX_GUILDS = 500;
const SHOWN = 60;
const QUERY_MAX = 40;

export function prismaGuildDirectoryStore(database: PrismaClient, allows: (discordId: string) => boolean): GuildDirectoryStore {
  return {
    async guilds(edition) {
      const rows = await database.guild.findMany({
        where: { gameEdition: edition, OR: [{ page: { published: true } }, { recruitmentListings: { some: { open: true } } }, { settings: { publicDungeonRuns: true } }] },
        select: {
          id: true, name: true, discordId: true, gameEdition: true,
          settings: { select: { language: true, publicDungeonRuns: true } },
          page: { select: { slug: true, published: true, indexable: true } },
          raidCores: { select: { name: true }, orderBy: { name: "asc" }, take: 8 },
          recruitmentListings: { where: { open: true }, select: { id: true, faction: true, realm: true, language: true }, take: 5 }
        },
        orderBy: { name: "asc" }, take: MAX_GUILDS
      });
      return rows.filter((row) => allows(row.discordId)).map((row) => ({
        id: row.id, name: row.name, gameEdition: row.gameEdition, language: row.settings?.language ?? null,
        slug: row.page?.published ? row.page.slug : null, indexable: row.page?.published === true && row.page.indexable !== false, dungeons: row.settings?.publicDungeonRuns === true,
        cores: row.raidCores.map((core) => core.name), listings: row.recruitmentListings
      }));
    }
  };
}

export interface DirectoryFilters { q: string; faction: string | null; language: string | null; recruiting: boolean }

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function readDirectoryFilters(query: URLSearchParams): DirectoryFilters {
  const faction = query.get("faction")?.toUpperCase() ?? "";
  const language = query.get("language") ?? "";
  return {
    q: (query.get("q") ?? "").trim().slice(0, QUERY_MAX),
    faction: (FACTIONS as readonly string[]).includes(faction) ? faction : null,
    language: language === "en" || language === "fr" ? language : null,
    recruiting: query.get("recruiting") === "1"
  };
}

// A faction or a language matches the guild's open listings (a guild has no faction otherwise);
// the language also matches the guild's own language.
export function directoryMatches(guild: DirectoryGuild, filters: DirectoryFilters): boolean {
  if (filters.q && !fold(guild.name).includes(fold(filters.q))) return false;
  if (filters.recruiting && !guild.listings.length) return false;
  if (filters.faction && !guild.listings.some((listing) => listing.faction === filters.faction)) return false;
  if (filters.language && guild.language !== filters.language && !guild.listings.some((listing) => listing.language === filters.language)) return false;
  return true;
}

export function createGuildDirectory(store: GuildDirectoryStore): { route: WebRoute } {
  function filterForm(ctx: WebContext, filters: DirectoryFilters): string {
    const { t, lang } = ctx;
    const any = { value: "", label: t("Any", "Tous") };
    return `<form class="filters" method="get" action="/recruitment/guilds/"><input type="hidden" name="lang" value="${lang}">`
      + `<div><label for="q">${t("Guild name", "Nom de la guilde")}</label><input id="q" name="q" type="search" maxlength="${QUERY_MAX}" value="${escapeHtml(filters.q)}"></div>`
      + editionSelect(lang)
      + `<div><label for="faction">${t("Faction", "Faction")}</label><select id="faction" name="faction">${options([any, ...FACTIONS.map((value) => ({ value, label: factionLabel(value, lang) }))], filters.faction)}</select></div>`
      + `<div><label for="language">${t("Language", "Langue")}</label><select id="language" name="language">${options([any, { value: "en", label: languageLabel("en", lang) }, { value: "fr", label: languageLabel("fr", lang) }], filters.language)}</select></div>`
      + `<div><label class="check-label"><input type="checkbox" id="recruiting" name="recruiting" value="1"${filters.recruiting ? " checked" : ""}><span>${t("Recruiting now", "Recrute en ce moment")}</span></label></div>`
      + `<div><button class="button" type="submit">${t("Search", "Rechercher")}</button></div></form>`;
  }

  function guildCard(ctx: WebContext, guild: DirectoryGuild): string {
    const { t, lang } = ctx;
    const page = guild.slug ? `/g/${encodeURIComponent(guild.slug)}/?lang=${lang}` : null;
    const name = page ? `<a href="${escapeHtml(page)}">${escapeHtml(guild.name)}</a>` : escapeHtml(guild.name);
    const tags = [
      guild.language && languageLabel(guild.language, lang),
      ...new Set(guild.listings.map((listing) => listing.faction && factionLabel(listing.faction, lang))),
      ...new Set(guild.listings.map((listing) => listing.realm))
    ].filter((part): part is string => Boolean(part));
    const count = guild.cores.length;
    const cores = count
      ? `<p>${escapeHtml(t(`${count} raid core${count === 1 ? "" : "s"}: `, `${count} core${count === 1 ? "" : "s"} de raid : `) + guild.cores.join(", "))}</p>` : "";
    const links = [
      page ? `<a class="button" href="${escapeHtml(page)}">${t("Guild page", "Page de guilde")}</a>` : "",
      guild.listings[0] ? `<a href="${link(`/recruitment/apply/${guild.listings[0].id}`, lang)}">${t("Apply", "Postuler")}</a>` : "",
      guild.dungeons ? `<a href="${link(`/leaderboards/guild/${encodeURIComponent(guild.id)}`, lang)}">${t("Dungeon scores", "Scores de donjon")}</a>` : ""
    ].filter(Boolean);
    return `<article class="card"><h3>${name}${guild.listings.length ? ` <span class="tag">· ${t("recruiting", "recrute")}</span>` : ""}</h3>`
      + (tags.length ? `<p class="tag">${escapeHtml(tags.join(" · "))}</p>` : "") + cores
      + (links.length ? `<p>${links.join(" &nbsp;")}</p>` : "") + "</article>";
  }

  const route: WebRoute = async (ctx: WebContext, kit: WebKit) => {
    const path = ctx.request.path;
    if (path === "/recruitment/guilds") return kit.redirect(`${path}/${ctx.request.query.size ? `?${ctx.request.query.toString()}` : ""}`);
    // Search engines find the published guild pages whose officers allow indexing here; the website's
    // robots.txt names this file (scripts/build-site.mjs).
    if (path === "/recruitment/guilds/sitemap.xml" && ["GET", "HEAD"].includes(ctx.request.method)) {
      const slugs = new Set((await Promise.all(GAME_EDITIONS.map((edition) => store.guilds(edition)))).flat()
        .filter((guild) => guild.slug && guild.indexable !== false).map((guild) => guild.slug!));
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...slugs].sort().map((slug) => `<url><loc>https://guilded.kcaron.top/g/${encodeURIComponent(slug)}/</loc></url>`).join("")}</urlset>
`;
      return { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" }, body: ctx.request.method === "HEAD" ? "" : body };
    }
    if (path !== "/recruitment/guilds/" || ctx.request.method === "POST") return null;
    const { t, lang } = ctx;
    const filters = readDirectoryFilters(ctx.request.query);
    const all = await store.guilds(currentEdition());
    const found = all.filter((guild) => directoryMatches(guild, filters));
    const body = `<p class="eyebrow">Guilded</p><h1>${t("Find a guild", "Trouver une guilde")}</h1>`
      + `<p class="muted">${t("Guilds using Guilded: their page with raid cores, times and loot rules, their recruitment and their dungeon scores.", "Les guildes qui utilisent Guilded : leur page avec les cores de raid, les horaires et les règles de butin, leur recrutement et leurs scores de donjon.")}</p>`
      + filterForm(ctx, filters)
      + `<h2>${t("Guilds", "Guildes")} <span class="tag">(${found.length})</span></h2>`
      + (found.length
        ? `<div class="cards">${found.slice(0, SHOWN).map((guild) => guildCard(ctx, guild)).join("")}</div>`
          + (found.length > SHOWN ? `<p class="muted">${t(`Showing ${SHOWN} of ${found.length}. Search by name to find the others.`, `${SHOWN} sur ${found.length} affichées. Cherchez par nom pour trouver les autres.`)}</p>` : "")
        : `<p class="muted">${t("No guild matches these filters yet. Officers: create your guild page with /guildpage create, then /guildpage publish in Discord, or list it with /recruit set.", "Aucune guilde ne correspond encore à ces filtres. Officiers : créez la page de votre guilde avec /guildpage create, puis /guildpage publish dans Discord, ou annoncez-la avec /recruit set.")}</p>`)
      + `<p><a href="${link("/recruitment/", lang)}">${t("Recruitment: open listings and players looking for a guild →", "Recrutement : annonces et joueurs qui cherchent une guilde →")}</a><br>`
      + `<a href="${link("/leaderboards/guilds/", lang)}">${t("Guild rankings by dungeon score →", "Classement des guildes par score de donjon →")}</a></p>`;
    return kit.page(200, t("Find a guild", "Trouver une guilde"), body, { description: t("Find a WoW guild using Guilded: raid cores, times, loot rules, recruitment and dungeon scores.", "Trouvez une guilde WoW qui utilise Guilded : cores de raid, horaires, règles de butin, recrutement et scores de donjon.") });
  };
  return { route };
}
