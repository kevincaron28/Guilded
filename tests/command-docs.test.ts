import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMMANDS = [
  "setup", "character", "raid", "epgp", "loot", "dungeon", "craft", "bank",
  "apply", "poll", "report", "mod", "core", "import", "community", "poe", "participation",
  "lead", "officer", "organize",
];
// Intentionally undocumented in the member-facing help.
const HELP_SKIP = new Set<string>([]);

function mentioned(src: string, name: string): boolean {
  return new RegExp("/" + name + "\\b").test(src);
}

describe("command documentation drift", () => {
  const help = readFileSync("src/commands/help.ts", "utf8");

  it("every command is in /help", () => {
    const missing = COMMANDS.filter((c) => !HELP_SKIP.has(c) && !mentioned(help, c));
    expect(missing).toEqual([]);
  });
});
