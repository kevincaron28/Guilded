import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import { guildDashboardAccess } from "./guild-dashboard-access.js";
import { accessibleCommunitySeasons, communityAccess } from "./community-access.js";
import { initializeCommunityBadgeHistory, communityBadgeShelf } from "./community-badges.js";
import { badgeLabel } from "./community-badge-rules.js";
import { withGuildScope } from "./guild-scope.js";

export function createWebCommunityBadges(database: PrismaClient, client: Client | undefined, allows: (id: string) => boolean) {
  const access = guildDashboardAccess(database, client, allows, "member");
  const path = "/me/badges";
  const meSection = async (ctx: WebContext) => ctx.account ? `<h2>${ctx.t("My badges", "Mes badges")}</h2><p><a href="${h(link(path, ctx.lang))}">${ctx.t("Open my seasonal badge shelf", "Ouvrir mes badges par saison")}</a></p>` : "";
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== path) return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx, user = ctx.account.discordUserId;
    const title = t("Badge shelf", "Collection de badges"), guildId = ctx.request.query.get("guild"), seasonId = ctx.request.query.get("season"), owner = ctx.request.query.get("player") ?? user;
    const page = (status: number, body: string) => kit.page(status, title, body, { noindex: true });
    if ([guildId, seasonId, owner].some(value => value && value.length > 64)) return page(400, t("Invalid selection.", "Sélection invalide."));
    if (!guildId) {
      const guilds = await access.guilds(user);
      return page(200, `<h1>${title}</h1><ul>${guilds.map(guild => `<li><a href="${h(link(path, lang, { guild: guild.id }))}">${h(guild.name)}</a></li>`).join("")}</ul><p>${t("You can also use /community badges in Discord.", "Vous pouvez aussi utiliser /community badges dans Discord.")}</p>`);
    }
    if (!client || !await access.authorize(user, guildId)) return page(403, t("Access denied.", "Accès refusé."));
    return withGuildScope(database, guildId, async () => {
      const record = await database.guild.findUniqueOrThrow({ where: { id: guildId }, select: { discordId: true } });
      const guild = await client.guilds.fetch(record.discordId);
      const seasons = await accessibleCommunitySeasons(database, guild, guildId, user);
      if (!seasonId) return page(200, `<h1>${title}</h1><ul>${seasons.filter(s => s.game === "DISCORD").map(season => `<li><a href="${h(link(path, lang, { guild: guildId, season: season.id, player: owner }))}">${h(season.name)} · ${season.status === "ACTIVE" ? t("Current", "En cours") : t("Archive", "Archive")}</a></li>`).join("")}</ul>`);
      const season = seasons.find(s => s.id === seasonId && s.game === "DISCORD");
      if (!season) return page(403, t("Access denied.", "Accès refusé."));
      await communityAccess(guild, owner, season);
      await initializeCommunityBadgeHistory(database, guildId, seasonId);
      const rows = await communityBadgeShelf(database, seasonId, user, owner);
      if (!rows) return page(403, t("This member has not shared this season's badges.", "Ce membre n'a pas partagé ses badges pour cette saison."));
      return page(200, `<h1>${title}</h1><h2>${h(season.name)}</h2><ul>${rows.map(row => `<li><strong>${h(badgeLabel(row.code, lang))}</strong> · ${row.earnedAt ? h(row.earnedAt.toISOString().slice(0, 10)) : t("Historical recognition; earning date unknown", "Reconnaissance historique; date d'obtention inconnue")}</li>`).join("")}</ul><p>${t("Cosmetic only. No extra points, loot priority or roles.", "Décoratifs seulement. Aucun bonus de points, priorité de butin ou rôle.")}</p>${owner === user ? `<p>${t("Your shelf is private by default. /community badges share:true shares this season with members who can access it; share:false makes it private again. Public profiles do not expose this shelf.", "Votre collection est privée par défaut. /community badges share:true partage cette saison avec les membres qui y ont accès; share:false la rend privée. Les profils publics ne montrent pas cette collection.")}</p>` : ""}`);
    });
  };
  return { route, meSection };
}
