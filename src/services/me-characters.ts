import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml, link } from "./web-layout.js";
import { linkStatusLines, type LinkStatus } from "./link-status.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterTrustMap, trustLabel, type CharacterTrust } from "./character-trust.js";

export interface MeCharacter { name: string; isMain: boolean; trust: CharacterTrust }

/** The member's own linked characters (at most 25), each confirmed or only reported (character-trust.ts). */
export function meCharacterList(database: Pick<PrismaClient, "character" | "characterVerifyClaim">) {
  return async (discordUserId: string): Promise<MeCharacter[]> => {
    const rows = await database.character.findMany({
      where: { member: { discordUserId, status: { not: "LEFT" } } },
      select: { id: true, memberId: true, name: true, displayName: true, realm: true, gameEdition: true, isMain: true, confirmedAt: true, member: { select: { guildId: true } } },
      orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 25
    });
    const trust = new Map<string, CharacterTrust>();
    for (const guildId of new Set(rows.map((row) => row.member.guildId))) {
      for (const [id, value] of await characterTrustMap(database, guildId, rows.filter((row) => row.member.guildId === guildId))) trust.set(id, value);
    }
    return rows.map((row) => ({ name: row.displayName || row.name, isMain: row.isMain, trust: trust.get(row.id) ?? "reported" }));
  };
}

// The /me/ "Your characters" block: connected, last synced, what to do next. Characters link through the
// Guilded app (WoW Forever only; Battle.net discovery was removed with the other WoW editions, see
// docs/plans/FOREVER_ONLY_REMOVAL.md). Stored Battle.net selections stay in the database, unread.
export function charactersMeSection(status: (discordUserId: string) => Promise<LinkStatus>, characters?: (discordUserId: string) => Promise<MeCharacter[]>) {
  return async (ctx: WebContext): Promise<string> => {
    if (!ctx.account) return "";
    const { t } = ctx;
    const lines = linkStatusLines(await status(ctx.account.discordUserId), ctx.lang, ctx.now)
      .map(line => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")).join("<br>");
    // A failed list never hides the status lines above it.
    const list = characters ? await characters(ctx.account.discordUserId).catch(() => []) : [];
    const items = list.map((row) => `<li>${row.isMain ? "⭐ " : ""}${escapeHtml(row.name)} · <span class="${row.trust === "confirmed" ? "trust-confirmed" : "trust-reported"}">${escapeHtml(trustLabel(row.trust, ctx.lang))}</span></li>`).join("");
    const note = list.some((row) => row.trust === "reported")
      ? `<p>${t("Reported, not verified: typed in, matched by name, or reported by a guildmate's addon. Your next sync with the Guilded app (or an officer) confirms it.", "Signalé, non vérifié : saisi, reconnu par son nom, ou signalé par l'addon d'un membre. Votre prochaine synchronisation avec l'application Guilded (ou un officier) le confirme.")}</p>`
      : "";
    return `<h2>${t("Your characters", "Vos personnages")}</h2><p>${lines}</p>${items ? `<ul>${items}</ul>${note}` : ""}`;
  };
}

/** Old /me/battlenet links (Discord buttons, bookmarks) land on the characters block of /me/. */
export const legacyBattleNetRedirect: WebRoute = async (ctx, kit) => {
  if (!ctx.request.path.startsWith("/me/battlenet")) return null;
  if (!["GET", "HEAD"].includes(ctx.request.method)) return null;
  return kit.redirect(link("/me/#characters", ctx.lang));
};
