import type { WebContext } from "./web-app.js";
import { escapeHtml, link } from "./web-layout.js";

// Grouping layer for /me/. Each section keeps producing its own HTML; this file only decides
// where it goes (a group), how it is wrapped, and draws the group navigation. The page is
// server-rendered under a strict CSP (no scripts), so the navigation is plain anchors and the
// "current group" highlight uses :target in CSS.

export const ME_GROUPS = ["overview", "play", "guild", "account"] as const;
export type MeGroup = typeof ME_GROUPS[number];

export interface MeSectionSpec {
  /** Wrapper anchor is `#sec-<id>`; ids inside the section's own HTML (for example `#achievements`) are unchanged. */
  id: string;
  group: MeGroup;
  render: (context: WebContext) => Promise<string>;
  /** Keep the heading and put the rest behind a <details> (long instructions, forms). */
  fold?: { en: string; fr: string };
  /** Listed under a collapsed "Officer tools" block. Pair with `visible` so non-officers never see it. */
  officer?: boolean;
  /** When it resolves false the section is not rendered. Destination pages still check access themselves. */
  visible?: (context: WebContext) => Promise<boolean>;
}
/** A bare function (older callers, tests) lands in Play, wrapped and unfolded. */
export type MeSectionInput = ((context: WebContext) => Promise<string>) | MeSectionSpec;

export function meSection(spec: MeSectionSpec): MeSectionSpec { return spec; }

/** Renders a spec, or "" when its `visible` check says no (or throws: hidden is the safe failure). */
export async function renderSpec(spec: MeSectionSpec, context: WebContext): Promise<string> {
  if (spec.visible && !(await spec.visible(context).catch(() => false))) return "";
  return spec.render(context);
}

/**
 * Officer check for the /me/ sections. `guilds` does forced Discord member fetches per guild, so the
 * answer is cached per Discord user for `ttlMs`; a failed lookup is not cached and counts as "no".
 */
export function cachedOfficerCheck(guilds: (discordUserId: string) => Promise<unknown[]>, ttlMs = 5 * 60_000) {
  const cache = new Map<string, { at: number; officer: boolean }>();
  return async (context: WebContext): Promise<boolean> => {
    const user = context.account?.discordUserId;
    if (!user) return false;
    const hit = cache.get(user);
    if (hit && context.now.getTime() - hit.at < ttlMs) return hit.officer;
    const officer = (await guilds(user)).length > 0;
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    cache.set(user, { at: context.now.getTime(), officer });
    return officer;
  };
}

const TITLES: Record<MeGroup, { en: string; fr: string; summaryEn: string; summaryFr: string }> = {
  overview: { en: "Overview", fr: "Aperçu", summaryEn: "Who you are on Guilded and your weekly recap.", summaryFr: "Qui vous êtes sur Guilded et votre récapitulatif de la semaine." },
  play: { en: "Play", fr: "Jouer", summaryEn: "Achievements, availability, calendar, raids and leaderboards.", summaryFr: "Succès, disponibilité, calendrier, raids et classements." },
  guild: { en: "Guild", fr: "Guilde", summaryEn: "Guild tools, recruitment and your applications; officer tools appear here for officers.", summaryFr: "Outils de guilde, recrutement et candidatures; les outils d'officier apparaissent ici pour les officiers." },
  account: { en: "Account & data", fr: "Compte et données", summaryEn: "Connected devices, your data and privacy.", summaryFr: "Appareils connectés, vos données et confidentialité." }
};

/** Section HTML was written with <h2>; inside a group panel (which owns the h2) they become <h3>. */
function demote(html: string): string {
  return html.replace(/<h2(\s|>)/g, "<h3$1").replace(/<\/h2>/g, "</h3>");
}

function fold(html: string, label: string): string {
  const end = html.indexOf("</h3>");
  if (end < 0) return html;
  const cut = end + "</h3>".length;
  return `${html.slice(0, cut)}<details class="me-fold"><summary>${escapeHtml(label)}</summary>${html.slice(cut)}</details>`;
}

