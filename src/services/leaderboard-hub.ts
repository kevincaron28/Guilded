import { escapeHtml, link, type Lang } from "./web-layout.js";

// Building blocks of the leaderboard hub (landing page, shared tab bar, podiums, strips, trend bars). Pure: strings in, strings out.
// Only public, already-listed data goes in (names, guilds, levels, classes, scores); nothing here explains limits or checks.

type T = (en: string, fr: string) => string;
export type HubTab = "overview" | "dungeons" | "players" | "guilds" | "duels";

const EMBLEM = (name: string) => `/badge-art/emblems/${name}-128.webp`;
export const HUB_EMBLEMS: Record<Exclude<HubTab, "overview">, string> = {
  dungeons: EMBLEM("dungeons-gate"), players: EMBLEM("professions-first-laurel"), guilds: EMBLEM("guild-trophy"), duels: EMBLEM("duels-throne")
};

export const HUB_CSS = `<style>
.hub-banner{position:relative;margin:0 -4px 20px;padding:28px 20px 22px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#15110d linear-gradient(90deg,rgba(14,11,8,.94) 8%,rgba(14,11,8,.55) 62%,rgba(14,11,8,.25)),url(/images/hero/site-hero-800.webp) center/cover}
.hub-banner h1{margin:4px 0 8px;font-size:clamp(28px,6vw,46px)}.hub-banner p{max-width:560px;margin:0 0 12px}
.hub-search{display:flex;gap:8px;max-width:520px}.hub-search input{flex:1;min-width:0;min-height:44px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:rgba(0,0,0,.45);color:inherit}
.hub-search button{min-height:44px;padding:0 16px}
.hub-tabs{display:flex;gap:6px;overflow-x:auto;margin:0 0 20px;padding:2px 0 6px;scrollbar-width:thin}.hub-tabs a{flex:none;display:flex;align-items:center;gap:7px;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:inherit;background:var(--panel)}
.hub-tabs a img{width:22px;height:22px;object-fit:contain}.hub-tabs a.on{border-color:var(--gold);color:var(--gold);font-weight:700}
.hub-grid{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}.hub-grid>*{min-width:0}@media(min-width:760px){.hub-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.hub-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
.hub-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 14px 12px;min-width:0}.hub-card h2,.hub-card h3{margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:8px}.hub-card h2 img,.hub-card h3 img{width:28px;height:28px}
.hub-card .more{display:block;margin-top:8px;font-size:14px}
.podium{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr);align-items:end;gap:6px;margin:10px 0 6px;text-align:center}.podium .step{border:1px solid var(--line);border-radius:10px 10px 4px 4px;padding:8px 4px 8px;background:rgba(255,255,255,.03);min-width:0}
.podium .step.p1{border-color:var(--gold);padding-top:14px;background:rgba(214,170,70,.09)}.podium .num{font-size:12px;letter-spacing:.1em;color:var(--muted)}.podium .p1 .num{color:var(--gold)}
.podium .name{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.podium .sub{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.podium .pts{display:block;font-size:20px;color:var(--gold)}
.strip{list-style:none;margin:6px 0 0;padding:0}.strip li{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line);min-width:0}.strip li:first-child{border-top:0}
.strip .main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.strip .side{flex:none;text-align:right;color:var(--muted);font-size:13px}
.up{color:#7fd48a}.down{color:#ee8a7a}.flat{color:var(--muted)}.arrow{display:inline-block;min-width:3.2em;font-size:12px;font-variant-numeric:tabular-nums}
.trend{display:inline-block;vertical-align:middle}.trend rect{fill:var(--gold);opacity:.75}.trend rect:last-child{opacity:1}
.hub-empty{border:1px dashed var(--line);border-radius:12px;padding:16px;background:rgba(255,255,255,.02)}.hub-empty p{margin:0 0 6px}
.hub-results h2{margin:18px 0 6px}.kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.kpis span{border:1px solid var(--line);border-radius:999px;padding:4px 12px;background:var(--panel);font-size:14px}.kpis b{color:var(--gold)}
.hub-picker{display:flex;gap:8px;align-items:center;margin:0 0 14px;flex-wrap:wrap}.hub-picker label{margin:0;display:inline}.hub-picker select{width:auto;min-width:150px;flex:none;min-height:44px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:inherit;padding:0 10px}
.pbadges{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.pbadges span{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 12px 4px 6px;background:var(--panel);font-size:14px}.pbadges img{width:28px;height:28px;object-fit:contain}
@media(max-width:480px){table.rank-cards td[data-l]:before{content:attr(data-l) ": ";color:var(--muted)}}
@media(max-width:520px){.podium .pts{font-size:17px}.hub-banner{padding:20px 14px 16px}}
</style>`;

