import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebAccountView } from "./web-store.js";
import type { WebContext, WebRoute } from "./web-app.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { prismaDeviceStore } from "./companion-devices.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";

export function memberDataStore(database: PrismaClient, access: GuildDashboardAccess) {
  return async (account: WebAccountView) => {
    const guilds = await access.guilds(account.discordUserId);
    const ids = guilds.map(guild => guild.id);
    const [profile, devices, characters, signups, recapSchedules] = await Promise.all([
      database.webAccount.findUnique({ where: { id: account.id }, select: { publicProfile: true } }),
      prismaDeviceStore(database).list(account),
      database.character.findMany({ where: { member: { discordUserId: account.discordUserId, guildId: { in: ids } } },
        select: { name: true, realm: true, gameEdition: true, isMain: true, member: { select: { guildId: true } } }, take: 101, orderBy: { id: "asc" } }),
      database.raidSignup.findMany({ where: { member: { discordUserId: account.discordUserId, guildId: { in: ids } }, raid: { isTest: false, guildId: { in: ids } } },
        select: { status: true, role: true, signedUpAt: true, raid: { select: { title: true, scheduledAt: true, guildId: true } } },
        take: 101, orderBy: { signedUpAt: "desc" } }),
      database.recurringRecap.findMany({ where: { guildId: { in: ids }, member: { discordUserId: account.discordUserId } },
        select: { guildId: true, settings: true, enabled: true, status: true, lastAttemptAt: true }, take: 100 })
    ]);
    return { publicProfile: profile?.publicProfile ?? null, guilds, recapSchedules,
      devices: devices.map(({ name, kind, scope, createdAt }) => ({ name, kind, scope, createdAt })),
      characters: characters.slice(0, 100).map(({ member, ...character }) => ({ ...character, guildId: member.guildId })),
      recentSignups: signups.slice(0, 100), limited: characters.length > 100 || signups.length > 100 };
  };
}

type Snapshot = Awaited<ReturnType<ReturnType<typeof memberDataStore>>>;
export function createMemberData(load: (account: WebAccountView) => Promise<Snapshot>) {
  const path = "/me/data";
  const meSection = async (ctx: WebContext) => `<h2>${ctx.t("Your data", "Vos données")}</h2><p><a href="${link(path, ctx.lang)}">${ctx.t("Visibility, devices, history and export", "Visibilité, appareils, historique et exportation")}</a></p>`;
  const route: WebRoute = async (ctx, kit) => {
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
      const visibility = data.publicProfile === null ? t("Unknown", "Inconnue") : data.publicProfile ? t("Public", "Publique") : t("Private", "Privée");
      const statuses: Record<string, string> = { SIGNED_UP: t("Confirmed", "Confirmé"), MAYBE: t("Tentative", "Peut-être"), WAITLISTED: t("Waitlisted", "Liste d’attente"), CANCELLED: t("Declined", "Décliné") };
      const roles: Record<string, string> = { TANK: t("Tank", "Tank"), HEALER: t("Healer", "Soigneur"), DPS: "DPS" };
      const signupStatus = (status: string) => statuses[status] ?? t("Unknown", "Inconnu");
      const role = (value: string) => roles[value] ?? t("Unknown", "Inconnu");
      const body = `<h1>${title}</h1><p>${t("This private view changes no sharing settings. Guild records are shown only where your current membership can be verified.", "Cette vue privée ne modifie aucun partage. Les données de guilde sont affichées uniquement lorsque votre appartenance actuelle est vérifiée.")}</p>`
        + `<h2>${t("Profile visibility", "Visibilité du profil")}: ${visibility}</h2><p><a href="${link("/me/", lang)}">${t("Manage my public profile and recruitment card", "Gérer mon profil public et ma fiche de recrutement")}</a></p>`
        + `<h2>${t("Devices", "Appareils")} (${data.devices.length})</h2><p><a href="${link("/me/connections", lang)}">${t("Review and manage individual connections", "Vérifier et gérer chaque connexion")}</a> · <a href="${link("/me/battlenet", lang)}">Battle.net</a></p>`
        + `<h2>${t("Private recap delivery", "Envoi du bilan privé")}</h2><p>${t("Manage or pause in your guild: /automation recap. Automatic delivery is off unless you opt in.", "Gérez ou suspendez dans votre guilde : /automation recap. L'envoi automatique est désactivé sans votre accord.")}</p><ul>${data.recapSchedules.map(row => `<li>${h(data.guilds.find(g => g.id === row.guildId)?.name ?? row.guildId)} · ${row.enabled ? "ON" : "OFF"} · ${h(row.status)}</li>`).join("") || `<li>${t("No recurring recap configured.", "Aucun bilan récurrent configuré.")}</li>`}</ul>`
        + `<h2>${t("My linked guild characters", "Mes personnages liés en guilde")}</h2><ul>${data.characters.map(row => `<li>${h(row.name)} · ${h(row.realm)} · ${h(row.gameEdition)} · ${h(data.guilds.find(guild => guild.id === row.guildId)?.name ?? row.guildId)}</li>`).join("") || `<li>${t("No visible linked characters. Membership may be unavailable; retry when Discord is reachable.", "Aucun personnage lié visible. L'appartenance peut être indisponible; réessayez lorsque Discord est accessible.")}</li>`}</ul>`
        + `<h2>${t("My recent raid signup history", "Mon historique récent d’inscriptions")}</h2><ul>${data.recentSignups.map(row => `<li>${h(row.raid.title)} · ${h(row.raid.scheduledAt.toISOString())} · ${h(signupStatus(row.status))} · ${h(role(row.role))}</li>`).join("") || `<li>${t("No visible raid signups.", "Aucune inscription visible.")}</li>`}</ul>`
        + `<h2>${t("Export and retention", "Exportation et conservation")}</h2><p>${t("Download the records displayed here (up to 100 characters and 100 recent signups). This is a visible-data summary, not a complete archive or recovery backup.", "Téléchargez les données affichées ici (jusqu’à 100 personnages et 100 inscriptions récentes). Ce résumé des données visibles n’est ni une archive complète ni une sauvegarde de récupération.")}</p>`
        + (data.limited ? `<p class="notice">${t("More records exist than this view includes.", "D’autres données existent au-delà de cette vue.")}</p>` : "")
        + `<p><a class="button" href="${link(path, lang, { download: "json" })}">${t("Download visible data", "Télécharger les données visibles")}</a> · <a href="/docs/PRIVACY.html">${t("Retention and deletion policy", "Politique de conservation et de suppression")}</a></p>`
        + `<p>${t("Disconnecting a device does not delete game files or guild history. Follow the privacy policy’s contact process for records outside these controls; retained backups have their own retention.", "Déconnecter un appareil ne supprime ni les fichiers du jeu ni l’historique de guilde. Suivez la procédure de contact de la politique de confidentialité pour les données hors de ces contrôles; les sauvegardes ont leur propre conservation.")}</p>`;
      return kit.page(200, title, body, { noindex: true });
    } catch { return kit.page(503, title, t("Your data could not be loaded. Retry when the service is available.", "Impossible de charger vos données. Réessayez lorsque le service sera disponible."), { noindex: true }); }
  };
  return { route, meSection };
}
