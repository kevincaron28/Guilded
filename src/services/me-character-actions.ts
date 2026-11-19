import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuditService } from "./audit.js";
import { setMainCharacter } from "./character-main.js";
import { unlinkNotMine } from "./companion-link-dm.js";
import { markMemberChanged } from "./member-sync-events.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";
import { escapeHtml, link } from "./web-layout.js";

// Make main and Unlink on My Guilded (docs/plans/V9_4_PLAN.md T8B). Two POST routes next to the characters table.
// web-app.ts has already required a signed-in account, this site as origin and the session's CSRF token before a route runs.
// Here: the character id is never trusted. It is re-read and must belong to the signed-in Discord account (and not be
// detached); any other id, existing or not, gets the same 403 without a name. Per account, 20 actions per 10 minutes.
// Unlink asks first (a second form, no script), then runs the Discord panel's own unlink: detached with its history, a
// BLOCKED claim so nothing links it back, and the officer-log line. Undo: the Link step of /character list.

export const ME_CHARACTER_MAIN_PATH = "/me/characters/main";
export const ME_CHARACTER_UNLINK_PATH = "/me/characters/unlink";
const ID = /^[a-z0-9]{20,40}$/;
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

type Db = Pick<PrismaClient, "character" | "member" | "guildSettings" | "characterVerifyClaim" | "auditLog" | "$transaction">;

/** The notice shown above the table after an action (the redirect carries ?char=<key>). */
export function meCharacterNotice(key: string | null, t: (en: string, fr: string) => string): { text: string; error: boolean } | null {
  switch (key) {
    case "main": return { text: t("Main character changed.", "Personnage principal changé."), error: false };
    case "unlinked": return { text: t("Character unlinked. To link it back, open /character list in Discord and use the Link step (it lists your own unlinked characters).", "Personnage délié. Pour le relier, ouvrez /character list dans Discord et utilisez l'étape Lier (elle liste vos propres personnages déliés)."), error: false };
    case "gone": return { text: t("That character was already unlinked.", "Ce personnage était déjà délié."), error: true };
    case "slow": return { text: t("Too many changes. Wait a few minutes and try again.", "Trop de changements. Attendez quelques minutes et réessayez."), error: true };
    case "failed": return { text: t("That could not be done right now. Try again later.", "Impossible pour le moment. Réessayez plus tard."), error: true };
    default: return null;
  }
}

