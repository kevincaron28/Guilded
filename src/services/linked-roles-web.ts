import type { PrismaClient } from "../generated/prisma/client.js";
import { clearCookie, parseCookies, type WebAuthConfig } from "./web-auth.js";
import {
  authorizeUrl, exchangeLinkedRolesCode, LINKED_ROLES_CALLBACK_PATH, LINKED_ROLES_COOKIE, LINKED_ROLES_PATH, loadProfile, newState,
  pushRoleConnection, stateMatches
} from "./linked-roles.js";
import { escapeHtml, link } from "./web-layout.js";
import type { WebRoute } from "./web-app.js";

// The two pages behind "Linked Roles Verification URL" (docs/LINKED_ROLES.md):
//   /auth/linked-roles            sends the member to Discord's consent screen
//   /auth/linked-roles/callback   reads the code, pushes the member's character to Discord, says what was shown

type Db = Parameters<typeof loadProfile>[0] & Pick<PrismaClient, "character">;

export function createLinkedRolesWeb(db: Db, auth: WebAuthConfig | null, fetcher: typeof fetch = fetch): { route: WebRoute } {
  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path;
    if (path !== LINKED_ROLES_PATH && path !== LINKED_ROLES_CALLBACK_PATH) return null;
    if (!auth) return kit.signInPrompt();
    const { t } = ctx;
    const failed = (status: number, title: string, text: string) => kit.page(status, title, `<h1>${title}</h1><p>${text}</p><p><a class="button" href="${LINKED_ROLES_PATH}">${t("Try again", "Réessayer")}</a></p>`, { noindex: true, cookies: [clearCookie(LINKED_ROLES_COOKIE)] });

    if (path === LINKED_ROLES_PATH) {
      const { state, cookie } = newState(auth, ctx.now);
      return kit.redirect(authorizeUrl(auth, state), [cookie]);
    }

    const state = ctx.request.query.get("state");
    const code = ctx.request.query.get("code");
    if (!stateMatches(auth, parseCookies(ctx.request.headers.cookie)[LINKED_ROLES_COOKIE], state, ctx.now)) {
      return failed(400, t("Link did not finish", "Le lien n'a pas abouti"), t("The link expired or was opened in another browser. Open it again from Discord.", "Le lien a expiré ou a été ouvert dans un autre navigateur. Ouvrez-le de nouveau depuis Discord."));
    }
    if (!code || code.length > 200) {
      return failed(400, t("Link was not completed", "Le lien n'a pas été terminé"), t("Discord did not send an approval. Try again and accept the permission Discord asks for.", "Discord n'a pas envoyé d'approbation. Réessayez et acceptez l'autorisation demandée par Discord."));
    }
    try {
      const { accessToken, userId } = await exchangeLinkedRolesCode(auth, code, fetcher);
      const profile = await loadProfile(db, userId, ctx.now);
      if (!profile) {
        return kit.page(200, t("No verified character yet", "Aucun personnage vérifié"),
          `<h1>${t("No verified character yet", "Aucun personnage vérifié")}</h1><p>${t("Guilded found no confirmed WoW Forever character for your Discord account. Link one with the Guilded companion, then open this link again.", "Guilded n'a trouvé aucun personnage WoW Forever confirmé pour votre compte Discord. Liez-en un avec l'application Guilded, puis rouvrez ce lien.")}</p><p><a class="button" href="${link("/me/", ctx.lang)}">${t("My Guilded", "Mon Guilded")}</a></p>`,
          { noindex: true, cookies: [clearCookie(LINKED_ROLES_COOKIE)] });
      }
      await pushRoleConnection(auth, accessToken, profile.connection, fetcher);
      const name = escapeHtml(profile.character);
      return kit.page(200, t("Linked", "Lié"),
        `<h1>${t("Linked", "Lié")}</h1><p>${t(`Your Discord profile now shows <strong>${name}</strong> (WoW Forever). Servers can give roles from it. Open this link again whenever your character changes.`, `Votre profil Discord affiche maintenant <strong>${name}</strong> (WoW Forever). Les serveurs peuvent s'en servir pour donner des rôles. Rouvrez ce lien quand votre personnage change.`)}</p>`,
        { noindex: true, cookies: [clearCookie(LINKED_ROLES_COOKIE)] });
    } catch {
      return failed(502, t("Discord did not confirm", "Discord n'a pas confirmé"), t("Discord refused or did not answer. Try again in a minute.", "Discord a refusé ou n'a pas répondu. Réessayez dans une minute."));
    }
  };
  return { route };
}
