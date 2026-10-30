import { expect, it, vi } from "vitest";
import { queueExpiredPolls } from "../src/services/poll-expiry.js";

it("closes due polls and durably queues their message refresh in the same transaction", async () => {
  const upsert = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  const tx = { poll: { updateMany }, discordJob: { upsert } };
  const db = { poll: { findMany: vi.fn().mockResolvedValue([{ id: "p", guildId: "g" }]) },
    $transaction: vi.fn(async (run: (value: typeof tx) => Promise<void>) => run(tx)) };
  const now = new Date("2026-10-30T18:00:00Z");
  await queueExpiredPolls(db as never, now);
  expect(updateMany).toHaveBeenCalledWith({ where: { id: "p", guildId: "g", closed: false, closesAt: { lte: now } }, data: { closed: true } });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { guildId: "g", key: "poll-expiry:p", kind: "POLL_REFRESH", payload: { pollId: "p" } } }));
  await queueExpiredPolls(db as never, now);
  expect(upsert).toHaveBeenCalledOnce();
});

it("propagates queue failures so the transaction can roll back closure", async () => {
  const tx = { poll: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    discordJob: { upsert: vi.fn().mockRejectedValue(new Error("queue unavailable")) } };
  const db = { poll: { findMany: vi.fn().mockResolvedValue([{ id: "p", guildId: "g" }]) },
    $transaction: vi.fn(async (run: (value: typeof tx) => Promise<void>) => run(tx)) };
  await expect(queueExpiredPolls(db as never)).rejects.toThrow("queue unavailable");
});
