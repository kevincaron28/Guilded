import { describe, expect, it, vi } from "vitest";
import { nicknameFor, planNicknames, restoreNickname, stripMainSuffix, validNicknameFormat, type NicknamePerson } from "../src/services/nickname-sync.js";

const person = (over: Partial<NicknamePerson> = {}): NicknamePerson => ({ discordUserId: "u1", accountName: "Kevin", nickname: null, mainName: "Halidor Galemorne", skip: false, record: null, ...over });

describe("nickname format", () => {
  it("defaults to Discord name (Main Full Name)", () => {
    expect(nicknameFor("Kevin", "Halidor Galemorne")).toBe("Kevin (Halidor Galemorne)");
    expect(nicknameFor("Kevin", "Halidor Galemorne", "{name} ({main})")).toBe("Kevin (Halidor)");
  });
  it("falls back in order when over 32 characters", () => {
    expect(nicknameFor("kevmister2", "Lebowski Holyroller")).toBe("kevmister2 (Lebowski Holyroller)");
    // 2. no space (the owner's example is 33 characters with the space)
    expect(nicknameFor("kevmister28", "Lebowski Holyroller")).toBe("kevmister28(Lebowski Holyroller)");
    // 3. shortened last name
    expect(nicknameFor("kevmister28x", "Lebowski Holyroller")).toBe("kevmister28x(Lebowski H.)");
    expect(nicknameFor("kevmister28xxxxxxxx", "Lebowski Holyroller")).toBe("kevmister28xxxxxxxx(Lebowski H.)");
    // 4. first name only
    expect(nicknameFor("kevmister28xxxxxxxxxxx", "Lebowski Holyroller")).toBe("kevmister28xxxxxxxxxxx(Lebowski)");
    // 5. shorten the Discord name with an ellipsis, keeping (First)
    const shortened = nicknameFor("A very long Discord display name indeed", "Lebowski Holyroller")!;
    expect(shortened.length).toBeLessThanOrEqual(32);
    expect(shortened).toMatch(/^A very.*…\(Lebowski\)$/);
    // the Discord name is never dropped
    expect(nicknameFor("Kevin", "Abcdefghijklmnopqrstuvwxyzabcdef")).toBeNull();
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
  it("uses the member's own server nickname as the base and remembers it", () => {
    expect(planNicknames([person({ nickname: "Kev" })])).toEqual([{ discordUserId: "u1", nickname: "Kev (Halidor Galemorne)", originalNickname: "Kev" }]);
  });
  it("falls back to the global display name (the account name the plan is given) when there is no server nickname", () => {
    expect(planNicknames([person({ nickname: null })])).toEqual([{ discordUserId: "u1", nickname: "Kevin (Halidor Galemorne)", originalNickname: null }]);
    expect(planNicknames([person({ nickname: null, accountName: "kevin_username" })])[0]).toMatchObject({ nickname: "kevin_username(Halidor G.)" }); // the usual 32-character fallback
  });
  it("skips opted-out members, the owner/unmanageable (skip), and members with no main", () => {
    expect(planNicknames([person({ record: { originalNickname: null, appliedNickname: null, optedOut: true } }), person({ discordUserId: "u2", skip: true }), person({ discordUserId: "u3", mainName: null })])).toEqual([]);
  });
  it("is idempotent, and follows a main change from the stored original without nesting", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kev (Halidor Galemorne)", optedOut: false };
    expect(planNicknames([person({ nickname: "Kev (Halidor Galemorne)", record: applied })])).toEqual([]);
    expect(planNicknames([person({ nickname: "Kev (Halidor Galemorne)", mainName: "Aria Stone", record: applied })])).toEqual([{ discordUserId: "u1", nickname: "Kev (Aria Stone)", originalNickname: "Kev" }]);
    // A member with no server nickname keeps using the account name on every re-sync.
    const none = { originalNickname: null, appliedNickname: "Kevin (Halidor Galemorne)", optedOut: false };
    expect(planNicknames([person({ nickname: "Kevin (Halidor Galemorne)", mainName: "Aria Stone", record: none })])).toEqual([{ discordUserId: "u1", nickname: "Kevin (Aria Stone)", originalNickname: null }]);
  });
  it("treats a nickname the member changed to between syncs as their new base and original", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kev (Halidor Galemorne)", optedOut: false };
    expect(planNicknames([person({ nickname: "Chief", record: applied })])).toEqual([{ discordUserId: "u1", nickname: "Chief (Halidor Galemorne)", originalNickname: "Chief" }]);
    // They cleared it: back to the global display name.
    expect(planNicknames([person({ nickname: null, record: applied })])).toEqual([{ discordUserId: "u1", nickname: "Kevin (Halidor Galemorne)", originalNickname: null }]);
  });
  it("never doubles the suffix, even when the member edited our nickname or the stored original already has it", () => {
    const applied = { originalNickname: "Kev", appliedNickname: "Kev (Halidor Galemorne)", optedOut: false };
    // They edited the nickname but kept our "(Main)" part: already right, so only the new original is recorded.
    expect(planNicknames([person({ nickname: "Chief (Halidor Galemorne)", record: applied })])).toEqual([{ discordUserId: "u1", nickname: "Chief (Halidor Galemorne)", originalNickname: "Chief" }]);
    expect(planNicknames([person({ nickname: "Chief (Halidor)", record: applied })])[0]).toMatchObject({ nickname: "Chief (Halidor Galemorne)", originalNickname: "Chief" });
    // A bad stored original that already carries the suffix is cleaned too.
    expect(planNicknames([person({ nickname: "Kev (Halidor Galemorne)", record: { originalNickname: "Kev (Halidor Galemorne)", appliedNickname: "Kev (Halidor Galemorne)", optedOut: false }, mainName: "Aria Stone" })])).toEqual([{ discordUserId: "u1", nickname: "Kev (Aria Stone)", originalNickname: "Kev" }]);
    // Parentheses that are not the main's name are the member's own.
    expect(planNicknames([person({ nickname: "Kev (he/him)" })])[0]).toMatchObject({ nickname: "Kev (he/him) (Halidor Galemorne)", originalNickname: "Kev (he/him)" });
  });
  it("strips only a trailing main-character suffix", () => {
    expect(stripMainSuffix("Kev (Halidor Galemorne)", "Halidor Galemorne")).toBe("Kev");
    expect(stripMainSuffix("Kev (halidor g.)", "Halidor Galemorne")).toBe("Kev");
    expect(stripMainSuffix("Kev (Halidor) (Halidor Galemorne)", "Halidor Galemorne")).toBe("Kev");
    expect(stripMainSuffix("(Halidor) Kev", "Halidor Galemorne")).toBe("(Halidor) Kev");
    expect(stripMainSuffix("Kev", null)).toBe("Kev");
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
