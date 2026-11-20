import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addToIndex, indexCharacters, parseWowId, parseWowIdDecimal, resolveCharacter, sameCharacterRef, type RefRow } from "../src/services/character-ref.js";
import { addonCharacterSchema, parseAddonSnapshot } from "../src/integrations/addon.js";
import { applyGuildData } from "../src/services/guild-data.js";

// Exact character matching by ID (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md, stage A).
interface Row extends RefRow { key: string }
const row = (name: string, wowId: bigint | null = null): Row => ({ key: name, name, wowId });

describe("parseWowId", () => {
  it("reads lowercase or uppercase hex, safe integers and bigints; anything else is null, never an error", () => {
    expect(parseWowId("1a2b3c4d")).toBe(0x1a2b3c4dn);
    expect(parseWowId("0A1B2C3D")).toBe(0x0a1b2c3dn);
    expect(parseWowId(169552957)).toBe(169552957n);
    expect(parseWowId(5n)).toBe(5n);
    for (const bad of [undefined, null, "", "xyz", "0", "-5", 1.5, {}, [], "1".repeat(17), "ffffffffffffffff"]) expect(parseWowId(bad)).toBeNull();
  });
  it("the Armory's decimal id is a separate entry point", () => {
    expect(parseWowIdDecimal("169552957")).toBe(169552957n);
    expect(parseWowIdDecimal("0a1b")).toBeNull();
  });
});

describe("resolveCharacter: the rule table", () => {
  it("1. an id finds its row, and a name difference is a rename", () => {
    const rows = [row("Dude Lebowski", 10n), row("Walter Sobchak", 11n)];
    expect(resolveCharacter(rows, { id: 10n, name: "Dude Lebowski" })).toMatchObject({ kind: "match", renamed: false, adopt: false });
    const renamed = resolveCharacter(rows, { id: 10n, name: "The Dude" });
    expect(renamed).toMatchObject({ kind: "match", renamed: true });
    expect(renamed.kind === "match" && renamed.row.wowId).toBe(10n);
  });
  it("2. no row has the id: the single id-less row with exactly that name adopts it", () => {
    expect(resolveCharacter([row("Dude Lebowski")], { id: 10n, name: "dude  lebowski" })).toMatchObject({ kind: "match", adopt: true });
  });
  it("2. two different ids never merge: a row holding the name under another id is never taken", () => {
    const result = resolveCharacter([row("Dude Lebowski", 10n)], { id: 99n, name: "Dude Lebowski" });
    expect(result).toMatchObject({ kind: "new" });
    expect(result.kind === "new" && result.nameTaken?.wowId).toBe(10n);
  });
  it("2. no row and no name: a new row", () => {
    expect(resolveCharacter([row("Walter Sobchak")], { id: 12n, name: "Donny Kerabatsos" })).toEqual({ kind: "new" });
  });
  it("2. an ambiguous name never adopts", () => {
    const rows = [row("Dude Lebowski"), { ...row("dude lebowski"), key: "second" }];
    expect(resolveCharacter(rows, { id: 10n, name: "Dude Lebowski" }).kind).toBe("new");
  });
  it("3. a name-only report matches the single exact name, an id-bearing row included", () => {
    expect(resolveCharacter([row("Dude Lebowski", 10n)], { name: "Dude Lebowski" })).toMatchObject({ kind: "match", adopt: false });
  });
  it("3. a first-name report matches nothing (no loose matching in the rule)", () => {
    expect(resolveCharacter([row("Dude Lebowski", 10n), row("Maude Lebowski", 11n)], { name: "Lebowski" })).toEqual({ kind: "none", ambiguous: false });
  });
  it("3. several rows with the name: ambiguous, nothing is touched", () => {
    const rows = [row("Dude Lebowski"), { ...row("Dude Lebowski"), key: "x" }];
    expect(resolveCharacter(rows, { name: "Dude Lebowski" })).toEqual({ kind: "none", ambiguous: true });
  });
  it("sameCharacterRef: ids decide when both are known, else an exact full name", () => {
    expect(sameCharacterRef({ id: 1n, name: "A B" }, { id: 1n, name: "Other Name" })).toBe(true);
    expect(sameCharacterRef({ id: 1n, name: "Dude Lebowski" }, { id: 2n, name: "Dude Lebowski" })).toBe(false);
    expect(sameCharacterRef({ id: 1n, name: "Dude Lebowski" }, { name: "Dude Lebowski" })).toBe(true);
    expect(sameCharacterRef({ name: "Lebowski" }, { name: "Dude Lebowski" })).toBe(false);
  });
});

