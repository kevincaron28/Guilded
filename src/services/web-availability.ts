import type { WebContext, WebRoute } from "./web-app.js";
import { checkCsrf, sameOrigin } from "./web-auth.js";
import { escapeHtml as h, link, options, SECURITY_HEADERS } from "./web-layout.js";
import { AVAILABILITY_MINUTES, AVAILABILITY_ROLES, type AvailabilityStore } from "./web-availability-store.js";

const PATH = "/me/availability";
export function createWebAvailability(store: AvailabilityStore) {
  const meSection = async (ctx: WebContext) => ctx.account ? `<h2>${ctx.t("Who's free?", "Qui est disponible ?")}</h2><p><a href="${h(link(PATH, ctx.lang))}">${ctx.t("Share availability with your guild", "Partager votre disponibilité avec la guilde")}</a></p>` : "";
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== PATH) return null;
    if (!["GET", "HEAD", "POST"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD, POST" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx, user = ctx.account.discordUserId, guildId = ctx.request.query.get("guild") ?? "";
    const title = t("Who's free?", "Qui est disponible ?");
    if (guildId.length > 64) return kit.page(400, title, t("Invalid guild.", "Guilde invalide."), { noindex: true });
    if (ctx.request.method === "POST" && (!guildId || !ctx.auth || !ctx.form || !sameOrigin(ctx.request.headers, ctx.auth.siteUrl) || !checkCsrf(ctx.auth.sessionSecret, ctx.sessionToken, ctx.form.get("csrf") ?? undefined))) return kit.page(403, title, t("Reload this page and try again.", "Rechargez cette page et réessayez."), { noindex: true });
    try {
      if (ctx.request.method === "POST") {
        if (ctx.form!.get("intent") === "revoke") {
          await store.revoke(user, guildId);
          return kit.page(200, title, `<h1>${title}</h1><p>${t("Your shared availability has been removed.", "Votre disponibilité partagée a été supprimée.")}</p><a href="${h(link(PATH, lang))}">${t("Choose a guild", "Choisir une guilde")}</a>`, { noindex: true });
        }
        const role = ctx.form!.get("role") ?? "", duration = ctx.form!.get("minutes") ?? "", character = ctx.form!.get("character") ?? "";
        if (ctx.form!.get("intent") !== "share" || ctx.form!.get("consent") !== "yes" || !character || character.length > 64
          || !AVAILABILITY_ROLES.includes(role as typeof AVAILABILITY_ROLES[number]) || !AVAILABILITY_MINUTES.map(String).includes(duration)) return kit.page(400, title, t("Choose your character, role and duration, and confirm sharing.", "Choisissez votre personnage, rôle et durée, puis confirmez le partage."), { noindex: true });
        await store.share(user, guildId, character, role, Number(duration), ctx.now);
        return kit.redirect(link(PATH, lang, { guild: guildId }));
      }
      if (!guildId) {
        const guilds = await store.guilds(user);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose a guild. Your current membership is checked each time.", "Choisissez une guilde. Votre adhésion actuelle est vérifiée à chaque visite.")}</p><ul>${guilds.map(guild => `<li><a href="${h(link(PATH, lang, { guild: guild.id, edition: guild.edition }))}">${h(guild.name)} · ${h(guild.edition)}</a></li>`).join("")}</ul>`, { noindex: true });
      }
      const csrf = `<input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}">`;
      const action = h(link(PATH, lang, { guild: guildId }));
      const revoke = `<form method="post" action="${action}">${csrf}<button class="button" name="intent" value="revoke">${t("Stop sharing my availability", "Arrêter le partage de ma disponibilité")}</button></form>`;
      const snapshot = await store.load(user, guildId, ctx.now);
      if (!snapshot) return kit.page(403, title, `<p>${t("Current guild membership is required to view or share availability. You can still remove your earlier post.", "Une adhésion actuelle est requise pour voir ou partager les disponibilités. Vous pouvez toujours supprimer votre ancienne annonce.")}</p>${revoke}`, { noindex: true });
      const roles: Record<string, string> = { ANY: t("Any role", "Tout rôle"), TANK: t("Tank", "Tank"), HEALER: t("Healer", "Soigneur"), DPS: t("Damage", "Dégâts") };
      return kit.page(200, title, `<h1>${title}</h1><p><strong>${h(snapshot.guild.name)}</strong> · ${h(snapshot.guild.edition)}</p><p class="notice">${t("Voluntary self-reports, visible only to current members of this guild and edition. This does not prove someone is online or free in game. Refresh to check current posts. The addon’s local presence is separate and is never uploaded here.", "Déclarations volontaires, visibles uniquement aux membres actuels de cette guilde et édition. Elles ne prouvent pas qu'une personne est en ligne ou disponible en jeu. Actualisez les annonces. La présence locale de l'addon reste séparée et n'est jamais téléversée ici.")}</p>`
        + `<p><a href="${action}">${t("Refresh availability", "Actualiser les disponibilités")}</a> · <a href="${h(link(PATH, lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a></p>`
        + (snapshot.truncated ? `<p>${t("Showing the first 100 posts; refresh for changes.", "Les 100 premières annonces sont affichées; actualisez pour les changements.")}</p>` : "")
        + `<ul>${snapshot.rows.map(row => `<li>${h(row.character.name)} · ${h(row.character.realm)} · ${h(roles[row.role] ?? row.role)} · ${t("until", "jusqu'à")} <time datetime="${row.expiresAt.toISOString()}">${row.expiresAt.toISOString().replace("T", " ").replace(".000Z", " UTC")}</time>${row.mine ? ` (${t("you", "vous")})` : ""}</li>`).join("") || `<li>${t("No current availability posts.", "Aucune disponibilité actuellement partagée.")}</li>`}</ul>`
        + (snapshot.characters.length ? `<h2>${t("Share my availability", "Partager ma disponibilité")}</h2><form method="post" action="${action}">${csrf}<input type="hidden" name="intent" value="share"><label for="free-character">${t("My character", "Mon personnage")}</label><select id="free-character" name="character">${options(snapshot.characters.map(c => ({ value: c.id, label: `${c.name} · ${c.realm}` })), "")}</select><label for="free-role">${t("Role", "Rôle")}</label><select id="free-role" name="role">${options(AVAILABILITY_ROLES.map(value => ({ value, label: roles[value]! })), "ANY")}</select><label for="free-minutes">${t("Expires after", "Expire après")}</label><select id="free-minutes" name="minutes">${options(AVAILABILITY_MINUTES.map(value => ({ value: String(value), label: `${value} min` })), "15")}</select><label><input type="checkbox" name="consent" value="yes" required> ${t("Share this character and role with current members until expiry. I can remove it at any time.", "Partager ce personnage et ce rôle avec les membres actuels jusqu'à expiration. Je peux retirer l'annonce à tout moment.")}</label><button class="button">${t("Share availability", "Partager la disponibilité")}</button></form>` : `<p>${t("Link your own character before sharing availability.", "Liez votre propre personnage avant de partager votre disponibilité.")}</p>`)
        + revoke + `<p>${t("Expired posts are hidden immediately and deleted by housekeeping within six hours of normal operation. No availability history is kept in the app; routine backups follow their existing retention.", "Les annonces expirées sont masquées immédiatement et supprimées par le nettoyage dans les six heures en fonctionnement normal. L'application ne conserve pas d'historique de disponibilité; les sauvegardes suivent leur conservation habituelle.")}</p>`, { noindex: true, languageParams: { guild: guildId, edition: snapshot.guild.edition } });
    } catch { return kit.page(503, title, t("Availability could not be updated or loaded. Refresh to check the current state.", "Impossible de charger ou modifier les disponibilités. Actualisez pour vérifier l'état actuel."), { noindex: true }); }
  };
  return { route, meSection };
}
