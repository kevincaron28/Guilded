import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commands } from "../src/commands/index.js";
import { OWNER_CONSOLE_COMMAND } from "../src/commands/owner-console.js";
import { OWNER_PREVIEWS_COMMAND } from "../src/commands/owner-previews.js";
import { OWNER_PROBES_COMMAND } from "../src/commands/owner-probes.js";
import { OWNER_SEASON_COMMAND } from "../src/commands/owner-season.js";

// Every Discord command named in a guide, a website page or a bot message must exist, with its
// subcommands. Renamed commands kept being quoted for months (/profession set, /setup status).

type Node = { name: string; type?: number; options?: Node[]; name_localizations?: Record<string, string> };
const tree = commands.map((command) => command.toJSON() as unknown as Node);
const children = (node: Node) => (node.options ?? []).filter((option) => option.type === 1 || option.type === 2);
const called = (node: Node, word: string) => node.name === word || node.name_localizations?.["fr"] === word;

/** Why a mention such as "setup status" is not a command, or null when it is one. */
function problem(words: string[]): string | null {
  let node = tree.find((command) => called(command, words[0]!));
  if (!node) return `/${words[0]} is not a command`;
  for (const [index, word] of words.entries()) {
    if (index === 0) continue;
    const options = children(node);
    if (!options.length) return null;
    const next: Node | undefined = options.find((option) => called(option, word));
    if (!next) return `/${words.slice(0, index + 1).join(" ")} is not a command`;
    node = next;
  }
  return null;
}

// Typed in WoW, a web address, or a command that is not in the member list: the owner's private
// commands (registered in the home server only) and Path of Exile 2 (hidden, never deleted).
const ELSEWHERE = new Set([
  "guilded", "gd", "gdg", "gdungeons", "ggames", "gsos", "reload", "console", "invite", "ginvite", "gpromote", "gdemote", "w", "who",
  "health", "fr", "poe", OWNER_CONSOLE_COMMAND, OWNER_PREVIEWS_COMMAND, OWNER_PROBES_COMMAND, OWNER_SEASON_COMMAND
]);

/** The file's lines; for source files, without comment lines: only what can reach a person is checked. */
const readable = (file: string) => readFileSync(file, "utf8").split(/\r?\n/)
  .filter((line) => !file.endsWith(".ts") || !/^\s*(?:\/\/|\/?\*)/.test(line));

/** Commands written as code: `…` in Markdown and messages, <code>…</code> on the website. */
function mentions(text: string): string[][] {
  const found: string[][] = [];
  for (const [, backtick, html] of text.matchAll(/\\?`(\/[a-z][^`\\\n]*)\\?`|<code>(\/[a-z][^<\n]*)<\/code>/g)) {
    const command = (backtick ?? html)!;
    // A path or an address (/download/, /api/v1/…, /docs/PRIVACY) is not a command.
    if (!/^\/[a-z][a-z-]*(?:\s|$)/.test(command)) continue;
    const words: string[] = [];
    for (const word of command.slice(1).split(/\s+/)) {
      if (!/^[a-z][a-z-]*$/.test(word)) break;
      words.push(word);
    }
    if (words.length && !ELSEWHERE.has(words[0]!)) found.push(words);
  }
  return found;
}

function files(folder: string, extension: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const full = path.join(folder, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : files(full, extension);
    return full.endsWith(extension) ? [full] : [];
  });
}

const GUIDES = ["QUICK_START", "MEMBER_INSTALL", "DUNGEONS_GUIDE", "EPGP_GUIDE", "HOSTED_PILOT", "AI_SETUP_HELP"]
  .map((name) => path.join("docs", `${name}.md`)).concat("README.md");
const where = (file: string) => file.replaceAll("\\", "/");

describe("commands named to people exist", () => {
  const sources = [...files("site/pages", ".md"), "site/editions.mjs", "site/index.html", ...GUIDES, ...files("src", ".ts")];

  it("reads real mentions", () => {
    expect(mentions("Run `/setup start status:true`, then <code>/character list</code> and \\`/mod page create\\`. See `/download/`."))
      .toEqual([["setup", "start"], ["character", "list"], ["mod", "page", "create"]]);
    expect(problem(["setup", "status"])).toContain("/setup status");
    expect(problem(["character", "profession", "set"])).toBeNull();
    expect(problem(["personnage"])).toBeNull();
  });

  it("names no command that does not exist", () => {
    const wrong = sources.flatMap((file) => mentions(readable(file).join("\n"))
      .flatMap((words) => { const why = problem(words); return why ? [`${where(file)}: ${why}`] : []; }));
    expect([...new Set(wrong)].sort()).toEqual([]);
  });

  // The same renames, also caught where a message names them without code marks.
  it("names no renamed command in plain text", () => {
    const renamed = /(?<![\w./])\/(?:setup status|setup step|dungeon-admin|guildpage|bg privacy|profession set|recruit set)\b|(?:run|lance) \/achievements\b/;
    const wrong = sources.flatMap((file) => readable(file).flatMap((line) => {
      const found = renamed.exec(line);
      return found ? [`${where(file)}: ${found[0]}`] : [];
    }));
    expect([...new Set(wrong)].sort()).toEqual([]);
  });
});
