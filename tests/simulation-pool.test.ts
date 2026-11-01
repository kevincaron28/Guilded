import { expect, it, vi } from "vitest";
import { ensureSimulationPool } from "../src/services/simulation.js";

function fixture(raid: { id: string; coreId: string | null } | null) {
  const tx = { raid: { findFirst: vi.fn(async () => raid), update: vi.fn() },
    raidCore: { upsert: vi.fn(async ({ create }: { create: object }) => create) } };
  const db = { $transaction: vi.fn(async (run: (value: typeof tx) => Promise<string>) => run(tx)) };
  return { tx, db };
}
it("gives a test raid an isolated deterministic pool without creating Discord roles or channels", async () => {
  const { tx, db } = fixture({ id: "r", coreId: null });
  expect(await ensureSimulationPool(db as never, "g", "r", "Realm")).toBe("sim-core:r");
  expect(tx.raid.findFirst).toHaveBeenCalledWith({ where: { id: "r", guildId: "g", isTest: true } });
  expect(tx.raidCore.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ guildId: "g", realm: "Realm", separatePool: true }) }));
  expect(tx.raid.update).toHaveBeenCalledWith({ where: { id: "r" }, data: { coreId: "sim-core:r" } });
});
it("refuses real/missing raids and never repurposes an attached real core", async () => {
  for (const raid of [null, { id: "r", coreId: "real-core" }]) {
    const { tx, db } = fixture(raid);
    await expect(ensureSimulationPool(db as never, "g", "r", "Realm")).rejects.toThrow();
    expect(tx.raidCore.upsert).not.toHaveBeenCalled(); expect(tx.raid.update).not.toHaveBeenCalled();
  }
});
it("rejects a changed pool identity before attaching it", async () => {
  const { tx, db } = fixture({ id: "r", coreId: null });
  tx.raidCore.upsert.mockResolvedValue({ guildId: "other", separatePool: true });
  await expect(ensureSimulationPool(db as never, "g", "r", "Realm")).rejects.toThrow("identity changed");
  expect(tx.raid.update).not.toHaveBeenCalled();
});
