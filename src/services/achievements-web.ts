import type { PrismaClient } from "../generated/prisma/client.js";
import { isEditionActive } from "../../companion/active-editions.mjs";
import { ACHIEVEMENTS, ACTIVE_ACHIEVEMENTS, achievementGameVisible, EDITION_LABEL, GAME_LABEL, TIER_COLOR, TIER_LABEL, WOW_EDITIONS, ladderKey } from "./achievements-catalogue.js";
import { badgeLabel, badgeSvg } from "./achievement-badges.js";
import { storedAchievements, syncMemberAchievements } from "./achievements.js";
import { achievementsCard } from "./end-cards.js";
import { scoreCardResponse } from "./score-card.js";
import { escapeHtml, link } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

// The website view: a share-card image plus the full list, on the member's own page (/me/) and on their
// public player page. The public page shows what is already stored; only the signed-in owner's /me/
// view evaluates (and records) newly earned ones. Guilds the site does not serve are never included.

type Db = Pick<PrismaClient, "webAccount" | "guildSettings" | "member" | "memberAchievement" | "character" | "professionSkill" | "dungeonRunPlayer" | "raidAttendance" | "communityParticipationDay" | "poeLevelReached" | "poeMapVisit" | "communityPoint" | "communityHonorAward" | "epgpTransaction" | "memberActivityTotal" | "memberMilestone" | "duelResult" | "recipeKnown" | "craftRequest">;
export interface AchievementProgress { earnedAt: Date | null; value: number }

