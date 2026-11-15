import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


describe("CurseForge pointer", () => {
  const releases = JSON.parse(readFileSync("site/releases.json", "utf8"));

  it("points at the 9.3.3 Forever files and GitHub at 9.3.4", () => {
    expect(releases.verifiedAt).toBe("2026-11-15");
    expect(releases.guilded.github.version).toBe("9.3.4");
    expect(releases.guilded.curseforge.version).toBe("9.3.3");
    expect(releases.guilded.curseforge.url).toBe("https://www.curseforge.com/wow/addons/guilded");
    expect(releases.guilded.curseforge.editions.forever).toEqual({
      guilded: "https://www.curseforge.com/wow/addons/guilded/files/9624204",
      dungeons: "https://www.curseforge.com/wow/addons/guilded-dungeons/files/9624207"
    });
    expect(releases.guilded.companionDirect.version).toBe("9.3.4");
  });

  it("shows CurseForge 9.3.3 on the creator page and links the files from the edition page", () => {
    const creator = readFileSync("dist/site/creator/index.html", "utf8");
    expect(creator).toContain("CurseForge");
    expect(creator).toContain(">9.3.3<");
    const forever = readFileSync("dist/site/editions/forever/index.html", "utf8");
    // The edition page links the CurseForge files only while CurseForge carries the same version as the release.
    const linked = releases.guilded.curseforge.version === releases.guilded.github.version;
    expect(forever.includes("9624204")).toBe(linked);
    expect(forever.includes("9624207")).toBe(linked);
    expect(readFileSync("docs/RELEASE_CURSEFORGE.md", "utf8")).toContain("https://api.cfwidget.com/1712677");
    expect(readFileSync("scripts/curseforge-upload.mjs", "utf8")).toContain("api.cfwidget.com/1754138");
    expect(readFileSync("scripts/curseforge-upload.mjs", "utf8")).toContain('game-version", "1.60.1"');
  });
});
