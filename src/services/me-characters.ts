import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml, link } from "./web-layout.js";
import { linkStatusLines, type LinkStatus } from "./link-status.js";

// The /me/ "Your characters" block: connected, last synced, what to do next. Characters link through the
// Guilded app (WoW Forever only; Battle.net discovery was removed with the other WoW editions, see
// docs/plans/FOREVER_ONLY_REMOVAL.md). Stored Battle.net selections stay in the database, unread.
export function charactersMeSection(status: (discordUserId: string) => Promise<LinkStatus>) {
  return async (ctx: WebContext): Promise<string> => {
    if (!ctx.account) return "";
    const { t } = ctx;
    const lines = linkStatusLines(await status(ctx.account.discordUserId), ctx.lang, ctx.now)
      .map(line => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")).join("<br>");
    return `<h2>${t("Your characters", "Vos personnages")}</h2><p>${lines}</p>`;
  };
}

/** Old /me/battlenet links (Discord buttons, bookmarks) land on the characters block of /me/. */
export const legacyBattleNetRedirect: WebRoute = async (ctx, kit) => {
  if (!ctx.request.path.startsWith("/me/battlenet")) return null;
  if (!["GET", "HEAD"].includes(ctx.request.method)) return null;
  return kit.redirect(link("/me/#characters", ctx.lang));
};
