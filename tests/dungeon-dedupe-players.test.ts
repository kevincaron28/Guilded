import { describe, expect, it } from "vitest";
import { dedupeRunPlayers } from "../src/services/dungeon-import.js";

describe("dedupeRunPlayers", () => {
  it("keeps one row per character when observers repeat a player or disagree on the realm", () => {
    const players = [
      { character: "Hulke", realm: "-", presentSec: 1600, deaths: null, inGuild: false },
      { character: "Hulke", realm: "Forever", presentSec: 1630, deaths: 0, class: "DRUID", inGuild: true },
      { character: "xaldin", realm: "-", presentSec: 1630, deaths: null, inGuild: true },
      { character: "Xaldin", realm: "-", presentSec: 1500, deaths: 1, inGuild: false },
      { character: "Mister", realm: "-", presentSec: 1630, deaths: 0, inGuild: true }
    ] as never[];
    const result = dedupeRunPlayers(players) as unknown as { character: string; deaths: number | null; inGuild: boolean; class?: string; presentSec: number }[];
    expect(result.map((p) => p.character)).toEqual(["Hulke", "xaldin", "Mister"]);
    expect(result[0]).toMatchObject({ presentSec: 1630, deaths: 0, class: "DRUID", inGuild: true });
    expect(result[1]).toMatchObject({ presentSec: 1630, deaths: 1, inGuild: true });
  });
});

describe("dedupeRunPlayers: first names, full names and the realm word", () => {
  const p = (character: string, extra: Record<string, unknown> = {}) => ({ character, realm: "Forever", presentSec: 1600, deaths: null, inGuild: true, ...extra });
  const names = (players: unknown[]) => (dedupeRunPlayers(players as never[]) as unknown as { character: string }[]).map((row) => row.character);

  it("merges the Wailing Caverns party as reported by three observers into exactly five players", () => {
    const party = [
      p("Hulke Hogan", { class: "DRUID" }), p("Maxle Druide", { class: "DRUID" }), p("Xaldin Xaldin", { class: "MAGE" }), p("Shawir Forever", { class: "PRIEST" }), p("Crashing", { class: "PALADIN" }),
      p("Hulke", { class: "DRUID" }), p("Maxle Druide", { class: "DRUID" }), p("Xaldin", { class: "MAGE" }), p("Shawir", { class: "PRIEST" }), p("Crashing Pally", { class: "PALADIN" }),
      p("Hulke Hogan"), p("Maxle  druide"), p("Xaldin Xaldin"), p("Shawir Forever"), p("Crashing Pally")
    ];
    expect(names(party)).toEqual(["Hulke Hogan", "Maxle Druide", "Xaldin", "Shawir", "Crashing Pally"]);
  });
  it("keeps the longest presence and known details when merging a first name into a full name", () => {
    const [row] = dedupeRunPlayers([p("Crashing", { presentSec: 5000, deaths: 2, class: "PALADIN" }), p("Crashing Pally", { presentSec: 4000, deaths: null })] as never[]) as unknown as { character: string; presentSec: number; deaths: number; class: string }[];
    expect(row).toMatchObject({ character: "Crashing Pally", presentSec: 5000, deaths: 2, class: "PALADIN" });
  });
  it("never merges two different people who share a first name", () => {
    expect(names([p("Hulke Hogan"), p("Hulke Smith")])).toEqual(["Hulke Hogan", "Hulke Smith"]);
    // A bare first name that two full names could match is ambiguous: left alone.
    expect(names([p("Hulke"), p("Hulke Hogan"), p("Hulke Smith")])).toEqual(["Hulke", "Hulke Hogan", "Hulke Smith"]);
    // The class breaks the tie when it is known.
    expect(names([p("Hulke", { class: "DRUID" }), p("Hulke Hogan", { class: "DRUID" }), p("Hulke Smith", { class: "MAGE" })])).toEqual(["Hulke Hogan", "Hulke Smith"]);
    // Different classes under one first name are different people.
    expect(names([p("Hulke", { class: "MAGE" }), p("Hulke Hogan", { class: "DRUID" })])).toEqual(["Hulke", "Hulke Hogan"]);
  });
  it("does not treat a repeated first name or the realm as a last name", () => {
    expect(names([p("Xaldin Xaldin")])).toEqual(["Xaldin"]);
    expect(names([p("Shawir Forever")])).toEqual(["Shawir"]);
    expect(names([p("Élan Ravenclaw"), p("élan")])).toEqual(["Élan Ravenclaw"]);
  });
});
