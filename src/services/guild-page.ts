import type { PrismaClient } from "@prisma/client";
import { priority } from "./epgp.js";
import { breadcrumbs, SITE_HEADER_STYLE, siteHeader } from "./site-header.js";

// A guild's public page at /g/<slug>/ (docs/GUILD_PAGES_DESIGN.md). Read-only, no scripts, and
// only what officers turned on. Names are character names, never Discord users or IDs.

export const PAGE_SECTIONS = ["cores", "loot", "rosters", "rankings", "recruitment"] as const;
export type PageSection = typeof PAGE_SECTIONS[number];

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const INVITE = /^https:\/\/(?:discord\.gg|(?:www\.)?discord\.com\/invite)\/[A-Za-z0-9-]{2,32}$/;
const RANKING_LIMIT = 50;
const ROLE_ORDER = { TANK: 0, HEALER: 1, DPS: 2 } as const;

export function isPageSlug(value: string): boolean { return SLUG.test(value); }

// "⚜Quebec Gold⚜" → "quebec-gold".
export function slugFromName(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return isPageSlug(slug) ? slug : "guild";
}

export function parseSections(text: string): PageSection[] {
  const names = text.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const unknown = names.filter((name) => !(PAGE_SECTIONS as readonly string[]).includes(name));
  if (unknown.length) throw new Error(`Unknown section: ${unknown.join(", ")}. Use ${PAGE_SECTIONS.join(", ")}.`);
  return [...new Set(names)] as PageSection[];
}

export function checkInviteUrl(url: string): string {
  const trimmed = url.trim();
  if (!INVITE.test(trimmed)) throw new Error("Use a Discord invite link: https://discord.gg/... or https://discord.com/invite/...");
  return trimmed;
}

export interface RosterRow { name: string; className: string; role: keyof typeof ROLE_ORDER; bench: boolean; trial: boolean }
export interface RankingRow { name: string; ep: number; gp: number; pr: number }
export interface PageCore {
  name: string; description: string | null; realm: string | null; schedule: string | null; timezone: string;
  lootMode: string; decayPercent: number; minEp: number;
  roster?: RosterRow[]; ranking?: RankingRow[];
}
export interface GuildPageView {
  slug: string; name: string; language: "en" | "fr"; indexable: boolean; intro: string | null;
  sections: PageSection[]; cores: PageCore[];
  recruitment: { text: string | null; inviteUrl: string | null } | null;
  /** The guild's public dungeon page (/leaderboards/guild/<id>/), when it publishes its runs. */
  dungeonPage?: string | null;
}

