import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Companion redesign PR 5 removed the in-app pages the website now covers (reserves, wishlist,
// cores, pricing, leaderboards) and the hidden Home and Tools leftovers. A script that still reads
// a removed element would throw on every state update and leave the window blank, so this checks,
// for every script the window loads, that each element it reads is in the page.
const dir = "companion-app/renderer";
const html = readFileSync(join(dir, "index.html"), "utf8");
const inPage = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1] ?? "");
const own = scripts.filter((file) => file !== "ui-bundle.js");

/** Every element id a script reads: $('x'), getElementById('x'), bind('x'), pill('x') and id lists looped through $(). */
function readIds(text: string): string[] {
  const direct = [...text.matchAll(/(?:\$|getElementById)\(\s*['"]([^'"]+)['"]\s*\)/g), ...text.matchAll(/\b(?:bind|pill)\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? "");
  const lists = [...text.matchAll(/\[((?:\s*'[A-Za-z][\w-]*'\s*,?)+)\]\s*\.forEach\(\s*(?:\(?\s*\w+\s*\)?)\s*=>\s*(?:\$|bind)\(/g), ...text.matchAll(/for \(const \w+ of \[((?:\s*'[A-Za-z][\w-]*'\s*,?)+)\]\)\s*\$\(/g)]
    .flatMap((match) => [...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((item) => item[1] ?? ""));
  return [...new Set([...direct, ...lists])];
}
/** Ids a script makes itself (element.id = 'x') before reading them. */
const createdIds = (text: string) => new Set([...text.matchAll(/\.id\s*=\s*['"]([^'"]+)['"]/g)].map((match) => match[1]));

describe("the companion window", () => {
  it("loads only scripts that exist", () => {
    expect(own.length).toBeGreaterThan(3);
    for (const file of own) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(scripts).not.toContain("manage.js");
    expect(scripts).not.toContain("raid-hub.js");
  });

  it.each(own)("%s reads only elements that are in the page", (file) => {
    const text = readFileSync(join(dir, file), "utf8");
    const made = createdIds(text);
    const missing = readIds(text).filter((id) => !inPage.has(id) && !made.has(id));
    expect(missing).toEqual([]);
  });

  it("names and links only pages that exist", () => {
    const app = readFileSync(join(dir, "app.js"), "utf8");
    const names = /const names = \{([^}]+)\}/.exec(app)?.[1] ?? "";
    for (const page of [...names.matchAll(/(\w+):'/g)].map((match) => match[1])) expect(inPage.has(`page-${page}`), page).toBe(true);
    for (const target of [...html.matchAll(/data-(?:page|go)="([a-z]+)"/g)].map((match) => match[1])) expect(inPage.has(`page-${target}`), target).toBe(true);
  });

  it("no longer has the pages the website covers, nor the hidden leftovers", () => {
    for (const id of ["page-reserves", "page-wishlist", "page-cores", "page-pricing", "page-leaderboards", "homeLegacy", "toolsLegacy"]) expect(inPage.has(id), id).toBe(false);
    // The website links stay in the menu.
    expect(html).toContain('data-web-path="/leaderboards/"');
    expect(html).toContain('data-web-path="/me/raid-plans"');
  });
});
