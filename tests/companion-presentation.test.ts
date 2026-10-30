import { describe, expect, it } from "vitest";
import { profileEditionLabel, profileSiteHref } from "../companion/presentation.mjs";

describe("profile website context", () => {
  it("uses readable edition names and the selected profile's scoped board", () => {
    expect(profileEditionLabel("classic-tbc", "fr")).toBe("Burning Crusade Classic");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "classic-tbc", "fr")).toBe("https://guilded.kcaron.top/tbc/leaderboards/?lang=fr");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "retail", "en")).toBe("https://guilded.kcaron.top/retail/leaderboards/?lang=en");
  });
  it("includes an explicit Forever context and does not infer unknown editions", () => {
    expect(profileSiteHref("https://guilded.kcaron.top/me/", "forever", "fr")).toBe("https://guilded.kcaron.top/me/?lang=fr&edition=forever");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "tbc", "en")).toBe("https://guilded.kcaron.top/leaderboards/?lang=en");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "unknown", "en")).toBe("https://guilded.kcaron.top/leaderboards/?lang=en");
  });
});
