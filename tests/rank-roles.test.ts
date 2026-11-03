import { describe, expect, it, vi } from "vitest";
import { memberRank, planRankRoles, syncRankRoles } from "../src/services/rank-roles.js";

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
});

describe("syncing a server", () => {
  function setup(opts: { enabled?: boolean | undefined; links?: typeof links; editable?: boolean } = {}) {
    const add = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const member = { roles: { cache: new Map([["member", {}]]), add, remove } };
    const prisma = {
      guild: { findUnique: vi.fn(async () => ({ id: "g1", settings: opts.enabled === undefined ? null : { rankRolesEnabled: opts.enabled } })) },
      guildRankRole: { findMany: vi.fn(async () => opts.links ?? links) },
      member: { findMany: vi.fn(async () => [{ discordUserId: "u1", characters: [{ isMain: true, guildRankIndex: 1, guildRankAt: fresh }] }]) }
    };
    const roleOf = (id: string) => ({ id, name: id, editable: opts.editable ?? true });
    const guild = { id: "d1", roles: { cache: { get: roleOf } }, members: { cache: new Map([["u1", member]]), fetch: vi.fn() } };
    return { prisma, guild, add, remove };
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
    expect((await syncRankRoles(prisma as never, guild as never, { now })).skipped).toMatch(/cannot manage/);
    expect(add).not.toHaveBeenCalled();
  });
});
