import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const page = () => readFileSync("site/creator/index.html", "utf8");
const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*?href="([^"]+)"/g)].map(match => match[1] ?? "");

describe("kcaron.top navigation", () => {
  it("links every in-page anchor to a real section", () => {
    const html = page();
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1] ?? ""));
    const anchors = hrefs(html).filter(href => href.startsWith("#"));
    expect(anchors.length).toBeGreaterThan(10);
    for (const anchor of anchors) expect(ids, anchor).toContain(anchor.slice(1));
  });

  it("has a sticky header with a visible Get Guilded button and every section link", () => {
    const html = page();
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    for (const id of ["features", "editions", "guides", "projects", "community", "about"]) expect(header).toContain(`href="#${id}"`);
    expect(header).toContain('class="button header-cta" href="https://guilded.kcaron.top/#wow-versions"');
    expect(readFileSync("site/creator/home.css", "utf8")).toMatch(/\.site-header\{[^}]*position:sticky/);
  });

  it("shows the six beta projects and every project in the footer instead of hiding them", () => {
    const html = page();
    expect(html).not.toContain("<details");
    expect(html.match(/stage-beta/g)).toHaveLength(6);
    const footer = html.slice(html.indexOf("<footer"));
    for (const slug of ["guilded-dungeons", "guilded-games", "catchkeeper", "trailmark", "pullscript", "well-supplied", "tandem", "wayledger", "unfinished-business", "spellscript"]) {
      expect(footer, slug).toContain(`curseforge.com/wow/addons/${slug}"`);
    }
    expect(footer).toContain("kevincaron28/Lantern-Deck");
    expect(footer).toContain("discord.gg/YjzFwtP64V");
  });

  it("marks external footer links and keeps French copy beside every English string", () => {
    const html = page();
    const footer = html.slice(html.indexOf("<footer"));
    for (const link of footer.matchAll(/<a\b[^>]*?href="(https?:[^"]+)"([^>]*)>/g)) {
      if (!link[1]?.startsWith("https://kcaron.top")) expect(link[2], link[1]).toContain("ext-link");
    }
    for (const tag of html.matchAll(/<[a-z0-9]+\b[^>]*\bdata-en="[^"]*"[^>]*>/g)) expect(tag[0] ?? "").toMatch(/data-fr="[^"]+"/);
  });

  it("runs the section highlight from a file so the CSP only needs the JSON-LD hash", () => {
    const html = page();
    expect(html).toContain('<script src="/creator/nav.js" defer></script>');
    expect(existsSync("dist/site/creator/nav.js")).toBe(true);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].map(match => match[0]);
    expect(inline).toEqual(['<script type="application/ld+json">']);
    expect(readFileSync("dist/site/_headers", "utf8")).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  });
});
