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
    if (k === "member" || k === "guildRankName" && typeof v === "object") return true;
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
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(tables.characters!.find((c) => c.id === where.id)!, data)
    },
    unclaimedCharacter: {
      findMany: async () => tables.unclaimed!,
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(tables.unclaimed!.find((c) => c.id === where.id)!, data),
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
  return { tx: tx as never, tables };
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
