/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory stand-ins for the few Prisma calls each service makes */
import { afterEach, describe, expect, it, vi } from "vitest";
import { communitySeasonLabel } from "../src/services/community-display.js";
import { bgLadderCard, bgLadderEmbed, loadBgLadderData } from "../src/services/bg-ladder.js";
import { loadWorldPvpData, worldPvpCard, worldPvpEmbed, weekKeyOf } from "../src/services/world-pvp.js";
import { announceBlockedRaidSeasons, openOfficerSeasonNotice, resetRaidSeasonNotices, rotateRaidSeasons } from "../src/services/raid-season.js";
import { plannedSeason2Start, reminderDue, remindSeason2, resetSeason2ReminderDay, REMINDER_PREFIX } from "../src/services/season2-reminder.js";
import { rateSeason, ratingSeasonName, seasonOf, RATING_START } from "../src/services/duel-rating.js";
import { resetSeasonCalendar, setSeasonCalendar, refreshSeasonCalendar } from "../src/services/season-calendar.js";
import { seasonEndCard, seasonStartCard } from "../src/services/season-cards.js";

// Season 2 linked (owner decision, 16 November 2026): duels, battlegrounds, world PvP, Guilded Clash and raid attendance follow the
// official season calendar; community seasons stay monthly but no longer say "Season N". Clash and duel maths are covered in their own files.

const SEASON2 = new Date("2026-12-09T23:00:00.000Z");
afterEach(() => { resetSeasonCalendar(); resetSeason2ReminderDay(); vi.restoreAllMocks(); });

describe("community seasons are labelled by month, never Season N", () => {
  it("shows the month or theme only, in both languages", () => {
    expect(communitySeasonLabel({ name: "December 2026", number: 7 }, "en")).toBe("December 2026");
    expect(communitySeasonLabel({ name: "Season 7 — December 2026", number: 7 }, "en")).toBe("December 2026");
    expect(communitySeasonLabel({ name: "Season 7 — December 2026", number: 7 }, "fr")).toBe("Décembre 2026");
    expect(communitySeasonLabel({ name: "Décembre 2026", number: 7 }, "fr")).toBe("Décembre 2026");
    expect(communitySeasonLabel({ name: "Season 3", number: 3 }, "en")).toBe("Community season 3");
    expect(communitySeasonLabel({ name: "Saison 3", number: 3 }, "fr")).toBe("Saison communautaire 3");
  });
});

describe("official season cards read Season N / Saison N", () => {
  it("translates the stored name on the cards", () => {
    const info = { name: "Season 2", startsAt: SEASON2, endsAt: null };
    expect(seasonStartCard(info, "fr").title).toBe("Saison 2 commence");
    expect(seasonStartCard(info, "en").title).toBe("Season 2 begins");
    expect(seasonEndCard(info, null, "fr", new Map()).title).toBe("Saison 2 est terminée");
  });
});

