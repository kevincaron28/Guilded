import { describe, expect, it } from "vitest";
import { applyGuildData } from "../src/services/guild-data.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { exportGuildData } from "../companion/lua-export-content.mjs";

// 8.5: the game's guild roster, event log and MOTD from any member's upload. Latest wins, events
// once, rank only from officers, members without the addon included.
const NOW = new Date("2026-12-20T12:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const T = sec(NOW) - 3600;

// A loose in-memory stand-in for the Prisma tables this service touches.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
function fakeDb(seed: { characters?: Row[]; unclaimed?: Row[] } = {}) {
  const tables: { roster: Row[]; events: Row[]; text: Row[]; characters: Row[]; unclaimed: Row[]; rankSeen: Row[] } = { roster: [], events: [], text: [], characters: seed.characters ?? [], unclaimed: seed.unclaimed ?? [], rankSeen: [] };
  let n = 0;
  const id = () => `id${++n}`;
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
    if (k === "member" || k === "OR" || k === "guildRankName" && typeof v === "object") return true;
    if (v && typeof v === "object" && "in" in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
    if (v && typeof v === "object" && "gte" in (v as object)) return (row[k] as Date) >= (v as { gte: Date }).gte;
    return row[k] === v;
  });
  const tx = {
    guildRosterEntry: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => tables.roster!.filter((r) => match(r, where)),
      upsert: async ({ where, create, update }: { where: { guildId_gameEdition_nameKey: Record<string, unknown> }; create: Row; update: Row }) => {
        const found = tables.roster!.find((r) => match(r, where.guildId_gameEdition_nameKey));
        if (found) Object.assign(found, update); else tables.roster!.push({ ...create, id: id() });
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const rows = tables.roster!.filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      }
    },
    guildEventEntry: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => tables.events!.filter((r) => match(r, where)).sort((a, b) => (b.at as Date).getTime() - (a.at as Date).getTime()),
      create: async ({ data }: { data: Row }) => { tables.events!.push({ ...data, id: id() }); }
    },
    guildText: {
      findUnique: async () => tables.text![0] ?? null,
      upsert: async ({ create, update }: { create: Row; update: Row }) => { if (tables.text![0]) Object.assign(tables.text![0], update); else tables.text!.push({ ...create, id: "t" }); }
    },
    character: {
      findMany: async ({ where }: { where: { guildRankName?: unknown } }) => tables.characters!.filter((c) => where.guildRankName === undefined || c.guildRankName)
        .map((c) => ({ ...c, rankSeen: tables.rankSeen!.find((r) => r.characterId === c.id) ?? null })),
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(tables.characters!.find((c) => c.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const rows = tables.characters!.filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      }
    },
    unclaimedCharacter: {
      findMany: async () => tables.unclaimed!,
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(tables.unclaimed!.find((c) => c.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const rows = tables.unclaimed!.filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      },
      // ON CONFLICT DO NOTHING: a row with the same key is kept, never doubled or thrown on
      createMany: async ({ data }: { data: Row[] }) => { for (const row of data) if (!tables.unclaimed!.some((c) => c.nameKey === row.nameKey)) tables.unclaimed!.push({ ...row, id: id() }); return { count: data.length }; }
    },
    characterRankSeen: {
      upsert: async ({ where, create, update }: { where: { characterId: string }; create: Row; update: Row }) => {
        const found = tables.rankSeen!.find((r) => r.characterId === where.characterId);
        if (found) Object.assign(found, update); else tables.rankSeen!.push({ ...create, id: id() });
      }
    }
  };
  // Every write is counted by table.method so a test can assert how many statements an upload costs.
  const writes: string[] = [];
  for (const [table, methods] of Object.entries(tx)) {
    for (const [method, fn] of Object.entries(methods as Record<string, (...args: never[]) => unknown>)) {
      if (/^(update|updateMany|upsert|create|createMany)$/.test(method)) (methods as Record<string, unknown>)[method] = (...args: never[]) => { writes.push(`${table}.${method}`); return fn(...args); };
    }
  }
  return { tx: tx as never, tables, writes };
}

