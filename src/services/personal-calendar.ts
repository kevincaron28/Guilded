import { createHash } from "node:crypto";
import { PermissionFlagsBits, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebAccountView } from "./web-store.js";
import type { WebContext, WebRoute } from "./web-app.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";

export interface PersonalCalendarEvent {
  id: string; title: string; at: Date; end?: Date; status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  context: string;
}
// RFC 5545 TEXT escaping and octet folding: never split a UTF-8 code point.
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
export function foldCalendarLine(value: string): string {
  let line = "", bytes = 0, output = "";
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) { output += line + "\r\n"; line = " "; bytes = 1; }
    line += char; bytes += size;
  }
  return output + line;
}
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function personalCalendarIcs(accountId: string, events: PersonalCalendarEvent[], generatedAt: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Guilded//Personal Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    const uid = createHash("sha256").update(`${accountId}:${event.id}`).digest("hex");
    lines.push("BEGIN:VEVENT", `UID:${uid}@guilded.kcaron.top`, `DTSTAMP:${utc(generatedAt)}`, `LAST-MODIFIED:${utc(generatedAt)}`,
      `DTSTART:${utc(event.at)}`, ...(event.end ? [`DTEND:${utc(event.end)}`] : []),
      `SUMMARY:${escapeText(event.title)}`, `DESCRIPTION:${escapeText(event.context)}`, `STATUS:${event.status}`, "END:VEVENT");
  }
  return [...lines, "END:VCALENDAR"].map(foldCalendarLine).join("\r\n") + "\r\n";
}

export function personalCalendarStore(database: PrismaClient, access: GuildDashboardAccess, client: Client | undefined) {
  return async (account: WebAccountView, now: Date) => {
    if (!client?.isReady()) throw new Error("Discord unavailable");
    const guilds = await access.guilds(account.discordUserId), ids = guilds.map(g => g.id);
    const since = new Date(now.getTime() - 90 * 86_400_000);
    const [raids, sessions] = await Promise.all([
      database.raidSignup.findMany({ where: { member: { discordUserId: account.discordUserId, guildId: { in: ids } },
        raid: { guildId: { in: ids }, isTest: false, scheduledAt: { gte: since } } },
        select: { status: true, raid: { select: { id: true, title: true, scheduledAt: true, status: true, signupChannelId: true, guildId: true, guild: { select: { discordId: true } } } } },
        orderBy: { raid: { scheduledAt: "asc" } }, take: 501 }),
      database.activityResponse.findMany({ where: { member: { discordUserId: account.discordUserId, guildId: { in: ids } },
        session: { core: { guildId: { in: ids } }, scheduledAt: { gte: since } } },
        select: { status: true, session: { select: { id: true, scheduledAt: true, endsAt: true, status: true,
          core: { select: { name: true, guildId: true, channelId: true, guild: { select: { discordId: true } } } } } } },
        orderBy: { session: { scheduledAt: "asc" } }, take: 501 })
    ]);
    const visible = new Map<string, Promise<boolean>>();
    function canView(discordId: string, channelId: string | null): Promise<boolean> {
      if (!channelId) return Promise.resolve(false);
      const key = `${discordId}:${channelId}`;
      if (!visible.has(key)) visible.set(key, (async () => {
        const guild = await client!.guilds.fetch(discordId);
        const member = await guild.members.fetch({ user: account.discordUserId, force: true });
        const channel = await guild.channels.fetch(channelId, { force: true });
        return !!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel);
      })());
      return visible.get(key)!;
    }
    const events: PersonalCalendarEvent[] = [];
    const status = (event: string, response: string): PersonalCalendarEvent["status"] =>
      event === "CANCELLED" || ["CANCELLED", "ABSENT", "DECLINED"].includes(response) ? "CANCELLED" : ["SIGNED_UP", "CONFIRMED"].includes(response) ? "CONFIRMED" : "TENTATIVE";
    const context = (guildId: string) => { const guild = guilds.find(g => g.id === guildId)!; return `${guild.name} · ${guild.edition}`; };
    for (const row of raids.slice(0, 500)) if (await canView(row.raid.guild.discordId, row.raid.signupChannelId)) events.push({
      id: `raid:${row.raid.id}`, title: row.raid.title, at: row.raid.scheduledAt, status: status(row.raid.status, row.status), context: context(row.raid.guildId) });
    for (const row of sessions.slice(0, 500)) if (await canView(row.session.core.guild.discordId, row.session.core.channelId)) events.push({
      id: `team:${row.session.id}`, title: row.session.core.name, at: row.session.scheduledAt, end: row.session.endsAt,
      status: status(row.session.status, row.status), context: context(row.session.core.guildId) });
    return { events: events.sort((a, b) => a.at.getTime() - b.at.getTime()), limited: raids.length > 500 || sessions.length > 500 };
  };
}

