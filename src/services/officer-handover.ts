import type { PrismaClient } from "../generated/prisma/client.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";

export function officerHandoverStore(db: PrismaClient, access: GuildDashboardAccess) {
  return {
    guilds: access.guilds,
    async load(user: string, guildId: string, now: Date) {
      const guild = await access.authorize(user, guildId);
      if (!guild) return null;
      const since = new Date(now.getTime() - 7 * 86_400_000);
      const [changes, pendingImports, applications, raids, jobs] = await Promise.all([
        // Deliberately select no audit metadata: it can contain private payloads.
        db.auditLog.findMany({ where: { guildId, createdAt: { gte: since } }, select: { action: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 }),
        db.addonImport.count({ where: { guildId, status: "PREVIEWED" } }),
        db.application.count({ where: { guildId, status: "PENDING" } }),
        db.raid.findMany({ where: { guildId, isTest: false, status: "PLANNED", scheduledAt: { gte: now } },
          select: { title: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" }, take: 11 }),
        db.discordJob.findMany({ where: { guildId, status: "PENDING" }, select: { kind: true, attempts: true, nextAttemptAt: true, lockedUntil: true },
          orderBy: { nextAttemptAt: "asc" }, take: 101 })
      ]);
      return { guild, since, changes: changes.slice(0, 100), pendingImports, applications, raids: raids.slice(0, 10), jobs: jobs.slice(0, 100),
        limited: changes.length > 100 || raids.length > 10 || jobs.length > 100 };
    }
  };
}

export function createOfficerHandover(store: ReturnType<typeof officerHandoverStore>) {
  const path = "/me/handover";
  const meSection = async (ctx: WebContext) => `<h2>${ctx.t("Officer handover", "Relève des officiers")}</h2><p><a href="${link(path, ctx.lang)}">${ctx.t("Review recent changes and pending work", "Réviser les changements et tâches en attente")}</a></p>`;
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== path) return null;
    if (!ctx.account) return kit.signInPrompt();
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    const { t, lang } = ctx, title = t("Officer handover", "Relève des officiers");
    const guildId = ctx.request.query.get("guild") ?? "";
    if (guildId.length > 64) return kit.page(400, title, t("Invalid guild.", "Guilde invalide."), { noindex: true });
    try {
      if (!guildId) {
        const guilds = await store.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><ul>${guilds.map(g => `<li><a href="${h(link(path, lang, { guild: g.id }))}">${h(g.name)} · ${h(g.edition)}</a></li>`).join("") || `<li>${t("No verified officer access. Check your role and Discord availability, then refresh.", "Aucun accès d’officier vérifié. Vérifiez votre rôle et la disponibilité de Discord, puis actualisez.")}</li>`}</ul>`, { noindex: true });
      }
      const data = await store.load(ctx.account.discordUserId, guildId, ctx.now);
      if (!data) return kit.page(403, title, t("Current officer access could not be verified.", "Votre accès actuel d’officier n’a pas pu être vérifié."), { noindex: true });
      const actionLabels: Record<string, string> = {
        MEMBER_CREATED: t("Member added", "Membre ajouté"), MEMBER_UPDATED: t("Member updated", "Membre modifié"),
        CONFIG_UPDATED: t("Settings changed", "Configuration modifiée"), IMPORT_PREVIEWED: t("Import reviewed", "Importation révisée"), IMPORT_APPLIED: t("Import applied", "Importation appliquée"),
        DKP_TRANSACTION_CREATED: t("Points recorded", "Points enregistrés"), DKP_TRANSACTION_REVERSED: t("Points reversed", "Points annulés"), EPGP_TRANSACTION_CREATED: t("EP/GP recorded", "EP/GP enregistrés"),
        READINESS_SNAPSHOT_RECORDED: t("Readiness recorded", "Préparation enregistrée"), DUNGEON_ADMIN: t("Dungeon administration", "Administration des donjons")
      };
      const jobState = (job: typeof data.jobs[number]) => job.lockedUntil && job.lockedUntil > ctx.now ? t("Delivery in progress", "Envoi en cours")
        : job.attempts > 0 ? t("Retry scheduled", "Nouvelle tentative prévue") : job.nextAttemptAt > ctx.now ? t("Scheduled; not attempted yet", "Planifié; aucune tentative") : t("Ready to send", "Prêt à envoyer");
      const body = `<h1>${title}</h1><p>${h(data.guild.name)} · ${h(data.guild.edition)} · ${t("Snapshot", "Instantané")} ${h(ctx.now.toISOString())}</p>`
        + `<p>${t("Read-only review for this guild. Refresh before acting; this is not a complete audit or a recovery backup. No messages, points or settings are changed here.", "Révision en lecture seule pour cette guilde. Actualisez avant d’agir; ce n’est ni un audit complet ni une sauvegarde. Aucun message, point ou réglage n’est modifié ici.")}</p>`
        + `<h2>${t("Pending work", "Travail en attente")}</h2><ul><li>${t("Imports awaiting review", "Importations à réviser")}: ${data.pendingImports}</li><li>${t("Applications awaiting review", "Candidatures à réviser")}: ${data.applications}</li></ul>`
        + `<h2>${t("Next raids", "Prochains raids")}</h2><ul>${data.raids.map(r => `<li>${h(r.title)} · ${h(r.scheduledAt.toISOString())}</li>`).join("") || `<li>${t("No upcoming planned raids.", "Aucun raid planifié à venir.")}</li>`}</ul>`
        + `<h2>${t("Delivery queue", "File d’envoi")}</h2><ul>${data.jobs.map(j => `<li>${h(j.kind)} · ${jobState(j)} · ${h(j.nextAttemptAt.toISOString())}</li>`).join("") || `<li>${t("No pending deliveries.", "Aucun envoi en attente.")}</li>`}</ul>`
        + `<h2>${t("Recorded changes: last 7 days", "Changements enregistrés : 7 derniers jours")}</h2><ol>${data.changes.map(c => `<li>${h(c.createdAt.toISOString())} · ${h(actionLabels[c.action] ?? t("Moderation action", "Action de modération"))}</li>`).join("") || `<li>${t("No recorded changes in this window; this does not prove that nothing changed.", "Aucun changement enregistré dans cette période; cela ne prouve pas l’absence de changements.")}</li>`}</ol>`
        + (data.limited ? `<p class="notice">${t("Partial view: at most 100 changes, 100 deliveries and 10 raids. Review the full records in the existing officer tools.", "Vue partielle : au plus 100 changements, 100 envois et 10 raids. Consultez les outils d’officier pour les dossiers complets.")}</p>` : "")
        + `<h2>${t("Recovery handover", "Relève et récupération")}</h2><p>${t("Use /setup system status to review system health. Before a migration or recovery, have the host operator confirm the backup timestamp and a successful restore rehearsal. Backup existence alone is not proof of recovery; this page does not inspect or restore host backups.", "Utilisez /setup system status pour vérifier le système. Avant une migration ou récupération, demandez à l’administrateur de confirmer la date de sauvegarde et un essai de restauration réussi. L’existence d’une sauvegarde ne prouve pas sa récupération; cette page ne lit ni ne restaure les sauvegardes de l’hôte.")}</p>`
        + `<p><a href="/officers/?lang=${lang}">${t("Existing officer tools and procedures", "Outils et procédures des officiers")}</a> · <a href="${h(link("/me/roster/review", lang, { guild: guildId }))}">${t("Review character changes", "Réviser les changements de personnages")}</a></p>`;
      return kit.page(200, title, body, { noindex: true });
    } catch { return kit.page(503, title, t("Handover unavailable. Retry when Discord and Guilded are reachable.", "Relève indisponible. Réessayez lorsque Discord et Guilded sont accessibles."), { noindex: true }); }
  };
  return { route, meSection };
}