/** The one tab bar every leaderboard page shows; `extra` keeps the language and edition in the links. */
export function hubTabs(t: T, lang: Lang, active: HubTab, extra: Record<string, string | null | undefined> = {}): string {
  const tabs: [HubTab, string, string, string | null][] = [
    ["overview", "/leaderboards/", t("Overview", "Aperçu"), null],
    ["dungeons", "/leaderboards/dungeons/", t("Dungeons", "Donjons"), HUB_EMBLEMS.dungeons],
    ["duels", "/leaderboards/duels/", t("Duels", "Duels"), HUB_EMBLEMS.duels],
    ["players", "/leaderboards/characters/", t("Players", "Joueurs"), HUB_EMBLEMS.players],
    ["guilds", "/leaderboards/guilds/", t("Guilds", "Guildes"), HUB_EMBLEMS.guilds]
  ];
  return `<nav class="hub-tabs" aria-label="${t("Leaderboards", "Classements")}">` + tabs.map(([key, path, label, emblem]) =>
    `<a href="${link(path, lang, extra)}"${key === active ? ' class="on" aria-current="page"' : ""}>${emblem ? `<img src="${emblem}" alt="" width="22" height="22" loading="lazy">` : ""}${escapeHtml(label)}</a>`).join("") + `</nav>`;
}

export const searchForm = (t: T, lang: Lang, q: string, edition: string): string =>
  `<form class="hub-search" method="get" action="/leaderboards/" role="search"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="edition" value="${escapeHtml(edition)}">`
  + `<label class="sr" for="hub-q" style="position:absolute;left:-9999px">${t("Find a character or guild", "Trouver un personnage ou une guilde")}</label>`
  + `<input id="hub-q" name="q" type="search" maxlength="40" value="${escapeHtml(q)}" placeholder="${t("Find a character or guild", "Trouver un personnage ou une guilde")}" autocomplete="off">`
  + `<button class="button" type="submit">${t("Search", "Chercher")}</button></form>`;

export interface PodiumEntry { name: string; href?: string | null; sub?: string; value: string; className?: string }
/** Top three as a podium (2 - 1 - 3). Fewer than three entries fill from the left of the middle step. */
export function podium(entries: PodiumEntry[]): string {
  if (!entries.length) return "";
  const order = [entries[1], entries[0], entries[2]].map((entry, i) => entry ? { entry, place: [2, 1, 3][i]! } : null);
  return `<div class="podium">` + order.map((slot) => slot
    ? `<div class="step p${slot.place}"><span class="num">#${slot.place}</span>${slot.entry.href ? `<a class="name${slot.entry.className ? ` c-${slot.entry.className}` : ""}" href="${slot.entry.href}">${escapeHtml(slot.entry.name)}</a>` : `<span class="name">${escapeHtml(slot.entry.name)}</span>`}`
      + (slot.entry.sub ? `<span class="sub">${escapeHtml(slot.entry.sub)}</span>` : "") + `<span class="pts">${escapeHtml(slot.entry.value)}</span></div>`
    : `<div></div>`).join("") + `</div>`;
}

/** A list row for the latest runs and duels strips: main text (HTML, already escaped) and a small right-hand note. */
export const strip = (rows: { main: string; side?: string }[]): string =>
  `<ul class="strip">` + rows.map((row) => `<li><span class="main">${row.main}</span>${row.side ? `<span class="side">${row.side}</span>` : ""}</li>`).join("") + `</ul>`;

/** Movement since the start of the week: a green up arrow with the gain, a red down arrow, or a dash. `value` is whole points or places. */
export function movement(t: T, value: number | null): string {
  if (value === null) return `<span class="arrow up" title="${t("New this week", "Nouveau cette semaine")}">${t("new", "nouv.")}</span>`;
  if (value > 0) return `<span class="arrow up" aria-label="${t("up", "en hausse")} ${value}">▲ ${value}</span>`;
  if (value < 0) return `<span class="arrow down" aria-label="${t("down", "en baisse")} ${-value}">▼ ${-value}</span>`;
  return `<span class="arrow flat" aria-label="${t("unchanged", "inchangé")}">–</span>`;
}

/** Small bar trend (inline SVG, no script): the last values, newest on the right. */
export function trendBars(values: number[], label: string): string {
  const points = values.slice(-12);
  if (points.length < 2) return "";
  const low = Math.min(...points), high = Math.max(...points), span = high - low || 1;
  const bar = 6, gap = 2, height = 22;
  const rects = points.map((value, i) => {
    const h = Math.max(3, Math.round(((value - low) / span) * (height - 3)) + 3);
    return `<rect x="${i * (bar + gap)}" y="${height - h}" width="${bar}" height="${h}" rx="1"/>`;
  }).join("");
  const width = points.length * (bar + gap) - gap;
  return `<svg class="trend" role="img" aria-label="${escapeHtml(label)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
}

export const emptyBox = (title: string, lines: string[]): string => `<div class="hub-empty"><p><strong>${escapeHtml(title)}</strong></p>${lines.map((line) => `<p class="muted">${line}</p>`).join("")}</div>`;
