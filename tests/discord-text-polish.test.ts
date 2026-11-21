import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardName } from "../src/services/board-name.js";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);
}

describe("member-facing command mentions", () => {
  const files = sources("src").filter(file => !file.includes("generated"));
  it("never points at the removed top-level /stats or /events commands", () => {
    const offenders = files.filter(file => /`\/(stats|events)[ `]|\. \/stats |· \/stats |"\/stats /.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("names the real recap commands", () => {
    const text = readFileSync("src/commands/stats.ts", "utf8");
    expect(text).toContain("recap-posts");
  });
});

describe("board names", () => {
  it("never ends inside an open bracket", () => {
    expect(boardName("Maxle (Druid) (Maxle Druidiste)", 24)).toBe("Maxle (Druid)");
    expect(boardName("Maxle (Druid) (Maxle Dru", 20)).toBe("Maxle (Druid)");
  });
  it("keeps short names whole and flattens line breaks", () => {
    expect(boardName("Maxle\nDru", 24)).toBe("Maxle Dru");
  });
});
