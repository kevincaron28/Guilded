import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebRoute } from "./web-app.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { LEVEL_BANDS, recentSnapshots, type StatSnapshot } from "./stat-snapshots.js";
import { classColor } from "./score-card.js";

// 8.5 track G: the Statistics page (/me/statistics) on the guild tools site. Officers only (the same check as /officer
// export). Charts are plain inline SVG: no script and no outside library. The same rows feed the CSV for Google Sheets.

const W = 640, H = 220, PAD = { l: 44, r: 12, t: 12, b: 28 };
const SERIES_COLORS = ["#c9a227", "#3b7dd8", "#2e9d5b", "#c4533c"];

const niceMax = (value: number) => {
  if (value <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / pow) * pow;
};

export interface ChartSeries { label: string; values: number[]; color?: string }

/** A line chart of one or more series over the same days. With one day it shows points only. */
export function lineChartSvg(days: string[], series: ChartSeries[], title: string): string {
  const max = niceMax(Math.max(0, ...series.flatMap(s => s.values)));
  const x = (i: number) => PAD.l + (days.length <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (days.length - 1));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const grid = [0, 0.5, 1].map(f => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}" stroke="currentColor" stroke-opacity=".15"/><text x="${PAD.l - 6}" y="${(y(max * f) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="currentColor">${Math.round(max * f)}</text>`).join("");
  const ends = days.length ? `<text x="${PAD.l}" y="${H - 8}" font-size="11" fill="currentColor">${h(days[0]!)}</text><text x="${W - PAD.r}" y="${H - 8}" text-anchor="end" font-size="11" fill="currentColor">${h(days[days.length - 1]!)}</text>` : "";
  const lines = series.map((s, n) => {
    const color = s.color ?? SERIES_COLORS[n % SERIES_COLORS.length]!;
    const points = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const dots = s.values.length <= 40 ? s.values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${color}"><title>${h(`${s.label} ${days[i]}: ${v}`)}</title></circle>`).join("") : "";
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points.join(" ")}"/>${dots}`;
  }).join("");
  const legend = series.map((s, n) => `<span class="stat-key"><i style="background:${s.color ?? SERIES_COLORS[n % SERIES_COLORS.length]}"></i>${h(s.label)}</span>`).join(" ");
  return `<figure class="stat-chart"><figcaption>${h(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(title)}" style="width:100%;height:auto;color:inherit">${grid}${lines}${ends}</svg><p>${legend}</p></figure>`;
}

/** A horizontal bar chart of labelled counts (levels, classes). */
export function barChartSvg(entries: Array<{ label: string; value: number; color?: string }>, title: string): string {
  const row = 24, left = 110, width = 520;
  const max = Math.max(1, ...entries.map(e => e.value));
  const bars = entries.map((e, i) => {
    const w = Math.max(e.value ? 2 : 0, Math.round((e.value / max) * (width - left - 50)));
    return `<text x="${left - 8}" y="${i * row + 16}" text-anchor="end" font-size="12" fill="currentColor">${h(e.label)}</text><rect x="${left}" y="${i * row + 4}" width="${w}" height="16" rx="3" fill="${e.color ?? "#c9a227"}"><title>${h(`${e.label}: ${e.value}`)}</title></rect><text x="${left + w + 6}" y="${i * row + 16}" font-size="12" fill="currentColor">${e.value}</text>`;
  }).join("");
  return `<figure class="stat-chart"><figcaption>${h(title)}</figcaption><svg viewBox="0 0 ${width} ${Math.max(row, entries.length * row)}" role="img" aria-label="${h(title)}" style="width:100%;height:auto;color:inherit">${bars}</svg></figure>`;
}

