import { describe, expect, it, vi } from "vitest";
import { nicknameFor, planNicknames, restoreNickname, validNicknameFormat, type NicknamePerson } from "../src/services/nickname-sync.js";

const person = (over: Partial<NicknamePerson> = {}): NicknamePerson => ({ discordUserId: "u1", accountName: "Kevin", nickname: null, mainName: "Halidor Galemorne", skip: false, record: null, ...over });

describe("nickname format", () => {
  it("defaults to Discord name (Main Full Name)", () => {
    expect(nicknameFor("Kevin", "Halidor Galemorne")).toBe("Kevin (Halidor Galemorne)");
    expect(nicknameFor("Kevin", "Halidor Galemorne", "{name} ({main})")).toBe("Kevin (Halidor)");
  });
  it("falls back in order when over 32 characters", () => {
    // 1. fits with the space
    expect(nicknameFor("kevmister2", "Lebowski Holyroller")).toBe("kevmister2 (Lebowski Holyroller)");
    // 2. no space: the owner's example is 33 characters with the space
    expect(nicknameFor("kevmister28", "Lebowski Holyroller")).toBe("kevmister28(Lebowski Holyroller)");
    // 3. shorten the Discord name with an ellipsis
    const shortened = nicknameFor("A very long Discord display name", "Lebowski Holyroller")!;
    expect(shortened.length).toBeLessThanOrEqual(32);
    expect(shortened).toMatch(/…\(Lebowski Holyroller\)$/);
    // 4. the character alone
    expect(nicknameFor("Kevin", "Abcdefghijklmnopqrstuvwxyz Abc")).toBe("(Abcdefghijklmnopqrstuvwxyz Abc)");
  });
  it("handles a character with no last name, and gives up rather than overflow", () => {
    expect(nicknameFor("Kevin", "Halidor")).toBe("Kevin (Halidor)");
    expect(nicknameFor("Kevin", "Supercalifragilisticexpialidocious")).toBeNull();
    expect(nicknameFor("Kevin", "")).toBeNull();
  });
  it("accepts only formats with a character placeholder", () => {
    expect(validNicknameFormat("{name} ({full})")).toBe(true);
    expect(validNicknameFormat("{name}")).toBe(false);
    expect(validNicknameFormat("{main} {oops}")).toBe(false);
  });
});

describe("nickname plan", () => {
  it("renames a member from the account name and remembers the nickname they had", () => {
    expect(planNicknames([person({ nickname: "Kev" })])).toEqual([{ discordUserId: "u1", nickname: "Kevin (Halidor Galemorne)", originalNickname: "Kev" }]);
  });
  it("skips opted-out members, the owner/unmanageable (skip), and members with no main", () => {
    expect(planNicknames([person({ record: { originalNickname: null, appliedNickname: null, optedOut: true } }), person({ discordUserId: "u2", skip: true }), person({ discordUserId: "u3", mainName: null })])).toEqual([]);
  });
  it("is idempotent, and follows a main change without nesting", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kevin (Halidor Galemorne)", optedOut: false };
    expect(planNicknames([person({ nickname: "Kevin (Halidor Galemorne)", record: applied })])).toEqual([]);
    expect(planNicknames([person({ nickname: "Kevin (Halidor Galemorne)", mainName: "Aria Stone", record: applied })])).toEqual([{ discordUserId: "u1", nickname: "Kevin (Aria Stone)", originalNickname: "Kev" }]);
  });
  it("treats a nickname the member chose themselves as their new original (restored on opt-out)", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kevin (Halidor Galemorne)", optedOut: false };
    expect(planNicknames([person({ nickname: "Chief", record: applied })])[0]).toMatchObject({ nickname: "Kevin (Halidor Galemorne)", originalNickname: "Chief" });
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
