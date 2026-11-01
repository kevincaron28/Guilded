import { currentEdition, withEdition } from "./edition-context.js";
import { GAME_EDITIONS, gameEditionOf } from "../../companion/game-edition.mjs";
import { CLASSES } from "../wow-data.js";
import {
  authorizeUrl, checkCsrf, clearCookie, csrfToken, exchangeCode, hashToken, newToken, parseCookies, readStateCookie, safeReturnPath,
  sameOrigin, serializeCookie, SESSION_COOKIE, SESSION_DAYS, sign, STATE_COOKIE, stateCookie, unsign, type WebAuthConfig
} from "./web-auth.js";
import {
  cardMatches, characterName, classLabel, className, dayLabel, factionLabel, FACTIONS, languageLabel, LIMITS, listingMatches, parseDays,
  readFilters, RecruitmentError, roleLabel, ROLES, shortText, type Filters, type PublicCard, type PublicListing
} from "./recruitment.js";
import { escapeHtml, langFrom, layout, link, options, SECURITY_HEADERS, tr, type Lang } from "./web-layout.js";
import type { CardFields, DecisionView, WebAccountView, WebStore } from "./web-store.js";
import { publicRaidMatches, type PublicRaid } from "./public-raids.js";

// The bot-served half of guilded.kcaron.top (7.0): Discord sign-in, /recruitment/ and /me/.
// Requests arrive through the Cloudflare Worker (worker/index.mjs), which forwards cookies and
// Origin for these paths only.

export interface WebHeaders { cookie?: string | undefined; origin?: string | undefined; referer?: string | undefined; "accept-language"?: string | undefined; "content-type"?: string | undefined; "user-agent"?: string | undefined }
export interface WebRequest { method: string; path: string; query: URLSearchParams; headers: WebHeaders; body?: string }
export interface WebResponse { status: number; headers: Record<string, string | string[]>; body: string; binaryBody?: Buffer }

export interface WebContext {
  request: WebRequest; lang: Lang; t: (en: string, fr: string) => string; now: Date;
  account: WebAccountView | null; sessionToken: string | null; csrf: string | null; form: URLSearchParams | null; auth: WebAuthConfig | null;
}
// Extra pages (the leaderboards, personal pairing) plug in here and share the session.
export type WebRoute = (context: WebContext, kit: WebKit) => Promise<WebResponse | null>;
export interface WebKit {
  page(status: number, title: string, body: string, options?: { description?: string; noindex?: boolean; cookies?: string[]; shareImage?: string; languageParams?: Record<string, string | null | undefined> }): WebResponse;
  redirect(location: string, cookies?: string[]): WebResponse;
  signInPrompt(): WebResponse;
}

export interface WebAppDeps {
  store: WebStore;
  publicRaids?: (now: Date) => Promise<PublicRaid[]>;
  auth: WebAuthConfig | null;
  /** Full (approved) servers only: Lite and blocked servers never list or receive applications. */
  allows(discordId: string): boolean;
  /** Posts the application card with its buttons; null when the guild has no channel for it. */
  postApplication(application: DecisionView): Promise<{ channelId: string; messageId: string } | null>;
  /** The owner's error/report channel, for reported listings. */
  tellOwner?(text: string): Promise<void>;
  fetch?: typeof fetch;
  now?: () => Date;
  routes?: WebRoute[];
  /** Extra sections at the end of /me/ (the personal companion code). */
  meSections?: ((context: WebContext) => Promise<string>)[];
}

const PATHS = /^\/(?:auth\/(?:login|callback|logout)|recruitment(?:\/.*)?|me(?:\/.*)?|players(?:\/.*)?|leaderboards(?:\/.*)?)$/;
export const isWebPath = (path: string) => path.length <= 200 && PATHS.test(path);
const ID = /^[a-z0-9]{20,40}$/;
const MAX_FORM = 16_000;
// Review CSV is capped at 8,000 decoded characters; allow URL-encoded UTF-8 names.
export const webFormLimit = (path: string) => path === "/me/raid-plans" ? 250_000 : path === "/me/roster/review" ? 80_000 : MAX_FORM;

