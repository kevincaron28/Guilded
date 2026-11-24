import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { staticRedirect } from "../worker/localized-assets.mjs";

// Six key pages at 390 and 1280 px (projects in playwright.config.ts) plus the French download page.
// `dist/site` must be built first (npm run site:build). The preview server serves the static files only.
const PAGES: Array<{ name: string; path: string; note?: string }> = [
  { name: "home", path: "/" },
  { name: "download", path: "/download/" },
  { name: "guide", path: "/guide/" },
  { name: "reference", path: "/reference/" },
  { name: "community", path: "/community/" },
  // Static stand-in for the leaderboards entry point: the edition hub that links to them.
  { name: "forever-hub", path: "/forever/" },
  // French is rendered by language.js from ?lang=fr (the same copy the Worker serves at /fr/download/).
  { name: "download-fr", path: "/download/?lang=fr" }
];

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre";

/** Same-origin requests only: no analytics, ads or remote images, so a page never depends on the network. */
async function isolate(page: Page) {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === "http://127.0.0.1:8800" ? route.continue() : route.abort());
}

/** Freeze what changes without the design changing: version numbers and dates in the text become fixed tokens. */
async function freezeDynamicText(page: Page) {
  await page.evaluate((months) => {
    const version = /(?<![\w.])v?\d+\.\d+\.\d+(?:\.\d+)?(?![\w.]*\w)/g; // 9.5.6, v9.5.6, 9.5.0.0
    const checksum = /\b[0-9a-f]{64}\b/g; // the SHA-256 lines on the download page change every release
    const dates = new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th|er)? (?:${months}) \d{4}\b|\b(?:${months}) \d{1,2},? \d{4}\b|\b\d{4}-\d{2}-\d{2}\b`, "gi");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const frozen = text.replace(checksum, "0".repeat(64)).replace(version, "0.0.0").replace(dates, "1 January 2026");
      if (frozen !== text) node.nodeValue = frozen;
    }
  }, MONTHS);
}

/** Make the whole page paint: lazy images loaded, fonts ready, scrolled back to the top. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (const image of document.querySelectorAll("img")) { image.loading = "eager"; image.decoding = "sync"; }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 150));
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.complete ? undefined : new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); })));
  });
  await freezeDynamicText(page);
}

for (const { name, path } of PAGES) {
  test(`screenshot: ${name}`, async ({ page }) => {
    await isolate(page);
    await page.goto(path, { waitUntil: "load" });
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

test.describe("what the screenshots must cover", () => {
  test("the home page keeps the headline", async ({ page }) => {
    await isolate(page);
    await page.goto("/");
    // The headline is split over spans ("Less organizing." / "More" / "playing."); the visible text is the kept headline.
    await expect(page.locator("#hero-title")).toHaveText(/Less organizing\.\s*More\s+playing\./);
  });

  test("the French download page exists under the same name, so a /fr/ slug miss fails here", async () => {
    // The Worker serves /fr/<same path>/ from the English file (worker/localized-assets.mjs). The file must exist and
    // carry its French copy, and /fr/download (no slash) must move to /fr/download/.
    const file = "dist/site/download/index.html";
    expect(existsSync(file), "build the site first: npm run site:build").toBe(true);
    expect(readFileSync(file, "utf8")).toContain('data-language-copy="fr"');
    expect(staticRedirect(new URL("https://guildedwow.com/fr/download"))).toBe("/fr/download/");
  });

  test.skip("leaderboards (bot-served)", () => {
    // The leaderboards are rendered by the bot from live data (src/services/web-layout.ts) and are not in the static site,
    // so there is nothing deterministic to compare here. The edition hub (forever-hub) is the static entry point.
  });
});
