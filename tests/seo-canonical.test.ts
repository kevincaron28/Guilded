import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicPage, langFrom, layout, link } from "../src/services/web-layout.js";
import { withEdition } from "../src/services/edition-context.js";
import { createWebApp, type WebRequest, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";
import { renderGuildPage, type GuildPageView } from "../src/services/guild-page.js";
import { localizedHref } from "../site/nav.mjs";
import worker from "../worker/index.mjs";

// SEO3 (docs/AI_HANDOFF.md): bot-served public pages carry a self canonical and an en/fr/x-default hreflang set,
// never switch language by Accept-Language, and never link to ?lang=en.
afterEach(() => vi.unstubAllGlobals());
const SITE = "https://guildedwow.com";
const page = (path: string, lang: "en" | "fr", extra: { noindex?: boolean } = {}) => withEdition("forever", () => layout({ lang, title: "T", path, body: "<p>x</p>", account: null, csrf: null, signInOn: false, ...extra }));

describe("canonical and hreflang on bot-served pages", () => {
  it("English: self canonical in the edition section, hreflang en/x-default clean and fr under /fr/", () => {
    const html = page("/leaderboards/", "en");
    expect(html).toContain(`<link rel="canonical" href="${SITE}/forever/leaderboards/">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/forever/leaderboards/">`);
    expect(html).toContain(`hreflang="en" href="${SITE}/forever/leaderboards/"`);
    expect(html).toContain(`hreflang="x-default" href="${SITE}/forever/leaderboards/"`);
    expect(html).toContain(`hreflang="fr" href="${SITE}/fr/forever/leaderboards/"`);
  });
  it("French: canonical is the /fr/ address, hreflang points back at the clean English one", () => {
    const html = page("/leaderboards/", "fr");
    expect(html).toContain(`<link rel="canonical" href="${SITE}/fr/forever/leaderboards/">`);
    expect(html).toContain(`hreflang="en" href="${SITE}/forever/leaderboards/"`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/fr/forever/leaderboards/">`);
  });
  it("never puts a filter in the canonical, and keeps character, run and guild leaves without a trailing slash", () => {
    expect(page("/leaderboards/dungeons/?season=s1&dungeon=389", "en")).toContain(`rel="canonical" href="${SITE}/forever/leaderboards/dungeons/"`);
    expect(page("/leaderboards/character/Kev-Doomhowl", "en")).toContain(`rel="canonical" href="${SITE}/forever/leaderboards/character/Kev-Doomhowl"`);
    expect(page("/leaderboards/guild/quebec-gold/", "en")).toContain(`rel="canonical" href="${SITE}/forever/leaderboards/guild/quebec-gold"`);
  });
  it("noindex pages (/me/) have no canonical or hreflang", () => {
    const html = page("/me/", "en", { noindex: true });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain("canonical");
    expect(html).not.toContain('rel="alternate"');
  });
});

describe("language of public pages", () => {
  it("ignores Accept-Language on public pages, keeps it for /me/", () => {
    const none = new URLSearchParams();
    expect(langFrom(none, "fr-CA,fr;q=0.9", "/leaderboards/")).toBe("en");
    expect(langFrom(none, "fr-CA", "/recruitment/")).toBe("en");
    expect(langFrom(none, "fr-CA", "/players/")).toBe("en");
    expect(langFrom(new URLSearchParams("lang=fr"), "en", "/leaderboards/")).toBe("fr");
    expect(langFrom(none, "fr-CA", "/me/")).toBe("fr");
    expect(isPublicPage("/forever/leaderboards/")).toBe(true);
    expect(isPublicPage("/me/")).toBe(false);
  });
  it("internal English links carry no ?lang=en on public pages; French keeps ?lang=fr; /me/ keeps the explicit choice", () => {
    withEdition("forever", () => {
      expect(link("/leaderboards/", "en")).toBe("/forever/leaderboards/");
      expect(link("/leaderboards/", "en", { season: "s1" })).toBe("/forever/leaderboards/?season=s1");
      expect(link("/leaderboards/", "fr")).toBe("/forever/leaderboards/?lang=fr");
      expect(link("/me/", "en")).toBe("/me/?lang=en");
    });
  });
  it("menus and footers link English data pages without ?lang=en", () => {
    const html = page("/leaderboards/", "en");
    expect(html).toContain('href="/forever/leaderboards/"');
    expect(html).not.toMatch(/href="\/forever\/(?:leaderboards|recruitment|players)[^"]*lang=en/);
    expect(localizedHref("/forever/leaderboards/?lang=fr", "en")).toBe("/forever/leaderboards/");
    expect(localizedHref("/forever/leaderboards/?season=s1", "fr")).toBe("/forever/leaderboards/?season=s1&lang=fr");
  });
  it("renders English for a French browser without ?lang, and French with ?lang=fr", async () => {
    const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: () => true, postApplication: async () => null });
    const get = (target: string, headers: WebRequest["headers"] = {}) => { const url = new URL(target, SITE); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers }) as Promise<WebResponse>; };
    const en = (await get("/recruitment/", { "accept-language": "fr-CA,fr;q=0.9" })).body;
    expect(en).toContain('<html lang="en">');
    expect(en).toContain(`rel="canonical" href="${SITE}/forever/recruitment/"`);
    expect(en).not.toMatch(/href="[^"]*\/(?:leaderboards|recruitment|players)[^"]*lang=en/);
    const fr = (await get("/recruitment/?lang=fr")).body;
    expect(fr).toContain('<html lang="fr">');
    expect(fr).toContain(`rel="canonical" href="${SITE}/fr/forever/recruitment/"`);
    expect(fr).toContain(`hreflang="en" href="${SITE}/forever/recruitment/"`);
  });
});

