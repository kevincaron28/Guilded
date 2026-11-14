import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


describe("CurseForge pointer", () => {
  const releases = JSON.parse(readFileSync("site/releases.json", "utf8"));

  it("points at the public 9.3.1 Forever files and leaves GitHub at 9.3.1", () => {
    expect(releases.verifiedAt).toBe("2026-11-14");
    expect(releases.guilded.github.version).toBe("9.3.1");
    expect(releases.guilded.curseforge.version).toBe("9.3.1");
    expect(releases.guilded.curseforge.url).toBe("https://www.curseforge.com/wow/addons/guilded");
    expect(releases.guilded.curseforge.editions.forever).toEqual({
      guilded: "https://www.curseforge.com/wow/addons/guilded/files/9605848",
      dungeons: "https://www.curseforge.com/wow/addons/guilded-dungeons/files/9605856"
    });
    expect(releases.guilded.companionDirect.version).toBe("9.3.1");
  });

  it("shows CurseForge 9.3.1 on the creator page and links the approved files from the edition page", () => {
    const creator = readFileSync("dist/site/creator/index.html", "utf8");
    expect(creator).toContain("CurseForge");
    expect(creator).toContain(">9.3.1<");
    const forever = readFileSync("dist/site/editions/forever/index.html", "utf8");
    expect(forever).toContain("9605848");
    expect(forever).toContain("9605856");
    expect(readFileSync("docs/RELEASE_CURSEFORGE.md", "utf8")).toContain("https://api.cfwidget.com/1712677");
    expect(readFileSync("scripts/curseforge-upload.mjs", "utf8")).toContain("api.cfwidget.com/1754138");
    expect(readFileSync("scripts/curseforge-upload.mjs", "utf8")).toContain('game-version", "1.60.1"');
  });
});