export interface RenderedSection { spec: MeSectionSpec; html: string }

export function normalizeSections(inputs: MeSectionInput[]): MeSectionSpec[] {
  return inputs.map((input, index) => typeof input === "function" ? { id: `extra-${index + 1}`, group: "play" as const, render: input } : input);
}

export interface MeNavLink { href: string; en: string; fr: string }

/** Draws the groups that have content, plus the sticky anchor navigation. `leading` is the page's own HTML for a group. */
export function renderGroups(ctx: WebContext, sections: RenderedSection[], own: Partial<Record<MeGroup, string>>, quick: MeNavLink[]): string {
  const { t } = ctx;
  const groups = ME_GROUPS.filter(group => own[group] || sections.some(section => section.spec.group === group && section.html));
  const tabs = `<nav class="me-tabs" aria-label="${t("Sections of my page", "Sections de ma page")}">${groups.map(group => `<a href="#${group}">${t(TITLES[group].en, TITLES[group].fr)}</a>`).join("")}</nav>`;
  const quickLinks = `<nav class="me-quick" aria-label="${t("Quick actions", "Actions rapides")}">${quick.map(item => `<a class="button" href="${item.href.startsWith("#") ? item.href : escapeHtml(link(item.href, ctx.lang))}">${t(item.en, item.fr)}</a>`).join("")}</nav>`;
  const panels = groups.map(group => {
    const mine = sections.filter(section => section.spec.group === group && section.html);
    const normal = mine.filter(section => !section.spec.officer);
    const officer = mine.filter(section => section.spec.officer);
    const wrap = (section: RenderedSection) => `<section class="me-sec" id="sec-${escapeHtml(section.spec.id)}">${section.spec.fold ? fold(demote(section.html), t(section.spec.fold.en, section.spec.fold.fr)) : demote(section.html)}</section>`;
    return `<section class="me-group" id="${group}" aria-labelledby="${group}-title"><h2 id="${group}-title">${t(TITLES[group].en, TITLES[group].fr)}</h2><p class="muted me-summary">${t(TITLES[group].summaryEn, TITLES[group].summaryFr)}</p>`
      + (own[group] ?? "") + normal.map(wrap).join("")
      + (officer.length ? `<details class="me-officer"><summary>${t("Officer tools", "Outils d'officier")}</summary>${officer.map(wrap).join("")}</details>` : "")
      + `</section>`;
  }).join("");
  return `<style>${ME_STYLE}</style>${tabs}${quickLinks}${panels}`;
}

// 44px+ targets, no horizontal scroll; the sticky bar scrolls its own overflow if a language runs long.
const ME_STYLE = `html{scroll-behavior:smooth;scroll-padding-top:64px}
.me-tabs{position:sticky;top:0;z-index:5;display:flex;gap:6px;overflow-x:auto;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 0;margin:0 0 12px}
.me-tabs a,.me-quick a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:999px;text-decoration:none;white-space:nowrap}
.me-tabs a{color:var(--text)}.me-quick a.button{background:var(--panel);color:var(--gold);border-color:var(--gold)}
body:has(#overview:target) .me-tabs a[href="#overview"],body:has(#play:target) .me-tabs a[href="#play"],body:has(#guild:target) .me-tabs a[href="#guild"],body:has(#account:target) .me-tabs a[href="#account"],body:not(:has(.me-group:target)) .me-tabs a:first-child{background:var(--gold);color:#111312;border-color:var(--gold)}
.me-quick{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}
.me-group{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:4px 16px 12px;margin:0 0 20px}
.me-group:target{border-color:var(--gold)}
.me-summary{margin-top:-6px}
.me-sec{border-top:1px solid var(--line);margin-top:12px}.me-sec h3{margin-top:14px}
.me-fold>summary,.me-officer>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--gold)}
.me-sec img{max-width:100%;height:auto}.me-group{overflow-wrap:anywhere}`;