describe("regression fixtures from the real bugs", () => {
  const roster: { name: string; id: bigint | null }[] = [
    { name: "Xaldin Xaldin", id: 1001n }, { name: "Chad", id: 1002n }, { name: "Hulke", id: 1003n },
    { name: "Dude Lebowski", id: 1004n }, { name: "Maude Lebowski", id: 1005n }, { name: "Walter Lebowski", id: 1006n }
  ];
  it("Lebowski siblings stay separate rows, each keeping its id", () => {
    const rows: Row[] = roster.map((r) => row(r.name, r.id));
    for (const r of roster) expect(resolveCharacter(rows, { id: r.id, name: r.name })).toMatchObject({ kind: "match", row: { name: r.name } });
    // The "Lebowski" first name no longer picks one of several.
    expect(resolveCharacter(rows, { name: "Lebowski" }).kind).toBe("none");
    // A second Xaldin report under a doubled name cannot resurrect or duplicate the row.
    expect(resolveCharacter(rows, { id: 1001n, name: "Xaldin Xaldin" })).toMatchObject({ kind: "match", renamed: false });
  });
  it("the same roster uploaded in any order, with and without ids, ends in the same rows", () => {
    const ingest = (reports: { name: string; id: bigint | null }[]) => {
      const rows: Row[] = [], index = indexCharacters(rows);
      for (const report of reports) {
        const found = resolveCharacter(index, report);
        if (found.kind === "match") {
          if (found.adopt) found.row.wowId = report.id;
          if (found.renamed) found.row.name = report.name;
          addToIndex(index, found.row);
        } else if ((found.kind === "new" && !found.nameTaken) || (found.kind === "none" && !found.ambiguous)) {
          const created = row(report.name, report.id); rows.push(created); addToIndex(index, created);
        }
      }
      return rows.map((r) => `${r.name}:${r.wowId ?? "-"}`).sort();
    };
    const withIds = roster.map((r) => r);
    const expected = ingest(withIds);
    // Deterministic shuffles.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 25; run++) {
      const shuffled = [...withIds].sort(() => rand() - 0.5);
      expect(ingest(shuffled)).toEqual(expected);
      // An old client's name-only copies of the same characters first or last change nothing.
      const mixed = rand() < 0.5 ? [...roster.map((r) => ({ name: r.name, id: null })), ...shuffled] : [...shuffled, ...roster.map((r) => ({ name: r.name, id: null }))];
      expect(ingest(mixed)).toEqual(expected);
    }
  });
});

// A minimal stand-in for the tables the roster ingest touches.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function fakeDb(seed: { characters?: Any[]; unclaimed?: Any[] } = {}) {
  const tables = { roster: [] as Any[], characters: seed.characters ?? [], unclaimed: seed.unclaimed ?? [] };
  let n = 0;
  const tx = {
    guildRosterEntry: { findMany: async () => tables.roster, upsert: async ({ create }: Any) => { tables.roster.push({ ...create, id: `r${++n}` }); }, updateMany: async () => ({ count: 0 }) },
    character: { findMany: async () => tables.characters.map((c) => ({ ...c, rankSeen: null })), update: async ({ where, data }: Any) => Object.assign(tables.characters.find((c) => c.id === where.id), data), updateMany: async () => ({ count: 0 }) },
    unclaimedCharacter: {
      findMany: async () => tables.unclaimed, update: async ({ where, data }: Any) => Object.assign(tables.unclaimed.find((c) => c.id === where.id), data), updateMany: async () => ({ count: 0 }),
      createMany: async ({ data }: Any) => { for (const r of data) tables.unclaimed.push({ ...r, id: `u${++n}` }); return { count: data.length }; }
    },
    guildEventEntry: { findMany: async () => [], create: async () => undefined },
    guildText: { findUnique: async () => null, upsert: async () => undefined },
    characterRankSeen: { upsert: async () => undefined }
  };
  return { tx: tx as never, tables };
}
const NOW = new Date("2026-12-20T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000) - 3600;
const upload = (members: Record<string, unknown>[]) => parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", guildRoster: { at: T, complete: true, members } });
const linked = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, realm: "Forever", gameEdition: "forever", displayName: name, level: 10, className: "Warrior", lastSeenAt: null, guildRankName: null, wowId: null, ...extra });

