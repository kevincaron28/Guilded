import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { characterPath, runPath, leaderRun, PUBLIC_RUN_SELECT, type LeaderRun } from "./public-leaderboard.js";
import { scoreRun, publicRules } from "./public-score.js";
import { gameEditionOf } from "./game-edition.js";
import { formatDuration } from "./dungeon-rules.js";
import { currentEdition } from "./edition-context.js";
import { classLabel, roleLabel, ROLES } from "./recruitment.js";
import { CLASSES } from "../wow-data.js";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";
import { escapeHtml, link, options } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

export interface ProfileCharacter { name: string; gameEdition?: string; displayName?: string | null; realm: string; source: "guild" | "companion" }
export interface PlayerProfile { id: string; name: string; public: boolean; characters: ProfileCharacter[]; runs: LeaderRun[] }
/** One card on /players/: a public profile, shown by its character (never its Discord name). */
export interface PlayerRow { id: string; character: string; realm: string; className: string | null; role: string | null; level: number | null; guild: string | null; sortKey: string }
export interface PlayerFilters { q: string; edition: string; realm: string | null; className: string | null; role: string | null; guild: string | null }
export interface ProfileStore {
  /** Up to PAGE_SIZE + 1 rows after the cursor (the extra row says there is a next page). */
  list(filters: PlayerFilters, after: { sortKey: string; id: string } | null): Promise<PlayerRow[]>;
  get(id: string): Promise<PlayerProfile | null>;
  visibility(id: string, visible: boolean): Promise<void>;
}

// Server-side limits for /players/: one fixed page size and short filter texts.
export const PAGE_SIZE = 24;
const TEXT_MAX = 40;

export function readPlayerFilters(query: URLSearchParams, edition: string): PlayerFilters {
  const text = (name: string) => (query.get(name) ?? "").trim().slice(0, TEXT_MAX);
  const className = query.get("class") ?? "";
  const role = query.get("role") ?? "";
  return {
    q: text("q"), edition, realm: text("realm") || null, guild: text("guild") || null,
    className: (CLASSES as readonly string[]).includes(className) ? className : null,
    role: (ROLES as readonly string[]).includes(role) ? role : null
  };
}

// The cursor is the last card's sort key and account id; anything else starts from the beginning.
export const encodeCursor = (row: { sortKey: string; id: string }) => Buffer.from(JSON.stringify([row.sortKey, row.id])).toString("base64url");
export function decodeCursor(text: string | null): { sortKey: string; id: string } | null {
  if (!text || text.length > 200) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string" ? { sortKey: value[0], id: value[1] } : null;
  } catch { return null; }
}

