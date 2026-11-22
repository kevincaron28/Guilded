import { escapeHtml, link, type Lang } from "./web-layout.js";

// Building blocks of the leaderboard hub (landing page, shared tab bar, podiums, strips, trend bars). Pure: strings in, strings out.
// Only public, already-listed data goes in (names, guilds, levels, classes, scores); nothing here explains limits or checks.

type T = (en: string, fr: string) => string;
export type HubTab = "overview" | "dungeons" | "players" | "guilds" | "duels" | "pvp" | "raids";

const EMBLEM = (name: string) => `/badge-art/emblems/${name}-128.webp`;
export const HUB_EMBLEMS: Record<Exclude<HubTab, "overview" | "raids">, string> = {
  dungeons: EMBLEM("dungeons-gate"), players: EMBLEM("professions-first-laurel"), guilds: EMBLEM("guild-trophy"), duels: EMBLEM("duels-throne"), pvp: EMBLEM("pvp-helm")
};

export const HUB_CSS = `<style>
.hub-banner{position:relative;margin:0 -4px 20px;padding:28px 20px 22px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:linear-gradient(90deg,rgba(14,11,8,.94) 8%,rgba(14,11,8,.55) 62%,rgba(14,11,8,.25)),url(/images/web/season-banner-1600.webp) center/cover #15110d}@media(max-width:800px){.hub-banner{background-image:linear-gradient(90deg,rgba(14,11,8,.94) 8%,rgba(14,11,8,.55) 62%,rgba(14,11,8,.25)),url(/images/web/season-banner-800.webp)}}
.hub-banner h1{margin:4px 0 8px;font-size:clamp(28px,6vw,46px)}.hub-banner p{max-width:560px;margin:0 0 12px}
.hub-search{display:flex;gap:8px;max-width:520px}.hub-search input{flex:1;min-width:0;min-height:44px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:rgba(0,0,0,.45);color:inherit}
.hub-search button{min-height:44px;padding:0 16px}
.hub-tabs{display:flex;gap:6px;overflow-x:auto;margin:0 0 20px;padding:2px 0 6px;scrollbar-width:thin}.hub-tabs a{flex:none;display:flex;align-items:center;gap:7px;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:inherit;background:var(--panel)}
.hub-tabs a img{width:22px;height:22px;object-fit:contain}.hub-tabs a.on{border-color:var(--gold);color:var(--gold);font-weight:700}
.hub-grid{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}.hub-grid>*{min-width:0}@media(min-width:760px){.hub-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.hub-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
.hub-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 14px 12px;min-width:0}.hub-card h2,.hub-card h3{margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:8px}.hub-card h2 img,.hub-card h3 img{width:28px;height:28px}
.sec-art{display:block;width:100%;height:auto;aspect-ratio:1600/360;object-fit:cover;border-radius:12px;border:1px solid var(--line);margin:0 0 14px}.podium .medal{display:block;width:44px;height:44px;margin:0 auto 4px}.podium .p1 .medal{width:56px;height:56px}
.hub-card .more{display:block;margin-top:8px;font-size:14px}
.podium{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr);align-items:end;gap:6px;margin:10px 0 6px;text-align:center}.podium .step{border:1px solid var(--line);border-radius:10px 10px 4px 4px;padding:8px 4px 8px;background:rgba(255,255,255,.03);min-width:0}
.podium .step.p1{border-color:var(--gold);padding-top:14px;background:rgba(214,170,70,.09)}.podium .num{font-size:12px;letter-spacing:.1em;color:var(--muted)}.podium .p1 .num{color:var(--gold)}
.podium .name{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.podium .sub{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.podium .pts{display:block;font-size:20px;color:var(--gold)}
.strip{list-style:none;margin:6px 0 0;padding:0}.strip li{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line);min-width:0}.strip li:first-child{border-top:0}
.strip .main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.strip .side{flex:none;text-align:right;color:var(--muted);font-size:13px}
.up{color:#7fd48a}.down{color:#ee8a7a}.flat{color:var(--muted)}.arrow{display:inline-block;min-width:3.2em;font-size:12px;font-variant-numeric:tabular-nums}
.trend{display:inline-block;vertical-align:middle}.trend rect{fill:var(--gold);opacity:.75}.trend rect:last-child{opacity:1}
.hub-empty{border:1px dashed var(--line);border-radius:12px;padding:16px;background:rgba(255,255,255,.02)}.hub-empty p{margin:0 0 6px}.hub-empty.has-art{display:flex;align-items:center;gap:16px}.hub-empty .empty-art{width:96px;height:96px;flex:none;object-fit:contain}.hub-empty.has-art>div{min-width:0}@media(max-width:480px){.hub-empty .empty-art{width:72px;height:72px}}
.hub-results h2{margin:18px 0 6px}.kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.kpis span{border:1px solid var(--line);border-radius:999px;padding:4px 12px;background:var(--panel);font-size:14px}.kpis b{color:var(--gold)}
.hub-picker{display:flex;gap:8px;align-items:center;margin:0 0 14px;flex-wrap:wrap}.hub-picker label{margin:0;display:inline}.hub-picker select{width:auto;min-width:150px;flex:none;min-height:44px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:inherit;padding:0 10px}
.pbadges{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.pbadges span{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 12px 4px 6px;background:var(--panel);font-size:14px}.pbadges img{width:28px;height:28px;object-fit:contain}
.podium-wrap{margin:10px 0 6px;padding:16px 8px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:linear-gradient(180deg,rgba(14,11,8,.3),rgba(14,11,8,.78)),url(/images/web/podium-stage-1600.webp) center bottom/cover #15110d}.podium-wrap .podium{margin:0}.podium-wrap .step{background:rgba(14,11,8,.7);border-bottom:0}.podium-wrap .step.p1{background:linear-gradient(180deg,rgba(214,170,70,.28),rgba(14,11,8,.82) 70%)}.podium .tier{position:relative;display:block;width:48px;height:48px;margin:0 auto 4px}.podium .p1 .tier{width:60px;height:60px}.podium .tier img{display:block;width:100%;height:100%;object-fit:contain}.podium .tier b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;text-shadow:0 1px 3px #000}.podium .p1 .tier b{font-size:19px}
.dthumb{display:inline-block;width:64px;height:34px;flex:none;border-radius:6px;object-fit:cover;vertical-align:middle;background:#15110d;border:1px solid var(--line);margin-right:8px}.dthumb.ph{background:linear-gradient(135deg,#1c1710,#2a2116)}.dcell{display:inline-flex;align-items:center;min-width:0}.dcell a{min-width:0}
.dungeon-head{position:relative;margin:0 0 14px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#15110d;aspect-ratio:1200/315;min-height:120px}.dungeon-head img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.dungeon-head .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(14,11,8,.92) 8%,rgba(14,11,8,.55) 62%,rgba(14,11,8,.2))}.dungeon-head .text{position:relative;padding:18px 20px}.dungeon-head h2{margin:0 0 4px;font-size:clamp(22px,4.5vw,34px)}.dungeon-head p{margin:0;color:var(--muted)}.dungeon-head p b{color:var(--gold)}.dungeon-head.plain{aspect-ratio:auto;min-height:0;padding:14px 18px;background:var(--panel)}.dungeon-head.plain .text{padding:0}
.hub-banner .season-line{margin:0 0 8px;color:var(--gold);font-size:14px}.hub-banner .season-line b{letter-spacing:.04em}
tr.rk td:first-child{box-shadow:inset 3px 0 0 transparent}tr.rk-c-warrior td:first-child{box-shadow:inset 3px 0 0 #c69b6d}tr.rk-c-paladin td:first-child{box-shadow:inset 3px 0 0 #f48cba}tr.rk-c-hunter td:first-child{box-shadow:inset 3px 0 0 #aad372}tr.rk-c-rogue td:first-child{box-shadow:inset 3px 0 0 #fff468}tr.rk-c-priest td:first-child{box-shadow:inset 3px 0 0 #fff}tr.rk-c-shaman td:first-child{box-shadow:inset 3px 0 0 #2a8cff}tr.rk-c-mage td:first-child{box-shadow:inset 3px 0 0 #3fc7eb}tr.rk-c-warlock td:first-child{box-shadow:inset 3px 0 0 #8788ee}tr.rk-c-druid td:first-child{box-shadow:inset 3px 0 0 #ff7c0a}
.strip .dthumb{width:48px;height:25px;margin-right:6px}
@media(max-width:480px){table.rank-cards td[data-l]:before{content:attr(data-l) ": ";color:var(--muted)}}
@media(max-width:520px){.podium .pts{font-size:17px}.hub-banner{padding:20px 14px 16px}}
</style>`;

