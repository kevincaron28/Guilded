import { describe, expect, it, vi } from "vitest";
import { checkIssues, issueLabel, queueRaidNightChecks, raidNightCard, raidNightCheck, raidNightEmbed, type RaidNightCheck } from "../src/services/raid-night-check.js";
import { scoreCardPng } from "../src/services/score-card.js";

const now = new Date("2026-11-07T20:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const snap = (over: Record<string, unknown> = {}) => ({ status: "READY", inspectedAt: hoursAgo(2), character: { level: 60, gameEdition: "forever" }, findings: [] as { code: string; severity: string; message: string }[], ...over });

describe("check issues", () => {
  it("keeps the gear rules: levelling, stale checks, findings", () => {
    expect(checkIssues(snap({ character: { level: 52 } }), null, now)).toEqual({ status: "LEVELLING", issues: ["LEVEL"] });
    expect(checkIssues(snap({ inspectedAt: hoursAgo(30) }), null, now)).toEqual({ status: "UNKNOWN", issues: ["STALE"] });
    expect(checkIssues(snap({ status: "PARTIAL", findings: [{ code: "MISSING_ENCHANTS", severity: "WARNING", message: "x" }] }), null, now)).toEqual({ status: "PARTIAL", issues: ["MISSING_ENCHANTS"] });
    expect(checkIssues(null, null, now)).toEqual({ status: "NO_CHECK", issues: [] });
  });
  it("lets a fresh group scan settle flask and food", () => {
    const noFlask = snap({ status: "PARTIAL", findings: [{ code: "NO_FLASK", severity: "WARNING", message: "x" }] });
    expect(checkIssues(noFlask, { flask: "Flask of the Titans", elixirs: [], food: "Well Fed" }, now)).toEqual({ status: "READY", issues: [] });
    expect(checkIssues(snap(), { flask: null, elixirs: [], food: null }, now)).toEqual({ status: "PARTIAL", issues: ["NO_FLASK", "NO_FOOD"] });
  });
  it("labels codes in both languages", () => {
    expect(issueLabel("NO_FLASK", "fr")).toBe("Pas de flacon");
    expect(issueLabel("MISSING_HEAD", "en")).toBe("Empty slot");
    expect(issueLabel("Something odd", "en")).toBe("Something odd");
  });
});

function db(overrides: Record<string, unknown> = {}) {
  const character = (id: string, name: string, className: string, lastSeen: Date | null) => ({ id, name, displayName: null, className, spec: null, level: 60, lastSeenAt: lastSeen, gameEdition: "forever" });
  const signups = [
    { status: "SIGNED_UP", role: "TANK", spec: null, late: false, characterName: "Alda", memberId: "m1", character: character("c1", "Alda", "Warrior", hoursAgo(5)), member: { displayName: "Alda" } },
    { status: "SIGNED_UP", role: "HEALER", spec: null, late: true, characterName: "Bren", memberId: "m2", character: character("c2", "Bren", "Priest", hoursAgo(10)), member: { displayName: "Bren" } },
    { status: "SIGNED_UP", role: "DPS", spec: null, late: false, characterName: "Cyra", memberId: "m3", character: character("c3", "Cyra", "Mage", hoursAgo(24 * 6)), member: { displayName: "Cyra" } },
    { status: "MAYBE", role: "DPS", spec: null, late: false, characterName: "Dax", memberId: "m4", character: null, member: { displayName: "Dax" } }
  ];
  const snapshots: Record<string, unknown> = {
    c1: { ...snap(), characterId: "c1", character: { level: 60, className: "Warrior", lastSeenAt: hoursAgo(5) } },
    c2: { ...snap({ status: "PARTIAL", findings: [{ code: "NO_FLASK", severity: "WARNING", message: "No flask" }] }), characterId: "c2", character: { level: 60, className: "Priest", lastSeenAt: hoursAgo(10) } }
  };
  return {
    raid: {
      findFirst: vi.fn(async () => ({ id: "r1", title: "Molten Core", scheduledAt: new Date("2026-11-08T00:00:00Z"), tankLimit: 2, healerLimit: 3, dpsLimit: 15, meleeLimit: null, rangedLimit: null, signups })),
      findMany: vi.fn(async () => [{ id: "r1" }])
    },
    inspectedCharacterSnapshot: { findFirst: vi.fn(async (args: { where: { characterId?: string } }) => snapshots[args.where.characterId ?? ""] ?? null) },
    consumableCheck: { findMany: vi.fn(async () => []) },
    ...overrides
  };
}

describe("raid night check", () => {
  it("counts roles against the limits and sorts who needs attention and who was not seen", async () => {
    const check = (await raidNightCheck(db() as never, "g1", "r1", now))!;
    expect(check.slots).toEqual([{ role: "TANK", signed: 1, limit: 2 }, { role: "HEALER", signed: 1, limit: 3 }, { role: "DPS", signed: 1, limit: 15 }]);
    expect(check.maybe).toBe(1);
    expect(check.rows.map(row => [row.name, row.status, row.issues, row.late, row.lastSeenDays])).toEqual([
      ["Alda", "READY", [], false, 0], ["Bren", "PARTIAL", ["NO_FLASK"], true, 0], ["Cyra", "NO_CHECK", [], false, 6]
    ]);
    const card = raidNightCard(check, "fr", "America/Toronto");
    expect(card.stats.map(stat => stat.value)).toEqual(["3/20", "1", "1", "17"]);
    expect(card.recap!.sections[1]!.rows[0]).toMatchObject({ name: "Bren", sub: "En retard · Pas de flacon" });
    expect(card.recap!.sections[2]!.rows[0]).toMatchObject({ name: "Cyra", sub: "Pas vu depuis 6 jours" });
    const text = raidNightEmbed(check, "en").data.description!;
    expect(text).toContain("• **Bren** (late): No flask");
    expect(text).toContain("• **Cyra**: Not seen for 6 days");
    expect(text).toContain("Tanks 1/2 ⚠️");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);

  it("queues each raid once, only for servers with the posts on and a channel", async () => {
    const jobs = new Set<string>();
    const base = db();
    const store = { ...base,
      guildSettings: { findMany: vi.fn(async (args: { where: Record<string, unknown> }) => { expect(args.where).toMatchObject({ readinessPostsEnabled: true, readinessChannelId: { not: null } }); return [{ guildId: "g1", language: "en", timezone: "UTC" }]; }) },
      discordJob: {
        findUnique: vi.fn(async (args: { where: { guildId_key: { key: string } } }) => jobs.has(args.where.guildId_key.key) ? { id: "j" } : null),
        upsert: vi.fn(async (args: { create: { key: string; payload: { route: string } } }) => { expect(args.create.payload.route).toBe("raidCheck"); jobs.add(args.create.key); return { id: "j" }; })
      } };
    expect(await queueRaidNightChecks(store as never, now)).toBe(1);
    expect(await queueRaidNightChecks(store as never, now)).toBe(0);
    expect([...jobs]).toEqual(["raid-check:r1"]);
    expect(base.raid.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "PLANNED", isTest: false }) }));
  });
});

describe("check card without limits", () => {
  it("shows plain counts and no shortfall", () => {
    const check: RaidNightCheck = { raidId: "r", title: "Onyxia", scheduledAt: now, slots: [{ role: "TANK", signed: 1, limit: null }], rows: [], maybe: 0, waitlisted: 0 };
    const card = raidNightCard(check, "en", "UTC");
    expect(card.stats.map(stat => stat.value)).toEqual(["0", "0", "0", "0"]);
    expect(raidNightEmbed(check, "fr").data.description).toContain("Personne n'est encore inscrit.");
  });
});
