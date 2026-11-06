import type { PrismaClient } from "../generated/prisma/client.js";
import { byLastSeen, lastSeenOf, lastSeenText } from "./last-seen.js";
import { createCraftService } from "./craft.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import type { WebContext, WebRoute } from "./web-app.js";

// 8.5 track D1: the Artisans' Gallery, a page of the guild tools site (/me/artisans) for signed-in MEMBERS of a guild.
// It is built on data the bot already stores (RecipeKnown, ProfessionSkill, ProfessionCooldown, CraftOffer, Character):
// search by item name, item id or crafter; every crafter who knows a recipe with skill, last seen (roster value, D3)
// and open offers; a Request button that creates the ordinary craft request and posts it to the craft board.
// Reagent search needs the recipe materials the addon reads, which are not uploaded yet; the page says so.

export const GALLERY_PATH = "/me/artisans";
const MAX_RECIPES = 40, MAX_CRAFTERS_PER_RECIPE = 25, MAX_CARDS = 40, ROW_LIMIT = 600;
const QUALITY_CLASS = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000"];

type Db = Pick<PrismaClient, "recipeKnown" | "professionSkill" | "professionCooldown" | "craftOffer" | "character" | "member">;
export interface GalleryCrafter { character: string; member: string | null; profession: string; skill: number | null; lastSeen: Date | null }
export interface GalleryOffer { id: string; crafter: string; price: string | null; verified: boolean; expiresAt: Date }
export interface GalleryRecipe { itemKey: number; itemName: string; crafters: GalleryCrafter[]; offers: GalleryOffer[] }
export interface CrafterCard { character: string; member: string | null; lastSeen: Date | null; professions: { profession: string; skill: number | null }[]; recipeCount: number; notable: string[]; cooldownsReady: string[] }
export interface GalleryData { recipes: GalleryRecipe[]; crafters: CrafterCard[]; truncated: boolean }
export interface ItemDetailsLookup { (itemKey: number): Promise<{ quality?: number } | null> }

const key = (value: string) => value.trim().toLowerCase();

