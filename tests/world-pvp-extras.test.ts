import { describe, expect, it, vi } from "vitest";
import { applyGuildMapUpload } from "../src/services/guild-map.js";
import { weekKeyOf, weekRange, type WorldPvpStanding } from "../src/services/world-pvp.js";
import {
  callPostText, clean, deliverWeeklyRecap, extrasFields, extrasSwitches, hotZones, knownNameSet, loadWeekCalls, mostWanted, queueCallPost, recapText,
  scheduleWeeklyRecap, syncCallPost, weekRecap, zoneKeyOf, pvpPostChannelId, type WeekCall
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
    expect(callPostText("en", "a.b/c", "discord.gg/x")).not.toMatch(/\w\.\w|discord\.gg/);
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
    expect(extrasFields({ switches: extrasSwitches({}), standings, calls }, "en")).toEqual([]);
    const en = extrasFields({ switches: extrasSwitches({ pvpRecapEnabled: true, pvpHotZonesEnabled: true, pvpMostWantedEnabled: true }), standings, calls }, "en");
    expect(en.map((f) => f.name)).toEqual(["🛡️ Defender of the week", "🔥 Hot zones this week", "🎯 Most wanted"]);
    expect(en[2]!.value).toBe("Gank — seen in 3 calls");
    expect(extrasFields({ switches: extrasSwitches({ pvpMostWantedEnabled: true }), standings, calls }, "fr")[0]!.name).toBe("🎯 Les plus recherchés");
    expect(recapText(weekRecap(standings, []), "fr")).toContain("Défenseur de la semaine");
  });
  it("words a call post and its cleared edit in both languages", () => {
    expect(callPostText("en", "Aria Vale", "Duskwood")).toBe("⚔️ **Aria Vale** called for help in **Duskwood**");
    expect(callPostText("fr", "Aria Vale", "Duskwood", true)).toContain("Alerte levée");
    expect(callPostText("en", "A", "Z", true)).toContain("~~");
  });
  it("routes posts to the group finder, else the PvP groups channel, else the ladder channel", () => {
    expect(pvpPostChannelId({ dungeonSignupChannelId: "f", bgGroupsChannelId: "g", bgStatsChannelId: "l" })).toBe("f");
    expect(pvpPostChannelId({ unifiedGroupFinder: false, dungeonSignupChannelId: "f", bgGroupsChannelId: "g" })).toBe("g");
    expect(pvpPostChannelId({ bgStatsChannelId: "l" })).toBe("l");
  });
  it("matches a zone by map id, else by name without case or accents", () => {
    expect(zoneKeyOf({ mapId: 1431, zone: "Duskwood" })).toBe(zoneKeyOf({ mapId: 1431, zone: "Bois de la Pénombre" }));
    expect(zoneKeyOf({ zone: "Bois de la Pénombre" })).toBe(zoneKeyOf({ zone: "bois  de la penombre" }));
    expect(zoneKeyOf({ zone: "Westfall" })).not.toBe(zoneKeyOf({ zone: "Duskwood" }));
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
const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, guildId: "g1", memberId: "m1", character: "Aria Vale", zone: "Duskwood", mapId: 1431, calledAt: at("2026-11-10T20:00:00Z"), clearedAt: null, postChannelId: null, postMessageId: null, ...extra });
const on = { pvpCallPostsEnabled: true, worldPvpEnabled: true, dungeonSignupChannelId: "ch1", language: "en" };

