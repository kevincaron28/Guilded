import { describe, expect, it } from "vitest";
import { badgeLabel, badgeProgress, historicalPeak, reachedMilestones } from "../src/services/community-badge-rules.js";
import { milestoneMessage } from "../src/services/community-badge-delivery.js";
import { communityBadgeShelf } from "../src/services/community-badges.js";

describe("community badge rules and privacy", () => {
  it("shares exact 100/300/500 boundaries and progress", () => {
    expect([99, 100, 299, 300, 499, 500].map(reachedMilestones)).toEqual([[], [100], [100], [100, 300], [100, 300], [100, 300, 500]]);
    expect(badgeProgress(301)).toEqual({ reached: [100, 300], next: 500 });
    expect(badgeProgress(501).next).toBeNull();
  });
  it("preserves evidence-backed legacy peaks without treating spend/refund as earnings", () => {
    const rows = [
      { amount: 150, kind: "AWARD", createdAt: new Date(1) },
      { amount: -120, kind: "SPEND", createdAt: new Date(2) },
      { amount: -100, kind: "REVERSAL", createdAt: new Date(3) },
      { amount: 900, kind: "REFUND", createdAt: new Date(4) }
    ];
    expect(historicalPeak(rows)).toBe(150);
    expect(historicalPeak([{ ...rows[0]!, amount: 500 }, { ...rows[0]!, kind: "REVERSAL", amount: -500 }])).toBe(0);
  });
  it("escapes names and prohibits every kind of ping in EN/FR", () => {
    for (const lang of ["en", "fr"] as const) {
      const message = milestoneMessage("**name**\n@everyone <@123> <@&456>", 300, lang);
      expect(message.content).not.toContain("@everyone");
      expect(message.content).not.toContain("<@");
      expect(message.content).toContain("\\*\\*name\\*\\*");
      expect(message.allowedMentions).toEqual({ parse: [], users: [], roles: [] });
      expect(badgeLabel("helper", lang)).not.toBe("helper");
    }
  });
  it("never queries another member's private shelf until that season is shared", async () => {
    let reads = 0, shared = false;
    const db = { communityBadgeSharing: { findUnique: async () => ({ shared }) }, communityBadge: { findMany: async () => { reads++; return []; } } };
    expect(await communityBadgeShelf(db as never, "season", "viewer", "owner")).toBeNull();
    expect(reads).toBe(0);
    expect(await communityBadgeShelf(db as never, "season", "owner", "owner")).toEqual([]);
    shared = true;
    expect(await communityBadgeShelf(db as never, "season", "viewer", "owner")).toEqual([]);
    shared = false;
    expect(await communityBadgeShelf(db as never, "season", "viewer", "owner")).toBeNull();
    expect(reads).toBe(2);
  });
});
