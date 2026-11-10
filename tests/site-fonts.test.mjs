import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREVIOUS_FONT_BYTES = 352_240 + 183_552;

describe("home fonts", () => {
  it("serves Source Serif as woff2 and cuts the cold-load font bytes by at least 40%", () => {
    const css = readFileSync("site/design-tokens.css", "utf8");
    const referenced = [...css.matchAll(/url\("fonts\/([^"]+)"\)/g)].map((match) => match[1]);
    expect(referenced).toEqual(["inter-latin.woff2", "source-serif-latin.woff2"]);
    expect(css).not.toContain(".ttf");
    const loaded = referenced.reduce((sum, name) => sum + statSync(`site/fonts/${name}`).size, 0);
    expect(loaded).toBeLessThan(PREVIOUS_FONT_BYTES * 0.6);
    expect(statSync("site/fonts/source-serif-latin.ttf").size).toBeGreaterThan(0);
  });
});