const likePattern = (text: string) => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function prismaProfileStore(database: PrismaClient, allows: (id: string) => boolean): ProfileStore {
  return {
    // One query: public accounts with the characters linked in their guilds' Discord (approved servers
    // only) and the ones their companion uploaded. Each account shows once, with its best match (main
    // first); cards sort by character name and page by cursor, so deep pages cost no more than the first.
    async list(filters, after) {
      const servers = (await database.guild.findMany({ select: { discordId: true }, distinct: ["discordId"], take: 5_000 })).map((row) => row.discordId).filter(allows);
      const conditions = [Prisma.sql`"gameEdition" = ${filters.edition}`];
      if (filters.q) conditions.push(Prisma.sql`lower(character) LIKE ${likePattern(filters.q)}`);
      if (filters.realm) conditions.push(Prisma.sql`lower(realm) = ${filters.realm.toLowerCase()}`);
      if (filters.className) conditions.push(Prisma.sql`"className" = ${filters.className}`);
      if (filters.role) conditions.push(Prisma.sql`role = ${filters.role}`);
      if (filters.guild) conditions.push(Prisma.sql`lower(guild) LIKE ${likePattern(filters.guild)}`);
      const page = after ? Prisma.sql`WHERE ("sortKey", id) > (${after.sortKey}, ${after.id})` : Prisma.empty;
      return database.$queryRaw<PlayerRow[]>`
        WITH chars AS (
          SELECT wa.id, COALESCE(c."displayName", c.name) AS character, c.realm, c."className", c."gameEdition", c.level, g.name AS guild, c."isMain" AS main,
            (SELECT rcm.role::text FROM "RaidCoreMember" rcm WHERE rcm."memberId" = m.id AND (rcm."characterId" IS NULL OR rcm."characterId" = c.id) LIMIT 1) AS role
          FROM "WebAccount" wa
          JOIN "Member" m ON m."discordUserId" = wa."discordUserId" AND m.status = 'ACTIVE' AND m."isTest" = false
          JOIN "Character" c ON c."memberId" = m.id
          JOIN "Guild" g ON g.id = m."guildId"
          WHERE wa."publicProfile" = true AND g."discordId" = ANY(${servers})
          UNION ALL
          SELECT wa.id, COALESCE(wc."displayName", wc.name), wc.realm, NULL, wc."gameEdition", NULL, NULL, false, NULL
          FROM "WebAccount" wa JOIN "WebCharacter" wc ON wc."accountId" = wa.id
          WHERE wa."publicProfile" = true
        ), best AS (
          SELECT DISTINCT ON (id) id, character, realm, "className", role, level, guild, lower(character) AS "sortKey"
          FROM chars WHERE ${Prisma.join(conditions, " AND ")}
          ORDER BY id, main DESC, lower(character)
        )
        SELECT * FROM best ${page} ORDER BY "sortKey", id LIMIT ${PAGE_SIZE + 1}`;
    },
    async get(id) {
      const account = await database.webAccount.findUnique({ where: { id }, select: {
        id: true, discordUserId: true, username: true, displayName: true, publicProfile: true, characters: { select: { name: true, displayName: true, realm: true, gameEdition: true }, take: 100 }
      } });
      if (!account) return null;
      const linked = await database.character.findMany({
        where: { member: { discordUserId: account.discordUserId, status: "ACTIVE" } },
        select: { name: true, displayName: true, realm: true, gameEdition: true, member: { select: { guild: { select: { discordId: true } } } } }, take: 100
      });
      const characters: ProfileCharacter[] = [];
      for (const char of [
        ...linked.filter(c => allows(c.member.guild.discordId)).map(c => ({ name: c.name, gameEdition: c.gameEdition, displayName: c.displayName, realm: c.realm, source: "guild" as const })),
        ...account.characters.map(c => ({ ...c, source: "companion" as const }))
      ]) {
        if (char.realm && !characters.some(c => c.name.toLowerCase() === char.name.toLowerCase() && c.realm.toLowerCase() === char.realm.toLowerCase() && gameEditionOf(c) === gameEditionOf(char))) characters.push(char);
      }
      // Only public, accepted runs. A profile never promotes private guild run data.
      // One bounded query even for accounts with many alts.
      const runs = characters.length ? await database.publicRun.findMany({
        where: { status: "ACCEPTED", OR: characters.slice(0, 25).map(char => ({ gameEdition: gameEditionOf(char), players: { some: {
          character: { equals: char.name, mode: "insensitive" as const }, realm: { equals: char.realm, mode: "insensitive" as const }
        } } })) },
        orderBy: [{ endedAt: "desc" }, { id: "asc" }], take: 50, select: PUBLIC_RUN_SELECT
      }) : [];
      return { id: account.id, name: account.displayName ?? account.username, public: account.publicProfile, characters, runs: runs.map(leaderRun) };
    },
    async visibility(id, visible) { await database.webAccount.update({ where: { id }, data: { publicProfile: visible } }); }
  };
}

// The link preview: a pasted profile link shows the best public score, not just the name.
export function profileDescription(profile: PlayerProfile, t: (en: string, fr: string) => string): string {
  let best: { points: number; dungeon: string } | null = null;
  for (const run of profile.runs) {
    const score = scoreRun(run, publicRules(gameEditionOf(run)));
    if (score && (!best || score.points > best.points)) best = { points: score.points, dungeon: run.dungeonName };
  }
  const chars = profile.characters.length;
  return best
    ? t(`${profile.name}: best dungeon score ${best.points} (${best.dungeon}) · ${chars} character(s) · ${profile.runs.length} recent public run(s) on Guilded.`,
      `${profile.name} : meilleur score de donjon ${best.points} (${best.dungeon}) · ${chars} personnage(s) · ${profile.runs.length} donjon(s) public(s) récent(s) sur Guilded.`)
    : t(`${profile.name}: ${chars} character(s) and public dungeon runs on Guilded.`, `${profile.name} : ${chars} personnage(s) et donjons publics sur Guilded.`);
}

