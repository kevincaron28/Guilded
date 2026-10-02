import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { parseSeasonStart, seasonAttendance, seasonCsv, seasonTotals, splitByCore, startSeason } from "../src/services/raid-season.js";
import { playerHistoryEmbed, seasonSummaryEmbeds } from "../src/commands/raid-season.js";

type Row = Record<string, unknown>;

const person = (id: string) => ({ memberId: id, member: { displayName: `Player ${id.toUpperCase()}`, discordUserId: `d-${id}` } });
const mark = (id: string, status: string) => ({ ...person(id), status });
const coreA = (addedAt: Record<string, string>) => ({ name: "Core A", members: Object.entries(addedAt).map(([id, date]) => ({ ...person(id), addedAt: new Date(date) })) });

// Three raids: two of Core A (a and b are its mains; c joins it after the first raid) and one with no core.
function raids() {
  return [
    { id: "r1", title: "Karazhan", scheduledAt: new Date("2026-09-02T00:00:00Z"), coreId: "A", core: coreA({ a: "2026-08-01", b: "2026-08-01", c: "2026-09-05" }),
      attendance: [mark("a", "PRESENT"), mark("b", "ABSENT")], signups: [person("a"), person("d")] },
    { id: "r2", title: "Gruul", scheduledAt: new Date("2026-09-09T00:00:00Z"), coreId: "A", core: coreA({ a: "2026-08-01", b: "2026-08-01", c: "2026-09-05" }),
      attendance: [mark("a", "LATE"), mark("c", "BENCHED")], signups: [] },
    { id: "r3", title: "Pug night", scheduledAt: new Date("2026-09-10T00:00:00Z"), coreId: null, core: null,
      attendance: [mark("e", "PRESENT")], signups: [person("a")] }
  ];
}

async function load(window: { from: Date; until?: Date | null; coreId?: string | null } = { from: new Date("2026-09-01T00:00:00Z") }) {
  const findMany = vi.fn(async () => raids());
  const data = await seasonAttendance({ raid: { findMany } } as unknown as PrismaClient, "guild", window);
  return { data, findMany };
}

describe("raid season attendance", () => {
  it("asks for the completed, real raids of the window, oldest first", async () => {
    const until = new Date("2026-10-01T00:00:00Z");
    const { findMany } = await load({ from: new Date("2026-09-01T00:00:00Z"), until, coreId: "A" });
    expect((findMany.mock.calls[0] as unknown as [{ where: Row; orderBy: Row }])[0]).toMatchObject({
      where: { guildId: "guild", status: "COMPLETED", isTest: false, coreId: "A", scheduledAt: { gte: new Date("2026-09-01T00:00:00Z"), lt: until } },
      orderBy: { scheduledAt: "asc" }
    });
  });

  it("gives each member one cell per raid: recorded, expected but not recorded, or not concerned", async () => {
    const { data } = await load();
    const cells = Object.fromEntries(data.rows.map((row) => [row.name, row.cells]));
    expect(data.raids.map((raid) => raid.title)).toEqual(["Karazhan", "Gruul", "Pug night"]);
    expect(cells).toEqual({
      "Player A": ["PRESENT", "LATE", "UNRECORDED"],
      // A main nobody recorded at the second raid is expected there, not absent.
      "Player B": ["ABSENT", "UNRECORDED", null],
      // Joined the core after the first raid: not expected at it.
      "Player C": [null, "BENCHED", null],
      "Player D": ["UNRECORDED", null, null],
      "Player E": [null, null, "PRESENT"]
    });
  });

  it("rates only what was recorded: late is half, benched is full, unrecorded is left out", async () => {
    const { data } = await load();
    const row = (name: string) => data.rows.find((entry) => entry.name === name)!;
    expect(row("Player A")).toMatchObject({ present: 1, late: 1, unrecorded: 1, rate: 0.75 });
    expect(row("Player B")).toMatchObject({ absent: 1, unrecorded: 1, rate: 0 });
    expect(row("Player C")).toMatchObject({ benched: 1, rate: 1 });
    expect(row("Player D").rate).toBeNull();
    expect(seasonTotals([])).toMatchObject({ rate: null, present: 0 });
  });

  it("splits by core, raids with no core last, keeping only the members concerned", async () => {
    const parts = splitByCore((await load()).data);
    expect(parts.map((part) => [part.coreName, part.data.raids.length, part.data.rows.map((row) => row.name)])).toEqual([
      ["Core A", 2, ["Player A", "Player B", "Player C", "Player D"]],
      [null, 1, ["Player A", "Player E"]]
    ]);
    expect(parts[0]!.data.rows[0]).toMatchObject({ cells: ["PRESENT", "LATE"], unrecorded: 0, rate: 0.75 });
  });

  it("exports a grid with one column per raid, dated in the guild's timezone", async () => {
    const lines = seasonCsv((await load()).data, "America/Toronto").trim().split("\n");
    // Midnight UTC is still the evening before in Toronto.
    expect(lines[0]).toBe("member,rate_percent,present,late,benched,absent,unrecorded,2026-09-01 Karazhan,2026-09-08 Gruul,2026-09-09 Pug night");
    expect(lines[1]).toBe("Player A,75,1,1,0,0,1,P,L,?");
    expect(lines[4]).toBe("Player D,,0,0,0,0,1,?,,");
  });
});

