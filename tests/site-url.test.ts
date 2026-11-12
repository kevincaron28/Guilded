import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_ORIGIN, siteOrigin, siteUrl } from "../src/site-url.js";

describe("site address", () => {
  it("keeps the original address until PUBLIC_SITE_URL says otherwise", () => {
    expect(siteOrigin({})).toBe(DEFAULT_SITE_ORIGIN);
    expect(siteUrl("/g/x/", {})).toBe("https://guilded.kcaron.top/g/x/");
  });
  it("follows PUBLIC_SITE_URL (https only, origin only)", () => {
    expect(siteUrl("/leaderboards/", { PUBLIC_SITE_URL: "https://guildedwow.com/" })).toBe("https://guildedwow.com/leaderboards/");
    expect(siteOrigin({ PUBLIC_SITE_URL: "http://guildedwow.com" })).toBe(DEFAULT_SITE_ORIGIN);
    expect(siteOrigin({ PUBLIC_SITE_URL: "nonsense" })).toBe(DEFAULT_SITE_ORIGIN);
  });
});
