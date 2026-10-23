import { describe, expect, it, vi } from "vitest";
import { EpgpTransactionType } from "@prisma/client";
import { createEpgpService } from "../src/services/epgp.js";

const original = { id: "t1", guildId: "g1", memberId: "m1", epAmount: 50, gpAmount: 0, type: EpgpTransactionType.EP_AWARD };

function database(existingReversal: unknown = null, row: unknown = original) {
  return {
    epgpTransaction: {
      findUnique: vi.fn().mockResolvedValue(row),
      findFirst: vi.fn().mockResolvedValue(existingReversal),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: "t2", ...data }))
    }
  };
}

describe("EPGP reversal", () => {
  it("adds an opposite entry linked to the original", async () => {
    const db = database();
    const reversal = await createEpgpService(db as never).reverseTransaction("t1", "officer", "Reversal: wrong player", "g1");
    expect(reversal).toMatchObject({ epAmount: -50, gpAmount: 0, type: EpgpTransactionType.REVERSAL, sourceRef: "reversal:t1" });
  });

  it("refuses to reverse the same entry twice", async () => {
    await expect(createEpgpService(database({ id: "t2" }) as never).reverseTransaction("t1", "o", "Reversal: x", "g1"))
      .rejects.toThrow("already been reversed");
  });

  it("refuses entries from another guild", async () => {
    await expect(createEpgpService(database() as never).reverseTransaction("t1", "o", "Reversal: x", "other-guild"))
      .rejects.toThrow("not found");
  });

  it("refuses to reverse a reversal", async () => {
    const db = database(null, { ...original, type: EpgpTransactionType.REVERSAL });
    await expect(createEpgpService(db as never).reverseTransaction("t1", "o", "Reversal: x", "g1")).rejects.toThrow("already a reversal");
  });
});

import { priority } from "../src/services/epgp.js";

describe("PR with base GP", () => {
  it("adds base GP to the denominator", () => {
    expect(priority(100, 0, 0)).toBe(0);
    expect(priority(100, 0, 100)).toBe(1);
    expect(priority(100, 1, 0)).toBe(100);
    expect(priority(100, 1, 99)).toBe(1);
    expect(priority(100, 50, -5)).toBe(2);
  });
});