export function createMeCharacterActions(database: Db, options: { client?: Pick<Client, "guilds"> | undefined; now?: (() => number) | undefined } = {}) {
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();
  // Without a Discord client (not ready, tests) the officer-log post is skipped: unlinkNotMine tolerates a failed guild fetch.
  const client: Pick<Client, "guilds"> = options.client ?? ({ guilds: { fetch: async () => { throw new Error("no client"); } } } as unknown as Pick<Client, "guilds">);
  const audit = createAuditService(database as unknown as PrismaClient);

  function allow(discordUserId: string): boolean {
    const recent = (attempts.get(discordUserId) ?? []).filter((at) => now() - at < WINDOW_MS);
    if (recent.length >= LIMIT) { attempts.set(discordUserId, recent); return false; }
    attempts.set(discordUserId, [...recent, now()]);
    if (attempts.size > 5_000) attempts.clear();
    return true;
  }

  /** The character, only when it is the signed-in account's own and still linked. */
  async function own(ctx: WebContext, id: string) {
    if (!ctx.account || !ID.test(id)) return null;
    const row = await database.character.findUnique({
      where: { id },
      select: { id: true, name: true, displayName: true, className: true, detachedAt: true, member: { select: { id: true, guildId: true, discordUserId: true, status: true } } }
    });
    if (!row || row.detachedAt || row.member.status === "LEFT" || row.member.discordUserId !== ctx.account.discordUserId) return null;
    return row;
  }

  const refuse = (ctx: WebContext, kit: WebKit, status: number): WebResponse => {
    const { t, lang } = ctx;
    return kit.page(status, t("Not allowed", "Non permis"), `<h1>${t("That character is not one of yours", "Ce personnage n'est pas l'un des vôtres")}</h1><p><a href="${escapeHtml(link("/me/", lang))}">${t("Back to my page", "Retour à ma page")}</a></p>`, { noindex: true });
  };
  const back = (ctx: WebContext, kit: WebKit, key: string) => kit.redirect(link("/me/", ctx.lang, { char: key }));

  async function confirmPage(ctx: WebContext, kit: WebKit, row: NonNullable<Awaited<ReturnType<typeof own>>>): Promise<WebResponse> {
    const { t, lang } = ctx;
    const name = escapeHtml(row.displayName || row.name);
    const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}">`;
    const body = `<h1>${t("Unlink this character?", "Délier ce personnage ?")}</h1><p><strong>${name}</strong> ${t("will leave your list on this Discord server. Its history is kept, and the officers see a line in the log. You can link it back later with /character list in Discord.", "quittera votre liste sur ce serveur Discord. Son historique est conservé et les officiers voient une ligne dans le journal. Vous pourrez le relier plus tard avec /character list dans Discord.")}</p>`
      + `<form method="post" action="${escapeHtml(link(ME_CHARACTER_UNLINK_PATH, lang))}">${csrf}<input type="hidden" name="character" value="${escapeHtml(row.id)}"><input type="hidden" name="confirm" value="1">`
      + `<button class="button" type="submit">${t("Yes, unlink", "Oui, délier")}</button> <a href="${escapeHtml(link("/me/", lang))}">${t("Keep it", "Le garder")}</a></form>`;
    return kit.page(200, t("Unlink a character", "Délier un personnage"), body, { noindex: true });
  }

  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path;
    if (path !== ME_CHARACTER_MAIN_PATH && path !== ME_CHARACTER_UNLINK_PATH) return null;
    if (!ctx.account) return kit.signInPrompt();
    // POSTs reach here only from this site, signed in, with the session's CSRF token (web-app.ts checks).
    if (ctx.request.method !== "POST" || !ctx.form) return kit.redirect(link("/me/", ctx.lang));
    const characterId = ctx.form.get("character") ?? "";
    // A refused or unknown id still counts against the limit: the form cannot be used to probe ids.
    if (!allow(ctx.account.discordUserId)) return back(ctx, kit, "slow");
    const row = await own(ctx, characterId);
    if (!row) return refuse(ctx, kit, 403);

    if (path === ME_CHARACTER_MAIN_PATH) {
      try {
        await setMainCharacter(database, row.member.guildId, row.member.id, row.id);
        await audit.record({ guildId: row.member.guildId, actorId: row.member.id, action: "CHARACTER_MAIN_SET", entityId: row.id, metadata: { source: "web", name: row.name } }).catch(() => undefined);
      } catch (error) {
        console.warn("My Guilded: Make main failed:", error instanceof Error ? error.message : String(error));
        return back(ctx, kit, "failed");
      }
      return back(ctx, kit, "main");
    }

    if (ctx.form.get("confirm") !== "1") return confirmPage(ctx, kit, row);
    try {
      // The same unlink as the Discord panel and the DM's "Not mine": detached, BLOCKED claim, officer-log line (worded for the website).
      const result = await unlinkNotMine(database as unknown as Parameters<typeof unlinkNotMine>[0], client, ctx.account.discordUserId, row.id, "web");
      if (!result.undoId) return back(ctx, kit, "gone");
      markMemberChanged({ guildId: row.member.guildId, memberId: row.member.id });
      await audit.record({ guildId: row.member.guildId, actorId: row.member.id, action: "CHARACTER_UNLINKED_WEB", entityId: row.id, metadata: { source: "web", name: row.name } }).catch(() => undefined);
    } catch (error) {
      console.warn("My Guilded: Unlink failed:", error instanceof Error ? error.message : String(error));
      return back(ctx, kit, "failed");
    }
    return back(ctx, kit, "unlinked");
  };

  return { route, allow };
}
