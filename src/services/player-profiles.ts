import type { PrismaClient } from "../generated/prisma/client.js";
import { characterPath, leaderRun, PUBLIC_RUN_SELECT, type LeaderRun } from "./public-leaderboard.js";
import { scoreRun } from "./public-score.js";
import { formatDuration } from "./dungeon-rules.js";
import { escapeHtml, link } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

export interface ProfileCharacter { name: string; realm: string; source: "guild" | "companion" }
export interface PlayerProfile { id: string; name: string; public: boolean; characters: ProfileCharacter[]; runs: LeaderRun[] }
export interface ProfileStore {
  list(page: number): Promise<{ id: string; name: string }[]>;
  get(id: string): Promise<PlayerProfile | null>;
  visibility(id: string, visible: boolean): Promise<void>;
}

export function prismaProfileStore(database: PrismaClient, allows: (id: string) => boolean): ProfileStore {
  return {
    async list(page) {
      return (await database.webAccount.findMany({ where: { publicProfile: true }, orderBy: { id: "asc" }, skip: page * 24, take: 25,
        select: { id: true, displayName: true, username: true } })).map(row => ({ id: row.id, name: row.displayName ?? row.username }));
    },
    async get(id) {
      const account = await database.webAccount.findUnique({ where: { id }, select: {
        id: true, discordUserId: true, username: true, displayName: true, publicProfile: true, characters: { select: { name: true, realm: true }, take: 100 }
      } });
      if (!account) return null;
      const linked = await database.character.findMany({
        where: { member: { discordUserId: account.discordUserId, status: "ACTIVE" } },
        select: { name: true, realm: true, member: { select: { guild: { select: { discordId: true } } } } }, take: 100
      });
      const characters: ProfileCharacter[] = [];
      for (const char of [
        ...linked.filter(c => allows(c.member.guild.discordId)).map(c => ({ name: c.name, realm: c.realm, source: "guild" as const })),
        ...account.characters.map(c => ({ ...c, source: "companion" as const }))
      ]) {
        if (char.realm && !characters.some(c => c.name.toLowerCase() === char.name.toLowerCase() && c.realm.toLowerCase() === char.realm.toLowerCase())) characters.push(char);
      }
      // Only public, accepted runs. A profile never promotes private guild run data.
      // One bounded query even for accounts with many alts.
      const runs = characters.length ? await database.publicRun.findMany({
        where: { status: "ACCEPTED", players: { some: { OR: characters.slice(0, 25).map(char => ({
          character: { equals: char.name, mode: "insensitive" as const }, realm: { equals: char.realm, mode: "insensitive" as const }
        })) } } },
        orderBy: [{ endedAt: "desc" }, { id: "asc" }], take: 50, select: PUBLIC_RUN_SELECT
      }) : [];
      return { id: account.id, name: account.displayName ?? account.username, public: account.publicProfile, characters, runs: runs.map(leaderRun) };
    },
    async visibility(id, visible) { await database.webAccount.update({ where: { id }, data: { publicProfile: visible } }); }
  };
}

export function createPlayerProfiles(store: ProfileStore): { route: WebRoute; meSection(ctx: WebContext): Promise<string> } {
  const path = (id: string) => `/players/${encodeURIComponent(id)}`;
  function details(ctx: WebContext, profile: PlayerProfile): string {
    const { t, lang } = ctx;
    const characters = profile.characters.map(char => `<li><a href="${link(characterPath({ character: char.name, realm: char.realm }), lang)}">${escapeHtml(char.name)}</a> · ${escapeHtml(char.realm)} <span class="tag">${char.source === "guild" ? t("Linked in Discord", "Lié dans Discord") : t("Companion character", "Personnage du compagnon")}</span></li>`).join("");
    const runs = profile.runs.map(run => {
      const score = scoreRun(run);
      return `<tr><td>${escapeHtml(run.dungeonName)}</td><td>${run.endedAt.toISOString().slice(0, 10)}</td><td>${formatDuration(run.durationSec)}</td><td>${score ? `${score.points}` : "—"}</td><td>${run.confirmations >= 2 ? t("Party confirmed", "Confirmé par le groupe") : t("One upload", "Un envoi")}</td></tr>`;
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
      const page = Math.min(1000, Math.max(0, Number.parseInt(ctx.request.query.get("page") ?? "0", 10) || 0));
      const rows = await store.list(page);
      return kit.page(200, t("Players", "Joueurs"), `<h1>${t("Guilded players", "Joueurs Guilded")}</h1><p>${t("Public player profiles: characters, dungeon runs and scores.", "Profils publics : personnages, donjons et scores.")}</p><div class="cards">`
        + rows.slice(0, 24).map(row => `<article class="card"><h2><a href="${link(path(row.id), lang)}">${escapeHtml(row.name)}</a></h2></article>`).join("") + "</div>"
        + (page > 0 ? `<a href="${link("/players/", lang, { page: String(page - 1) })}">${t("Previous", "Précédent")}</a> ` : "")
        + (rows.length > 24 ? `<a href="${link("/players/", lang, { page: String(page + 1) })}">${t("Next", "Suivant")}</a>` : ""));
    }
    const match = /^\/players\/([a-z0-9]{20,40})\/?$/.exec(target);
    if (!match) return null;
    if (ctx.request.method === "POST") return kit.page(405, "Method not allowed", "");
    const profile = await store.get(match[1]!);
    if (!profile?.public) return kit.page(404, t("Not found", "Introuvable"), `<h1>${t("Profile unavailable", "Profil indisponible")}</h1>`, { noindex: true });
    return kit.page(200, profile.name, `<h1>${escapeHtml(profile.name)}</h1>${details(ctx, profile)}`);
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