export function createPersonalCalendar(load: (account: WebAccountView, now: Date) => Promise<{ events: PersonalCalendarEvent[]; limited: boolean }>) {
  const path = "/me/calendar";
  const meSection = async (ctx: WebContext) => `<h2>${ctx.t("My calendar", "Mon calendrier")}</h2><p><a href="${link(path, ctx.lang)}">${ctx.t("Review and download my events", "Consulter et télécharger mes événements")}</a></p>`;
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== path) return null;
    if (!ctx.account) return kit.signInPrompt();
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    const { t, lang } = ctx, title = t("My calendar", "Mon calendrier");
    try {
      const data = await load(ctx.account, ctx.now);
      if (ctx.request.query.get("download") === "ics") return { status: 200, headers: { ...SECURITY_HEADERS, "cache-control": "private, no-store",
        "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="Guilded-calendar.ics"' }, body: personalCalendarIcs(ctx.account.id, data.events, ctx.now) };
      const labels = { CONFIRMED: t("Confirmed", "Confirmé"), TENTATIVE: t("Tentative / waitlisted", "Incertain / liste d’attente"), CANCELLED: t("Cancelled / declined", "Annulé / décliné") };
      return kit.page(200, title, `<h1>${title}</h1><p>${t("Your raid signups and team responses, including cancellations, from the last 90 days onward. Only events with a currently visible Discord channel are included. Community activities and Discord-only events are not included.", "Vos inscriptions aux raids et réponses d’équipe, annulations comprises, depuis les 90 derniers jours. Seuls les événements dont le salon Discord est actuellement visible sont inclus. Les activités communautaires et événements Discord seuls sont exclus.")}</p>`
        + `<p>${t("This is a manual snapshot, not an automatic subscription. Import into a dedicated calendar and replace its previous snapshot when refreshing; calendar apps differ in how they apply cancellations and removed access. Times are exported in UTC and displayed in your calendar’s timezone.", "Ceci est un instantané manuel, pas un abonnement automatique. Importez-le dans un calendrier dédié et remplacez l’instantané précédent à chaque actualisation; les applications gèrent différemment les annulations et accès retirés. Les heures sont exportées en UTC et affichées dans le fuseau de votre calendrier.")}</p>`
        + (data.limited ? `<p class="notice">${t("Export limited to the first 500 raids and 500 team sessions. Later events may be missing.", "Export limité aux 500 premiers raids et 500 séances d’équipe. Des événements ultérieurs peuvent manquer.")}</p>` : "")
        + `<ul>${data.events.map(e => `<li>${h(e.title)} · ${h(e.context)} · ${h(e.at.toISOString())} · ${labels[e.status]}</li>`).join("") || `<li>${t("No visible events. Check your signups and Discord access, then refresh.", "Aucun événement visible. Vérifiez vos inscriptions et accès Discord, puis actualisez.")}</li>`}</ul>`
        + `<p><a class="button" href="${link(path, lang, { download: "ics" })}">${t("Download calendar", "Télécharger le calendrier")}</a></p>`, { noindex: true });
    } catch { return kit.page(503, title, t("Calendar unavailable. Retry when Discord and Guilded are reachable; your previous download has not been updated.", "Calendrier indisponible. Réessayez lorsque Discord et Guilded sont accessibles; le téléchargement précédent n’a pas été actualisé."), { noindex: true }); }
  };
  return { route, meSection };
}
