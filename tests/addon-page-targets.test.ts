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
  it("no module calls a function on another module (ns.module.fn) that its file does not define", () => {
    // ns.<module> = <var> in one file, <var>.<fn> defined there. Modules assigned any other way are skipped.
    const defined = new Map<string, { file: string; source: string; variable: string }>();
    for (const [file, source] of sources) {
      for (const m of source.matchAll(/^ns\.(\w+)\s*=\s*(\w+)\s*$/gm)) defined.set(m[1]!, { file, source, variable: m[2]! });
    }
    const missing = new Set<string>();
    for (const [file, source] of sources) {
      const code = source.replace(/--[^\n]*/g, "");
      for (const m of code.matchAll(/\bns\.(\w+)\.(\w+)\(/g)) {
        const mod = defined.get(m[1]!);
        if (!mod) continue;
        const v = mod.variable;
        const has = new RegExp(String.raw`function ${v}[.:]${m[2]!}\b|\b${v}\.${m[2]!}\s*=`).test(mod.source);
        if (!has) missing.add(`${file}: ns.${m[1]!}.${m[2]!}() is not defined in ${mod.file}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
