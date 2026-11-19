import { describe, expect, it } from "vitest";

describe("version notice and short messages (9.4)", () => {
  it("is one short line that links the release notes", async () => {
    const { NOTICE, releaseNotesUrl } = await import("../src/services/version-announce.js");
    expect(NOTICE.en("9.4.0")).toBe(`🔔 Guilded **9.4.0** is live. What's new: <${releaseNotesUrl("9.4.0")}>.`);
    expect(NOTICE.fr("9.4.0")).toContain("est en ligne");
    expect(NOTICE.en("9.4.0")).not.toContain("CHANGELOG");
  });
  it("the Lite idle notice and the DM link answer never suggest /character claim", async () => {
    const { liteIdleNotice } = await import("../src/services/pilot-welcome.js");
    expect(liteIdleNotice("en")).not.toContain("Personne");
    expect(liteIdleNotice("fr")).not.toContain("nobody");
    const { t } = await import("../src/i18n.js");
    for (const lang of ["en", "fr"] as const) {
      expect(t(lang, "dmlink.none", { name: "Ray Peters" })).not.toContain("/character claim");
      expect(t(lang, "dmlink.offer", { name: "Ray Peters", server: "QG" })).not.toContain("/character claim");
    }
  });
});
