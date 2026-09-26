import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { standingsToLua } from "../companion/standings.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { describeCalendar, planCalendarSync, runCalendarPlan, upcomingRaidsForAddon } from "../src/services/calendar-sync.js";

// ---------- what the companion sends ----------

const LUA = `
GuildedDB = {
  ["guildKey"] = "Quebec Gold-Forever",
  ["calendarEvents"] = {
    ["events"] = {
      [1] = { ["ref"] = "501", ["title"] = "Molten Core", ["startsAt"] = 1790000000, ["invites"] = {
        [1] = { ["name"] = "Ann", ["status"] = "ACCEPTED" }, [2] = { ["name"] = "Bob", ["status"] = "TENTATIVE" },
        [3] = { ["name"] = "Cy", ["status"] = "DECLINED" }, [4] = { ["name"] = "Bad", ["status"] = "WHATEVER" } } },
    },
  },
  ["exports"] = { ["2026-10-01T19:00:00Z"] = true },
}
`;

describe("companion export of calendar events", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("sends each event with its answers, and the bot's schema accepts it", async () => {
    dir = await mkdtemp(join(tmpdir(), "qg-calendar-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, LUA, "utf8");
    const snapshot = parseAddonSnapshot(await readAddonExport(file, "Forever"));
    expect(snapshot.calendarEvents).toHaveLength(1);
    const event = snapshot.calendarEvents[0]!;
    expect(event).toMatchObject({ ref: "501", title: "Molten Core" });
    expect(event.startsAt.getTime()).toBe(1790000000 * 1000);
    // An answer the addon does not know is not sent.
    expect(event.invites.map((invite) => `${invite.character}:${invite.status}:${invite.realm}`)).toEqual(["Ann:ACCEPTED:Forever", "Bob:TENTATIVE:Forever", "Cy:DECLINED:Forever"]);
  });

  it("sends nothing when the calendar was never read", async () => {
    dir = await mkdtemp(join(tmpdir(), "qg-calendar-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, `GuildedDB = { ["exports"] = {} }`, "utf8");
    expect((await readAddonExport(file, "Forever")).calendarEvents).toBeUndefined();
  });
});

describe("the raid list written for the addon", () => {
  it("lists the upcoming raids, and writes nil when there are none", () => {
    const base = { updatedAt: "2026-10-01T00:00:00Z", baseGp: 0, standings: [], nextRaid: null };
    const lua = standingsToLua({ ...base, raids: [{ id: "r1", title: 'MC "night"', at: "2026-10-02T18:00:00.000Z", core: "Tuesday", note: "" }] });
    expect(lua).toContain("GuildedRaids = {");
    expect(lua).toContain('{ id = "r1", title = "MC \\"night\\"", at = "2026-10-02T18:00:00.000Z", core = "Tuesday", note = "" },');
    expect(standingsToLua({ ...base, raids: [] })).toContain("GuildedRaids = nil");
  });

  it("collects planned, real raids of the next three weeks", async () => {
    const seen: unknown[] = [];
    const LONG = "A very long raid title that goes over the calendar's limit";
    const database = { raid: { findMany: async (args: unknown) => {
      seen.push(args);
      return [{ id: "r1", title: LONG, scheduledAt: new Date("2026-10-02T18:00:00Z"), description: "  Bring\nflasks  ", core: { name: "Tuesday" } }];
    } } };
    const rows = await upcomingRaidsForAddon(database as never, "g1", new Date("2026-10-01T00:00:00Z"));
    expect(rows).toEqual([{ id: "r1", title: LONG.slice(0, 30), at: "2026-10-02T18:00:00.000Z", core: "Tuesday", note: "Bring flasks" }]);
    const where = (seen[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ guildId: "g1", isTest: false, status: "PLANNED" });
  });
});

// ---------- matching events to raids and filling signups ----------

const CHARACTERS = [
  { id: "c1", name: "Ann", realm: "Forever", memberId: "m1" },
  { id: "c2", name: "Bob", realm: "Forever", memberId: "m2" },
  { id: "c3", name: "Cy", realm: "Forever", memberId: "m3" },
  { id: "c4", name: "Annalt", realm: "Forever", memberId: "m1" }
];

const NOW = new Date("2026-10-01T12:00:00Z");
const event = (over: Record<string, unknown> = {}) => parseAddonSnapshot({
  source: "Guilded", exportedAt: NOW.toISOString(),
  calendarEvents: [{
    ref: "e1", title: "Molten Core", startsAt: "2026-10-02T18:00:00Z",
    invites: [
      { character: "Ann", realm: "Forever", status: "ACCEPTED" }, { character: "Annalt", realm: "Forever", status: "TENTATIVE" },
      { character: "Bob", realm: "Forever", status: "TENTATIVE" }, { character: "Cy", realm: "Forever", status: "DECLINED" },
      { character: "Stranger", realm: "Forever", status: "ACCEPTED" }
    ], ...over
  }]
}).calendarEvents;

describe("planCalendarSync", () => {
  const raids = [
    { id: "r1", title: "Blackwing Lair", scheduledAt: new Date("2026-10-02T18:30:00Z") },
    { id: "r2", title: "molten core", scheduledAt: new Date("2026-10-02T19:10:00Z") }
  ];
  const tx = { raid: { findMany: async () => raids } };

  it("matches the raid at the same time (the same title first), one answer per player, and lists strangers", async () => {
    const plan = await planCalendarSync(tx as never, "g1", event(), CHARACTERS, NOW);
    expect(plan.unmatched).toEqual([]);
    const match = plan.matches[0]!;
    expect(match).toMatchObject({ raidId: "r2", raidTitle: "molten core", declined: 1, unlinked: ["Stranger"] });
    // Ann accepted and her alt was tentative: she counts once, as available.
    expect(match.entries.map((entry) => `${entry.memberId}:${entry.availability}`).sort()).toEqual(["m1:AVAILABLE", "m2:MAYBE"]);
  });

  it("reports an event with no Discord raid, and ignores events long past", async () => {
    const none = { raid: { findMany: async () => [] } };
    const plan = await planCalendarSync(none as never, "g1", [...event(), ...event({ ref: "old", title: "Old", startsAt: "2026-09-01T18:00:00Z" })], CHARACTERS, NOW);
    expect(plan.matches).toEqual([]);
    expect(plan.unmatched.map((item) => item.title)).toEqual(["Molten Core"]);
  });
});

function fakeDatabase(options: { existing?: string[]; caps?: Record<string, number | null>; core?: { coreId: string; roles: Record<string, string> } } = {}) {
  const signups = new Map<string, { memberId: string; role: string; status: string }>();
  for (const memberId of options.existing ?? []) signups.set(memberId, { memberId, role: "DPS", status: "SIGNED_UP" });
  const raid = { id: "r2", guildId: "g1", status: "PLANNED", coreId: options.core?.coreId ?? null, tankLimit: null, healerLimit: null, dpsLimit: options.caps?.["DPS"] ?? null };
  const database = {
    raid: {
      findUnique: async () => ({ coreId: raid.coreId }),
      findFirst: async () => raid
    },
    raidSignup: {
      findUnique: async ({ where }: { where: { raidId_memberId: { memberId: string } } }) => signups.get(where.raidId_memberId.memberId) ?? null,
      findMany: async () => [],
      count: async ({ where }: { where: { role: string; memberId: { not: string } } }) => [...signups.values()].filter((s) => s.role === where.role && s.status === "SIGNED_UP" && s.memberId !== where.memberId.not).length,
      upsert: async ({ where, create }: { where: { raidId_memberId: { memberId: string } }; create: { role: string; status: string } }) => {
        const row = { memberId: where.raidId_memberId.memberId, role: create.role, status: create.status };
        signups.set(row.memberId, row);
        return row;
      }
    },
    raidCoreMember: {
      findFirst: async ({ where }: { where: { memberId: string } }) => options.core?.roles[where.memberId] ? { role: options.core.roles[where.memberId] } : null,
      findMany: async () => Object.keys(options.core?.roles ?? {}).map((memberId) => ({ memberId }))
    }
  };
  return { database, signups };
}

const plan = () => ({
  matches: [{
    ref: "e1", title: "Molten Core", raidId: "r2", raidTitle: "Molten Core", declined: 1, unlinked: ["Stranger"],
    entries: [{ memberId: "m1", name: "Ann", availability: "AVAILABLE" as const }, { memberId: "m2", name: "Bob", availability: "MAYBE" as const }, { memberId: "m3", name: "Cy", availability: "AVAILABLE" as const }]
  }],
  unmatched: [{ title: "Orphan Event", startsAt: new Date("2026-10-05T18:00:00Z") }]
});

describe("runCalendarPlan", () => {
  it("signs people up through the normal rules: available signs up, tentative is a maybe", async () => {
    const { database, signups } = fakeDatabase();
    const summary = await runCalendarPlan(database as never, "g1", plan());
    expect(summary).toMatchObject({ matched: 1, signedUp: 2, maybe: 1, waitlisted: 0, alreadyOnDiscord: 0, failed: 0, declined: 1, unlinked: ["Stranger"], changedRaidIds: ["r2"] });
    expect([...signups.values()].map((s) => `${s.memberId}:${s.status}`).sort()).toEqual(["m1:SIGNED_UP", "m2:MAYBE", "m3:SIGNED_UP"]);
  });

  it("never changes someone who already answered on Discord", async () => {
    const { database, signups } = fakeDatabase({ existing: ["m1"] });
    signups.set("m2", { memberId: "m2", role: "DPS", status: "CANCELLED" });
    const summary = await runCalendarPlan(database as never, "g1", plan());
    expect(summary.alreadyOnDiscord).toBe(2);
    expect(signups.get("m2")?.status).toBe("CANCELLED");
    expect(summary.signedUp).toBe(1);
  });

  it("uses the core's role, and the role caps decide who waitlists", async () => {
    const { database, signups } = fakeDatabase({ core: { coreId: "core1", roles: { m1: "TANK", m3: "DPS" } }, caps: { DPS: 0 } });
    const summary = await runCalendarPlan(database as never, "g1", plan());
    expect(signups.get("m1")?.role).toBe("TANK");
    expect(signups.get("m3")?.status).toBe("WAITLISTED");
    expect(summary.waitlisted).toBe(1);
  });

  it("changes nothing when the plan is empty", async () => {
    const { database, signups } = fakeDatabase();
    const summary = await runCalendarPlan(database as never, "g1", { matches: [], unmatched: [] });
    expect(summary.changedRaidIds).toEqual([]);
    expect(signups.size).toBe(0);
  });
});

describe("describeCalendar", () => {
  it("says what happened, and what needs an officer", async () => {
    const { database } = fakeDatabase({ existing: ["m1"] });
    const text = describeCalendar(await runCalendarPlan(database as never, "g1", plan()));
    expect(text).toContain("1 in-game event(s) matched a Discord raid: 1 signed up, 1 maybe, 0 on the waitlist, 1 already answered on Discord (unchanged), 1 declined.");
    expect(text).toContain("Not linked to a Discord member (skipped): Stranger.");
    expect(text).toContain('In-game event "Orphan Event"');
    expect(text).toContain("/raid create");
  });

  it("is empty when there was nothing to sync", () => {
    expect(describeCalendar(null)).toBe("");
    expect(describeCalendar({ matched: 0, unmatched: [] } as never)).toBe("");
  });
});