describe("guild page", () => {
  const view = (indexable: boolean) => ({ slug: "quebec-gold", name: "Quebec Gold", language: "en", indexable, intro: null, edition: "forever", sections: [], cores: [], recruitment: null, dungeonPage: null } as unknown as GuildPageView);
  it("an indexable page has a self canonical and og:url; an unindexed one stays noindex without", () => {
    const html = renderGuildPage(view(true));
    expect(html).toContain(`<link rel="canonical" href="${SITE}/g/quebec-gold/">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/g/quebec-gold/">`);
    const hidden = renderGuildPage(view(false));
    expect(hidden).toContain('name="robots" content="noindex"');
    expect(hidden).not.toContain('rel="canonical"');
  });
});

describe("Worker: ?lang=en moves permanently to the clean address", () => {
  const env = { ASSETS: { fetch: vi.fn(async () => new Response("website")) } };
  const visit = (path: string, method = "GET") => worker.fetch(new Request(`${SITE}${path}`, { method, headers: { accept: "text/html" } }), env);
  it("301s only lang=en, in one hop, for pages in the section", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bot", { headers: { "content-type": "text/html" } })));
    const a = await visit("/forever/leaderboards/?lang=en");
    expect([a.status, a.headers.get("location")]).toEqual([301, "/forever/leaderboards/"]);
    const b = await visit("/forever/leaderboards/?season=s1&lang=en&page=2");
    expect(b.headers.get("location")).toBe("/forever/leaderboards/?season=s1&page=2");
    const c = await visit("/leaderboards/?lang=en");
    expect(c.headers.get("location")).toBe("/forever/leaderboards/");
    expect((await visit("/forever/leaderboards/?lang=fr")).status).toBe(200);
    // The French address (the canonical the bot writes) reaches the bot as the same page with ?lang=fr.
    const fetched = vi.mocked(fetch);
    fetched.mockClear();
    expect((await visit("/fr/forever/leaderboards/")).status).toBe(200);
    expect(String(fetched.mock.calls[0]![0])).toContain("lang=fr");
    expect((await visit("/forever/leaderboards/")).status).toBe(200);
    expect((await visit("/forever/leaderboards/summary.json?lang=en")).status).toBe(200);
  });
});
