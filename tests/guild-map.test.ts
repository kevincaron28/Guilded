import { describe, expect, it, vi } from "vitest";
import { exportGuildMap } from "../companion/lua-export-content.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import {
  HEAT_COLS, applyGuildMapUpload, buildGuildMapView, guildMapFor, heatByContinent, latestPerCharacter, onHelpCallStored,
  parseGuildMapUpload, setMapSharing, type SightingRow
} from "../src/services/guild-map.js";

// Track M items 3 and 4: the phone guildmate map, the last-seen heat map and help pins.
const NOW = new Date("2026-11-07T12:00:00Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

type Row = { id?: string; memberId?: unknown; character?: unknown; ref?: unknown; seenAt?: Date } & Record<string, unknown>;

function fakeDb(options: { mapOff?: boolean; shareOff?: boolean; memberGuild?: string } = {}) {
  const sightings: Row[] = [];
  const calls: Row[] = [];
  const member = { guildId: options.memberGuild ?? "g1", mapShareOff: options.shareOff ?? false };
  const db = {
    guildSettings: { findUnique: vi.fn(async () => ({ guildMapEnabled: !options.mapOff })) },
    member: {
      findUnique: vi.fn(async () => member),
      update: vi.fn(async ({ data }: { data: { mapShareOff: boolean } }) => { member.mapShareOff = data.mapShareOff; return member; })
    },
    guildMapSighting: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        let count = 0;
        for (const row of data) {
          if (sightings.some((s) => s.memberId === row.memberId && s.character === row.character && (s.seenAt as Date).getTime() === (row.seenAt as Date).getTime())) continue;
          sightings.push(row); count += 1;
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { memberId?: string; seenAt?: { lt: Date } } }) => {
        const before = sightings.length;
        for (let i = sightings.length - 1; i >= 0; i--) {
          const row = sightings[i]!;
          if ((where.memberId && row.memberId === where.memberId) || (where.seenAt && (row.seenAt as Date) < where.seenAt.lt)) sightings.splice(i, 1);
        }
        return { count: before - sightings.length };
      }),
      findMany: vi.fn(async () => sightings)
    },
    guildHelpCall: {
      findUnique: vi.fn(async ({ where }: { where: { memberId_ref: { memberId: string; ref: string } } }) =>
        calls.find((c) => c.memberId === where.memberId_ref.memberId && c.ref === where.memberId_ref.ref) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `c${calls.length}`, ...data }; calls.push(row); return row; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(calls.find((c) => c.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { memberId: string }; data: Record<string, unknown> }) => {
        const hit = calls.filter((c) => c.memberId === where.memberId);
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => calls)
    },
    character: { findMany: vi.fn(async () => [{ name: "Aldric Vane", displayName: null, className: "Warrior", level: 42 }]) }
  };
  return { db, sightings, calls, member };
}

const upload = () => parseGuildMapUpload(
  [
    { character: "Aldric Vane", mapId: 1429, zone: "Elwynn Forest", x: 0.41, y: 0.65, continentId: 1415, continent: "Eastern Kingdoms", cx: 0.45, cy: 0.71, at: sec("2026-11-07T11:00:00Z") },
    { character: "Aldric Vane", mapId: 1429, zone: "Elwynn Forest", x: 2, y: 0.65, at: sec("2026-11-07T11:10:00Z") },
    { character: "Aldric Vane", mapId: 1429, zone: "Elwynn Forest", x: 0.4, y: 0.6, at: sec("2026-11-08T12:00:00Z") },
    "junk"
  ],
  [{ ref: "1800000100", character: "Aldric Vane", zone: "Duskwood", subzone: "Raven Hill", mapId: 1431, x: 0.2, y: 0.3, continentId: 1415, cx: 0.46, cy: 0.8,
    attackers: [{ name: "Thug", class: "ROGUE", level: 60 }], at: sec("2026-11-07T11:58:00Z") }],
  NOW
);

