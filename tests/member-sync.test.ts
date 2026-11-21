import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemberSync, handleMemberJoined, handleMemberUpdated, MEMBER_SYNC_DEBOUNCE_MS } from "../src/services/member-sync.js";
import { markMemberChanged, onMemberChanged } from "../src/services/member-sync-events.js";
import { noteOwnNickname, syncMemberNickname } from "../src/services/nickname-sync.js";
import { syncMemberRankRole } from "../src/services/rank-roles.js";

const fresh = new Date();
interface Opts { settings?: Record<string, unknown>; manageable?: boolean; canRename?: boolean; ownerId?: string; ids?: string[] }

function world(opts: Opts = {}) {
  const ids = opts.ids ?? ["u1"];
  const members = new Map(ids.map((id) => [id, {
    id, nickname: null as string | null, user: { bot: false, globalName: `Name${id}`, username: `user${id}` }, manageable: opts.manageable ?? true,
    setNickname: vi.fn().mockResolvedValue(undefined),
    roles: { cache: new Map<string, unknown>(), add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }
  }]));
  const guild = {
    id: "d1", ownerId: opts.ownerId ?? "owner",
    roles: { cache: new Map([["role1", { id: "role1", name: "Officer", editable: true }]]) },
    members: { me: { permissions: { has: () => opts.canRename ?? true } }, cache: members, fetch: vi.fn(async (id: string) => members.get(id) ?? null) }
  };
  const find = vi.fn(async ({ where }: { where: { id?: string; discordUserId?: string } }) => [...members.keys()]
    .map((discordUserId, index) => ({ id: `m${index + 1}`, discordUserId, characters: [{ id: `c${index}`, memberId: `m${index + 1}`, name: `Hero${index}`, displayName: null, realm: "Forever", gameEdition: "forever", isMain: true, confirmedAt: null, linkEvidence: "named", guildRankIndex: 1, guildRankAt: fresh }] }))
    .filter((row) => (where.id ? row.id === where.id : where.discordUserId ? row.discordUserId === where.discordUserId : true)));
  const prisma = {
    guild: {
      findMany: vi.fn().mockResolvedValue([{ id: "g1" }]),
      findFirst: vi.fn().mockResolvedValue({ id: "g1", discordId: "d1", scopeKey: "default", wowSpace: null }),
      findUnique: vi.fn(async () => ({ id: "g1", discordId: "d1", gameEdition: "forever", settings: opts.settings ?? { nicknameSyncEnabled: true, rankRolesEnabled: true } }))
    },
    member: { findMany: find },
    memberNickname: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) },
    guildRankRole: { findMany: vi.fn().mockResolvedValue([{ rankIndex: 1, discordRoleId: "role1" }]) }
  };
  return { prisma, guild, members, find };
}

