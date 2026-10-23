import { describe, expect, it, vi } from "vitest";
import { EpgpTransactionType, ReadinessFindingSeverity, ReadinessStatus } from "@prisma/client";
import { createEpgpService } from "../src/services/epgp.js";
import { deriveReadinessStatus } from "../src/services/readiness.js";

describe("EPGP service", () => {
  it("calculates PR from EP and GP", async () => {
    const database = {
      epgpTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { epAmount: 250, gpAmount: 100 } })
      }
    } as never;
    await expect(createEpgpService(database).getStanding("member")).resolves.toEqual({
      ep: 250,
      gp: 100,
      pr: 2.5
    });
  });

  it("rejects an empty ledger entry", async () => {
    const database = { epgpTransaction: { create: vi.fn() } } as never;
    await expect(createEpgpService(database).createTransaction({
      guildId: "guild",
      memberId: "member",
      type: EpgpTransactionType.ADJUSTMENT,
      reason: "none",
      createdBy: "officer"
    })).rejects.toThrow("must change");
  });
});

describe("readiness status", () => {
  it("is not ready when an error finding exists", () => {
    expect(deriveReadinessStatus([
      { code: "missing-enchant", severity: ReadinessFindingSeverity.ERROR, message: "Missing enchant" }
    ])).toBe(ReadinessStatus.NOT_READY);
  });

  it("is ready when there are no warnings or errors", () => {
    expect(deriveReadinessStatus([])).toBe(ReadinessStatus.READY);
  });
});
