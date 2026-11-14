import { describe, expect, it, vi } from "vitest";
import { weekKeyOf, weekRange, type WorldPvpStanding } from "../src/services/world-pvp.js";
import {
  clean, deliverWeeklyRecap, extrasFields, extrasSwitches, hotZones, knownNameSet, loadWeekCalls, mostWanted, recapText,
  scheduleWeeklyRecap, weekRecap, pvpPostChannelId, type WeekCall
} from "../src/services/world-pvp-extras.js";

const at = (iso: string) => new Date(iso);
const call = (zone: string, attackers: { name: string; class?: string }[], extra: Partial<WeekCall> = {}): WeekCall =>
  ({ memberId: "m1", character: "Aria Vale", zone, attackers, calledAt: at("2026-11-10T20:00:00Z"), clearedAt: null, ...extra });
const standing = (name: string, kills: number, defends: number, helped: number): WorldPvpStanding => ({ memberId: name, name, kills, defends, helped });

describe("hot zones and most wanted", () => {
  const calls = [
    call("Duskwood", [{ name: "Gank", class: "Rogue" }, { name: "Slyfox", class: "Rogue" }]),
    call("duskwood", [{ name: "gank", class: "Mage" }], { memberId: "m2" }),
    call("Duskwood", [{ name: "Gank", class: "Rogue" }, { name: "Gank", class: "Rogue" }], { memberId: "m3" }),
    call("Stranglethorn Vale", [{ name: "Slyfox" }]),
    call("?", [])
  ];
  it("counts calls per zone, ignores the case and unknown zones, and lists attackers' classes", () => {
    const zones = hotZones(calls);
    expect(zones.map((z) => [z.zone, z.calls])).toEqual([["Duskwood", 3], ["Stranglethorn Vale", 1]]);
    expect(zones[0]!.classes[0]).toEqual({ className: "Rogue", count: 4 });
  });
  it("names an enemy only after three different calls, once per call, nothing but the name", () => {
    expect(mostWanted(calls)).toEqual([{ name: "Gank", calls: 3 }]);
    expect(mostWanted(calls.slice(0, 2))).toEqual([]);
  });
  it("needs two different reporting members: three calls from one member name nobody", () => {
    const oneMember = [1, 2, 3].map(() => call("Duskwood", [{ name: "Gank" }]));
    expect(mostWanted(oneMember)).toEqual([]);
    expect(mostWanted([...oneMember.slice(0, 2), call("Duskwood", [{ name: "Gank" }], { memberId: "m2" })])).toEqual([{ name: "Gank", calls: 3 }]);
  });
  it("never lists a guild character, by full name or by the first name an attacker line carries", () => {
    const known = knownNameSet(["Gank Heavyhand", "Bo Ren"]);
    expect(mostWanted(calls, known)).toEqual([]);
    expect(mostWanted(calls, knownNameSet(["Someone Else"]))).toHaveLength(1);
  });
  it("neutralises links, mentions and markdown in every shown string", () => {
    expect(clean("discord.gg/x")).not.toMatch(/[./:]/);
    expect(clean("http://evil.example/a")).not.toContain("//");
    expect(clean("<@123> **bold**")).not.toMatch(/[<>@]/);
    const evil = [1, 2, 3].map((i) => call("discord.gg/zone", [{ name: "free.nitro/gift", class: "x.com" }], { memberId: `m${i}` }));
    const fields = extrasFields({ switches: extrasSwitches({ pvpHotZonesEnabled: true, pvpMostWantedEnabled: true }), standings: [], calls: evil }, "en");
    expect(fields.length).toBe(2);
    for (const f of fields) expect(f.value).not.toMatch(/\w\.\w|\/|:\/\//);
  });
});

describe("recap and board lines", () => {
  const standings = [standing("Aria Vale", 40, 2, 9), standing("Bo Ren", 12, 7, 3), standing("Cy Dell", 0, 0, 12)];
  it("picks a winner per category and the quickest cleared call", () => {
    const calls = [call("Duskwood", [], { clearedAt: at("2026-11-10T20:05:00Z") }), call("Westfall", [], { character: "Bo Ren", clearedAt: at("2026-11-10T20:00:40Z") })];
    const recap = weekRecap(standings, calls);
    expect([recap.killer?.name, recap.defender?.name, recap.helper?.name]).toEqual(["Aria Vale", "Bo Ren", "Cy Dell"]);
    expect(recap.quickest).toMatchObject({ character: "Bo Ren", zone: "Westfall", seconds: 40 });
    expect(weekRecap([], []).killer).toBeNull();
  });
  it("shows only the switched-on sections, in English and French", () => {
    const calls = [1, 2, 3].map((i) => call("Duskwood", [{ name: "Gank", class: "Rogue" }], { memberId: `m${i}` }));
    // On by default: a server with no saved choice (or null columns) gets all three; an officer's false switches one off.
    expect(extrasSwitches({})).toEqual({ recap: true, hotZones: true, mostWanted: true });
    expect(extrasSwitches({ pvpRecapEnabled: false, pvpHotZonesEnabled: false, pvpMostWantedEnabled: false })).toEqual({ recap: false, hotZones: false, mostWanted: false });
    expect(extrasFields({ switches: extrasSwitches({ pvpRecapEnabled: false, pvpHotZonesEnabled: false, pvpMostWantedEnabled: false }), standings, calls }, "en")).toEqual([]);
    const en = extrasFields({ switches: extrasSwitches({ pvpRecapEnabled: true, pvpHotZonesEnabled: true, pvpMostWantedEnabled: true }), standings, calls }, "en");
    expect(en.map((f) => f.name)).toEqual(["🛡️ Defender of the week", "🔥 Hot zones this week", "🎯 Most wanted"]);
    expect(en[2]!.value).toBe("Gank — seen in 3 calls");
    expect(extrasFields({ switches: extrasSwitches({ pvpRecapEnabled: false, pvpHotZonesEnabled: false }), standings, calls }, "fr")[0]!.name).toBe("🎯 Les plus recherchés");
    expect(recapText(weekRecap(standings, []), "fr")).toContain("Défenseur de la semaine");
    // Deaths: no line until an addon sent some; then one guild total line, in both languages.
    expect(recapText(weekRecap(standings, []), "en")).not.toContain("deaths");
    const withDeaths = [{ ...standing("Aria Vale", 40, 2, 9), deaths: 10 }, { ...standing("Bo Ren", 12, 7, 3), deaths: 3 }];
    expect(recapText(weekRecap(withDeaths, []), "en")).toContain("The guild's open-world deaths: **13** (K/D 4.0)");
    expect(recapText(weekRecap(withDeaths, []), "fr")).toContain("Morts de la guilde en monde ouvert : **13**".replace(" :", ":"));
    expect(weekRecap(withDeaths, []).killer?.name).toBe("Aria Vale");
  });
  it("routes posts to the group finder, else the PvP groups channel, else the ladder channel", () => {
    expect(pvpPostChannelId({ dungeonSignupChannelId: "f", bgGroupsChannelId: "g", bgStatsChannelId: "l" })).toBe("f");
    expect(pvpPostChannelId({ unifiedGroupFinder: false, dungeonSignupChannelId: "f", bgGroupsChannelId: "g" })).toBe("g");
    expect(pvpPostChannelId({ bgStatsChannelId: "l" })).toBe("l");
  });
  it("loads the newest 500 calls of a busy week", async () => {
    const findMany = vi.fn(async () => []);
    await loadWeekCalls({ guildHelpCall: { findMany } } as never, "g1", 1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { calledAt: "desc" }, take: 500 }));
  });
});

