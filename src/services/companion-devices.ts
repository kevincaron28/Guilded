import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebAccountView } from "./web-store.js";
import type { WebContext, WebRoute } from "./web-app.js";
import { cleanDeviceName } from "./character-pairing.js";
import { escapeHtml, link } from "./web-layout.js";

export interface DeviceView { id: string; kind: "guild" | "personal"; name: string; scope: string; createdAt: Date }
export interface DeviceStore {
  list(account: WebAccountView): Promise<DeviceView[]>;
  change(account: WebAccountView, action: "rename" | "revoke" | "revoke-all", kind: string, id: string, name: string): Promise<void>;
}

export function prismaDeviceStore(database: PrismaClient): DeviceStore {
  return {
    async list(account) {
      const [guild, personal] = await Promise.all([
        database.companionCredential.findMany({ where: { revokedAt: null, member: { discordUserId: account.discordUserId } }, include: { member: { select: { guild: { select: { name: true, gameEdition: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 }),
        database.webCompanionCredential.findMany({ where: { accountId: account.id, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 100 })
      ]);
      return [...guild.map(row => ({ id: row.id, kind: "guild" as const, name: row.deviceName, scope: `${row.member.guild.name} · ${row.member.guild.gameEdition}`, createdAt: row.createdAt })),
        ...personal.map(row => ({ id: row.id, kind: "personal" as const, name: row.deviceName, scope: "Public dungeon leaderboards", createdAt: row.createdAt }))];
    },
    async change(account, action, kind, id, name) {
      const data = action === "rename" ? { deviceName: cleanDeviceName(name) } : { revokedAt: new Date() };
      // Every mutation carries ownership in its WHERE, including guessed IDs.
      if (action === "revoke-all" || kind === "guild") await database.companionCredential.updateMany({ where: { ...(action === "revoke-all" ? {} : { id }), revokedAt: null, member: { discordUserId: account.discordUserId } }, data });
      if (action === "revoke-all" || kind === "personal") await database.webCompanionCredential.updateMany({ where: { ...(action === "revoke-all" ? {} : { id }), revokedAt: null, accountId: account.id }, data });
    }
  };
}

export function createDevicePages(store: DeviceStore) {
  const meSection = async (ctx: WebContext) => `<h2>${ctx.t("Connections", "Connexions")}</h2><p><a href="${link("/me/connections", ctx.lang)}">${ctx.t("Manage companion devices", "Gérer les appareils du compagnon")}</a> · <a href="${link("/me/battlenet", ctx.lang)}">${ctx.t("Connect Battle.net and choose characters", "Connecter Battle.net et choisir des personnages")}</a></p>`;
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== "/me/connections") return null;
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    if (ctx.request.method === "POST") {
      const action = ctx.form!.get("action");
      if (!["rename", "revoke", "revoke-all"].includes(action ?? "") || (action === "revoke-all" && ctx.form!.get("confirm") !== "yes")) return kit.page(400, t("Connections", "Connexions"), t("Confirm the action first.", "Confirmez d'abord l'action."));
      await store.change(ctx.account, action as "rename" | "revoke" | "revoke-all", ctx.form!.get("kind") ?? "", ctx.form!.get("id") ?? "", ctx.form!.get("name") ?? "");
      return kit.redirect(link("/me/connections", lang));
    }
    const hidden = `<input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}">`;
    const rows = await store.list(ctx.account);
    const body = `<h1>${t("Your companion devices", "Vos appareils du compagnon")}</h1><p>${t("Each connection has its own access. Disconnect a lost device here; your other devices keep syncing. Disconnecting does not delete game files or guild history.", "Chaque connexion possède son propre accès. Déconnectez ici un appareil perdu; les autres continuent de se synchroniser. La déconnexion ne supprime ni les fichiers du jeu ni l'historique de guilde.")}</p>`
      + rows.map(row => `<section><h2>${escapeHtml(row.name)}</h2><p>${escapeHtml(row.scope)} · ${t("Connected", "Connecté le")} ${escapeHtml(row.createdAt.toISOString().slice(0, 10))}</p><form method="post">${hidden}<input type="hidden" name="id" value="${escapeHtml(row.id)}"><input type="hidden" name="kind" value="${row.kind}"><label>${t("Name", "Nom")}<input name="name" value="${escapeHtml(row.name)}" maxlength="80" required></label><button name="action" value="rename">${t("Rename", "Renommer")}</button> <button name="action" value="revoke">${t("Disconnect this connection", "Déconnecter cette connexion")}</button></form></section>`).join("")
      + (rows.length ? `<h2>${t("Disconnect every device", "Déconnecter tous les appareils")}</h2><form method="post">${hidden}<label><input type="checkbox" name="confirm" value="yes" required>${t("I want all my companion connections disconnected", "Je veux déconnecter toutes mes connexions au compagnon")}</label><button name="action" value="revoke-all">${t("Disconnect all", "Tout déconnecter")}</button></form>` : `<p>${t("No connected devices.", "Aucun appareil connecté.")}</p>`)
      + `<p><a href="${link("/me/battlenet", lang)}">${t("Optional Battle.net connection", "Connexion Battle.net facultative")}</a></p>`;
    return kit.page(200, t("Connections", "Connexions"), body, { noindex: true });
  };
  return { route, meSection };
}