const upload = (members: Record<string, unknown>[], extra: Record<string, unknown> = {}, at = T) => parseAddonSnapshot({
  source: "Guilded", exportedAt: NOW, gameEdition: "forever", guildRoster: { at, complete: true, members }, ...extra });
const linked = (id: string, name: string, extra: Record<string, unknown> = {}): Row =>
  ({ id, name, realm: "Forever", gameEdition: "forever", displayName: name, level: 10, className: "Warrior", lastSeenAt: null, guildRankName: null, ...extra });

describe("guild roster from any member's upload", () => {
  it("a parallel upload that created the unlinked row first neither errors nor doubles it", async () => {
    const db = fakeDb();
    const unclaimed = (db.tx as unknown as { unclaimedCharacter: { findMany: unknown } }).unclaimedCharacter;
    // This upload read the table before the other upload's insert landed, so it sees nothing...
    const real = unclaimed.findMany;
    unclaimed.findMany = (async () => { const seen: Row[] = []; db.tables.unclaimed!.push({ id: "other", nameKey: "dude lebowski", name: "Dude Lebowski", level: 12 }); return seen; }) as never;
    const result = await applyGuildData(db.tx, "g", { memberId: "m-donny", officer: false }, upload([{ name: "Dude Lebowski", level: 12, class: "WARRIOR", rankName: "Member", rankIndex: 3, online: true }]), NOW);
    unclaimed.findMany = real;
    // ...and its own insert is skipped by the unique key instead of aborting the transaction.
    expect(db.tables.unclaimed!.filter((c) => c.nameKey === "dude lebowski")).toHaveLength(1);
    expect(result.roster).toBe(1);
  });
  it("reaches members without the addon: linked level and last seen, unlinked listed", async () => {
    const db = fakeDb({ characters: [linked("c1", "Walter Sobchak")] });
    const result = await applyGuildData(db.tx, "g", { memberId: "m-donny", officer: false }, upload([
      { name: "Walter Sobchak", level: 22, class: "PALADIN", rankName: "Officer", rankIndex: 1, online: false, lastOnline: T - 7200 },
      { name: "Dude Lebowski", level: 12, class: "WARRIOR", rankName: "Member", rankIndex: 3, online: true }
    ]), NOW);
    expect(result).toMatchObject({ roster: 2, characters: 1, unclaimed: 1 });
    expect(db.tables.characters![0]).toMatchObject({ level: 22, lastSeenAt: new Date((T - 7200) * 1000), guildRankName: null }); // no rank from a member
    expect(db.tables.unclaimed![0]).toMatchObject({ nameKey: "dude lebowski", name: "Dude Lebowski", className: "Warrior", level: 12, lastSeenAt: new Date(T * 1000) });
    expect(db.tables.unclaimed![0]!.guildRankName).toBeUndefined();
  });

  it("renames an unlinked row stored under a first name instead of listing the member twice", async () => {
    const db = fakeDb({ unclaimed: [{ id: "u1", nameKey: "dude", name: "Dude", level: 8, lastSeenAt: new Date((T - 86400) * 1000) }] });
    await applyGuildData(db.tx, "g", { memberId: "m", officer: false }, upload([{ name: "Dude Lebowski", level: 12, class: "WARRIOR" }]), NOW);
    expect(db.tables.unclaimed).toHaveLength(1);
    expect(db.tables.unclaimed[0]).toMatchObject({ nameKey: "dude lebowski", name: "Dude Lebowski", legacyName: "dude", level: 12 });
    // Two members share the first name: no guess, the old row stays and the new one is listed in full.
    const shared = fakeDb({ unclaimed: [{ id: "u1", nameKey: "dude", name: "Dude", level: 8, lastSeenAt: new Date(0) }, { id: "u2", nameKey: "dude smith", name: "Dude Smith", level: 3, lastSeenAt: new Date(0) }] });
    await applyGuildData(shared.tx, "g", { memberId: "m", officer: false }, upload([{ name: "Dude Lebowski", level: 12, class: "WARRIOR" }]), NOW);
    expect(shared.tables.unclaimed.map((row: { nameKey: string }) => row.nameKey)).toEqual(["dude", "dude smith", "dude lebowski"]);
  });

  it("an officer's upload also sets the rank", async () => {
    const db = fakeDb({ characters: [linked("c1", "Walter Sobchak")] });
    await applyGuildData(db.tx, "g", { memberId: "m-officer", officer: true }, upload([{ name: "Walter Sobchak", level: 22, class: "PALADIN", rankName: "Officer", rankIndex: 1, online: true }]), NOW);
    expect(db.tables.characters![0]).toMatchObject({ guildRankName: "Officer", guildRankIndex: 1, guildRankAt: new Date(T * 1000) });
  });

  it("latest reading wins; an older upload never rolls back levels or marks people as gone", async () => {
    const db = fakeDb({ characters: [linked("c1", "Walter Sobchak")] });
    await applyGuildData(db.tx, "g", { memberId: "a", officer: false }, upload([{ name: "Walter Sobchak", level: 25, class: "PALADIN" }, { name: "Dude Lebowski", level: 12, class: "WARRIOR" }]), NOW);
    const older = await applyGuildData(db.tx, "g", { memberId: "b", officer: false }, upload([{ name: "Walter Sobchak", level: 20, class: "PALADIN" }], {}, T - 600), NOW);
    expect(older).toMatchObject({ skippedOlder: true, roster: 0, left: 0 });
    expect(db.tables.roster!.find((r) => r.nameKey === "walter sobchak")!.level).toBe(25);
    expect(db.tables.characters![0]!.level).toBe(25);
    expect(db.tables.roster!.find((r) => r.nameKey === "dude lebowski")!.inGuild).toBe(true);
    // A newer complete roster without the Dude: he left.
    const newer = await applyGuildData(db.tx, "g", { memberId: "b", officer: false }, upload([{ name: "Walter Sobchak", level: 26, class: "PALADIN" }], {}, T + 600), NOW);
    expect(newer.left).toBe(1);
    expect(db.tables.roster!.find((r) => r.nameKey === "dude lebowski")!.inGuild).toBe(false);
  });

  it("ignores rosters from the future or older than 30 days", async () => {
    const db = fakeDb();
    expect((await applyGuildData(db.tx, "g", { memberId: "a", officer: false }, upload([{ name: "Dude Lebowski", class: "WARRIOR" }], {}, sec(NOW) + 3600), NOW)).roster).toBe(0);
    expect((await applyGuildData(db.tx, "g", { memberId: "a", officer: false }, upload([{ name: "Dude Lebowski", class: "WARRIOR" }], {}, sec(NOW) - 40 * 86400), NOW)).roster).toBe(0);
  });
});

