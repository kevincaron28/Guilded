import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreTier } from "../src/services/public-leaderboard.js";

const css = readFileSync("site/design-tokens.css", "utf8");

describe("website polish", () => {
  it("maps scores to the six badge tiers", () => {
    expect([0, 250, 500, 750, 1000, 1250].map(scoreTier)).toEqual(["st-bronze", "st-silver", "st-gold", "st-platinum", "st-epic", "st-legendary"]);
    for (const tier of ["bronze", "silver", "gold", "platinum", "epic", "legendary"]) expect(css).toContain(`.score.st-${tier}`);
  });
  it("styles ranked tables, card grids and the footer divider in the shared chrome", () => {
    const chrome = css.slice(css.indexOf("site-chrome:start"), css.indexOf("site-chrome:end"));
    for (const selector of ["table.ranked", ".grid-links", ".not-found", ".table-wrap", "prefers-reduced-motion"]) expect(chrome).toContain(selector);
  });
  it("turns community and guide link lists into described card grids in both languages", () => {
    for (const file of ["community", "guide"]) for (const lang of ["", ".fr"]) {
      const page = readFileSync(`site/pages/${file}${lang}.md`, "utf8");
      expect(page).toContain('class="grid-links"');
      expect(page).toContain("<small>");
    }
  });
  it("shows a slim cookie bar and a styled 404 page", () => {
    expect(readFileSync("worker/consent-script.mjs", "utf8")).toContain("flex");
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain("404.html");
    expect(readFileSync("wrangler.jsonc", "utf8")).toContain('"404-page"');
  });
});
