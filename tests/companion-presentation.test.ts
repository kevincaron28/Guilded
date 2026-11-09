import { describe, expect, it } from "vitest";
import { profileEditionLabel, profileSiteHref } from "../companion/presentation.mjs";

describe("profile website context", () => {
  it("uses the readable WoW Forever name and its scoped board", () => {
    expect(profileEditionLabel("forever", "fr")).toBe("WoW Forever");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "forever", "fr")).toBe("https://guilded.kcaron.top/forever/leaderboards/?lang=fr");
  });
  it("shows an old profile of a removed edition by its stored id, with unsectioned links (the website leads them to Forever)", () => {
    expect(profileEditionLabel("classic-tbc", "fr")).toBe("classic-tbc");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "retail", "en")).toBe("https://guilded.kcaron.top/leaderboards/?lang=en");
  });
  it("includes an explicit Forever context and does not infer unknown editions", () => {
    expect(profileSiteHref("https://guilded.kcaron.top/me/", "forever", "fr")).toBe("https://guilded.kcaron.top/me/?lang=fr&edition=forever");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "tbc", "en")).toBe("https://guilded.kcaron.top/leaderboards/?lang=en");
    expect(profileSiteHref("https://guilded.kcaron.top/leaderboards/", "unknown", "en")).toBe("https://guilded.kcaron.top/leaderboards/?lang=en");
  });
});
