import { describe, expect, it } from "vitest";
import { characterId, foreverNameMatches, normalizeExportIdentities, sameCharacter } from "../companion/character-identity.mjs";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { exportDuelResults, exportGuildData, exportDungeonRuns, parseAddonExportDatabase } from "../companion/lua-export-content.mjs";
import { importDuelResults } from "../src/services/duels.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";

// Character ids, stage B (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md): the companion copies the addon's ids to the bot, the shared
// identity rule prefers them, and the bot accepts both the old (no ids) and the new payload.

describe("companion identity rule", () => {
  it("normalises ids to lowercase hex without leading zeros and ignores anything else", () => {
    expect(characterId("01A2B3C4")).toBe("1a2b3c4");
    expect(characterId(" ff ")).toBe("ff");
    for (const bad of [undefined, null, 5, "", "0", "zz", "a".repeat(17), "Player-1-00ab"]) expect(characterId(bad)).toBeUndefined();
  });

  it("sameCharacter: equal ids the same, different ids different, one missing falls back to the name rule", () => {
    expect(sameCharacter("Dude Lebowski", "Dude Lebowski", "1a", "2b")).toBe(false);
    expect(sameCharacter("Dude Lebowski", "Walter Sobchak", "1a", "01A")).toBe(true);
    expect(sameCharacter("Dude Lebowski", "Dude Lebowski", "1a", undefined)).toBe(true);
    expect(sameCharacter("Dude", "Dude Lebowski")).toBe(true);
    expect(sameCharacter("Dude Lebowski", "Dude Holyroller", "1a")).toBe(false);
  });

  it("foreverNameMatches with an id picks the row holding it and never a row with another id", () => {
    const byId = (row: { id?: string }) => row.id;
    const rows = [{ name: "Dude Lebowski", id: "1a" }, { name: "Dude Holyroller", id: "2b" }, { name: "Dude Greenleaf" }];
    expect(foreverNameMatches(rows, "Dude Holyroller", undefined, "1a", byId)).toEqual([rows[0]]);
    expect(foreverNameMatches(rows, "Dude Lebowski", undefined, "99", byId)).toEqual([]);            // a new id matches no row by name that has another id
    expect(foreverNameMatches(rows, "Dude Greenleaf", undefined, "99", byId)).toEqual([rows[2]]);     // a row without an id still matches by name
    expect(foreverNameMatches(rows, "Dude Lebowski", undefined, null, byId)).toEqual([rows[0]]);                     // no id: unchanged
  });

  it("normalizeExportIdentities passes an id through untouched", () => {
    const out = normalizeExportIdentities({ name: "Dude Lebowski", class: "MAGE", realm: "R", id: "1a2b" }, "forever", "R");
    expect(out.id).toBe("1a2b");
  });
});

describe("what the companion sends", () => {
  const database = {
    guildKey: "Guild-Realm",
    character: { name: "Dude Lebowski", realm: "Realm", class: "MAGE", race: "Human", level: 20, id: "01A2", gameEdition: "forever", interface: 16001 },
    guildSnapshot: { at: 1_800_000_000, complete: true, members: {
      "Dude Lebowski": { level: 20, class: "MAGE", online: true, guid: "Player-1-0000ABCD", id: "abcd" },
      "Maude Lebowski": { level: 21, class: "MAGE", online: false }
    } },
    peerRoster: { "Walter Sobchak": { id: "b01", identity: { class: "PALADIN", race: "Human", level: 40 }, status: "READY", updatedAt: 1, seenAt: 1_800_000_000 } },
    duels: { results: { a: { winner: "Dude Lebowski", loser: "Walter Sobchak", at: 1_799_999_000, reason: "knockout", wid: "A2", lid: "B01" },
      b: { winner: "Walter Sobchak", loser: "Dude Lebowski", at: 1_799_999_500, reason: "retreat" } } },
    dungeon: { runs: { r1: { id: "r1", state: "COMPLETED", instanceId: 389, name: "Ragefire Chasm", difficultyId: 1, startedAt: 1_799_990_000, endedAt: 1_799_991_000,
      recorder: "Dude Lebowski", encounters: {}, reporters: {},
      players: { "Dude Lebowski": { class: "MAGE", role: "DAMAGER", level: 20, deaths: 0, presentSec: 900, inGuild: true, id: "01a2" },
        "Maude Lebowski": { class: "MAGE", role: "DAMAGER", level: 20, deaths: 0, presentSec: 900, inGuild: true } } } } }
  };

  it("copies ids on the own character, peer characters, roster rows, run players and duels, and omits them where unknown", () => {
    const parsed = parseAddonExportDatabase(database, "Realm") as { character: { id?: string }; characters?: { name: string; id?: string }[] };
    expect(parsed.character.id).toBe("1a2");
    expect(parsed.characters?.find((row) => row.name === "Walter Sobchak")?.id).toBe("b01");
    const roster = exportGuildData(database).guildRoster!.members;
    expect(roster.find((row: { name: string }) => row.name === "Dude Lebowski")).toMatchObject({ id: "abcd", guid: "Player-1-0000ABCD" });
    expect(roster.find((row: { name: string }) => row.name === "Maude Lebowski")).not.toHaveProperty("id");
    const runs = exportDungeonRuns(database, "Realm");
    const players = runs[0]!.players as { character: string; id?: string }[];
    expect(players.find((p) => p.character === "Dude Lebowski")?.id).toBe("1a2");
    expect(players.find((p) => p.character === "Maude Lebowski")).not.toHaveProperty("id");
    const duels = exportDuelResults(database);
    expect(duels.find((d: { winner: string }) => d.winner === "Dude Lebowski")).toMatchObject({ winnerId: "a2", loserId: "b01" });
    expect(duels.find((d: { winner: string }) => d.winner === "Walter Sobchak")).not.toHaveProperty("winnerId");
  });

  it("the unsigned (device) upload carries each character's id", () => {
    const body = deviceUploadBody({ wowGuild: "Guild-Realm", character: { name: "Dude Lebowski", realm: "R", class: "MAGE", level: 20, id: "01a2" }, alts: [{ name: "Maude Lebowski", realm: "R" }] }) as { characters: { name: string; id?: string }[] };
    expect(body.characters[0]).toMatchObject({ name: "Dude Lebowski", id: "1a2" });
    expect(body.characters[1]).not.toHaveProperty("id");
  });

  it("a run is attributed to this PC by id when both sides have one: a same-named sibling does not vouch for it", () => {
    const run = { state: "COMPLETED", endedAt: 5, players: [{ character: "Dude Lebowski", id: "99" }] };
    const sent = (id: string | undefined) => (deviceUploadBody({ wowGuild: "G-R", character: { name: "Dude Lebowski", realm: "R", ...(id ? { id } : {}) }, dungeonRuns: [run] }) as { dungeonRuns?: unknown[] }).dungeonRuns?.length ?? 0;
    expect(sent("1a")).toBe(0);
    expect(sent("99")).toBe(1);
    expect(sent(undefined)).toBe(1);
  });
});

