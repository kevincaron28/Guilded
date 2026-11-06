import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebAccountView } from "./web-store.js";
import type { WebContext, WebRoute } from "./web-app.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { prismaDeviceStore } from "./companion-devices.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import { checkCsrf, sameOrigin } from "./web-auth.js";
import { DELETE_CONFIRM_WORD, type DeletionSummary } from "./data-deletion.js";

export function memberDataStore(database: PrismaClient, access: GuildDashboardAccess) {
  return async (account: WebAccountView) => {
    const guilds = await access.guilds(account.discordUserId);
    const ids = guilds.map(guild => guild.id);
    const [devices, characters, signups, recapSchedules, battlegroundReports] = await Promise.all([
      prismaDeviceStore(database).list(account),
      database.character.findMany({ where: { member: { discordUserId: account.discordUserId, guildId: { in: ids } } },
        select: { name: true, realm: true, gameEdition: true, isMain: true, member: { select: { guildId: true } } }, take: 101, orderBy: { id: "asc" } }),
      database.raidSignup.findMany({ where: { member: { discordUserId: account.discordUserId, guildId: { in: ids } }, raid: { isTest: false, guildId: { in: ids } } },
        select: { status: true, role: true, signedUpAt: true, raid: { select: { title: true, scheduledAt: true, guildId: true } } },
        take: 101, orderBy: { signedUpAt: "desc" } }),
      database.recurringRecap.findMany({ where: { guildId: { in: ids }, member: { discordUserId: account.discordUserId } },
        select: { guildId: true, settings: true, enabled: true, status: true, lastAttemptAt: true }, take: 100 }),
      database.battlegroundReport.findMany({ where: { guildId: { in: ids }, member: { discordUserId: account.discordUserId } },
        select: { guildId: true, reportId: true, gameEdition: true, mode: true, mapId: true, bracket: true, endedAt: true,
          outcome: true, presence: true, status: true, correctionReason: true }, orderBy: { endedAt: "desc" }, take: 101 })
    ]);
    return { guilds, recapSchedules,
      battlegroundReports: battlegroundReports.slice(0, 100),
      devices: devices.map(({ name, kind, scope, createdAt }) => ({ name, kind, scope, createdAt })),
      characters: characters.slice(0, 100).map(({ member, ...character }) => ({ ...character, guildId: member.guildId })),
      recentSignups: signups.slice(0, 100), limited: characters.length > 100 || signups.length > 100 || battlegroundReports.length > 100 };
  };
}