// A small in-memory GuildHelpCall table that understands the filters the post code uses, so the real ordering and limits run.
interface Row { id: string; guildId: string; memberId: string; character: string; zone: string; mapId: number | null; calledAt: Date; clearedAt: Date | null; postChannelId: string | null; postMessageId: string | null }
function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, want] of Object.entries(where)) {
    const have = (row as unknown as Record<string, unknown>)[key];
    if (want === null) { if (have !== null) return false; continue; }
    if (want instanceof Date || typeof want !== "object") { if (have !== want) return false; continue; }
    const w = want as { not?: unknown; gte?: Date };
    if ("not" in w && (w.not === null ? have === null : have === w.not)) return false;
    if (w.gte && !(have instanceof Date && have >= w.gte)) return false;
  }
  return true;
}
function world(settings: Record<string, unknown> | null, rows: Row[], hooks: { onSend?: () => void; failSend?: unknown } = {}) {
  const messages = new Map<string, { content: string; editable: boolean; edit: (o: { content: string }) => Promise<void> }>();
  let n = 0;
  const send = vi.fn(async ({ content }: { content: string }) => {
    if (hooks.failSend) throw hooks.failSend;
    hooks.onSend?.();
    const id = `msg${++n}`;
    const message = { content, editable: true, edit: async (o: { content: string }) => { message.content = o.content; } };
    messages.set(id, message);
    return { id };
  });
  const channel = { id: "ch1", isTextBased: () => true, send, messages: { fetch: async (id: string) => { const m = messages.get(id); if (!m) throw Object.assign(new Error("gone"), { code: 10008 }); return m; } } };
  const discordGuild = { id: "d1", channels: { fetch: async () => channel } } as never;
  const db = {
    guild: { findUnique: vi.fn(async () => ({ id: "g1", gameEdition: "forever" })) },
    guildSettings: { findUnique: vi.fn(async () => settings), updateMany: vi.fn(async () => ({ count: 1 })) },
    guildHelpCall: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (() => { const r = rows.find((x) => x.id === where.id); return r ? { ...r } : null; })()),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where))),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).length),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data))
    },
    character: { findMany: vi.fn(async () => []) }, unclaimedCharacter: { findMany: vi.fn(async () => []) }, guildRosterEntry: { findMany: vi.fn(async () => []) },
    member: { findMany: vi.fn(async () => [{ id: "m", displayName: "Aria Vale", characters: [] }]) },
    worldPvpWeek: { findMany: vi.fn(async () => [{ memberId: "m", kills: 5, defends: 1, helped: 2 }]) },
    discordJob: { upsert: vi.fn(async () => ({ id: "j" })), update: vi.fn(), findUnique: vi.fn(async () => null) }
  };
  return { db: db as never, raw: db, discordGuild, send, messages, rows };
}
const NOW = at("2026-11-10T20:01:00Z");

