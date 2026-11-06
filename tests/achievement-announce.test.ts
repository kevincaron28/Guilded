import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_CATALOGUE_VERSION } from "../src/services/achievements-catalogue.js";
import { announceNewAchievements, markAnnouncedSilently, sweepAchievementAnnouncements } from "../src/services/achievement-announce.js";

interface Row { id: string; guildId: string; memberId: string; key: string; earnedAt: Date; announcedAt: Date | null }
type Where = { id?: { in: string[] }; announcedAt?: null; guildId?: string; memberId?: string };

function fakeDb(options: { enabled?: boolean; channel?: string | null; language?: string; keys?: string[]; baseline?: number } = {}) {
  const rows: Row[] = (options.keys ?? ["wow-forever-level-20", "dungeon-runs-1"]).map((key, i) => ({ id: `r${i}`, guildId: "g1", memberId: "m1", key, earnedAt: new Date(2026, 10, 1 + i), announcedAt: null }));
  const jobs: { key: string; kind: string; payload: Record<string, unknown> }[] = [];
  const match = (row: Row, where: Where) => (!where.id || where.id.in.includes(row.id)) && (where.announcedAt === undefined || row.announcedAt === where.announcedAt) && (!where.guildId || row.guildId === where.guildId) && (!where.memberId || row.memberId === where.memberId);
  const db = {
    guildSettings: { findUnique: async () => ({ achievementAnnounceEnabled: options.enabled ?? true, achievementChannelId: options.channel === undefined ? "c1" : options.channel, achievementsEnabled: true, achievementBaselineVersion: options.baseline ?? ACHIEVEMENT_CATALOGUE_VERSION, language: options.language ?? "en" }) },
    member: { findFirst: async () => ({ discordUserId: "123456789012345678", displayName: "Kev" }) },
    memberAchievement: {
      findMany: async (args: { where: Where }) => rows.filter(row => match(row, args.where)),
      updateMany: async (args: { where: Where; data: { announcedAt: Date } }) => { const hit = rows.filter(row => match(row, args.where)); for (const row of hit) row.announcedAt = args.data.announcedAt; return { count: hit.length }; },
      count: async () => rows.length
    },
    discordJob: { upsert: async (args: { where: { guildId_key: { key: string } }; create: { kind: string; payload: Record<string, unknown> } }) => { jobs.push({ key: args.where.guildId_key.key, kind: args.create.kind, payload: args.create.payload }); return {}; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };
  return { db: db as never, rows, jobs };
}

describe("achievement announcements", () => {
  it("posts nothing unless an officer switched announcing on and chose a channel", async () => {
    for (const options of [{ enabled: false }, { channel: null }]) {
      const { db, jobs, rows } = fakeDb(options);
      expect(await announceNewAchievements(db, "g1", "m1")).toBe(0);
      expect(jobs).toHaveLength(0);
      expect(rows.every(row => row.announcedAt === null)).toBe(true);
    }
  });
  it("batches a member's new unlocks into one queued message that mentions only that member", async () => {
    const { db, jobs, rows } = fakeDb();
    expect(await announceNewAchievements(db, "g1", "m1", new Date("2026-11-03T10:00:00Z"))).toBe(2);
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.kind).toBe("MESSAGE");
    expect(job.payload["route"]).toBe("achievements");
    expect(job.payload["mentionUsers"]).toEqual(["123456789012345678"]);
    expect(JSON.stringify(job.payload)).not.toMatch(/@everyone|@here|<@&/);
    expect(JSON.stringify(job.payload)).toContain("2 achievements unlocked");
    expect((job.payload["card"] as { rows: { icon: string }[] }).rows).toHaveLength(2);
    expect(rows.every(row => row.announcedAt)).toBe(true);
  });
  it("never repeats a post: a second pass, a restart or a race finds nothing waiting", async () => {
    const { db, jobs } = fakeDb();
    await announceNewAchievements(db, "g1", "m1", new Date("2026-11-03T10:00:00Z"));
    expect(await announceNewAchievements(db, "g1", "m1", new Date("2026-11-03T11:00:00Z"))).toBe(0);
    expect(jobs).toHaveLength(1);
  });
  it("loses a race quietly: if another pass claimed some rows first, nothing is queued", async () => {
    const { db, jobs, rows } = fakeDb();
    const real = (db as unknown as { memberAchievement: { updateMany: (a: unknown) => Promise<{ count: number }> } }).memberAchievement;
    const original = real.updateMany;
    real.updateMany = async (args: unknown) => { rows[0]!.announcedAt = new Date(); return original(args); };
    expect(await announceNewAchievements(db, "g1", "m1")).toBe(0);
    expect(jobs).toHaveLength(0);
  });
  it("does not backfill: what is already earned when announcing is switched on is marked announced silently", async () => {
    const { db, jobs, rows } = fakeDb();
    expect(await markAnnouncedSilently(db, "g1")).toBe(2);
    expect(await announceNewAchievements(db, "g1", "m1")).toBe(0);
    expect(jobs).toHaveLength(0);
    expect(rows.every(row => row.announcedAt)).toBe(true);
  });
  it("waits for the quiet baseline after the catalogue grows: nothing is announced until the sweep has recorded history silently", async () => {
    const { db, jobs, rows } = fakeDb({ baseline: ACHIEVEMENT_CATALOGUE_VERSION - 1 });
    expect(await announceNewAchievements(db, "g1", "m1")).toBe(0);
    expect(jobs).toHaveLength(0);
    expect(rows.every(row => row.announcedAt === null)).toBe(true);
  });
  it("writes the message in the guild language", async () => {
    const { db, jobs } = fakeDb({ language: "fr", keys: ["raids-1"] });
    await announceNewAchievements(db, "g1", "m1");
    expect(JSON.stringify(jobs[0]!.payload)).toContain("Succès débloqué : Au raid");
    expect(JSON.stringify(jobs[0]!.payload)).toContain("Bravo");
  });
  it("lists a few and counts the rest when many unlock at once", async () => {
    const { db, jobs } = fakeDb({ keys: ["wow-forever-level-10", "wow-forever-level-20", "wow-forever-level-30", "wow-forever-level-40", "raids-1", "raids-5", "raids-10", "dungeon-runs-1"] });
    await announceNewAchievements(db, "g1", "m1");
    expect(JSON.stringify(jobs[0]!.payload)).toContain("…and 2 more");
  });
  it("keeps going when one member or guild fails", async () => {
    const { db } = fakeDb();
    const errors: unknown[] = [];
    (db as unknown as { member: { findMany: () => Promise<never> } }).member = { findMany: async () => { throw new Error("boom"); } } as never;
    (db as unknown as { guildSettings: { findMany: () => Promise<{ guildId: string }[]> } }).guildSettings = { findMany: async () => [{ guildId: "g1" }] } as never;
    expect(await sweepAchievementAnnouncements(db as never, new Date(), error => errors.push(error))).toBe(0);
    expect(errors).toHaveLength(1);
  });
});
