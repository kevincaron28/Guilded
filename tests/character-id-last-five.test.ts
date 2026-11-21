import { describe, expect, it } from "vitest";
import { anchored, voucherOf } from "../src/services/run-trust.js";
import { applyGuildmateRelay, relayableDungeonRuns } from "../src/services/guildmate-relay.js";
import { personalSnapshot } from "../src/services/companion-access.js";
import { handleDeviceUpload, runsOfDevice, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";

// Character ids, last five places (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md, section 6): when both sides carry a game id the id
// alone decides; with an id missing on either side the earlier name rules apply unchanged.

const run = (players: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ id: "QG-1", instanceId: 90, players, ...extra });

describe("run trust: voucherOf", () => {
  const keys = new Set(["lebowski"]);
  const ids = new Map([["lebowski", "1"]]);
  it("never lets two different ids match, even with a shared first name", () => {
    expect(voucherOf(run([{ character: "Lebowski Haze", id: "2" }]), keys, ids)).toBeNull();
  });
  it("matches the same id under a renamed character", () => {
    const renamed = voucherOf(run([{ character: "Dude Abides", id: "1" }]), new Set(["old name"]), new Map([["old name", "1"]]));
    expect(renamed).toEqual({ kind: "first-hand", voucher: "dude" });
  });
  it("keeps the name rule for id-less data", () => {
    expect(voucherOf(run([{ character: "Lebowski Haze" }]), keys)?.kind).toBe("first-hand");
    expect(voucherOf(run([{ character: "Lebowski Haze" }]), keys, ids)?.kind).toBe("first-hand");
    expect(voucherOf(run([{ character: "Lebowski Haze", id: "2" }]), keys)?.kind).toBe("first-hand");
    expect(voucherOf(run([{ character: "Donny" }]), keys, ids)).toBeNull();
  });
  it("relays by reporter name as before (reporters carry no ids)", () => {
    expect(voucherOf(run([{ character: "Donny", id: "9" }], { reporterNames: ["Donny"] }), keys, ids)).toEqual({ kind: "relay", voucher: "donny" });
  });
});

describe("run trust: anchored", () => {
  it("a different id never anchors, even with a shared first name", () => {
    expect(anchored(run([{ character: "Lebowski Haze", id: "2" }]), [{ name: "lebowski", id: 1n }])).toBe(false);
  });
  it("the same id anchors a renamed character", () => {
    expect(anchored(run([{ character: "Dude Abides", id: "1" }]), [{ name: "old name", id: 1n }])).toBe(true);
  });
  it("id-less data behaves as before", () => {
    expect(anchored(run([{ character: "Lebowski Haze" }]), ["lebowski"])).toBe(true);
    expect(anchored(run([{ character: "Lebowski Haze" }]), [{ name: "lebowski", id: 1n }])).toBe(true);
    expect(anchored(run([{ character: "Lebowski Haze", id: "2" }]), ["lebowski"])).toBe(true);
    expect(anchored(run([{ character: "Donny" }]), ["lebowski"])).toBe(false);
  });
});

describe("companion-device: runsOfDevice and the upload", () => {
  it("runsOfDevice: different ids never match, same id matches a rename, id-less is unchanged", () => {
    const runs = [run([{ character: "Lebowski Haze", id: "2" }])];
    expect(runsOfDevice(runs, new Set(["lebowski"]), new Map([["lebowski", "1"]]))).toHaveLength(0);
    expect(runsOfDevice([run([{ character: "New Name", id: "1" }])], new Set(["old name"]), new Map([["old name", "1"]]))).toHaveLength(1);
    expect(runsOfDevice([run([{ character: "Lebowski Haze" }])], new Set(["lebowski"]))).toHaveLength(1);
    expect(runsOfDevice(runs, new Set(["lebowski"]))).toHaveLength(1);
  });

  const quebec: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
  function store(stored: [string, string][]) {
    const imported: { runs: unknown[]; ids?: ReadonlyMap<string, string> }[] = [];
    const device: DeviceRow & { tokenHash: string } = { id: "d1", tokenHash: "h", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 };
    const s: DeviceStore = {
      async create() { return { id: "d1" }; }, async find() { return device; }, async candidates() { return [quebec]; },
      async characterKeys() { return ["lebowski"]; },
      async characterIds() { return stored; },
      async saveUpload() { /* not under test */ }, async claim() { return false; },
      async importRuns(_guildId, runs, _now, source) { imported.push({ runs, ...(source.characterIds ? { ids: source.characterIds } : {}) }); return { stored: runs.length, skipped: 0 }; }
    };
    return { s, device, imported };
  }
  const upload = (players: Record<string, unknown>[]) => ({ guild: { name: "Quebec Gold", realm: "Realm" }, characters: [{ name: "Lebowski" }],
    dungeonRuns: [{ id: "QG-1", state: "COMPLETED", instanceId: 90, startedAt: 1000, endedAt: 3000, players }] });

  it("a namesake run with another id is not vouched for; the same id is", async () => {
    const a = store([["lebowski", "1"]]);
    await handleDeviceUpload(a.s, a.device, upload([{ character: "Lebowski Haze", id: "2" }]));
    expect(a.imported).toHaveLength(0);
    const b = store([["lebowski", "1"]]);
    await handleDeviceUpload(b.s, b.device, upload([{ character: "Lebowski Haze", id: "1" }]));
    expect(b.imported).toHaveLength(1);
    expect(b.imported[0]!.ids?.get("lebowski")).toBe("1");
  });
  it("without ids the earlier name rule still vouches", async () => {
    const c = store([]);
    await handleDeviceUpload(c.s, c.device, upload([{ character: "Lebowski Haze" }]));
    expect(c.imported).toHaveLength(1);
  });
});

