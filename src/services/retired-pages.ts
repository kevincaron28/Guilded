import type { WebRoute } from "./web-app.js";
import { link } from "./web-layout.js";

// The "Who's free?" page was retired (9.3.0). Its old address goes to the account page (a permanent redirect) instead of a
// 404. The posts it stored (WebAvailability) are left alone: they expire by themselves, and "Delete my data" still removes
// a member's own.
export const retiredAvailabilityRoute: WebRoute = async (ctx, kit) => {
  if (ctx.request.path !== "/me/availability" && ctx.request.path !== "/me/availability/") return null;
  return { ...kit.redirect(link("/me/", ctx.lang)), status: 301 };
};

// The website no longer has account tools (calendar, raid plans, loot lists, badges, artisans, officer dashboards, the
// leaderboards pairing panel). Their old addresses answer with one short page instead of an error. Only what the companion and
// the phone app sign-in need is kept (/auth/*, /me/companion, /me/connections) plus /me/ itself, /me/data and the recruitment pages.
export const RETIRED_TOOLS = /^\/me\/(?:calendar|reserves|wishlist|battlenet|badges|artisans|roster|history|teams|groups|crafters|handover|raid-plans|statistics|guild-bank|pair|achievements\.png)(?:\/.*)?$/;
export const retiredToolsRoute: WebRoute = async (ctx, kit) => {
  if (!RETIRED_TOOLS.test(ctx.request.path)) return null;
  const { t, lang } = ctx;
  const body = `<h1>${t("These tools are not on the website", "Ces outils ne sont pas sur le site")}</h1>`
    + `<p>${t("Your characters, calendar, raid plans, loot lists, badges and guild tools live in Discord (ask your guild's bot with its commands), in the Guilded addon in the game, and in the Guilded phone app.", "Vos personnages, votre calendrier, vos plans de raid, vos listes de butin, vos badges et les outils de guilde sont dans Discord (les commandes du bot de votre guilde), dans l'addon Guilded en jeu et dans l'application mobile Guilded.")}</p>`
    + `<p><a class="button" href="${link("/leaderboards/", lang)}">${t("See the leaderboards", "Voir les classements")}</a></p>`;
  return kit.page(200, t("Tools moved", "Outils déplacés"), body, { noindex: true });
};

// Member-uploaded character pictures were removed on 20 November 2026 (the cards and pages use the WoW Armory picture). Old links and
// old clients get 410 Gone with a short message instead of a 404. The stored pictures stay in the database untouched.
export const RETIRED_PICTURES = /^\/(?:me|players)\/pictures(?:\/.*)?$|^\/api\/v1\/[a-z/-]*pictures?(?:\/.*)?$/;
export const retiredPicturesRoute: WebRoute = async (ctx, kit) => {
  if (!RETIRED_PICTURES.test(ctx.request.path)) return null;
  const { t } = ctx;
  const message = t("Character pictures were removed: Guilded now shows the character's WoW Armory picture.", "Les images de personnage ont été retirées : Guilded affiche maintenant l'image Armory du personnage.");
  if (ctx.request.path.startsWith("/api/")) {
    return { status: 410, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify({ error: "gone", message }) };
  }
  return { ...kit.page(410, t("Pictures removed", "Images retirées"), `<h1>${t("Pictures removed", "Images retirées")}</h1><p>${message}</p>`, { noindex: true }), status: 410 };
};