export function createPlayerProfiles(store: ProfileStore): { route: WebRoute; meSection(ctx: WebContext): Promise<string> } {
  const path = (id: string) => `/players/${encodeURIComponent(id)}`;
  function details(ctx: WebContext, profile: PlayerProfile): string {
    const { t, lang } = ctx;
    const characters = profile.characters.map(char => `<li><a href="${link(characterPath({ character: char.name, realm: char.realm }), lang, { edition: char.gameEdition ?? "forever" })}">${escapeHtml(char.displayName || char.name)}</a> · ${escapeHtml(char.realm)} <span class="tag">${char.source === "guild" ? t("Linked in Discord", "Lié dans Discord") : t("Companion character", "Personnage du compagnon")}</span></li>`).join("");
    const runs = profile.runs.map(run => {
      const score = scoreRun(run, publicRules(gameEditionOf(run)));
      return `<tr><td><a href="${link(runPath(run.runId), lang, { edition: run.gameEdition ?? "forever" })}">${escapeHtml(run.dungeonName)}</a></td><td>${run.endedAt.toISOString().slice(0, 10)}</td><td>${formatDuration(run.durationSec)}</td><td>${score ? `${score.points}` : "—"}</td><td>${run.confirmations >= 2 ? t("Party confirmed", "Confirmé par le groupe") : t("One upload", "Un envoi")}</td></tr>`;
    }).join("");
    return `<h2>${t("Characters", "Personnages")}</h2>${characters ? `<ul>${characters}</ul>` : `<p>${t("No linked characters yet. Link a character in your guild's Discord, or upload a completed run with your personal companion.", "Aucun personnage lié. Liez un personnage dans le Discord de votre guilde ou envoyez un donjon terminé avec votre compagnon personnel.")}</p>`}`
      + `<h2>${t("Recent public runs", "Donjons publics récents")}</h2><p>${t("Latest 50 accepted runs. Open a character for seasonal scores and best runs. Uploads are community reports, not Blizzard verification.", "Les 50 derniers donjons acceptés. Ouvrez un personnage pour ses scores saisonniers et meilleurs donjons. Les envois sont des rapports communautaires, sans vérification de Blizzard.")}</p>`
      + (runs ? `<div class="table-wrap"><table><thead><tr><th>${t("Dungeon", "Donjon")}</th><th>Date (UTC)</th><th>${t("Duration", "Durée")}</th><th>Score</th><th>${t("Evidence", "Confirmation")}</th></tr></thead><tbody>${runs}</tbody></table></div>` : `<p>${t("No public runs yet.", "Aucun donjon public pour le moment.")}</p>`);
  }
  const route: WebRoute = async (ctx, kit) => {
    const { t, lang } = ctx;
    const target = ctx.request.path;
    if (target === "/me/profile" && ctx.request.method === "POST") {
      if (!ctx.account) return kit.signInPrompt();
      const visible = ctx.form?.get("public");
      if (visible !== "true" && visible !== "false") return kit.page(400, "Invalid visibility", "");
      await store.visibility(ctx.account.id, visible === "true");
      return kit.redirect(link("/me/", lang, { done: "profile-saved" }));
    }
    if (target === "/players" || target === "/players/") {
      if (ctx.request.method === "POST") return kit.page(405, "Method not allowed", "");
      const query = ctx.request.query;
      const filters = readPlayerFilters(query, currentEdition());
      const after = decodeCursor(query.get("after"));
      const rows = await store.list(filters, after);
      const shown = rows.slice(0, PAGE_SIZE);
      // Links keep the filters; "after" moves to the next page.
      const keep = { q: filters.q || null, realm: filters.realm, class: filters.className, role: filters.role, guild: filters.guild, edition: filters.edition === "forever" ? null : filters.edition };
      const any = { value: "", label: t("Any", "Tous") };
      const form = `<form class="filters" method="get" action="/players/"><input type="hidden" name="lang" value="${lang}">`
        + `<div><label for="q">${t("Character", "Personnage")}</label><input id="q" name="q" type="search" maxlength="${TEXT_MAX}" value="${escapeHtml(filters.q)}"></div>`
        + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([any, ...CLASSES.map((name) => ({ value: name, label: classLabel(name, lang) }))], filters.className)}</select></div>`
        + `<div><label for="role">${t("Role", "Rôle")}</label><select id="role" name="role">${options([any, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], filters.role)}</select></div>`
        + `<div><label for="realm">${t("Realm", "Royaume")}</label><input id="realm" name="realm" maxlength="${TEXT_MAX}" value="${escapeHtml(filters.realm ?? "")}"></div>`
        + `<div><label for="guild">${t("Guild", "Guilde")}</label><input id="guild" name="guild" maxlength="${TEXT_MAX}" value="${escapeHtml(filters.guild ?? "")}"></div>`
        + `<div><label for="edition">WoW</label><select id="edition" name="edition">${options(GAME_EDITIONS.map((value) => ({ value, label: value })), filters.edition)}</select></div>`
        + `<div><button class="button" type="submit">${t("Search", "Rechercher")}</button></div></form>`;
      const card = (row: PlayerRow) => `<article class="card"><h2><a href="${link(path(row.id), lang)}">${escapeHtml(row.character)}</a></h2>`
        + `<p class="tag">${escapeHtml([row.className && classLabel(row.className, lang), row.role && roleLabel(row.role, lang), row.level ? `${t("level", "niveau")} ${row.level}` : null, row.realm, row.guild].filter(Boolean).join(" · "))}</p></article>`;
      return kit.page(200, t("Players", "Joueurs"), `<h1>${t("Guilded players", "Joueurs Guilded")}</h1><p>${t("Public player profiles: characters, dungeon runs and scores. Each player shows once, by their character.", "Profils publics : personnages, donjons et scores. Chaque joueur apparaît une fois, par son personnage.")}</p>`
        + form
        + (shown.length ? `<div class="cards">${shown.map(card).join("")}</div>` : `<p class="muted">${t("No player matches these filters.", "Aucun joueur ne correspond à ces filtres.")}</p>`)
        + `<p>${after ? `<a href="${link("/players/", lang, keep)}">${t("First page", "Première page")}</a> ` : ""}`
        + (rows.length > PAGE_SIZE ? `<a href="${link("/players/", lang, { ...keep, after: encodeCursor(shown[shown.length - 1]!) })}">${t("Next", "Suivant")}</a>` : "") + "</p>");
    }
    const match = /^\/players\/([a-z0-9]{20,40})\/?$/.exec(target);
    if (!match) return null;
    if (ctx.request.method === "POST") return kit.page(405, "Method not allowed", "");
    const profile = await store.get(match[1]!);
    if (!profile?.public) return kit.page(404, t("Not found", "Introuvable"), `<h1>${t("Profile unavailable", "Profil indisponible")}</h1>`, { noindex: true });
    return kit.page(200, profile.name, `<h1>${escapeHtml(profile.name)}</h1>${details(ctx, profile)}`, { description: profileDescription(profile, ctx.t) });
  };
  return {
    route,
    async meSection(ctx) {
      if (!ctx.account) return "";
      const profile = await store.get(ctx.account.id);
      if (!profile) return "";
      const { t, lang } = ctx;
      return `<h2>${t("Your player profile", "Votre profil joueur")}</h2><p>${t("Profiles are public by default: display name, linked characters and public runs. Pairing codes and application messages stay private. Hiding this profile does not remove character results from public leaderboards.", "Les profils sont publics par défaut : nom affiché, personnages liés et donjons publics. Les codes et messages de candidature restent privés. Masquer ce profil ne retire pas les résultats des classements publics.")}</p>`
        + (profile.public ? `<p><a href="${link(path(profile.id), lang)}">${t("View your public profile", "Voir votre profil public")}</a></p>` : `<p>${t("Your profile is hidden.", "Votre profil est masqué.")}</p>`)
        + `<form method="post" action="/me/profile"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="public" value="${profile.public ? "false" : "true"}"><button class="button">${profile.public ? t("Hide my profile", "Masquer mon profil") : t("Make my profile public", "Rendre mon profil public")}</button></form>`
        + details(ctx, profile);
    }
  };
}
