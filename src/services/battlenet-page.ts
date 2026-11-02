import { randomBytes } from "node:crypto";
import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml, link, options } from "./web-layout.js";
import { hashToken } from "./web-auth.js";
import { battleNetAuthorize, BNET_EDITIONS, BNET_REGIONS, discoverAllBattleNet, discoverBattleNet, discoveredKey, type BattleNetConfig, type BattleNetDiscovery, type BnetEdition, type BnetRegion } from "./battlenet.js";
import { selectDiscovered, type BattleNetStore } from "./battlenet-store.js";
import type { AutoLinked } from "./battlenet-autolink.js";
import { linkStatusLines, type LinkStatus } from "./link-status.js";

/** Optional hooks that turn a connection into guild links; absent in tests and when no database is wired. */
export interface BattleNetLinking {
  discoverAll: typeof discoverAllBattleNet;
  autoLink(discordUserId: string, characters: Parameters<typeof discoveredKey>[0][]): Promise<AutoLinked[]>;
  recent(discordUserId: string): Promise<AutoLinked[]>;
  undo(discordUserId: string): Promise<number>;
  status(discordUserId: string): Promise<LinkStatus>;
}

interface Pending { accountId: string; session: string; expires: number; region: BnetRegion; edition: BnetEdition; discovery?: BattleNetDiscovery; consuming?: boolean; auto?: boolean }
const LIFETIME = 10 * 60_000;