export function statsBody(rows: StatSnapshot[], t: (en: string, fr: string) => string): string {
  if (!rows.length) return `<p>${t("No statistics yet. The first daily snapshot is written within a few hours of the bot starting; charts need at least two days to draw a line.", "Pas encore de statistiques. Le premier relevé quotidien est écrit quelques heures après le démarrage du bot; il faut au moins deux jours pour tracer une ligne.")}</p>`;
  const days = rows.map(r => r.day), last = rows[rows.length - 1]!;
  const classes = Object.entries(last.classCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [
    `<p>${t("Latest snapshot", "Dernier relevé")}: <strong>${h(last.day)}</strong> (UTC) · ${last.discordMembers} ${t("Discord members", "membres Discord")} · ${last.rosterSize} ${t("characters", "personnages")} · ${last.level60} ${t("at level 60", "au niveau 60")}</p>`,
    lineChartSvg(days, [{ label: t("Discord members", "Membres Discord"), values: rows.map(r => r.discordMembers) }, { label: t("Linked members", "Membres liés"), values: rows.map(r => r.linkedMembers) }, { label: t("Characters", "Personnages"), values: rows.map(r => r.rosterSize) }], t("Members over time", "Membres au fil du temps")),
    lineChartSvg(days, [{ label: t("Active members", "Membres actifs"), values: rows.map(r => r.activeMembers) }, { label: t("Online peak", "Pic en ligne"), values: rows.map(r => r.onlinePeak) }], t("Activity", "Activité")),
    lineChartSvg(days, [{ label: t("Messages", "Messages"), values: rows.map(r => r.messages) }, { label: t("Voice minutes", "Minutes vocales"), values: rows.map(r => r.voiceMinutes) }], t("Messages and voice per day", "Messages et vocal par jour")),
    lineChartSvg(days, [{ label: t("Raids", "Raids"), values: rows.map(r => r.raids) }, { label: t("Dungeon runs", "Donjons"), values: rows.map(r => r.dungeonRuns) }], t("Raids and dungeon runs per day", "Raids et donjons par jour")),
    barChartSvg(LEVEL_BANDS.map(band => ({ label: `${t("Level", "Niveau")} ${band}`, value: last.levelBands[band] ?? 0 })), t("Level distribution (latest)", "Répartition des niveaux (dernier relevé)")),
    barChartSvg(classes.map(([name, value]) => ({ label: name, value, color: classColor(name) })), t("Classes (latest)", "Classes (dernier relevé)"))
  ].join("");
}

export function createStatsPage(database: PrismaClient, access: GuildDashboardAccess): { route: WebRoute } {
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== "/me/statistics") return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const title = t("Guild statistics", "Statistiques de guilde");
    const guildId = ctx.request.query.get("guild") ?? "";
    if (guildId.length > 64) return kit.page(400, title, t("Invalid filter.", "Filtre invalide."), { noindex: true });
    const days = Math.min(365, Math.max(7, Number(ctx.request.query.get("days")) || 30));
    try {
      if (!guildId) {
        const guilds = await access.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose a guild where you currently have officer access.", "Choisissez une guilde où vous avez actuellement accès comme officier.")}</p><ul>${guilds.map(g => `<li><a href="${h(link("/me/statistics", lang, { guild: g.id, edition: g.edition }))}">${h(g.name)} · ${h(g.edition)}</a></li>`).join("")}</ul>`, { noindex: true });
      }
      const guild = await access.authorize(ctx.account.discordUserId, guildId);
      if (!guild) return kit.page(403, title, t("These records are unavailable with your current membership and permissions.", "Ces données ne sont pas accessibles avec votre adhésion et vos permissions actuelles."), { noindex: true });
      const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { statsEnabled: true } });
      const body = settings?.statsEnabled === false
        ? `<p>${t("Statistics are turned off for this server. An officer can turn them on with /officer stats toggle.", "Les statistiques sont désactivées pour ce serveur. Un officier peut les activer avec /officer stats toggle.")}</p>`
        : statsBody(await recentSnapshots(database, guildId, days), t)
          + `<p>${t("Want these in Google Sheets? An officer runs /officer stats feed and pastes the address into =IMPORTDATA(\"…\").", "Dans Google Sheets? Un officier lance /officer stats feed et colle l'adresse dans =IMPORTDATA(\"…\").")}</p>`;
      const style = `<style>.stat-chart{margin:1rem 0}.stat-chart figcaption{font-weight:600}.stat-key{display:inline-block;margin-right:1rem;font-size:.9em}.stat-key i{display:inline-block;width:.8em;height:.8em;margin-right:.3em;border-radius:2px}</style>`;
      const header = `<h1>${title}</h1><p><strong>${h(guild.name)}</strong> · ${h(guild.edition)} · <a href="${h(link("/me/statistics", lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a> · <a href="${h(link("/me/guild-bank", lang, { guild: guild.id, edition: guild.edition }))}">${t("Guild bank", "Banque de guilde")}</a></p>`
        + `<p>${[7, 30, 90, 365].map(n => n === days ? `<strong>${n} ${t("days", "jours")}</strong>` : `<a href="${h(link("/me/statistics", lang, { guild: guild.id, edition: guild.edition, days: String(n) }))}">${n} ${t("days", "jours")}</a>`).join(" · ")}</p>`;
      return kit.page(200, title, style + header + body, { noindex: true, languageParams: { guild: guild.id, edition: guild.edition } });
    } catch {
      return kit.page(503, title, t("These records could not be loaded. Try again shortly; no data was changed.", "Impossible de charger ces données. Réessayez sous peu; aucune donnée n'a été modifiée."), { noindex: true });
    }
  };
  return { route };
}