describe("duels: the master calendar is read through refreshSeasonCalendar", () => {
  it("loads the OfficialSeason rows and switches the duel season at the official start", async () => {
    const findMany = vi.fn(async () => [{ number: 1, name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z") }, { number: 2, name: "Season 2", startsAt: SEASON2 }]);
    await refreshSeasonCalendar({ officialSeason: { findMany } } as never);
    expect(seasonOf(new Date("2026-12-09T22:59:59Z"), RATING_START).id).toBe("2026-11");
    expect(seasonOf(new Date("2026-12-09T23:00:00Z"), RATING_START).id).toBe("S2");
    expect(ratingSeasonName(seasonOf(new Date("2026-12-20T00:00:00Z"), RATING_START).id, "fr")).toBe("Saison 2");
    // A failed read keeps the old copy, a table-less double is ignored.
    await refreshSeasonCalendar({ officialSeason: { findMany: async () => { throw new Error("db"); } } } as never);
    await refreshSeasonCalendar({} as never);
    expect(seasonOf(new Date("2027-01-01T00:00:00Z"), RATING_START).id).toBe("S2");
    // Rating restarts: a duel after the change is rated in a fresh season.
    const duel = (iso: string) => ({ winnerKey: "a", loserKey: "b", winnerName: "A", loserName: "B", winnerLevel: 60, loserLevel: 60, endedAt: new Date(iso) });
    expect(rateSeason([duel("2026-12-10T10:00:00Z")]).players.get("a")!.games).toBe(1);
  });
});

describe("battlegrounds: the ladder counts the current official season", () => {
  const groups = [{ memberId: "m1", mode: "WSG", bracket: "10-19", outcome: "win", _count: { _all: 2 } }];
  const base = (season: any) => {
    const groupBy = vi.fn(async () => groups);
    return { groupBy, db: { battlegroundReport: { groupBy }, member: { findMany: async () => [{ id: "m1", displayName: "Kev", characters: [] }] },
      ...(season === undefined ? {} : { officialSeason: { findFirst: async () => season } }) } };
  };
  it("starts at the season start and labels it Season N", async () => {
    const { db, groupBy } = base({ number: 2, name: "Season 2", startsAt: SEASON2 });
    const data = await loadBgLadderData(db as never, "g1", "forever", new Date("2026-12-12T00:00:00Z"));
    expect((groupBy.mock.calls as any)[0][0].where.endedAt.gte).toEqual(SEASON2);
    expect(data.season?.number).toBe(2);
    expect(bgLadderCard(data, "en").subtitle).toContain("Season 2");
    expect(bgLadderCard(data, "fr").subtitle).toContain("Saison 2");
    expect(JSON.stringify(bgLadderEmbed(data, "fr").toJSON())).toContain("Saison 2");
  });
  it("falls back to the last 30 days, said plainly, when no season is running", async () => {
    const { db, groupBy } = base(null);
    const now = new Date("2026-12-12T00:00:00Z");
    const data = await loadBgLadderData(db as never, "g1", "forever", now);
    expect((groupBy.mock.calls as any)[0][0].where.endedAt.gte).toEqual(new Date(now.getTime() - 30 * 86_400_000));
    expect(data.season).toBeUndefined();
    expect(bgLadderCard(data, "en").subtitle).toContain("last 30 days");
  });
});

describe("world PvP: season totals beside the week", () => {
  it("sums the weeks of the official season and says Season N", async () => {
    const week = weekKeyOf(new Date("2026-12-12T00:00:00Z")), first = weekKeyOf(SEASON2);
    const rows = (where: any) => typeof where.weekKey === "number"
      ? [{ memberId: "m1", kills: 5, defends: 1, helped: 0, deaths: 2 }]
      : [{ memberId: "m1", kills: 5, defends: 1, helped: 0, deaths: 2 }, { memberId: "m1", kills: 7, defends: 0, helped: 1, deaths: 1 }, { memberId: "m2", kills: 20, defends: 0, helped: 0, deaths: 0 }];
    const findMany = vi.fn(async ({ where }: any) => rows(where));
    const db = { worldPvpWeek: { findMany }, member: { findMany: async () => [{ id: "m1", displayName: "Kev", characters: [] }, { id: "m2", displayName: "Zed", characters: [] }] },
      officialSeason: { findFirst: async () => ({ number: 2, name: "Season 2", startsAt: SEASON2 }) } };
    const data = await loadWorldPvpData(db as never, "g1", "forever", new Date("2026-12-12T00:00:00Z"));
    expect((findMany.mock.calls as any)[1][0].where.weekKey).toEqual({ gte: first, lte: week });
    expect(data.standings).toHaveLength(1);
    expect(data.season?.number).toBe(2);
    expect(data.season?.standings.map(row => [row.name, row.kills])).toEqual([["Zed", 20], ["Kev", 12]]);
    expect(worldPvpCard(data, "fr").subtitle).toContain("Saison 2");
    expect(JSON.stringify(worldPvpEmbed(data, "en").toJSON())).toContain("Season 2 totals");
  });
  it("is unchanged when no season is running", async () => {
    const db = { worldPvpWeek: { findMany: async () => [{ memberId: "m1", kills: 1, defends: 0, helped: 0, deaths: 0 }] }, member: { findMany: async () => [{ id: "m1", displayName: "Kev", characters: [] }] } };
    const data = await loadWorldPvpData(db as never, "g1", "forever", new Date("2026-12-12T00:00:00Z"));
    expect(data.season).toBeUndefined();
    expect(JSON.stringify(worldPvpEmbed(data, "en").toJSON())).not.toContain("totals");
  });
});

// ---- raids ----

interface Row { id: string; guildId: string; name: string; startsAt: Date; endsAt: Date | null; officialSeasonNumber: number | null; createdBy: string; guild?: { discordId: string } }
function raidWorld(initial: Row[], languages: Record<string, string> = {}) {
  const rows = [...initial];
  const matches = (row: Row, where: any): boolean => (where.guildId === undefined || row.guildId === where.guildId)
    && (where.officialSeasonNumber === undefined || row.officialSeasonNumber === where.officialSeasonNumber)
    && (!where.OR || where.OR.some((c: any) => c.id !== undefined ? row.id === c.id : row.name.toLowerCase() === String(c.name.equals).toLowerCase()));
  const raidSeason = {
    findMany: async () => { const seen = new Set<string>(); return rows.filter(r => !seen.has(r.guildId) && seen.add(r.guildId)).map(r => ({ guildId: r.guildId, guild: { discordId: `d-${r.guildId}` } })); },
    findFirst: async ({ where, orderBy }: any) => { const list = rows.filter(r => matches(r, where)); return (orderBy ? list.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()) : list)[0] ?? null; },
    update: async ({ where, data }: any) => { Object.assign(rows.find(r => r.id === where.id)!, data); },
    create: async ({ data }: any) => { rows.push({ id: `s${rows.length + 1}`, endsAt: null, officialSeasonNumber: null, ...data }); }
  };
  const db: any = { raidSeason, guildSettings: { findUnique: async ({ where }: any) => ({ language: languages[where.guildId] ?? "en" }) } };
  db.$transaction = async (fn: any) => fn(db);
  return { db, rows };
}
const manual = (guildId: string, name: string, startsAt: string, endsAt: string | null = null): Row => ({ id: `${guildId}-${name}`, guildId, name, startsAt: new Date(startsAt), endsAt: endsAt ? new Date(endsAt) : null, officialSeasonNumber: null, createdBy: "officer" });
const allowAll = () => true;
const NOW = new Date("2026-12-10T00:00:00Z");

describe("raid attendance seasons follow the official rotation", () => {
  it("starts Season 2 / Saison 2 for a guild that already uses raid seasons, and leaves other guilds alone", async () => {
    const w = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z"), manual("g2", "Automne", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")], { g2: "fr" });
    const out = await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    expect(out.map(o => [o.guildId, o.season])).toEqual([["g1", "Season 2"], ["g2", "Saison 2"]]);
    const created = w.rows.find(r => r.guildId === "g1" && r.officialSeasonNumber === 2)!;
    expect(created.startsAt).toEqual(SEASON2);
    expect(created.createdBy).toBe("Guilded");
    // An officer's own season is never closed or renamed.
    expect(w.rows.find(r => r.name === "Autumn")!.endsAt).toEqual(new Date("2026-12-01T00:00:00Z"));
  });
  it("does not touch a guild with no raid season, is idempotent and does nothing before the season starts", async () => {
    const w = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")]);
    await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    expect(await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever")).toEqual([]);
    expect(w.rows.filter(r => r.officialSeasonNumber === 2)).toHaveLength(1);
    const early = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")]);
    expect(await rotateRaidSeasons(early.db, { number: 2, start: SEASON2 }, new Date("2026-12-01T00:00:00Z"), allowAll, "forever")).toEqual([]);
    expect(await rotateRaidSeasons(early.db, { number: 1, start: new Date("2026-11-04T23:00:00Z") }, NOW, allowAll, "forever")).toEqual([]);
    const none = raidWorld([]);
    expect(await rotateRaidSeasons(none.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever")).toEqual([]);
  });
  it("closes the previous automatic season at the next official start, never an officer's, and respects a hosted allow-list", async () => {
    const w = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")]);
    await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    const march = new Date("2027-03-02T00:00:00Z");
    const out = await rotateRaidSeasons(w.db, { number: 3, start: march }, new Date("2027-03-03T00:00:00Z"), allowAll, "forever");
    expect(out).toEqual([{ guildId: "g1", season: "Season 3", ended: "Season 2" }]);
    expect(w.rows.find(r => r.officialSeasonNumber === 2)!.endsAt).toEqual(march);
    const blocked = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")]);
    expect(await rotateRaidSeasons(blocked.db, { number: 2, start: SEASON2 }, NOW, () => false, "forever")).toEqual([]);
  });
  it("skips a guild whose officer already made a season with that name or started one after the official start", async () => {
    const named = raidWorld([manual("g1", "Season 2", "2026-12-01T00:00:00Z")]);
    expect(await rotateRaidSeasons(named.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever")).toEqual([]);
    const later = raidWorld([manual("g1", "Naxx", "2026-12-09T23:30:00Z")]);
    expect(await rotateRaidSeasons(later.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever")).toEqual([]);
  });
});

describe("an officer's open-ended raid season", () => {
  it("is not overlapped: no automatic season, one officer-log notice per guild and official season", async () => {
    resetRaidSeasonNotices();
    const w = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z"), manual("g2", "Automne", "2026-09-01T00:00:00Z"), manual("g3", "Closed", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")], { g2: "fr" });
    const out = await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    expect(w.rows.filter(r => r.officialSeasonNumber === 2).map(r => r.guildId)).toEqual(["g3"]);
    expect(out.filter(o => o.blockedBy).map(o => [o.guildId, o.blockedBy])).toEqual([["g1", "Autumn"], ["g2", "Automne"]]);
    const posted: [string, string][] = [];
    const post = async (id: string, text: string) => { posted.push([id, text]); };
    expect(await announceBlockedRaidSeasons(out, 2, post)).toBe(2);
    expect(posted[0]![1]).toBe(openOfficerSeasonNotice("en", "Autumn", "Season 2"));
    expect(posted[0]![1]).toContain("/lead season");
    expect(posted[1]![1]).toContain("Saison 2");
    // The next ticks: still blocked, no second notice. A new official season gets its own.
    const again = await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    expect(await announceBlockedRaidSeasons(again, 2, post)).toBe(0);
    expect(posted).toHaveLength(2);
    expect(await announceBlockedRaidSeasons(again, 3, post)).toBe(2);
  });
  it("once the officer closes it, the next tick starts the automatic season", async () => {
    const w = raidWorld([manual("g1", "Autumn", "2026-09-01T00:00:00Z")]);
    await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    expect(w.rows.some(r => r.officialSeasonNumber === 2)).toBe(false);
    w.rows[0]!.endsAt = new Date("2026-12-09T23:00:00Z");
    const out = await rotateRaidSeasons(w.db, { number: 2, start: SEASON2 }, NOW, allowAll, "forever");
    expect(out.map(o => o.season)).toEqual(["Season 2"]);
  });
});

// ---- the owner reminder ----

function reminderWorld(opts: { next?: boolean; started?: boolean; recent?: any[] } = {}) {
  const send = vi.fn(async () => undefined);
  const dm = { send, messages: { fetch: vi.fn(async () => ({ some: (fn: (m: any) => boolean) => (opts.recent ?? []).some(fn) })) } };
  const client: any = { user: { id: "bot" }, users: { fetch: async () => ({ createDM: async () => dm }) } };
  const db: any = { officialSeason: { findFirst: async ({ where }: any) => where.startsAt?.gt ? (opts.next ? { number: 2 } : null) : (opts.started ? { number: 2 } : null) } };
  return { client, db, send };
}
const owner = async () => "owner-1";
const quiet = () => undefined;

describe("the Season 2 owner reminder", () => {
  it("knows the planned start: 9 December 2026, 15:00 Pacific", () => {
    expect(plannedSeason2Start().toISOString()).toBe("2026-12-09T23:00:00.000Z");
  });
  it("is due only from 7 days before while nothing later is scheduled or running", () => {
    const planned = plannedSeason2Start();
    expect(reminderDue(new Date("2026-12-01T00:00:00Z"), planned, false, false)).toBe(false);
    expect(reminderDue(new Date("2026-12-02T23:00:00Z"), planned, false, false)).toBe(true);
    expect(reminderDue(new Date("2026-12-09T20:00:00Z"), planned, false, false)).toBe(true);
    expect(reminderDue(new Date("2026-12-12T20:00:00Z"), planned, false, false)).toBe(true); // overdue still reminds
    expect(reminderDue(new Date("2026-12-05T00:00:00Z"), planned, true, false)).toBe(false);
    expect(reminderDue(new Date("2026-12-12T00:00:00Z"), planned, false, true)).toBe(false);
  });
  it("sends one DM a day, only when unscheduled, and logs a warning", async () => {
    const w = reminderWorld();
    const log = vi.fn();
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-04T10:00:00Z"), log)).toBe(true);
    expect(w.send).toHaveBeenCalledTimes(1);
    expect((w.send.mock.calls as any)[0][0].content).toContain(REMINDER_PREFIX);
    expect((w.send.mock.calls as any)[0][0].content).toContain("season2-activate");
    expect(log).toHaveBeenCalledTimes(1);
    // Same day again (the next tick): nothing. The next day: one more.
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-04T11:00:00Z"), log)).toBe(false);
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-05T10:00:00Z"), log)).toBe(true);
    expect(w.send).toHaveBeenCalledTimes(2);
  });
  it("stays quiet far ahead, once scheduled, once started, and after a restart that day (the DM is already there)", async () => {
    const far = reminderWorld();
    expect(await remindSeason2(far.client, far.db, owner, new Date("2026-11-20T10:00:00Z"), quiet)).toBe(false);
    const scheduled = reminderWorld({ next: true });
    expect(await remindSeason2(scheduled.client, scheduled.db, owner, new Date("2026-12-05T10:00:00Z"), quiet)).toBe(false);
    const started = reminderWorld({ started: true });
    expect(await remindSeason2(started.client, started.db, owner, new Date("2026-12-12T10:00:00Z"), quiet)).toBe(false);
    const restarted = reminderWorld({ recent: [{ author: { id: "bot" }, createdTimestamp: Date.parse("2026-12-05T08:00:00Z"), content: `${REMINDER_PREFIX}\nearlier` }] });
    expect(await remindSeason2(restarted.client, restarted.db, owner, new Date("2026-12-05T10:00:00Z"), quiet)).toBe(false);
    for (const w of [far, scheduled, started, restarted]) expect(w.send).not.toHaveBeenCalled();
  });
  it("tries again on the next tick when the owner cannot be found, and never throws", async () => {
    const w = reminderWorld();
    expect(await remindSeason2(w.client, w.db, async () => null, new Date("2026-12-05T10:00:00Z"), quiet)).toBe(false);
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-05T10:05:00Z"), quiet)).toBe(true);
    const broken = reminderWorld();
    broken.client.users.fetch = async () => { throw new Error("closed"); };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetSeason2ReminderDay();
    expect(await remindSeason2(broken.client, broken.db, owner, new Date("2026-12-05T10:00:00Z"), quiet)).toBe(false);
  });
  it("tries a failing DM once a day, not on every tick", async () => {
    const w = reminderWorld();
    const fetch = vi.fn(async () => { throw new Error("Cannot send messages to this user"); });
    w.client.users.fetch = fetch;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetSeason2ReminderDay();
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-05T10:00:00Z"), quiet)).toBe(false);
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-05T10:05:00Z"), quiet)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(await remindSeason2(w.client, w.db, owner, new Date("2026-12-06T10:00:00Z"), quiet)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// A calendar helper used above, kept here so a regression in setSeasonCalendar is caught beside the ladders that rely on it.
describe("setSeasonCalendar", () => {
  it("accepts OfficialSeason-shaped rows and sorts them", () => {
    setSeasonCalendar([{ number: 3, startsAt: new Date("2027-03-02T00:00:00Z") }, { number: 2, startsAt: SEASON2 }]);
    expect(seasonOf(new Date("2027-03-02T00:00:00Z"), RATING_START).id).toBe("S3");
    expect(seasonOf(new Date("2027-03-01T00:00:00Z"), RATING_START).id).toBe("S2");
  });
});
