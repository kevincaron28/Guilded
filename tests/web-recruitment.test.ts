import { describe, expect, it, vi } from "vitest";
import { createWebApp, type WebAppDeps, type WebRequest, type WebResponse } from "../src/services/web-app.js";
import { parseCookies } from "../src/services/web-auth.js";
import { cardMatches, listingMatches, parseClasses, parseDays, parseRoles, readFilters } from "../src/services/recruitment.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const auth = { clientId: "123456789012345678", clientSecret: "secret", siteUrl: SITE, sessionSecret: "s".repeat(40) };
const APPROVED = "111111111111111111";
const LITE = "333333333333333333";

function setup(over: Partial<WebAppDeps> = {}) {
  const memory = memoryWebStore();
  let user = { id: "222222222222222222", username: "kev", global_name: "Kev" };
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/oauth2/token")
    ? Response.json({ access_token: "token", token_type: "Bearer" }) : Response.json(user));
  const postApplication = vi.fn(async () => ({ channelId: "c1", messageId: "m1" }));
  const tellOwner = vi.fn(async () => undefined);
  const app = createWebApp({ store: memory.store, auth, allows: (id) => id === APPROVED, postApplication, tellOwner, fetch: fetcher as unknown as typeof fetch, ...over });
  const request = (method: string, target: string, headers: WebRequest["headers"] = {}, body?: string) => {
    const url = new URL(target, SITE);
    return app.respond({ method, path: url.pathname, query: url.searchParams, headers, ...(body !== undefined ? { body } : {}) }) as Promise<WebResponse>;
  };
  async function signIn(as = user) {
    user = as;
    const login = await request("GET", "/auth/login?return=/recruitment/");
    const location = new URL(String(login.headers["location"]));
    const stateCookie = String((login.headers["set-cookie"] as string[])[0]).split(";")[0]!;
    const callback = await request("GET", `/auth/callback?code=abc&state=${location.searchParams.get("state")}`, { cookie: stateCookie });
    const session = (callback.headers["set-cookie"] as string[]).find((cookie) => cookie.startsWith("__Host-guilded_session="))!.split(";")[0]!;
    const me = await request("GET", "/me/", { cookie: session });
    const csrf = /name="csrf" value="([^"]+)"/.exec(me.body)![1]!;
    return { cookie: session, csrf, callback };
  }
  const post = (path: string, session: { cookie: string; csrf: string }, fields: Record<string, string | string[]>, headers: WebRequest["headers"] = {}) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries({ csrf: session.csrf, ...fields })) for (const item of [value].flat()) body.append(key, item);
    return request("POST", path, { cookie: session.cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded", ...headers }, body.toString());
  };
  return { memory, app, request, signIn, post, postApplication, tellOwner, fetcher };
}

describe("sign-in flow", () => {
  it("returns to the selected edition and language after sign-in from a protected page", async () => {
    const { request } = setup();
    const prompt = await request("GET", "/me/?edition=retail&lang=fr");
    expect(prompt.status).toBe(401);
    const loginHref = /class="button" href="([^"]+)"/.exec(prompt.body)![1]!.replaceAll("&amp;", "&");
    const login = await request("GET", loginHref);
    const state = new URL(String(login.headers["location"])).searchParams.get("state");
    const cookie = String((login.headers["set-cookie"] as string[])[0]).split(";")[0]!;
    const callback = await request("GET", `/auth/callback?code=abc&state=${state}`, { cookie });
    expect(callback.headers["location"]).toBe("/me/?edition=retail&lang=fr");
  });
  it("sends the browser to Discord and back with a signed session cookie", async () => {
    const { request, signIn } = setup();
    const login = await request("GET", "/auth/login?return=/recruitment/");
    expect(login.status).toBe(302);
    expect(String(login.headers["location"])).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?.*scope=identify/);
    const { callback } = await signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers["location"]).toBe("/recruitment/");
    const cookies = callback.headers["set-cookie"] as string[];
    expect(cookies.some((cookie) => /^__Host-guilded_oauth=; Max-Age=0/.test(cookie))).toBe(true);
    expect(cookies.find((cookie) => cookie.startsWith("__Host-guilded_session="))).toMatch(/HttpOnly; Secure; SameSite=Lax$/);
  });

  it("refuses a callback without the matching state cookie", async () => {
    const { request, fetcher } = setup();
    const answer = await request("GET", "/auth/callback?code=abc&state=forged", { cookie: "__Host-guilded_oauth=forged.sig" });
    expect(answer.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not trust a forged session cookie", async () => {
    const { request } = setup();
    const answer = await request("GET", "/me/", { cookie: "__Host-guilded_session=made-up.signature" });
    expect(answer.status).toBe(401);
    expect(answer.body).toContain("Sign in with Discord");
  });

  it("signs out with a form post and clears the cookie", async () => {
    const { signIn, post, request } = setup();
    const session = await signIn();
    const out = await post("/auth/logout", session, {});
    expect(out.status).toBe(303);
    expect((out.headers["set-cookie"] as string[])[0]).toMatch(/^__Host-guilded_session=; Max-Age=0/);
    expect((await request("GET", "/me/", { cookie: session.cookie })).status).toBe(401);
  });

  it("says sign-in is off when the server has no OAuth settings", async () => {
    const { request } = setup({ auth: null });
    expect((await request("GET", "/auth/login")).status).toBe(503);
    const page = await request("GET", "/recruitment/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Sign-in with Discord is not set up");
  });
});

