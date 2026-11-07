import type { PrismaClient } from "../generated/prisma/client.js";
import { createCompanionHub } from "./companion-hub.js";
import { createCompanionManage, ManageError } from "./companion-manage.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";
import { checkCsrf, sameOrigin } from "./web-auth.js";
import { escapeHtml as h, link, options, SECURITY_HEADERS } from "./web-layout.js";

// /me/reserves and /me/wishlist: the companion's Reserves and Wishlist screens on the website, for
// signed-in members (Sign in with Discord). Same data and rules as the companion: soft reserves are
// read-only (the game addon keeps them and each officer upload replaces them, companion-hub.ts), and
// the wishlist edits only the member's own characters through companion-manage.ts.

export const RESERVES_PATH = "/me/reserves";
export const WISHLIST_PATH = "/me/wishlist";

export interface LootGuild { id: string; name: string; edition: string }
export interface ReserveItem { itemId: number; itemName: string; characters: string[]; mine: boolean }
export interface ReservesView {
  guild: LootGuild;
  list: { active: boolean; open: boolean; title: string | null; perPlayer: number; keeper: string | null; syncedAt: string } | null;
  items: ReserveItem[]; mineCount: number;
  cores: { id: string; name: string; lootMode: string; reservesPerPlayer: number }[];
}
export interface WishCharacter { id: string; name: string; displayName: string | null; realm: string; className: string; isMain: boolean; wishlist: { itemName: string; priority: number }[] }
export interface WishlistView { guild: LootGuild; characters: WishCharacter[]; itemNames: string[] }

export interface LootListStore {
  /** Guilds where the signed-in Discord user is a current member (checked live). */
  guilds(discordUserId: string): Promise<LootGuild[]>;
  /** Null when the user is not a current member of that guild. */
  reserves(discordUserId: string, guildId: string): Promise<ReservesView | null>;
  wishlist(discordUserId: string, guildId: string): Promise<WishlistView | null>;
  /** Adds or re-prioritises an item; false when the user is not a member. Throws ManageError for a refused change. */
  setWish(discordUserId: string, guildId: string, characterId: string, item: string, priority: number): Promise<boolean>;
  removeWish(discordUserId: string, guildId: string, characterId: string, item: string): Promise<boolean>;
}

const MAX_ITEM_NAMES = 2_000;

export function prismaLootListStore(database: PrismaClient, access: GuildDashboardAccess): LootListStore {
  const hub = createCompanionHub(database);
  const manage = createCompanionManage(database);
  // The member behind a live, allowed membership: officer tools stay off on these pages.
  async function member(discordUserId: string, guildId: string) {
    const guild = await access.authorize(discordUserId, guildId);
    if (!guild) return null;
    const row = await database.member.findFirst({ where: { guildId, discordUserId, status: "ACTIVE", isTest: false }, select: { id: true } });
    return row ? { guild: { id: guild.id, name: guild.name, edition: guild.edition }, access: { memberId: row.id, actorId: discordUserId, officer: false, raidLeader: false } } : null;
  }
  return {
    async guilds(discordUserId) {
      return (await access.guilds(discordUserId)).map((guild) => ({ id: guild.id, name: guild.name, edition: guild.edition }));
    },
    async reserves(discordUserId, guildId) {
      const found = await member(discordUserId, guildId);
      if (!found) return null;
      const view = await hub.view(guildId, found.access, null);
      return { guild: found.guild, ...view.reserves };
    },
    async wishlist(discordUserId, guildId) {
      const found = await member(discordUserId, guildId);
      if (!found) return null;
      const [characters, wishes, prices] = await Promise.all([
        database.character.findMany({ where: { memberId: found.access.memberId }, orderBy: [{ isMain: "desc" }, { name: "asc" }],
          select: { id: true, name: true, displayName: true, realm: true, className: true, isMain: true, wishlist: { orderBy: [{ priority: "asc" }, { itemName: "asc" }], select: { itemName: true, priority: true } } } }),
        database.wishlistEntry.findMany({ where: { character: { member: { guildId } } }, select: { itemName: true }, distinct: ["itemKey"], take: MAX_ITEM_NAMES }),
        database.coreItemValue.findMany({ where: { guildId }, select: { itemName: true }, distinct: ["itemKey"], take: MAX_ITEM_NAMES })
      ]);
      // Names to suggest while typing, as in the companion: wishlisted or priced in this guild.
      const itemNames = [...new Set([...wishes, ...prices].map((row) => row.itemName).filter((name) => !/^Item \d+$/.test(name)))].sort((a, b) => a.localeCompare(b)).slice(0, MAX_ITEM_NAMES);
      return { guild: found.guild, characters, itemNames };
    },
    async setWish(discordUserId, guildId, characterId, item, priority) {
      const found = await member(discordUserId, guildId);
      if (!found) return false;
      await manage.apply(guildId, found.access, { action: "wishlist.set", characterId, item, priority });
      return true;
    },
    async removeWish(discordUserId, guildId, characterId, item) {
      const found = await member(discordUserId, guildId);
      if (!found) return false;
      await manage.apply(guildId, found.access, { action: "wishlist.remove", characterId, item });
      return true;
    }
  };
}

