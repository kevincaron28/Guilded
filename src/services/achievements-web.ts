import type { PrismaClient } from "../generated/prisma/client.js";
import { ACHIEVEMENTS, GAME_LABEL, TIER_COLOR, TIER_LABEL, type AchievementGame } from "./achievements-catalogue.js";
import { storedAchievements, syncMemberAchievements } from "./achievements.js";
import { achievementsCard } from "./end-cards.js";
import { scoreCardResponse } from "./score-card.js";
import { escapeHtml, link } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

// The website view: a share-card image plus the full list, on the member's own page (/me/) and on their
// public player page. The public page shows what is already stored; only the signed-in owner's /me/
// view evaluates (and records) newly earned ones. Guilds the site does not serve are never included.

type Db = Pick<PrismaClient, "webAccount" | "member" | "memberAchievement" | "character" | "dungeonRunPlayer" | "raidAttendance" | "communityParticipationDay" | "poeLevelReached" | "poeMapVisit">;
export interface AchievementProgress { earnedAt: Date | null; value: number }

export function createAchievementsWeb(db: Db, allows: (discordGuildId: string) => boolean) {
  const imagePath = (accountId: string) => `/players/${encodeURIComponent(accountId)}/achievements.png`;

  async function members(discordUserId: string) {
    const rows = await db.member.findMany({ where: { discordUserId, status: "ACTIVE", isTest: false }, select: { id: true, guildId: true, guild: { select: { discordId: true } } }, take: 25 });
    return rows.filter(row => allows(row.guild.discordId));
  }

  /** Merged across the account's guilds: the earliest date, the highest value. `evaluate` records new ones. */
  async function progress(discordUserId: string, evaluate: boolean, now: Date): Promise<Map<string, AchievementProgress>> {
    const owned = await members(discordUserId);
    const merged = new Map<string, AchievementProgress>(ACHIEVEMENTS.map(def => [def.id, { earnedAt: null, value: 0 }]));
    const fold = (id: string, earnedAt: Date | null, value: number) => {
      const prev = merged.get(id)!;
      merged.set(id, { earnedAt: earnedAt && (!prev.earnedAt || earnedAt < prev.earnedAt) ? earnedAt : prev.earnedAt, value: Math.max(prev.value, value) });
    };
    if (evaluate) {
      for (const member of owned) for (const row of (await syncMemberAchievements(db, member.guildId, member.id, now)).results) fold(row.def.id, row.earned ? row.earnedAt : null, row.value);
    } else {
      for (const [id, at] of await storedAchievements(db, { memberIds: owned.map(row => row.id) })) fold(id, at, ACHIEVEMENTS.find(def => def.id === id)?.threshold ?? 0);
    }
    return merged;
  }

  function list(ctx: WebContext, data: Map<string, AchievementProgress>, showProgress: boolean): string {
    const { t, lang } = ctx;
    const earned = ACHIEVEMENTS.filter(def => data.get(def.id)?.earnedAt).length;
    const games: AchievementGame[] = ["wow", "guild", "poe2"];
    return `<p>${t(`${earned} of ${ACHIEVEMENTS.length} unlocked. Achievements are worked out from data Guilded already recorded (synced characters, dungeon runs, raid attendance, Discord activity and your own PoE2 log), never self-reported, and they give no points.`, `${earned} sur ${ACHIEVEMENTS.length} débloqués. Les succès sont calculés à partir de données déjà enregistrées par Guilded (personnages synchronisés, donjons, présences aux raids, activité Discord et votre journal PoE2), jamais déclarés, et ne donnent aucun point.`)}</p>`
      + games.map(game => `<h3>${GAME_LABEL[game][lang]}</h3><div class="cards">${ACHIEVEMENTS.filter(def => def.game === game).map(def => {
        const row = data.get(def.id) ?? { earnedAt: null, value: 0 };
        const color = TIER_COLOR[def.tier];
        const status = row.earnedAt ? `${t("Unlocked", "Débloqué")} ${row.earnedAt.toISOString().slice(0, 10)}`
          : showProgress ? `${t("Locked", "Verrouillé")} · ${Math.min(row.value, def.threshold)}/${def.threshold}` : t("Locked", "Verrouillé");
        return `<article class="card" style="border-left:4px solid ${color};${row.earnedAt ? "" : "opacity:.55"}"><h4>${escapeHtml(def[lang].name)}</h4><p>${escapeHtml(def[lang].description)}</p><p class="tag">${TIER_LABEL[def.tier][lang]} · ${escapeHtml(status)}</p></article>`;
      }).join("")}</div>`).join("");
  }

  const route: WebRoute = async (ctx, kit) => {
    const match = /^\/players\/([a-z0-9]{20,40})\/achievements\.png$/.exec(ctx.request.path);
    if (!match) return null;
    if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return kit.page(405, "Method not allowed", "");
    const account = await db.webAccount.findUnique({ where: { id: match[1]! }, select: { discordUserId: true, username: true, displayName: true, publicProfile: true } });
    if (!account?.publicProfile) return kit.page(404, ctx.t("Not found", "Introuvable"), "", { noindex: true });
    const data = await progress(account.discordUserId, false, ctx.now);
    return scoreCardResponse(achievementsCard(account.displayName ?? account.username, ACHIEVEMENTS.map(def => ({ id: def.id, ...data.get(def.id)! })), ctx.lang), ctx.request.method === "HEAD");
  };

  return {
    route,
    imagePath,
    /** On a public player page: stored achievements only. */
    async publicSection(ctx: WebContext, accountId: string): Promise<string> {
      const account = await db.webAccount.findUnique({ where: { id: accountId }, select: { discordUserId: true } });
      if (!account) return "";
      const data = await progress(account.discordUserId, false, ctx.now);
      if (![...data.values()].some(row => row.earnedAt)) return "";
      return `<h2>${ctx.t("Achievements", "Succès")}</h2><p><img src="${link(imagePath(accountId), ctx.lang)}" alt="${ctx.t("Achievements share card", "Carte de partage des succès")}" width="600" height="315" loading="lazy" style="max-width:100%;height:auto"></p>${list(ctx, data, false)}`;
    },
    /** On /me/: evaluates the signed-in member's data and records what is newly earned. */
    async meSection(ctx: WebContext): Promise<string> {
      if (!ctx.account) return "";
      const account = await db.webAccount.findUnique({ where: { id: ctx.account.id }, select: { discordUserId: true, publicProfile: true } });
      if (!account) return "";
      const data = await progress(account.discordUserId, true, ctx.now);
      return `<h2 id="achievements">${ctx.t("My achievements", "Mes succès")}</h2><p><img src="${link(`/me/achievements.png`, ctx.lang)}" alt="${ctx.t("Achievements share card", "Carte de partage des succès")}" width="600" height="315" loading="lazy" style="max-width:100%;height:auto"></p>${list(ctx, data, true)}`
        + (account.publicProfile ? "" : `<p>${ctx.t("Your profile is hidden, so these are not shown publicly.", "Votre profil est masqué : ces succès ne sont pas affichés publiquement.")}</p>`);
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
