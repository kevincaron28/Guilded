import { describe, expect, it, vi } from "vitest";
import { memberRank, planRankRoles, RANK_MAX_AGE_MS, syncAllRankRoles, syncRankRoles } from "../src/services/rank-roles.js";

const now = new Date("2026-11-04T12:00:00Z");
const fresh = new Date("2026-11-03T12:00:00Z");
const stale = new Date("2026-10-01T12:00:00Z");
const links = [{ rankIndex: 0, discordRoleId: "gm" }, { rankIndex: 1, discordRoleId: "officer" }, { rankIndex: 4, discordRoleId: "member" }];

describe("a member's rank", () => {
  it("uses the main character, else the highest-ranking one", () => {
    expect(memberRank([{ isMain: false, guildRankIndex: 1, guildRankAt: fresh }, { isMain: true, guildRankIndex: 4, guildRankAt: fresh }], now)).toBe(4);
    expect(memberRank([{ isMain: false, guildRankIndex: 4, guildRankAt: fresh }, { isMain: false, guildRankIndex: 1, guildRankAt: fresh }], now)).toBe(1);
  });
  it("ignores unknown and stale ranks", () => {
    expect(memberRank([{ isMain: true, guildRankIndex: 1, guildRankAt: stale }], now)).toBeNull();
    expect(memberRank([{ isMain: true, guildRankIndex: null, guildRankAt: null }], now)).toBeNull();
    expect(memberRank([{ isMain: true, guildRankIndex: 1, guildRankAt: stale }, { isMain: false, guildRankIndex: 4, guildRankAt: fresh }], now)).toBe(4);
  });
  it("keeps a rank that was refreshed exactly fourteen days ago", () => {
    const edge = new Date(now.getTime() - RANK_MAX_AGE_MS);
    expect(memberRank([{ isMain: true, guildRankIndex: 0, guildRankAt: edge }], now)).toBe(0);
    expect(memberRank([{ isMain: true, guildRankIndex: 0, guildRankAt: new Date(edge.getTime() - 1) }], now)).toBeNull();
  });
});

describe("planning rank roles", () => {
  const plan = (rank: number | null, roles: string[]) => planRankRoles(links, [{ discordUserId: "u", rank, roleIds: new Set(roles) }]);
  it("adds the rank's role and removes other mapped roles only", () => {
    expect(plan(1, ["member", "other"])).toEqual([{ discordUserId: "u", add: ["officer"], remove: ["member"] }]);
  });
  it("does nothing when the member is already right", () => {
    expect(plan(4, ["member", "other"])).toEqual([]);
  });
  it("leaves members with an unknown or unmapped rank alone", () => {
    expect(plan(null, ["officer"])).toEqual([]);
    expect(plan(7, ["officer", "member"])).toEqual([]);
  });
  it("does nothing without mappings", () => {
    expect(planRankRoles([], [{ discordUserId: "u", rank: 1, roleIds: new Set() }])).toEqual([]);
  });
  it("promotes a guild master and demotes an officer without touching other roles", () => {
    expect(plan(0, ["officer", "member", "other"])).toEqual([{ discordUserId: "u", add: ["gm"], remove: ["officer", "member"] }]);
    expect(plan(4, ["officer", "other"])).toEqual([{ discordUserId: "u", add: ["member"], remove: ["officer"] }]);
  });
});

