import { describe, expect, it } from "vitest";
import { parseAddonSnapshot, normalizeAddonSnapshot } from "../src/integrations/addon.js";

describe("parseAddonSnapshot", () => {
  it("accepts a normalized addon export", () => {
    const snapshot = parseAddonSnapshot({
      source: "ForeverLootManager",
      exportedAt: "2026-09-24T00:00:00.000Z",
      transactions: [{
        character: "Kevin",
        realm: "WoW Forever",
        amount: 10,
        type: "AWARD",
        reason: "Raid attendance"
      }]
    });
    expect(snapshot.transactions).toHaveLength(1);
  });

  // Every export carries the whole ledger: one bad row is left out, it does not refuse the rest.
  it("leaves a zero-value transaction out and keeps the valid ones", () => {
    const snapshot = parseAddonSnapshot({
      source: "ForeverLootManager",
      exportedAt: "2026-09-24T00:00:00.000Z",
      transactions: [
        { character: "Kevin", realm: "WoW Forever", amount: 0, type: "AWARD", reason: "Invalid" },
        { character: "Kevin", realm: "WoW Forever", amount: 5, type: "AWARD", reason: "Valid" }
      ]
    });
    expect(snapshot.transactions.map((row) => row.amount)).toEqual([5]);
    expect(snapshot.rejected).toEqual([expect.objectContaining({ section: "transactions", label: "Kevin" })]);
  });

  it("still refuses a file that is not an addon export at all", () => {
    expect(() => parseAddonSnapshot({ exportedAt: "2026-09-24T00:00:00.000Z" })).toThrow();
    expect(() => parseAddonSnapshot("nope")).toThrow();
  });

  it("leaves out a guildmate's malformed digest instead of refusing the officer's upload", () => {
    const snapshot = parseAddonSnapshot({
      source: "Guilded",
      exportedAt: "2026-09-24T00:00:00.000Z",
      epgpTransactions: [{ character: "Kevin", realm: "R", epAmount: 50, type: "EP_AWARD", reason: "Raid", sourceRef: "qg:a" }],
      characters: [{ name: "Mallory", realm: "R", class: "WARRIOR", level: 999 }, { name: "Ann", realm: "R", class: "MAGE", level: 60 }],
      readiness: [{ character: "Mallory", realm: "R", professions: [{ name: "", skillLevel: 300 }] }]
    });
    expect(snapshot.epgpTransactions).toHaveLength(1);
    expect(snapshot.characters.map((row) => row.name)).toEqual(["Ann"]);
    expect(snapshot.readiness).toEqual([]);
    expect(snapshot.rejected.map((row) => row.section).sort()).toEqual(["characters", "readiness"]);
    // The stored payload is parsed again when it is applied: the note survives, nothing is added twice.
    expect(parseAddonSnapshot(JSON.parse(JSON.stringify(snapshot))).rejected).toHaveLength(2);
  });

  it("accepts an EPGP-shaped transaction separate from the DKP transactions", () => {
    const snapshot = normalizeAddonSnapshot(parseAddonSnapshot({
      source: "Guilded",
      exportedAt: "2026-09-24T00:00:00.000Z",
      epgpTransactions: [{
        character: " Kevin ",
        realm: " WoW Forever ",
        epAmount: 10,
        gpAmount: 0,
        type: "EP_AWARD",
        reason: "Raid attendance"
      }]
    }));
    expect(snapshot.epgpTransactions).toHaveLength(1);
    expect(snapshot.epgpTransactions[0]?.character).toBe("Kevin");
    expect(snapshot.transactions).toHaveLength(0);
  });

  it("leaves out an EPGP transaction that changes neither EP nor GP", () => {
    const snapshot = parseAddonSnapshot({
      source: "Guilded",
      exportedAt: "2026-09-24T00:00:00.000Z",
      epgpTransactions: [{
        character: "Kevin",
        realm: "WoW Forever",
        epAmount: 0,
        gpAmount: 0,
        type: "ADJUSTMENT",
        reason: "No-op"
      }]
    });
    expect(snapshot.epgpTransactions).toEqual([]);
    expect(snapshot.rejected[0]).toMatchObject({ section: "epgpTransactions", reason: expect.stringContaining("must change EP or GP") });
  });

  it("accepts a readiness entry with no missing-slot findings", () => {
    const snapshot = parseAddonSnapshot({
      source: "Guilded",
      exportedAt: "2026-09-24T00:00:00.000Z",
      readiness: [{
        character: "Kevin",
        realm: "WoW Forever",
        items: [{ slot: "Head", itemName: "Lionheart Helm", itemId: "16795" }],
        findings: [{ code: "GEAR_PRESENT", severity: "INFO", message: "Required gear slots are populated." }]
      }]
    });
    expect(snapshot.readiness).toHaveLength(1);
    expect(snapshot.readiness[0]?.items[0]?.itemName).toBe("Lionheart Helm");
  });

  it("accepts professions embedded in a readiness entry", () => {
    const snapshot = parseAddonSnapshot({
      source: "Guilded",
      exportedAt: "2026-09-24T00:00:00.000Z",
      readiness: [{
        character: "Kevin",
        realm: "WoW Forever",
        professions: [{ name: "Blacksmithing", skillLevel: 225 }]
      }]
    });
    expect(snapshot.readiness[0]?.professions).toEqual([{ name: "Blacksmithing", skillLevel: 225 }]);
  });

  it("accepts and trims a top-level attunement entry", () => {
    const snapshot = normalizeAddonSnapshot(parseAddonSnapshot({
      source: "Guilded",
      exportedAt: "2026-09-24T00:00:00.000Z",
      attunements: [{ character: " Kevin ", realm: " WoW Forever ", name: " Onyxia Key ", completed: true }]
    }));
    expect(snapshot.attunements).toEqual([{ character: "Kevin", realm: "WoW Forever", name: "Onyxia Key", completed: true }]);
  });
});