export function createAchievementsWeb(db: Db, allows: (discordGuildId: string) => boolean) {
  const imagePath = (accountId: string) => `/players/${encodeURIComponent(accountId)}/achievements.png`;

  async function members(discordUserId: string) {
    const rows = await db.member.findMany({ where: { discordUserId, status: "ACTIVE", isTest: false }, select: { id: true, guildId: true, guild: { select: { discordId: true } } }, take: 25 });
    const served = rows.filter(row => allows(row.guild.discordId));
    const off = new Set((await db.guildSettings.findMany({ where: { guildId: { in: served.map(row => row.guildId) }, achievementsEnabled: false }, select: { guildId: true } })).map(row => row.guildId));
    return served.filter(row => !off.has(row.guildId));
  }

  /** Merged across the account's guilds: the earliest date, the highest value. `evaluate` records new ones. */
  async function progress(discordUserId: string, evaluate: boolean, now: Date): Promise<Map<string, AchievementProgress>> {
    const owned = await members(discordUserId);
    const merged = new Map<string, AchievementProgress>(ACHIEVEMENTS.map(def => [def.id, { earnedAt: null, value: 0 }]));
    const fold = (id: string, earnedAt: Date | null, value: number) => {
      const prev = merged.get(id);
      if (!prev) return; // a retired id (still stored, never shown)
      merged.set(id, { earnedAt: earnedAt && (!prev.earnedAt || earnedAt < prev.earnedAt) ? earnedAt : prev.earnedAt, value: Math.max(prev.value, value) });
    };
    if (evaluate) {
      for (const member of owned) for (const row of (await syncMemberAchievements(db, member.guildId, member.id, now)).results) fold(row.def.id, row.earned ? row.earnedAt : null, row.value);
    } else {
      for (const [id, at] of await storedAchievements(db, { memberIds: owned.map(row => row.id) })) fold(id, at, ACHIEVEMENTS.find(def => def.id === id)?.threshold ?? 0);
    }
    return merged;
  }

  // Each tile is a hidden checkbox + label + details panel, so it needs no script (the pages run under a strict
  // CSP): a tap or click (or Space on the focused tile) toggles it, and on a mouse device hover or keyboard focus
  // also shows it. On touch screens the open tile spans the row; with a mouse the panel floats over the rows below.
  const TILE_STYLE = `<style>
.ach-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;position:relative}
.ach{min-width:0}
.ach>input.ach-t{position:absolute;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0}
.ach>label.ach-tile{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;padding:8px 4px;margin:0;border-radius:8px;border:1px solid rgba(128,128,128,.3);border-top-width:3px;height:100%;box-sizing:border-box;cursor:pointer;color:var(--text);font-size:inherit}
.ach>label.ach-tile.ach-locked{opacity:.75}
.ach>input.ach-t:focus-visible+label.ach-tile{outline:2px solid var(--gold);outline-offset:2px}
.ach>.ach-more{display:none;margin-top:6px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);text-align:left;font-size:.85em;line-height:1.4;box-sizing:border-box}
.ach>.ach-more p{margin:4px 0}
.ach>input.ach-t:checked~.ach-more{display:block}
.ach>input.ach-t:checked+label.ach-tile{height:auto}
.ach:has(>input.ach-t:checked){grid-column:1/-1}
@media (hover:hover) and (pointer:fine){
.ach:has(>input.ach-t:checked){grid-column:auto}
.ach>input.ach-t:checked+label.ach-tile{height:100%}
.ach>.ach-more{position:absolute;left:0;right:0;z-index:10;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.ach:hover>.ach-more,.ach>input.ach-t:focus-visible~.ach-more{display:block}
}
</style>`;

  /** A compact badge wall: small tiles grouped by WoW edition, guild and game, earned first, with a progress bar on locked ones, a details panel on each tile and a "next up" strip. */
  function list(ctx: WebContext, data: Map<string, AchievementProgress>, showProgress: boolean): string {
    const { t, lang } = ctx;
    const row = (id: string) => data.get(id) ?? { earnedAt: null, value: 0 };
    // Legacy rows (replaced by the per-edition ones) are listed only when already earned.
    const listed = ACHIEVEMENTS.filter(def => !def.legacy || row(def.id).earnedAt);
    const earned = listed.filter(def => row(def.id).earnedAt).length;
    const track = "height:6px;border-radius:3px;background:rgba(128,128,128,.28);overflow:hidden";
    const bar = (def: (typeof ACHIEVEMENTS)[number], value: number) => `<div style="${track}" role="progressbar" aria-valuemin="0" aria-valuemax="${def.threshold}" aria-valuenow="${Math.min(value, def.threshold)}"><div style="height:100%;width:${Math.round(Math.min(value / def.threshold, 1) * 100)}%;background:${TIER_COLOR[def.tier]}"></div></div>`;
    const statusOf = (def: (typeof ACHIEVEMENTS)[number]) => {
      const r = row(def.id);
      return r.earnedAt ? `${t("Unlocked", "Débloqué")} ${r.earnedAt.toISOString().slice(0, 10)}`
        : showProgress ? `${t("Locked", "Verrouillé")} · ${Math.min(r.value, def.threshold)}/${def.threshold}` : t("Locked", "Verrouillé");
    };
    // The badge is decorative with its accessible name in a title; the name, tier and status are all text too.
    const badge = (def: (typeof ACHIEVEMENTS)[number], size: number) => `<span title="${escapeHtml(badgeLabel(def, Boolean(row(def.id).earnedAt), lang))}" style="flex:none;display:block;width:${size}px;height:${size}px">${badgeSvg(def, Boolean(row(def.id).earnedAt), { size })}</span>`;
    const next = showProgress ? ACTIVE_ACHIEVEMENTS.filter(def => !row(def.id).earnedAt && row(def.id).value > 0 && !(def.rank && ACTIVE_ACHIEVEMENTS.some(other => ladderKey(other) === ladderKey(def) && other.threshold < def.threshold && !row(other.id).earnedAt))).sort((a, b) => row(b.id).value / b.threshold - row(a.id).value / a.threshold).slice(0, 3) : [];
    const nextUp = next.length ? `<h3>${t("Next up", "Prochains succès")}</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">${next.map(def => `<article class="card" style="display:flex;gap:12px;align-items:center;border-left:4px solid ${TIER_COLOR[def.tier]}">${badge(def, 48)}<div style="min-width:0;flex:1"><h4 style="margin:0">${escapeHtml(def[lang].name)}</h4><p style="margin:2px 0 6px;font-size:.85em">${escapeHtml(def[lang].description)}</p>${bar(def, row(def.id).value)}<p class="tag" style="margin:4px 0 0">${escapeHtml(statusOf(def))}</p></div></article>`).join("")}</div>` : "";
    // The details panel: full text, tier, edition, how it is worked out, the date or the progress, and how to share it.
    const details = (def: (typeof ACHIEVEMENTS)[number]) => {
      const r = row(def.id);
      const edition = def.edition ? `<p><strong>${t("Edition", "Édition")}:</strong> ${escapeHtml(EDITION_LABEL[def.edition][lang])} · ${t("only characters of this edition count", "seuls les personnages de cette édition comptent")}</p>` : "";
      const state = r.earnedAt ? `<p><strong>${escapeHtml(statusOf(def))}</strong></p>${showProgress ? `<p>${t("Share it in Discord: run /achievements, then press “Share to channel”.", "Partagez-le sur Discord : lancez /achievements, puis « Partager dans le salon ».")}</p>` : ""}`
        : showProgress ? `<p>${t("Progress", "Progression")}: ${Math.min(r.value, def.threshold)}/${def.threshold}</p>${bar(def, r.value)}` : `<p>${t("Locked", "Verrouillé")}</p>`;
      return `<h4 style="margin:0 0 4px">${escapeHtml(def[lang].name)}</h4><p><strong>${t("How to earn", "Comment l'obtenir")}:</strong> ${escapeHtml(def[lang].description)}</p><p><strong>${t("Tier", "Niveau")}:</strong> ${TIER_LABEL[def.tier][lang]}</p>${edition}${state}`;
    };
    const section = (title: string, defs: readonly (typeof ACHIEVEMENTS)[number][]) => {
      const visible = defs.filter(def => listed.includes(def) && achievementGameVisible(def));
      if (!visible.length) return "";
      const done = visible.filter(def => row(def.id).earnedAt).length;
      const ordered = [...visible.filter(def => row(def.id).earnedAt), ...visible.filter(def => !row(def.id).earnedAt)];
      const tiles = ordered.map(def => {
        const r = row(def.id), id = `ach-${def.id}`;
        return `<div class="ach"><input type="checkbox" class="ach-t" id="${id}" aria-controls="${id}-more" aria-label="${escapeHtml(`${def[lang].name}: ${TIER_LABEL[def.tier][lang]}, ${statusOf(def)}`)}"><label class="ach-tile${r.earnedAt ? "" : " ach-locked"}" for="${id}" title="${escapeHtml(def[lang].description)}" style="border-top-color:${TIER_COLOR[def.tier]}">${badge(def, 56)}<span style="font-size:.8em;font-weight:600;line-height:1.2;overflow-wrap:anywhere">${escapeHtml(def[lang].name)}</span>${!r.earnedAt && showProgress ? `<div style="width:80%">${bar(def, r.value)}</div>` : ""}<span class="tag" style="font-size:.7em">${TIER_LABEL[def.tier][lang]} · ${escapeHtml(statusOf(def))}</span></label><div class="ach-more" id="${id}-more">${details(def)}</div></div>`;
      }).join("");
      return `<h3>${escapeHtml(title)} <small>(${done}/${visible.length})</small></h3><div class="ach-grid">${tiles}</div>`;
    };
    const wow = (GAME_LABEL.wow)[lang];
    return TILE_STYLE + `<p>${t(`${earned} of ${listed.length} unlocked. Achievements are worked out from data Guilded already recorded (synced characters, dungeon runs, raid attendance, Discord activity totals), never self-reported, and they give no points. Tap or hover a badge for details.`, `${earned} sur ${listed.length} débloqués. Les succès sont calculés à partir de données déjà enregistrées par Guilded (personnages synchronisés, donjons, présences aux raids, totaux d'activité Discord), jamais déclarés, et ne donnent aucun point. Touchez ou survolez un badge pour les détails.`)}</p>${nextUp}`
      + WOW_EDITIONS.filter(edition => isEditionActive(edition)).map(edition => section(`${wow} · ${EDITION_LABEL[edition][lang]}`, ACHIEVEMENTS.filter(def => def.edition === edition))).join("")
      + section(GAME_LABEL.guild[lang], ACHIEVEMENTS.filter(def => def.game === "guild"));
  }

  const route: WebRoute = async (ctx, kit) => {
    const match = /^\/players\/([a-z0-9]{20,40})\/achievements\.png$/.exec(ctx.request.path);
    if (!match) return null;
    if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return kit.page(405, "Method not allowed", "");
    const account = await db.webAccount.findUnique({ where: { id: match[1]! }, select: { discordUserId: true, username: true, displayName: true } });
    if (!account) return kit.page(404, ctx.t("Not found", "Introuvable"), "", { noindex: true });
    const data = await progress(account.discordUserId, false, ctx.now);
    return scoreCardResponse(achievementsCard(account.displayName ?? account.username, ACHIEVEMENTS.map(def => ({ id: def.id, ...data.get(def.id)! })), ctx.lang), ctx.request.method === "HEAD");
  };

  return {
    route,
    imagePath,
    /** On a public player page: stored achievements only, except for the signed-in owner, whose own page is evaluated and always shown. */
    async publicSection(ctx: WebContext, accountId: string): Promise<string> {
      const account = await db.webAccount.findUnique({ where: { id: accountId }, select: { discordUserId: true } });
      if (!account) return "";
      const isOwner = ctx.account?.id === accountId;
      const data = await progress(account.discordUserId, isOwner, ctx.now);
      if (!isOwner && ![...data.values()].some(row => row.earnedAt)) return "";
      return `<h2>${ctx.t("Achievements", "Succès")}</h2><p><img src="${link(imagePath(accountId), ctx.lang)}" alt="${ctx.t("Achievements share card", "Carte de partage des succès")}" width="600" height="315" loading="lazy" style="max-width:100%;height:auto"></p>${list(ctx, data, isOwner)}`;
    },
    /** On /me/: evaluates the signed-in member's data and records what is newly earned. */
    async meSection(ctx: WebContext): Promise<string> {
      if (!ctx.account) return "";
      const account = await db.webAccount.findUnique({ where: { id: ctx.account.id }, select: { discordUserId: true } });
      if (!account) return "";
      const data = await progress(account.discordUserId, true, ctx.now);
      return `<h2 id="achievements">${ctx.t("My achievements", "Mes succès")}</h2><p><img src="${link(`/me/achievements.png`, ctx.lang)}" alt="${ctx.t("Achievements share card", "Carte de partage des succès")}" width="600" height="315" loading="lazy" style="max-width:100%;height:auto"></p>${list(ctx, data, true)}`
    },
    /** The signed-in owner's own card image, evaluated fresh. */
    ownerRoute: (async (ctx, kit) => {
      if (ctx.request.path !== "/me/achievements.png") return null;
      if (!ctx.account) return kit.signInPrompt();
      const account = await db.webAccount.findUnique({ where: { id: ctx.account.id }, select: { discordUserId: true, username: true, displayName: true } });
      if (!account) return kit.page(404, ctx.t("Not found", "Introuvable"), "", { noindex: true });
      const data = await progress(account.discordUserId, true, ctx.now);
      return scoreCardResponse(achievementsCard(account.displayName ?? account.username, ACHIEVEMENTS.map(def => ({ id: def.id, ...data.get(def.id)! })), ctx.lang), ctx.request.method === "HEAD");
    }) as WebRoute
  };
}