describe("syncing a server", () => {
  function setup(opts: {
    enabled?: boolean | undefined; links?: typeof links; editable?: boolean; roleIds?: string[];
    people?: { discordUserId: string; characters: { isMain: boolean; guildRankIndex: number | null; guildRankAt: Date | null }[] }[];
    missingGuild?: boolean; absentRoleId?: string; inDiscord?: boolean; fetchError?: boolean; addError?: Error;
  } = {}) {
    const add = vi.fn(async () => { if (opts.addError) throw opts.addError; });
    const remove = vi.fn(async () => undefined);
    const member = { roles: { cache: new Map((opts.roleIds ?? ["member"]).map((id) => [id, {}])), add, remove } };
    const people = opts.people ?? [{ discordUserId: "u1", characters: [{ isMain: true, guildRankIndex: 1, guildRankAt: fresh }] }];
    const prisma = {
      guild: { findUnique: vi.fn(async () => opts.missingGuild ? null : ({ id: "g1", settings: opts.enabled === undefined ? null : { rankRolesEnabled: opts.enabled } })) },
      guildRankRole: { findMany: vi.fn(async () => opts.links ?? links) },
      member: { findMany: vi.fn(async () => people) }
    };
    const roleOf = (id: string) => opts.absentRoleId === id ? undefined : { id, name: id, editable: opts.editable ?? true };
    const fetch = vi.fn(async () => { if (opts.fetchError) throw new Error("Unknown Member"); return opts.inDiscord === false ? null : member; });
    const guild = { id: "d1", roles: { cache: { get: roleOf } }, members: { cache: opts.inDiscord === false ? new Map() : new Map(people.map((person) => [person.discordUserId, member])), fetch } };
    return { prisma, guild, add, remove, fetch };
  }
  it("is on by default and applies the change", async () => {
    const { prisma, guild, add, remove } = setup();
    const result = await syncRankRoles(prisma as never, guild as never, { now });
    expect(result).toMatchObject({ applied: 1, failed: 0, skipped: null });
    expect(add).toHaveBeenCalledWith(["officer"], expect.any(String));
    expect(remove).toHaveBeenCalledWith(["member"], expect.any(String));
  });
  it("only previews on a dry run", async () => {
    const { prisma, guild, add } = setup();
    const result = await syncRankRoles(prisma as never, guild as never, { now, dryRun: true });
    expect(result.changes).toHaveLength(1);
    expect(add).not.toHaveBeenCalled();
  });
  it("does nothing when an officer turned it off or nothing is mapped", async () => {
    const off = setup({ enabled: false });
    expect((await syncRankRoles(off.prisma as never, off.guild as never, { now })).skipped).toMatch(/off/);
    expect(off.add).not.toHaveBeenCalled();
    const empty = setup({ links: [] });
    expect((await syncRankRoles(empty.prisma as never, empty.guild as never, { now })).skipped).toMatch(/No rank/);
    expect(empty.add).not.toHaveBeenCalled();
  });
  it("refuses roles the bot cannot manage", async () => {
    const { prisma, guild, add } = setup({ editable: false });
    expect((await syncRankRoles(prisma as never, guild as never, { now })).skipped).toMatch(/cannot manage the role gm/);
    expect(add).not.toHaveBeenCalled();
  });
  it("stops when the server is not set up or a mapped role was deleted", async () => {
    const missing = setup({ missingGuild: true });
    expect((await syncRankRoles(missing.prisma as never, missing.guild as never, { now })).skipped).toMatch(/not set up/);
    expect(missing.prisma.guildRankRole.findMany).not.toHaveBeenCalled();
    const deleted = setup({ absentRoleId: "officer" });
    expect((await syncRankRoles(deleted.prisma as never, deleted.guild as never, { now })).skipped).toMatch(/no longer exists/);
    expect(deleted.add).not.toHaveBeenCalled();
  });
  it("is idempotent when the member already has the rank role", async () => {
    const { prisma, guild, add, remove } = setup({ roleIds: ["officer", "other"] });
    const first = await syncRankRoles(prisma as never, guild as never, { now });
    const second = await syncRankRoles(prisma as never, guild as never, { now });
    expect(first).toMatchObject({ changes: [], applied: 0, failed: 0, skipped: null });
    expect(second).toMatchObject({ changes: [], applied: 0, failed: 0 });
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("does not change Discord roles when the stored rank is stale", async () => {
    const { prisma, guild, add, fetch } = setup({
      roleIds: ["officer"],
      people: [{ discordUserId: "u1", characters: [{ isMain: true, guildRankIndex: 1, guildRankAt: stale }] }]
    });
    const result = await syncRankRoles(prisma as never, guild as never, { now });
    expect(result).toMatchObject({ changes: [], applied: 0, failed: 0 });
    expect(add).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("skips a member who is not in the Discord server", async () => {
    const absent = setup({ inDiscord: false });
    expect(await syncRankRoles(absent.prisma as never, absent.guild as never, { now })).toMatchObject({ changes: [], applied: 0, failed: 0 });
    expect(absent.fetch).toHaveBeenCalledWith("u1");
    expect(absent.add).not.toHaveBeenCalled();
    const errored = setup({ inDiscord: false, fetchError: true });
    expect(await syncRankRoles(errored.prisma as never, errored.guild as never, { now })).toMatchObject({ changes: [], failed: 0 });
  });
  it("counts a rate-limit failure and still updates the next member", async () => {
    const boom = vi.fn(async () => { throw Object.assign(new Error("You are being rate limited."), { status: 429 }); });
    const add = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const first = { roles: { cache: new Map([["member", {}]]), add: boom, remove: vi.fn(async () => undefined) } };
    const second = { roles: { cache: new Map([["officer", {}]]), add, remove } };
    const people = [
      { discordUserId: "u1", characters: [{ isMain: true, guildRankIndex: 1, guildRankAt: fresh }] },
      { discordUserId: "u2", characters: [{ isMain: true, guildRankIndex: 4, guildRankAt: fresh }] }
    ];
    const prisma = {
      guild: { findUnique: vi.fn(async () => ({ id: "g1", settings: null })) },
      guildRankRole: { findMany: vi.fn(async () => links) },
      member: { findMany: vi.fn(async () => people) }
    };
    const guild = {
      id: "d1", roles: { cache: { get: (id: string) => ({ id, name: id, editable: true }) } },
      members: { cache: new Map<string, object>([["u1", first], ["u2", second]]), fetch: vi.fn() }
    };
    const result = await syncRankRoles(prisma as never, guild as never, { now });
    expect(result).toMatchObject({ applied: 1, failed: 1, skipped: null });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(first.roles.remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(["member"], expect.any(String));
    expect(remove).toHaveBeenCalledWith(["officer"], expect.any(String));
  });
  it("counts a member who disappears before the role change is applied", async () => {
    let seen = 0;
    const member = { roles: { cache: new Map([["member", {}]]), add: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } };
    const cache = { get: (id: string) => { seen += 1; return seen === 1 && id === "u1" ? member : undefined; } };
    const prisma = {
      guild: { findUnique: vi.fn(async () => ({ id: "g1", settings: null })) },
      guildRankRole: { findMany: vi.fn(async () => links) },
      member: { findMany: vi.fn(async () => [{ discordUserId: "u1", characters: [{ isMain: true, guildRankIndex: 1, guildRankAt: fresh }] }]) }
    };
    const guild = { id: "d1", roles: { cache: { get: (id: string) => ({ id, name: id, editable: true }) } }, members: { cache, fetch: vi.fn() } };
    const result = await syncRankRoles(prisma as never, guild as never, { now });
    expect(result).toMatchObject({ applied: 0, failed: 1 });
    expect(member.roles.add).not.toHaveBeenCalled();
  });
});

describe("the hourly run", () => {
  it("reports one server's failure and still syncs the next", async () => {
    const report = vi.fn();
    let calls = 0;
    const prisma = {
      guild: {
        findMany: vi.fn(async () => [{ id: "scope" }]),
        findFirst: vi.fn(async () => ({ id: "scope", discordId: "d", scopeKey: "default", wowSpace: null })),
        findUnique: vi.fn(async () => { calls += 1; if (calls === 1) throw new Error("429"); return null; })
      }
    };
    await syncAllRankRoles(prisma as never, [{ id: "d1" }, { id: "d2" }] as never, report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(String(report.mock.calls[0]?.[0])).toContain("429");
  });
});
