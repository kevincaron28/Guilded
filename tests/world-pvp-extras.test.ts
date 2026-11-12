import { describe, expect, it, vi } from "vitest";
import { applyGuildMapUpload } from "../src/services/guild-map.js";
import { weekKeyOf, weekRange, type WorldPvpStanding } from "../src/services/world-pvp.js";
import { callPostText, clearHelpCallPost, extrasFields, extrasSwitches, hotZones, mostWanted, postHelpCall, postWeeklyRecap, pvpPostChannelId, recapText, weekRecap, type WeekCall } from "../src/services/world-pvp-extras.js";

const at = (iso: string) => new Date(iso);
const call = (zone: string, attackers: { name: string; class?: string }[], extra: Partial<WeekCall> = {}): WeekCall =>
  ({ character: "Aria Vale", zone, attackers, calledAt: at("2026-11-10T20:00:00Z"), clearedAt: null, ...extra });
const standing = (name: string, kills: number, defends: number, helped: number): WorldPvpStanding => ({ memberId: name, name, kills, defends, helped });

describe("hot zones and most wanted", () => {
  const calls = [
    call("Duskwood", [{ name: "Gank", class: "Rogue" }, { name: "Slyfox", class: "Rogue" }]),
    call("duskwood", [{ name: "gank", class: "Mage" }]),
    call("Duskwood", [{ name: "Gank", class: "Rogue" }, { name: "Gank", class: "Rogue" }]),
    call("Stranglethorn Vale", [{ name: "Slyfox" }]),
    call("?", [])
  ];
  it("counts calls per zone, ignores the case and unknown zones, and lists attackers' classes", () => {
    const zones = hotZones(calls);
    expect(zones.map((z) => [z.zone, z.calls])).toEqual([["Duskwood", 3], ["Stranglethorn Vale", 1]]);
    expect(zones[0]!.classes[0]).toEqual({ className: "Rogue", count: 4 });
  });
  it("names an enemy only after more than two different calls, once per call, nothing but the name", () => {
    expect(mostWanted(calls)).toEqual([{ name: "Gank", calls: 3 }]);
    expect(mostWanted(calls.slice(0, 2))).toEqual([]);
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
  it("shows only the switched-on sections, in English and French, with names only for most wanted", () => {
    const calls = [1, 2, 3].map(() => call("Duskwood", [{ name: "Gank", class: "Rogue" }]));
    const off = extrasFields({ switches: extrasSwitches({}), standings, calls }, "en");
    expect(off).toEqual([]);
    const en = extrasFields({ switches: extrasSwitches({ pvpRecapEnabled: true, pvpHotZonesEnabled: true, pvpMostWantedEnabled: true }), standings, calls }, "en");
    expect(en.map((f) => f.name)).toEqual(["🛡️ Defender of the week", "🔥 Hot zones this week", "🎯 Most wanted"]);
    expect(en[2]!.value).toBe("Gank — seen in 3 calls");
    const fr = extrasFields({ switches: extrasSwitches({ pvpMostWantedEnabled: true }), standings, calls }, "fr");
    expect(fr[0]!.name).toBe("🎯 Les plus recherchés");
    expect(recapText(weekRecap(standings, []), "fr")).toContain("Défenseur de la semaine");
  });
  it("posts a call line and its cleared edit in both languages", () => {
    expect(callPostText("en", "Aria Vale", "Duskwood")).toBe("⚔️ **Aria Vale** called for help in **Duskwood**");
    expect(callPostText("fr", "Aria Vale", "Duskwood", true)).toContain("Alerte levée");
    expect(callPostText("en", "A", "Z", true)).toContain("~~");
  });
  it("sends calls to the group finder, else the PvP groups channel, else the ladder channel", () => {
    expect(pvpPostChannelId({ dungeonSignupChannelId: "f", bgGroupsChannelId: "g", bgStatsChannelId: "l" })).toBe("f");
    expect(pvpPostChannelId({ unifiedGroupFinder: false, dungeonSignupChannelId: "f", bgGroupsChannelId: "g" })).toBe("g");
    expect(pvpPostChannelId({ bgStatsChannelId: "l" })).toBe("l");
  });
});

function world(settings: Record<string, unknown> | null, recent: unknown = null) {
  const sent = vi.fn(async () => ({ id: "m1", editable: true, edit: vi.fn(async () => undefined) }));
  const message = { editable: true, edit: vi.fn(async () => undefined) };
  const channel = { id: "ch1", isTextBased: () => true, send: sent, messages: { fetch: vi.fn(async () => message) } };
  const discordGuild = { id: "d1", channels: { fetch: vi.fn(async () => channel) } };
  const client = { guilds: { fetch: vi.fn(async () => discordGuild) } };
  const update = vi.fn(async () => ({}));
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const db = {
    guild: { findUnique: vi.fn(async () => ({ id: "g1", discordId: "d1", gameEdition: "forever" })) },
    guildSettings: { findUnique: vi.fn(async () => settings), update, updateMany },
    guildHelpCall: { findFirst: vi.fn(async () => recent), update, findMany: vi.fn(async () => []) },
    character: { findMany: vi.fn(async () => []) }, unclaimedCharacter: { findMany: vi.fn(async () => []) }, guildRosterEntry: { findMany: vi.fn(async () => []) },
    member: { findMany: vi.fn(async () => [{ id: "m", displayName: "Aria Vale", characters: [] }]) },
    worldPvpWeek: { findMany: vi.fn(async () => [{ memberId: "m", kills: 5, defends: 1, helped: 2 }]) }
  };
  return { db: db as never, client: client as never, discordGuild: discordGuild as never, sent, update, updateMany, message };
}
const live = { id: "c1", guildId: "g1", character: "Aria Vale", zone: "Duskwood", calledAt: at("2026-11-10T20:00:00Z") };
const NOW = at("2026-11-10T20:01:00Z");

describe("call posts", () => {
  const on = { pvpCallPostsEnabled: true, worldPvpEnabled: true, dungeonSignupChannelId: "ch1", language: "en" };
  it("posts nothing until an officer turns it on", async () => {
    const w = world({ ...on, pvpCallPostsEnabled: false });
    expect(await postHelpCall(w.client, w.db, live, NOW)).toBe(false);
    expect(w.sent).not.toHaveBeenCalled();
    const none = world(null);
    expect(await postHelpCall(none.client, none.db, live, NOW)).toBe(false);
  });
  it("posts a live call once and remembers the message", async () => {
    const w = world(on);
    expect(await postHelpCall(w.client, w.db, live, NOW)).toBe(true);
    expect(w.sent).toHaveBeenCalledTimes(1);
    expect(w.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { postChannelId: "ch1", postMessageId: "m1" } });
  });
  it("skips a call from an old upload and a zone posted in the last ten minutes", async () => {
    const stale = world(on);
    expect(await postHelpCall(stale.client, stale.db, live, at("2026-11-10T21:00:00Z"))).toBe(false);
    const busy = world(on, { id: "c0" });
    expect(await postHelpCall(busy.client, busy.db, live, NOW)).toBe(false);
    expect(busy.sent).not.toHaveBeenCalled();
  });
  it("edits the post to cleared, and does nothing for a call that was never posted", async () => {
    const w = world(on);
    expect(await clearHelpCallPost(w.client, w.db, { guildId: "g1", character: "Aria Vale", zone: "Duskwood", postChannelId: "ch1", postMessageId: "m9" })).toBe(true);
    expect(w.message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Cleared") }));
    expect(await clearHelpCallPost(w.client, w.db, { guildId: "g1", character: "x", zone: "y", postChannelId: null, postMessageId: null })).toBe(false);
  });
});

describe("weekly recap", () => {
  const afterReset = new Date(weekRange(weekKeyOf(NOW) + 1).from.getTime() + 7 * 3_600_000);
  const on = { pvpRecapEnabled: true, worldPvpEnabled: true, bgStatsChannelId: "ch1", language: "en", pvpRecapLastWeek: null };
  it("is off by default and waits for the reset plus six hours", async () => {
    const off = world({ ...on, pvpRecapEnabled: false });
    expect(await postWeeklyRecap(off.discordGuild, off.db, afterReset)).toBe(false);
    const early = world(on);
    expect(await postWeeklyRecap(early.discordGuild, early.db, new Date(afterReset.getTime() - 3 * 3_600_000))).toBe(false);
    expect(early.sent).not.toHaveBeenCalled();
  });
  it("posts the finished week once", async () => {
    const w = world(on);
    expect(await postWeeklyRecap(w.discordGuild, w.db, afterReset)).toBe(true);
    expect(w.sent).toHaveBeenCalledTimes(1);
    expect(w.updateMany).toHaveBeenCalled();
    const done = world({ ...on, pvpRecapLastWeek: weekKeyOf(afterReset) - 1 });
    expect(await postWeeklyRecap(done.discordGuild, done.db, afterReset)).toBe(false);
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
