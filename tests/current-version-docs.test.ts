import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The "current version" lines people and agents read first must follow package.json. On
// 22 October 2026 ten files still called 6.x or 7.1 current; a version bump updates these too.
const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const read = (file: string) => readFileSync(file, "utf8");
const first = (file: string, pattern: RegExp) => read(file).match(pattern)?.[1] ?? `(no match for ${pattern} in ${file})`;

describe("current version in docs and packages", () => {
  it.each([
    ["README.md", /\*\*Current version: (\d+\.\d+\.\d+)/],
    ["CLAUDE.md", /\*\*Current status \([^)]*\): version (\d+\.\d+\.\d+)/],
    ["CLAUDE.md", /^> (\d+\.\d+\.\d+) \(/m],
    ["ROADMAP.md", /## Current stage[^\n]*[\r\n]+Guilded \*\*(\d+\.\d+\.\d+)/],
    ["CHANGELOG.md", /^## (\d+\.\d+\.\d+)/m],
    ["addon/Guilded/Guilded.toc", /^## Version: (\S+)/m],
    ["addon/GuildedDungeons/GuildedDungeons.toc", /^## Version: (\S+)/m]
  ])("%s says %s", (file, pattern) => {
    expect(first(file, pattern), `${file}: update its current-version line to ${version}`).toBe(version);
  });

  it("companion app package matches", () => {
    expect(JSON.parse(read("companion-app/package.json")).version).toBe(version);
  });
});
