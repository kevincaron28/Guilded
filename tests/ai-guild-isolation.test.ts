import { describe, expect, it, vi } from "vitest";
import { guildFacts } from "../src/services/answers.js";

describe("AI guild facts isolation", () => {
  it("never reads personal facts for a member ID belonging to another guild", async () => {
    const db = {
      guild: { findUnique: vi.fn(async () => ({ name: "Pilot A" })) },
      guildSettings: { findUnique: vi.fn(async () => ({ baseGp: 0, lootMode: "EPGP" })) },
      faqEntry: { findMany: vi.fn(async () => []) }, raidCore: { findMany: vi.fn(async () => []) },
      raid: { findMany: vi.fn(async () => []) }, member: { findFirst: vi.fn(async () => null) },
      character: { findMany: vi.fn() }, epgpTransaction: { aggregate: vi.fn() }
    };
    const facts = await guildFacts(db as never, "guild-a", "member-in-b", "UTC");
    expect(facts).toContain("Pilot A");
    expect(db.member.findFirst).toHaveBeenCalledWith({ where: { id: "member-in-b", guildId: "guild-a" }, select: { id: true } });
    for (const model of [db.faqEntry, db.raidCore, db.raid]) {
      expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "guild-a" }) }));
    }
    expect(db.character.findMany).not.toHaveBeenCalled();
    expect(db.epgpTransaction.aggregate).not.toHaveBeenCalled();
  });
});
