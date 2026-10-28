import { describe, expect, it, vi } from "vitest";
import { freezeSeasonRules } from "../src/services/official-seasons.js";
import { publicRules, snapshotRules } from "../src/services/public-score.js";

const now = new Date("2030-01-01T00:00:00Z");
const row = { id: "season", name: "Season", rules: null as unknown };
const frozen = { ...row, rules: snapshotRules(publicRules(), now) };
function database(initial: typeof row | null, locked = initial) {
  const update = vi.fn(async () => locked);
  const tx = { officialSeason: { findFirst: vi.fn(async () => locked), update }, $executeRaw: vi.fn(async () => 1) };
  const transaction = vi.fn(async (action: (value: typeof tx) => Promise<unknown>) => action(tx));
  return { db: { officialSeason: { findFirst: vi.fn(async () => initial) }, $transaction: transaction }, tx, transaction, update };
}

describe("public season freeze scheduling", () => {
  it.each([null, frozen, { ...row, rules: { unreadable: true } }])("does not acquire an exclusive lock for a no-op", async initial => {
    const { db, transaction } = database(initial);
    expect(await freezeSeasonRules(db as never, now)).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rechecks inside the lock when another worker already froze the season", async () => {
    const { db, tx, update } = database(row, frozen);
    expect(await freezeSeasonRules(db as never, now)).toBeNull();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("bounds lock waits and execution without scanning guild cutoffs for a rules-only change", async () => {
    const { db, transaction, update } = database(row);
    expect(await freezeSeasonRules(db as never, now)).toMatchObject({ frozen: true, season: "Season" });
    expect(update).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 30_000, timeout: 30_000 });
  });
});
