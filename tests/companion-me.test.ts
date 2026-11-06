import { describe, expect, it, vi } from "vitest";
import { companionMe, safeInvite, type CompanionMeDeps } from "../src/services/companion-me.js";
import { authorizeUrl } from "../src/services/web-auth.js";

// 8.5 Track L: "Connected as <name>" and the Join button for a member not yet in the guild's Discord.
function deps(overrides: Partial<CompanionMeDeps> = {}): CompanionMeDeps {
  return {
    accountFor: async (hash) => hash === "h-personal" ? { discordUserId: "222", username: "kev", displayName: "Kev", personal: true } : null,
    servers: async () => [],
    avatar: async () => "https://cdn.discordapp.com/avatars/222/abc.png?size=64",
    joinTarget: async (nameKey, realmKey) => nameKey === "québec gold" && realmKey === "forever" ? { discordId: "111", name: "Québec Gold", inviteUrl: "https://discord.gg/quebecgold" } : null,
    ...overrides
  };
}

describe("companion me", () => {
  it("says who is signed in, with the avatar", async () => {
    expect(await companionMe(deps(), { tokenHash: "h-personal" })).toEqual({
      account: { username: "kev", displayName: "Kev", avatarUrl: "https://cdn.discordapp.com/avatars/222/abc.png?size=64" },
      personal: true, servers: [], join: null
    });
    expect(await companionMe(deps(), { tokenHash: "unknown" })).toBeNull();
  });

  it("finds the guild's Discord from the in-game guild, with its invite, until the member joins", async () => {
    const before = await companionMe(deps(), { tokenHash: "h-personal", guild: "Québec Gold", realm: "Forever" });
    expect(before?.join).toEqual({ serverName: "Québec Gold", inviteUrl: "https://discord.gg/quebecgold", joined: false });
    const after = await companionMe(deps({ servers: async () => [{ discordId: "111", name: "Québec Gold" }] }), { tokenHash: "h-personal", guild: "QUÉBEC GOLD", realm: "forever" });
    expect(after?.join?.joined).toBe(true);
    expect(after?.servers).toEqual(["Québec Gold"]);
  });

  it("never fails on a missing avatar, unknown guild or junk input", async () => {
    const quiet = deps({ avatar: vi.fn().mockRejectedValue(new Error("no")), joinTarget: vi.fn().mockResolvedValue(null) });
    expect(await companionMe(quiet, { tokenHash: "h-personal", guild: "Other", realm: "Forever" })).toMatchObject({ account: { avatarUrl: null }, join: null });
    const lookup = vi.fn();
    await companionMe(deps({ joinTarget: lookup }), { tokenHash: "h-personal", guild: "a|b", realm: "Forever" });
    await companionMe(deps({ joinTarget: lookup }), { tokenHash: "h-personal", guild: "x".repeat(81), realm: "Forever" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("passes on Discord invite links only", () => {
    expect(safeInvite("https://discord.gg/quebecgold")).toBe("https://discord.gg/quebecgold");
    expect(safeInvite("https://discord.com/invite/AbC-12")).toBe("https://discord.com/invite/AbC-12");
    for (const bad of ["http://discord.gg/x1", "https://evil.example/invite/x", "https://discord.gg/a/b", "javascript:alert(1)", null, ""]) expect(safeInvite(bad)).toBeNull();
  });

  it("asks Discord to show the account only when switching", () => {
    const auth = { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) };
    expect(new URL(authorizeUrl(auth, "st")).searchParams.get("prompt")).toBeNull();
    expect(new URL(authorizeUrl(auth, "st", true)).searchParams.get("prompt")).toBe("consent");
  });
});