describe("guildmate relay: runs", () => {
  const now = 1_800_000_000;
  const mine = (players: Record<string, unknown>[]) => ({ id: "r", endedAt: now - 3600, players });
  const owned = new Set(["lebowski"]);
  const ownedIds = new Map([["lebowski", 1n]]);
  it("a namesake with another id is not the uploader's run; the same id (renamed) is", () => {
    expect(relayableDungeonRuns([mine([{ character: "Lebowski Haze", id: "2" }])], owned, now, ownedIds)).toEqual([]);
    expect(relayableDungeonRuns([mine([{ character: "Walter New", id: "1" }])], owned, now, ownedIds)).toHaveLength(1);
  });
  it("id-less data behaves as before", () => {
    expect(relayableDungeonRuns([mine([{ character: "Lebowski Haze" }])], owned, now, ownedIds)).toHaveLength(1);
    expect(relayableDungeonRuns([mine([{ character: "Lebowski Haze", id: "2" }])], owned, now)).toHaveLength(1);
    expect(relayableDungeonRuns([mine([{ character: "Donny" }])], owned, now, ownedIds)).toEqual([]);
  });
});

describe("guildmate relay: heard characters", () => {
  const NOW = new Date("2026-12-20T12:00:00Z");
  function fakeDatabase(rows: { id: string; name: string; realm: string; memberId: string; gameEdition: string; level: number | null; className: string; race: string | null; wowId?: bigint | null }[]) {
    const tx = { character: { findMany: async () => rows.map((row) => ({ ...row })), update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((row) => row.id === where.id)!, data) },
      professionSkill: { findMany: async () => [] } };
    return { database: { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never, rows };
  }
  const row = (over: Record<string, unknown> = {}) => ({ id: "c1", name: "Lebowski", realm: "Realm", memberId: "m-dude", gameEdition: "forever", level: 20, className: "WARRIOR", race: "Human", ...over });
  const snapshot = (id?: string, name = "Lebowski Haze") => parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever",
    characters: [{ name, realm: "Realm", class: "WARRIOR", race: "Human", level: 24, observedAt: "2026-12-20T10:00:00Z", ...(id ? { id } : {}) }] });

  it("a namesake with a different id is unlinked, never the stored row", async () => {
    const db = fakeDatabase([row({ wowId: 1n })]);
    expect(await applyGuildmateRelay(db.database, "g", "m-walter", snapshot("2"), NOW)).toMatchObject({ updated: 0, unlinked: 1 });
    expect(db.rows[0]!.level).toBe(20);
  });
  it("the same id finds the row under a renamed character", async () => {
    const db = fakeDatabase([row({ wowId: 1n })]);
    expect(await applyGuildmateRelay(db.database, "g", "m-walter", snapshot("1", "Brand New Name"), NOW)).toMatchObject({ updated: 1, unlinked: 0 });
    expect(db.rows[0]!.level).toBe(24);
  });
  it("id-less data behaves as before", async () => {
    const db = fakeDatabase([row()]);
    expect(await applyGuildmateRelay(db.database, "g", "m-walter", snapshot(undefined, "Lebowski"), NOW)).toMatchObject({ updated: 1 });
  });
});

describe("personalSnapshot (looseOwn)", () => {
  const snap = (character: Record<string, unknown>, readiness: Record<string, unknown>[] = []) =>
    parseAddonSnapshot({ source: "Guilded", exportedAt: new Date(), gameEdition: "forever", character: { realm: "R", ...character }, readiness });
  const owned = [{ name: "Lebowski", realm: "R", wowId: 1n }];
  it("a first-name namesake with a different id is not the member's own", () => {
    expect(personalSnapshot(snap({ name: "Lebowski Haze", id: "2" }), owned).character).toBeUndefined();
  });
  it("an exact name with a different id is not the member's own", () => {
    expect(personalSnapshot(snap({ name: "Lebowski", id: "2" }), owned).character).toBeUndefined();
  });
  it("the same id is the member's own under a renamed character, and so are its other rows", () => {
    const result = personalSnapshot(snap({ name: "Walter New", id: "1" }, [{ character: "Walter New", realm: "R" }]), owned);
    expect(result.character?.name).toBe("Walter New");
    expect(result.readiness).toHaveLength(1);
  });
  it("id-less data behaves as before", () => {
    expect(personalSnapshot(snap({ name: "Lebowski Haze" }), owned).character?.name).toBe("Lebowski Haze");
    expect(personalSnapshot(snap({ name: "Lebowski Haze", id: "2" }), [{ name: "Lebowski", realm: "R" }]).character?.name).toBe("Lebowski Haze");
    expect(personalSnapshot(snap({ name: "Donny" }), owned).character).toBeUndefined();
  });
});
