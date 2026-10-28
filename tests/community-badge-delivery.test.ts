import { beforeEach, expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ check: vi.fn(), audience: vi.fn() }));
vi.mock("../src/services/community-access.js", () => ({ communityAccess: access.check, assertCommunityChannelAudience: access.audience }));
import { deliverCommunityBadges } from "../src/services/community-badge-delivery.js";

const now = new Date("2026-10-27T12:00:00Z");
function fixture() {
  const season = { id: "season", guildId: "guild", status: "ACTIVE", channelId: "source", audienceRoleId: null as string | null, badgeConfig: { enabled: true, channelId: "destination" } };
  const rows = ["A", "B"].map(id => ({ id, userId: id, seasonId: "season", code: "community-100", delivery: "PENDING", nextAttemptAt: now, season }));
  const send = vi.fn(async () => ({ id: "message-B" }));
  const channel = { isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send };
  const guild = { members: { me: {} }, channels: { fetch: vi.fn(async () => channel) } };
  const tx = {
    $executeRaw: vi.fn(),
    communityBadge: {
      findMany: vi.fn(async ({ where }) => rows.filter(row => row.delivery === "PENDING" && row.nextAttemptAt <= where.nextAttemptAt.lte)),
      findFirst: vi.fn(async ({ where }) => rows.find(row => row.id === where.id && row.delivery === where.delivery)),
      updateMany: vi.fn(async ({ where, data }) => { const row = rows.find(row => row.id === where.id && row.delivery === where.delivery); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; })
    },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "en" })) },
    communityPoint: { aggregate: vi.fn(async () => ({ _sum: { amount: 100 } })) }
  };
  const db = { ...tx, $transaction: async (work: (value: typeof tx) => unknown) => work(tx) };
  return { rows, send, guild, db };
}
beforeEach(() => { access.check.mockReset(); access.audience.mockReset(); access.audience.mockResolvedValue(undefined); });

it.each([Object.assign(new Error("Unknown member"), { code: 10007 }), new Error("Accès refusé / Access denied.")])("retires an ineligible oldest post and still delivers the next member", async error => {
  const f = fixture();
  access.check.mockImplementation(async (_guild, userId) => { if (userId === "A") throw error; return { displayName: "Member B" }; });
  await deliverCommunityBadges(f.guild as never, f.db as never, "guild", now);
  expect(f.rows.map(row => row.delivery)).toEqual(["CANCELLED", "SENT"]);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0]).toBeDefined();
  await deliverCommunityBadges(f.guild as never, f.db as never, "guild", new Date(+now + 600_000));
  expect(f.send).toHaveBeenCalledTimes(1);
});

it("delays a transient preflight failure without starving later members", async () => {
  const f = fixture();
  access.check.mockImplementation(async (_guild, userId) => { if (userId === "A") throw new Error("temporary network failure"); return { displayName: "Member B" }; });
  await expect(deliverCommunityBadges(f.guild as never, f.db as never, "guild", now)).rejects.toThrow("pending records delayed");
  expect(f.rows.map(row => row.delivery)).toEqual(["PENDING", "SENT"]);
  expect(f.rows[0]!.nextAttemptAt).toEqual(new Date(+now + 300_000));
  await deliverCommunityBadges(f.guild as never, f.db as never, "guild", new Date(+now + 60_000));
  expect(f.send).toHaveBeenCalledTimes(1);
  access.check.mockResolvedValue({ displayName: "Member A" });
  await deliverCommunityBadges(f.guild as never, f.db as never, "guild", new Date(+now + 300_000));
  expect(f.rows.map(row => row.delivery)).toEqual(["SENT", "SENT"]);
  expect(f.send).toHaveBeenCalledTimes(2);
});

it("never sends into a changed or broader audience", async () => {
  const f = fixture();
  access.audience.mockRejectedValue(new Error("Audience mismatch"));
  await expect(deliverCommunityBadges(f.guild as never, f.db as never, "guild", now)).rejects.toThrow();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.rows.every(row => row.delivery === "PENDING" && +row.nextAttemptAt > +now)).toBe(true);
});

it("cancels role-restricted seasons even when the public source and destination are identical", async () => {
  const f = fixture();
  f.rows[0]!.season.audienceRoleId = "R";
  f.rows[0]!.season.channelId = "destination";
  // An R member could pass communityAccess while non-R members read this channel.
  access.check.mockResolvedValue({ displayName: "Member with R" });
  await deliverCommunityBadges(f.guild as never, f.db as never, "guild", now);
  expect(f.send).not.toHaveBeenCalled();
  expect(access.check).not.toHaveBeenCalled();
  expect(f.rows.map(row => row.delivery)).toEqual(["CANCELLED", "CANCELLED"]);
});
