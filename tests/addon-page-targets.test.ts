import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every control that opens a Guilded page by name (ns.openToolsPage, openPage, selectTabByName) must name a page that
// exists in TAB_DEFS (or one selectTabByName handles itself). A removed page left behind a button does nothing.
const dir = "addon/Guilded/Modules";
const sources = readdirSync(dir).filter((f) => f.endsWith(".lua")).map((f) => [f, readFileSync(`${dir}/${f}`, "utf8")] as const);
const minimap = readFileSync(`${dir}/Minimap.lua`, "utf8");
const tabs = new Set([...minimap.matchAll(/^\s*\{ name = "([^"]+)"/gm)].map((m) => m[1]!));
// selectTabByName answers these without a tab of that name.
const handled = new Set(["Loot", "Dungeons", "Season", "Scores"]);
// Only offered when that tab exists (tabExists in the quick menu): a dead branch that PR 2 removes.
handled.add("Race to 60");

describe("page targets", () => {
  it("finds the page list", () => {
    expect(tabs.size).toBeGreaterThan(15);
    expect(tabs.has("Home")).toBe(true);
  });
  it("no control opens a page that does not exist", () => {
    const missing: string[] = [];
    for (const [file, source] of sources) {
      for (const m of source.matchAll(/(?:openToolsPage|openPage|selectTabByName|selectTab)\(\s*"([^"]+)"\s*\)/g)) {
        if (!tabs.has(m[1]!) && !handled.has(m[1]!)) missing.push(`${file}: ${m[1]!}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