/** What the gallery shows for a search. An empty search lists crafter cards only. */
export async function loadGallery(db: Db, guildId: string, query: string, now = new Date()): Promise<GalleryData> {
  const text = query.trim();
  const people = await db.character.findMany({ where: { member: { guildId, status: "ACTIVE", isTest: false } }, select: { name: true, lastSeenAt: true, member: { select: { displayName: true } } }, take: 3_000 });
  const personByName = new Map(people.map(person => [key(person.name), person]));
  const skills = await db.professionSkill.findMany({ where: { character: { member: { guildId, status: "ACTIVE", isTest: false } } }, select: { profession: true, skillLevel: true, character: { select: { name: true } } }, take: 6_000 });
  const skillOf = new Map(skills.map(row => [`${key(row.character.name)}|${key(row.profession)}`, row.skillLevel]));
  // Crafters whose name (or Discord name) matches the search, so "Kev" lists what Kev can make.
  const matchedNames = text ? people.filter(person => key(person.name).includes(key(text)) || key(person.member.displayName).includes(key(text))).map(person => person.name) : [];
  const numeric = /^-?\d+$/.test(text);
  const rows = text ? await db.recipeKnown.findMany({
    where: { guildId, OR: [numeric ? { itemKey: Number(text) } : { itemName: { contains: text, mode: "insensitive" } }, ...(matchedNames.length ? [{ character: { in: matchedNames } }] : [])] },
    orderBy: [{ itemName: "asc" }, { character: "asc" }], take: ROW_LIMIT + 1 }) : [];
  const truncated = rows.length > ROW_LIMIT;
  const byItem = new Map<number, GalleryRecipe>();
  for (const row of rows.slice(0, ROW_LIMIT)) {
    const person = personByName.get(key(row.character));
    let recipe = byItem.get(row.itemKey);
    if (!recipe) { recipe = { itemKey: row.itemKey, itemName: row.itemName, crafters: [], offers: [] }; byItem.set(row.itemKey, recipe); }
    if (recipe.crafters.length < MAX_CRAFTERS_PER_RECIPE) recipe.crafters.push({ character: row.character, member: person?.member.displayName ?? null, profession: row.profession,
      skill: skillOf.get(`${key(row.character)}|${key(row.profession)}`) ?? null, lastSeen: lastSeenOf(person?.lastSeenAt, row.scannedAt) });
  }
  const recipes = [...byItem.values()].slice(0, MAX_RECIPES);
  for (const recipe of recipes) recipe.crafters.sort((a, b) => byLastSeen(a.lastSeen, b.lastSeen) || a.character.localeCompare(b.character));
  if (recipes.length) {
    const offers = await db.craftOffer.findMany({ where: { guildId, status: "ACTIVE", expiresAt: { gt: now }, OR: [{ itemKey: { in: recipes.map(recipe => recipe.itemKey) } }, { item: { in: recipes.map(recipe => recipe.itemName) } }] },
      select: { id: true, itemKey: true, item: true, price: true, verified: true, expiresAt: true, crafter: { select: { displayName: true } } }, take: 100 });
    for (const offer of offers) {
      const recipe = recipes.find(candidate => candidate.itemKey === offer.itemKey || candidate.itemName.toLowerCase() === offer.item.toLowerCase());
      recipe?.offers.push({ id: offer.id, crafter: offer.crafter.displayName, price: offer.price, verified: offer.verified, expiresAt: offer.expiresAt });
    }
  }

  // Crafter cards: the people the search matched, the crafters of the recipes shown, or everyone who has a profession when nothing was typed.
  const cardNames = new Set(text ? [...matchedNames, ...recipes.flatMap(recipe => recipe.crafters.map(crafter => crafter.character))].map(key) : skills.map(row => key(row.character.name)));
  const scoped = [...cardNames].slice(0, 400);
  const known = scoped.length ? await db.recipeKnown.findMany({ where: { guildId, character: { in: [...new Set([...skills.filter(row => cardNames.has(key(row.character.name))).map(row => row.character.name), ...matchedNames, ...recipes.flatMap(recipe => recipe.crafters.map(crafter => crafter.character))])] } },
    select: { character: true, itemKey: true, itemName: true, profession: true, scannedAt: true }, take: 4_000 }) : [];
  const cooldowns = scoped.length ? await db.professionCooldown.findMany({ where: { guildId, readyAt: { lte: now } }, select: { character: true, name: true }, take: 1_000 }) : [];
  const popularity = new Map<number, number>();
  for (const row of known) popularity.set(row.itemKey, (popularity.get(row.itemKey) ?? 0) + 1);
  const cards = new Map<string, CrafterCard>();
  const card = (name: string): CrafterCard => {
    let existing = cards.get(key(name));
    if (!existing) { const person = personByName.get(key(name)); existing = { character: person?.name ?? name, member: person?.member.displayName ?? null, lastSeen: person?.lastSeenAt ?? null, professions: [], recipeCount: 0, notable: [], cooldownsReady: [] }; cards.set(key(name), existing); }
    return existing;
  };
  for (const row of skills) if (cardNames.has(key(row.character.name))) card(row.character.name).professions.push({ profession: row.profession, skill: row.skillLevel });
  const newestScan = new Map<string, Date>();
  const mine = new Map<string, { itemKey: number; itemName: string }[]>();
  for (const row of known) {
    card(row.character).recipeCount++;
    const current = newestScan.get(key(row.character));
    if (!current || row.scannedAt > current) newestScan.set(key(row.character), row.scannedAt);
    mine.set(key(row.character), [...(mine.get(key(row.character)) ?? []), { itemKey: row.itemKey, itemName: row.itemName }]);
  }
  for (const entry of cooldowns) if (cards.has(key(entry.character))) card(entry.character).cooldownsReady.push(entry.name);
  for (const [name, value] of cards) {
    value.lastSeen = lastSeenOf(personByName.get(name)?.lastSeenAt, newestScan.get(name));
    // Notable = recipes few other crafters know (rarest first).
    value.notable = (mine.get(name) ?? []).sort((a, b) => (popularity.get(a.itemKey) ?? 0) - (popularity.get(b.itemKey) ?? 0) || a.itemName.localeCompare(b.itemName)).slice(0, 5).map(recipe => recipe.itemName);
    value.professions.sort((a, b) => (b.skill ?? 0) - (a.skill ?? 0));
  }
  const crafters = [...cards.values()].filter(value => value.professions.length || value.recipeCount).sort((a, b) => byLastSeen(a.lastSeen, b.lastSeen) || a.character.localeCompare(b.character)).slice(0, MAX_CARDS);
  return { recipes, crafters, truncated: truncated || byItem.size > MAX_RECIPES };
}

export interface GalleryDeps {
  db: Db & Pick<PrismaClient, "craftRequest">;
  access: Pick<GuildDashboardAccess, "authorize" | "guilds">;
  /** Posts a new request to the craft board in Discord (false when there is no forum). */
  post(guildId: string, requestId: string): Promise<boolean>;
  details?: ItemDetailsLookup;
}