describe("roster ingest by id", () => {
  it("adopts ids onto the right sibling and never moves an id-bearing row to another", async () => {
    const db = fakeDb({ characters: [linked("c1", "Dude Lebowski"), linked("c2", "Maude Lebowski", { wowId: 1005n })] });
    await applyGuildData(db.tx, "g", { memberId: null, officer: false }, upload([
      { name: "Dude Lebowski", level: 20, class: "WARRIOR", id: "3e8" },
      { name: "Maude Lebowski", level: 30, class: "WARRIOR", id: "3e9" }   // a different id than the stored one: never accepted
    ]), NOW);
    expect(db.tables.characters.find((c) => c.id === "c1")).toMatchObject({ wowId: 1000n, level: 20 });
    expect(db.tables.characters.find((c) => c.id === "c2")).toMatchObject({ wowId: 1005n, level: 10 });
  });
  it("an old client's name-only roster still works", async () => {
    const db = fakeDb({ characters: [linked("c1", "Dude Lebowski")] });
    await applyGuildData(db.tx, "g", { memberId: null, officer: false }, upload([{ name: "Dude Lebowski", level: 20, class: "WARRIOR" }]), NOW);
    expect(db.tables.characters[0]).toMatchObject({ level: 20, wowId: null });
  });
  it("an id-bearing character refuses a first-name roster row", async () => {
    const db = fakeDb({ characters: [linked("c1", "Hulke Hogan", { wowId: 7n })] });
    await applyGuildData(db.tx, "g", { memberId: null, officer: false }, upload([{ name: "Hulke", level: 40, class: "WARRIOR" }]), NOW);
    expect(db.tables.characters[0]).toMatchObject({ level: 10, wowId: 7n });
  });
  it("a new unlinked member is created with its id; a duplicate id inside one roster is ignored after the first", async () => {
    const db = fakeDb();
    await applyGuildData(db.tx, "g", { memberId: null, officer: false }, upload([
      { name: "Chad Thundercock", level: 5, class: "MAGE", id: "7" }, { name: "Xaldin Xaldin", level: 6, class: "MAGE", id: "7" }
    ]), NOW);
    expect(db.tables.unclaimed.map((u) => [u.name, u.wowId ?? null])).toEqual([["Chad Thundercock", 7n], ["Xaldin Xaldin", null]]);
  });
  it("the GUID the armory branch sends reads as the same id", async () => {
    const db = fakeDb({ characters: [linked("c1", "Dude Lebowski")] });
    await applyGuildData(db.tx, "g", { memberId: null, officer: false }, upload([{ name: "Dude Lebowski", level: 20, class: "WARRIOR", guid: "Player-4408-0A1B2C3D" }]), NOW);
    expect(db.tables.characters[0]!.wowId).toBe(0x0a1b2c3dn);
  });
});

describe("contract: old and new payloads", () => {
  const base = { name: "Dude Lebowski", realm: "Forever" };
  it("accepts a character with no id, a hex id, and an unreadable id", () => {
    expect(addonCharacterSchema.safeParse(base).success).toBe(true);
    expect(addonCharacterSchema.safeParse({ ...base, id: "1a2b3c4d" }).success).toBe(true);
    for (const id of [42, {}, null, "not hex!", "x".repeat(40)]) expect(addonCharacterSchema.safeParse({ ...base, id }).success).toBe(true);
  });
  it("a whole snapshot with ids on its character and alts parses", () => {
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", character: { ...base, id: "1a" }, alts: [{ name: "Maude Lebowski", realm: "Forever" }] });
    expect(snapshot.character?.id).toBe("1a");
  });
});

describe("migration", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20270309130000_character_wow_id/migration.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  it("adds wowId BIGINT to the five tables and the unique indexes that allow many NULLs", () => {
    for (const table of ["Character", "UnclaimedCharacter", "DeviceCharacter", "DungeonRunPlayer", "PublicRunPlayer"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ADD COLUMN "wowId" BIGINT;`);
      expect(schema).toMatch(new RegExp(`model ${table} \\{[^}]*wowId\\s+BigInt\\?`));
    }
    expect(sql).toContain('CREATE UNIQUE INDEX "Character_guildId_gameEdition_wowId_key"');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);   // alters and indexes only
  });
});
