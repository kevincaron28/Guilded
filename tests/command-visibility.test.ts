import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { HIDDEN_FROM_MEMBERS, commands } from "../src/commands/index.js";
import { liteCommandJson } from "../src/commands/lite.js";

type Json = { name: string; default_member_permissions?: string | null; options?: Json[] };

// Officer-only commands carry default_member_permissions so Discord hides them from members.
describe("officer-only commands are hidden from members", () => {
  const all = commands.map((command) => command.toJSON() as unknown as Json);
  const byName = new Map(all.map((command) => [command.name, command]));

  it("sets the permission on every officer-only command", () => {
    expect(Object.keys(HIDDEN_FROM_MEMBERS).sort()).toEqual(["config", "import", "mod", "poll", "setup", "system", "uninstall"]);
    for (const [name, permission] of Object.entries(HIDDEN_FROM_MEMBERS)) {
      expect(byName.get(name)?.default_member_permissions, name).toBe(permission.toString());
    }
    expect(byName.get("uninstall")?.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());
    expect(byName.get("setup")?.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
  });

  it("leaves commands members use visible", () => {
    for (const name of ["help", "profile", "character", "raid", "epgp", "loot", "dungeon", "community", "report", "apply", "core", "team", "bank", "tag"]) {
      expect(byName.get(name)?.default_member_permissions ?? null, name).toBeNull();
    }
  });

  it("puts the permission on the parent only, never on a mounted subcommand", () => {
    const nested = (options: Json[] | undefined): boolean =>
      (options ?? []).some((option) => option.default_member_permissions !== undefined || nested(option.options));
    expect(all.filter((command) => nested(command.options)).map((command) => command.name)).toEqual([]);
  });

  it("keeps the permission on the Lite command set", () => {
    const lite = new Map(liteCommandJson(commands).map((command) => [command.name, command as unknown as Json]));
    expect(lite.get("setup")?.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
    expect(lite.get("help")?.default_member_permissions ?? null).toBeNull();
  });
});
