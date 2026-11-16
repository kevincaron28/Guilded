import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ officer: vi.fn(() => true), update: vi.fn(async () => ({})), findSnapshots: vi.fn(async () => [] as unknown[]) }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.officer }));
vi.mock("../src/database.js", () => ({ prisma: {
  guildSettings: { findUnique: async () => ({ statsEnabled: true, statsFeedKeyHash: null, statsFeedKeyAt: null }), update: mocks.update },
  guildStatSnapshot: { findMany: mocks.findSnapshots }
} }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: async () => ({ guildId: "g1" }), guildService: { getSettings: async () => ({ language: "en" }) } }));

import { buildTrend, isTrendPostDue, memberTrendCard, postWeeklyMemberTrend, trendDelta } from "../src/services/member-trend.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { executeStatsFeed, statsFeedCommand } from "../src/commands/stats-feed.js";
import type { StatSnapshot } from "../src/services/stat-snapshots.js";

const row = (day: string, over: Partial<StatSnapshot> = {}): StatSnapshot => ({ day, discordMembers: 100, activeMembers: 20, linkedMembers: 50, rosterSize: 60, onlinePeak: 5, level60: 3,
  messages: 0, voiceMinutes: 0, raids: 0, dungeonRuns: 0, inGuildMembers: 80, joins: 1, leaves: 0, levelBands: {}, classCounts: {}, ...over });
const days = (n: number, build: (i: number) => Partial<StatSnapshot>) => Array.from({ length: n }, (_, i) => row(new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10), build(i)));

describe("member trend data", () => {
  it("computes deltas against the snapshot on or before N days earlier, and null when unknown", () => {
    const rows = days(40, i => ({ inGuildMembers: 100 + i, discordMembers: 200 - i }));
    expect(trendDelta(rows, r => r.inGuildMembers, 7)).toBe(7);
    expect(trendDelta(rows, r => r.discordMembers, 30)).toBe(-30);
    expect(trendDelta(rows, r => r.inGuildMembers, 90)).toBeNull();
    expect(trendDelta(days(10, i => ({ inGuildMembers: i < 5 ? null : 50 })), r => r.inGuildMembers, 7)).toBeNull();
  });

  it("limits the lines to the window and shows tiles with signed deltas", () => {
    const rows = days(60, i => ({ inGuildMembers: 100 - i }));
    const trend = buildTrend(rows, 30, "en");
    expect(trend.days).toHaveLength(30);
    expect(trend.emptyNote).toBeUndefined();
    const tile = trend.tiles[0]!;
    expect(tile.value).toBe("41");
    expect(tile.deltas.map(d => d.text)).toEqual(["-7", "-30", "—"]);
    expect(tile.deltas[0]!.tone).toBe("red");
    expect(trend.tiles[1]!.deltas[0]).toMatchObject({ text: "0", tone: "muted" });
  });

  it("says when the trend starts with fewer than two days (EN and FR)", () => {
    expect(buildTrend([], 30, "en", new Date("2026-11-16T10:00:00Z")).emptyNote).toBe("Trend starts 2026-11-17");
    expect(buildTrend([row("2026-11-16")], 30, "fr").emptyNote).toBe("La tendance commence le 2026-11-17");
    expect(buildTrend([row("2026-11-16")], 30, "en").tiles[0]!.value).toBe("80");
  });

  it("shows unknown in-game numbers as a dash", () => {
    const trend = buildTrend(days(3, () => ({ inGuildMembers: null })), 30, "fr");
    expect(trend.tiles[0]!.value).toBe("—");
    expect(trend.tiles[0]!.label).toBe("Membres en jeu");
  });

  it("renders a PNG with 0, 1 and many rows", async () => {
    for (const n of [0, 1, 45]) {
      const png = await scoreCardPng(memberTrendCard(days(n, i => ({ inGuildMembers: 80 + (i % 5) })), 30, "Québec Gold", "en", new Date("2026-11-16T00:00:00Z")));
      expect(png?.subarray(1, 4).toString()).toBe("PNG");
    }
  }, 60_000);

  it("totals joins and leaves in the footer", () => {
    const card = memberTrendCard(days(3, () => ({ joins: 2, leaves: 1 })), 30, "G", "en");
    expect(card.footer).toContain("joins 6");
    expect(card.footer).toContain("leaves 3");
  });
});

