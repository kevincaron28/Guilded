import { describe, expect, it } from "vitest";
import { isTransientTransactionStart, retryTransientTransaction, retryWriteConflict, serializeByKey, SHORT_TRANSACTION } from "../src/services/transaction-retry.js";

describe("transient transaction starts", () => {
  it("retries a pool start failure with bounded backoff and then succeeds", async () => {
    const sleeps: number[] = [];
    const start = { code: "P2028", message: "Transaction API error: Unable to start a transaction in the given time." };
    let tries = 0;
    const value = await retryTransientTransaction(async () => {
      tries += 1;
      if (tries < 3) throw start;
      return "ok";
    }, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(value).toBe("ok");
    expect(tries).toBe(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("does not retry a transaction that already started, or a member's answer", async () => {
    let tries = 0;
    const expired = Object.assign(new Error("Transaction already closed: A query cannot be executed on an expired transaction."), { code: "P2028" });
    await expect(retryTransientTransaction(async () => { tries += 1; throw expired; }, { sleep: async () => undefined })).rejects.toThrow(/already closed/);
    await expect(retryTransientTransaction(async () => { tries += 1; throw new Error("Saison terminée / Season ended."); }, { sleep: async () => undefined })).rejects.toThrow(/Season ended/);
    expect(tries).toBe(2);
  });

  it("recognizes pool acquisition timeouts and the recorded start message", () => {
    expect(isTransientTransactionStart({ code: "P2024", message: "Timed out fetching a new connection from the connection pool." })).toBe(true);
    expect(isTransientTransactionStart(new Error("Transaction API error: Unable to start a transaction in the given time."))).toBe(true);
    expect(isTransientTransactionStart(new Error("Event board changed during preflight"))).toBe(false);
  });

  it("keeps short transactions inside the short budget, above the 3s busy-pool check", () => {
    expect(SHORT_TRANSACTION.maxWait).toBeGreaterThan(3_000);
    expect(SHORT_TRANSACTION.timeout).toBeLessThanOrEqual(15_000);
    expect(SHORT_TRANSACTION.maxWait + SHORT_TRANSACTION.timeout).toBeLessThan(30_000);
  });
});

describe("write conflicts (P2034, 9 Nov 2026)", () => {
  it("retries a write conflict with jittered backoff and then succeeds", async () => {
    const sleeps: number[] = [];
    let tries = 0;
    const value = await retryWriteConflict(async () => { tries += 1; if (tries < 3) throw { code: "P2034", message: "Transaction failed due to a write conflict or a deadlock." }; return "ok"; },
      { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
    expect(value).toBe("ok");
    expect(sleeps).toEqual([150, 300]);
  });
  it("gives up when the time budget would be passed, and never retries other errors", async () => {
    let clock = 0;
    let tries = 0;
    await expect(retryWriteConflict(async () => { tries += 1; throw { code: "P2034" }; }, { budgetMs: 200, now: () => clock, sleep: async (ms) => { clock += ms; }, random: () => 0.5 })).rejects.toMatchObject({ code: "P2034" });
    expect(tries).toBe(2);
    let other = 0;
    await expect(retryWriteConflict(async () => { other += 1; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(other).toBe(1);
  });
  it("runs work for one key one at a time and survives a failure", async () => {
    const order: string[] = [];
    const slow = serializeByKey("g", async () => { order.push("a-start"); await new Promise((r) => setTimeout(r, 20)); order.push("a-end"); throw new Error("a failed"); });
    const fast = serializeByKey("g", async () => { order.push("b"); return "b"; });
    await expect(slow).rejects.toThrow("a failed");
    await expect(fast).resolves.toBe("b");
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });
});