const PRIORITIES = [1, 2, 3] as const;

export function createWebLootLists(store: LootListStore) {
  const STYLE = `<style>.loot-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 20px}.loot-tabs a{border:1px solid var(--line);border-radius:6px;padding:6px 16px;text-decoration:none;font-weight:700}.loot-tabs a.on{background:var(--gold);color:#111;border-color:var(--gold)}`
    + `.wish-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.wish-row form{display:inline-flex;gap:6px;align-items:center;margin:0}.wish-row select,.wish-row input{width:auto;margin:0}.wish-add{display:flex;flex-wrap:wrap;gap:8px;align-items:end}.wish-add>div{min-width:160px}.mine{color:var(--gold);font-weight:700}</style>`;
  const priorityName = (ctx: WebContext, value: number) => value === 1 ? ctx.t("High", "Haute") : value === 3 ? ctx.t("Low", "Basse") : ctx.t("Medium", "Moyenne");
  const guildParams = (guild: LootGuild) => ({ guild: guild.id, edition: guild.edition });
  const tabs = (ctx: WebContext, active: "reserves" | "wishlist", guild: LootGuild | null) => `<nav class="loot-tabs" aria-label="${ctx.t("Raid loot", "Butin de raid")}">`
    + `<a class="${active === "reserves" ? "on" : ""}" href="${h(link(RESERVES_PATH, ctx.lang, guild ? guildParams(guild) : {}))}">${ctx.t("Reserves", "Réserves")}</a>`
    + `<a class="${active === "wishlist" ? "on" : ""}" href="${h(link(WISHLIST_PATH, ctx.lang, guild ? guildParams(guild) : {}))}">${ctx.t("Wishlist", "Liste de souhaits")}</a></nav>`;
  const head = (ctx: WebContext, active: "reserves" | "wishlist", guild: LootGuild | null) => STYLE
    + `<p class="eyebrow"><a href="${h(link("/me/", ctx.lang))}">${ctx.t("My Guilded", "Mon Guilded")}</a>${guild ? ` · ${h(guild.name)}` : ""}</p>`
    + `<h1>${active === "reserves" ? ctx.t("Soft reserves", "Réserves") : ctx.t("Wishlist", "Liste de souhaits")}</h1>` + tabs(ctx, active, guild);

  // No ?guild: the member's guilds to choose from (one guild opens directly).
  async function chooseGuild(ctx: WebContext, kit: WebKit, active: "reserves" | "wishlist"): Promise<WebResponse | LootGuild> {
    const guilds = await store.guilds(ctx.account!.discordUserId);
    if (guilds.length === 1) return guilds[0]!;
    const path = active === "reserves" ? RESERVES_PATH : WISHLIST_PATH;
    const title = active === "reserves" ? ctx.t("Soft reserves", "Réserves") : ctx.t("Wishlist", "Liste de souhaits");
    return kit.page(200, title, head(ctx, active, null) + (guilds.length
      ? `<p>${ctx.t("Choose a guild. Your current membership is checked each time.", "Choisissez une guilde. Votre adhésion actuelle est vérifiée à chaque visite.")}</p><ul>${guilds.map((guild) => `<li><a href="${h(link(path, ctx.lang, guildParams(guild)))}">${h(guild.name)}</a> <span class="tag">${h(guild.edition)}</span></li>`).join("")}</ul>`
      : `<p class="muted">${ctx.t("You are not a current member of a guild using Guilded yet. Join your guild's Discord and link a character from My Guilded.", "Vous n'êtes pas encore membre d'une guilde qui utilise Guilded. Rejoignez le Discord de votre guilde et liez un personnage depuis Mon Guilded.")}</p>`), { noindex: true });
  }

  const notMember = (ctx: WebContext, kit: WebKit, active: "reserves" | "wishlist") => kit.page(403, ctx.t("Not available", "Non disponible"), head(ctx, active, null)
    + `<p>${ctx.t("Current guild membership is required for this page.", "Une adhésion actuelle à la guilde est requise pour cette page.")}</p><p><a href="${h(link(active === "reserves" ? RESERVES_PATH : WISHLIST_PATH, ctx.lang))}">${ctx.t("Choose a guild", "Choisir une guilde")}</a></p>`, { noindex: true });

  async function reservesPage(ctx: WebContext, kit: WebKit, guildId: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    const view = await store.reserves(ctx.account!.discordUserId, guildId);
    if (!view) return notMember(ctx, kit, "reserves");
    const modes = view.cores.filter((core) => core.lootMode === "RESERVE");
    const where = `<h2>${t("Where to reserve", "Où réserver")}</h2>`
      + `<p>${t("Soft reserves are kept in the game addon by your raid leader (/guilded reserve) and reach Discord when the companion uploads. Reserve in game so your reserves are not overwritten; this page shows the list.", "Les réserves sont gardées dans l'addon du jeu par votre chef de raid (/guilded reserve) et arrivent dans Discord quand le compagnon envoie ses données. Réservez en jeu pour que vos réserves ne soient pas écrasées; cette page montre la liste.")}</p>`
      + `<p class="muted">${modes.length ? t(`Cores using soft reserves: ${modes.map((core) => `${h(core.name)} (${core.reservesPerPlayer} per player)`).join(", ")}`, `Cores qui utilisent les réserves : ${modes.map((core) => `${h(core.name)} (${core.reservesPerPlayer} par joueur)`).join(", ")}`) : t("No raid core uses soft reserves right now.", "Aucun core de raid n'utilise les réserves en ce moment.")}</p>`;
    let list: string;
    if (!view.list?.active) list = `<p class="muted">${t("No soft-reserve list is open. An officer starts one in game with /guilded reserve open.", "Aucune liste de réserves n'est ouverte. Un officier en ouvre une en jeu avec /guilded reserve open.")}</p>`;
    else {
      const state = view.list.open ? t("Open", "Ouverte") : t("Locked", "Verrouillée");
      list = `<h2>${h(view.list.title || t("Soft reserves", "Réserves"))} <span class="tag">· ${state}</span></h2>`
        + `<p>${t(`Your reserves: ${view.mineCount} of ${view.list.perPlayer}`, `Vos réserves : ${view.mineCount} sur ${view.list.perPlayer}`)} · <span class="muted">${t("updated", "mis à jour")} ${h(view.list.syncedAt.slice(0, 16).replace("T", " "))} UTC</span></p>`
        + (view.items.length ? `<div class="table-wrap"><table><thead><tr><th>${t("Item", "Objet")}</th><th>${t("Reserved by", "Réservé par")}</th></tr></thead><tbody>`
          + view.items.map((item) => `<tr><td>${item.mine ? `<span class="mine" title="${t("You reserved this", "Vous l'avez réservé")}">★ </span>` : ""}${h(item.itemName)}</td><td>${h(item.characters.join(", "))}</td></tr>`).join("") + `</tbody></table></div>`
          : `<p class="muted">${t("Nobody has reserved yet.", "Personne n'a encore réservé.")}</p>`);
    }
    return kit.page(200, t("Soft reserves", "Réserves"), head(ctx, "reserves", view.guild) + list + where
      + `<p><a href="${h(link(WISHLIST_PATH, lang, guildParams(view.guild)))}">${t("My wishlist →", "Ma liste de souhaits →")}</a></p>`, { noindex: true, languageParams: guildParams(view.guild) });
  }

  async function wishlistPage(ctx: WebContext, kit: WebKit, guildId: string, notice: { text: string; error: boolean } | null = null): Promise<WebResponse> {
    const { t, lang } = ctx;
    const view = await store.wishlist(ctx.account!.discordUserId, guildId);
    if (!view) return notMember(ctx, kit, "wishlist");
    const action = h(link(WISHLIST_PATH, lang, guildParams(view.guild)));
    const hidden = (character: WishCharacter) => `<input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}"><input type="hidden" name="character" value="${h(character.id)}">`;
    const priorityOptions = (selected: number) => options(PRIORITIES.map((value) => ({ value: String(value), label: priorityName(ctx, value) })), String(selected));
    const sections = view.characters.map((character) => {
      const name = character.displayName || character.name;
      const rows = character.wishlist.map((entry) => `<tr><td>${h(entry.itemName)}</td><td><div class="wish-row">`
        + `<form method="post" action="${action}">${hidden(character)}<input type="hidden" name="intent" value="set"><input type="hidden" name="item" value="${h(entry.itemName)}"><select name="priority" aria-label="${h(t(`Priority of ${entry.itemName}`, `Priorité de ${entry.itemName}`))}">${priorityOptions(entry.priority)}</select><button class="link" type="submit">${t("Save", "Enregistrer")}</button></form>`
        + `<form method="post" action="${action}">${hidden(character)}<input type="hidden" name="intent" value="remove"><input type="hidden" name="item" value="${h(entry.itemName)}"><button class="link" type="submit">${t("Remove", "Retirer")}</button></form></div></td></tr>`).join("");
      const id = `wish-${h(character.id)}`;
      return `<section><h2>${h(name)}${character.isMain ? ` <span class="tag">${t("main", "principal")}</span>` : ""} <span class="tag">${h(character.className)} · ${h(character.realm)}</span></h2>`
        + (rows ? `<div class="table-wrap"><table><thead><tr><th>${t("Item", "Objet")}</th><th>${t("Priority", "Priorité")}</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<p class="muted">${h(t(`${name} has no wishlist items yet.`, `${name} n'a encore aucun objet dans sa liste.`))}</p>`)
        + `<form class="wish-add" method="post" action="${action}" autocomplete="off">${hidden(character)}<input type="hidden" name="intent" value="set">`
        + `<div><label for="${id}-item">${t("Item name", "Nom de l'objet")}</label><input id="${id}-item" name="item" list="wish-items" minlength="2" maxlength="100" required></div>`
        + `<div><label for="${id}-priority">${t("Priority", "Priorité")}</label><select id="${id}-priority" name="priority">${priorityOptions(2)}</select></div>`
        + `<div><button class="button" type="submit">${t("Add", "Ajouter")}</button></div></form></section>`;
    }).join("");
    const body = head(ctx, "wishlist", view.guild)
      + `<p class="muted">${t("The items your characters want. Your guild sees them on item tooltips in game. Same list as /wishlist in Discord; changes reach the game with the next standings refresh.", "Les objets que vos personnages veulent. Votre guilde les voit dans les infobulles en jeu. Même liste que /wishlist dans Discord; les changements arrivent en jeu à la prochaine mise à jour des classements.")}</p>`
      + (notice ? `<p class="notice${notice.error ? " error" : ""}">${h(notice.text)}</p>` : "")
      + (view.characters.length ? sections : `<p class="muted">${t("No character is linked to you in this guild yet. Sync your addon data once, or link a character from My Guilded.", "Aucun personnage n'est encore lié à vous dans cette guilde. Synchronisez les données de l'addon une fois, ou liez un personnage depuis Mon Guilded.")} <a href="${h(link("/me/battlenet", lang))}">${t("Link a character", "Lier un personnage")}</a></p>`)
      + `<datalist id="wish-items">${view.itemNames.map((name) => `<option value="${h(name)}">`).join("")}</datalist>`
      + `<p><a href="${h(link(RESERVES_PATH, lang, guildParams(view.guild)))}">${t("Soft reserves →", "Réserves →")}</a></p>`;
    return kit.page(notice?.error ? 400 : 200, t("Wishlist", "Liste de souhaits"), body, { noindex: true, languageParams: guildParams(view.guild) });
  }

  async function saveWish(ctx: WebContext, kit: WebKit, guildId: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    const form = ctx.form!;
    const intent = form.get("intent"), characterId = form.get("character") ?? "", item = (form.get("item") ?? "").trim(), priority = Number(form.get("priority") ?? "2");
    if ((intent !== "set" && intent !== "remove") || !characterId || characterId.length > 64)
      return wishlistPage(ctx, kit, guildId, { text: t("Reload this page and try again.", "Rechargez cette page et réessayez."), error: true });
    if (item.length < 2 || item.length > 100) return wishlistPage(ctx, kit, guildId, { text: t("Item name must be 2-100 characters.", "Le nom de l'objet doit compter de 2 à 100 caractères."), error: true });
    if (intent === "set" && !(PRIORITIES as readonly number[]).includes(priority)) return wishlistPage(ctx, kit, guildId, { text: t("Choose a priority: high, medium or low.", "Choisissez une priorité : haute, moyenne ou basse."), error: true });
    try {
      const ok = intent === "set"
        ? await store.setWish(ctx.account!.discordUserId, guildId, characterId, item, priority)
        : await store.removeWish(ctx.account!.discordUserId, guildId, characterId, item);
      if (!ok) return notMember(ctx, kit, "wishlist");
    } catch (error) {
      // Refusals the companion would show too (not your character, not on the list): said plainly here.
      const text = error instanceof ManageError ? (error.status === 403 ? t("That character is not linked to your profile.", "Ce personnage n'est pas lié à votre profil.") : error.message)
        : error instanceof Error && /not on this character's wishlist/.test(error.message) ? t("That item is not on this character's wishlist.", "Cet objet n'est pas dans la liste de ce personnage.")
          : t("The wishlist could not be changed. Reload and try again.", "Impossible de modifier la liste. Rechargez et réessayez.");
      return wishlistPage(ctx, kit, guildId, { text, error: true });
    }
    return kit.redirect(link(WISHLIST_PATH, lang, { guild: guildId, edition: ctx.request.query.get("edition"), done: intent === "set" ? "saved" : "removed" }));
  }

  const route: WebRoute = async (ctx, kit) => {
    const path = ctx.request.path.replace(/\/$/, "");
    if (path !== RESERVES_PATH && path !== WISHLIST_PATH) return null;
    const active = path === RESERVES_PATH ? "reserves" : "wishlist";
    const methods = active === "reserves" ? ["GET", "HEAD"] : ["GET", "HEAD", "POST"];
    if (!methods.includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: methods.join(", ") }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t } = ctx;
    const asked = ctx.request.query.get("guild") ?? "";
    if (asked.length > 64) return kit.page(400, t("Invalid guild.", "Guilde invalide."), `<p>${t("Invalid guild.", "Guilde invalide.")}</p>`, { noindex: true });
    try {
      if (ctx.request.method === "POST") {
        if (!asked || !ctx.auth || !ctx.form || !sameOrigin(ctx.request.headers, ctx.auth.siteUrl) || !checkCsrf(ctx.auth.sessionSecret, ctx.sessionToken, ctx.form.get("csrf") ?? undefined))
          return kit.page(403, t("Wishlist", "Liste de souhaits"), `<p>${t("Reload this page and try again.", "Rechargez cette page et réessayez.")}</p>`, { noindex: true });
        return await saveWish(ctx, kit, asked);
      }
      let guildId = asked;
      if (!guildId) {
        const chosen = await chooseGuild(ctx, kit, active);
        if ("status" in chosen) return chosen;
        guildId = chosen.id;
      }
      if (active === "reserves") return await reservesPage(ctx, kit, guildId);
      const done = ctx.request.query.get("done");
      return await wishlistPage(ctx, kit, guildId, done === "saved" ? { text: t("Wishlist saved.", "Liste enregistrée."), error: false } : done === "removed" ? { text: t("Item removed from the wishlist.", "Objet retiré de la liste.") , error: false } : null);
    } catch {
      return kit.page(503, t("Not available", "Non disponible"), `<p>${t("This page could not be loaded. Refresh to try again.", "Impossible de charger cette page. Actualisez pour réessayer.")}</p>`, { noindex: true });
    }
  };

  const meSection = async (ctx: WebContext) => ctx.account ? `<h2>${ctx.t("Raid loot", "Butin de raid")}</h2><p>${ctx.t("Your soft reserves for the next raid and your characters' wishlists.", "Vos réserves pour le prochain raid et les listes de souhaits de vos personnages.")}</p>`
    + `<p><a class="button" href="${h(link(RESERVES_PATH, ctx.lang))}">${ctx.t("My reserves", "Mes réserves")}</a> <a class="button ghost" href="${h(link(WISHLIST_PATH, ctx.lang))}">${ctx.t("My wishlist", "Ma liste de souhaits")}</a></p>` : "";

  return { route, meSection };
}