describe("guild event log and text", () => {
  const events = (shift: number) => ({ guildEvents: [
    { type: "join", actor: "Dude Lebowski", at: T - 5 * 86400 + shift },
    { type: "promote", actor: "Walter Sobchak", target: "Dude Lebowski", rank: "Officer", at: T - 2 * 86400 + shift }
  ] });

  it("stores each event once, whoever uploads it (the game's ages differ by an hour or two)", async () => {
    const db = fakeDb();
    const first = await applyGuildData(db.tx, "g", { memberId: "a", officer: false }, parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", ...events(0) }), NOW);
    const second = await applyGuildData(db.tx, "g", { memberId: "b", officer: false }, parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", ...events(3600) }), NOW);
    expect([first.events, second.events, second.duplicateEvents]).toEqual([2, 0, 2]);
    expect(db.tables.events).toHaveLength(2);
  });

  it("dates time in rank for the promotion panel from the log", async () => {
    const db = fakeDb({ characters: [linked("c1", "Dude Lebowski", { guildRankName: "Officer" }), linked("c2", "Donny Kerabatsos", { guildRankName: "Member" })] });
    db.tables.rankSeen!.push({ id: "r1", characterId: "c1", rankName: "Officer", since: NOW });
    await applyGuildData(db.tx, "g", { memberId: "a", officer: false }, parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever",
      guildEvents: [...events(0).guildEvents, { type: "join", actor: "Donny Kerabatsos", at: T - 9 * 86400 }] }), NOW);
    expect(db.tables.rankSeen!.find((r) => r.characterId === "c1")!.since).toEqual(new Date((T - 2 * 86400) * 1000));
    expect(db.tables.rankSeen!.find((r) => r.characterId === "c2")!.since).toEqual(new Date((T - 9 * 86400) * 1000));
  });

  it("keeps the newest MOTD and info text", async () => {
    const db = fakeDb();
    const send = (at: number, motd: string) => applyGuildData(db.tx, "g", { memberId: "a", officer: false },
      parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", guildInfo: { at, motd, info: "Be kind." } }), NOW);
    await send(T, "Raid Friday");
    await send(T - 60, "Old text");
    expect(db.tables.text![0]).toMatchObject({ motd: "Raid Friday", info: "Be kind." });
  });

  it("a malformed block is left out, never the whole upload", () => {
    const parsed = parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, guildRoster: { at: "soon", members: [] }, guildInfo: { at: -1 } });
    expect(parsed.guildRoster).toBeUndefined();
    expect(parsed.guildInfo).toBeUndefined();
    expect(parsed.rejected.map((r) => r.section)).toEqual(["guildRoster", "guildInfo"]);
  });

  it("the companion exports what the addon saved, field by field", () => {
    const out = exportGuildData({ guildSnapshot: { at: T, complete: true, members: { "Dude Lebowski": { level: 12, class: "WARRIOR", online: false, lastOnline: T - 60, note: "secret" } }, motd: "Hi", textAt: T },
      guildLog: { events: [{ type: "promote", p1: "Walter Sobchak", p2: "Dude Lebowski", rank: "Officer", at: T }, { type: "bogus", p1: "x", at: T }] } });
    expect(out.guildRoster.members).toEqual([{ name: "Dude Lebowski", level: 12, class: "WARRIOR", online: false, lastOnline: T - 60 }]);
    expect(out.guildEvents).toEqual([{ type: "promote", actor: "Walter Sobchak", target: "Dude Lebowski", rank: "Officer", at: T }]);
    expect(out.guildInfo).toEqual({ at: T, motd: "Hi" });
  });
});

