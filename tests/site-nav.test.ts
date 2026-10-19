import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SITE_NAV } from "../site/nav.mjs";
import { layout } from "../src/services/web-layout.js";

// One menu for the whole website: the bot-served pages and the static build both read site/nav.mjs.
describe("site menu", () => {
  const page = (path: string, lang: "en" | "fr") => layout({ lang, title: "T", path, body: "", account: null, csrf: null, signInOn: true });

  it("shows every menu link on bot-served pages, in the page language", () => {
    const html = page("/leaderboards/", "fr");
    for (const item of SITE_NAV) expect(html).toContain(`>${item.fr}</a>`);
    expect(html).toContain('href="/leaderboards/?lang=fr" aria-current="page"');
    expect(html).toContain('href="/companion/"');
    expect(page("/me/", "en")).not.toContain('aria-current="page"');
  });

  it("builds the static menu from the same list", () => {
    expect(readFileSync("site/index.html", "utf8")).toContain('<nav id="main-navigation" aria-label="Main navigation">{{SITE_NAV}}');
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('from "../site/nav.mjs"');
  });
});
