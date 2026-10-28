import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { localizedHref, SITE_NAV } from "../site/nav.mjs";
import { layout } from "../src/services/web-layout.js";
import { currentSection } from "../src/services/site-header.js";

// One menu for the whole website: the bot-served pages and the static build both read site/nav.mjs.
describe("site menu", () => {
  const page = (path: string, lang: "en" | "fr") => layout({ lang, title: "T", path, body: "", account: null, csrf: null, signInOn: true });

  it("shows every menu link on bot-served pages, in the page language", () => {
    const html = page("/leaderboards/", "fr");
    for (const item of SITE_NAV) expect(html).toContain(`>${item.fr}</a>`);
    expect(html).toContain('href="/leaderboards/?lang=fr" aria-current="page"');
    expect(html).toContain('href="/companion/?lang=fr"');
    expect(page("/me/", "en")).not.toContain('aria-current="page"');
  });

  it("has a Guilds entry, current on the guild directory and on guild pages", () => {
    expect(page("/recruitment/guilds/", "fr")).toContain('href="/recruitment/guilds/?lang=fr" aria-current="page">Guildes</a>');
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
    expect(html).toContain('href="/?lang=fr#start"');
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
});
