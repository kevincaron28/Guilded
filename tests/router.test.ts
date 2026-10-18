import { describe, expect, it, vi } from "vitest";
import { MergedCommand, legacyView, resolveCommand } from "../src/commands/router.js";
import { commands } from "../src/commands/index.js";

const fakeCommand = (name: string, options: unknown[]) => ({ name, toJSON: () => ({ name, description: `${name} command`, options }) });
const opts = (group: string | null, sub: string | null) => ({
  commandName: "parent",
  options: { getSubcommandGroup: () => group, getSubcommand: (required = true) => { if (sub === null && required) throw new Error("none"); return sub; }, getString: () => "value" }
});

describe("merged commands", () => {
  const handlerA = vi.fn();
  const handlerB = vi.fn();
  const handlerBase = vi.fn();
  const merged = new MergedCommand("parent", "Parent", [
    { command: fakeCommand("plain", [{ type: 3, name: "x", description: "x" }]), handler: handlerA },
    { command: fakeCommand("many", [{ type: 1, name: "set", description: "set" }, { type: 1, name: "list", description: "list" }]), handler: handlerB, as: "renamed" }
  ], { command: fakeCommand("base", [{ type: 1, name: "add", description: "add" }]), handler: handlerBase });

  it("builds subcommands, groups and the parent's own subcommands", () => {
    const json = merged.toJSON();
    expect(json.options?.map((option) => [option.name, option.type])).toEqual([["add", 1], ["plain", 1], ["renamed", 2]]);
  });

  it("routes each call to the old command and subcommand", () => {
    expect(merged.resolve(opts(null, "plain"))).toMatchObject({ legacy: "plain", sub: null, handler: handlerA });
    expect(merged.resolve(opts("renamed", "set"))).toMatchObject({ legacy: "many", sub: "set", handler: handlerB });
    expect(merged.resolve(opts(null, "add"))).toMatchObject({ legacy: "base", sub: "add", handler: handlerBase });
  });

  it("shows the old handler its old command name and subcommand", () => {
    const view = legacyView(opts("renamed", "set") as never, "many", "set") as unknown as ReturnType<typeof opts> & { options: { getSubcommand(r?: boolean): string | null; getSubcommandGroup(): null; getString(): string } };
    expect(view.commandName).toBe("many");
    expect(view.options.getSubcommand()).toBe("set");
    expect(view.options.getSubcommandGroup()).toBeNull();
    expect(view.options.getString()).toBe("value");
    const plain = legacyView(opts(null, "plain") as never, "plain", null) as unknown as typeof view;
    expect(plain.options.getSubcommand(false)).toBeNull();
    expect(() => plain.options.getSubcommand()).toThrow();
  });
});

describe("partial and lifted mounts", () => {
  const handler = vi.fn();
  const source = fakeCommand("src", [{ type: 1, name: "a", description: "a" }, { type: 1, name: "b", description: "b" }, { type: 1, name: "c", description: "c" }]);
  it("keeps only, leaves out, or lifts subcommands, and routes them under their old names", () => {
    const parent = new MergedCommand("p", "P", [
      { command: source, handler, as: "grp", only: ["a", "b"] },
      { command: source, handler, flat: { c: "c-lifted" } }
    ], { command: source, handler, except: ["a", "b"] });
    const json = parent.toJSON();
    expect(json.options?.map((option) => option.name)).toEqual(["c", "grp", "c-lifted"]);
    expect(json.options?.[1]?.options?.map((option) => option.name)).toEqual(["a", "b"]);
    expect(parent.resolve(opts(null, "c-lifted"))).toMatchObject({ legacy: "src", sub: "c" });
    expect(parent.resolve(opts("grp", "b"))).toMatchObject({ legacy: "src", sub: "b" });
    expect(parent.resolve(opts(null, "c"))).toMatchObject({ legacy: "src", sub: "c" });
  });
  it("refuses a missing or doubled subcommand", () => {
    expect(() => new MergedCommand("p", "P", [{ command: source, handler, flat: { z: "z" } }])).toThrow(/no subcommand "z"/);
    expect(() => new MergedCommand("p", "P", [{ command: source, handler, flat: { a: "x" } }, { command: source, handler, flat: { b: "x" } }])).toThrow(/twice/);
  });
});

describe("the real command list", () => {
  it("sends the moved commands to their old handlers", () => {
    const find = (command: string, group: string | null, sub: string | null) => resolveCommand(commands, { commandName: command, options: opts(group, sub).options });
    expect(find("config", null, "view")).toMatchObject({ legacy: "config", sub: "view", merged: false });
    expect(find("setup", null, "start")).toMatchObject({ legacy: "setup", sub: null });
    expect(find("character", "profession", "set")).toMatchObject({ legacy: "profession", sub: "set" });
    expect(find("character", null, "who")).toMatchObject({ legacy: "who", sub: null });
    expect(find("character", null, "add")).toMatchObject({ legacy: "character", sub: "add" });
    expect(find("raid", "wcl", "check")).toMatchObject({ legacy: "wcl", sub: "check" });
    expect(find("import", null, "apply")).toMatchObject({ legacy: "import-apply", sub: null });
    expect(find("report", null, "ping")).toMatchObject({ legacy: "health", sub: null });
    expect(find("mod", "application", "list")).toMatchObject({ legacy: "application", sub: "list" });
    expect(find("officer", "dungeon", "audit")).toMatchObject({ legacy: "dungeon-admin", sub: "audit" });
    expect(find("lead", null, "create")).toMatchObject({ legacy: "raid", sub: "create" });
    expect(find("lead", null, "wcl-report")).toMatchObject({ legacy: "wcl", sub: "report" });
    expect(find("lead", null, "readiness-raid")).toMatchObject({ legacy: "readiness", sub: "raid" });
    expect(find("officer", "epgp", "decay")).toMatchObject({ legacy: "epgp", sub: "decay" });
    expect(find("officer", "loot", "auction")).toMatchObject({ legacy: "loot", sub: "auction" });
    expect(find("officer", "character", "link")).toMatchObject({ legacy: "character", sub: "link" });
    expect(find("organize", null, "start-season")).toMatchObject({ legacy: "community", sub: "start-season" });
    expect(find("organize", "lottery", "create")).toMatchObject({ legacy: "lottery", sub: "create" });
    expect(find("epgp", null, "balance")).toMatchObject({ legacy: "epgp", sub: "balance", merged: true });
    expect(find("raid", null, "signup")).toMatchObject({ legacy: "raid", sub: "signup" });
    expect(find("loot", null, "bid")).toMatchObject({ legacy: "loot", sub: "bid", merged: true });
  });
});
