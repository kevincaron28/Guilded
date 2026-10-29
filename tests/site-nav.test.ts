import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { editionHref, localizedHref, NAV_GROUPS, navLinks, SITE_NAV } from "../site/nav.mjs";
import { layout, link } from "../src/services/web-layout.js";
import { currentSection } from "../src/services/site-header.js";
import { withEdition } from "../src/services/edition-context.js";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";

// One menu for the whole website: the bot-served pages and the static build both read site/nav.mjs.
describe("site menu", () => {
  const page = (path: string, lang: "en" | "fr") => layout({ lang, title: "T", path, body: "", account: null, csrf: null, signInOn: true });

  it.each(GAME_EDITIONS)("keeps %s through navigation, player links and sign-in in both languages", edition => {
    for (const lang of ["en", "fr"] as const) withEdition(edition, () => {
      const html = page("/players/", lang);
      const expected = edition === "forever" ? "" : `edition=${edition}&amp;`;
      for (const item of SITE_NAV.filter(item => item.bot)) expect(html).toContain(`href="${item.href}?${expected}lang=${lang}"`);
      const playerLink = new URL(link("/players/", lang), "https://guilded.test");
      expect(playerLink.searchParams.get("edition") ?? "forever").toBe(edition);
      const login = /href="(\/auth\/login[^"]+)"/.exec(html)![1]!.replaceAll("&amp;", "&");
      const returned = new URL(new URL(login, "https://guilded.test").searchParams.get("return")!, "https://guilded.test");
      expect(returned.pathname).toBe("/players/");
      expect(returned.searchParams.get("edition") ?? "forever").toBe(edition);
      expect(returned.searchParams.get("lang")).toBe(lang);
    });
  });

  it("adds an edition only to local data pages, preserving explicit choices, query and fragment", () => {
    expect(editionHref("/players/?class=Mage#results", "retail")).toBe("/players/?class=Mage&edition=retail#results");
    expect(editionHref("/leaderboards/?edition=classic-era", "retail")).toBe("/leaderboards/?edition=classic-era");
    for (const href of ["https://example.test/players/", "//example.test/players/", "/players-other/", "/features/", "/companion/", "#players"]) expect(editionHref(href, "retail")).toBe(href);
  });

  it("shows every menu link on bot-served pages, in the page language", () => {
    const html = page("/leaderboards/", "fr");
    for (const item of SITE_NAV) expect(html).toContain(`>${item.fr}</a>`);
    expect(html).toContain('href="/leaderboards/?lang=fr" aria-current="page"');
    expect(html).toContain('href="/companion/?lang=fr"');
    expect(page("/me/", "en")).not.toContain('aria-current="page"');
  });

  it("has a Guilds entry, current on the guild directory and on guild pages", () => {
    expect(page("/recruitment/guilds/", "fr")).toContain('href="/recruitment/guilds/?lang=fr" aria-current="page">Trouver une guilde</a>');
    expect(page("/recruitment/guilds/", "fr")).not.toContain('href="/recruitment/?lang=fr" aria-current');
    expect(currentSection("/g/quebec-gold/")).toBe("guilds");
    expect(currentSection("/recruitment/")).toBe("recruitment");
  });

  it("builds the static menu from the same list", () => {
    expect(readFileSync("site/index.html", "utf8")).toMatch(/<nav id="main-navigation"[^>]*>\{\{SITE_NAV\}\}/);
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('from "../site/nav.mjs"');
  });

  it("keeps French across the product, guide and public-page navigation", () => {
    const html = page("/leaderboards/", "fr");
    expect(html).toContain('href="/features/?lang=fr"');
    expect(html).toContain('href="/docs/QUICK_START.html#fr"');
    expect(html).toContain('href="/editions/?lang=fr"');
    expect(html).toContain('href="/officers/?lang=fr"');
    expect(html).toContain('href="/forever/?lang=fr"');
    expect(localizedHref("/leaderboards/?season=s1&lang=en#records", "fr")).toBe("/leaderboards/?season=s1&lang=fr#records");
    expect(localizedHref("features/", "fr")).toBe("features/?lang=fr");
    expect(localizedHref("/editions/retail/", "fr")).toBe("/editions/retail/?lang=fr");
    expect(localizedHref("../../editions/classic-era/?lang=fr", "en")).toBe("../../editions/classic-era/?lang=en");
    expect(localizedHref("/companion/?tab=cores&lang=en#rules", "fr")).toBe("/companion/?tab=cores&lang=fr#rules");
    expect(localizedHref("/companion/?lang=fr", "en")).toBe("/companion/?lang=en");
    expect(localizedHref("../docs/MEMBER_INSTALL.html#fr", "en")).toBe("../docs/MEMBER_INSTALL.html");
    expect(localizedHref("../docs/MEMBER_INSTALL.html#quick-fixes", "fr")).toBe("../docs/MEMBER_INSTALL.html#quick-fixes");
  });

  it.each(["https://example.com/?lang=en", "//example.com/", "/companion/web-bundle.js", "#features", "/logo.png"])("leaves unrelated links unchanged: %s", href => {
    expect(localizedHref(href, "fr")).toBe(href);
  });

  // 29 October 2026 review: five top-level entries, the rest in two drop-downs that need no script.
  it("keeps five top-level entries with Community and Help drop-downs", () => {
    const html = navLinks({ label: item => item.en, current: "players" });
    const top = html.replace(/<div class="nav-menu">.*?<\/div>/g, "");
    expect([...top.matchAll(/<a |<summary>/g)]).toHaveLength(5);
    expect(html).toContain('<details class="nav-group has-current" data-nav-group="community"><summary>Community</summary>');
    expect(html).toContain('<details class="nav-group" data-nav-group="help"><summary>Help</summary>');
    expect(html.indexOf('data-nav-group="community"')).toBeLessThan(html.indexOf('data-nav-group="help"'));
    for (const item of SITE_NAV.filter(item => item.group)) expect(NAV_GROUPS[item.group!]).toBeDefined();
    expect(html).toContain('href="https://discord.gg/YjzFwtP64V"');
  });

  it("gives bot pages the website header: logo, phone menu and an EN/FR switch for the same page", () => {
    const html = page("/players/", "fr");
    expect(html).toMatch(/<header class="site-top">.*<img src="data:image\/webp;base64,/);
    expect(html).toContain("VOTRE GUILDE, CONNECTÉE.");
    expect(html).toContain('<input type="checkbox" id="site-menu" class="menu-check"><label for="site-menu" class="menu-label">');
    expect(html).toContain('<summary>Communauté</summary>');
    expect(html).toContain('<a href="/players/?lang=en" hreflang="en" lang="en">EN</a><a href="/players/?lang=fr" hreflang="fr" lang="fr" aria-current="true">FR</a>');
    expect(html.indexOf('<header class="site-top">')).toBeLessThan(html.indexOf("<main>"));
    expect(html).not.toContain(">Français</a>");
  });
});
