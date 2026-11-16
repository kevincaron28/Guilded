import { describe, expect, it } from "vitest";
import { isHiddenPlayer, loadHiddenIdentity, setProfileHidden, NOBODY_HIDDEN } from "../src/services/profile-privacy.js";

function fakeDb(hidden: string[], characters: { discordUserId: string; name: string; realm: string }[]) {
  const rows = new Set(hidden);
  return {
    rows,
    publicProfileHidden: {
      findMany: async () => [...rows].map((discordUserId) => ({ discordUserId })),
      findUnique: async ({ where }: { where: { discordUserId: string } }) => rows.has(where.discordUserId) ? { discordUserId: where.discordUserId } : null,
      upsert: async ({ where }: { where: { discordUserId: string } }) => { rows.add(where.discordUserId); },
      deleteMany: async ({ where }: { where: { discordUserId: string } }) => ({ count: rows.delete(where.discordUserId) ? 1 : 0 })
    },
    character: { findMany: async ({ where }: { where: { member: { discordUserId: { in: string[] } } } }) => characters.filter((c) => where.member.discordUserId.in.includes(c.discordUserId)) },
    webCharacter: { findMany: async () => [] },
    deviceCharacter: { findMany: async () => [] }
  };
}

describe("hide my profile edge cases (16 Nov 2026 sweep)", () => {
  it("a member with no linked character can hide: it hides nobody else and changes nothing public", async () => {
    const db = fakeDb([], [{ discordUserId: "22222", name: "Bob Stone", realm: "" }]);
    expect(await setProfileHidden(db as never, "11111", true)).toBe(true);
    const hidden = await loadHiddenIdentity(db as never);
    expect(hidden.users.has("11111")).toBe(true);
    expect(isHiddenPlayer(hidden, "Bob Stone", "")).toBe(false);
    expect(isHiddenPlayer(hidden, "Bob", "")).toBe(false);
  });
  it("hiding twice reports no change, unhiding restores everyone, and a bad id is refused", async () => {
    const db = fakeDb([], [{ discordUserId: "11111", name: "Ann Lee", realm: "" }]);
    expect(await setProfileHidden(db as never, "11111", true)).toBe(true);
    expect(await setProfileHidden(db as never, "11111", true)).toBe(false);
    expect(isHiddenPlayer(await loadHiddenIdentity(db as never), "Ann Lee", "")).toBe(true);
    expect(await setProfileHidden(db as never, "11111", false)).toBe(true);
    expect(await setProfileHidden(db as never, "11111", false)).toBe(false);
    expect(await loadHiddenIdentity(db as never)).toBe(NOBODY_HIDDEN);
    await expect(setProfileHidden(db as never, "not-an-id", true)).rejects.toThrow();
  });
  it("a character linked after hiding is hidden on the next read", async () => {
    const characters = [{ discordUserId: "11111", name: "Ann Lee", realm: "" }];
    const db = fakeDb(["11111"], characters);
    expect(isHiddenPlayer(await loadHiddenIdentity(db as never), "Ann Moss", "")).toBe(false);
    characters.push({ discordUserId: "11111", name: "Ann Moss", realm: "" });
    expect(isHiddenPlayer(await loadHiddenIdentity(db as never), "Ann Moss", "")).toBe(true);
  });
});
