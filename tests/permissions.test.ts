import { describe, expect, it } from "vitest";
import { hasPermission } from "../src/permissions.js";

function memberWithRoles(...names: string[]) {
  return {
    permissions: { has: () => false },
    roles: { cache: names.map((name) => ({ name })) }
  } as never;
}

describe("hasPermission", () => {
  it("allows a guild master to perform officer operations", () => {
    expect(hasPermission(memberWithRoles("Guild Master"), "dkpOfficer")).toBe(true);
  });

  it("does not allow a raid leader to modify DKP", () => {
    expect(hasPermission(memberWithRoles("Raid Leader"), "dkpOfficer")).toBe(false);
  });

  it("allows a guild master to manage settings without holding the Officer role", () => {
    expect(hasPermission(memberWithRoles("Guild Master"), "officer")).toBe(true);
  });

  it("allows an officer to manage raids without holding the Raid Leader role", () => {
    expect(hasPermission(memberWithRoles("Officer"), "raidLeader")).toBe(true);
  });

  it("does not allow a plain officer to be treated as guild master", () => {
    expect(hasPermission(memberWithRoles("Officer"), "guildMaster")).toBe(false);
  });
});
