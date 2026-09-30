import { describe, expect, it, vi } from "vitest";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { relayProfessions } from "../src/services/profession-relay.js";

describe("profession-only officer relay", () => {
  it("updates skills while leaving an included ledger pending for review", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      character: { findMany: async () => [{ id: "c", name: "Ray", realm: "R" }], findUnique: async () => ({ professionsUpdatedAt: null }), update: vi.fn() },
      professionSkill: { deleteMany: vi.fn(), upsert: vi.fn() },
      recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() },
      epgpTransaction: { create: vi.fn() }, dkpTransaction: { create: vi.fn() }, addonImport: { update: vi.fn() }
    };
    const database = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: "2026-09-30T10:00:00Z",
      characters: [{ name: "Ray", realm: "R", class: "PRIEST", professionsComplete: true, professionsAt: "2026-09-30T10:00:00Z", professions: [{ name: "Mining", skillLevel: 300 }] }],
      epgpTransactions: [{ character: "Ray", realm: "R", epAmount: 20, type: "EP_AWARD", reason: "Raid", sourceRef: "ledger-1" }]
    });
    await relayProfessions(database as never, "g", snapshot);
    expect(tx.professionSkill.upsert).toHaveBeenCalledOnce();
    expect(tx.professionSkill.deleteMany).toHaveBeenCalledOnce();
    expect(tx.epgpTransaction.create).not.toHaveBeenCalled();
    expect(tx.dkpTransaction.create).not.toHaveBeenCalled();
    expect(tx.addonImport.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });
});
