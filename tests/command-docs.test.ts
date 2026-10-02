import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMMANDS = [
  "setup", "profile", "character", "raid", "epgp", "loot", "dungeon", "craft", "bank",
  "apply", "poll", "report", "mod", "core", "import", "system", "community", "poe", "participation",
];
// Intentionally undocumented in the member-facing help.
const HELP_SKIP = new Set<string>(["system"]);

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
