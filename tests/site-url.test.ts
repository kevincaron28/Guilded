import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_ORIGIN, siteOrigin, siteUrl } from "../src/site-url.js";

describe("site address", () => {
  it("uses the canonical guildedwow.com address until PUBLIC_SITE_URL says otherwise", () => {
    expect(siteOrigin({})).toBe(DEFAULT_SITE_ORIGIN);
    expect(siteUrl("/g/x/", {})).toBe("https://guildedwow.com/g/x/");
  });
  it("follows PUBLIC_SITE_URL (https only, origin only)", () => {
    expect(siteUrl("/leaderboards/", { PUBLIC_SITE_URL: "https://example.org/" })).toBe("https://example.org/leaderboards/");
    expect(siteOrigin({ PUBLIC_SITE_URL: "http://guildedwow.com" })).toBe(DEFAULT_SITE_ORIGIN);
    expect(siteOrigin({ PUBLIC_SITE_URL: "nonsense" })).toBe(DEFAULT_SITE_ORIGIN);
  });
});
