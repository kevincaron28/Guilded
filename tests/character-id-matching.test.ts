import { describe, expect, it } from "vitest";
import { foreverNameMatches, foreverSameName } from "../companion/character-identity.mjs";
import { findCharacter, ledgerOwner } from "../src/services/character-match.js";
import { dedupeRunPlayers, sameRunPlayer, runFullName } from "../src/services/dungeon-import.js";
import { displayCharacterName } from "../src/services/character-display.js";
import { withoutDeparted } from "../src/services/roster-presence.js";
import { sameCharacter } from "../src/services/device-claim-offer.js";
import { pairingCandidatesWhere } from "../src/services/character-pairing.js";

const row = (name: string, wowId: bigint | null, memberId = "m1") => ({ name, realm: "-", gameEdition: "forever", memberId, wowId });

describe("character ids, always on: name-only data behaves as before", () => {
  it("keeps the loose first-name rule when neither side has an id", () => {
    expect(foreverSameName("Lebowski", "Lebowski Holyroller")).toBe(true);
    expect(findCharacter([row("Lebowski", null)], "Lebowski Holyroller", "-", "forever")?.name).toBe("Lebowski");
  });
});

describe("character ids, always on: rows and reports that carry ids", () => {
  it("two different ids never match, even with the same name", () => {
    expect(foreverSameName("Dude Lebowski", "Dude Lebowski", 1n, 2n)).toBe(false);
    expect(foreverSameName("Old Name", "New Name", 7n, "7")).toBe(true); // rename keeps the character
  });
  it("an id-bearing row refuses a first-name-only report", () => {
    expect(foreverSameName("Lebowski Holyroller", "Lebowski", 5n, null)).toBe(false);
    expect(findCharacter([row("Lebowski Holyroller", 5n)], "Lebowski", "-", "forever")).toBeUndefined();
    expect(foreverNameMatches([row("Lebowski Holyroller", 5n)], "Lebowski")).toEqual([]);
    expect(ledgerOwner([row("Lebowski Holyroller", 5n)], "Lebowski", "-", "forever")).toBeUndefined();
    // a row without an id still takes the old path
    expect(foreverNameMatches([row("Lebowski Holyroller", null)], "Lebowski")).toHaveLength(1);
  });
  it("several Lebowski characters of one owner stay distinct", () => {
    const rows = [row("Lebowski Holyroller", 1n), row("Lebowski Banker", 2n), row("Lebowski Tank", 3n)];
    expect(findCharacter(rows, "Lebowski Banker", "-", "forever", 2n)?.wowId).toBe(2n);
    expect(findCharacter(rows, "Lebowski", "-", "forever")).toBeUndefined();
    expect(findCharacter(rows, "Lebowski Mage", "-", "forever", 4n)).toBeUndefined();
  });
  it("a rename with the same id keeps the row", () => {
    expect(findCharacter([row("Old Name", 9n)], "New Name", "-", "forever", 9n)?.name).toBe("Old Name");
    expect(foreverNameMatches([row("Old Name", 9n)], "New Name", (r) => r.name, 9n)).toHaveLength(1);
  });
  it("a report with an id never lands on a row holding another id", () => {
    expect(findCharacter([row("Dude Lebowski", 1n)], "Dude Lebowski", "-", "forever", 2n)).toBeUndefined();
    expect(foreverNameMatches([row("Dude Lebowski", 1n)], "Dude Lebowski", (r) => r.name, 2n)).toEqual([]);
  });
  it("device offers compare ids when both sides have one", () => {
    expect(sameCharacter("Bob Smith", "Bob Smith", 1n, 2n)).toBe(false);
    expect(sameCharacter("Bob Smith", "Bob Renamed", 1n, 1n)).toBe(true);
  });
  it("pairing loads the id row plus unstamped first-name rows only", () => {
    expect(pairingCandidatesWhere("g", { name: "Lebowski Holyroller", gameEdition: "forever", id: "1a" }))
      .toMatchObject({ OR: [{ wowId: 26n }, { wowId: null, name: { startsWith: "Lebowski" } }] });
  });
  it("departed detection uses the id when the roster holds it", () => {
    const chars = [{ key: "newname", name: "New Name", wowId: 4n }, { key: "x", name: "X Y", wowId: null }];
    const roster = [{ name: "Old Name", nameKey: "old name", inGuild: false, observedAt: new Date(), wowId: 4n }, { name: "Other", nameKey: "other", inGuild: true, observedAt: new Date(), wowId: 8n }];
    expect(withoutDeparted(chars, roster).map((c) => c.key)).toEqual(["x"]);
  });
  it("display and run full names keep an id-bearing name as stored", () => {
    expect(displayCharacterName({ name: "Lebowski", wowId: 5n }, ["Lebowski Holyroller"])).toBe("Lebowski");
    expect(displayCharacterName({ name: "Lebowski", wowId: null }, ["Lebowski Holyroller"])).toBe("Lebowski Holyroller");
    expect(runFullName("Lebowski", [{ name: "Lebowski Holyroller" }], [], 5n)).toBe("Lebowski");
  });
  it("run players: ids decide, first-word merging skips id-bearing entries", () => {
    expect(sameRunPlayer({ character: "Dude A", id: "1" }, { character: "Dude B", id: "2" })).toBe(false);
    expect(sameRunPlayer({ character: "Dude A", id: "1" }, { character: "Dude A" })).toBe(true);
    expect(sameRunPlayer({ character: "Dude", id: "1" }, { character: "Dude A" })).toBe(false);
    const base = { realm: "-", inGuild: true, presentSec: 10 };
    expect(dedupeRunPlayers([{ ...base, character: "Hulke", id: "1" }, { ...base, character: "Hulke Hogan", id: "2" }] as never)).toHaveLength(2);
    expect(dedupeRunPlayers([{ ...base, character: "Hulke" }, { ...base, character: "Hulke Hogan" }] as never)).toHaveLength(1);
  });
});
