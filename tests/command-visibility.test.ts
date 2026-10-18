import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { HIDDEN_FROM_MEMBERS, commands } from "../src/commands/index.js";
import { liteCommandJson } from "../src/commands/lite.js";

type Json = { name: string; type?: number; default_member_permissions?: string | null; options?: Json[] };

// Officer-only commands carry default_member_permissions so Discord hides them from members.
describe("officer-only commands are hidden from members", () => {
  const all = commands.map((command) => command.toJSON() as unknown as Json);
  const byName = new Map(all.map((command) => [command.name, command]));

  it("sets the permission on every officer-only command", () => {
    expect(Object.keys(HIDDEN_FROM_MEMBERS).sort()).toEqual(["config", "import", "lead", "mod", "officer", "organize", "poll", "setup", "system", "uninstall"]);
    for (const [name, permission] of Object.entries(HIDDEN_FROM_MEMBERS)) {
      expect(byName.get(name)?.default_member_permissions, name).toBe(permission.toString());
    }
    expect(byName.get("uninstall")?.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());
    expect(byName.get("setup")?.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
    expect(byName.get("lead")?.default_member_permissions).toBe(PermissionFlagsBits.ManageEvents.toString());
  });

  it("keeps leader and officer subcommands out of the member parents", () => {
    const paths = (name: string) => (byName.get(name)?.options ?? []).flatMap((option) =>
      option.type === 2
        ? (option.options ?? []).map((inner) => `${option.name} ${inner.name}`)
        : [option.name]);
    expect(paths("raid").sort()).toEqual(["cancel-signup", "progress", "report", "roster", "signup", "status", "wcl check", "wcl list"]);
    expect(paths("epgp").sort()).toEqual(["balance", "history", "leaderboard"]);
    expect(paths("loot").sort()).toEqual(["bid", "history", "reserves"]);
    expect(paths("dungeon")).not.toContain("admin invalidate");
    expect(paths("character")).toEqual(expect.arrayContaining(["readiness me", "claim", "unlink"]));
    for (const hidden of ["unclaimed", "link", "autolink", "readiness member", "readiness raid"]) expect(paths("character")).not.toContain(hidden);
    for (const hidden of ["start-season", "quiz", "honors-settings", "lottery create", "gaming attendance", "challenge review"]) expect(paths("community")).not.toContain(hidden);
    expect(paths("community")).toEqual(expect.arrayContaining(["dice", "lottery join", "gaming join", "challenge submit"]));
    expect(paths("lead").sort()).toEqual(["attendance", "award-ep", "boss", "cancel", "create", "edit", "end", "fill", "history", "note", "readiness-member", "readiness-raid", "season", "start", "wcl-report"]);
    expect(paths("officer").sort()).toEqual(["character autolink", "character link", "character unclaimed", "dungeon audit", "dungeon award", "dungeon config", "dungeon invalidate", "dungeon season-start", "dungeon target", "epgp award-ep", "epgp award-gp", "epgp decay", "epgp reverse", "loot auction", "loot award", "loot close", "loot priority"]);
    expect(paths("organize")).toEqual(expect.arrayContaining(["start-season", "honors-preview", "lottery confirm", "gaming edit", "challenge claims"]));
    expect(paths("organize")).toHaveLength(22);
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
