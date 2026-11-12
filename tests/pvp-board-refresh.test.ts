import { describe, expect, it, vi } from "vitest";
import { PVP_REFRESH_DELAY_MS, scheduleBgLadderRefresh } from "../src/services/pvp-board-refresh.js";

const NOW = new Date("2026-11-12T12:00:00Z");

function fake(settings: Record<string, unknown> | null, job: { status: string; nextAttemptAt: Date } | null) {
  const upsert = vi.fn(async () => ({ id: "j1" }));
  const update = vi.fn(async () => ({}));
  const db = {
    guildSettings: { findUnique: vi.fn(async () => settings) },
    discordJob: { findUnique: vi.fn(async () => job), upsert, update }
  };
  return { db: db as never, upsert, update };
}
const on = { bgLadderEnabled: true, bgStatsChannelId: "c1", worldPvpEnabled: true };

describe("scheduleBgLadderRefresh", () => {
  it("queues the ladder refresh two minutes out", async () => {
    const { db, upsert, update } = fake(on, null);
    expect(await scheduleBgLadderRefresh(db, "g1", NOW)).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0] as unknown as [{ data: { nextAttemptAt: Date } }];
    expect(call[0].data.nextAttemptAt.getTime()).toBe(NOW.getTime() + PVP_REFRESH_DELAY_MS);
  });
  it("shares one refresh between a burst of uploads", async () => {
    const { db, upsert } = fake(on, { status: "PENDING", nextAttemptAt: new Date(NOW.getTime() + 60_000) });
    expect(await scheduleBgLadderRefresh(db, "g1", NOW)).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("does nothing without the ladder channel or with the world PvP panel off", async () => {
    for (const settings of [null, { ...on, bgLadderEnabled: false }, { ...on, bgStatsChannelId: null }, { ...on, worldPvpEnabled: false }]) {
      const { db, upsert } = fake(settings, null);
      expect(await scheduleBgLadderRefresh(db, "g1", NOW)).toBe(false);
      expect(upsert).not.toHaveBeenCalled();
    }
  });
  it("never throws", async () => {
    const db = { guildSettings: { findUnique: vi.fn(async () => { throw new Error("down"); }) }, discordJob: {} } as never;
    expect(await scheduleBgLadderRefresh(db, "g1", NOW)).toBe(false);
  });
});
