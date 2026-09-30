import { describe, expect, it, vi } from "vitest";
import { coreChannelNames, coreSlug } from "../src/services/core-channels.js";
import { asGroupKind, createDungeonGroupService, groupSize, GROUP_KINDS } from "../src/services/dungeon-group.js";
import { formatChecks, setupChecks, setupComplete, type SetupFacts } from "../src/services/setup-status.js";
import { rankCandidates, type PriorityCandidate } from "../src/services/loot-priority.js";
import { effectiveRules, DEFAULT_OFFSPEC_PERCENT } from "../src/services/core-rules.js";
import { runAutoDecay } from "../src/services/auto-decay.js";
import { isWeeklyReportDueAfterReset, reportWeek, weeklyReport } from "../src/services/weekly-report.js";
import { weeklyReportEmbeds } from "../src/commands/stats.js";

// 4.6 on Discord: raid core channels, the group finder's kinds, the setup checklist's new rows,
// loot rules (off-spec share, minimum EP, automatic decay) and the weekly report.

describe("raid core channels", () => {
  it("makes Discord-safe channel names from the core name", () => {
    expect(coreSlug("Tuesday MC")).toBe("tuesday-mc");
    expect(coreSlug("Équipe  #2 — Naxx!")).toBe("equipe-2-naxx");
    expect(coreSlug("⚔️")).toBe("core");
    expect(coreChannelNames("Tuesday MC")).toEqual({
      category: "⚔️ Tuesday MC", roster: "tuesday-mc-roster", signups: "tuesday-mc-signups", chat: "tuesday-mc-chat", voice: "🔊 Tuesday MC"
    });
  });
});

describe("group finder kinds", () => {
  it("dungeons are always 5 with roles; other kinds take a size within their limits", () => {
    expect(groupSize("DUNGEON", 12)).toBe(5);
    expect(groupSize("PVP")).toBe(GROUP_KINDS.PVP.size);
    expect(groupSize("WORLDPVP", 1)).toBe(2);
    expect(groupSize("LEVELING", 99)).toBe(40);
    expect(asGroupKind("nonsense")).toBe("DUNGEON");
    expect(asGroupKind("WORLD")).toBe("WORLD");
    expect(Object.values(GROUP_KINDS).filter((kind) => kind.roles)).toHaveLength(1);
  });

  it("a group without roles fills up to its size, then waitlists", async () => {
    const rows: { id: string; memberId: string; role: string; status: string; joinedAt: Date }[] = [];
    let clock = 0;
    const database = {
      dungeonGroup: {
        findFirst: async () => ({ id: "g1", guildId: "guild", status: "OPEN", kind: "LEVELING", maxSize: 3 }),
        findUnique: async () => ({ id: "g1", kind: "LEVELING", maxSize: 3 })
      },
      dungeonGroupSignup: {
        count: async ({ where }: { where: { status?: string; role?: string } }) =>
          rows.filter((r) => (!where.status || r.status === where.status) && (!where.role || r.role === where.role)).length,
        findUnique: async ({ where }: { where: { groupId_memberId: { memberId: string } } }) => rows.find((r) => r.memberId === where.groupId_memberId.memberId) ?? null,
        findMany: async () => rows,
        upsert: async ({ create }: { create: { memberId: string; role: string; status: string } }) => {
          const row = { id: `s${rows.length}`, joinedAt: new Date(2026, 0, 1, 0, 0, ++clock), ...create };
          rows.push(row);
          return row;
        }
      }
    };
    const service = createDungeonGroupService(database as never);
    for (const id of ["a", "b", "c"]) await service.join("g1", "guild", id, "DPS");
    expect(await service.isFull("g1")).toBe(true);
    const extra = await service.join("g1", "guild", "d", "TANK");
    expect(extra.signup.status).toBe("WAITLISTED");
  });
});

const baseFacts: SetupFacts = {
  existingRoleNames: ["Guild Master", "Officer"], requiredRoleNames: ["Guild Master", "Officer"],
  notifyChannel: { name: "raid-announcements", exists: true, botCanPost: true },
  raidChannel: { name: "raid-signups", exists: true, botCanPost: true },
  logChannel: { name: "journal", exists: true, botCanPost: true },
  welcomeChannel: { name: "welcome", exists: true, botCanPost: true },
  autoRoles: [], epgpConfigured: true, remindersOn: true, weeklyReportOn: true, companionPaired: true, linkedCharacters: 3
};