// The published page for `slug`, or null (unknown, unpublished, or its server is not allowed).
export async function loadGuildPageView(database: PrismaClient, slug: string, allows: (discordId: string) => boolean): Promise<GuildPageView | null> {
  if (!isPageSlug(slug)) return null;
  const page = await database.guildPage.findUnique({
    where: { slug },
    include: { guild: { select: { id: true, name: true, discordId: true, settings: { select: { language: true, timezone: true, lootMode: true, baseGp: true, epgpDecayPercent: true, publicDungeonRuns: true } } } } }
  });
  if (!page?.published || !allows(page.guild.discordId)) return null;
  const sections = page.sections.filter((name): name is PageSection => (PAGE_SECTIONS as readonly string[]).includes(name));
  const on = (name: PageSection) => sections.includes(name);
  const settings = page.guild.settings;
  const timezone = settings?.timezone ?? "America/Toronto";
  const cores: PageCore[] = [];
  if (on("cores") || on("loot") || on("rosters") || on("rankings")) {
    const rows = await database.raidCore.findMany({
      where: { guildId: page.guild.id },
      orderBy: { name: "asc" },
      include: { members: { where: { member: { status: "ACTIVE" } }, include: {
        character: { select: { name: true, className: true } },
        member: { select: { characters: { where: { isMain: true }, select: { name: true, className: true }, take: 1 } } }
      } } }
    });
    for (const core of rows) {
      const view: PageCore = {
        name: core.name, description: core.description, realm: core.realm, schedule: core.schedule,
        timezone: core.weeklyTimezone ?? timezone, lootMode: core.lootMode ?? settings?.lootMode ?? "EPGP",
        decayPercent: core.decayPercent ?? settings?.epgpDecayPercent ?? 0, minEp: core.minEp ?? 0
      };
      // The character each member brings to this core; members without one are left out.
      const spots = core.members.flatMap((spot) => {
        const character = spot.character ?? spot.member.characters[0];
        return character ? [{ memberId: spot.memberId, spot, character }] : [];
      });
      if (on("rosters")) {
        view.roster = spots.map(({ spot, character }) => ({ name: character.name, className: character.className, role: spot.role, bench: spot.bench, trial: spot.trial }))
          .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
      }
      if (on("rankings") && spots.length) {
        const sums = await database.epgpTransaction.groupBy({
          by: ["memberId"],
          where: { guildId: page.guild.id, coreId: core.separatePool ? core.id : null, memberId: { in: spots.map((s) => s.memberId) } },
          _sum: { epAmount: true, gpAmount: true }
        });
        const byMember = new Map(sums.map((row) => [row.memberId, row._sum]));
        const baseGp = core.baseGp ?? settings?.baseGp ?? 0;
        view.ranking = spots.map(({ memberId, character }) => {
          const ep = byMember.get(memberId)?.epAmount ?? 0;
          const gp = byMember.get(memberId)?.gpAmount ?? 0;
          return { name: character.name, ep, gp, pr: priority(ep, gp, baseGp) };
        }).filter((row) => row.ep || row.gp).sort((a, b) => b.pr - a.pr || b.ep - a.ep).slice(0, RANKING_LIMIT);
      }
      cores.push(view);
    }
  }
  return {
    slug: page.slug, name: page.guild.name, language: settings?.language === "fr" ? "fr" : "en", indexable: page.indexable,
    intro: page.intro, sections, cores,
    recruitment: on("recruitment") && (page.recruitment || page.inviteUrl) ? { text: page.recruitment, inviteUrl: page.inviteUrl } : null,
    dungeonPage: settings?.publicDungeonRuns ? `/leaderboards/guild/${encodeURIComponent(page.guild.id)}` : null
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const paragraphs = (text: string) => text.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part.trim()).replace(/\n/g, "<br>")}</p>`).join("");

const LOOT: Record<string, { en: string; fr: string }> = {
  EPGP: { en: "EPGP: players earn EP by raiding and pay GP for items; the highest priority (EP ÷ GP) wins.", fr: "EPGP : on gagne des EP en raid et on paie des GP pour les objets; la priorité la plus haute (EP ÷ GP) l'emporte." },
  COUNCIL: { en: "Loot council: officers decide who receives each item.", fr: "Conseil de butin : les officiers décident qui reçoit chaque objet." },
  RESERVE: { en: "Soft reserves: players reserve items before the raid.", fr: "Réservations : les joueurs réservent des objets avant le raid." },
  PRIORITY: { en: "Priority list: items follow a list set by officers.", fr: "Liste de priorité : les objets suivent une liste établie par les officiers." }
};
const ROLE_LABEL = { TANK: { en: "Tank", fr: "Tank" }, HEALER: { en: "Healer", fr: "Soigneur" }, DPS: { en: "DPS", fr: "DPS" } };

export const PAGE_STYLE = `:root{color-scheme:dark;--bg:#111312;--panel:#1a1e1b;--line:#353b32;--text:#f1eee4;--muted:#b9c0b2;--gold:#e8c47c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:auto;padding:48px 20px}h1{font-size:clamp(34px,6vw,56px);line-height:1.1;margin:8px 0 16px}h2{font-size:26px;margin:48px 0 16px}h3{font-size:20px;margin:0 0 6px}
a{color:var(--gold)}.eyebrow{color:var(--gold);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin:0}
.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:22px}.card p{margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.table-wrap{overflow-x:auto}.tag{color:var(--muted);font-size:13px}
.button{display:inline-block;background:var(--gold);color:#16130b;font-weight:700;padding:12px 20px;border-radius:6px;text-decoration:none}
.button.ghost{background:transparent;color:var(--gold);border:1px solid var(--gold)}.actions{display:flex;flex-wrap:wrap;gap:12px}
footer{border-top:1px solid var(--line);margin-top:64px;padding-top:20px;font-size:13px;color:var(--muted)}`;

export function renderGuildPage(view: GuildPageView): string {
  const fr = view.language === "fr";
  const t = (en: string, frText: string) => (fr ? frText : en);
  const label = (en: string, frText: string) => (fr ? `${frText} : ` : `${en}: `);
  const on = (name: PageSection) => view.sections.includes(name);
  const name = escapeHtml(view.name);
  const parts: string[] = [];
  parts.push(`<p class="eyebrow">${t("Guild", "Guilde")}</p><h1>${name}</h1>${view.intro ? paragraphs(view.intro) : ""}`);
  // The guild's own actions first: join, then its dungeon scores and the recruitment board.
  const actions = [
    view.recruitment?.inviteUrl ? `<a class="button" href="${escapeHtml(view.recruitment.inviteUrl)}" rel="nofollow noopener">${t("Join us on Discord", "Rejoignez-nous sur Discord")}</a>` : "",
    view.dungeonPage ? `<a class="button ghost" href="${escapeHtml(`${view.dungeonPage}?lang=${view.language}`)}">${t("Dungeon scores", "Scores de donjon")}</a>` : ""
  ].filter(Boolean);
  if (actions.length) parts.push(`<p class="actions">${actions.join("")}</p>`);
  if (on("cores") && view.cores.length) {
    parts.push(`<h2>${t("Raid cores and times", "Cores de raid et horaires")}</h2><div class="cards">${view.cores.map((core) => `<div class="card"><h3>${escapeHtml(core.name)}</h3>`
      + (core.schedule ? `<p>${escapeHtml(core.schedule)} <span class="tag">(${escapeHtml(core.timezone)})</span></p>` : `<p class="muted">${t("Schedule to be announced", "Horaire à venir")}</p>`)
      + (core.realm ? `<p class="tag">${label("Realm", "Royaume")}${escapeHtml(core.realm)}</p>` : "")
      + (core.description ? `<p class="muted">${escapeHtml(core.description)}</p>` : "") + "</div>").join("")}</div>`);
  }
  if (on("loot") && view.cores.length) {
    parts.push(`<h2>${t("Loot system", "Système de butin")}</h2><div class="cards">${view.cores.map((core) => {
      const mode = LOOT[core.lootMode] ?? LOOT["EPGP"]!;
      const details = core.lootMode === "EPGP" ? `<p class="tag">${label("Weekly decay", "Dégradation hebdomadaire")}${Math.round(core.decayPercent * 1000) / 10}${fr ? " %" : "%"}${core.minEp ? ` · ${label("Minimum EP", "EP minimum")}${core.minEp}` : ""}</p>` : "";
      return `<div class="card"><h3>${escapeHtml(core.name)}</h3><p>${escapeHtml(fr ? mode.fr : mode.en)}</p>${details}</div>`;
    }).join("")}</div>`);
  }
  if (on("rosters")) {
    for (const core of view.cores.filter((c) => c.roster?.length)) {
      parts.push(`<h2>${t("Roster", "Roster")} · ${escapeHtml(core.name)}</h2><div class="table-wrap"><table><thead><tr><th>${t("Character", "Personnage")}</th><th>${t("Class", "Classe")}</th><th>${t("Role", "Rôle")}</th></tr></thead><tbody>`
        + core.roster!.map((row) => `<tr><td>${escapeHtml(row.name)}${row.trial ? ` <span class="tag">${t("trial", "essai")}</span>` : ""}${row.bench ? ` <span class="tag">${t("bench", "réserve")}</span>` : ""}</td><td>${escapeHtml(row.className)}</td><td>${fr ? ROLE_LABEL[row.role].fr : ROLE_LABEL[row.role].en}</td></tr>`).join("")
        + "</tbody></table></div>");
    }
  }
  if (on("rankings")) {
    for (const core of view.cores.filter((c) => c.ranking?.length)) {
      parts.push(`<h2>${t("EPGP ranking", "Classement EPGP")} · ${escapeHtml(core.name)}</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>${t("Character", "Personnage")}</th><th class="num">EP</th><th class="num">GP</th><th class="num">${t("Priority", "Priorité")}</th></tr></thead><tbody>`
        + core.ranking!.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.name)}</td><td class="num">${row.ep}</td><td class="num">${row.gp}</td><td class="num">${row.pr.toFixed(2)}</td></tr>`).join("")
        + "</tbody></table></div>");
    }
  }
  if (view.recruitment?.text) parts.push(`<h2>${t("Recruitment", "Recrutement")}</h2>${paragraphs(view.recruitment.text)}`);
  const description = escapeHtml((view.intro ?? t(`${view.name}: raid cores, times and rankings.`, `${view.name} : cores de raid, horaires et classements.`)).replace(/\s+/g, " ").slice(0, 160));
  return `<!doctype html><html lang="${view.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${name} · Guilded</title><meta name="description" content="${description}">${view.indexable ? "" : '<meta name="robots" content="noindex">'}`
    + `<meta property="og:title" content="${name}"><meta property="og:description" content="${description}"><meta property="og:type" content="website">`
    + `<style>${PAGE_STYLE}
${SITE_HEADER_STYLE}</style></head><body><main>${siteHeader(view.language, `/g/${view.slug}/`)}`
    + breadcrumbs(view.language, [[t("Guilds", "Guildes"), `/leaderboards/guilds/?lang=${view.language}`], [view.name, null]], escapeHtml) + parts.join("")
    + `<footer>${t("Guild page made with", "Page de guilde créée avec")} <a href="https://guilded.kcaron.top/">Guilded</a>. ${t("Not affiliated with Blizzard Entertainment.", "Sans affiliation avec Blizzard Entertainment.")}</footer></main></body></html>`;
}

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found · Guilded</title><style>${PAGE_STYLE}</style></head><body><main><h1>Page not found</h1><p class="muted">This guild page does not exist or is not published. / Cette page de guilde n'existe pas ou n'est pas publiée.</p><p><a href="/leaderboards/guilds/">Guilds / Guildes</a> · <a href="https://guilded.kcaron.top/">Guilded</a></p></main></body></html>`;

export interface PageResponse { status: number; headers: Record<string, string>; body: string }

// Every page server in this process, so an officer's change (/guildpage) shows at once here.
const pageServers = new Set<{ forget(slug?: string): void }>();
export function forgetGuildPage(slug?: string): void { for (const server of pageServers) server.forget(slug); }

// Answers /g/... requests from a small in-memory copy, so repeat visitors never reach Postgres.
// Officer changes show within `ttlMs`.
export function createGuildPageServer(load: (slug: string) => Promise<GuildPageView | null>, options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const maxEntries = options.maxEntries ?? 200;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; html: string | null }>();
  const security = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", "referrer-policy": "strict-origin-when-cross-origin", "x-content-type-options": "nosniff" };
  const server = { forget(slug?: string) { if (slug) cache.delete(slug); else cache.clear(); } };
  pageServers.add(server);
  const html = (status: number, body: string, maxAge: number): PageResponse => ({ status, body, headers: { ...security, "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${maxAge}` } });
  return {
    async respond(method: string, pathname: string): Promise<PageResponse | null> {
      if (pathname !== "/g" && !pathname.startsWith("/g/")) return null;
      if (method !== "GET" && method !== "HEAD") return { status: 405, headers: { ...security, allow: "GET, HEAD" }, body: "" };
      const match = /^\/g\/([^/]+)(\/?)$/.exec(pathname);
      if (!match || !isPageSlug(match[1]!)) return html(404, NOT_FOUND, 60);
      if (!match[2]) return { status: 301, headers: { ...security, location: `/g/${match[1]}/`, "cache-control": "public, max-age=3600" }, body: "" };
      const slug = match[1]!;
      let entry = cache.get(slug);
      if (!entry || now() - entry.at >= ttlMs) {
        const view = await load(slug);
        entry = { at: now(), html: view ? renderGuildPage(view) : null };
        cache.delete(slug);
        cache.set(slug, entry);
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      }
      return entry.html ? html(200, entry.html, 300) : html(404, NOT_FOUND, 60);
    },
    forget: server.forget
  };
}

