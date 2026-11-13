import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }), 30_000);

describe("CurseForge pointer", () => {
  const releases = JSON.parse(readFileSync("site/releases.json", "utf8"));

  it("points at the public 9.1.5 Forever files and leaves GitHub at 9.2.0", () => {
    expect(releases.verifiedAt).toBe("2026-11-12");
    expect(releases.guilded.github.version).toBe("9.2.0");
    expect(releases.guilded.curseforge.version).toBe("9.1.5");
    expect(releases.guilded.curseforge.url).toBe("https://www.curseforge.com/wow/addons/guilded");
    expect(releases.guilded.curseforge.editions.forever).toEqual({
      guilded: "https://www.curseforge.com/wow/addons/guilded/files/9543886",
      dungeons: "https://www.curseforge.com/wow/addons/guilded-dungeons/files/9543887"
    });
    expect(releases.guilded.companionDirect.version).toBe("9.2.0");
  });

  it("shows CurseForge 9.1.5 on the creator page and does not call those files the 9.2.0 release", () => {
    const creator = readFileSync("dist/site/creator/index.html", "utf8");
    expect(creator).toContain("CurseForge");
    expect(creator).toContain(">9.1.5<");
    const forever = readFileSync("dist/site/editions/forever/index.html", "utf8");
    expect(forever).not.toContain("9543886");
    expect(forever).not.toContain("9543887");
    expect(readFileSync("docs/RELEASE_CURSEFORGE.md", "utf8")).toContain("https://api.cfwidget.com/1712677");
    expect(readFileSync("scripts/curseforge-upload.mjs", "utf8")).toContain("api.cfwidget.com/1754138");
    expect(readFileSync("scripts/curseforge-upload.mjs", "utf8")).toContain('game-version", "1.60.1"');
  });
});
