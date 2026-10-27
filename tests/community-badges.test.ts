import { describe, expect, it } from "vitest";
import { badgeLabel, badgeProgress, historicalPeak, reachedMilestones } from "../src/services/community-badge-rules.js";
import { milestoneMessage } from "../src/services/community-badge-delivery.js";
import { communityBadgeShelf, setCommunityBadgeSharing } from "../src/services/community-badges.js";
import { badgeCommandsForGuild, MEMBER_BADGE_SHELF_GUILD } from "../src/services/community-badge-policy.js";

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
    const db = { communitySeason: { findUnique: async () => ({ guild: { discordId: "another-server" } }) }, communityBadgeSharing: { findUnique: async () => ({ shared }) }, communityBadge: { findMany: async () => { reads++; return []; } } };
    expect(await communityBadgeShelf(db as never, "season", "viewer", "owner")).toBeNull();
    expect(reads).toBe(0);
    expect(await communityBadgeShelf(db as never, "season", "owner", "owner")).toEqual([]);
    shared = true;
    expect(await communityBadgeShelf(db as never, "season", "viewer", "owner")).toEqual([]);
    shared = false;
    expect(await communityBadgeShelf(db as never, "season", "viewer", "owner")).toBeNull();
    expect(reads).toBe(2);
  });
  it("shares Québec Gold shelves regardless of preserved old preferences, never mutating them", async () => {
    let writes = 0;
    const db = { communitySeason: { findUnique: async () => ({ guild: { discordId: MEMBER_BADGE_SHELF_GUILD } }) }, communityBadgeSharing: { findUnique: async () => ({ shared: false }), upsert: async () => { writes++; } }, communityBadge: { findMany: async () => [{ code: "community-100" }] } };
    for (const viewer of ["owner", "viewer"]) expect(await communityBadgeShelf(db as never, "season", viewer, "owner")).toEqual([{ code: "community-100" }]);
    for (const shared of [true, false]) expect(await setCommunityBadgeSharing(db as never, "season", "viewer", "owner", shared)).toBe(false);
    expect(writes).toBe(0);
    db.communitySeason.findUnique = async () => ({ guild: { discordId: "another-server" } });
    await expect(setCommunityBadgeSharing(db as never, "season", "viewer", "owner", true)).rejects.toThrow("Only your own");
    expect(await setCommunityBadgeSharing(db as never, "season", "owner", "owner", false)).toBe(true);
    expect(writes).toBe(1);
  });
  it("removes only Québec Gold's badge share option without mutating other servers' commands", () => {
    const commands = [{ name: "community", options: [{ name: "badges", options: [{ name: "share" }, { name: "player" }] }] }, { name: "mod", options: [{ name: "leaderboard", options: [{ name: "share" }] }] }];
    const scoped = badgeCommandsForGuild(MEMBER_BADGE_SHELF_GUILD, commands) as typeof commands;
    expect(scoped[0]!.options[0]!.options).toEqual([{ name: "player" }]);
    expect(scoped[1]).toEqual(commands[1]);
    expect(badgeCommandsForGuild("other-server", commands)).toBe(commands);
    expect(commands[0]!.options[0]!.options).toHaveLength(2);
  });
});
