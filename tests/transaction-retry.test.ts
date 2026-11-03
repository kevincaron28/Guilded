import { describe, expect, it } from "vitest";
import { EVENT_TRANSACTION_OPTIONS } from "../src/services/game-events.js";
import { isTransientTransactionStart, retryTransientTransaction, SHORT_TRANSACTION } from "../src/services/transaction-retry.js";

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

  it("keeps event transactions inside the short budget, above the 3s busy-pool check", () => {
    expect(EVENT_TRANSACTION_OPTIONS).toEqual(SHORT_TRANSACTION);
    expect(SHORT_TRANSACTION.maxWait).toBeGreaterThan(3_000);
    expect(SHORT_TRANSACTION.timeout).toBeLessThanOrEqual(15_000);
    expect(SHORT_TRANSACTION.maxWait + SHORT_TRANSACTION.timeout).toBeLessThan(30_000);
  });
});
