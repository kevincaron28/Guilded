import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Reporter = (text: string) => void;
const updates = createRequire(import.meta.url)("../companion-app/update-check.cjs") as {
  fetchLatestRelease: (fetchImpl: unknown, report?: Reporter) => Promise<{ version: string; source?: string } | null>;
  describeDecision: (decision: unknown) => string;
  SITE_RELEASES: string;
};

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
const sha = "a".repeat(64);
const feed = { guilded: { github: { version: "9.3.1", url: "https://github.com/kevincaron28/Guilded/releases/tag/v9.3.1" }, companionDirect: { version: "9.3.1", size: 122703879, sha256: sha } } };

describe("update check reports (9.3.2: a check is never invisible)", () => {
  it("says it came from the website feed", async () => {
    const lines: string[] = [];
    const found = await updates.fetchLatestRelease(async () => json(feed), (line) => lines.push(line));
    expect(found).toMatchObject({ version: "9.3.1", source: "website" });
    expect(lines).toEqual([]);
  });

  it("says why the website was not used and that GitHub answered instead", async () => {
    const lines: string[] = [];
    const github = { tag_name: "v9.3.1", html_url: "https://github.com/kevincaron28/Guilded/releases/tag/v9.3.1", assets: [] };
    const found = await updates.fetchLatestRelease(async (url: string) => (url === updates.SITE_RELEASES ? json({}, false, 503) : json(github)), (line) => lines.push(line));
    expect(found).toMatchObject({ version: "9.3.1", source: "github" });
    expect(lines).toEqual(["the website feed answered 503"]);
  });

  it("names a feed without a usable installer and the errors of both sources", async () => {
    const lines: string[] = [];
    const noSha = { guilded: { companionDirect: { version: "9.3.1" } } };
    await updates.fetchLatestRelease(async (url: string) => (url === updates.SITE_RELEASES ? json(noSha) : json({}, false, 403)), (line) => lines.push(line));
    expect(lines).toEqual(["the website feed has no usable installer (version or checksum missing)", "GitHub answered 403"]);
    const offline: string[] = [];
    expect(await updates.fetchLatestRelease(async () => { throw new Error("offline"); }, (line) => offline.push(line))).toBeNull();
    expect(offline).toEqual(["the website feed could not be read: offline", "GitHub could not be read: offline"]);
  });

  it("describes every decision in one short phrase", () => {
    expect(updates.describeDecision({ action: "none" })).toBe("up to date");
    expect(updates.describeDecision({ action: "skip", reason: "disabled" })).toBe("skipped (disabled)");
    expect(updates.describeDecision({ action: "download", update: { version: "9.3.1" } })).toBe("download 9.3.1");
    expect(updates.describeDecision({ action: "staged", update: { version: "9.3.1" } })).toBe("9.3.1 is already downloaded");
  });
});

describe("the companion writes every update check to startup.log", () => {
  const main = readFileSync("companion-app/main.cjs", "utf8");
  it("appends update lines for the whole run, not only until the window is ready", () => {
    expect(main).toMatch(/function updateLine\(text\) \{[\s\S]{0,420}try \{ fs\.appendFileSync\(path\.join\(app\.getPath\("userData"\), "startup\.log"\)/);
    // At most 400 lines a run.
    expect(main).toMatch(/if \(updateLines >= 400\) return;/);
    // The ordinary startup lines still stop when the window is ready; update lines do not depend on that.
    expect(main).toMatch(/function updateLine[\s\S]{0,600}\} catch \{ \/\* diagnostics only \*\/ \}/);
    expect(main).not.toMatch(/function updateLine[^}]*startupLogging/);
  });
  it("logs the version seen, the decision, the disk, downloads, failures and the idle install", () => {
    for (const text of ["check: running ${app.getVersion()}, the release feed says", "no release could be read", "check: decision ${updates.describeDecision(autoUpdateDecision())}", "download of ${version} started", "download failed:", "download not started: only", "start: running ${current}"]) expect(main).toContain(text);
  });
  it("looks for a quiet moment every 10 minutes and after each check", () => {
    expect(main).toMatch(/await stageUpdate\(\);\s+await installWhenIdle\(\);/);
    expect(main).toMatch(/setInterval\(\(\) => void installWhenIdle\(\)[\s\S]{0,200}10 \* 60 \* 1000/);
  });
});
