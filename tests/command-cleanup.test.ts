import { describe, expect, it } from "vitest";
import { commands, HIDDEN_FROM_MEMBERS } from "../src/commands/index.js";
import { resolveCommand } from "../src/commands/router.js";
import { executeProfile } from "../src/commands/profile.js";
import { executeSystem } from "../src/commands/system.js";
import { executeUninstall } from "../src/commands/uninstall.js";

type Option = { name: string; type: number; options?: Option[] };
const json = (name: string) => commands.find((command) => command.name === name)!.toJSON() as unknown as Option;
const resolve = (commandName: string, sub: string | null, group: string | null = null) =>
  resolveCommand(commands, { commandName, options: { getSubcommand: () => sub, getSubcommandGroup: () => group } } as never);

// 7.3.0 command cleanup: fewer top-level commands, same handlers and the same permission checks.
describe("merged commands", () => {
  it("has no top-level /profile, /system or /uninstall any more", () => {
    const names = commands.map((command) => command.name);
    for (const gone of ["profile", "system", "uninstall"]) expect(names).not.toContain(gone);
    expect(Object.keys(HIDDEN_FROM_MEMBERS)).not.toContain("system");
    expect(Object.keys(HIDDEN_FROM_MEMBERS)).not.toContain("uninstall");
  });

  it("mounts /setup system as a group and /setup uninstall next to /setup reset", () => {
    const setup = json("setup").options!;
    expect(setup.find((option) => option.name === "system")?.options?.map((option) => option.name)).toEqual(["status", "retry", "permissions"]);
    expect(setup.map((option) => option.name)).toEqual(expect.arrayContaining(["start", "reset", "uninstall"]));
    expect(resolve("setup", "status", "system").handler).toBe(executeSystem);
    expect(resolve("setup", "uninstall").handler).toBe(executeUninstall);
  });

  it("puts the member profile under /character", () => {
    expect(json("character").options!.map((option) => option.name)).toContain("profile");
    expect(resolve("character", "profile").handler).toBe(executeProfile);
  });
});
