import { describe, expect, it, vi } from "vitest";

// Only Raid Leaders, Officers, Guild Masters and admins change a raid core; members join through
// the Apply button on the core's roster. Every changing /core subcommand is refused before it
// touches anything.
vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: async () => ({ guildId: "g", memberId: "m" }),
  guildService: {}
}));

const { executeCore } = await import("../src/commands/core.js");

function interaction(subcommand: string, roleNames: string[]) {
  return {
    member: { permissions: { has: () => false }, roles: { cache: { some: (test: (role: { name: string }) => boolean) => roleNames.some((name) => test({ name })) } } },
    options: { getSubcommand: () => subcommand, getString: (name: string) => (name === "action" ? "set" : null) }
  };
}

describe("/core: members cannot change a core", () => {
  const changing = ["setup", "edit", "create", "add", "remove", "character", "post", "delete", "rules", "rename", "items"];

  it.each(changing)("refuses /core %s to a member without a leadership role", async (subcommand) => {
    await expect(executeCore(interaction(subcommand, ["Raider"]) as never)).rejects.toThrow(/Only Raid Leaders/);
  });

  it("does not refuse a Raid Leader (it gets past the permission check)", async () => {
    // With the database mocked away the command fails later, but not on permissions.
    await expect(executeCore(interaction("character", ["Raid Leader"]) as never)).rejects.not.toThrow(/Only Raid Leaders/);
  });
});
