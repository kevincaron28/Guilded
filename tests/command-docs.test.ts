import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMMANDS = [
  "setup", "config", "help", "character", "raid", "epgp", "loot", "dungeon", "craft", "leaderboard", "bank",
  "apply", "report", "mod", "core", "tag", "community", "poe", "participation", "promotion", "team", "bg",
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
