import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseLine } from "../site/release-line.mjs";

describe("home version line", () => {
  it("shows one version and a date, and the lag note only while CurseForge differs", () => {
    expect(releaseLine({ github: "9.1.5", curseforge: "9.0.3", verifiedAt: "2026-11-09" })).toEqual({ version: "9.1.5", date: "2026-11-09", lag: true });
    expect(releaseLine({ github: "9.1.5", curseforge: "9.1.5", verifiedAt: "2026-11-10" })).toEqual({ version: "9.1.5", date: "2026-11-10", lag: false });
    expect(releaseLine({ github: "9.1.5", curseforge: "", verifiedAt: "not-a-date" })).toEqual({ version: "9.1.5", date: "", lag: false });
    const home = readFileSync("site/index.html", "utf8");
    expect(home).not.toContain("GUILDED_CURSEFORGE_VERSION");
    expect(home).toContain("data-release-version>{{GUILDED_VERSION}}");
    expect(home).toContain("CurseForge updates can take a day");
    expect(home).toContain('data-release-lag hidden');
    expect(readFileSync("site/site.js", "utf8")).toContain("curseforge !== version");
  });
});
