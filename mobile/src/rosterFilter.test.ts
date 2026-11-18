import { describe, expect, it } from "vitest";
import type { CharacterCard, StandingRow } from "./api";
import { classesOf, filterCharacters, filterStandings, filtersActive, matchesSearch, noFilters, rolesOf } from "./rosterFilter";

const card = (name: string, className: string, level: number | null, roles: string[], displayName: string | null = null): CharacterCard => ({
  id: name, name, displayName, realm: "Kronos", className, spec: null, level, isMain: false, edition: "forever", rank: null, guildName: "QG", serverName: null, current: true,
  cores: roles.map((role) => ({ name: "Core", role, bench: false, trial: false, backup: false }))
});
const cards = [card("Aldric", "Warrior", 60, ["TANK"]), card("Brenna", "Priest", 58, ["HEALER"]), card("Élodie", "Mage", 60, ["DPS", "DPS"]), card("Corvin", "Warrior", null, [])];
const row = (character: string, ep: number, gp: number): StandingRow => ({ character, realm: "Kronos", main: true, ep, gp, pr: gp ? ep / gp : 0, mine: false });

describe("roster filters", () => {
  it("matches every typed word, ignoring case and accents", () => {
    expect(matchesSearch("", "Aldric")).toBe(true);
    expect(matchesSearch("elod", "Élodie")).toBe(true);
    expect(matchesSearch("alD kron", "Aldric", "Kronos")).toBe(true);
    expect(matchesSearch("alD nope", "Aldric", "Kronos")).toBe(false);
  });
  it("filters characters by search, class and role and sorts by name or level", () => {
    expect(filterCharacters(cards, noFilters, "name").map((c) => c.name)).toEqual(["Aldric", "Brenna", "Corvin", "Élodie"]);
    expect(filterCharacters(cards, noFilters, "level").map((c) => c.name)).toEqual(["Aldric", "Élodie", "Brenna", "Corvin"]);
    expect(filterCharacters(cards, { ...noFilters, className: "Warrior" }, "name").map((c) => c.name)).toEqual(["Aldric", "Corvin"]);
    expect(filterCharacters(cards, { ...noFilters, role: "HEALER" }, "name").map((c) => c.name)).toEqual(["Brenna"]);
    expect(filterCharacters(cards, { search: "war", className: null, role: null }, "name").map((c) => c.name)).toEqual(["Aldric", "Corvin"]);
    expect(filterCharacters(cards, { ...noFilters, className: "Priest", role: "TANK" }, "name")).toEqual([]);
  });
  it("lists distinct classes and roles and tells when a filter is on", () => {
    expect(classesOf(cards)).toEqual(["Mage", "Priest", "Warrior"]);
    expect(rolesOf(cards[2]!)).toEqual(["DPS"]);
    expect(filtersActive(noFilters)).toBe(false);
    expect(filtersActive({ ...noFilters, search: " " })).toBe(false);
    expect(filtersActive({ ...noFilters, role: "DPS" })).toBe(true);
  });
  it("searches and sorts the EP/GP standings without changing the input", () => {
    const rows = [row("Zed", 100, 50), row("Amy", 300, 100), row("Bob", 90, 30)];
    expect(filterStandings(rows, "", "pr").map((r) => r.character)).toEqual(["Amy", "Bob", "Zed"]);
    expect(filterStandings(rows, "", "ep").map((r) => r.character)).toEqual(["Amy", "Zed", "Bob"]);
    expect(filterStandings(rows, "", "name").map((r) => r.character)).toEqual(["Amy", "Bob", "Zed"]);
    expect(filterStandings(rows, "b", "name").map((r) => r.character)).toEqual(["Bob"]);
    expect(rows.map((r) => r.character)).toEqual(["Zed", "Amy", "Bob"]);
  });
});
