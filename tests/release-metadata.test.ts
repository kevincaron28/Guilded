import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseMetadata } from "../scripts/release-metadata.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(notes = "# Guilded 6.2.0 — Candidate", version = "6.2.0") {
  const root = mkdtempSync(join(tmpdir(), "guilded-release-")); roots.push(root);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "6.2.0" }));
  writeFileSync(join(root, "release.json"), JSON.stringify({ version, channel: "candidate", notes: "docs/NOTES.md", acceptance: "docs/CHECKS.md" }));
  writeFileSync(join(root, "docs/NOTES.md"), notes); writeFileSync(join(root, "docs/CHECKS.md"), "Pending in-game checks");
  return root;
}
describe("release metadata", () => {
  it("rejects the old notes and mismatched versions before packaging", () => {
    expect(() => releaseMetadata(fixture("# Guilded 6.1.2 — Old notes"))).toThrow(/notes do not match/);
    expect(() => releaseMetadata(fixture(undefined, "6.1.2"))).toThrow(/version mismatch/);
  });
  it("keeps candidate artifacts explicitly unpublished and uses the current notes", () => {
    expect(releaseMetadata(fixture()).channel).toBe("candidate");
    const metadata = releaseMetadata();
    expect(["candidate", "release"]).toContain(metadata.channel);
    expect(metadata.version).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
    // The current notes point testers at this release's real-client checklist.
    expect(metadata.notesText).toContain(metadata.acceptance.replace(/^docs\//, ""));
  });
});