/** The one tab bar every leaderboard page shows; `extra` keeps the language and edition in the links. */
export function hubTabs(t: T, lang: Lang, active: HubTab, extra: Record<string, string | null | undefined> = {}): string {
  const tabs: [HubTab, string, string, string | null][] = [
    ["overview", "/leaderboards/", t("Overview", "Aperçu"), null],
    ["dungeons", "/leaderboards/dungeons/", t("Dungeons", "Donjons"), HUB_EMBLEMS.dungeons],
    ["duels", "/leaderboards/duels/", t("Duels", "Duels"), HUB_EMBLEMS.duels],
    ["pvp", "/leaderboards/pvp/", t("PvP", "PvP"), HUB_EMBLEMS.pvp],
    ["raids", "/leaderboards/raids/", t("Raids", "Raids"), null],
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
  return `<div class="podium-wrap"><div class="podium">` + order.map((slot) => slot
    ? `<div class="step p${slot.place}"><span class="tier"><img src="/badge-art/frames/${["", "gold", "silver", "bronze"][slot.place]}-128.webp" alt="" width="60" height="60" loading="lazy" decoding="async"><b>${slot.place}</b></span><span class="num">#${slot.place}</span>${slot.entry.href ? `<a class="name${slot.entry.className ? ` c-${slot.entry.className}` : ""}" href="${slot.entry.href}">${escapeHtml(slot.entry.name)}</a>` : `<span class="name">${escapeHtml(slot.entry.name)}</span>`}`
      + (slot.entry.sub ? `<span class="sub">${escapeHtml(slot.entry.sub)}</span>` : "") + `<span class="pts">${escapeHtml(slot.entry.value)}</span></div>`
    : `<div></div>`).join("") + `</div></div>`;
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

/** Painted empty-state pictures (320 px WebP, transparent), decorative: the alt text is empty. */
export type EmptyArt = "duel" | "runs" | "notfound" | "search" | "guild" | "pvp" | "season";
export const EMPTY_ART_CSS = ".hub-empty.has-art{display:flex;align-items:center;gap:16px}.hub-empty .empty-art{width:96px;height:96px;flex:none;object-fit:contain}.hub-empty.has-art>div{min-width:0}.hub-empty.has-art p{margin:0 0 6px}@media(max-width:480px){.hub-empty .empty-art{width:72px;height:72px}}";
export const emptyBox = (title: string, lines: string[], art?: EmptyArt): string => {
  const text = `<p><strong>${escapeHtml(title)}</strong></p>${lines.map((line) => `<p class="muted">${line}</p>`).join("")}`;
  return art ? `<div class="hub-empty has-art"><img class="empty-art" src="/images/web/empty-${art}.webp" alt="" width="96" height="96" loading="lazy"><div>${text}</div></div>` : `<div class="hub-empty">${text}</div>`;
};
/** A not-found or empty page body with its own style tag, for pages that do not carry the hub styles. */
export const emptyPage = (title: string, lines: string[], art: EmptyArt): string =>
  `<style>.hub-empty{border:1px dashed var(--line);border-radius:12px;padding:16px;background:rgba(255,255,255,.02);max-width:560px}${EMPTY_ART_CSS}</style>${emptyBox(title, lines, art)}`;

/** Painted section header (1600 x 360, WebP at 1600 and 800 wide) at the very top of a leaderboard page, so it loads eagerly; decorative, so the alt text is empty. */
export const sectionArt = (kind: "dungeons" | "players" | "duels" | "guilds" | "pvp"): string =>
  `<img class="sec-art" src="/images/web/header-${kind}-1600.webp" srcset="/images/web/header-${kind}-800.webp 800w, /images/web/header-${kind}-1600.webp 1600w" sizes="(max-width:900px) 100vw, 900px" alt="" width="1600" height="360" loading="eager" fetchpriority="high">`;

/** The body of a bot-served "not found" page (never empty): the painted 404 picture, one sentence and a way home. EN/FR through `t`. */
export const notFoundBody = (t: T, lang: Lang, title?: string, line?: string): string =>
  `<style>.nf{max-width:560px;margin:8px 0 24px}.nf img{display:block;width:100%;height:auto;aspect-ratio:1200/675;object-fit:cover;border-radius:12px;border:1px solid var(--line);margin:0 0 14px}.nf .nf-code{color:var(--gold);letter-spacing:.2em;font-size:13px}</style>`
  + `<div class="nf"><img src="/images/web/404-800.webp" srcset="/images/web/404-800.webp 800w, /images/web/404-1200.webp 1200w" sizes="(max-width:600px) 100vw, 560px" alt="" width="1200" height="675" loading="lazy">`
  + `<span class="nf-code">404</span><h1>${escapeHtml(title ?? t("This page wandered off", "Cette page s'est égarée"))}</h1><p>${escapeHtml(line ?? t("The address may be old or mistyped. Head back to the start and pick up from there.", "L'adresse est peut-être ancienne ou mal écrite. Reviens à l'accueil et reprends à partir de là."))}</p>`
  + `<p><a class="button" href="${link("/", lang)}">${t("Go home", "Retour à l'accueil")}</a></p></div>`;