describe("guild map upload", () => {
  it("keeps valid rows only: no out-of-range point, no future time, no junk", () => {
    const parsed = upload();
    expect(parsed.sightings).toHaveLength(1);
    expect(parsed.sightings[0]).toMatchObject({ zone: "Elwynn Forest", cx: 0.45 });
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0]!.attackers).toEqual([{ name: "Thug", class: "ROGUE", level: 60 }]);
  });

  it("stores the uploader's own rows once and calls the push hook once per new call", async () => {
    const f = fakeDb();
    const heard: string[] = [];
    const stop = onHelpCallStored((call) => { heard.push(`${call.character}@${call.zone}`); });
    expect(await applyGuildMapUpload(f.db as never, "g1", "m1", upload(), NOW)).toEqual({ sightings: 1, calls: 1 });
    expect(await applyGuildMapUpload(f.db as never, "g1", "m1", upload(), NOW)).toEqual({ sightings: 0, calls: 0 });
    stop();
    expect(heard).toEqual(["Aldric Vane@Duskwood"]);
    expect(f.calls[0]).toMatchObject({ memberId: "m1", cx: 0.46, mapId: 1431 });
  });

  it("keeps no position when officers turned the map off, but still stores the call (without coordinates) for the world PvP checks; nothing for another guild's member", async () => {
    const off = fakeDb({ mapOff: true });
    expect(await applyGuildMapUpload(off.db as never, "g1", "m1", upload(), NOW)).toEqual({ sightings: 0, calls: 1 });
    expect(off.sightings.length).toBe(0);
    expect(off.calls[0]).toMatchObject({ zone: "Duskwood", mapId: null, x: null, cx: null });
    const other = fakeDb({ memberGuild: "g2" });
    expect(await applyGuildMapUpload(other.db as never, "g1", "m1", upload(), NOW)).toEqual({ sightings: 0, calls: 0 });
    expect(other.sightings.length + other.calls.length).toBe(0);
  });

  it("keeps no position for a member who turned sharing off; their call stays without coordinates", async () => {
    const f = fakeDb({ shareOff: true });
    expect(await applyGuildMapUpload(f.db as never, "g1", "m1", upload(), NOW)).toEqual({ sightings: 0, calls: 1 });
    expect(f.calls[0]).toMatchObject({ zone: "Duskwood", mapId: null, x: null, cx: null });
  });

  it("turning sharing off deletes every stored position and strips calls", async () => {
    const f = fakeDb();
    await applyGuildMapUpload(f.db as never, "g1", "m1", upload(), NOW);
    expect(await setMapSharing(f.db as never, "m1", false)).toEqual({ share: false, deleted: 1 });
    expect(f.sightings).toHaveLength(0);
    expect(f.calls[0]).toMatchObject({ cx: null, x: null });
    expect(f.member.mapShareOff).toBe(true);
    expect(await setMapSharing(f.db as never, "m1", true)).toEqual({ share: true, deleted: 0 });
    expect(f.member.mapShareOff).toBe(false);
  });

  it("is read from the snapshot fields the companion sends", () => {
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: NOW.toISOString(), mapSightings: [{ a: 1 }], helpCalls: [] });
    expect(snapshot.mapSightings).toHaveLength(1);
    expect(parseAddonSnapshot({ source: "Guilded", exportedAt: NOW.toISOString() }).helpCalls).toEqual([]);
  });
});

