import type { PrismaClient } from "../generated/prisma/client.js";
import { HIDE_DELAY_MINUTES, isProfileHidden, setProfileHidden } from "./profile-privacy.js";
import { escapeHtml, link } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

// The website's side of "hide my profile" (profile-privacy.ts): a switch on /me/ (Account). The form's CSRF token and origin are checked by
// the web app before any route sees the POST. The same switch is /character privacy in Discord.

type Db = Pick<PrismaClient, "publicProfileHidden">;

export function createPrivacyWeb(db: Db): { route: WebRoute; meSection: (ctx: WebContext) => Promise<string> } {
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== "/me/privacy" || ctx.request.method !== "POST" || !ctx.account) return null;
    await setProfileHidden(db, ctx.account.discordUserId, ctx.form?.get("hidden") === "1");
    return kit.redirect(link("/me/", ctx.lang, { done: "privacy" }));
  };
  async function meSection(ctx: WebContext): Promise<string> {
    if (!ctx.account) return "";
    const { t, lang } = ctx;
    const hidden = await isProfileHidden(db, ctx.account.discordUserId);
    const done = ctx.request.query.get("done") === "privacy" ? `<p class="notice">${t(`Saved. Public pages catch up within about ${HIDE_DELAY_MINUTES} minutes.`, `Enregistré. Les pages publiques se mettent à jour en ${HIDE_DELAY_MINUTES} minutes environ.`)}</p>` : "";
    return `<h2>${t("Public pages", "Pages publiques")}</h2>${done}`
      + `<p>${hidden
        ? t("Your profile is <strong>hidden</strong> on the public pages: directory, leaderboards, player and character pages, dungeon and duel listings. In a public run or duel you show as “Hidden player”.", "Votre profil est <strong>masqué</strong> sur les pages publiques : annuaire, classements, pages de joueur et de personnage, donjons et duels. Dans un donjon ou un duel public, vous apparaissez comme « Joueur masqué ».")
        : t("Your profile is <strong>public</strong> (the default): your linked characters appear in the directory, leaderboards and public run and duel listings.", "Votre profil est <strong>public</strong> (par défaut) : vos personnages liés apparaissent dans l'annuaire, les classements et les listes publiques de donjons et de duels.")}</p>`
      + `<form method="post" action="/me/privacy"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}">`
      + `<input type="hidden" name="hidden" value="${hidden ? "0" : "1"}"><button class="button" type="submit">${hidden ? t("Show my profile again", "Afficher de nouveau mon profil") : t("Hide my profile", "Masquer mon profil")}</button></form>`;
  }
  return { route, meSection };
}