describe("an upload costs a handful of statements, not one per member (12 Nov 2026: 19 s transaction)", () => {
  const MANY = 200;
  const names = Array.from({ length: MANY }, (_, i) => `Member${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
  const rosterOf = (rank = "Raider", online = false) => names.map((name, i) => ({ name, level: 30, class: "WARRIOR", rankName: i === 0 ? rank : "Raider", rankIndex: i === 0 && rank !== "Raider" ? 2 : 4, online, lastOnline: T - 86400 }));
  const seedLinked = () => names.slice(0, 100).map((name, i) => linked(`c${i}`, name, { level: 30, className: "Warrior", lastSeenAt: new Date((T - 86400) * 1000), guildRankName: "Raider", guildRankIndex: 4, guildRankAt: new Date((T - 7200) * 1000) }));
  const seedUnclaimed = () => names.slice(100).map((name, i) => ({ id: `u${i}`, nameKey: name.toLowerCase(), name, level: 30, lastSeenAt: new Date((T - 86400) * 1000), guildRankName: "Raider", guildRankAt: new Date((T - 7200) * 1000) }));
  const officer = { memberId: "m-officer", officer: true };

  async function firstUpload() {
    const db = fakeDb({ characters: seedLinked(), unclaimed: seedUnclaimed() });
    await applyGuildData(db.tx, "g", officer, upload(rosterOf(), {}, T - 7200), NOW);
    db.writes.length = 0;
    return db;
  }

  it("an officer re-uploading an identical, newer roster issues no per-row writes", async () => {
    const db = await firstUpload();
    const result = await applyGuildData(db.tx, "g", officer, upload(rosterOf()), NOW);
    expect(result.skippedOlder).toBe(false);
    expect(db.writes.filter((w) => /\.(update|upsert|create)$/.test(w))).toEqual([]);
    expect(db.writes.length).toBeLessThanOrEqual(6);
    // Rank confirmations still move guildRankAt (rank roles and roster gaps read its age), in one statement per table.
    expect(db.tables.characters!.every((c) => c.guildRankAt.getTime() === T * 1000)).toBe(true);
    expect(db.tables.unclaimed!.every((c) => c.guildRankAt.getTime() === T * 1000)).toBe(true);
    expect(result.roster).toBe(MANY);
  });

  it("the same roster uploaded twice (a retry) changes nothing the second time", async () => {
    const db = await firstUpload();
    await applyGuildData(db.tx, "g", officer, upload(rosterOf()), NOW);
    db.writes.length = 0;
    const again = await applyGuildData(db.tx, "g", officer, upload(rosterOf()), NOW);
    expect(again.skippedOlder).toBe(true);
    expect(db.writes).toEqual([]);
  });

  it("a changed rank writes that row only, with its guildRankAt", async () => {
    const db = await firstUpload();
    await applyGuildData(db.tx, "g", officer, upload(rosterOf("Officer")), NOW);
    expect(db.writes.filter((w) => w === "character.update")).toHaveLength(1);
    expect(db.tables.characters![0]).toMatchObject({ guildRankName: "Officer", guildRankIndex: 2, guildRankAt: new Date(T * 1000) });
    expect(db.tables.characters![1]).toMatchObject({ guildRankName: "Raider" });
  });

  it("online members' last seen is batched by value, not written one by one", async () => {
    const db = await firstUpload();
    await applyGuildData(db.tx, "g", officer, upload(rosterOf("Raider", true)), NOW);
    expect(db.writes.filter((w) => /\.(update|upsert)$/.test(w))).toEqual([]);
    expect(db.tables.characters!.every((c) => c.lastSeenAt.getTime() === T * 1000)).toBe(true);
    expect(db.tables.unclaimed!.every((c) => c.lastSeenAt.getTime() === T * 1000)).toBe(true);
    expect(db.writes.length).toBeLessThanOrEqual(8);
  });

  it("ranks are decided per row: an officer roster older than the newest stored one still sets ranks newer than the row's rank date", async () => {
    const db = fakeDb({ characters: seedLinked(), unclaimed: seedUnclaimed() });
    // A member's roster (no ranks) arrives first and becomes the newest stored reading.
    await applyGuildData(db.tx, "g", { memberId: "m", officer: false }, upload(rosterOf(), {}, T - 3600), NOW);
    const result = await applyGuildData(db.tx, "g", officer, upload(rosterOf("Officer"), {}, T - 5400), NOW);
    expect(result.skippedOlder).toBe(true);
    expect(db.tables.characters![0]).toMatchObject({ guildRankName: "Officer", guildRankIndex: 2, guildRankAt: new Date((T - 5400) * 1000) });
    // Same rank elsewhere: only the rank date moves, forward.
    expect(db.tables.characters![1]).toMatchObject({ guildRankName: "Raider", guildRankAt: new Date((T - 5400) * 1000) });
  });

  it("a roster older than a row's rank date changes no rank and never moves the date backwards", async () => {
    const db = await firstUpload();   // rank dates are T - 7200
    await applyGuildData(db.tx, "g", officer, upload(rosterOf("Officer"), {}, T - 9000), NOW);
    expect(db.tables.characters![0]).toMatchObject({ guildRankName: "Raider", guildRankAt: new Date((T - 7200) * 1000) });
    expect(db.tables.unclaimed![0]).toMatchObject({ guildRankAt: new Date((T - 7200) * 1000) });
  });

  it("a member's upload never touches ranks, and an officer upload with the same reading time after it still sets them", async () => {
    const db = fakeDb({ characters: seedLinked(), unclaimed: seedUnclaimed() });
    await applyGuildData(db.tx, "g", { memberId: "m", officer: false }, upload(rosterOf("Officer")), NOW);
    expect(db.tables.characters![0]).toMatchObject({ guildRankName: "Raider", guildRankAt: new Date((T - 7200) * 1000) });
    const result = await applyGuildData(db.tx, "g", officer, upload(rosterOf("Officer")), NOW);   // same observedAt as the stored roster
    expect(result.skippedOlder).toBe(true);
    expect(db.tables.characters![0]).toMatchObject({ guildRankName: "Officer", guildRankAt: new Date(T * 1000) });
  });
});

describe("offline members do not cause a write each (the addon sends lastOnline as now minus age)", () => {
  const COUNT = 500;
  const age = (i: number) => 86400 + i * 37;
  const roster = (at: number, extra: (i: number) => Record<string, unknown> = () => ({})) => Array.from({ length: COUNT }, (_, i) =>
    ({ name: `Person${String(i).padStart(3, "0")}`, level: 40, class: "MAGE", rankName: "Raider", rankIndex: 4, online: false, lastOnline: at - age(i), ...extra(i) }));
  const officer = { memberId: "m-officer", officer: true };

  it("a second upload five minutes later, with every offline member's last online moved a few minutes, issues a handful of statements", async () => {
    const characters = Array.from({ length: COUNT / 2 }, (_, i) => linked(`c${i}`, `Person${String(i).padStart(3, "0")}`, { level: 40, className: "Mage",
      lastSeenAt: new Date((T - 600 - age(i)) * 1000), guildRankName: "Raider", guildRankIndex: 4, guildRankAt: new Date((T - 3600) * 1000) }));
    const unclaimed = Array.from({ length: COUNT / 2 }, (_, k) => { const i = COUNT / 2 + k; return { id: `u${i}`, nameKey: `person${String(i).padStart(3, "0")}`, name: `Person${String(i).padStart(3, "0")}`,
      level: 40, lastSeenAt: new Date((T - 600 - age(i)) * 1000), guildRankName: "Raider", guildRankAt: new Date((T - 3600) * 1000) }; });
    const db = fakeDb({ characters, unclaimed });
    await applyGuildData(db.tx, "g", officer, upload(roster(T - 600), {}, T - 600), NOW);
    const before = db.tables.roster!.map((r) => ({ key: r.nameKey, lastOnlineAt: r.lastOnlineAt as Date }));
    db.writes.length = 0;
    await applyGuildData(db.tx, "g", { memberId: "m-second", officer: true }, upload(roster(T - 300), {}, T - 300), NOW);
    expect(db.writes.length).toBeLessThanOrEqual(6);
    expect(db.writes.filter((w) => /\.(update|upsert|create)$/.test(w))).toEqual([]);
    // GuildRosterEntry: reading time and reporter moved, last online (a few minutes) did not.
    const bad = db.tables.roster!.filter((r) => !(r.observedAt.getTime() === (T - 300) * 1000 && r.reportedById === "m-second"));
    if (bad.length) throw new Error(`${bad.length} of ${db.tables.roster!.length}: ${JSON.stringify(bad[0])}`);
    expect(db.tables.roster!.map((r) => ({ key: r.nameKey, lastOnlineAt: r.lastOnlineAt }))).toEqual(before);
    expect(db.tables.characters![0]!.lastSeenAt.getTime()).toBe((T - 600 - age(0)) * 1000);
  });

  it("leave and rejoin, a real move of last online, and online members", async () => {
    const db = fakeDb();
    await applyGuildData(db.tx, "g", officer, upload(roster(T - 7200), {}, T - 7200), NOW);
    const entry = (name: string) => db.tables.roster!.find((r) => r.nameKey === name.toLowerCase())!;
    const first = entry("Person000").lastOnlineAt as Date;
    // Person000 leaves (newer complete roster without them)...
    await applyGuildData(db.tx, "g", officer, upload(roster(T - 3600).slice(1), {}, T - 3600), NOW);
    expect(entry("Person000").inGuild).toBe(false);
    // ...rejoins and is online now, Person001 came online too; Person002 was last online two hours later than stored.
    await applyGuildData(db.tx, "g", { memberId: "m-third", officer: false }, upload(roster(T, (i) => i === 0 || i === 1 ? { online: true, lastOnline: undefined } : i === 2 ? { lastOnline: T - 3600 } : {}), {}, T), NOW);
    expect(entry("Person000")).toMatchObject({ inGuild: true, reportedById: "m-third" });
    expect((entry("Person000").lastOnlineAt as Date).getTime()).toBe(T * 1000);
    expect((entry("Person000").lastOnlineAt as Date).getTime()).toBeGreaterThan(first.getTime());
    expect((entry("Person001").lastOnlineAt as Date).getTime()).toBe(T * 1000);
    expect((entry("Person002").lastOnlineAt as Date).getTime()).toBe((T - 3600) * 1000);
    expect(entry("Person003").reportedById).toBe("m-third");
  });
});
