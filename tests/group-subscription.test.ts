import { describe, expect, it } from "vitest";
import { groupSubscriptionSchema, subscriptionPreview } from "../src/services/group-subscription.js";

function input() {
  return { subscription: { optedIn: true, timezone: "America/Toronto", createdAt: "2026-10-29T12:00:00Z", expiresAt: "2026-11-05T12:00:00Z",
    weekdays: [0, 1, 2, 3, 4, 5, 6], available: { start: 19 * 60, end: 22 * 60 }, quiet: { start: 22 * 60, end: 8 * 60 }, types: ["group", "vacancy"] },
    now: new Date("2026-10-30T22:00:00Z"), isMember: true, canViewChannel: true,
    candidate: { discordUserId: "member", kinds: ["DUNGEON"], roles: ["HEALER"], levels: [60] },
    event: { key: "group-1", type: "group" as const, startsAt: new Date("2026-10-30T23:00:00Z"), expiresAt: new Date("2026-10-31T02:00:00Z"), open: true, hasVacancy: true,
      group: { kind: "DUNGEON" as const, minLevel: 55, maxLevel: 60, rolesNeeded: ["HEALER" as const], leaderDiscordId: "leader" } },
    history: [] as { eventKey: string; attemptedAt: Date }[] };
}

describe("targeted subscription preview (sender remains disabled)", () => {
  it("reuses existing role/level/leader matching and requires an explicit opt-in", () => {
    const i = input();
    expect(subscriptionPreview(i)).toEqual({ eligible: true, reason: "eligible", deliveryEnabled: false });
    i.candidate.roles = ["TANK"];
    expect(subscriptionPreview(i).reason).toBe("not-matched");
    i.subscription.optedIn = false;
    expect(subscriptionPreview(i).reason).toBe("off");
  });
  it("fails closed on invalid timezone, zero-length windows and expired or overlong subscriptions", () => {
    for (const change of [{ timezone: "bad/zone" }, { available: { start: 1, end: 1 } }, { expiresAt: "2026-12-01T00:00:00Z" }]) {
      expect(groupSubscriptionSchema.safeParse({ ...input().subscription, ...change }).success).toBe(false);
    }
    const i = input(); i.subscription.expiresAt = i.now.toISOString();
    expect(subscriptionPreview(i).reason).toBe("expired");
    i.subscription.expiresAt = i.event.startsAt.toISOString();
    expect(subscriptionPreview(i).reason).toBe("outside-subscription");
  });
  it("refuses missing access, closed/full events and unknown or past start times", () => {
    const i = input();
    expect(subscriptionPreview({ ...i, isMember: false }).reason).toBe("not-visible");
    expect(subscriptionPreview({ ...i, canViewChannel: false }).reason).toBe("not-visible");
    for (const change of [{ open: false }, { hasVacancy: false }, { startsAt: new Date(0) }]) {
      expect(subscriptionPreview({ ...i, event: { ...i.event, ...change } }).reason).toBe("closed");
    }
    expect(subscriptionPreview({ ...i, now: new Date(NaN) }).reason).toBe("invalid-time");
  });
  it("handles midnight availability by the day the window begins", () => {
    const i = input(); i.subscription.weekdays = [5]; i.subscription.available = { start: 23 * 60, end: 2 * 60 };
    i.event.startsAt = new Date("2026-10-31T05:00:00Z"); i.event.expiresAt = new Date("2026-10-31T06:00:00Z");
    expect(subscriptionPreview(i).eligible).toBe(true);
    i.subscription.weekdays = [6];
    expect(subscriptionPreview(i).reason).toBe("outside-availability");
  });
  it("honors both copies of a repeated DST hour and changes availability with local time", () => {
    const i = input(); i.subscription.available = { start: 0, end: 12 * 60 };
    for (const hour of [5, 6]) {
      i.now = new Date(`2026-11-01T0${hour}:30:00Z`);
      i.event.startsAt = new Date("2026-11-01T15:00:00Z"); i.event.expiresAt = new Date("2026-11-01T16:00:00Z");
      expect(subscriptionPreview(i).reason).toBe("quiet-hours");
    }
    i.now = new Date("2026-11-01T13:00:00Z"); // exactly 08:00 after fall-back
    expect(subscriptionPreview(i).eligible).toBe(true);
  });
  it("counts attempted/uncertain reservations, deduplicates edits, enforces rolling-day caps", () => {
    const i = input();
    i.history = [{ eventKey: i.event.key, attemptedAt: new Date(i.now.getTime() - 2 * 86_400_000) }];
    expect(subscriptionPreview(i).reason).toBe("duplicate");
    i.history = [{ eventKey: "other", attemptedAt: new Date(i.now.getTime() - 5 * 3_600_000) }];
    expect(subscriptionPreview(i).reason).toBe("cooldown");
    i.history = [7, 20].map(hour => ({ eventKey: String(hour), attemptedAt: new Date(i.now.getTime() - hour * 3_600_000) }));
    expect(subscriptionPreview(i).reason).toBe("daily-limit");
    i.history[1]!.attemptedAt = new Date(i.now.getTime() - 86_400_000);
    expect(subscriptionPreview(i).eligible).toBe(true);
  });
});