const TEXT_LIMIT = 2_000;
export const GUILD_PAGE_USAGE = "Use: npm run guild-page -- status SERVER_ID | create SERVER_ID [slug] | sections SERVER_ID cores,loot,rosters,rankings,recruitment"
  + " | intro SERVER_ID \"text\" | recruitment SERVER_ID \"text\" | invite SERVER_ID URL|none | index SERVER_ID on|off | publish SERVER_ID | unpublish SERVER_ID";

// Owner-side editing until officers get /guildpage (design step 2). Returns a short summary.
export async function editGuildPage(database: PrismaClient, action: string, discordId: string | undefined, value?: string): Promise<string> {
  if (!discordId || !/^\d{17,20}$/.test(discordId)) throw new Error(GUILD_PAGE_USAGE);
  const guild = await database.guild.findUnique({ where: { discordId }, select: { id: true, name: true, page: true } });
  if (!guild) throw new Error("This server has no Guilded data yet. Run /setup start in it first.");
  const text = (label: string) => {
    const trimmed = (value ?? "").trim();
    if (trimmed.length > TEXT_LIMIT) throw new Error(`${label} is limited to ${TEXT_LIMIT} characters.`);
    return trimmed || null;
  };
  let page = guild.page;
  if (action === "create") {
    if (page) throw new Error(`This server already has a page: /g/${page.slug}/`);
    const slug = value?.trim() || slugFromName(guild.name);
    if (!isPageSlug(slug)) throw new Error("Use 1-40 lowercase letters, digits or dashes for the address.");
    if (await database.guildPage.findUnique({ where: { slug } })) throw new Error(`/g/${slug}/ is already taken. Choose another address.`);
    page = await database.guildPage.create({ data: { guildId: guild.id, slug } });
  } else if (action !== "status") {
    if (!page) throw new Error("Create the page first: npm run guild-page -- create SERVER_ID");
    const data =
      action === "sections" ? { sections: parseSections(value ?? "") }
      : action === "intro" ? { intro: text("The intro") }
      : action === "recruitment" ? { recruitment: text("The recruitment text") }
      : action === "invite" ? { inviteUrl: !value || value === "none" ? null : checkInviteUrl(value) }
      : action === "index" && (value === "on" || value === "off") ? { indexable: value === "on" }
      : action === "publish" ? { published: true, publishedAt: page.publishedAt ?? new Date() }
      : action === "unpublish" ? { published: false }
      : null;
    if (!data) throw new Error(GUILD_PAGE_USAGE);
    page = await database.guildPage.update({ where: { id: page.id }, data });
  }
  if (!page) return `${guild.name} has no page yet.`;
  return [
    `${guild.name}: /g/${page.slug}/ is ${page.published ? "published" : "a draft (not public)"}.`,
    `Sections: ${page.sections.length ? page.sections.join(", ") : "none"}. Search engines: ${page.indexable ? "allowed" : "asked not to index"}.`,
    `Intro: ${page.intro ? "set" : "empty"}. Recruitment: ${page.recruitment ? "set" : "empty"}. Invite: ${page.inviteUrl ?? "none"}.`,
    "Changes appear on the live page within about 10 minutes (bot and Cloudflare caches)."
  ].join("\n");
}