describe("weekly member-trend post", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const base = { memberTrendPostEnabled: true, statsEnabled: true, logChannelId: "c1", memberTrendLastPostAt: null, weeklyReportEnabled: false, weeklyReportLastAt: null };
  it("respects the switch, statistics and the log channel", () => {
    expect(isTrendPostDue(base, now)).toBe(true);
    expect(isTrendPostDue({ ...base, memberTrendPostEnabled: false }, now)).toBe(false);
    expect(isTrendPostDue({ ...base, statsEnabled: false }, now)).toBe(false);
    expect(isTrendPostDue({ ...base, logChannelId: null }, now)).toBe(false);
  });
  it("waits for the weekly report and posts once per week", () => {
    expect(isTrendPostDue({ ...base, weeklyReportEnabled: true, weeklyReportLastAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe(false);
    expect(isTrendPostDue({ ...base, weeklyReportEnabled: true, weeklyReportLastAt: new Date("2026-11-18T01:00:00Z") }, now)).toBe(true);
    expect(isTrendPostDue({ ...base, memberTrendLastPostAt: new Date("2026-11-18T10:00:00Z") }, now)).toBe(false);
    expect(isTrendPostDue({ ...base, memberTrendLastPostAt: new Date("2026-11-01T10:00:00Z") }, now)).toBe(true);
  });
  it("posts the card to the log channel, then records the week; stays quiet before two days of data", async () => {
    const send = vi.fn(async () => ({}));
    const guild = { id: "d1", name: "QG", channels: { fetch: async () => ({ isTextBased: () => true, send }) } };
    const settings = { ...base, language: "en" };
    const update = vi.fn(async () => ({}));
    const snapshots = vi.fn(async () => [] as unknown[]);
    const db = { guild: { findUnique: async () => ({ id: "g1", settings }) }, guildSettings: { update }, guildStatSnapshot: { findMany: snapshots } } as never;
    expect(await postWeeklyMemberTrend(db, guild as never, now)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    snapshots.mockResolvedValue([...days(5, () => ({}))].reverse());
    expect(await postWeeklyMemberTrend(db, guild as never, now)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { memberTrendLastPostAt: now } });
  }, 60_000);
});

describe("/officer stats trend", () => {
  beforeEach(() => { mocks.officer.mockReturnValue(true); mocks.update.mockClear(); });
  const interaction = (options: { weekly?: boolean | null; days?: number | null }) => {
    const reply = vi.fn(async (...args: unknown[]) => void args.length), deferReply = vi.fn(async () => undefined), editReply = vi.fn(async () => undefined);
    return { reply, deferReply, editReply, member: {}, guild: { name: "QG" }, options: { getSubcommand: () => "trend", getBoolean: () => options.weekly ?? null, getInteger: () => options.days ?? null } };
  };
  it("lists the subcommand with 30 and 90 day choices", () => {
    const sub = statsFeedCommand.toJSON().options!.find(o => o.name === "trend") as unknown as { options: { name: string; choices?: { value: number }[] }[] };
    expect(sub.options.find(o => o.name === "days")!.choices!.map(c => c.value)).toEqual([30, 90]);
  });
  it("refuses everyone but officers", async () => {
    mocks.officer.mockReturnValue(false);
    const i = interaction({});
    await executeStatsFeed(i as never);
    expect(i.reply.mock.calls[0]![0]).toMatchObject({ content: "Only officers can manage statistics." });
    expect(i.deferReply).not.toHaveBeenCalled();
  });
  it("shows the card privately", async () => {
    const i = interaction({ days: 90 });
    await executeStatsFeed(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
    expect(i.editReply).toHaveBeenCalled();
  }, 60_000);
  it("switches the weekly post off", async () => {
    const i = interaction({ weekly: false });
    await executeStatsFeed(i as never);
    expect(mocks.update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { memberTrendPostEnabled: false } });
  });
});