describe("setup checklist: every channel and every bot message", () => {
  it("lists the other channels as optional rows", () => {
    const checks = setupChecks({ ...baseFacts, extraChannels: [
      { field: "lootChannelId", fact: null },
      { field: "guideChannelId", fact: { name: "bot-guide", exists: true, botCanPost: true } }
    ] });
    const loot = checks.find((check) => check.label.startsWith("Loot log channel"))!;
    expect(loot).toMatchObject({ ok: false, optional: true });
    expect(checks.find((check) => check.label.startsWith("Bot guide channel"))?.ok).toBe(true);
    expect(setupComplete(checks)).toBe(true);
  });

  it("marks a bot message that is out of date with a warning, and a missing one as optional", () => {
    const checks = setupChecks({ ...baseFacts, botMessages: [
      { kind: "botGuide", state: "outdated" }, { kind: "leaderboard", state: "missing" }, { kind: "roster", name: "Tuesday MC", state: "current" }
    ] });
    const text = formatChecks(checks);
    expect(text).toContain("⚠️ Pinned bot guide");
    expect(text).toContain("➖ Dungeon leaderboard message");
    expect(text).toContain("✅ Roster message: Tuesday MC");
  });

  it("says when the group finder message is the old button", () => {
    const text = formatChecks(setupChecks({
      ...baseFacts, dungeonSignupChannel: { name: "group-finder", exists: true, botCanPost: true },
      dungeonSignupGuide: true, dungeonSignupCanPin: true, dungeonSignupGuideOutdated: true
    }));
    expect(text).toMatch(/⚠️|out of date/i);
  });
});

describe("loot rules", () => {
  const candidate = (name: string, ep: number, pr: number): PriorityCandidate =>
    ({ memberId: name, displayName: name, character: name, wishPriority: 1, wishedAt: new Date(0), ep, gp: 10, pr });

  it("priority puts players under the minimum EP after everyone else", () => {
    const ranked = rankCandidates([candidate("New", 20, 9), candidate("Old", 500, 3), candidate("Mid", 200, 5)], 100);
    expect(ranked.map((c) => c.displayName)).toEqual(["Mid", "Old", "New"]);
    expect(rankCandidates([candidate("New", 20, 9), candidate("Old", 500, 3)]).map((c) => c.displayName)).toEqual(["New", "Old"]);
  });

  it("off-spec costs 50% unless the core changes it; the minimum EP is off by default", () => {
    expect(DEFAULT_OFFSPEC_PERCENT).toBe(50);
    expect(effectiveRules(null, null)).toMatchObject({ offspecPercent: 50, minEp: 0 });
    expect(effectiveRules(null, { offspecPercent: 25, minEp: 100 })).toMatchObject({ offspecPercent: 25, minEp: 100 });
    expect(effectiveRules(null, { offspecPercent: 250 }).offspecPercent).toBe(100);
  });

  it("automatic decay runs once per weekly reset, for the guild pool and each core with its own pool", async () => {
    const settings = { id: "s1", guildId: "g1", autoDecay: true, lastAutoDecayAt: null as Date | null, epgpDecayPercent: 0.1 };
    const decays: string[] = [];
    const database = {
      guildSettings: {
        findMany: async () => [settings],
        update: async ({ data }: { data: { lastAutoDecayAt: Date } }) => { settings.lastAutoDecayAt = data.lastAutoDecayAt; }
      },
      raidCore: { findMany: async () => [{ id: "c1", separatePool: true, decayPercent: 0.2 }] },
      member: { findMany: async () => [] },
      epgpTransaction: {
        groupBy: async () => [], findMany: async () => [], createMany: async () => ({ count: 0 }),
        aggregate: async () => ({ _sum: { epAmount: 0, gpAmount: 0 } })
      },
      $transaction: async (work: unknown) => (typeof work === "function" ? (work as (db: unknown) => unknown)(database) : Promise.all(work as unknown[]))
    };
    const epgp = await import("../src/services/epgp.js");
    const spy = vi.spyOn(epgp, "createEpgpService").mockReturnValue({
      applyDecay: async (_guild: string, percent: number, _by: string, coreId: string | null) => { decays.push(`${coreId ?? "guild"}:${percent}`); }
    } as never);
    const now = new Date("2026-10-07T16:00:00Z"); // Wednesday, after Tuesday's reset
    expect(await runAutoDecay(database as never, now)).toBe(1);
    expect(await runAutoDecay(database as never, new Date("2026-10-08T16:00:00Z"))).toBe(0); // same week
    expect(await runAutoDecay(database as never, new Date("2026-10-14T16:00:00Z"))).toBe(1); // next week
    expect(decays).toEqual(["guild:0.1", "c1:0.2", "guild:0.1", "c1:0.2"]);
    spy.mockRestore();
  });
});

