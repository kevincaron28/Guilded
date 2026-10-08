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
    expect(find("dungeon", "admin", "audit")).toMatchObject({ legacy: "dungeon-admin", sub: "audit" });
    expect(find("loot", null, "bid")).toMatchObject({ legacy: "loot", sub: "bid", merged: false });
  });
});
