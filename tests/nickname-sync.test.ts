import { describe, expect, it, vi } from "vitest";
import { nicknameFor, planNicknames, restoreNickname, validNicknameFormat, type NicknamePerson } from "../src/services/nickname-sync.js";

const person = (over: Partial<NicknamePerson> = {}): NicknamePerson => ({ discordUserId: "u1", accountName: "Kevin", nickname: null, mainName: "Halidor Galemorne", skip: false, record: null, ...over });

describe("nickname format", () => {
  it("defaults to Discord name (Main First) and fits 32 characters", () => {
    expect(nicknameFor("Kevin", "Halidor Galemorne")).toBe("Kevin (Halidor)");
    expect(nicknameFor("Kevin", "Halidor Galemorne", "{name} [{full}]")).toBe("Kevin [Halidor Galemorne]");
    const long = nicknameFor("A very long Discord display name indeed", "Halidor Galemorne")!;
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith("(Halidor)")).toBe(true);
    expect(long).toContain("…");
  });
  it("gives up rather than overflow", () => {
    expect(nicknameFor("Kevin", "Supercalifragilisticexpialidocious")).toBeNull();
    expect(nicknameFor("Kevin", "")).toBeNull();
  });
  it("accepts only formats with a character placeholder", () => {
    expect(validNicknameFormat("{name} ({main})")).toBe(true);
    expect(validNicknameFormat("{name}")).toBe(false);
    expect(validNicknameFormat("{main} {oops}")).toBe(false);
  });
});

describe("nickname plan", () => {
  it("renames a member and remembers the nickname they had", () => {
    expect(planNicknames([person({ nickname: "Kev" })])).toEqual([{ discordUserId: "u1", nickname: "Kev (Halidor)", originalNickname: "Kev" }]);
  });
  it("skips opted-out members, the owner/unmanageable (skip), and members with no main", () => {
    expect(planNicknames([person({ record: { originalNickname: null, appliedNickname: null, optedOut: true } }), person({ discordUserId: "u2", skip: true }), person({ discordUserId: "u3", mainName: null })])).toEqual([]);
  });
  it("is idempotent, and follows a main change without stacking suffixes", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kev (Halidor)", optedOut: false };
    expect(planNicknames([person({ nickname: "Kev (Halidor)", record: applied })])).toEqual([]);
    expect(planNicknames([person({ nickname: "Kev (Halidor)", mainName: "Aria Stone", record: applied })])).toEqual([{ discordUserId: "u1", nickname: "Kev (Aria)", originalNickname: "Kev" }]);
  });
  it("treats a nickname the member chose themselves as their new original", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kev (Halidor)", optedOut: false };
    expect(planNicknames([person({ nickname: "Chief", record: applied })])[0]).toMatchObject({ nickname: "Chief (Halidor)", originalNickname: "Chief" });
  });
});

describe("opt-out restores the previous nickname", () => {
  const setup = (nickname: string | null, record: Record<string, unknown> | null) => {
    const setNickname = vi.fn(async () => undefined);
    const update = vi.fn(async () => ({}));
    const upsert = vi.fn(async () => ({}));
    const member = { nickname, manageable: true, id: "u1", user: { bot: false }, setNickname };
    const guild = { ownerId: "owner", members: { cache: new Map([["u1", member]]), fetch: async () => member, me: { permissions: { has: () => true } } } };
    const prisma = { memberNickname: { findUnique: async () => record, update, upsert } };
    return { setNickname, update, upsert, run: (optedOut: boolean | null) => restoreNickname(prisma as never, guild as never, "g1", "u1", optedOut) };
  };
  it("puts the old nickname back and records the opt-out", async () => {
    const t = setup("Kev (Halidor)", { id: "r1", originalNickname: "Kev", appliedNickname: "Kev (Halidor)" });
    expect(await t.run(true)).toBe(true);
    expect(t.setNickname).toHaveBeenCalledWith("Kev", expect.any(String));
    expect(t.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { appliedNickname: null, optedOut: true } });
  });
  it("clears the nickname when they had none, and never overwrites one they changed", async () => {
    const none = setup("Kevin (Halidor)", { id: "r1", originalNickname: null, appliedNickname: "Kevin (Halidor)" });
    await none.run(true);
    expect(none.setNickname).toHaveBeenCalledWith(null, expect.any(String));
    const changed = setup("My own", { id: "r1", originalNickname: "Kev", appliedNickname: "Kev (Halidor)" });
    await changed.run(true);
    expect(changed.setNickname).not.toHaveBeenCalled();
  });
  it("records an opt-out even when nothing was renamed yet", async () => {
    const t = setup(null, null);
    expect(await t.run(true)).toBe(false);
    expect(t.upsert).toHaveBeenCalled();
  });
});