type Snapshot = Awaited<ReturnType<ReturnType<typeof memberDataStore>>>;
export function createMemberData(load: (account: WebAccountView) => Promise<Snapshot>, erase?: (discordUserId: string) => Promise<DeletionSummary>) {
  const path = "/me/data";
  const meSection = async (ctx: WebContext) => `<h2>${ctx.t("Your data", "Vos données")}</h2><p><a href="${link(path, ctx.lang)}">${ctx.t("Visibility, devices, history and export", "Visibilité, appareils, historique et exportation")}</a></p>`;
  const deletePath = "/me/data/delete";
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path === deletePath && erase) {
      if (!ctx.account) return kit.signInPrompt();
      const { t: tr, lang: language } = ctx, heading = tr("Your data", "Vos données");
      if (ctx.request.method !== "POST") return { status: 405, headers: { ...SECURITY_HEADERS, allow: "POST" }, body: "" };
      if (!ctx.auth || !ctx.form || !sameOrigin(ctx.request.headers, ctx.auth.siteUrl) || !checkCsrf(ctx.auth.sessionSecret, ctx.sessionToken, ctx.form.get("csrf") ?? undefined))
        return kit.page(403, heading, tr("Reload the page and try again.", "Rechargez la page et réessayez."), { noindex: true });
      if ((ctx.form.get("confirm") ?? "").trim() !== DELETE_CONFIRM_WORD)
        return kit.page(400, heading, `<p>${tr(`Type ${DELETE_CONFIRM_WORD} in the box to confirm.`, `Tapez ${DELETE_CONFIRM_WORD} dans la case pour confirmer.`)}</p><p><a href="${link(path, language)}">${tr("Back", "Retour")}</a></p>`, { noindex: true });
      try {
        const done = await erase(ctx.account.discordUserId);
        return kit.page(200, heading, `<h1>${tr("Your data was deleted", "Vos données ont été supprimées")}</h1><p>${tr(`Removed your website account, ${done.characters} guild character(s) and your personal records from ${done.members} guild(s). Points, loot and raid history stay in each guild as "Deleted member". Backups and Discord messages already posted are not changed (see the privacy notice).`, `Votre compte du site, ${done.characters} personnage(s) de guilde et vos données personnelles dans ${done.members} guilde(s) ont été supprimés. Les points, le butin et l'historique de raid restent dans chaque guilde sous « Deleted member ». Les sauvegardes et les messages Discord déjà publiés ne sont pas modifiés (voir l'avis de confidentialité).`)}</p>`, { noindex: true });
      } catch { return kit.page(503, heading, tr("The deletion could not be completed. Try again, or ask for it in the Guilded support community.", "La suppression n'a pas pu être effectuée. Réessayez, ou demandez-la dans la communauté de soutien Guilded."), { noindex: true }); }
    }
    if (ctx.request.path !== path) return null;
    if (!ctx.account) return kit.signInPrompt();
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    const { t, lang } = ctx, title = t("Your data", "Vos données");
    try {
      // Identity comes only from the authenticated session, never query parameters.
      const data = await load(ctx.account);
      if (ctx.request.query.get("download") === "json") return { status: 200, headers: { ...SECURITY_HEADERS,
        "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="Guilded-visible-data.json"' },
        body: JSON.stringify({ schemaVersion: 1, generatedAt: ctx.now.toISOString(), scope: "Visible account summary; not a complete archive or backup", ...data }, null, 2) };
      const statuses: Record<string, string> = { SIGNED_UP: t("Confirmed", "Confirmé"), MAYBE: t("Tentative", "Peut-être"), WAITLISTED: t("Waitlisted", "Liste d’attente"), CANCELLED: t("Declined", "Décliné") };
      const roles: Record<string, string> = { TANK: t("Tank", "Tank"), HEALER: t("Healer", "Soigneur"), DPS: "DPS" };
      const signupStatus = (status: string) => statuses[status] ?? t("Unknown", "Inconnu");
      const role = (value: string) => roles[value] ?? t("Unknown", "Inconnu");
      const body = `<h1>${title}</h1><p>${t("Everything Guilded records about you is shared; there are no sharing settings. Guild records are shown only where your current membership can be verified.", "Tout ce que Guilded enregistre sur vous est partagé; il n'y a aucun réglage de partage. Les données de guilde sont affichées uniquement lorsque votre appartenance actuelle est vérifiée.")}</p>`
        + `<h2>${t("Public profile", "Profil public")}</h2><p><a href="${link("/me/", lang)}">${t("Manage my public profile and recruitment card", "Gérer mon profil public et ma fiche de recrutement")}</a></p>`
        + `<h2>${t("Devices", "Appareils")} (${data.devices.length})</h2><p><a href="${link("/me/connections", lang)}">${t("Review and manage individual connections", "Vérifier et gérer chaque connexion")}</a> · <a href="${link("/me/battlenet", lang)}">Battle.net</a></p>`
        + `<h2>${t("Private recap delivery", "Envoi du bilan privé")}</h2><p>${t("Manage or pause in your guild: /automation recap. Automatic delivery is off unless you opt in.", "Gérez ou suspendez dans votre guilde : /automation recap. L'envoi automatique est désactivé sans votre accord.")}</p><ul>${data.recapSchedules.map(row => `<li>${h(data.guilds.find(g => g.id === row.guildId)?.name ?? row.guildId)} · ${row.enabled ? "ON" : "OFF"} · ${h(row.status)}</li>`).join("") || `<li>${t("No recurring recap configured.", "Aucun bilan récurrent configuré.")}</li>`}</ul>`
        + `<h2>${t("Battleground reports", "Rapports JcJ")}</h2><p>${t("Everything is shared: review /bg history and withdraw incorrect evidence with /bg correct. Up to 100 recent own reports are included in this export.", "Tout est partagé : consultez /bg history et retirez une preuve erronée avec /bg correct. Jusqu'à 100 rapports récents sont inclus dans cette exportation.")}</p>`
        + `<h2>${t("My linked guild characters", "Mes personnages liés en guilde")}</h2><ul>${data.characters.map(row => `<li>${h(row.name)} · ${h(row.realm)} · ${h(row.gameEdition)} · ${h(data.guilds.find(guild => guild.id === row.guildId)?.name ?? row.guildId)}</li>`).join("") || `<li>${t("No visible linked characters. Membership may be unavailable; retry when Discord is reachable.", "Aucun personnage lié visible. L'appartenance peut être indisponible; réessayez lorsque Discord est accessible.")}</li>`}</ul>`
        + `<h2>${t("My recent raid signup history", "Mon historique récent d’inscriptions")}</h2><ul>${data.recentSignups.map(row => `<li>${h(row.raid.title)} · ${h(row.raid.scheduledAt.toISOString())} · ${h(signupStatus(row.status))} · ${h(role(row.role))}</li>`).join("") || `<li>${t("No visible raid signups.", "Aucune inscription visible.")}</li>`}</ul>`
        + `<h2>${t("Export and retention", "Exportation et conservation")}</h2><p>${t("Download the records displayed here (up to 100 characters and 100 recent signups). This is a visible-data summary, not a complete archive or recovery backup.", "Téléchargez les données affichées ici (jusqu’à 100 personnages et 100 inscriptions récentes). Ce résumé des données visibles n’est ni une archive complète ni une sauvegarde de récupération.")}</p>`
        + (data.limited ? `<p class="notice">${t("More records exist than this view includes.", "D’autres données existent au-delà de cette vue.")}</p>` : "")
        + `<p><a class="button" href="${link(path, lang, { download: "json" })}">${t("Download visible data", "Télécharger les données visibles")}</a> · <a href="/docs/PRIVACY.html">${t("Retention and deletion policy", "Politique de conservation et de suppression")}</a></p>`
        + `<p>${t("Disconnecting a device does not delete game files or guild history. Follow the privacy policy’s contact process for records outside these controls; retained backups have their own retention.", "Déconnecter un appareil ne supprime ni les fichiers du jeu ni l’historique de guilde. Suivez la procédure de contact de la politique de confidentialité pour les données hors de ces contrôles; les sauvegardes ont leur propre conservation.")}</p>`;
      const deleteForm = erase ? `<h2>${t("Delete my data", "Supprimer mes données")}</h2><p>${t("This removes your website account, your guild characters and your personal records (battleground reports, achievements, recap schedule, devices). Points, loot and raid history stay in each guild as \"Deleted member\". It cannot be undone.", "Cela supprime votre compte du site, vos personnages de guilde et vos données personnelles (rapports JcJ, succès, bilans, appareils). Les points, le butin et l'historique de raid restent dans chaque guilde sous « Deleted member ». Action irréversible.")}</p><form method="post" action="${link(deletePath, lang)}"><input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}"><label>${t(`Type ${DELETE_CONFIRM_WORD} to confirm`, `Tapez ${DELETE_CONFIRM_WORD} pour confirmer`)} <input name="confirm" autocomplete="off" required></label> <button class="button" type="submit">${t("Delete my data", "Supprimer mes données")}</button></form>` : "";
      return kit.page(200, title, body + deleteForm, { noindex: true });
    } catch { return kit.page(503, title, t("Your data could not be loaded. Retry when the service is available.", "Impossible de charger vos données. Réessayez lorsque le service sera disponible."), { noindex: true }); }
  };
  return { route, meSection };
}