export function createWebApp(deps: WebAppDeps) {
  const now = deps.now ?? (() => new Date());
  const cardSaves = new Map<string, number[]>();

  async function context(request: WebRequest): Promise<WebContext> {
    const lang = langFrom(request.query, request.headers["accept-language"]);
    const auth = deps.auth;
    let sessionToken: string | null = null;
    let account: WebAccountView | null = null;
    if (auth) {
      const token = unsign(auth.sessionSecret, parseCookies(request.headers.cookie)[SESSION_COOKIE]);
      if (token) {
        account = await deps.store.sessionAccount(hashToken(token), now());
        if (account) sessionToken = token;
      }
    }
    const form = request.method === "POST" && /^application\/x-www-form-urlencoded\b/i.test(request.headers["content-type"] ?? "") && (request.body ?? "").length <= webFormLimit(request.path)
      ? new URLSearchParams(request.body ?? "") : null;
    return { request, lang, t: tr(lang), now: now(), account, sessionToken, csrf: auth && sessionToken ? csrfToken(auth.sessionSecret, sessionToken) : null, form, auth };
  }

  function kitFor(context: WebContext): WebKit {
    const page: WebKit["page"] = (status, title, body, extra = {}) => ({
      status, body: layout({ lang: context.lang, title, path: context.request.path, body, account: context.account, csrf: context.csrf, signInOn: Boolean(deps.auth), ...(extra.description ? { description: extra.description } : {}), ...(extra.noindex ? { noindex: true } : {}), ...(extra.languageParams ? { languageParams: extra.languageParams } : {}), ...(extra.shareImage ? { shareImage: new URL(extra.shareImage, deps.auth?.siteUrl ?? "https://guilded.kcaron.top").href } : {}) }),
      headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", ...(extra.cookies ? { "set-cookie": extra.cookies } : {}) }
    });
    return {
      page,
      redirect: (location, cookies) => ({ status: context.request.method === "POST" ? 303 : 302, body: "", headers: { ...SECURITY_HEADERS, location, ...(cookies ? { "set-cookie": cookies } : {}) } }),
      signInPrompt: () => {
        const t = context.t;
        const body = deps.auth
          ? `<h1>${t("Sign in first", "Connectez-vous d'abord")}</h1><p>${t("This page needs your Discord account. Guilded only reads your Discord name and ID.", "Cette page demande votre compte Discord. Guilded ne lit que votre nom et votre identifiant Discord.")}</p><p><a class="button" href="${link("/auth/login", context.lang, { return: link(context.request.path, context.lang) })}">${t("Sign in with Discord", "Connexion avec Discord")}</a></p>`
          : `<h1>${t("Sign-in is off", "Connexion désactivée")}</h1><p>${t("Signing in with Discord is not set up on this server yet.", "La connexion avec Discord n'est pas encore configurée sur ce serveur.")}</p>`;
        return page(deps.auth ? 401 : 503, t("Sign in", "Connexion"), body, { noindex: true });
      }
    };
  }

  // POSTs: from this website (Origin), signed in, with the session's CSRF token.
  function postAllowed(context: WebContext): boolean {
    if (!deps.auth || !context.form || !context.account) return false;
    if (!sameOrigin({ origin: context.request.headers.origin, referer: context.request.headers.referer }, deps.auth.siteUrl)) return false;
    return checkCsrf(deps.auth.sessionSecret, context.sessionToken, context.form.get("csrf") ?? undefined);
  }

  async function respond(request: WebRequest): Promise<WebResponse | null> {
    const form = request.method === "POST" && (request.body ?? "").length <= webFormLimit(request.path) ? new URLSearchParams(request.body) : null;
    let edition;
    try { edition = gameEditionOf({ gameEdition: request.query.get("edition") ?? form?.get("edition") ?? "forever" }); }
    catch { return { status: 400, headers: SECURITY_HEADERS, body: "Unknown WoW edition" }; }
    return withEdition(edition, () => respondInEdition(request));
  }
  async function respondInEdition(request: WebRequest): Promise<WebResponse | null> {
    if (!isWebPath(request.path)) return null;
    const ctx = await context(request);
    const kit = kitFor(ctx);
    const { t } = ctx;
    if (!["GET", "HEAD", "POST"].includes(request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD, POST" }, body: "" };
    if (request.method === "POST" && !postAllowed(ctx)) {
      return kit.page(ctx.account ? 403 : deps.auth ? 401 : 503, t("Not sent", "Non envoyé"), `<h1>${t("This form could not be sent", "Ce formulaire n'a pas pu être envoyé")}</h1><p>${ctx.account ? t("It came from another page or expired. Go back, reload the page and try again.", "Il venait d'une autre page ou a expiré. Revenez en arrière, rechargez la page et réessayez.") : t("Sign in with Discord first.", "Connectez-vous d'abord avec Discord.")}</p>`, { noindex: true });
    }
    const path = request.path;
    if (path === "/recruitment" || path === "/me" || path === "/leaderboards") return kit.redirect(`${path}/${request.query.size ? `?${request.query.toString()}` : ""}`);

    // --- Sign-in -------------------------------------------------------------------------------
    if (path === "/auth/login") {
      if (!deps.auth) return kit.signInPrompt();
      const state = newToken();
      return kit.redirect(authorizeUrl(deps.auth, state), [stateCookie(deps.auth, state, safeReturnPath(request.query.get("return")), ctx.now)]);
    }
    if (path === "/auth/callback") {
      if (!deps.auth) return kit.signInPrompt();
      const saved = readStateCookie(deps.auth, parseCookies(request.headers.cookie)[STATE_COOKIE], request.query.get("state"), ctx.now);
      const code = request.query.get("code");
      if (!saved || !code || code.length > 200) {
        return kit.page(400, t("Sign-in failed", "Échec de la connexion"), `<h1>${t("Sign-in did not finish", "La connexion n'a pas abouti")}</h1><p>${t("The sign-in link expired or was opened in another browser.", "Le lien de connexion a expiré ou a été ouvert dans un autre navigateur.")}</p><p><a class="button" href="${link("/auth/login", ctx.lang)}">${t("Try again", "Réessayer")}</a></p>`, { noindex: true, cookies: [clearCookie(STATE_COOKIE)] });
      }
      let identity;
      try { identity = await exchangeCode(deps.auth, code, deps.fetch ?? fetch); }
      catch { return kit.page(502, t("Sign-in failed", "Échec de la connexion"), `<h1>${t("Discord did not confirm the sign-in", "Discord n'a pas confirmé la connexion")}</h1><p><a class="button" href="${link("/auth/login", ctx.lang)}">${t("Try again", "Réessayer")}</a></p>`, { noindex: true, cookies: [clearCookie(STATE_COOKIE)] }); }
      const account = await deps.store.upsertAccount(identity, ctx.now);
      const token = newToken();
      await deps.store.createSession(account.id, hashToken(token), new Date(ctx.now.getTime() + SESSION_DAYS * 86_400_000));
      return kit.redirect(saved.returnPath, [clearCookie(STATE_COOKIE), serializeCookie(SESSION_COOKIE, sign(deps.auth.sessionSecret, token), SESSION_DAYS * 86_400)]);
    }
    if (path === "/auth/logout") {
      if (request.method !== "POST") return kit.redirect(link("/recruitment/", ctx.lang));
      await deps.store.deleteSession(hashToken(ctx.sessionToken!));
      return kit.redirect(link("/recruitment/", ctx.lang, { done: "signed-out" }), [clearCookie(SESSION_COOKIE)]);
    }

    // --- Recruitment -----------------------------------------------------------------------------
    if (path === "/recruitment/" && request.method !== "POST") return recruitmentPage(ctx, kit);
    const apply = /^\/recruitment\/apply\/([^/]+)$/.exec(path);
    if (apply) return applyPage(ctx, kit, apply[1]!);
    if (path === "/recruitment/report" && request.method === "POST") return report(ctx, kit);
    if (path === "/me/" && request.method !== "POST") return mePage(ctx, kit);
    if (path === "/me/card" && request.method === "POST") return saveCard(ctx, kit);
    if (path === "/me/card/delete" && request.method === "POST") {
      await deps.store.deleteCard(ctx.account!.id);
      return kit.redirect(link("/me/", ctx.lang, { done: "card-deleted" }));
    }
    for (const route of deps.routes ?? []) {
      const answer = await route(ctx, kit);
      if (answer) return answer;
    }
    return kit.page(404, t("Not found", "Introuvable"), `<h1>${t("Page not found", "Page introuvable")}</h1>`, { noindex: true });
  }

  // --- /recruitment/ ---------------------------------------------------------------------------
  async function recruitmentPage(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t, lang } = ctx;
    const filters = readFilters(ctx.request.query);
    const raids = (await deps.publicRaids?.(ctx.now) ?? []).filter(raid => deps.allows(raid.guildDiscordId) && publicRaidMatches(raid, filters));
    const listings = (await deps.store.openListings()).filter((listing) => deps.allows(listing.guildDiscordId) && listingMatches(listing, filters));
    const cards = deps.auth ? (await deps.store.visibleCards(ctx.now)).filter((card) => cardMatches(card, filters)) : [];
    const done = ctx.request.query.get("done");
    const flash = done === "signed-out" ? t("You are signed out.", "Vous êtes déconnecté.") : done === "reported" ? t("Thanks, the report was sent.", "Merci, le signalement a été envoyé.") : null;
    const body = [
      `<p class="eyebrow">Guilded</p><h1>${t("Guild recruitment", "Recrutement de guildes")}</h1>`,
      `<p class="muted">${t("Guilds and raid cores looking for players, and players looking for a guild. Listings come from guilds using Guilded.", "Des guildes et des cores de raid qui cherchent des joueurs, et des joueurs qui cherchent une guilde. Les annonces viennent des guildes qui utilisent Guilded.")}</p>`,
      flash ? `<p class="notice">${escapeHtml(flash)}</p>` : "",
      deps.auth ? "" : `<p class="notice">${t("Sign-in with Discord is not set up on this server yet, so applying and player cards are off.", "La connexion avec Discord n'est pas encore configurée : les candidatures et les fiches de joueurs sont désactivées.")}</p>`,
      filterForm(ctx, filters),
      filters.kind === "all" || filters.kind === "raids" ? `<h2>${t("Open raid spots", "Places de raid disponibles")} (${raids.length})</h2><p>${t("One raid night, no guild commitment. Counts come from confirmed Discord signups. Join the host server, then use its signup post; a spot is not reserved until confirmed there.", "Une soirée de raid, sans engagement de guilde. Les places viennent des inscriptions Discord confirmées. Rejoignez le serveur hôte puis son annonce; la place doit y être confirmée.")}</p>`
        + (raids.length ? `<div class="cards">${raids.map(raid => publicRaidCard(ctx, raid)).join("")}</div>` : `<p class="muted">${t("No open raid spot right now. Officers: share a raid night with /raid pug share in Discord and it shows up here.", "Aucune place de raid pour l'instant. Officiers : partagez une soirée de raid avec /raid pug share dans Discord et elle s'affiche ici.")}</p>`) : "",
      filters.kind === "players" || filters.kind === "raids" ? "" : `<h2>${t("Recruiting now", "Recrutent en ce moment")} <span class="tag">(${listings.length})</span></h2>`
        + (listings.length ? `<div class="cards">${listings.map((listing) => listingCard(ctx, listing)).join("")}</div>` : `<p class="muted">${t("No guild matches these filters yet. Officers: list your guild or a raid core with /recruit set in Discord.", "Aucune guilde ne correspond encore à ces filtres. Officiers : publiez votre guilde ou un core de raid avec /recruit set dans Discord.")} <a href="/officers/?lang=${lang}">${t("Guide for officers", "Guide des officiers")}</a></p>`),
      filters.kind === "guild" || filters.kind === "core" || filters.kind === "raids" || !deps.auth ? "" : `<h2>${t("Players looking for a guild", "Joueurs qui cherchent une guilde")} <span class="tag">(${cards.length})</span></h2>`
        + `<p><a href="${link("/me/", lang)}">${t("Post or edit your own card", "Publier ou modifier votre fiche")}</a></p>`
        + (cards.length ? `<div class="cards">${cards.map((card) => playerCard(ctx, card)).join("")}</div>` : `<p class="muted">${t("No player card matches these filters yet. Looking for a guild? Post your card: officers can find you here.", "Aucune fiche ne correspond encore à ces filtres. Vous cherchez une guilde ? Publiez votre fiche : les officiers vous trouveront ici.")}</p>`)
    ].join("");
    return kit.page(200, t("Guild recruitment", "Recrutement de guildes"), body, { description: t("WoW guilds and raid cores recruiting, and players looking for a guild.", "Guildes et cores de raid WoW qui recrutent, et joueurs qui cherchent une guilde.") });
  }

  function filterForm(ctx: WebContext, filters: Filters): string {
    const { t, lang } = ctx;
    const any = { value: "", label: t("Any", "Tous") };
    return `<form class="filters" method="get" action="/recruitment/"><input type="hidden" name="lang" value="${lang}"><div><label for="edition">WoW</label><select name="edition" id="edition">${options(GAME_EDITIONS.map(value => ({value,label:value})),currentEdition())}</select></div>`
      + `<div><label for="kind">${t("Show", "Afficher")}</label><select id="kind" name="kind">${options([{ value: "all", label: t("Everything", "Tout") }, { value: "guild", label: t("Guilds", "Guildes") }, { value: "core", label: t("Raid cores", "Cores de raid") }, { value: "raids", label: t("Open raid spots", "Places de raid") }, { value: "players", label: t("Players", "Joueurs") }], filters.kind)}</select></div>`
      + `<div><label for="class">${t("Class", "Classe")}</label><select id="class" name="class">${options([any, ...CLASSES.map((name) => ({ value: name, label: classLabel(name, lang) }))], filters.className)}</select></div>`
      + `<div><label for="role">${t("Role", "Rôle")}</label><select id="role" name="role">${options([any, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], filters.role)}</select></div>`
      + `<div><label for="faction">${t("Faction", "Faction")}</label><select id="faction" name="faction">${options([any, ...FACTIONS.map((value) => ({ value, label: factionLabel(value, lang) }))], filters.faction)}</select></div>`
      + `<div><label for="language">${t("Language", "Langue")}</label><select id="language" name="language">${options([any, { value: "en", label: languageLabel("en", lang) }, { value: "fr", label: languageLabel("fr", lang) }], filters.language)}</select></div>`
      + `<div><label for="realm">${t("Realm", "Royaume")}</label><input id="realm" name="realm" maxlength="40" value="${escapeHtml(filters.realm ?? "")}"></div>`
      + `<div><button class="button" type="submit">${t("Filter", "Filtrer")}</button></div></form>`;
  }

  const tags = (ctx: WebContext, parts: (string | null | false | undefined)[]) => {
    const shown = parts.filter((part): part is string => Boolean(part));
    return shown.length ? `<p class="tag">${shown.map(escapeHtml).join(" · ")}</p>` : "";
  };

  function publicRaidCard(ctx: WebContext, raid: PublicRaid): string {
    const { t, lang } = ctx;
    const when = new Date(raid.scheduledAt).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
    return `<article class="card"><h3>${escapeHtml(raid.title)}</h3><p>${escapeHtml([raid.guildName, raid.coreName].filter(Boolean).join(" · "))}</p>`
      + tags(ctx, [raid.realm, factionLabel(raid.faction, lang), languageLabel(raid.language, lang), `${when} UTC`])
      + `<p>${ROLES.filter(role => raid.spots[role] > 0).map(role => `${raid.spots[role]} ${roleLabel(role, lang)}`).join(" · ")}</p>`
      + `<p><a class="button" href="${escapeHtml(raid.inviteUrl)}">${t("Join host Discord", "Rejoindre le Discord hôte")}</a> <a href="${escapeHtml(raid.signupUrl)}">${t("Raid signup", "Inscription au raid")}</a></p></article>`;
  }

  function reportButton(ctx: WebContext, type: "listing" | "card", id: string): string {
    if (!ctx.account) return "";
    return `<form class="inline" method="post" action="/recruitment/report"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${escapeHtml(id)}"><input type="hidden" name="lang" value="${ctx.lang}"><button class="link" type="submit">${ctx.t("Report", "Signaler")}</button></form>`;
  }

  function listingCard(ctx: WebContext, listing: PublicListing): string {
    const { t, lang } = ctx;
    const title = escapeHtml(listing.guildName) + (listing.core ? ` · ${escapeHtml(listing.core.name)}` : "");
    const wanted = [
      listing.classes.length ? listing.classes.map((name) => classLabel(name, lang)).join(", ") : t("All classes", "Toutes les classes"),
      listing.roles.length ? listing.roles.map((role) => roleLabel(role, lang)).join(", ") : t("all roles", "tous les rôles")
    ].join(" · ");
    const when = [listing.raidDays.map((day) => dayLabel(day, lang)).join(" "), listing.raidTimes ?? listing.core?.schedule ?? ""].filter(Boolean).join(" · ");
    return `<div class="card"><h3>${title}</h3><p>${t("Looking for", "Recherche")} : ${escapeHtml(wanted)}</p>`
      + (when ? `<p>${escapeHtml(when)}</p>` : "")
      + tags(ctx, [listing.faction && factionLabel(listing.faction, lang), listing.realm, listing.language && languageLabel(listing.language, lang)])
      + (listing.note ? `<p class="muted">${escapeHtml(listing.note)}</p>` : "")
      + `<p><a class="button" href="${link(`/recruitment/apply/${listing.id}`, lang)}">${t("Apply", "Postuler")}</a>`
      + (listing.pageSlug ? ` &nbsp;<a href="/g/${escapeHtml(listing.pageSlug)}/">${t("Guild page", "Page de la guilde")}</a>` : "")
      + ` &nbsp;${reportButton(ctx, "listing", listing.id)}</p></div>`;
  }

  function playerCard(ctx: WebContext, card: PublicCard): string {
    const { t, lang } = ctx;
    return `<div class="card"><h3>${escapeHtml(card.character)}</h3><p>${escapeHtml(`${classLabel(card.className, lang)} · ${roleLabel(card.role, lang)}${card.level ? ` · ${t("level", "niveau")} ${card.level}` : ""}`)}</p>`
      + tags(ctx, [card.faction && factionLabel(card.faction, lang), card.realm, card.language && languageLabel(card.language, lang), card.raidDays.map((day) => dayLabel(day, lang)).join(" ")])
      + (card.note ? `<p class="muted">${escapeHtml(card.note)}</p>` : "")
      + (card.discord ? `<p>Discord : <strong>${escapeHtml(card.discord)}</strong></p>` : "")
      + `<p>${reportButton(ctx, "card", card.id)}</p></div>`;
  }

  // --- Apply -----------------------------------------------------------------------------------
  async function applyPage(ctx: WebContext, kit: WebKit, id: string): Promise<WebResponse> {
    const { t, lang } = ctx;
    const listing = ID.test(id) ? await deps.store.listing(id) : null;
    if (!listing || !listing.open || !deps.allows(listing.guildDiscordId)) {
      return kit.page(404, t("Not found", "Introuvable"), `<h1>${t("This listing is closed", "Cette annonce est fermée")}</h1><p><a href="${link("/recruitment/", lang)}">${t("See open listings", "Voir les annonces ouvertes")}</a></p>`, { noindex: true });
    }
    if (!ctx.account) return kit.signInPrompt();
    const title = `${t("Apply to", "Postuler chez")} ${listing.guildName}${listing.core ? ` · ${listing.core.name}` : ""}`;
    let error: string | null = null;
    if (ctx.request.method === "POST") {
      const form = ctx.form!;
      try {
        const character = characterName(form.get("character") ?? "");
        const chosenClass = className(form.get("class") ?? "");
        if (!chosenClass) throw new RecruitmentError(t("Choose your class.", "Choisissez votre classe."));
        const role = (ROLES as readonly string[]).includes(form.get("role") ?? "") ? form.get("role")! : null;
        if (!role) throw new RecruitmentError(t("Choose your role.", "Choisissez votre rôle."));
        const message = shortText(form.get("message"), LIMITS.messageLength, t("The message", "Le message"));
        if (!message || message.length < 10) throw new RecruitmentError(t("Write a short message (10 characters or more).", "Écrivez un court message (10 caractères ou plus)."));
        if (await deps.store.markedAsSpam(ctx.account.id, listing.guildDiscordId)) throw new RecruitmentError(t("This guild does not accept applications from your account.", "Cette guilde n'accepte pas de candidature de votre compte."));
        if (await deps.store.hasPendingApplication(ctx.account.id, listing.id)) throw new RecruitmentError(t("You already have an application waiting here. The officers will answer it.", "Vous avez déjà une candidature en attente ici. Les officiers y répondront."));
        if (await deps.store.applicationsSince(ctx.account.id, new Date(ctx.now.getTime() - 86_400_000)) >= LIMITS.applicationsPerDay) throw new RecruitmentError(t(`You can send ${LIMITS.applicationsPerDay} applications a day. Try again tomorrow.`, `Vous pouvez envoyer ${LIMITS.applicationsPerDay} candidatures par jour. Réessayez demain.`));
        const created = await deps.store.createApplication({ listingId: listing.id, accountId: ctx.account.id, character, className: chosenClass, role, message });
        const view = await deps.store.applicationForDecision(created.id);
        const posted = view ? await deps.postApplication(view).catch(() => null) : null;
        if (!posted) {
          await deps.store.deleteApplication(created.id);
          throw new RecruitmentError(t("The guild cannot receive applications right now. Try again later or contact them on Discord.", "La guilde ne peut pas recevoir de candidature pour l'instant. Réessayez plus tard ou contactez-la sur Discord."));
        }
        await deps.store.setApplicationMessage(created.id, posted.channelId, posted.messageId);
        return kit.redirect(link("/me/", lang, { done: "applied" }));
      } catch (caught) {
        if (!(caught instanceof RecruitmentError)) throw caught;
        error = caught.message;
      }
    }
    const form = ctx.form;
    const body = `<p class="eyebrow">${t("Recruitment", "Recrutement")}</p><h1>${escapeHtml(title)}</h1>${listingCard({ ...ctx, account: null }, listing)}`
      + (error ? `<p class="notice error">${escapeHtml(error)}</p>` : "")
      + `<form method="post" action="/recruitment/apply/${listing.id}"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="edition" value="${currentEdition()}">`
      + `<label for="character">${t("Character name", "Nom du personnage")}</label><input id="character" name="character" required maxlength="61" value="${escapeHtml(form?.get("character") ?? "")}">`
      + `<label for="class">${t("Class", "Classe")}</label><select id="class" name="class" required>${options([{ value: "", label: "—" }, ...CLASSES.map((name) => ({ value: name, label: classLabel(name, lang) }))], form?.get("class"))}</select>`
      + `<label for="role">${t("Role", "Rôle")}</label><select id="role" name="role" required>${options([{ value: "", label: "—" }, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], form?.get("role"))}</select>`
      + `<label for="message">${t("Message to the officers", "Message aux officiers")}</label><textarea id="message" name="message" required maxlength="${LIMITS.messageLength}">${escapeHtml(form?.get("message") ?? "")}</textarea>`
      + `<p class="tag">${t("The officers see your Discord name with the application. You will get their answer by Discord message when possible, and on your page.", "Les officiers voient votre nom Discord avec la candidature. Vous recevrez leur réponse par message Discord si possible, et sur votre page.")}</p>`
      + `<p><button class="button" type="submit">${t("Send the application", "Envoyer la candidature")}</button></p></form>`;
    return kit.page(error ? 400 : 200, title, body, { noindex: true });
  }

  // --- Reports ---------------------------------------------------------------------------------
  async function report(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const form = ctx.form!;
    const type = form.get("type") === "card" ? "card" : form.get("type") === "listing" ? "listing" : null;
    const id = form.get("id") ?? "";
    const exists = type === "listing" ? Boolean(ID.test(id) && await deps.store.listing(id)) : type === "card" ? ID.test(id) && await deps.store.cardExists(id) : false;
    if (!type || !exists) return kit.redirect(link("/recruitment/", ctx.lang));
    if (await deps.store.reportsSince(ctx.account!.id, new Date(ctx.now.getTime() - 86_400_000)) >= LIMITS.reportsPerDay) return kit.redirect(link("/recruitment/", ctx.lang, { done: "reported" }));
    const added = await deps.store.addReport(ctx.account!.id, type, id, shortText(form.get("reason"), 300, "The reason"));
    if (added && type === "card" && await deps.store.reportCount("card", id) >= LIMITS.cardHideReports) await deps.store.hideCard(id);
    if (added && type === "listing") {
      const listing = await deps.store.listing(id);
      await deps.tellOwner?.(`🚩 Recruitment listing reported by ${ctx.account!.username} (${ctx.account!.discordUserId}): ${listing?.guildName ?? "?"}${listing?.core ? ` · ${listing.core.name}` : ""} (listing ${id}).`).catch(() => undefined);
    }
    return kit.redirect(link("/recruitment/", ctx.lang, { done: "reported" }));
  }

  // --- /me/ ------------------------------------------------------------------------------------
  async function mePage(ctx: WebContext, kit: WebKit, error: string | null = null): Promise<WebResponse> {
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const applications = await deps.store.myApplications(ctx.account.id);
    const card = await deps.store.card(ctx.account.id);
    const form = error ? ctx.form : null;
    const value = (name: keyof CardFields) => form ? form.get(name) ?? "" : card ? String(card[name] ?? "") : "";
    const done = ctx.request.query.get("done");
    const flash = done === "applied" ? t("Application sent. The officers will answer in Discord.", "Candidature envoyée. Les officiers répondront dans Discord.")
      : done === "card-saved" ? t("Your card is saved and shown for 30 days.", "Votre fiche est enregistrée et affichée 30 jours.")
      : done === "card-deleted" ? t("Your card is removed.", "Votre fiche est retirée.") : null;
    const status: Record<string, string> = { PENDING: t("Waiting", "En attente"), ACCEPTED: t("Accepted", "Acceptée"), DECLINED: t("Declined", "Refusée"), SPAM: t("Declined", "Refusée") };
    const days = form ? form.getAll("days") : card?.raidDays ?? [];
    const extra = await Promise.all((deps.meSections ?? []).map((section) => section(ctx)));
    const body = [
      `<p class="eyebrow">Guilded</p><h1>${t("My Guilded", "Mon Guilded")}</h1>`,
      `<nav aria-label="${t("My shortcuts", "Mes raccourcis")}"><a href="${link("/me/calendar", lang)}">${t("My next raid", "Mon prochain raid")}</a> · <a href="${link("/companion/", lang)}">${t("My sync", "Ma synchronisation")}</a> · <a href="#my-week">${t("My week", "Ma semaine")}</a></nav>`,
      `<p id="my-week">${t("My week: use", "Ma semaine : utilisez")} <code>/report stats personal:true</code> ${t("in your guild’s Discord for a private recap of the last complete week.", "dans le Discord de votre guilde pour un récapitulatif privé de la dernière semaine complète.")}</p>`,
      flash ? `<p class="notice">${escapeHtml(flash)}</p>` : "",
      extra.join(""),
      `<h2>${t("My applications", "Mes candidatures")}</h2>`,
      applications.length
        ? `<div class="table-wrap"><table><thead><tr><th>${t("Guild", "Guilde")}</th><th>${t("Character", "Personnage")}</th><th>${t("Sent", "Envoyée")}</th><th>${t("Answer", "Réponse")}</th></tr></thead><tbody>${applications.map((row) => `<tr><td>${escapeHtml(row.guildName)}${row.coreName ? ` · ${escapeHtml(row.coreName)}` : ""}</td><td>${escapeHtml(row.character)}</td><td>${row.createdAt.toISOString().slice(0, 10)}</td><td>${escapeHtml(status[row.status] ?? row.status)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted">${t("None yet.", "Aucune pour l'instant.")} <a href="${link("/recruitment/", lang)}">${t("See who is recruiting", "Voir qui recrute")}</a></p>`,
      `<h2>${t("Looking for a guild", "Je cherche une guilde")}</h2>`,
      card?.hidden ? `<p class="notice error">${t("Your card was hidden after several reports. Ask the Guilded owner to review it.", "Votre fiche a été masquée après plusieurs signalements. Demandez au propriétaire de Guilded de la revoir.")}</p>` : "",
      card && !card.hidden ? `<p class="muted">${t("Shown until", "Affichée jusqu'au")} ${card.expiresAt.toISOString().slice(0, 10)}.</p>` : "",
      error ? `<p class="notice error">${escapeHtml(error)}</p>` : "",
      `<form method="post" action="/me/card"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="edition" value="${currentEdition()}">`
        + `<label for="character">${t("Character name", "Nom du personnage")}</label><input id="character" name="character" required maxlength="61" value="${escapeHtml(value("character"))}">`
        + `<label for="className">${t("Class", "Classe")}</label><select id="className" name="className" required>${options([{ value: "", label: "—" }, ...CLASSES.map((name) => ({ value: name, label: classLabel(name, lang) }))], value("className"))}</select>`
        + `<label for="role">${t("Role", "Rôle")}</label><select id="role" name="role" required>${options([{ value: "", label: "—" }, ...ROLES.map((role) => ({ value: role, label: roleLabel(role, lang) }))], value("role"))}</select>`
        + `<label for="level">${t("Level", "Niveau")}</label><input id="level" name="level" inputmode="numeric" maxlength="2" value="${escapeHtml(value("level"))}">`
        + `<label for="realm">${t("Realm", "Royaume")}</label><input id="realm" name="realm" maxlength="40" value="${escapeHtml(value("realm"))}">`
        + `<label for="faction">${t("Faction", "Faction")}</label><select id="faction" name="faction">${options([{ value: "", label: "—" }, ...FACTIONS.map((faction) => ({ value: faction, label: factionLabel(faction, lang) }))], value("faction"))}</select>`
        + `<label for="language">${t("Language", "Langue")}</label><select id="language" name="language">${options([{ value: "", label: "—" }, { value: "en", label: languageLabel("en", lang) }, { value: "fr", label: languageLabel("fr", lang) }, { value: "both", label: languageLabel("both", lang) }], value("language"))}</select>`
        + `<label>${t("Days I can raid", "Jours où je peux raider")}</label><p>${["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => `<label style="display:inline;margin-right:12px"><input type="checkbox" style="width:auto" name="days" value="${day}"${days.includes(day) ? " checked" : ""}> ${dayLabel(day, lang)}</label>`).join("")}</p>`
        + `<label for="note">${t("About me (optional)", "À propos de moi (facultatif)")}</label><textarea id="note" name="note" maxlength="${LIMITS.noteLength}">${escapeHtml(value("note"))}</textarea>`
        + `<p><label style="display:inline"><input type="checkbox" style="width:auto" name="showDiscord" value="1"${(form ? form.get("showDiscord") : card?.showDiscord) ? " checked" : ""}> ${t("Show my Discord name so guilds can contact me", "Afficher mon nom Discord pour que les guildes me contactent")}</label></p>`
        + `<p><button class="button" type="submit">${t("Save my card", "Enregistrer ma fiche")}</button></p></form>`,
      card ? `<form method="post" action="/me/card/delete"><input type="hidden" name="csrf" value="${escapeHtml(ctx.csrf ?? "")}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="edition" value="${currentEdition()}"><button class="link" type="submit">${t("Remove my card", "Retirer ma fiche")}</button></form>` : ""
    ].join("");
    return kit.page(error ? 400 : 200, t("My Guilded", "Mon Guilded"), body, { noindex: true });
  }

  async function saveCard(ctx: WebContext, kit: WebKit): Promise<WebResponse> {
    const { t } = ctx;
    const form = ctx.form!;
    const recent = (cardSaves.get(ctx.account!.id) ?? []).filter((at) => ctx.now.getTime() - at < 3_600_000);
    try {
      if (recent.length >= LIMITS.cardSavesPerHour) throw new RecruitmentError(t("Too many changes in an hour. Try again later.", "Trop de modifications en une heure. Réessayez plus tard."));
      const chosenClass = className(form.get("className") ?? "");
      if (!chosenClass) throw new RecruitmentError(t("Choose your class.", "Choisissez votre classe."));
      const role = form.get("role") ?? "";
      if (!(ROLES as readonly string[]).includes(role)) throw new RecruitmentError(t("Choose your role.", "Choisissez votre rôle."));
      const levelText = (form.get("level") ?? "").trim();
      const level = levelText ? Number(levelText) : null;
      if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= 90)) throw new RecruitmentError(t("The level is a number from 1 to 90.", "Le niveau est un nombre de 1 à 90."));
      const faction = form.get("faction") ?? "";
      const language = form.get("language") ?? "";
      const fields: CardFields = {
        character: characterName(form.get("character") ?? ""), className: chosenClass, role, level,
        realm: shortText(form.get("realm"), 40, t("The realm", "Le royaume")),
        faction: (FACTIONS as readonly string[]).includes(faction) ? faction : null,
        language: ["en", "fr", "both"].includes(language) ? language : null,
        raidDays: parseDays(form.getAll("days").join(",")),
        note: shortText(form.get("note"), LIMITS.noteLength, t("The note", "La note")),
        showDiscord: form.get("showDiscord") === "1"
      };
      cardSaves.set(ctx.account!.id, [...recent, ctx.now.getTime()]);
      if (cardSaves.size > 5_000) cardSaves.delete(cardSaves.keys().next().value!);
      await deps.store.saveCard(ctx.account!.id, fields, new Date(ctx.now.getTime() + LIMITS.cardDays * 86_400_000));
      return kit.redirect(link("/me/", ctx.lang, { done: "card-saved" }));
    } catch (caught) {
      if (!(caught instanceof RecruitmentError)) throw caught;
      return mePage(ctx, kit, caught.message);
    }
  }

  return { respond };
}
