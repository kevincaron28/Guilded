import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { blockedRoles, type VisibilityOverride } from "../src/services/command-visibility.js";

const guildId = "100";
const appId = "900";
const commands = [
  { id: "1", name: "lead", defaultMemberPermissions: PermissionFlagsBits.ManageEvents },
  { id: "2", name: "officer", defaultMemberPermissions: PermissionFlagsBits.ManageGuild },
  { id: "3", name: "organize", defaultMemberPermissions: PermissionFlagsBits.ManageGuild }
];
const raidLeader = { id: "10", name: "Raid Leader", permissions: 0n };
const officer = { id: "11", name: "Officier", permissions: PermissionFlagsBits.ManageGuild };
const check = (roles = [raidLeader, officer], overrides = new Map<string, VisibilityOverride[]>(), list = commands) =>
  blockedRoles({ guildId, appId, roles, commands: list, overrides });

describe("leader command visibility", () => {
  it("flags a Raid Leader without Manage Events (French role names count too)", () => {
    expect(check()).toEqual([{ role: "Raid Leader", command: "lead" }, { role: "Officier", command: "lead" }]);
  });

  it("accepts the role permission, Administrator, or an Integrations override", () => {
    expect(check([{ ...raidLeader, permissions: PermissionFlagsBits.ManageEvents }], undefined)).toEqual([]);
    expect(check([{ ...raidLeader, permissions: PermissionFlagsBits.Administrator }])).toEqual([]);
    expect(check([raidLeader], new Map([["1", [{ id: "10", type: 1, permission: true }]]]))).toEqual([]);
    expect(check([raidLeader], new Map([[appId, [{ id: guildId, type: 1, permission: true }]]]))).toEqual([]);
  });

  it("lets a command-level deny win over the role's permissions", () => {
    const denied = new Map([["2", [{ id: "11", type: 1, permission: false }]]]);
    expect(check([{ ...officer, permissions: PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageEvents }], denied)).toEqual([{ role: "Officier", command: "officer" }]);
  });

  it("skips commands the server doesn't have (Guilded Lite) and unrelated roles", () => {
    expect(check([raidLeader, { id: "12", name: "Member", permissions: 0n }], undefined, [])).toEqual([]);
  });
});
