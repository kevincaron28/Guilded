import { randomBytes } from "node:crypto";
import type { WebRoute } from "./web-app.js";
import { escapeHtml, link, options } from "./web-layout.js";
import { hashToken } from "./web-auth.js";
import { battleNetAuthorize, BNET_EDITIONS, BNET_REGIONS, discoverBattleNet, discoveredKey, type BattleNetConfig, type BattleNetDiscovery, type BnetEdition, type BnetRegion } from "./battlenet.js";
import { selectDiscovered, type BattleNetStore } from "./battlenet-store.js";

interface Pending { accountId: string; session: string; expires: number; region: BnetRegion; edition: BnetEdition; discovery?: BattleNetDiscovery; consuming?: boolean }
const LIFETIME = 10 * 60_000;

export function createBattleNetPage(store: BattleNetStore, config: BattleNetConfig | null, discover = discoverBattleNet): WebRoute {
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
    if (path === "/me/battlenet/callback" && ctx.request.method === "GET") {
      const key = ctx.request.query.get("state") ?? "";
      const row = find(key);
      if (!row || row.discovery) return fail(t("This connection expired or belongs to another browser session.", "Cette connexion a expiré ou appartient à une autre session du navigateur."));
      row.consuming = true; // Retain a cancellation marker while the provider request is in flight.
      const code = ctx.request.query.get("code");
      if (!config || !code || code.length > 2048 || ctx.request.query.has("error")) return fail(t("Battle.net connection was cancelled. Nothing was changed.", "La connexion Battle.net a été annulée. Rien n'a changé."));
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
    let body = `<h1>${title}</h1><p>${t("Optional: discover characters and verify ownership with Blizzard. Discord still controls guild access. Addon data still syncs through your companion.", "Facultatif : découvrez vos personnages et vérifiez leur propriétaire auprès de Blizzard. Discord gère toujours l'accès aux guildes. Les données de l'addon passent toujours par le compagnon.")}</p><p>${t("Only characters you select are saved, privately. No alternate character is published by connecting Battle.net. Your account main below does not change guild mains, points or permissions. Blizzard tokens are discarded after discovery; reconnect to refresh verification.", "Seuls les personnages sélectionnés sont enregistrés, en privé. La connexion Battle.net ne publie aucun personnage secondaire. Le principal du compte ci-dessous ne change ni les principaux de guilde, ni les points, ni les permissions. Les jetons Blizzard sont supprimés après la recherche; reconnectez-vous pour actualiser la vérification.")}</p>`;
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
