import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { editionHref, editionSection, editionSwitchHref, FOOTER_COLUMNS, FOOTER_NAV, footerLinks, localizedHref, navLinks, SITE_NAV, splitEditionPath } from "../site/nav.mjs";
import { layout, link } from "../src/services/web-layout.js";
import { currentSection } from "../src/services/site-header.js";
import { withEdition } from "../src/services/edition-context.js";
import { safeReturnPath } from "../src/services/web-auth.js";
import { renderGuildPage } from "../src/services/guild-page.js";

// One menu for the whole website: the bot-served pages and the static build both read site/nav.mjs.
describe("site menu", () => {
  const page = (path: string, lang: "en" | "fr") => layout({ lang, title: "T", path, body: "", account: null, csrf: null, signInOn: true });

  it("keeps the WoW Forever section through navigation, player links and sign-in in both languages", () => {
    for (const lang of ["en", "fr"] as const) withEdition("forever", () => {
      const html = page("/players/", lang);
      for (const item of SITE_NAV.filter(item => item.bot && item.key !== "my-guilded")) expect(html).toContain(`href="/forever${item.href}?lang=${lang}"`);
      expect(link("/players/", lang)).toBe(`/forever/players/?lang=${lang}`);
      const login = /href="(\/auth\/login[^"]+)"/.exec(html)![1]!.replaceAll("&amp;", "&");
      const returned = new URL(new URL(login, "https://guilded.test").searchParams.get("return")!, "https://guilded.test");
      expect(returned.pathname).toBe("/forever/players/");
      expect(returned.searchParams.get("lang")).toBe(lang);
      expect(safeReturnPath(returned.pathname + returned.search)).toBe(returned.pathname + returned.search);
      expect(link("/me/", lang)).toBe(`/me/?lang=${lang}`);
    });
    // A removed edition's old section is not a sign-in return path any more.
    expect(safeReturnPath("/retail/players/")).toBe("/me/");
  });

  it("moves public data links into the WoW Forever section and recognizes the removed editions' old sections", () => {
    expect(editionHref("/players/?class=Mage#results", "forever")).toBe("/forever/players/?class=Mage#results");
    expect(editionHref("/leaderboards/?edition=forever&season=s1", null)).toBe("/forever/leaderboards/?season=s1");
    expect(editionHref("/leaderboards/", null)).toBe("/leaderboards/");
    // Another edition name (an old guild's stored edition) is not a section: links stay unsectioned.
    expect(editionHref("/leaderboards/", "retail")).toBe("/leaderboards/");
    expect(editionSection("retail")).toBeNull();
    expect(splitEditionPath("/forever/recruitment/guilds/")).toEqual({ edition: "forever", slug: "forever", rest: "/recruitment/guilds/", retired: false });
    expect(splitEditionPath("/mists/recruitment/guilds/")).toEqual({ edition: "classic-mists", slug: "mists", rest: "/recruitment/guilds/", retired: true });
    expect(splitEditionPath("/mistsy/")).toBeNull();
    for (const href of ["https://example.test/players/", "//example.test/players/", "/players-other/", "/features/", "/companion/", "#players"]) expect(editionHref(href, "forever")).toBe(href);
  });

  it("points the header's WoW Forever link at the same kind of page", () => {
    expect(editionSwitchHref("/leaderboards/run/abc", "forever")).toBe("/forever/leaderboards/");
    expect(editionSwitchHref("/tbc/leaderboards/guilds/", "forever")).toBe("/forever/leaderboards/guilds/");
    expect(editionSwitchHref("/players/c1", "forever")).toBe("/forever/players/");
    expect(editionSwitchHref("/me/", "forever")).toBe("/me/");
    for (const path of ["/", "/features/", "/g/quebec-gold/"]) expect(editionSwitchHref(path, "forever")).toBe("/forever/");
    expect(editionSwitchHref("/leaderboards/", "retail")).toBe("/editions/");
  });

  it("shows WoW Forever in the header of bot pages, even for a removed edition's stored guild", () => {
    const html = withEdition("forever", () => page("/leaderboards/guilds/", "fr"));
    expect(html).toContain('<details class="nav-group edition-menu" data-nav-group="edition"><summary>Je joue à : <strong>WoW Forever</strong></summary>');
    expect(html).toContain('href="/forever/leaderboards/guilds/?lang=fr" data-edition="forever" aria-current="true"');
    for (const slug of ["retail", "tbc", "mists", "classic-era"]) expect(html).not.toContain(`data-edition="${slug}"`);
    const guild = renderGuildPage({ slug: "qg", name: "QG", language: "en", indexable: true, intro: null, sections: [], cores: [], recruitment: null, edition: "retail" });
    expect(guild).toContain("Playing: <strong>WoW Forever</strong>");
    expect(guild).not.toContain('href="/retail/');
  });

  it("shows every menu link on bot-served pages, in the page language", () => {
    const html = page("/leaderboards/", "fr");
    for (const item of SITE_NAV) expect(html).toContain(`>${item.fr}</a>`);
    expect(html).toContain('href="/forever/leaderboards/?lang=fr" aria-current="page"');
    expect(html).toContain('href="/companion/?lang=fr"');
    expect(page("/me/", "en")).toContain('href="/me/?lang=en" aria-current="page"');
    expect(page("/players/", "en")).not.toContain('aria-current="page"');
  });

  it("has a Guilds entry, current on the guild directory and on guild pages", () => {
    expect(page("/recruitment/guilds/", "fr")).toContain('href="/forever/recruitment/guilds/?lang=fr" aria-current="page">Trouver une guilde</a>');
    expect(page("/recruitment/guilds/", "fr")).not.toContain('href="/forever/recruitment/?lang=fr" aria-current');
    expect(currentSection("/g/quebec-gold/")).toBe("guilds");
    expect(currentSection("/recruitment/")).toBe("guilds");
    expect(currentSection("/leaderboards/guilds/")).toBe("leaderboards");
    expect(currentSection("/players/")).toBeNull();
  });

  it("builds the static menu from the same list", () => {
    expect(readFileSync("site/index.html", "utf8")).toMatch(/<nav id="main-navigation"[^>]*>\{\{SITE_NAV\}\}/);
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('from "../site/nav.mjs"');
  });

  it("keeps French across the product, guide and public-page navigation", () => {
    const html = page("/leaderboards/", "fr");
    expect(html).toContain('href="/features/?lang=fr"');
    expect(html).toContain('href="/guides/install/"');
    expect(html).not.toContain("QUICK_START");
    expect(html).not.toContain("MEMBER_INSTALL");
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

  it.each(["https://example.com/?lang=en", "//example.com/", "/companion/ui-bundle.js", "#features", "/logo.png"])("leaves unrelated links unchanged: %s", href => {
    expect(localizedHref(href, "fr")).toBe(href);
  });

  // 2 November 2026 rebuild: six visible entries, no hidden drop-downs for them, one button.
  it("has six top-level links, no drop-downs and one Get the addon button", () => {
    const html = navLinks({ label: item => item.en, current: "leaderboards" });
    expect([...html.matchAll(/<a /g)]).toHaveLength(6);
    expect(html).not.toMatch(/<details|<summary/);
    expect(SITE_NAV.map(item => item.key)).toEqual(["start", "features", "leaderboards", "guilds", "my-guilded", "download"]);
    expect(html).toContain('<a href="/editions/" class="nav-cta">Get the addon</a>');
    expect(html.match(/class="nav-cta"/g)).toHaveLength(1);
    expect(html).toContain('<a href="/leaderboards/" aria-current="page">Leaderboards</a>');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it("keeps Help to the one install path", () => {
    const help = FOOTER_NAV.filter((item) => item.column === "help");
    expect(help.map((item) => [item.en, item.href])).toEqual([
      ["Install guide", "/guides/install/"],
      ["Quick reference", "/reference/"],
      ["Setup help", "/docs/AI_SETUP_HELP.html"],
      ["Service status", "/status/"]
    ]);
    expect(FOOTER_NAV.some((item) => /QUICK_START|MEMBER_INSTALL/.test(item.href))).toBe(false);
  });

  it("puts every other destination in the footer columns, in both languages", () => {
    const keys = FOOTER_NAV.map(item => item.key);
    for (const key of ["officers", "companion", "forever", "status", "discord", "privacy", "recruitment", "players", "install", "releases"]) expect(keys).toContain(key);
    for (const item of FOOTER_NAV) { expect(FOOTER_COLUMNS[item.column]).toBeDefined(); expect(item.fr.length).toBeGreaterThan(0); }
    for (const lang of ["en", "fr"] as const) {
      const html = page("/leaderboards/", lang);
      expect(html).toContain(`<nav class="footer-cols" aria-label="${lang === "fr" ? "Plan du site" : "Site map"}">`);
      for (const item of FOOTER_NAV) expect(html).toContain(`>${item[lang]}</a>`);
      for (const column of Object.values(FOOTER_COLUMNS)) expect(html).toContain(`<p class="footer-title">${column[lang]}</p>`);
    }
    expect(page("/leaderboards/", "fr")).toContain('href="/forever/recruitment/?lang=fr"');
    expect(page("/leaderboards/", "fr")).toContain('href="/officers/?lang=fr"');
    expect(footerLinks({ label: item => item.en })).toContain('href="https://discord.gg/YjzFwtP64V"');
  });

  it("gives bot pages the website header: logo, phone menu and an EN/FR switch for the same page", () => {
    const html = page("/players/", "fr");
    expect(html).toMatch(/<header class="site-top">.*<img src="data:image\/webp;base64,/);
    expect(html).toContain("VOTRE GUILDE, CONNECTÉE.");
    expect(html).toContain('<input type="checkbox" id="site-menu" class="menu-check"><label for="site-menu" class="menu-label">');
    expect(html).toContain('<p class="footer-title">Communauté</p>');
    expect(html).toContain('<a href="/forever/players/?lang=en" hreflang="en" lang="en">EN</a><a href="/forever/players/?lang=fr" hreflang="fr" lang="fr" aria-current="true">FR</a>');
    expect(html.indexOf('<header class="site-top">')).toBeLessThan(html.indexOf("<main>"));
    expect(html).not.toContain(">Français</a>");
  });
});
