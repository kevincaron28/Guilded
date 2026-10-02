import { describe, expect, it } from "vitest";
import { commands } from "../src/commands/index.js";

interface OptionJson { name: string; required?: boolean; options?: OptionJson[] }

function orderingProblems(options: OptionJson[] | undefined, path: string): string[] {
  const problems: string[] = [];
  let sawOptional = false;
  for (const option of options ?? []) {
    if (option.options) problems.push(...orderingProblems(option.options, `${path}/${option.name}`));
    else if (option.required) {
      if (sawOptional) problems.push(`${path}/${option.name}: required option after an optional one`);
    } else sawOptional = true;
  }
  return problems;
}

describe("command payloads", () => {
  it("serialize, and never put a required option after an optional one (Discord rejects the whole registration)", () => {
    const problems = commands.flatMap((command) => {
      const json = command.toJSON() as unknown as OptionJson;
      return orderingProblems(json.options, command.name);
    });
    expect(problems).toEqual([]);
  });
});

describe("command registration", () => {
  it("registers each top-level command exactly once", () => {
    const names = commands.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ["setup", "import", "loot", "apply", "mod", "tag", "character", "report", "poe"]) expect(names).toContain(name);
  });

  it("keeps the command list short: old commands live under a parent", () => {
    // PoE2 and Discord participation have dedicated entry points; smaller WoW commands remain merged.
    expect(commands.length).toBeLessThanOrEqual(22);
    const names = commands.map((command) => command.name);
    for (const gone of ["config", "testraid", "selfroles", "who", "wcl", "dkp", "application", "import-apply", "readiness", "profession", "attunement", "wishlist", "dungeon-admin", "stats", "inactive", "export", "guildhealth", "health"]) {
      expect(names).not.toContain(gone);
    }
  });
});