describe("raid season summary and player history", () => {
  const window = { name: "Phase 2", from: new Date("2026-09-01T00:00:00Z"), until: null };

  it("shows one embed per core, best rate first, with the last raids as icons", async () => {
    const embeds = seasonSummaryEmbeds((await load()).data, window, "en").map((embed) => embed.toJSON());
    expect(embeds.map((embed) => embed.title)).toEqual(["🧾 Attendance — Phase 2 · Core A", "🧾 Attendance — Phase 2 · No core"]);
    const lines = embeds[0]!.description!.split("\n");
    expect(lines[0]).toContain("2 raids");
    expect(lines[1]).toBe("`100%` **Player C** 🪑1 · 🪑");
    expect(lines[2]).toBe("` 75%` **Player A** ✅1 ⏰1 · ✅⏰");
    expect(lines[4]).toBe("`   —` **Player D** ❓1 · ❓");
    expect(JSON.stringify(embeds)).not.toContain("<@");
  });

  it("stays inside Discord's message limit for a big roster and says when there is nothing", () => {
    const many = { raids: [{ id: "r", title: "Raid", scheduledAt: new Date("2026-09-02T00:00:00Z"), coreId: null, coreName: null }],
      rows: Array.from({ length: 200 }, (_, index) => ({ memberId: `m${index}`, name: `A fairly long player name ${index}`, discordUserId: `d${index}`, cells: ["PRESENT" as const], ...seasonTotals(["PRESENT"]) })) };
    const embed = seasonSummaryEmbeds(many, window, "fr")[0]!.toJSON();
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
    expect(embed.description).toContain("de plus");
    expect(embed.title).toBe("🧾 Présences — Phase 2");
    expect(seasonSummaryEmbeds({ raids: [], rows: [] }, window, "en")[0]!.toJSON().description).toContain("No completed raid");
  });

  it("lists one player's raids, newest first", async () => {
    const { data } = await load();
    const lines = playerHistoryEmbed(data, data.rows[0], window, "Player A", "en").toJSON().description!.trim().split("\n");
    expect(lines[0]).toBe("**75%** · ✅1 ⏰1 ❓1");
    expect(lines.slice(1).map((line) => line.replace(/<t:\d+:d> /, ""))).toEqual(["❓ Not recorded — Pug night", "⏰ Late — Gruul", "✅ Present — Karazhan"]);
    expect(playerHistoryEmbed(data, undefined, window, "Nobody", "fr").toJSON().description).toContain("Aucun raid");
  });
});

describe("starting a raid season", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  function store(seasons: Row[]) {
    const raidSeason = {
      findFirst: vi.fn(async (args: { where: { OR?: unknown } }) => (args.where.OR ? null : [...seasons].sort((a, b) => (b["startsAt"] as Date).getTime() - (a["startsAt"] as Date).getTime())[0] ?? null)),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(seasons.find((row) => row["id"] === where["id"])!, data)),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `s${seasons.length + 1}`, endsAt: null, ...data }; seasons.push(row); return row; })
    };
    return { $transaction: <T>(work: (tx: { raidSeason: typeof raidSeason }) => Promise<T>) => work({ raidSeason }) } as unknown as PrismaClient;
  }

  it("reads a start day as midnight in the guild's timezone and refuses anything else", () => {
    expect(parseSeasonStart("2026-09-01", "America/Toronto")).toEqual(new Date("2026-09-01T04:00:00Z"));
    expect(() => parseSeasonStart("sept 1", "America/Toronto")).toThrow(/YYYY-MM-DD/);
    expect(() => parseSeasonStart("2026-02-30", "America/Toronto")).toThrow(/YYYY-MM-DD/);
  });

  it("closes the running season where the new one starts", async () => {
    const seasons: Row[] = [{ id: "s1", name: "Phase 1", startsAt: new Date("2026-06-01T04:00:00Z"), endsAt: null }];
    const startsAt = new Date("2026-09-01T04:00:00Z");
    const created = await startSeason(store(seasons), { guildId: "guild", name: " Phase 2 ", startsAt, createdBy: "officer" }, now);
    expect(created).toMatchObject({ name: "Phase 2", startsAt, createdBy: "officer" });
    expect(seasons[0]!["endsAt"]).toEqual(startsAt);
  });

  it("refuses a season in the future, without a name, or starting before the latest one", async () => {
    const seasons: Row[] = [{ id: "s1", name: "Phase 1", startsAt: new Date("2026-06-01T04:00:00Z"), endsAt: null }];
    const input = { guildId: "guild", name: "Phase 2", createdBy: "officer" };
    await expect(startSeason(store(seasons), { ...input, startsAt: new Date("2026-11-01T00:00:00Z") }, now)).rejects.toThrow(/today or in the past/);
    await expect(startSeason(store(seasons), { ...input, name: "  ", startsAt: now }, now)).rejects.toThrow(/needs a name/);
    await expect(startSeason(store(seasons), { ...input, startsAt: new Date("2026-05-01T00:00:00Z") }, now)).rejects.toThrow(/must start after "Phase 1"/);
    expect(seasons).toHaveLength(1);
  });
});
