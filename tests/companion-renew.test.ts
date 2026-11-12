import { describe, expect, it } from "vitest";
import { renewCompanionCredential } from "../src/services/companion-renew.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";

describe("retry-safe device credential renewal", () => {
  function database() {
    const row = { tokenHash: hashCompanionSecret("a".repeat(43)), previousTokenHash: "", previousValidUntil: new Date(0), revokedAt: null as Date | null };
    const store = {
      updateMany: async ({ where, data }: { where: { tokenHash: string }; data: Partial<typeof row> }) => {
        if (row.revokedAt || row.tokenHash !== where.tokenHash) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
      findFirst: async ({ where }: { where: { tokenHash: string; previousTokenHash: string; previousValidUntil: { gt: Date } } }) => !row.revokedAt && row.tokenHash === where.tokenHash && row.previousTokenHash === where.previousTokenHash && row.previousValidUntil > where.previousValidUntil.gt ? { id: "device" } : null
    };
    const tx = { companionCredential: store, webCompanionCredential: { updateMany: async () => ({ count: 0 }), findFirst: async () => null } };
    return { row, db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
  }
  it("recovers a lost response with the same proposal and rejects changing that proposal", async () => {
    const { row, db } = database();
    const at = new Date("2026-11-04T00:00:00Z");
    expect(await renewCompanionCredential(db as never, "a".repeat(43), "b".repeat(43), at)).toBe(true);
    expect(row.tokenHash).toBe(hashCompanionSecret("b".repeat(43)));
    expect(await renewCompanionCredential(db as never, "a".repeat(43), "b".repeat(43), at)).toBe(true);
    expect(await renewCompanionCredential(db as never, "a".repeat(43), "c".repeat(43), at)).toBe(false);
    expect(await renewCompanionCredential(db as never, "a".repeat(43), "b".repeat(43), new Date(at.getTime() + 86_400_000))).toBe(false);
    row.revokedAt = at;
    expect(await renewCompanionCredential(db as never, "b".repeat(43), "c".repeat(43), at)).toBe(false);
  });
});
