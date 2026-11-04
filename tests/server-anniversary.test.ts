import { describe, expect, it, vi } from "vitest";
import { anniversariesAttended, anniversaryDue, celebrateServerAnniversary, serverCreatedAt, sweepServerAnniversaries } from "../src/services/server-anniversary.js";
import { evaluateAchievements, emptyFacts } from "../src/services/achievements.js";
import { serverAnniversaryCard } from "../src/services/end-cards.js";

// A snowflake created 2023-11-03T12:00:00Z: (ms - discord epoch) << 22.
const founded = new Date("2023-11-03T12:00:00Z");
const snowflake = String((BigInt(founded.getTime()) - 1420070400000n) << 22n);

describe("server anniversary dates", () => {
  it("reads the creation date from the server id", () => {
    expect(serverCreatedAt(snowflake)?.toISOString()).toBe(founded.toISOString());
    expect(serverCreatedAt("not-an-id")).toBeNull();
  });

  it("counts only anniversaries that came while the member was recorded", () => {
    const now = new Date("2026-11-04T00:00:00Z");
    expect(anniversariesAttended(founded, new Date("2024-06-01T00:00:00Z"), now)).toHaveLength(3); // 2024, 2025, 2026
    expect(anniversariesAttended(founded, new Date("2024-12-01T00:00:00Z"), now)).toHaveLength(2); // 2025, 2026
    expect(anniversariesAttended(founded, new Date("2026-11-04T00:00:00Z"), now)).toHaveLength(0);
  });

  it("is due on the day and for a few days after, never before or long after", () => {
    expect(anniversaryDue(founded, new Date("2026-11-03T15:00:00Z"))?.year).toBe(3);
    expect(anniversaryDue(founded, new Date("2026-11-06T15:00:00Z"))?.year).toBe(3);
    expect(anniversaryDue(founded, new Date("2026-11-02T00:00:00Z"))).toBeNull(); // the 2nd anniversary was a year ago
    expect(anniversaryDue(founded, new Date("2026-11-20T00:00:00Z"))).toBeNull();
  });
});

describe("anniversary achievements", () => {
  it("earn from the attended anniversaries and carry the anniversary date", () => {
    const dates = [new Date("2024-11-03T00:00:00Z"), new Date("2025-11-03T00:00:00Z")];
    const earned = evaluateAchievements({ ...emptyFacts(), serverAnniversaries: dates }, new Date("2026-01-01T00:00:00Z")).filter(r => r.def.metric === "serverAnniversaries" && r.earned);
    expect(earned.map(r => r.def.id)).toEqual(["anniversary-1", "anniversary-2"]);
    expect(earned[1]!.earnedAt?.toISOString()).toBe(dates[1]!.toISOString());
  });
});

describe("server anniversary card", () => {
  it("draws years, members and the longest-standing members in both languages", () => {
    const input = { serverName: "Quebec Gold", years: 3, founded, members: 42, achievementsEarned: 310, oldestMembers: [{ displayName: "Kev", createdAt: new Date("2023-11-04T00:00:00Z") }] };
    const en = serverAnniversaryCard(input, "en");
    expect(en.stats[0]).toMatchObject({ label: "Years together", value: "3" });
    expect(en.rows?.[0]).toMatchObject({ name: "Kev", sub: "Member since 2023-11-04" });
    expect(serverAnniversaryCard(input, "fr").stats[0]!.label).toBe("Années ensemble");
  });
});

function fakeDb(options: { enabled?: boolean; discordId?: string; existing?: boolean } = {}) {
  const jobs: { key: string; payload: Record<string, unknown> }[] = [];
  const db = {
    guildSettings: { findUnique: vi.fn(async () => ({ achievementAnnounceEnabled: options.enabled ?? true, achievementChannelId: "c1", achievementsEnabled: true, language: "en" })), findMany: vi.fn(async () => [{ guildId: "g1" }]) },
    guild: { findUnique: vi.fn(async () => ({ discordId: options.discordId ?? snowflake, name: "Quebec Gold" })) },
    member: { count: vi.fn(async () => 42), findMany: vi.fn(async () => [{ displayName: "Kev", createdAt: new Date("2023-11-04T00:00:00Z") }]) },
    memberAchievement: { count: vi.fn(async () => 310) },
    discordJob: {
      findUnique: vi.fn(async () => options.existing ? { id: "j" } : null),
      upsert: vi.fn(async ({ create }: { create: { key: string; payload: Record<string, unknown> } }) => { jobs.push(create); return create; })
    }
  };
  return { db: db as never, jobs };
}

describe("celebrating the anniversary", () => {
  const day = new Date("2026-11-03T15:00:00Z");

  it("queues one card post on the anniversary", async () => {
    const { db, jobs } = fakeDb();
    expect(await celebrateServerAnniversary(db, "g1", day)).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.key).toBe("server-anniversary:3");
    expect(jobs[0]!.payload).toMatchObject({ route: "achievements", channelId: "c1", card: { title: "Quebec Gold" } });
  });

  it("does not repost, post when off, or post outside the window", async () => {
    expect(await celebrateServerAnniversary(fakeDb({ existing: true }).db, "g1", day)).toBe(false);
    expect(await celebrateServerAnniversary(fakeDb({ enabled: false }).db, "g1", day)).toBe(false);
    expect(await celebrateServerAnniversary(fakeDb().db, "g1", new Date("2026-11-20T00:00:00Z"))).toBe(false);
  });

  it("a failing guild is reported and does not stop the sweep", async () => {
    const { db } = fakeDb();
    (db as never as { guild: { findUnique: () => Promise<never> } }).guild.findUnique = async () => { throw new Error("boom"); };
    const errors: unknown[] = [];
    expect(await sweepServerAnniversaries(db, day, error => errors.push(error))).toBe(0);
    expect(errors).toHaveLength(1);
  });
});