describe("call posts", () => {
  it("posts nothing until an officer turns it on", async () => {
    const w = world({ ...on, pvpCallPostsEnabled: false }, [row("c1")]);
    expect(await syncCallPost(w.discordGuild, w.db, "c1", NOW)).toBe(false);
    expect(await queueCallPost(w.db as never, { id: "c1", guildId: "g1" })).toBe(false);
    expect(w.send).not.toHaveBeenCalled();
    expect(w.raw.discordJob.upsert).not.toHaveBeenCalled();
  });
  it("queues one job per call when on", async () => {
    const w = world(on, [row("c1")]);
    expect(await queueCallPost(w.db as never, { id: "c1", guildId: "g1" })).toBe(true);
    expect(w.raw.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId_key: { guildId: "g1", key: "pvp-call:c1" } } }));
  });
  it("posts a live call once and remembers the message", async () => {
    const w = world(on, [row("c1")]);
    expect(await syncCallPost(w.discordGuild, w.db, "c1", NOW)).toBe(true);
    expect(w.send).toHaveBeenCalledTimes(1);
    expect(w.rows[0]).toMatchObject({ postChannelId: "ch1", postMessageId: "msg1" });
  });
  it("never posts a call that is already cleared or too old", async () => {
    const cleared = world(on, [row("c1", { clearedAt: at("2026-11-10T20:00:30Z") })]);
    expect(await syncCallPost(cleared.discordGuild, cleared.db, "c1", NOW)).toBe(false);
    const old = world(on, [row("c1")]);
    expect(await syncCallPost(old.discordGuild, old.db, "c1", at("2026-11-10T21:00:00Z"))).toBe(false);
    expect(cleared.send).not.toHaveBeenCalled();
    expect(old.send).not.toHaveBeenCalled();
  });
  it("edits the post to cleared when the all clear comes later", async () => {
    const w = world(on, [row("c1")]);
    await syncCallPost(w.discordGuild, w.db, "c1", NOW);
    w.rows[0]!.clearedAt = at("2026-11-10T20:02:00Z");
    expect(await syncCallPost(w.discordGuild, w.db, "c1", at("2026-11-10T20:02:10Z"))).toBe(true);
    expect(w.messages.get("msg1")!.content).toContain("Cleared");
  });
  it("edits the post when the all clear lands while the send is in flight", async () => {
    const rows = [row("c1")];
    const w = world(on, rows, { onSend: () => { rows[0]!.clearedAt = at("2026-11-10T20:01:05Z"); } });
    expect(await syncCallPost(w.discordGuild, w.db, "c1", NOW)).toBe(true);
    expect(w.messages.get("msg1")!.content).toContain("Cleared");
  });
  it("keeps one live post per zone, whatever the spelling or order of the batch", async () => {
    const rows = [row("c1"), row("c2", { memberId: "m2", zone: "duskwood" }), row("c3", { memberId: "m3", zone: "Bois", mapId: 1431 }), row("c4", { memberId: "m4", zone: "Westfall", mapId: 1436 })];
    const w = world(on, rows);
    for (const id of ["c1", "c2", "c3", "c4"]) await syncCallPost(w.discordGuild, w.db, id, NOW);
    expect(w.send).toHaveBeenCalledTimes(2);
    expect(rows.map((r) => r.postMessageId !== null)).toEqual([true, false, false, true]);
  });
  it("posts a call only once when two deliveries race", async () => {
    const w = world(on, [row("c1")]);
    await Promise.all([syncCallPost(w.discordGuild, w.db, "c1", NOW), syncCallPost(w.discordGuild, w.db, "c1", NOW)]);
    expect(w.send).toHaveBeenCalledTimes(1);
  });
  it("caps posts per member each hour and per server in ten minutes", async () => {
    const mine = Array.from({ length: 5 }, (_, i) => row(`c${i}`, { zone: `Zone ${i}`, mapId: 100 + i }));
    const w = world(on, mine);
    for (const r of mine) await syncCallPost(w.discordGuild, w.db, r.id, NOW);
    expect(w.send).toHaveBeenCalledTimes(3);
    const many = Array.from({ length: 10 }, (_, i) => row(`s${i}`, { memberId: `m${i}`, zone: `Zone ${i}`, mapId: 200 + i }));
    const s = world(on, many);
    for (const r of many) await syncCallPost(s.discordGuild, s.db, r.id, NOW);
    expect(s.send).toHaveBeenCalledTimes(6);
  });
  it("retries a failed send (the job throws) and ends quietly when the channel or permission is gone", async () => {
    const rows = [row("c1")];
    const failing = world(on, rows, { failSend: new Error("rate limited") });
    await expect(syncCallPost(failing.discordGuild, failing.db, "c1", NOW)).rejects.toThrow("rate limited");
    expect(rows[0]!.postMessageId).toBeNull();
    const rows2 = [row("c1")];
    const gone = world(on, rows2, { failSend: Object.assign(new Error("Missing Access"), { code: 50001 }) });
    expect(await syncCallPost(gone.discordGuild, gone.db, "c1", NOW)).toBe(false);
    expect(rows2[0]!.postMessageId).toBeNull();
  });
});

describe("weekly recap", () => {
  const afterReset = new Date(weekRange(weekKeyOf(NOW) + 1).from.getTime() + 7 * 3_600_000);
  const week = weekKeyOf(afterReset) - 1;
  const settings = (extra: Record<string, unknown> = {}) => ({ pvpRecapEnabled: true, worldPvpEnabled: true, bgStatsChannelId: "ch1", language: "en", pvpRecapLastWeek: week - 1, ...extra });
  it("is off by default, waits for the reset plus six hours, and queues once", async () => {
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
  it("delivers the finished week's recap", async () => {
    const w = world(settings(), []);
    expect(await deliverWeeklyRecap(w.discordGuild, w.db, "g1", week)).toBe(true);
    expect(w.send).toHaveBeenCalledTimes(1);
  });
});

describe("upload hooks", () => {
  it("tells the cleared listener when an upload brings the all clear of a stored call", async () => {
    const { onHelpCallCleared } = await import("../src/services/guild-map.js");
    const seen = vi.fn();
    const off = onHelpCallCleared(seen);
    const now = new Date();
    const stored = { id: "c1", clearedAt: null, character: "Aria Vale", zone: "Duskwood", calledAt: now, attackers: [], postChannelId: "ch1", postMessageId: "m1" };
    const db = {
      guildSettings: { findUnique: vi.fn(async () => ({ guildMapEnabled: true })) },
      member: { findUnique: vi.fn(async () => ({ guildId: "g1", mapShareOff: false })) },
      guildMapSighting: { createMany: vi.fn(), deleteMany: vi.fn() },
      guildHelpCall: { findUnique: vi.fn(async () => stored), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() }
    };
    const t = Math.floor(now.getTime() / 1000);
    await applyGuildMapUpload(db as never, "g1", "m", { sightings: [], calls: [{ ref: "r1", character: "Aria Vale", zone: "Duskwood", attackers: [], at: t - 30, clearedAt: t } as never] }, now);
    off();
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", postMessageId: "m1" }));
  });
});
