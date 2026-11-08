import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BG_SETUP_NAMES, CHANNEL_FIELDS, COMMUNITY_CHANNEL_SPECS, PVP_SETUP_NAMES, channelNames, communityChannelNames } from "../src/setup-names.js";

// Member-facing text must not point people at a channel /setup no longer creates. The 8 November 2026 audit found
// #wow-personnage (replaced by #invitation-guilde), #bot-faq (retired in 9.0) and the PvP groups channel (merged into
// the group finder) still named in places. This test reads the text we ship (bot strings, website pages, the member
// install guide) and fails on a `#channel-name` that no setup name matches, or on a retired name.

const RETIRED = new Set(["bot-faq", "wow-personnage", "pvp-groups", "groupes-pvp", "groupes-jcj"]);
const known = new Set<string>();
const addName = (name: string) => known.add(name.replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase());
for (const field of CHANNEL_FIELDS) channelNames(field).forEach(addName);
for (const key of Object.keys(COMMUNITY_CHANNEL_SPECS.en) as (keyof typeof COMMUNITY_CHANNEL_SPECS.en)[]) communityChannelNames(key).forEach(addName);
for (const table of [BG_SETUP_NAMES, PVP_SETUP_NAMES]) for (const lang of Object.values(table)) for (const name of Object.values(lang) as string[]) addName(name);
// Names of server channels Guilded does not create but its own pages may mention (Québec Gold's own channels).
const OTHER_CHANNELS = new Set(["invitation-guilde"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "generated") continue;
    if (statSync(path).isDirectory()) walk(path, out); else if (/\.(ts|md)$/.test(entry)) out.push(path);
  }
  return out;
}
const files = [...walk("src").filter(file => !file.endsWith("dungeon-art.ts")), ...walk("site/pages"), "docs/MEMBER_INSTALL.md", "README.md", "COMMANDS.md"];

/** Channel-looking tokens (#two-or-more-words) in text lines: comments, markdown anchors and URL fragments are skipped. */
function channelTokens(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(\/\/|\/\*|\*)/.test(line)) continue;
    const cleaned = raw.replace(/\]\(#[^)]*\)/g, "").replace(/(href|src)="[^"]*"/g, "").replace(/\/\/ .*$/, "");
    for (const match of cleaned.matchAll(/(?<![\w/&#:.-])#([\p{L}][\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)+)/gu)) found.push(match[1]!.toLowerCase());
  }
  return found;
}

describe("channel names in member-facing text", () => {
  it("finds tokens and ignores comments and anchors", () => {
    expect(channelTokens("Ask in #bot-faq or see [x](#wow-addon).\n// #wow-personnage\n* #pvp-groups")).toEqual(["bot-faq"]);
  });

  it("never names a retired channel", () => {
    const bad = files.flatMap(file => channelTokens(readFileSync(file, "utf8")).filter(name => RETIRED.has(name)).map(name => `${file}: #${name}`));
    expect(bad).toEqual([]);
  });

  it("only names channels /setup creates (or a listed outside channel)", () => {
    const bad = files.flatMap(file => channelTokens(readFileSync(file, "utf8")).filter(name => !known.has(name) && !OTHER_CHANNELS.has(name)).map(name => `${file}: #${name}`));
    expect(bad).toEqual([]);
  });
});