describe("member sync (event-driven)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a link renames that one member within the debounce, with one setNickname and no full fetch", async () => {
    const w = world();
    const sync = createMemberSync({ prisma: w.prisma as never, getGuild: () => w.guild as never });
    sync.mark({ guildId: "g1", memberId: "m1", what: "nickname" });
    await vi.advanceTimersByTimeAsync(MEMBER_SYNC_DEBOUNCE_MS - 100);
    expect(w.members.get("u1")!.setNickname).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(w.members.get("u1")!.setNickname).toHaveBeenCalledTimes(1);
    expect(w.members.get("u1")!.setNickname.mock.calls[0]![0]).toBe("Nameu1 (Hero0)");
    expect(w.find.mock.calls[0]![0].where.id).toBe("m1");
    expect(w.guild.members.fetch).not.toHaveBeenCalled();
    sync.stop();
  });

  it("the same member marked 50 times is one sync", async () => {
    const w = world();
    const sync = createMemberSync({ prisma: w.prisma as never, getGuild: () => w.guild as never });
    for (let i = 0; i < 50; i++) sync.mark({ guildId: "g1", memberId: "m1", what: "nickname" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.find).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it("a burst of 50 different members is limited to 10 syncs per 10 seconds", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `u${i + 1}`);
    const w = world({ ids });
    const sync = createMemberSync({ prisma: w.prisma as never, getGuild: () => w.guild as never });
    for (let i = 1; i <= 50; i++) sync.mark({ guildId: "g1", memberId: `m${i}`, what: "nickname" });
    await vi.advanceTimersByTimeAsync(5500);
    expect(w.find).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.find).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w.find).toHaveBeenCalledTimes(50);
    sync.stop();
  });

  it("the queue is capped: the rest is left to the hourly pass", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `u${i + 1}`);
    const w = world({ ids });
    const sync = createMemberSync({ prisma: w.prisma as never, getGuild: () => w.guild as never, queueMax: 12 });
    for (let i = 1; i <= 30; i++) sync.mark({ guildId: "g1", memberId: `m${i}`, what: "nickname" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(w.find.mock.calls.length).toBeLessThan(30);
    expect(sync.stats().dropped).toBeGreaterThan(0);
    sync.stop();
  });

  it("does nothing for a server the pilot gate refuses", async () => {
    const w = world();
    const sync = createMemberSync({ prisma: w.prisma as never, getGuild: () => w.guild as never, allows: () => false });
    sync.mark({ guildId: "g1", memberId: "m1" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.find).not.toHaveBeenCalled();
    sync.stop();
  });

  it("our own rename does not start another refresh; someone else's change does", () => {
    const mark = vi.fn();
    const base = { guild: { id: "d1" }, id: "u1", user: { bot: false }, roles: { cache: new Map() } };
    noteOwnNickname("d1", "u1", "Nameu1 (Hero0)");
    handleMemberUpdated({ mark }, { ...base, partial: false, nickname: null } as never, { ...base, nickname: "Nameu1 (Hero0)" } as never);
    expect(mark).not.toHaveBeenCalled();
    handleMemberUpdated({ mark }, { ...base, partial: false, nickname: "Nameu1 (Hero0)" } as never, { ...base, nickname: "Bob" } as never);
    expect(mark).toHaveBeenCalledWith({ discordGuildId: "d1", discordUserId: "u1", what: "nickname" });
  });

  it("a role change asks for the rank role, a join for both, a bot for nothing", () => {
    const mark = vi.fn();
    const base = { guild: { id: "d1" }, id: "u1", user: { bot: false } };
    handleMemberUpdated({ mark }, { ...base, partial: false, nickname: null, roles: { cache: new Map() } } as never, { ...base, nickname: null, roles: { cache: new Map([["r", {}]]) } } as never);
    expect(mark).toHaveBeenCalledWith({ discordGuildId: "d1", discordUserId: "u1", what: "rank" });
    mark.mockClear();
    handleMemberJoined({ mark }, { ...base } as never);
    expect(mark).toHaveBeenCalledWith({ discordGuildId: "d1", discordUserId: "u1" });
    mark.mockClear();
    handleMemberJoined({ mark }, { ...base, user: { bot: true } } as never);
    expect(mark).not.toHaveBeenCalled();
  });

  it("skips the server owner and a member above the bot's role", async () => {
    const owner = world({ ownerId: "u1" });
    await syncMemberNickname(owner.prisma as never, owner.guild as never, "u1");
    expect(owner.members.get("u1")!.setNickname).not.toHaveBeenCalled();
    const high = world({ manageable: false });
    const result = await syncMemberNickname(high.prisma as never, high.guild as never, "u1");
    expect(high.members.get("u1")!.setNickname).not.toHaveBeenCalled();
    expect(result.stats.notManageable).toBe(1);
  });

  it("does nothing when the sync is off or the bot lacks Manage Nicknames", async () => {
    const off = world({ settings: { nicknameSyncEnabled: false, rankRolesEnabled: true } });
    expect((await syncMemberNickname(off.prisma as never, off.guild as never, "u1")).skipped).toMatch(/off/);
    expect(off.find).not.toHaveBeenCalled();
    const noPerm = world({ canRename: false });
    expect((await syncMemberNickname(noPerm.prisma as never, noPerm.guild as never, "u1")).skipped).toMatch(/Manage Nicknames/);
    expect(noPerm.find).not.toHaveBeenCalled();
  });

  it("a rank change gives that member the mapped role, and nothing when already right", async () => {
    const w = world();
    const sync = createMemberSync({ prisma: w.prisma as never, getGuild: () => w.guild as never });
    sync.mark({ guildId: "g1", memberId: "m1", what: "rank" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.members.get("u1")!.roles.add).toHaveBeenCalledWith(["role1"], expect.any(String));
    expect(w.members.get("u1")!.setNickname).not.toHaveBeenCalled();
    sync.stop();
    w.members.get("u1")!.roles.add.mockClear();
    w.members.get("u1")!.roles.cache.set("role1", {});
    await syncMemberRankRole(w.prisma as never, w.guild as never, "u1");
    expect(w.members.get("u1")!.roles.add).not.toHaveBeenCalled();
  });

  it("markMemberChanged reaches the listener and never throws", () => {
    const seen = vi.fn();
    const off = onMemberChanged(seen);
    const bad = onMemberChanged(() => { throw new Error("boom"); });
    markMemberChanged({ guildId: "g1", memberId: "m1" });
    expect(seen).toHaveBeenCalledWith({ guildId: "g1", memberId: "m1" });
    off(); bad();
    markMemberChanged({ guildId: "g1", memberId: "m1" });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