describe("weekly report", () => {
  it("covers the week that ended at the last reset and is due once per reset", () => {
    const now = new Date("2026-10-07T16:00:00Z");
    const { start, end } = reportWeek(now);
    expect(end.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(start.toISOString()).toBe("2026-09-29T15:00:00.000Z");
    expect(isWeeklyReportDueAfterReset({ enabled: true, lastAt: null, now })).toBe(true);
    expect(isWeeklyReportDueAfterReset({ enabled: true, lastAt: new Date("2026-10-06T15:30:00Z"), now })).toBe(false);
    expect(isWeeklyReportDueAfterReset({ enabled: true, lastAt: new Date("2026-10-05T12:00:00Z"), now })).toBe(true);
    expect(isWeeklyReportDueAfterReset({ enabled: false, lastAt: null, now })).toBe(false);
  });

  it("sums each core, the dungeon week and the players of the week", async () => {
    const who = (id: string, displayName: string) => ({ id, displayName });
    const coreRaid = (id: string, present: string[]) => ({
      id, bosses: [{ status: "KILLED" }, { status: "KILLED" }],
      attendance: present.map((memberId) => ({ memberId, status: "PRESENT", member: who(memberId, memberId.toUpperCase()) })),
      core: { id: "c1", name: "Tuesday MC", members: [
        { memberId: "a", bench: false, trial: false, member: { displayName: "Ann" } },
        { memberId: "b", bench: false, trial: false, member: { displayName: "Bob" } },
        { memberId: "z", bench: true, trial: false, member: { displayName: "Zed" } }
      ] }
    });
    const database = {
      raid: { findMany: async ({ where }: { where: { coreId?: unknown } }) => (where.coreId ? [coreRaid("r1", ["a", "b"]), coreRaid("r2", ["a"])] : []) },
      lootAward: { findMany: async ({ where }: { where: { raidId?: unknown } }) => (where.raidId ? [{ raidId: "r1", amount: 100 }, { raidId: "r2", amount: 50 }] : []) },
      epgpTransaction: {
        aggregate: async () => ({ _sum: { epAmount: 0 } }),
        findMany: async () => [
          { memberId: "a", epAmount: 30, member: { displayName: "Ann" } },
          { memberId: "b", epAmount: 50, member: { displayName: "Bob" } },
          { memberId: "a", epAmount: 30, member: { displayName: "Ann" } }
        ]
      },
      member: { count: async () => 0 },
      application: { count: async () => 0 },
      dungeonRun: { findMany: async () => [
        { dungeonName: "Deadmines", state: "COMPLETED", durationSec: 1500, players: [{ character: "Ann" }] },
        { dungeonName: "Deadmines", state: "COMPLETED", durationSec: 1200, players: [{ character: "Bob" }, { character: "Cy" }] },
        { dungeonName: "Stockades", state: "ABANDONED", durationSec: null, players: [] }
      ] },
      dungeonPointTransaction: { findMany: async () => [
        { memberId: "b", amount: 20, source: "rule:guildRecord", reason: "Guild record — Deadmines", member: { displayName: "Bob" } },
        { memberId: "c", amount: 10, source: "rule:firstCompletion", reason: "First clear — Deadmines", member: { displayName: "Cy" } }
      ] }
    };
    const report = await weeklyReport(database as never, "g1", new Date("2026-10-07T16:00:00Z"));
    expect(report.cores).toEqual([{ name: "Tuesday MC", raids: 2, attendancePct: 75, bossKills: 4, loot: 2, gp: 150, perfect: ["Ann"] }]);
    expect(report.raiderOfWeek).toMatchObject({ name: "Ann", ep: 60 });
    expect(report.dungeons).toMatchObject({ runs: 3, completed: 2, firsts: ["Cy (Deadmines)"] });
    expect(report.dungeons.fastest).toEqual([{ dungeon: "Deadmines", durationSec: 1200, players: ["Bob", "Cy"] }]);
    expect(report.dungeons.records[0]).toContain("Bob");
    expect(report.dungeonHero).toEqual({ name: "Bob", points: 20 });

    const embeds = weeklyReportEmbeds(report, "en").map((embed) => JSON.stringify(embed.toJSON()));
    expect(embeds.length).toBeGreaterThanOrEqual(2);
    expect(embeds.join()).toContain("Tuesday MC");
    expect(embeds.join()).toContain("Ann");
    expect(embeds.join()).toContain("Deadmines");
  });
});
