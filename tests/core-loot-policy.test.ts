import { describe, expect, it, vi } from "vitest";
import { requireCorePool } from "../src/services/core-loot-policy.js";
import { createEpgpService } from "../src/services/epgp.js";
import { createRaidCoreService } from "../src/services/raid-core.js";
import { createItemValueService, applyAddonItemPrices } from "../src/services/item-values.js";
import { applyAddonLoot } from "../src/services/raid-import.js";
import { createLootService } from "../src/services/loot.js";

const policy = (enabled = true) => ({ guildSettings: { findUnique: vi.fn().mockResolvedValue({ coreLootOnly: enabled, lootMode: "COUNCIL" }) },
  raidCore: { findFirst: vi.fn().mockResolvedValue(null) } });

describe("loot belongs to each core", () => {
  it("rejects missing or foreign cores and shared pools, while legacy guilds retain their behavior", async () => {
    const database = policy();
    await expect(requireCorePool(database as never, "g", null)).rejects.toThrow(/Choisis un core/);
    await expect(requireCorePool(database as never, "g", "foreign")).rejects.toThrow(/Choisis un core/);
    expect(database.raidCore.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", guildId: "g", separatePool: true }, select: { id: true } });
    database.raidCore.findFirst.mockResolvedValue({ id: "a" } as never);
    await requireCorePool(database as never, "g", "a");
    await requireCorePool(policy(false) as never, "g", null);
  });
  it("creates each new core with an explicit method and its own pool", async () => {
    const create = vi.fn().mockImplementation(({ data }) => data);
    const core = await createRaidCoreService({ ...policy(), raidCore: { findFirst: async () => null, create } } as never).create("g", "Alpha");
    expect(core).toMatchObject({ guildId: "g", name: "Alpha", lootMode: "COUNCIL", separatePool: true });
  });
  it("blocks new global EP while retaining corrections to historical global entries", async () => {
    const create = vi.fn().mockImplementation(({ data }) => data);
    const service = createEpgpService({ ...policy(), epgpTransaction: { create } } as never);
    const input = { guildId: "g", memberId: "m", reason: "Correction", createdBy: "officer", epAmount: 10 };
    await expect(service.createTransaction({ ...input, type: "EP_AWARD" })).rejects.toThrow(/Choisis un core/);
    expect(create).not.toHaveBeenCalled();
    expect(await service.createTransaction({ ...input, type: "REVERSAL", epAmount: -10 })).toMatchObject({ coreId: null, epAmount: -10 });
  });
  it("never falls back to guild or other core item prices", async () => {
    const rows = [{ coreId: "", itemKey: "helm", itemName: "Helm", gp: 999, itemId: null },
      { coreId: "a", itemKey: "helm", itemName: "Helm", gp: 100, itemId: null },
      { coreId: "b", itemKey: "helm", itemName: "Helm", gp: 200, itemId: null }];
    const upsert = vi.fn();
    const service = createItemValueService({ ...policy(), coreItemValue: { upsert, findMany: async ({ where }: { where: { coreId: { in: string[] } } }) => rows.filter(row => where.coreId.in.includes(row.coreId)) } } as never);
    expect(await service.priceOf("g", "a", { name: "Helm" })).toBe(100);
    expect(await service.priceOf("g", "b", { name: "Helm" })).toBe(200);
    expect(await service.priceOf("g", null, { name: "Helm" })).toBeNull();
    expect(await service.effective("g", null)).toEqual([]);
    await expect(service.setMany("g", null, [{ name: "Helm", id: null, gp: 5 }])).rejects.toThrow(/Choisis un core/);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("blocks unscoped council awards even when charging zero GP", async () => {
    const create = vi.fn();
    const tx = { ...policy(), member: { findUnique: async () => ({ guildId: "g" }) }, lootAward: { create } };
    const service = createLootService({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never);
    await expect(service.awardDirect({ guildId: "g", memberId: "m", itemName: "Helm", gp: 0, awardedBy: "officer" })).rejects.toThrow(/Choisis un core/);
    expect(create).not.toHaveBeenCalled();
  });
  it("requires addon loot to match a core raid, while preserving already imported history", async () => {
    const create = vi.fn().mockResolvedValue({ id: "award" });
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = { lootAward: { create, findMany }, raid: { findFirst: vi.fn().mockResolvedValue({ id: "raid" }) } };
    const row = { ref: "loot-ref", character: "Ann", realm: "Test", item: "Helm", gp: 0 };
    const players = [{ id: "char", name: "Ann", realm: "Test", memberId: "m" }];
    await expect(applyAddonLoot(tx as never, "g", [row], players, new Map(), "officer", true)).rejects.toThrow(/Choisis un core/);
    expect(create).not.toHaveBeenCalled();
    await applyAddonLoot(tx as never, "g", [{ ...row, raidRef: "game-raid" }], players, new Map([["game-raid", "raid"]]), "officer", true);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ raidId: "raid" }) });
    findMany.mockResolvedValue([{ sourceRef: row.ref }]);
    expect(await applyAddonLoot(tx as never, "g", [row], players, new Map(), "officer", true)).toMatchObject({ skipped: 1, recorded: 0 });
  });
  it("refuses new addon prices without a core but leaves old imported prices alone", async () => {
    const upsert = vi.fn();
    const findUnique = vi.fn().mockResolvedValue(null);
    const database = { raidCore: { findMany: vi.fn().mockResolvedValue([{ id: "a" }]) }, coreItemValue: { upsert, findUnique } };
    const price = { name: "Helm", gp: 100, at: new Date("2026-10-01") };
    await expect(applyAddonItemPrices(database as never, "g", [price], true)).rejects.toThrow(/Choisis un core/);
    await expect(applyAddonItemPrices(database as never, "g", [{ ...price, coreId: "foreign" }], true)).rejects.toThrow(/Choisis un core/);
    expect(upsert).not.toHaveBeenCalled();
    findUnique.mockResolvedValue({ updatedAt: new Date("2026-10-02") });
    expect(await applyAddonItemPrices(database as never, "g", [price], true)).toBe(0);
  });
});
