import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";
import { scoreTier } from "../src/services/public-leaderboard.js";

const css = readFileSync("site/design-tokens.css", "utf8");
const chrome = css.slice(css.indexOf("site-chrome:start"), css.indexOf("site-chrome:end"));
const read = (path: string) => readFileSync(`dist/site/${path}`, "utf8");

beforeAll(() => { execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "ignore" }); }, 120_000);
afterEach(() => vi.unstubAllGlobals());

describe("website polish: rendered pages", () => {
  it("maps scores to the six badge tiers, and the CSS colours each", () => {
    expect([0, 250, 500, 750, 1000, 1250].map(scoreTier)).toEqual(["st-bronze", "st-silver", "st-gold", "st-platinum", "st-epic", "st-legendary"]);
    for (const tier of ["bronze", "silver", "gold", "platinum", "epic", "legendary"]) expect(chrome).toContain(`.score.st-${tier}`);
  });

  it("renders /community/ and /guide/ as card grids: every card is a link with a description, in both languages", () => {
    for (const page of ["community", "guide"]) {
      const html = read(`${page}/index.html`);
      const lists = [...html.matchAll(/<ul class="grid-links"[^>]*>([\s\S]*?)<\/ul>/g)];
      expect(lists.length, page).toBeGreaterThanOrEqual(2); // English and French copy
      for (const [, list] of lists) {
        const items = [...list!.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
        expect(items.length, page).toBeGreaterThanOrEqual(5);
        for (const [, item] of items) expect(item, page).toMatch(/<a href="[^"]+">(?:<img [^>]*>)?[^<]+<small>[^<]+<\/small><\/a>/);
      }
    }
    expect(read("guide/index.html")).toContain("data-guide-list");
  });

  it("builds a styled 404 page with the site header, a sentence and a way home", () => {
    const html = read("404.html");
    expect(html).toContain('class="site-header"');
    expect(html).toContain("<h1>");
    expect(html).toMatch(/<a class="button" href="\/">/);
    expect(html).toContain('name="robots" content="noindex"');
  });

  it("styles the ranked tables, the card system and the cookie bar's room", () => {
    for (const selector of ["table.ranked", ".grid-links", ".not-found", ".table-wrap", "prefers-reduced-motion"]) expect(chrome).toContain(selector);
    expect(readFileSync("worker/consent-script.mjs", "utf8")).toContain("paddingBottom");
  });
});

// Worker-only addresses must keep reaching the Worker and the bot; only an address nobody serves gets the styled 404.
describe("the Worker's 404 page", () => {
  const PAGE = "<!doctype html><title>404</title>styled";
  const env = { ASSETS: { fetch: vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/404") return new Response(PAGE, { headers: { "content-type": "text/html" } });
    return new Response("", { status: 404 });
  }) } };
  const visit = (path: string, accept = "text/html") => worker.fetch(new Request(`https://guilded.kcaron.top${path}`, { headers: { accept } }), env);

  it("still proxies the bot-served path families, and answers 404.html only for unknown pages", async () => {
    const bot = vi.fn(async () => new Response("bot", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", bot);
    for (const path of ["/forever/leaderboards/", "/forever/players/", "/forever/recruitment/", "/g/quebec-gold/", "/health"]) {
      const response = await visit(path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toBe("bot");
    }
    const unknown = await visit("/no-such-page/");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe(PAGE);
    expect((await visit("/missing.png", "image/png")).status).toBe(404);
    expect(await (await visit("/missing.png", "image/png")).text()).toBe("");
    expect(await (await visit("/no-such-page/", "application/json")).text()).toBe("");
    expect(await (await visit("/no-such-page")).text()).toBe(PAGE); // no trailing slash, no extension
  });
});
