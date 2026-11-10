import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_HEADER_STYLE } from "../src/services/site-header.js";

describe("shared site chrome", () => {
  it("keeps the bot header and footer rules in the stylesheet the static site already loads", () => {
    const css = readFileSync("site/design-tokens.css", "utf8");
    const start = css.indexOf("/* site-chrome:start */");
    const end = css.indexOf("/* site-chrome:end */");
    const block = css.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain(".site-top{position:sticky");
    expect(block).toContain(".footer-cols{");
    expect(SITE_HEADER_STYLE).toContain(".site-top{position:sticky");
    expect(SITE_HEADER_STYLE).toContain(".footer-cols{");
    expect(SITE_HEADER_STYLE).toContain('url("/fonts/inter-latin.woff2")');
  });
});