export function createArtisansGallery(deps: GalleryDeps) {
  const craft = createCraftService(deps.db);

  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== GALLERY_PATH) return null;
    const { t, lang } = ctx;
    const title = t("Artisans' Gallery", "Galerie des artisans");
    if (!["GET", "HEAD", "POST"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD, POST" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const source = ctx.request.method === "POST" ? ctx.form : ctx.request.query;
    const guildId = source?.get("guild") ?? "";
    const q = (source?.get("q") ?? "").trim();
    if (guildId.length > 64 || q.length > 100) return kit.page(400, title, t("Invalid filter.", "Filtre invalide."), { noindex: true });
    try {
      if (!guildId) {
        const guilds = await deps.access.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose your guild.", "Choisissez votre guilde.")}</p><ul>${guilds.map(guild => `<li><a href="${h(link(GALLERY_PATH, lang, { guild: guild.id, edition: guild.edition }))}">${h(guild.name)} · ${h(guild.edition)}</a></li>`).join("")}</ul>${guilds.length ? "" : `<p>${t("No guild found where you are a member.", "Aucune guilde où vous êtes membre.")}</p>`}`, { noindex: true });
      }
      const guild = await deps.access.authorize(ctx.account.discordUserId, guildId);
      if (!guild) return kit.page(403, title, t("The gallery is only for members of this guild.", "La galerie est réservée aux membres de cette guilde."), { noindex: true });
      const params = { guild: guild.id, edition: guild.edition };
      let notice = "";
      let failed = false;
      if (ctx.request.method === "POST") {
        const member = await deps.db.member.findFirst({ where: { guildId, discordUserId: ctx.account.discordUserId, status: "ACTIVE", isTest: false }, select: { id: true } });
        const quantity = Number(ctx.form?.get("quantity") ?? "1");
        try {
          if (!member) throw new Error(t("The gallery is only for members of this guild.", "La galerie est réservée aux membres de cette guilde."));
          const created = await craft.request({ guildId, requesterId: member.id, item: ctx.form?.get("item") ?? "", profession: ctx.form?.get("profession") ?? undefined,
            quantity: Number.isFinite(quantity) ? quantity : 1, note: (ctx.form?.get("note") ?? "").slice(0, 300) || undefined, materialsProvided: ctx.form?.get("materials") === "on" });
          const posted = await deps.post(guildId, created.id).catch(() => false);
          return kit.redirect(link(GALLERY_PATH, lang, { ...params, q, requested: posted ? "posted" : "saved" }));
        } catch (error) { notice = error instanceof Error ? error.message : t("The request could not be sent.", "La demande n'a pas pu être envoyée."); failed = true; }
      }
      const requested = ctx.request.query.get("requested");
      if (requested) notice = requested === "posted" ? t("Request posted on the craft board in Discord.", "Demande publiée sur le tableau d'artisanat dans Discord.") : t("Request saved. It could not be posted to Discord just now; it is in /craft list.", "Demande enregistrée. Elle n'a pas pu être publiée dans Discord pour l'instant; elle est dans /craft list.");
      const data = await loadGallery(deps.db, guildId, q, ctx.now);
      const hidden = `<input type="hidden" name="guild" value="${h(guild.id)}"><input type="hidden" name="edition" value="${h(guild.edition)}"><input type="hidden" name="lang" value="${lang}">`;
      const seen = (date: Date | null) => h(lastSeenText(date, lang, ctx.now));
      const recipeCards = await Promise.all(data.recipes.map(async recipe => {
        const details = await deps.details?.(recipe.itemKey).catch(() => null);
        const color = details?.quality !== undefined ? QUALITY_CLASS[details.quality] : undefined;
        const rows = recipe.crafters.map(crafter => `<tr><td>${h(crafter.character)}${crafter.member && crafter.member.toLowerCase() !== crafter.character.toLowerCase() ? ` <span class="muted">(${h(crafter.member)})</span>` : ""}</td><td>${h(crafter.profession)}</td><td>${crafter.skill ?? "—"}</td><td>${seen(crafter.lastSeen)}</td></tr>`).join("");
        const offers = recipe.offers.length ? `<p><strong>${t("Open offers", "Offres ouvertes")}:</strong> ${recipe.offers.map(offer => `${h(offer.crafter)}${offer.price ? ` — ${h(offer.price)}` : ""}${offer.verified ? "" : ` (${t("unverified", "non vérifié")})`}`).join(" · ")}</p>` : "";
        const form = `<form method="post" action="${h(link(GALLERY_PATH, lang))}"><input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}">${hidden}<input type="hidden" name="q" value="${h(q)}"><input type="hidden" name="item" value="${h(recipe.itemName)}"><input type="hidden" name="profession" value="${h(recipe.crafters[0]?.profession ?? "")}">
<label>${t("How many", "Combien")} <input name="quantity" type="number" min="1" max="200" value="1" style="width:5em"></label> <label><input type="checkbox" name="materials"> ${t("I bring the materials", "J'apporte les matériaux")}</label> <label>${t("Note", "Note")} <input name="note" maxlength="300"></label>
<button class="button" type="submit">${t("Request this craft", "Demander cette fabrication")}</button></form>`;
        // One compact line per recipe; crafters, offers and the request form open under "Details".
        const best = recipe.crafters.map(crafter => crafter.skill ?? 0).reduce((a, b) => Math.max(a, b), 0);
        const summary = `<span${color ? ` style="color:${color}"` : ""}><strong>${h(recipe.itemName)}</strong></span> <small class="muted">#${recipe.itemKey}</small> · ${recipe.crafters.length} ${t("crafter(s)", "artisan(s)")}${best ? ` · ${t("best skill", "meilleure compétence")} ${best}` : ""}${recipe.offers.length ? ` · ${recipe.offers.length} ${t("offer(s)", "offre(s)")}` : ""} <span class="muted">— ${t("Details", "Détails")}</span>`;
        return `<details class="card recipe-line"><summary>${summary}</summary>${offers}<div class="table-wrap"><table><thead><tr><th scope="col">${t("Crafter", "Artisan")}</th><th scope="col">${t("Profession", "Métier")}</th><th scope="col">${t("Skill", "Compétence")}</th><th scope="col">${t("Last seen", "Dernière présence")}</th></tr></thead><tbody>${rows}</tbody></table></div>${form}</details>`;
      }));
      const crafterCards = data.crafters.map(person => `<article class="card"><h3>${h(person.character)}${person.member && person.member.toLowerCase() !== person.character.toLowerCase() ? ` <small class="muted">(${h(person.member)})</small>` : ""}</h3>
<p>${person.professions.map(entry => `${h(entry.profession)} ${entry.skill ?? "—"}`).join(" · ") || "—"}</p><p>${t("Last seen", "Dernière présence")}: ${seen(person.lastSeen)} · ${t("Recipes", "Recettes")}: ${person.recipeCount}</p>
${person.notable.length ? `<p>${t("Notable recipes", "Recettes notables")}: ${person.notable.map(h).join(", ")}</p>` : ""}${person.cooldownsReady.length ? `<p>${t("Cooldowns ready", "Délais prêts")}: ${[...new Set(person.cooldownsReady)].map(h).join(", ")}</p>` : ""}</article>`).join("");
      const body = `<h1>${title}</h1><p><strong>${h(guild.name)}</strong> · ${h(guild.edition)} · <a href="${h(link(GALLERY_PATH, lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a></p>`
        + (notice ? `<p class="notice"${failed ? ` role="alert"` : ""}>${h(notice)}</p>` : "")
        + `<p>${t("Who in the guild can craft what, from the recipes members scanned with Guilded. A match does not prove the crafter is online or that materials are available.", "Qui peut fabriquer quoi dans la guilde, d'après les recettes relevées avec Guilded. Un résultat ne prouve pas que l'artisan est en ligne ni que les matériaux sont disponibles.")}</p>`
        + `<form method="get" action="${GALLERY_PATH}">${hidden}<label for="gallery-q">${t("Item name, item ID or crafter", "Nom d'objet, identifiant ou artisan")}</label><input id="gallery-q" name="q" maxlength="100" value="${h(q)}"><button class="button" type="submit">${t("Search", "Chercher")}</button></form>`
        + `<p class="muted">${t("Searching by reagent needs the recipe materials, which Guilded does not collect yet.", "La recherche par composant demande les matériaux des recettes, que Guilded ne collecte pas encore.")}</p>`
        + (q && !data.recipes.length && !data.crafters.length ? `<p>${t("No known matching recipe or crafter. This does not prove nobody can craft it.", "Aucune recette ou aucun artisan correspondant connu. Cela ne prouve pas que personne ne peut la fabriquer.")}</p>` : "")
        + (recipeCards.length ? `<h2>${t("Recipes", "Recettes")}</h2>${recipeCards.join("")}` : "")
        + (data.truncated ? `<p class="notice">${t("Only the first matches are shown. Type more of the name.", "Seuls les premiers résultats sont affichés. Précisez le nom.")}</p>` : "")
        + (crafterCards ? `<h2>${t("Crafters", "Artisans")}</h2><div class="cards">${crafterCards}</div>` : "");
      return kit.page(failed ? 400 : 200, title, body, { noindex: true, languageParams: { ...params, q } });
    } catch {
      return kit.page(503, title, t("The gallery could not be loaded. Try again shortly; no data was changed.", "Impossible de charger la galerie. Réessayez sous peu; aucune donnée n'a été modifiée."), { noindex: true });
    }
  };

  const meSection = async (ctx: WebContext) => ctx.account ? `<h2>${ctx.t("Artisans' Gallery", "Galerie des artisans")}</h2><p><a href="${h(link(GALLERY_PATH, ctx.lang))}">${ctx.t("Find a crafter or request a craft", "Trouver un artisan ou demander une fabrication")}</a></p>` : "";
  return { route, meSection };
}
