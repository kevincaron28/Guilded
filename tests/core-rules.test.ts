import { describe, expect, it, vi } from "vitest";
import { describeRules, effectiveRules, poolFor } from "../src/services/core-rules.js";
import { createEpgpService } from "../src/services/epgp.js";
import { applyRaidEpProposal, computeRaidEpProposal } from "../src/services/ep-award.js";
import { createLootService } from "../src/services/loot.js";

const guild = { attendanceDkp: 10, lateAttendanceDkp: 5, bossKillDkp: 5, epCompletionBonus: 10, baseGp: 100, epgpDecayPercent: 0.1, lootMode: "EPGP" };

describe("core point rules", () => {
  it("every core follows the guild unless it overrides a value", () => {
    const plain = effectiveRules(guild, { attendanceEp: null, lateEp: null, bossEp: null, completionEp: null, baseGp: null, decayPercent: null, lootMode: null, separatePool: false });
    expect(plain).toMatchObject({ attendanceEp: 10, lateEp: 5, bossEp: 5, completionEp: 10, baseGp: 100, decayPercent: 0.1, lootMode: "EPGP", separatePool: false, overridden: [] });
    expect(effectiveRules(guild, null).overridden).toEqual([]);
  });

  it("an override wins, including 0, and is reported", () => {
    const rules = effectiveRules(guild, { attendanceEp: 20, bossEp: 0, decayPercent: 0.25, lootMode: "COUNCIL", separatePool: true });
    expect(rules).toMatchObject({ attendanceEp: 20, lateEp: 5, bossEp: 0, decayPercent: 0.25, lootMode: "COUNCIL", separatePool: true });
    expect(rules.overridden).toEqual(["attendance EP", "boss EP", "decay", "loot mode", "separate pool"]);
    const text = describeRules(rules, "Alpha");
    expect(text).toContain("5 differ from the guild");
    expect(text).toContain("Per boss 0 EP (core)");
    expect(text).toContain("own point pool");
  });

  it("picks a pool only for a core that keeps its own points", () => {
    expect(poolFor({ id: "c1", separatePool: true })).toBe("c1");
    expect(poolFor({ id: "c1", separatePool: false })).toBeNull();
    expect(poolFor(null)).toBeNull();
  });
});

describe("point pools", () => {
  it("reads standings from one pool, and the guild pool by default", async () => {
    const aggregate = vi.fn(async () => ({ _sum: { epAmount: 50, gpAmount: 25 } }));
    const service = createEpgpService({ epgpTransaction: { aggregate } } as never);
    await service.getStanding("m1", 0);
    await service.getStanding("m1", 0, "core1");
    expect(aggregate.mock.calls.map((call) => (call as unknown as [{ where: unknown }])[0].where)).toEqual([{ memberId: "m1", coreId: null }, { memberId: "m1", coreId: "core1" }]);
  });

  it("raid EP goes to the core's pool only when the core keeps its own points", async () => {
    const created: { coreId: string | null }[] = [];
    const database = (separatePool: boolean) => ({
      raid: { findFirst: vi.fn().mockResolvedValue({
        id: "r1", title: "MC", bosses: [], core: { id: "core1", name: "Alpha", attendanceEp: null, lateEp: null, bossEp: null, completionEp: null, baseGp: null, decayPercent: null, lootMode: null, separatePool },
        attendance: [{ memberId: "m1", status: "PRESENT", member: { displayName: "Kev" } }]
      }) },
      guildSettings: { findUnique: vi.fn().mockResolvedValue(guild) },
      epgpTransaction: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(async ({ data }) => { created.push(data); return data; }) }
    });
    expect((await computeRaidEpProposal(database(true) as never, "g", "r1")).poolCoreId).toBe("core1");
    await applyRaidEpProposal(database(true) as never, "g", "r1", "o");
    await applyRaidEpProposal(database(false) as never, "g", "r1", "o");
    expect(created.map((row) => row.coreId)).toEqual(["core1", null]);
  });

  it("an auction for a raid of a separate-pool core charges GP to that pool", async () => {
    const created: Record<string, unknown>[] = [];
    const tx = {
      auction: { findUnique: async () => ({ id: "a1", guildId: "g", itemName: "Helm", raidId: "r1", bossName: null, status: "ACTIVE", bids: [{ memberId: "m1", amount: 30 }] }), updateMany: async () => ({ count: 1 }) },
      raid: { findFirst: async () => ({ core: { id: "core1", separatePool: true } }) },
      epgpTransaction: { aggregate: vi.fn(async () => ({ _sum: { epAmount: 0, gpAmount: 0 } })), create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } },
      lootAward: { create: async ({ data }: { data: Record<string, unknown> }) => ({ ...data, member: { displayName: "Kev" } }) }
    };
    await createLootService({ $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never).closeAuction("a1", "o");
    expect(created[0]).toMatchObject({ gpAmount: 30, coreId: "core1" });
    expect((tx.epgpTransaction.aggregate.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ memberId: "m1", coreId: "core1" });
  });
});
