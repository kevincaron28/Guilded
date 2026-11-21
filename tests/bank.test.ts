import { describe, expect, it, vi } from "vitest";
import { createBankService } from "../src/services/bank.js";

describe("guild bank requests", () => {
  it("creates a trimmed request and caps open requests per member", async () => {
    const create = vi.fn().mockImplementation(async ({ data }) => data);
    const service = createBankService({ bankRequest: { count: vi.fn().mockResolvedValue(0), create } } as never);
    await expect(service.request("g1", "m1", "  Major Healing Potion ", 5, " for MC ")).resolves.toMatchObject({
      item: "Major Healing Potion", quantity: 5, note: "for MC"
    });
    const full = createBankService({ bankRequest: { count: vi.fn().mockResolvedValue(10), create } } as never);
    await expect(full.request("g1", "m1", "Flask", 1)).rejects.toThrow("10 open requests");
  });

  it("only allows forward transitions", async () => {
    const update = vi.fn().mockImplementation(async ({ data }) => ({ ...data, member: {} }));
    const pending = createBankService({ bankRequest: { findFirst: vi.fn().mockResolvedValue({ id: "r1", status: "PENDING" }), update } } as never);
    await expect(pending.setStatus("g1", "r1", "FULFILLED", "officer", "sent by mail")).resolves.toMatchObject({ status: "FULFILLED", reply: "sent by mail" });
    const done = createBankService({ bankRequest: { findFirst: vi.fn().mockResolvedValue({ id: "r1", status: "FULFILLED" }), update } } as never);
    await expect(done.setStatus("g1", "r1", "DENIED", "officer")).rejects.toThrow("can't be marked denied");
  });

  it("lets a member cancel only their own open request", async () => {
    const service = createBankService({ bankRequest: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } } as never);
    await expect(service.cancel("g1", "m2", "r1")).rejects.toThrow("no request with that ID");
  });
});
