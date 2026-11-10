import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }), 30_000);

const PAGES = ["/guide/start/", "/guide/install/", "/guide/companion/", "/guide/link-character/", "/guide/dungeons/", "/guide/officers/", "/guide/epgp/", "/guide/discord-bot/", "/guide/self-host/", "/guide/troubleshooting/"];

function guideMatches(text, query) {
  const source = readFileSync("site/site.js", "utf8");
  const body = /function guideMatches\(text, query\) \{([\s\S]*?)\n\}/.exec(source)?.[1];
  expect(body).toBeTruthy();
  return new Function("text", "query", body)(text, query);
}

describe("guide search", () => {
  it("keeps every guide page in the HTML and filters that list in the browser", () => {
    const html = readFileSync("dist/site/guide/index.html", "utf8");
    expect(html).toContain('data-guide-search');
    expect(html).toContain("Search the guide");
    expect(html).toContain("Chercher dans le guide");
    expect(html.match(/data-guide>/g)).toHaveLength(PAGES.length * 2);
    for (const href of PAGES) expect(html).toContain(`href="${href}"`);
    expect(readFileSync("dist/site/sitemap.xml", "utf8")).toContain("https://guilded.kcaron.top/guide/");
    expect(guideMatches("Install the addon", "install")).toBe(true);
    expect(guideMatches("Officers", "loot")).toBe(false);
    expect(guideMatches("Officers", "  ")).toBe(true);
  });
});
