import { describe, expect, it } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import { parse } from "dotenv";
import { createPilotPolicy } from "../src/services/pilot-policy.js";
import { editPilotApprovals, pilotFilePolicy, pilotInvite, pilotRequestInvite } from "../src/services/pilot-admin.js";

const owner = "111111111111111111", guest = "222222222222222222", other = "333333333333333333";
const file = `# Existing configuration\r\nDISCORD_GUILD_ID=${owner}\r\nDISCORD_CLIENT_ID=444444444444444444\r\nDISCORD_TOKEN="test # literal"\r\nHOSTED_PILOT=false\r\nHOSTED_GUILD_IDS=\r\nHOSTED_GUILD_LIMIT=2\r\n`;
describe("owner-approved hosted pilot", () => {
  it("offers an invitation to request access without approving the chosen server", () => {
    const enabled = editPilotApprovals(file, "enable");
    const url = new URL(pilotRequestInvite(enabled));
    expect(url.searchParams.has("guild_id")).toBe(false);
    expect(pilotFilePolicy(enabled).allows(guest)).toBe(false);
    expect(BigInt(url.searchParams.get("permissions")!) & PermissionFlagsBits.Administrator).toBe(0n);
    expect(() => pilotRequestInvite(file)).toThrow("Enable");
  });
  it("defaults independent installations to their existing multi-guild behavior", () => {
    expect(pilotFilePolicy(file).allows(guest)).toBe(true);
  });
  it("rejects unapproved servers, including after a restart, and keeps the owner", () => {
    const enabled = editPilotApprovals(file, "enable");
    expect(pilotFilePolicy(enabled).allows(owner)).toBe(true);
    expect(pilotFilePolicy(enabled).allows(guest)).toBe(false);
    const approved = editPilotApprovals(enabled, "approve", guest);
    expect(pilotFilePolicy(approved).allows(guest)).toBe(true);
    expect(pilotFilePolicy(approved).allows(other)).toBe(false);
    const revoked = editPilotApprovals(approved, "revoke", guest);
    expect(pilotFilePolicy(revoked).allows(guest)).toBe(false);
    expect(() => editPilotApprovals(revoked, "revoke", owner)).toThrow("primary");
  });
  it("enforces capacity, validates IDs, and treats repeated approvals as one slot", () => {
    const approved = editPilotApprovals(file, "approve", guest);
    expect(editPilotApprovals(approved, "approve", guest)).toBe(approved);
    expect(() => editPilotApprovals(approved, "approve", other)).toThrow("HOSTED_GUILD_LIMIT");
    expect(() => editPilotApprovals(file, "approve", "invalid\nHOSTED_PILOT=false")).toThrow("server ID");
    expect(() => createPilotPolicy({ enabled: true, primaryGuildId: "bad", guildIds: "", limit: 5 })).toThrow("server IDs");
    expect(approved).toContain('DISCORD_TOKEN="test # literal"\r\n');
    expect(parse(approved)["HOSTED_PILOT"]).toBe("true");
  });
  it("only builds approved server invitations and never requests Administrator", () => {
    expect(() => pilotInvite(file, guest)).toThrow("Approve");
    const enabled = editPilotApprovals(file, "enable");
    expect(() => pilotInvite(enabled, guest)).toThrow("Approve");
    const url = new URL(pilotInvite(editPilotApprovals(enabled, "approve", guest), guest));
    expect(url.hostname).toBe("discord.com");
    expect(url.searchParams.get("guild_id")).toBe(guest);
    expect(url.searchParams.get("disable_guild_select")).toBe("true");
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
    expect(BigInt(url.searchParams.get("permissions")!) & PermissionFlagsBits.Administrator).toBe(0n);
    expect(url.toString()).not.toContain("test");
  });
});
