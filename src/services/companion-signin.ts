import { randomBytes } from "node:crypto";
import { hashCompanionSecret } from "./character-pairing.js";
import type { WebRoute } from "./web-app.js";
import { escapeHtml, link } from "./web-layout.js";
import type { WebAccountView } from "./web-store.js";

// "Sign in with Discord" for the companion (7.2): no code to copy. The companion asks for a
// sign-in request, opens /me/companion?request=… in a browser, and asks again every few seconds.
// On that page the signed-in member checks the short code their companion shows and chooses a
// server (or the public leaderboards); the next poll then returns the same answer a pairing code
// would. Requests live 10 minutes in memory: a bot restart only means signing in again.

const LIFETIME_MS = 10 * 60_000;
const MAX_PENDING = 2_000;
// No 0/O or 1/I: the code is read from one screen and compared on another.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** What the companion receives: the same fields as POST /api/v1/addon-pairings. */
export type SignInGrant = { companionCredential: string; personal: true } | { companionCredential: string; personal?: false; guildDiscordId: string };

interface Pending { confirm: string; expiresAt: number; grant: SignInGrant | null }

export function confirmCode(bytes = randomBytes(6)): string {
  const letters = [...bytes].map((byte) => LETTERS[byte % LETTERS.length]).join("");
  return `${letters.slice(0, 3)}-${letters.slice(3, 6)}`;
}

export function createCompanionSignIn(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const pending = new Map<string, Pending>();

  function sweep() {
    const at = now();
    for (const [key, entry] of pending) if (entry.expiresAt <= at) pending.delete(key);
  }
  const find = (requestId: unknown) => {
    if (typeof requestId !== "string" || requestId.length < 32 || requestId.length > 100) return null;
    const entry = pending.get(hashCompanionSecret(requestId));
    return entry && entry.expiresAt > now() ? entry : null;
  };

  return {
    /** A new request. requestId is the companion's secret; only its hash is kept. */
    start(): { requestId: string; confirm: string; expiresAt: Date } | null {
      sweep();
      if (pending.size >= MAX_PENDING) return null;
      const requestId = randomBytes(32).toString("base64url");
      const confirm = confirmCode();
      const expiresAt = now() + LIFETIME_MS;
      pending.set(hashCompanionSecret(requestId), { confirm, expiresAt, grant: null });
      return { requestId, confirm, expiresAt: new Date(expiresAt) };
    },
    /** The code the approval page shows, while the request is still open. */
    confirmFor(requestId: unknown): string | null {
      const entry = find(requestId);
      return entry && !entry.grant ? entry.confirm : null;
    },
    /** Stores the answer for the companion. Only once per request. */
    approve(requestId: unknown, grant: SignInGrant): boolean {
      const entry = find(requestId);
      if (!entry || entry.grant) return false;
      entry.grant = grant;
      return true;
    },
    /** "pending" until approved; the grant is handed out once, then forgotten. */
    poll(requestId: unknown): SignInGrant | "pending" | "expired" {
      const entry = find(requestId);
      if (!entry) return "expired";
      if (!entry.grant) return "pending";
      pending.delete(hashCompanionSecret(requestId as string));
      return entry.grant;
    }
  };
}
export type CompanionSignIn = ReturnType<typeof createCompanionSignIn>;

// --- /me/companion: the page the companion opens -------------------------------------------------

export interface SignInPageDeps {
  signIn: CompanionSignIn;
  /** Approved servers with the Guilded bot where this Discord user is a member right now. */
  servers(discordUserId: string): Promise<{ discordId: string; name: string }[]>;
  /** A guild companion credential, or null when the user is not (or no longer) an active member. */
  issueGuild(account: WebAccountView, guildDiscordId: string): Promise<string | null>;
  issuePersonal(accountId: string): Promise<string>;
}

