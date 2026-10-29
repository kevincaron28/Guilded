import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseLootHistory, previewLootHistory, LOOT_IMPORT_LIMITS } from "../companion/loot-history-import.mjs";

const mapping = { source: "rclootcouncil", guild: "Guild", realm: "Realm", edition: "classic-era", characterMap: { "Élodie-Realm": "Élodie-Realm" } };
const rc = { player: "Élodie-Realm", date: "2026/10/28", time: "20:34:12", id: "1793219652-1", itemID: 19364,
  itemString: "item:19364::::::::60", response: "Main Spec", instance: "Blackwing Lair", boss: "Nefarian", note: "Private note", gp: 500 };
const gargul = { awardedTo: "Élodie-Realm", timestamp: 1793219652, itemID: 19364, itemLink: "|cffa335ee|Hitem:19364::::::::60|h[Ashkandi]|h|r", checksum: "abc123", OS: false, gold: 5000 };
const encode = (rows: unknown[]) => JSON.stringify(rows);

describe("external loot history preview", () => {
  it("runs the offline CLI, refuses overwrite and rejects oversized files before producing output", () => {
    const dir = mkdtempSync(join(tmpdir(), "guilded-loot-preview-"));
    const input = join(dir, "input.json"), options = join(dir, "mapping.json"), output = join(dir, "preview.json");
    const script = fileURLToPath(new URL("../companion/loot-history-import.mjs", import.meta.url));
    try {
      writeFileSync(input, encode([rc])); writeFileSync(options, JSON.stringify(mapping));
      const command = () => spawnSync(process.execPath, [script, input, options, output], { encoding: "utf8", windowsHide: true });
      expect(command().status).toBe(0);
      const original = readFileSync(output, "utf8");
      expect(JSON.parse(original).previewOnly).toBe(true);
      expect(command().status).toBe(1);
      expect(readFileSync(output, "utf8")).toBe(original);
      writeFileSync(input, "x".repeat(LOOT_IMPORT_LIMITS.bytes + 1));
      expect(command().stderr).toContain("size limit");
      expect(readFileSync(output, "utf8")).toBe(original);
    } finally {
      for (const path of [input, options, output]) { try { unlinkSync(path); } catch { /* A failed command may not create output. */ } }
      rmdirSync(dir);
    }
  });
  it("reads the RCLootCouncil JSON export and preserves scope, provenance and explicit mappings", () => {
    const result = previewLootHistory(encode([rc]), mapping);
    expect(result.previewOnly).toBe(true);
    expect(result.scope).toEqual({ guild: "Guild", realm: "Realm", edition: "classic-era" });
    expect(result.provenance.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.entries[0]).toMatchObject({ character: "Élodie-Realm", itemId: 19364, sourceId: rc.id,
      awardedAt: { value: "2026-10-28T20:34:12", timezone: "unknown" } });
    expect(JSON.stringify(result)).not.toContain("Private note");
    for (const key of ["gp", "ep", "cost", "gold", "note"]) expect(result.entries[0]).not.toHaveProperty(key);
  });
  it("uses explicit server time from RCLC JSON without guessing local offset", () => {
    expect(parseLootHistory(encode([{ ...rc, servertime: "1793219652" }]), "rclootcouncil").entries[0]!.awardedAt)
      .toEqual({ value: new Date(1793219652000).toISOString(), timezone: "UTC", precision: "second" });
  });
  it("accepts native RCLC CSV quoting, BOM, CRLF and quoted newlines", () => {
    const csv = '\uFEFFplayer,date,time,id,itemID,response,instance,boss\r\nÉlodie-Realm,2026/10/28,20:34:12,award-1,19364,"Need, really","Blackwing\nLair","Boss ""One"""\r\n';
    expect(parseLootHistory(csv, "rclootcouncil").entries[0]).toMatchObject({ response: "Need, really", instance: "Blackwing\nLair", boss: 'Boss "One"' });
  });
  it("reads Gargul JSON and derives missing item IDs from item links", () => {
    const result = previewLootHistory(encode([{ ...gargul, itemID: undefined }]), { ...mapping, source: "gargul" });
    expect(result.entries[0]).toMatchObject({ itemId: 19364, offspec: false, sourceId: "abc123", awardedAt: { timezone: "UTC" } });
    expect(result.entries[0]).not.toHaveProperty("gold");
  });
  it("reads actual Gargul TMB CSV with date-only precision and conversion warning", () => {
    const result = previewLootHistory("dateTime,character,itemID,offspec,id\n2026-10-28,Élodie-Realm,18422,1,checksum", { ...mapping, source: "gargul" });
    expect(result.entries[0]).toMatchObject({ itemId: 18422, offspec: true, awardedAt: { value: "2026-10-28", precision: "day", timezone: "unknown" } });
    expect(result.warnings.join(" ")).toContain("substitute token item IDs");
  });
  it("does not guess source, guild, edition or missing character mappings", () => {
    expect(() => previewLootHistory(encode([rc]), { ...mapping, source: undefined })).toThrow("Choose");
    expect(() => previewLootHistory(encode([rc]), { ...mapping, guild: "" })).toThrow();
    expect(() => previewLootHistory(encode([rc]), { ...mapping, edition: "unknown" })).toThrow();
    const result = previewLootHistory(encode([rc]), { ...mapping, characterMap: {} });
    expect(result.unmappedCharacters).toEqual(["Élodie-Realm"]);
    expect(result.entries[0]!.character).toBeNull();
  });
  it("keeps identical short names on different realms separate", () => {
    const result = previewLootHistory(encode([{ ...rc, player: "Ann-One" }, { ...rc, player: "Ann-Two" }]), { ...mapping, characterMap: { "Ann-One": "Ann-One", "Ann-Two": "Ann-Two" } });
    expect(result.entries.map(row => row.character)).toEqual(["Ann-One", "Ann-Two"]);
    expect(new Set(result.entries.map(row => row.importKey)).size).toBe(2);
  });
  it("rejects a mapping that strips the realm", () => {
    expect(() => previewLootHistory(encode([rc]), { ...mapping, characterMap: { "Élodie-Realm": "Élodie" } })).toThrow("Name-Realm");
  });
  it("deduplicates matching stable IDs independently of input ordering", () => {
    const second = { ...rc, id: "other", itemID: 17063 };
    const a = previewLootHistory(encode([rc, second, rc]), mapping);
    const b = previewLootHistory(encode([second, rc]), mapping);
    expect(a.summary).toMatchObject({ sourceRows: 3, previewRows: 2, duplicates: 1 });
    expect(a.duplicateRows).toEqual([3]);
    expect(a.entries.map(row => row.importKey).sort()).toEqual(b.entries.map(row => row.importKey).sort());
  });
  it("refuses conflicting stable IDs rather than silently dropping or replacing awards", () => {
    expect(() => previewLootHistory(encode([rc, { ...rc, itemID: 17063 }]), mapping)).toThrow("Conflicting");
  });
  it("retains and flags identical awards without IDs; a genuine second item is not discarded", () => {
    const result = previewLootHistory(encode([{ ...rc, id: "nil" }, { ...rc, id: undefined }]), mapping);
    expect(result.summary).toMatchObject({ previewRows: 2, duplicates: 0, missingSourceIds: 2 });
    expect(result.ambiguousRows).toEqual([2]);
    expect(result.entries[0]!.importKey).toBeNull();
  });
  it("scopes deduplication to destination guild, realm, edition and source", () => {
    const key = previewLootHistory(encode([rc]), mapping).entries[0]!.importKey;
    for (const change of [{ guild: "Other" }, { realm: "Other" }, { edition: "retail" }]) {
      expect(previewLootHistory(encode([rc]), { ...mapping, ...change }).entries[0]!.importKey).not.toBe(key);
    }
  });
  it.each(["28/10/26", "10/28/2026", "2026-02-29", "2026-13-01"])("rejects invalid or ambiguous dates: %s", date => {
    expect(() => parseLootHistory(encode([{ ...rc, date }]), "rclootcouncil")).toThrow();
  });
  it.each([0, -1, 1.5, "19364junk", "9007199254740993"])("rejects invalid item IDs: %s", itemID => {
    expect(() => parseLootHistory(encode([{ ...rc, itemID }]), "rclootcouncil")).toThrow("item ID");
  });
  it.each(["25:00", "12:60", "12:00Z"])("rejects invalid local clocks: %s", time => {
    expect(() => parseLootHistory(encode([{ ...rc, time }]), "rclootcouncil")).toThrow("time");
  });
  it("rejects malformed JSON, Lua code and wrong export sources", () => {
    for (const input of ["[]", "[null]", "[", "os.execute('anything')", "GuildedDB={}", encode([gargul])]) {
      expect(() => parseLootHistory(input, "rclootcouncil")).toThrow();
    }
  });
  it("rejects malformed quoting, inconsistent rows and duplicate headers", () => {
    for (const input of ['player,date,time,itemID\n"oops', 'player,date,time,itemID\n"Ann"bad,2026/10/28,20:00,19364',
      'player,date,time,itemID\nAnn,2026/10/28,20:00', 'player,date,time,itemID,itemID\nAnn,2026/10/28,20:00,1,2']) {
      expect(() => parseLootHistory(input, "rclootcouncil")).toThrow();
    }
  });
  it("enforces size, row, field and type limits without partial imports", () => {
    expect(() => parseLootHistory("x".repeat(LOOT_IMPORT_LIMITS.bytes + 1), "gargul")).toThrow("2 MB");
    expect(() => parseLootHistory(encode(Array.from({ length: 5001 }, () => ({ player: "A" }))), "rclootcouncil")).toThrow("5,000");
    expect(() => parseLootHistory(encode([{ ...rc, response: "x".repeat(4097) }]), "rclootcouncil")).toThrow();
    expect(() => parseLootHistory(encode([{ ...rc, player: { name: "Ann" } }]), "rclootcouncil")).toThrow();
    expect(() => parseLootHistory(encode([{ ...gargul, OS: "false" }]), "gargul")).toThrow("offspec");
  });
});
