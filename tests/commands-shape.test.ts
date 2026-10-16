import { describe, expect, it } from "vitest";
import { commands } from "../src/commands/index.js";
import { CLASSES, PROFESSIONS, SPECS, pick } from "../src/wow-data.js";
import { durationSuggestions, reasonSuggestions, specSuggestions, timeSuggestions } from "../src/services/option-suggestions.js";

type Option = { name: string; description: string; required?: boolean; options?: Option[]; choices?: unknown[]; autocomplete?: boolean; type: number };

// Discord rejects a command when these are wrong, and the bot would fail to
// register any command at all, so check the rules for every command here.
describe("slash command definitions follow Discord's rules", () => {
  const all = commands.map((command) => command.toJSON() as unknown as Option);

  function walk(options: Option[] | undefined, path: string, problems: string[]) {
    if (!options) return;
    let seenOptional = false;
    for (const option of options) {
      const isGroup = option.type === 1 || option.type === 2;
      if (!isGroup) {
        if (option.required && seenOptional) problems.push(`${path}/${option.name}: required option after an optional one`);
        if (!option.required) seenOptional = true;
      }
      if (option.description.length > 100 || option.description.length < 1) problems.push(`${path}/${option.name}: description length`);
      if (!/^[\p{Ll}\p{N}_-]{1,32}$/u.test(option.name)) problems.push(`${path}/${option.name}: bad name`);
      if ((option.choices?.length ?? 0) > 25) problems.push(`${path}/${option.name}: more than 25 choices`);
      if (option.choices?.length && option.autocomplete) problems.push(`${path}/${option.name}: choices and autocomplete together`);
      walk(option.options, `${path}/${option.name}`, problems);
    }
  }

  it("has valid names, descriptions, option order and choice counts", () => {
    const problems: string[] = [];
    for (const command of all) walk(command.options, command.name, problems);
    expect(problems).toEqual([]);
    expect(new Set(all.map((command) => command.name)).size).toBe(all.length);
    expect(all.length).toBeLessThanOrEqual(100);
  });

  // Discord caps the text of one command (names, descriptions, choices) at 4000 characters.
  it("keeps every command under Discord's size limit", () => {
    const size = (node: { name?: string; description?: string; value?: unknown; options?: unknown[]; choices?: unknown[] }): number =>
      (node.name?.length ?? 0) + (node.description?.length ?? 0) + (typeof node.value === "string" ? node.value.length : 0)
      + [...(node.options ?? []), ...(node.choices ?? [])].reduce<number>((sum, child) => sum + size(child as never), 0);
    const tooBig = all.filter((command) => size(command as never) > 4000).map((command) => command.name);
    expect(tooBig).toEqual([]);
    for (const command of all) expect(command.options?.length ?? 0).toBeLessThanOrEqual(25);
    // Stop 100 characters early, so a small wording change fails here, with the command and its
    // size named, rather than at command registration on the live bot. Trim wording; do not
    // raise this margin. (October 2026: /character is the largest, about 3,740.)
    const crowded = all.map((command) => `${command.name}: ${size(command as never)}`).filter((row) => Number(row.split(": ")[1]) > 3900);
    expect(crowded, "within 100 characters of Discord's 4000-character limit: trim wording").toEqual([]);
  });

  it("offers dropdowns for class and profession", () => {
    const find = (command: string, ...path: string[]) =>
      path.reduce<Option | undefined>((node, name) => node?.options?.find((entry) => entry.name === name), all.find((entry) => entry.name === command));
    expect(find("character", "add", "class")?.choices).toHaveLength(CLASSES.length);
    expect(find("character", "profession", "set", "profession")?.choices).toHaveLength(PROFESSIONS.length);
    expect(find("character", "add", "spec")?.autocomplete).toBe(true);
    expect(find("character", "add", "realm")?.required).toBeFalsy();
    // /loot auction needs only the item.
    const auction = all.find((entry) => entry.name === "loot")?.options?.find((entry) => entry.name === "auction");
    expect(auction?.options?.filter((option) => option.required).map((option) => option.name)).toEqual(["item"]);
  });
});

describe("what autocomplete suggests", () => {
  it("filters lists, best prefix first, and caps at 25", () => {
    expect(pick(["Night Elf", "Blood Elf", "Human"], "elf").map((row) => row.value)).toEqual(["Night Elf", "Blood Elf"]);
    expect(pick(["Night Elf", "Blood Elf", "Human"], "blo")[0]?.value).toBe("Blood Elf");
    expect(pick(Array.from({ length: 60 }, (_, i) => `item ${i}`), "")).toHaveLength(25);
  });

  it("offers the specs of the chosen class, or all of them", () => {
    expect(specSuggestions("Priest", "").map((row) => row.value)).toEqual(SPECS["Priest"]);
    expect(specSuggestions(null, "shadow").map((row) => row.value)).toEqual(["Shadow"]);
  });

  it("offers reasons per command and lengths in seconds", () => {
    expect(reasonSuggestions("award-ep", "boss")[0]?.value).toBe("Boss kill");
    expect(reasonSuggestions("award-gp", "").map((row) => row.value)).toContain("Tier piece");
    expect(durationSuggestions("").map((row) => row.value)).toEqual([30, 60, 120, 300, 600]);
    expect(durationSuggestions("90")[0]).toEqual({ name: "90 seconds", value: 90 });
  });

  it("previews when a typed raid time means, and drops what it can't read", () => {
    const now = new Date("2026-10-01T15:00:00Z");
    const list = timeSuggestions("friday", "America/Toronto", "en", now);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.value).toBe("friday 8pm");
    expect(list[0]?.name).toContain("→");
    expect(timeSuggestions("zzzz", "America/Toronto", "en", now)).toEqual([]);
    expect(timeSuggestions("", "America/Toronto", "en", now)[0]?.value).toBe("tonight 8pm");
  });
});