export function companionSignInRoute(deps: SignInPageDeps): WebRoute {
  return async (ctx, kit) => {
    if (ctx.request.path !== "/me/companion") return null;
    const { t, lang } = ctx;
    const requestId = (ctx.request.method === "POST" ? ctx.form?.get("request") : ctx.request.query.get("request")) ?? "";
    const title = t("Connect your companion", "Relier votre compagnon");
    const confirm = deps.signIn.confirmFor(requestId);
    if (!confirm) {
      return kit.page(410, title, `<h1>${t("This sign-in expired", "Cette connexion a expiré")}</h1><p>${t("Go back to your companion and choose Sign in with Discord again.", "Revenez au compagnon et choisissez de nouveau Connexion avec Discord.")}</p>`, { noindex: true });
    }
    if (!ctx.account) {
      const back = `/me/companion?request=${encodeURIComponent(requestId)}&lang=${lang}`;
      return kit.page(401, title, `<h1>${title}</h1><p>${t("Sign in with your Discord account to connect the Guilded companion. Guilded only reads your Discord name and ID.", "Connectez-vous avec votre compte Discord pour relier le compagnon Guilded. Guilded ne lit que votre nom et votre identifiant Discord.")}</p><p><a class="button" href="${link("/auth/login", lang, { return: back })}">${t("Sign in with Discord", "Connexion avec Discord")}</a></p>`, { noindex: true });
    }
    const servers = await deps.servers(ctx.account.discordUserId);
    if (ctx.request.method === "POST") {
      const choice = ctx.form?.get("choice") ?? "";
      let grant: SignInGrant | null = null;
      if (choice === "personal") grant = { companionCredential: await deps.issuePersonal(ctx.account.id), personal: true };
      else if (servers.some((server) => server.discordId === choice)) {
        const credential = await deps.issueGuild(ctx.account, choice);
        if (credential) grant = { companionCredential: credential, guildDiscordId: choice };
      }
      if (!grant) return kit.page(400, title, `<h1>${t("That choice is not available", "Ce choix n'est pas disponible")}</h1><p><a href="${link("/me/companion", lang, { request: requestId })}">${t("Go back and choose again", "Revenir et choisir de nouveau")}</a></p>`, { noindex: true });
      if (!deps.signIn.approve(requestId, grant)) return kit.page(410, title, `<h1>${t("This sign-in expired", "Cette connexion a expiré")}</h1><p>${t("Go back to your companion and choose Sign in with Discord again.", "Revenez au compagnon et choisissez de nouveau Connexion avec Discord.")}</p>`, { noindex: true });
      const where = grant.personal ? t("the public dungeon leaderboards", "les classements publics des donjons") : escapeHtml(servers.find((server) => server.discordId === choice)?.name ?? "");
      return kit.page(200, title, `<p class="eyebrow">${t("Guilded companion", "Compagnon Guilded")}</p><h1>${t("Companion connected", "Compagnon relié")}</h1><p>${t("Your companion is now linked to", "Votre compagnon est maintenant relié à")} <strong>${where}</strong>. ${t("You can close this tab and go back to the companion.", "Vous pouvez fermer cet onglet et revenir au compagnon.")}</p>`, { noindex: true });
    }
    const radio = (value: string, label: string, hint: string, checked: boolean) =>
      `<label class="choice"><input type="radio" name="choice" value="${escapeHtml(value)}"${checked ? " checked" : ""}> <strong>${label}</strong><br><span class="muted">${hint}</span></label>`;
    const choices = servers.map((server, index) => radio(server.discordId, escapeHtml(server.name), t("Sync your guild's addon data and standings with this Discord server.", "Synchronisez les données de l'addon et les classements de guilde avec ce serveur Discord."), index === 0)).join("")
      + radio("personal", t("Public dungeon leaderboards only", "Classements publics des donjons seulement"), t("No guild needed: your finished dungeon runs go to the public leaderboards.", "Aucune guilde requise : vos donjons terminés vont aux classements publics."), servers.length === 0);
    const body = `<style>.choice{display:block;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0;color:var(--text);font-size:16px}.choice input{width:auto}</style>`
      + `<p class="eyebrow">${t("Guilded companion", "Compagnon Guilded")}</p><h1>${title}</h1>`
      + `<p>${t("Your companion shows this code:", "Votre compagnon affiche ce code :")}</p><p class="code">${escapeHtml(confirm)}</p>`
      + `<p class="notice">${t("Only continue if it is the same code, on your own companion. If someone sent you this link, close the page.", "Continuez seulement si c'est le même code, sur votre propre compagnon. Si quelqu'un vous a envoyé ce lien, fermez la page.")}</p>`
      + `<form method="post" action="/me/companion"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="request" value="${escapeHtml(requestId)}">`
      + `<h2>${t("Link it to", "Le relier à")}</h2>${choices}`
      + (servers.length ? "" : `<p class="muted">${t("No Discord server with the Guilded bot lists you as a member. Addon-only guilds don't need one: the addon syncs in game.", "Aucun serveur Discord avec le bot Guilded ne vous compte comme membre. Les guildes sans Discord n'en ont pas besoin : l'addon se synchronise en jeu.")}</p>`)
      + `<p><button class="button" type="submit">${t("Connect", "Relier")}</button></p></form>`;
    return kit.page(200, title, body, { noindex: true });
  };
}