describe("guild map view", () => {
  const row = (memberId: string, character: string, iso: string, cx = 0.5, cy = 0.5, zone = "Elwynn Forest"): SightingRow => ({
    memberId, character, mapId: 1429, zone, x: 0.3, y: 0.3, continentId: 1415, continent: "Eastern Kingdoms", cx, cy, seenAt: new Date(iso)
  });

  it("shows the latest sighting per character, newest first", () => {
    const latest = latestPerCharacter([row("m1", "Ann", "2026-11-06T10:00:00Z"), row("m1", "Ann", "2026-11-07T10:00:00Z"), row("m2", "Bo", "2026-11-07T11:00:00Z")]);
    expect(latest.map((r) => `${r.character} ${r.seenAt.toISOString()}`)).toEqual(["Bo 2026-11-07T11:00:00.000Z", "Ann 2026-11-07T10:00:00.000Z"]);
  });

  it("bins the heat map per continent with zone label spots, counts only", () => {
    const [heat] = heatByContinent([row("m1", "Ann", "2026-11-07T10:00:00Z", 0.01, 0.01), row("m2", "Bo", "2026-11-07T10:00:00Z", 0.02, 0.02), row("m2", "Bo", "2026-11-06T10:00:00Z", 1, 1, "Duskwood")]);
    expect(heat!.name).toBe("Eastern Kingdoms");
    expect(heat!.cells).toEqual(expect.arrayContaining([[0, 0, 2], [HEAT_COLS - 1, 15, 1]]));
    expect(heat!.max).toBe(2);
    expect(heat!.zones[0]).toEqual({ zone: "Elwynn Forest", cx: 0.015, cy: 0.015, count: 2 });
    expect(JSON.stringify(heat)).not.toContain("Ann");
  });

  it("marks the viewer's own dots and active calls, with full names and classes", () => {
    const view = buildGuildMapView({
      enabled: true, sharing: true, viewerMemberId: "m1", now: NOW,
      sightings: [row("m1", "aldric vane", "2026-11-07T10:00:00Z")],
      characters: new Map([["aldric vane", { name: "Aldric Vane", displayName: null, className: "Warrior", level: 42 }]]),
      calls: [
        { memberId: "m2", character: "Bo", zone: "Duskwood", subzone: null, mapId: null, x: null, y: null, continentId: null, cx: null, cy: null, attackers: [{ name: "Thug" }, "bad"], calledAt: new Date("2026-11-07T11:58:00Z"), clearedAt: null },
        { memberId: "m2", character: "Bo", zone: "Duskwood", subzone: null, mapId: null, x: null, y: null, continentId: null, cx: null, cy: null, attackers: [], calledAt: new Date("2026-11-07T10:00:00Z"), clearedAt: new Date("2026-11-07T10:02:00Z") }
      ]
    });
    expect(view.mates[0]).toMatchObject({ mine: true, className: "Warrior", level: 42 });
    expect(view.calls.map((c) => [c.active, c.cleared, c.attackers.length])).toEqual([[true, false, 1], [false, true, 0]]);
  });

  it("reads nothing when officers turned the map off", async () => {
    const f = fakeDb({ mapOff: true });
    const view = await guildMapFor(f.db as never, "g1", "m1", NOW);
    expect(view).toMatchObject({ enabled: false, mates: [], calls: [] });
    expect(f.db.guildMapSighting.findMany).not.toHaveBeenCalled();
  });

  it("only reads this guild's active, sharing members", async () => {
    const f = fakeDb();
    await guildMapFor(f.db as never, "g1", "m1", NOW);
    const where = (f.db.guildMapSighting.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ guildId: "g1", member: { status: "ACTIVE", mapShareOff: false } });
  });
});

describe("companion export of the phone map", () => {
  it("sends own positions, the trail and own calls, whitelisted", () => {
    const out = exportGuildMap({
      mapSeen: { "Aldric Vane": { m: 1429, z: "Elwynn Forest", x: 0.41234, y: 0.65, c: 1415, cn: "Eastern Kingdoms", cx: 0.45, cy: 0.71, at: 1800000000, extra: "no" } },
      mapTrail: [
        { n: "Aldric Vane", m: 1429, z: "Elwynn Forest", x: 0.4, y: 0.6, at: 1799999000 },
        { n: "Aldric Vane", m: 1429, z: "Elwynn Forest", x: 5, y: 0.6, at: 1799998000 },
        { n: "Aldric Vane", m: 1429, z: "Elwynn Forest", x: 0.41234, y: 0.65, c: 1415, cx: 0.45, cy: 0.71, at: 1800000000 }
      ],
      helpCalls: { "1800000100": { id: "1800000100", n: "Aldric Vane", at: 1800000100, z: "Duskwood", sz: "", m: 1431, x: 0.2, y: 0.3, a: [{ n: "Thug", c: "ROGUE", l: 60 }, { c: "MAGE" }], clr: 1800000200 } }
    });
    expect(out.mapSightings).toHaveLength(2);
    expect(out.mapSightings?.at(-1)).toEqual({ character: "Aldric Vane", zone: "Elwynn Forest", mapId: 1429, x: 0.4123, y: 0.65, continentId: 1415, cx: 0.45, cy: 0.71, continent: "Eastern Kingdoms", at: 1800000000 });
    expect(out.helpCalls).toEqual([{ ref: "1800000100", character: "Aldric Vane", zone: "Duskwood", mapId: 1431, x: 0.2, y: 0.3, attackers: [{ name: "Thug", class: "ROGUE", level: 60 }], at: 1800000100, clearedAt: 1800000200 }]);
    expect(parseGuildMapUpload(out.mapSightings, out.helpCalls, new Date(1800000300 * 1000))).toMatchObject({ sightings: { length: 2 }, calls: { length: 1 } });
  });

  it("sends nothing when the addon saved nothing", () => {
    expect(exportGuildMap({})).toEqual({});
  });
});