describe("CSRF protection on every form", () => {
  it("refuses a post without the token, with another session's token, or from another site", async () => {
    const { signIn, post, memory } = setup();
    const listing = memory.addListing();
    const kev = await signIn();
    const other = await signIn({ id: "444444444444444444", username: "other", global_name: "Other" });
    const fields = { character: "Kev", class: "Warrior", role: "TANK", message: "I raid every Wednesday." };
    expect((await post(`/recruitment/apply/${listing.id}`, { ...kev, csrf: "" }, fields)).status).toBe(403);
    expect((await post(`/recruitment/apply/${listing.id}`, { ...kev, csrf: other.csrf }, fields)).status).toBe(403);
    expect((await post(`/recruitment/apply/${listing.id}`, kev, fields, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/me/card/delete", { cookie: "", csrf: kev.csrf }, {})).status).toBe(401);
    expect(memory.applications.size).toBe(0);
  });
});

describe("recruitment listing page", () => {
  it("lists open listings of approved servers only, with filters", async () => {
    const { request, memory } = setup();
    memory.addListing({ guildName: "Quebec Gold", classes: ["Priest"], roles: ["HEALER"] });
    memory.addListing({ guildName: "Les Pulliticiens", core: { name: "Core B", schedule: "Sun 8pm" }, faction: "HORDE" });
    memory.addListing({ guildName: "Lite Guild", guildDiscordId: LITE });
    memory.addListing({ guildName: "Closed Guild", open: false });
    const all = await request("GET", "/recruitment/");
    expect(all.body).toContain("Quebec Gold");
    expect(all.body).toContain("Les Pulliticiens · Core B");
    expect(all.body).not.toContain("Lite Guild");
    expect(all.body).not.toContain("Closed Guild");
    expect(all.headers["content-security-policy"]).toContain("default-src 'none'");
    const mages = await request("GET", "/recruitment/?class=Mage");
    expect(mages.body).not.toContain("Quebec Gold</h3>");
    expect(mages.body).toContain("Les Pulliticiens");
    const cores = await request("GET", "/recruitment/?kind=core");
    expect(cores.body).not.toContain("<h3>Quebec Gold</h3>");
    const french = await request("GET", "/recruitment/?lang=fr");
    expect(french.body).toContain('<html lang="fr">');
    expect(french.body).toContain("Recrutement de guildes");
  });

  it("escapes what guilds and players write", async () => {
    const { request, memory } = setup();
    memory.addListing({ guildName: "<img src=x onerror=alert(1)>", note: "<script>bad()</script>" });
    const page = await request("GET", "/recruitment/");
    expect(page.body).not.toContain("<script>bad");
    expect(page.body).not.toContain("<img src=x");
  });

  it("parses officers' words and matches filters", () => {
    expect(parseClasses("prêtre, Mage / death knight")).toEqual(["Priest", "Mage", "Death Knight"]);
    expect(parseClasses("Warrior Priest")).toEqual(["Warrior", "Priest"]);
    expect(parseClasses("any")).toEqual([]);
    expect(() => parseClasses("Bard")).toThrow("Unknown class");
    expect(parseRoles("heal dps")).toEqual(["HEALER", "DPS"]);
    expect(parseDays("mer, dim, Tue")).toEqual(["tuesday", "wednesday", "sunday"]);
    const listing = memoryWebStore().addListing({ classes: ["Priest"], language: "both", realm: "Doomhowl" });
    expect(listingMatches(listing, readFilters(new URLSearchParams("class=Priest&language=en&realm=doomhowl")))).toBe(true);
    expect(listingMatches(listing, readFilters(new URLSearchParams("class=Rogue")))).toBe(false);
    expect(listingMatches(listing, readFilters(new URLSearchParams("kind=players")))).toBe(false);
    const card = { id: "x", character: "Kev", className: "Mage", role: "DPS", level: 60, realm: null, faction: "HORDE", language: "fr", raidDays: [], note: null, discord: null, updatedAt: new Date() };
    expect(cardMatches(card, readFilters(new URLSearchParams("role=dps")))).toBe(true);
    expect(cardMatches(card, readFilters(new URLSearchParams("faction=ALLIANCE")))).toBe(false);
  });
});

describe("applying from the website", () => {
  const fields = { character: "Kev Caron", class: "Warrior", role: "TANK", message: "I raid every Wednesday." };

  it("asks to sign in, then posts the application to the guild's officers", async () => {
    const { request, signIn, post, memory, postApplication } = setup();
    const listing = memory.addListing();
    expect((await request("GET", `/recruitment/apply/${listing.id}`)).status).toBe(401);
    const session = await signIn();
    const form = await request("GET", `/recruitment/apply/${listing.id}`, { cookie: session.cookie });
    expect(form.body).toContain('name="csrf"');
    const sent = await post(`/recruitment/apply/${listing.id}`, session, fields);
    expect(sent.status).toBe(303);
    expect(sent.headers["location"]).toContain("done=applied");
    expect(postApplication).toHaveBeenCalledWith(expect.objectContaining({ character: "Kev Caron", className: "Warrior", role: "TANK", guildDiscordId: APPROVED, discordUserId: "222222222222222222" }));
    const [row] = [...memory.applications.values()];
    expect(row).toMatchObject({ status: "PENDING", channelId: "c1", messageId: "m1" });
    const me = await request("GET", "/me/?done=applied", { cookie: session.cookie });
    expect(me.body).toContain("Quebec Gold");
    expect(me.body).toContain("Waiting");
  });

  it("refuses a second waiting application, a guild that marked the player as spam and more than five a day", async () => {
    const { signIn, post, memory } = setup();
    const first = memory.addListing();
    const session = await signIn();
    expect((await post(`/recruitment/apply/${first.id}`, session, fields)).status).toBe(303);
    const again = await post(`/recruitment/apply/${first.id}`, session, fields);
    expect(again.status).toBe(400);
    expect(again.body).toContain("already have an application waiting");
    for (const row of memory.applications.values()) row.status = "SPAM";
    const sameGuild = memory.addListing({ core: { name: "Core B", schedule: null } });
    expect((await post(`/recruitment/apply/${sameGuild.id}`, session, fields)).body).toContain("does not accept applications from your account");
  });

  it("allows five applications a day", async () => {
    const { signIn, post, memory } = setup({ allows: () => true });
    const session = await signIn();
    for (let index = 0; index < 5; index++) {
      const listing = memory.addListing({ guildDiscordId: `60000000000000000${index}` });
      expect((await post(`/recruitment/apply/${listing.id}`, session, fields)).status).toBe(303);
    }
    const sixth = memory.addListing({ guildDiscordId: "699999999999999999" });
    expect((await post(`/recruitment/apply/${sixth.id}`, session, fields)).body).toContain("5 applications a day");
    expect(memory.applications.size).toBe(5);
  });

  it("keeps no application when the guild has no channel for it, and hides Lite and closed listings", async () => {
    const { signIn, post, memory, request } = setup({ postApplication: async () => null });
    const listing = memory.addListing();
    const session = await signIn();
    const answer = await post(`/recruitment/apply/${listing.id}`, session, fields);
    expect(answer.status).toBe(400);
    expect(answer.body).toContain("cannot receive applications right now");
    expect(memory.applications.size).toBe(0);
    const lite = memory.addListing({ guildDiscordId: LITE });
    expect((await request("GET", `/recruitment/apply/${lite.id}`, { cookie: session.cookie })).status).toBe(404);
    expect((await post(`/recruitment/apply/${lite.id}`, session, fields)).status).toBe(404);
  });

  it("checks the character, role and message", async () => {
    const { signIn, post, memory } = setup();
    const listing = memory.addListing();
    const session = await signIn();
    expect((await post(`/recruitment/apply/${listing.id}`, session, { ...fields, character: "<b>" })).body).toContain("character");
    expect((await post(`/recruitment/apply/${listing.id}`, session, { ...fields, role: "BARD" })).body).toContain("Choose your role");
    expect((await post(`/recruitment/apply/${listing.id}`, session, { ...fields, message: "hi" })).body).toContain("short message");
    expect(memory.applications.size).toBe(0);
  });
});

describe("looking-for-guild cards and reports", () => {
  const card = { character: "Mélodie", className: "Priest", role: "HEALER", level: "60", realm: "Doomhowl", faction: "ALLIANCE", language: "fr", days: ["wednesday", "sunday"], note: "Healer motivée", showDiscord: "1" };

  it("saves a card, shows it on the page and removes it", async () => {
    const { signIn, post, request } = setup();
    const session = await signIn();
    const saved = await post("/me/card", session, card);
    expect(saved.status).toBe(303);
    const page = await request("GET", "/recruitment/?kind=players");
    expect(page.body).toContain("Mélodie");
    expect(page.body).toContain("Discord : <strong>kev</strong>");
    expect((await post("/me/card", session, { ...card, level: "99" })).body).toContain("level is a number");
    await post("/me/card/delete", session, {});
    expect((await request("GET", "/recruitment/?kind=players")).body).not.toContain("Mélodie");
  });

  it("limits card changes per hour", async () => {
    const { signIn, post } = setup();
    const session = await signIn();
    for (let index = 0; index < 10; index++) expect((await post("/me/card", session, card)).status).toBe(303);
    expect((await post("/me/card", session, card)).body).toContain("Too many changes");
  });

  it("hides a card after three different reporters and tells the owner about listings", async () => {
    const { signIn, post, request, memory, tellOwner } = setup();
    const owner = await signIn();
    await post("/me/card", owner, card);
    const cardId = [...memory.cards.values()][0]!.id;
    for (const id of ["500000000000000001", "500000000000000002", "500000000000000003"]) {
      const reporter = await signIn({ id, username: `r${id.slice(-1)}`, global_name: "R" });
      expect((await post("/recruitment/report", reporter, { type: "card", id: cardId })).status).toBe(303);
      await post("/recruitment/report", reporter, { type: "card", id: cardId });
    }
    expect(memory.reports.length).toBe(3);
    expect((await request("GET", "/recruitment/")).body).not.toContain("Mélodie");
    const listing = memory.addListing();
    await post("/recruitment/report", owner, { type: "listing", id: listing.id });
    expect(tellOwner).toHaveBeenCalledWith(expect.stringContaining("Quebec Gold"));
  });
});

describe("session cookies pass the Worker's cookie filter", () => {
  it("uses only __Host-guilded_ cookies in the exact format the Worker forwards", async () => {
    const { signIn } = setup();
    const { callback } = await signIn();
    for (const cookie of callback.headers["set-cookie"] as string[]) {
      expect(cookie).toMatch(/^__Host-guilded_[a-z]{1,20}=[^;]*; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    }
    expect(Object.keys(parseCookies((callback.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; ")))).toEqual(["__Host-guilded_oauth", "__Host-guilded_session"]);
  });
});
