import type { PrismaClient } from "../generated/prisma/client.js";
import { currentEdition } from "./edition-context.js";
import { PUG_EDITION_LABEL, pugRoleLabel } from "./pug-discord.js";
import { PUG_ROLES, PugError, publicPugRequests, signUpForPug, type PublicPugRequest } from "./pug-requests.js";
import { CLASSES } from "../wow-data.js";
import { escapeHtml as h, link } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

// "PUGs wanted": open requests from guilds that joined the cross-guild PUG board, for the visitor's
// WoW edition. Public to read; signing up needs Discord sign-in. The page shows the host guild's name,
// raid, time, open spots and note only: no internal ids, no sign-up details of other players.

export const PUG_PAGE = "/recruitment/pugs";

const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function createPugWeb(db: PrismaClient, allows: (discordGuildId: string) => boolean) {
  function card(ctx: WebContext, request: PublicPugRequest, signedIn: boolean): string {
    const { t, lang } = ctx;
    const spots = PUG_ROLES.filter(role => request.open[role] > 0).map(role => `${h(pugRoleLabel(role, lang))} ${request.open[role]}`).join(" · ");
    const form = signedIn
      ? `<form method="post" action="${h(link(PUG_PAGE, lang))}"><input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}"><input type="hidden" name="request" value="${h(request.id)}">
<label>${t("Role", "Rôle")} <select name="role">${PUG_ROLES.filter(role => request.open[role] > 0).map(role => `<option value="${role}">${h(pugRoleLabel(role, lang))}</option>`).join("")}</select></label>
<label>${t("Character", "Personnage")} <input name="character" required minlength="2" maxlength="24"></label>
<label>${t("Class", "Classe")} <select name="class"><option value="">—</option>${CLASSES.map(name => `<option>${h(name)}</option>`).join("")}</select></label>
<label>${t("Note", "Note")} <input name="note" maxlength="120"></label>
<button class="button" type="submit">${t("Sign up", "S'inscrire")}</button></form>`
      : `<p><a class="button" href="${h(link("/auth/login", lang, { return: link(PUG_PAGE, lang) }))}">${t("Sign in with Discord to sign up", "Connexion avec Discord pour s'inscrire")}</a></p>`;
    return `<article class="card"><h3>${h(request.raidTitle)}</h3><p class="tag">${t("Other guild's raid", "Raid d'une autre guilde")} · <strong>${h(request.guildName)}</strong></p>
<p><time datetime="${h(request.scheduledAt)}">${h(when(request.scheduledAt))}</time> · ${h(PUG_EDITION_LABEL[request.edition] ?? request.edition)}</p>
<p>${t("Spots open", "Places ouvertes")}: ${spots}</p>${request.note ? `<p>${h(request.note)}</p>` : ""}${form}</article>`;
  }

  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== PUG_PAGE) return null;
    const { t } = ctx;
    const title = t("PUGs wanted", "Joueurs externes recherchés");
    if (!["GET", "HEAD", "POST"].includes(ctx.request.method)) return { status: 405, headers: { allow: "GET, HEAD, POST" }, body: "" } as never;
    let notice = "";
    if (ctx.request.method === "POST") {
      if (!ctx.account) return kit.signInPrompt();
      try {
        await signUpForPug(db, { requestId: ctx.form?.get("request") ?? "", discordUserId: ctx.account.discordUserId, displayName: ctx.account.displayName ?? ctx.account.username,
          role: ctx.form?.get("role") ?? "", characterName: ctx.form?.get("character") ?? "", characterClass: ctx.form?.get("class") ?? null, note: ctx.form?.get("note") ?? null }, allows, ctx.now);
        notice = `<p class="notice">${t("Sent. The host guild's officers will accept or decline. You are not in their roster until they do; contact them in game.", "Envoyé. Les officiers de la guilde hôte accepteront ou refuseront. Vous n'êtes pas dans leur liste avant cela; contactez-les en jeu.")}</p>`;
      } catch (error) {
        if (!(error instanceof PugError)) throw error;
        notice = `<p class="notice">${h(error.message)}</p>`;
      }
    }
    const requests = await publicPugRequests(db, currentEdition(), allows, ctx.now);
    const body = `<h1>${title}</h1>${notice}<p>${t("Raids from guilds that joined the Guilded PUG board and want outside players. Each sign-up is approved by the host guild's officers; you only share your Discord name, character, class, role and note with them. Requests disappear when the raid starts or fills.", "Raids de guildes inscrites au tableau PUG de Guilded qui cherchent des joueurs externes. Chaque inscription est approuvée par les officiers de la guilde hôte; vous ne partagez avec eux que votre nom Discord, personnage, classe, rôle et note. Les demandes disparaissent au début du raid ou quand il est complet.")}</p>`
      + (requests.length ? `<div class="cards">${requests.map(request => card(ctx, request, Boolean(ctx.account))).join("")}</div>` : `<p class="muted">${t("No guild is asking for PUGs right now.", "Aucune guilde ne cherche de joueurs externes pour l'instant.")}</p>`);
    return kit.page(200, title, body, { noindex: true });
  };
  return { route };
}