describe("weekly recap", () => {
  const afterReset = new Date(weekRange(weekKeyOf(NOW) + 1).from.getTime() + 7 * 3_600_000);
  const week = weekKeyOf(afterReset) - 1;
  const settings = (extra: Record<string, unknown> = {}) => ({ pvpRecapEnabled: true, worldPvpEnabled: true, bgStatsChannelId: "ch1", language: "en", pvpRecapLastWeek: week - 1, ...extra });
  it("is on by default, switches off, waits for the reset plus six hours, and queues once", async () => {
    const off = world(settings({ pvpRecapEnabled: false }), []);
    expect(await scheduleWeeklyRecap(off.db, "d1", afterReset)).toBe(false);
    const early = world(settings(), []);
    expect(await scheduleWeeklyRecap(early.db, "d1", new Date(afterReset.getTime() - 3 * 3_600_000))).toBe(false);
    const w = world(settings(), []);
    expect(await scheduleWeeklyRecap(w.db, "d1", afterReset)).toBe(true);
    expect(w.raw.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId_key: { guildId: "g1", key: `pvp-recap:${week}` } } }));
    const done = world(settings({ pvpRecapLastWeek: week }), []);
    expect(await scheduleWeeklyRecap(done.db, "d1", afterReset)).toBe(false);
  });
  it("does not post last week's recap for an officer who just turned it on", async () => {
    const w = world(settings({ pvpRecapLastWeek: null }), []);
    expect(await scheduleWeeklyRecap(w.db, "d1", afterReset)).toBe(false);
    expect(w.raw.guildSettings.updateMany).toHaveBeenCalledWith({ where: { guildId: "g1", pvpRecapLastWeek: null }, data: { pvpRecapLastWeek: week } });
    expect(w.raw.discordJob.upsert).not.toHaveBeenCalled();
  });
  it("does not retry a missing channel every tick: the week is claimed before anything is sent", async () => {
    const w = world(settings({ bgStatsChannelId: null, dungeonSignupChannelId: null }), []);
    expect(await scheduleWeeklyRecap(w.db, "d1", afterReset)).toBe(true);
    expect(await deliverWeeklyRecap(w.discordGuild, w.db, "g1", week)).toBe(false);
    expect(w.send).not.toHaveBeenCalled();
  });
  it("treats an unset switch as on, and posts nothing for a week with no PvP activity", async () => {
    const unset: Record<string, unknown> = settings();
    delete unset["pvpRecapEnabled"];
    const w = world(unset, []);
    expect(await scheduleWeeklyRecap(w.db, "d1", afterReset)).toBe(true);
    (w.raw.worldPvpWeek.findMany as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([]);
    expect(await deliverWeeklyRecap(w.discordGuild, w.db, "g1", week)).toBe(false);
    expect(w.send).not.toHaveBeenCalled();
  });
  it("posts nothing for a week that ended before the baseline (the week the migration set)", async () => {
    const w = world(settings({ pvpRecapLastWeek: week }), []);
    expect(await scheduleWeeklyRecap(w.db, "d1", afterReset)).toBe(false);
    expect(w.raw.discordJob.upsert).not.toHaveBeenCalled();
  });
  it("delivers the finished week's recap", async () => {
    const w = world(settings(), []);
    expect(await deliverWeeklyRecap(w.discordGuild, w.db, "g1", week)).toBe(true);
    expect(w.send).toHaveBeenCalledTimes(1);
  });
  it("falls back to the text recap when the card cannot be sent (no Attach Files, 50013), and the week is not lost", async () => {
    const w = world(settings(), []);
    w.send.mockRejectedValueOnce(Object.assign(new Error("Missing Permissions"), { code: 50013 })).mockResolvedValue({ id: "m1" });
    expect(await deliverWeeklyRecap(w.discordGuild, w.db, "g1", week)).toBe(true);
    expect(w.send).toHaveBeenCalledTimes(2);
    const [first, second] = w.send.mock.calls.map(call => call[0] as { content?: string; files?: unknown[] });
    expect(first!.files).toHaveLength(1);
    expect(second!.content).toContain("World PvP");
    expect(second!.files).toBeUndefined();
  });
});
