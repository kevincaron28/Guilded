import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, posix } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { staticRedirect } from "../worker/localized-assets.mjs";

beforeAll(() => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }), 30_000);

const DYNAMIC = /^\/(?:leaderboards|recruitment|players|me|auth|g|health|api|downloads|forever\/(?:leaderboards|recruitment|players))(?:\/|$)/;

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) htmlFiles(path, out);
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

function resolves(path) {
  const clean = path.split(/[?#]/)[0] || "/";
  if (DYNAMIC.test(clean)) return true;
  if (staticRedirect(new URL(clean, "https://guildedwow.com"))) return true;
  const bare = clean === "/fr" || clean === "/fr/" ? "/" : clean.startsWith("/fr/") ? clean.slice(3) : clean;
  if (bare !== clean && (DYNAMIC.test(bare) || staticRedirect(new URL(bare, "https://guildedwow.com")))) return true;
  const rel = bare.replace(/^\//, "");
  const file = rel.endsWith("/") || rel === "" ? `dist/site/${rel}index.html` : `dist/site/${rel}`;
  return existsSync(file) && statSync(file).isFile();
}

describe("built site links", () => {
  it("publishes the download hub with CurseForge, the zip, the companion and the bot", () => {
    const html = readFileSync("dist/site/download/index.html", "utf8");
    expect(html).toContain("https://www.curseforge.com/wow/addons/guilded");
    expect(html).toContain("Guilded-v");
    expect(html).toContain("https://apps.microsoft.com/detail/9N680XX3QFL9");
    expect(html).toContain("discord.com/oauth2/authorize");
    expect(html).toContain('id="companion"');
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(readFileSync("dist/site/sitemap.xml", "utf8")).toContain("https://guildedwow.com/download/");
    expect(readFileSync("dist/site/sitemap.xml", "utf8")).toContain("https://guildedwow.com/guide/install/");
    const installPages = [];
    for (const file of htmlFiles("dist/site")) {
      if (!readFileSync(file, "utf8").includes("Interface/AddOns")) continue;
      const urlPath = `/${file.slice("dist/site/".length)}`.replace(/index\.html$/, "");
      if (staticRedirect(new URL(urlPath, "https://guildedwow.com"))) continue;
      installPages.push(urlPath);
    }
    expect(installPages.filter(path => !path.startsWith("/guide/install"))).toEqual([]);
  });

  it("points every local link at a page, a file, a redirect or a bot route", () => {
    const missing = [];
    for (const file of htmlFiles("dist/site")) {
      const html = readFileSync(file, "utf8");
      const base = `/${file.slice("dist/site/".length).replace(/index\.html$/, "")}`;
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const href = match[1];
        if (/^(?:https?:|mailto:|#|\/\/)/i.test(href)) continue;
        const raw = href.split(/[?#]/)[0];
        if (!raw) continue;
        const path = raw.startsWith("/") ? raw : posix.normalize(posix.join(dirname(base), raw));
        if (!resolves(path.startsWith("/") ? path : `/${path}`)) missing.push(`${file} -> ${href}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("sends static French sitemap addresses to the same page under /fr/", () => {
    const sitemap = readFileSync("dist/site/sitemap.xml", "utf8");
    const french = [...sitemap.matchAll(/<loc>https:\/\/guildedwow.com([^<]+)\?lang=fr<\/loc>/g)].map(match => match[1]);
    expect(french.length).toBeGreaterThan(0);
    const data = /^\/(?:forever|leaderboards|recruitment|players|companion)(?:\/|$)/;
    const stuck = french.filter(path => !data.test(path)).flatMap(path => {
      const dest = staticRedirect(new URL(`https://guildedwow.com${path}?lang=fr`));
      return dest?.startsWith("/fr") ? [] : [`${path} -> ${dest}`];
    });
    expect(stuck).toEqual([]);
  });
});