export function createBattleNetPage(store: BattleNetStore, config: BattleNetConfig | null, discover = discoverBattleNet, linking?: BattleNetLinking): WebRoute {
  const pending = new Map<string, Pending>();
  function create(row: Pending) {
    const key = randomBytes(32).toString("base64url");
    const hashed = hashToken(key);
    pending.set(hashed, row);
    setTimeout(() => pending.delete(hashed), LIFETIME).unref();
    return key;
  }
  return async (ctx, kit) => {
    if (!ctx.request.path.startsWith("/me/battlenet")) return null;
    if (!ctx.account || !ctx.sessionToken) return kit.signInPrompt();
    const { t, lang } = ctx;
    const now = ctx.now.getTime();
    for (const [key, value] of pending) if (value.expires <= now) pending.delete(key);
    const session = hashToken(ctx.sessionToken);
    const hidden = `<input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}">`;
    const title = t("Battle.net connection", "Connexion Battle.net");
    const fail = (message: string, status = 400) => kit.page(status, title, `<h1>${title}</h1><p>${escapeHtml(message)}</p><p><a href="${link("/me/battlenet", lang)}">${t("Back to connections", "Revenir aux connexions")}</a></p>`, { noindex: true });
    const find = (key: string) => {
      const row = pending.get(hashToken(key));
      return row && !row.consuming && row.accountId === ctx.account!.id && row.session === session && row.expires > now ? row : null;
    };
    const path = ctx.request.path;
    if (path === "/me/battlenet/start" && ctx.request.method === "POST") {
      if (!config) return fail(t("Battle.net is not configured on this server. Discord and addon syncing still work.", "Battle.net n'est pas configuré sur ce serveur. Discord et la synchronisation de l'addon fonctionnent toujours."), 503);
      const region = ctx.form!.get("region") as BnetRegion;
      const edition = ctx.form!.get("gameEdition") as BnetEdition;
      if (!BNET_REGIONS.includes(region) || !BNET_EDITIONS.includes(edition)) return fail(t("Choose a supported region and edition.", "Choisissez une région et une édition prises en charge."));
      if (pending.size >= 2000 || [...pending.values()].filter(row => row.accountId === ctx.account!.id).length >= 5) return fail(t("Too many pending connections. Try again in ten minutes.", "Trop de connexions en attente. Réessayez dans dix minutes."), 429);
      const state = create({ accountId: ctx.account.id, session, region, edition, expires: now + LIFETIME });
      // Chromium applies form-action to the redirect chain of a POST. Keep the
      // strict same-origin policy and finish the handoff with ordinary navigation.
      return kit.page(200, title, `<h1>${title}</h1><p>${t("Continue on Blizzard's website to choose what Guilded can access. Your characters are not saved until you confirm your selection here.", "Continuez sur le site de Blizzard pour choisir les accès de Guilded. Vos personnages ne sont enregistrés qu'après confirmation de votre sélection ici.")}</p><p><a class="button" rel="noreferrer" href="${escapeHtml(battleNetAuthorize(config, state))}">${t("Continue to Battle.net", "Continuer vers Battle.net")}</a></p>`, { noindex: true });
    }
    if (path === "/me/battlenet/connect" && ["GET", "HEAD"].includes(ctx.request.method)) {
      // The one-click entry (Discord welcome button, /me/): no region or edition to choose.
      if (!config || !linking) return fail(t("Battle.net is not set up on this server yet. Your addon and the Guilded app still work.", "Battle.net n'est pas encore configuré sur ce serveur. L'addon et l'application Guilded fonctionnent toujours."), 503);
      if (pending.size >= 2000 || [...pending.values()].filter(row => row.accountId === ctx.account!.id).length >= 5) return fail(t("Too many pending connections. Try again in ten minutes.", "Trop de connexions en attente. Réessayez dans dix minutes."), 429);
      const state = create({ accountId: ctx.account.id, session, region: "us", edition: "retail", auto: true, expires: now + LIFETIME });
      return kit.page(200, title, `<h1>${title}</h1><p>${t("Blizzard will ask you to allow Guilded to see your World of Warcraft characters. That is all Guilded asks for. Your characters in this server are linked for you, and you can undo it.", "Blizzard va vous demander d'autoriser Guilded à voir vos personnages de World of Warcraft. C'est tout ce que Guilded demande. Vos personnages de ce serveur sont liés pour vous, et vous pouvez annuler.")}</p><p><a class="button" rel="noreferrer" href="${escapeHtml(battleNetAuthorize(config, state))}">${t("Continue to Battle.net", "Continuer vers Battle.net")}</a></p>`, { noindex: true });
    }
    if (path === "/me/battlenet/undo" && ctx.request.method === "POST" && linking) {
      await linking.undo(ctx.account.discordUserId);
      return kit.redirect(link("/me/battlenet", lang));
    }
    if (path === "/me/battlenet/callback" && ctx.request.method === "GET") {
      const key = ctx.request.query.get("state") ?? "";
      const row = find(key);
      if (!row || row.discovery) return fail(t("This connection expired or belongs to another browser session.", "Cette connexion a expiré ou appartient à une autre session du navigateur."));
      row.consuming = true; // Retain a cancellation marker while the provider request is in flight.
      const code = ctx.request.query.get("code");
      if (!config || !code || code.length > 2048 || ctx.request.query.has("error")) return fail(t("Battle.net connection was cancelled. Nothing was changed.", "La connexion Battle.net a été annulée. Rien n'a changé."));
      if (row.auto && linking) {
        try {
          const all = await linking.discoverAll(config, code);
          pending.delete(hashToken(key));
          let saved = 0;
          for (const discovery of all.found) {
            try { await store.save(ctx.account.id, discovery, discovery.characters.map(discoveredKey), null); saved++; } catch { /* one edition conflicting must not lose the rest */ }
          }
          const found = all.found.flatMap(d => d.characters);
          if (saved) await linking.autoLink(ctx.account.discordUserId, found);
          return kit.redirect(link("/me/battlenet", lang, { done: saved ? "1" : "none" }));
        } catch {
          pending.delete(hashToken(key));
          return fail(t("Battle.net did not answer. Nothing was changed. Try again later; the addon and the Guilded app still work.", "Battle.net n'a pas répondu. Rien n'a changé. Réessayez plus tard; l'addon et l'application Guilded fonctionnent toujours."), 502);
        }
      }
      try {
        const discovery = await discover(config, code, row.region, row.edition);
        if (pending.get(hashToken(key)) !== row) return fail(t("This connection was cancelled.", "Cette connexion a été annulée."));
        pending.delete(hashToken(key));
        const preview = create({ ...row, consuming: false, discovery, expires: now + LIFETIME });
        return kit.redirect(link("/me/battlenet", lang, { preview }));
      } catch {
        pending.delete(hashToken(key));
        return fail(t("Battle.net could not provide characters for this region and edition. Try again later; addon sync still works.", "Battle.net n'a pas pu fournir les personnages de cette région et de cette édition. Réessayez plus tard; la synchronisation de l'addon fonctionne toujours."), 502);
      }
    }
    if (path === "/me/battlenet/confirm" && ctx.request.method === "POST") {
      const key = ctx.form!.get("preview") ?? "";
      const row = find(key);
      if (!row?.discovery) return fail(t("Discover your characters again; this preview expired.", "Recherchez à nouveau vos personnages; cet aperçu a expiré."));
      const selected = ctx.form!.getAll("characters");
      const main = ctx.form!.get("main") || null;
      try { selectDiscovered(row.discovery, selected, main); } catch { return fail(t("Select your main in the character list as well.", "Sélectionnez aussi votre personnage principal dans la liste.")); }
      pending.delete(hashToken(key));
      try { await store.save(ctx.account.id, row.discovery, selected, main); }
      catch { return fail(t("The selection could not be saved. An account or character may already be linked elsewhere. Reconnect to retry; existing ownership was preserved.", "La sélection n'a pas pu être enregistrée. Un compte ou personnage est peut-être déjà lié ailleurs. Reconnectez-vous pour réessayer; les liens existants sont conservés."), 409); }
      return kit.redirect(link("/me/battlenet", lang));
    }
    if (path === "/me/battlenet/unlink" && ctx.request.method === "POST") {
      if (ctx.form!.get("confirm") !== "yes") return fail(t("Confirm disconnecting Battle.net.", "Confirmez la déconnexion de Battle.net."));
      for (const [key, row] of pending) if (row.accountId === ctx.account.id) pending.delete(key);
      await store.unlink(ctx.account.id);
      return kit.redirect(link("/me/battlenet", lang));
    }
    if (path !== "/me/battlenet" || !["GET", "HEAD"].includes(ctx.request.method)) return null;
    const connected = await store.get(ctx.account.id);
    const previewKey = ctx.request.query.get("preview") ?? "";
    const preview = find(previewKey)?.discovery;
    const strong = (line: string) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    let top = "";
    if (linking) {
      const recent = await linking.recent(ctx.account.discordUserId);
      const done = ctx.request.query.get("done");
      if (done === "1") top += `<p class="notice">${recent.length
        ? t("Done. These characters are now linked for you:", "C'est fait. Ces personnages sont maintenant liés pour vous :")
        : t("Connected. None of your characters has appeared in a guild yet; they link by themselves the first time your addon or the Guilded app reports them.", "Connecté. Aucun de vos personnages n'est encore apparu dans une guilde; ils se lieront d'eux-mêmes dès que votre addon ou l'application Guilded les signalera.")}</p>`;
      else if (done === "none") top += `<p class="notice">${t("Blizzard did not list any character for the games it covers. Nothing was changed. The addon and the Guilded app link your characters instead.", "Blizzard n'a listé aucun personnage pour les jeux qu'elle couvre. Rien n'a changé. L'addon et l'application Guilded lient vos personnages à la place.")}</p>`;
      if (recent.length) top += `<ul>${recent.map(c => `<li>${escapeHtml(c.name)} — ${escapeHtml(c.realm)} · ${escapeHtml(c.guildName)}${c.isMain ? ` · ${t("Main", "Principal")}` : ""}</li>`).join("")}</ul><form method="post" action="/me/battlenet/undo">${hidden}<button>${t("Undo these links", "Annuler ces liens")}</button></form>`;
      top += `<p>${linkStatusLines(await linking.status(ctx.account.discordUserId), lang, ctx.now).map(line => strong(line)).join("<br>")}</p>`;
      if (config) top += `<p><a class="button" href="${link("/me/battlenet/connect", lang)}">${connected ? t("Refresh from Battle.net", "Actualiser depuis Battle.net") : t("Connect Battle.net", "Connecter Battle.net")}</a></p><p>${t("Guilded only asks to see your characters. Disconnect below at any time.", "Guilded demande seulement à voir vos personnages. Déconnectez-vous ci-dessous à tout moment.")}</p>`;
    }
    let body = `<h1>${title}</h1>${top}<p>${t("Optional: discover characters and verify ownership with Blizzard. Discord still controls guild access. Addon data still syncs through your companion.", "Facultatif : découvrez vos personnages et vérifiez leur propriétaire auprès de Blizzard. Discord gère toujours l'accès aux guildes. Les données de l'addon passent toujours par le compagnon.")}</p><p>${t("Only characters you select are saved, privately. No alternate character is published by connecting Battle.net. Your account main below does not change guild mains, points or permissions. Blizzard tokens are discarded after discovery; reconnect to refresh verification.", "Seuls les personnages sélectionnés sont enregistrés, en privé. La connexion Battle.net ne publie aucun personnage secondaire. Le principal du compte ci-dessous ne change ni les principaux de guilde, ni les points, ni les permissions. Les jetons Blizzard sont supprimés après la recherche; reconnectez-vous pour actualiser la vérification.")}</p>`;
    if (preview) {
      const chosen = new Set(connected?.characters.map(discoveredKey) ?? []);
      body += `<h2>${t("Choose characters to connect", "Choisissez les personnages à connecter")} · ${escapeHtml(preview.battleTag)}</h2><p>${escapeHtml(preview.region)} · ${escapeHtml(preview.gameEdition)}</p><form method="post" action="/me/battlenet/confirm">${hidden}<input type="hidden" name="preview" value="${escapeHtml(previewKey)}">`
        + preview.characters.map(c => `<p><label><input type="checkbox" name="characters" value="${discoveredKey(c)}"${chosen.has(discoveredKey(c)) ? " checked" : ""}> ${escapeHtml(c.name)} — ${escapeHtml(c.realm)}</label></p>`).join("")
        + `<label>${t("Account main", "Principal du compte")}<select name="main">${options([{ value: "", label: t("Keep my current choice", "Conserver mon choix actuel") }, ...preview.characters.map(c => ({ value: discoveredKey(c), label: `${c.name} — ${c.realm}` }))], "")}</select></label><p>${t("Unselected characters in this region and edition will not be retained. Other editions are kept.", "Les personnages non sélectionnés de cette région et de cette édition ne seront pas conservés. Les autres éditions sont conservées.")}</p><button>${t("Confirm selected characters", "Confirmer les personnages sélectionnés")}</button></form>`;
    }
    if (connected) body += `<h2>${escapeHtml(connected.battleTag)}</h2><ul>${connected.characters.map(c => `<li>${escapeHtml(c.name)} — ${escapeHtml(c.realm)} · ${c.region} · ${c.gameEdition}${c.isMain ? ` · ${t("Main", "Principal")}` : ""} · ${t("Verified", "Vérifié le")} ${escapeHtml(c.verifiedAt.toISOString().slice(0, 10))}</li>`).join("")}</ul><form method="post" action="/me/battlenet/unlink">${hidden}<label><input type="checkbox" name="confirm" value="yes" required>${t("Remove my Battle.net connection and its private character selections", "Retirer ma connexion Battle.net et sa sélection privée de personnages")}</label><button>${t("Disconnect Battle.net", "Déconnecter Battle.net")}</button></form>`;
    if (config) body += `<h2>${t("Discover or refresh characters", "Découvrir ou actualiser les personnages")}</h2><form method="post" action="/me/battlenet/start">${hidden}<label>${t("Region", "Région")}<select name="region">${options(BNET_REGIONS.map(value => ({ value, label: value.toUpperCase() })), "us")}</select></label><label>${t("Edition", "Édition")}<select name="gameEdition">${options(BNET_EDITIONS.map(value => ({ value, label: value })), "retail")}</select></label><p>${t("Availability depends on Blizzard's API for each edition. Forever discovery is not enabled until its API is verified. Existing addon pairing works for every supported edition.", "La disponibilité dépend de l'API Blizzard pour chaque édition. La recherche Forever reste désactivée tant que son API n'est pas vérifiée. Le jumelage existant de l'addon fonctionne pour toutes les éditions prises en charge.")}</p><button>${t("Continue to Battle.net", "Continuer vers Battle.net")}</button></form>`;
    else body += `<p>${t("The server owner has not configured Battle.net yet. Discord and addon sync are available.", "Le propriétaire du serveur n'a pas encore configuré Battle.net. Discord et la synchronisation de l'addon sont disponibles.")}</p>`;
    return kit.page(200, title, body + `<p><a href="${link("/me/connections", lang)}">${t("Manage devices", "Gérer les appareils")}</a></p>`, { noindex: true });
  };
}

/** The /me/ block: the plain status line and the one Connect button. */
export function battleNetMeSection(linking: BattleNetLinking | undefined, config: BattleNetConfig | null) {
  return async (ctx: WebContext): Promise<string> => {
    if (!ctx.account || !linking) return "";
    const { t, lang } = ctx;
    const lines = linkStatusLines(await linking.status(ctx.account.discordUserId), lang, ctx.now)
      .map(line => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")).join("<br>");
    const button = config ? `<p><a class="button" href="${link("/me/battlenet/connect", lang)}">${t("Connect Battle.net", "Connecter Battle.net")}</a></p>` : "";
    return `<h2>${t("Your characters", "Vos personnages")}</h2><p>${lines}</p>${button}`;
  };
}