describe("the bot accepts the old and the new payload", () => {
  const base = { source: "Guilded", gameEdition: "forever", interface: 16001, exportedAt: "2026-11-20T00:00:00Z", transactions: [], epgpTransactions: [], readiness: [], attunements: [] };
  it("old (no ids), new (ids) and a malformed id all parse; the unreadable id is ignored, not rejected", () => {
    const character = { name: "Dude Lebowski", realm: "R", class: "MAGE", race: "Human", level: 20 };
    expect(parseAddonSnapshot({ ...base, character }).character?.name).toBe("Dude Lebowski");
    expect(parseAddonSnapshot({ ...base, character: { ...character, id: "1a2b" } }).character?.name).toBe("Dude Lebowski");
    expect(parseAddonSnapshot({ ...base, character: { ...character, id: { weird: true } } }).character?.name).toBe("Dude Lebowski");
  });

  it("roster rows and run players with and without ids validate", () => {
    const row = { name: "Dude Lebowski", level: 20, online: true };
    expect(parseAddonSnapshot({ ...base, guildRoster: { at: 1_800_000_000, complete: true, members: [row, { ...row, id: "1a2b" }, { ...row, id: 42 }] } }).guildRoster?.members).toHaveLength(3);
    const run = { id: "run-1", protocolVersion: 1, instanceId: 389, name: "RFC", state: "COMPLETED", startedAt: 1_799_990_000, endedAt: 1_799_991_000, durationSec: 1000, completedBy: "final boss", recorder: "Dude Lebowski", encounters: [], reporters: 1,
      players: [{ character: "Dude Lebowski", realm: "R" }, { character: "Maude Lebowski", realm: "R", id: "1a2b" }, { character: "Walter Sobchak", realm: "R", id: "not hex" }] };
    const parsed = dungeonRunSchema.safeParse(run);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.players.map((p) => p.id)).toEqual([undefined, "1a2b", undefined]);
  });
});

describe("duel results with ids (the duel schema is strict)", () => {
  const at = Math.floor(Date.now() / 1000) - 600;
  function fakeTx() {
    const rows: Record<string, unknown>[] = [];
    return { rows, tx: { duelResult: { findFirst: async () => null, count: async () => 0, createMany: async ({ data }: { data: Record<string, unknown>[] }) => { rows.push(...data); return { count: data.length }; } } } as never };
  }
  const characters = [
    { id: "c1", name: "Dude Lebowski", realm: "R", memberId: "m1", wowId: 0x1an },
    { id: "c2", name: "Dude Holyroller", realm: "R", memberId: "m2", wowId: 0x2bn },
    { id: "c3", name: "Dude Greenleaf", realm: "R", memberId: "m3" }
  ];

  it("accepts a duel with ids and without, and resolves by id first", async () => {
    const { tx, rows } = fakeTx();
    const result = await importDuelResults(tx, "g", "forever", "m1", characters, [
      { winner: "Dude Lebowski", loser: "Dude Holyroller", at, reason: "knockout", winnerId: "1A", loserId: "2b" },
      { winner: "Dude Lebowski", loser: "Dude Greenleaf", at: at + 100, reason: "retreat" }
    ]);
    expect(result.rejected).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ winnerId: "m1", loserId: "m2" });
  });

  it("an id naming another stored character wins over the name, and an unreadable id is ignored", async () => {
    const { tx, rows } = fakeTx();
    await importDuelResults(tx, "g", "forever", "m1", characters, [
      { winner: "Dude Lebowski", loser: "Dude Holyroller", at, reason: "knockout", winnerId: "2b", loserId: "zz" }   // the winner's id is the Holyroller row's
    ]);
    expect(rows).toHaveLength(0);                                                                                      // same member on both sides is refused, never scored on the wrong row
  });
});
