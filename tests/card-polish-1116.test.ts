import { describe, expect, it } from "vitest";
import { dungeonDisplayName, dungeonRunCard } from "../src/services/dungeon-card.js";
import { allEnglishDungeonNames, frenchDungeon, hasFrenchName, UNVERIFIED_FRENCH } from "../src/services/dungeon-name-table.js";
import { englishDungeonName, localDungeonName } from "../src/services/dungeon-names.js";
import { plural } from "../src/services/card-plural.js";
import { drawable } from "../src/services/score-card.js";
import { weeklyRookieCard } from "../src/services/rookie-card.js";
import { dailyRecapCard, dailyRecapEmbed, type DailyRecap } from "../src/services/daily-recap.js";
import { niceAxis } from "../src/services/member-trend-card.js";
import { dungeonSeasonCard } from "../src/services/dungeon-leaderboard.js";
import { highlightText } from "../src/services/dungeon-records.js";

describe("dungeon names come from the instance id, in the page language", () => {
  it("every catalog dungeon has a French name or is on the explicit unverified list", () => {
    const missing = allEnglishDungeonNames().filter(name => !hasFrenchName(name) && !UNVERIFIED_FRENCH.some(u => name.startsWith(u)));
    expect(missing).toEqual([]);
  });
  it("names the dungeon in French whatever language the uploader's client used", () => {
    for (const uploaded of ["Deadmines", "The Deadmines", "Mortemines", "Les Mortemines"]) {
      expect(dungeonDisplayName({ dungeonName: uploaded, instanceId: 36 }, "fr")).toBe("Les Mortemines");
      expect(dungeonDisplayName({ dungeonName: uploaded, instanceId: 36 }, "en")).toBe("The Deadmines");
    }
    expect(localDungeonName({ instanceId: 2999, dungeonName: "Ruines de Lordaeron" }, "fr")).toBe("Ruines de Lordaeron");
    expect(localDungeonName({ instanceId: 2999, dungeonName: "Ruins of Lordaeron" }, "fr")).toBe("Ruines de Lordaeron");
    expect(localDungeonName({ instanceId: 129, dungeonName: "Razorfen Downs" }, "fr")).toBe("Souilles de Tranchebauge");
    expect(localDungeonName({ instanceId: 2970, dungeonName: "The Drowned City" }, "fr")).toBe("La Cité engloutie");
    expect(englishDungeonName({ instanceId: 36, dungeonName: "Mortemines" })).toBe("The Deadmines");
  });
  it("gives every Scarlet Monastery wing a French name", () => {
    expect(localDungeonName({ instanceId: 189, dungeonName: "x", routeKey: "189:cathedral" }, "fr")).toBe("Monastère Écarlate : Cathédrale");
    expect(frenchDungeon("Scarlet Monastery: Armory", "fr")).toBe("Monastère Écarlate : Armurerie");
    expect(dungeonDisplayName({ dungeonName: "Scarlet Monastery", instanceId: 189, encounters: [{ name: "High Inquisitor Whitemane", success: true }] }, "fr")).toBe("Monastère Écarlate : Cathédrale");
  });
  it("uses one name on the run card title, the personal-record line and the recap", () => {
    const run = { runRef: "QG-1", dungeonName: "Deadmines", instanceId: 36, difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 600, points: 0, completedBy: "final boss", guildRecord: false,
      previousGuildBest: null, personalRecords: [], players: ["A"], deaths: 0, unlinked: [], inGuildPlayers: ["A"], achievements: [], endedAt: 1794000000,
      playerDetails: [{ character: "A", class: "WARRIOR", deaths: 0, presentSec: 1, points: 0 }] } as never;
    expect(dungeonRunCard(run, "fr").title).toBe("Les Mortemines");
    expect(dungeonRunCard(run, "en").title).toBe("The Deadmines");
    expect(highlightText({ kind: "first", dungeonName: "Deadmines", instanceId: 36 }, "fr", true)).toContain("Les Mortemines");
  });
});

describe("plurals", () => {
  it("never prints (s) and counts French 0 and 1 as singular", () => {
    expect(plural("fr", 1, ["duel", "duels"], ["duel", "duels"])).toBe("1 duel");
    expect(plural("fr", 2, ["duel", "duels"], ["duel", "duels"])).toBe("2 duels");
    expect(plural("fr", 0, ["duel", "duels"], ["duel", "duels"])).toBe("0 duel");
    expect(plural("en", 0, ["duel", "duels"], ["duel", "duels"])).toBe("0 duels");
    expect(plural("en", 1, ["duel", "duels"], ["duel", "duels"])).toBe("1 duel");
  });
});

describe("daily recap card text", () => {
  const recap: DailyRecap = { day: "2026-11-15",
    race: { gained: 1, top: [{ name: "A", className: "Druid", gain: 1, level: 51 }], new60: [{ name: "B", className: "Warlock" }] },
    dungeons: { clears: 1, dungeons: 1, mostRuns: null, highlights: [{ kind: "first", dungeonName: "Razorfen Downs", instanceId: 129 }] },
    pvp: { duels: 1, topDueler: null, bgPlayed: 0, bgWon: 0 } };
  it("uses French class names and dungeon names, and singular nouns", () => {
    const text = JSON.stringify(dailyRecapCard(recap, "fr", "QG"));
    expect(text).toContain("Druide");
    expect(text).toContain("Démoniste");
    expect(text).not.toMatch(/Druid[^e]|Warlock/);
    expect(text).toContain("Souilles de Tranchebauge");
    expect(text).toContain("1 duel");
    expect(text).not.toContain("(s)");
    expect(JSON.stringify(dailyRecapCard(recap, "en", "QG"))).toContain("1 duel");
    expect(dailyRecapEmbed(recap, "fr").data.description).toContain("1 niveau gagné");
    expect(dailyRecapEmbed(recap, "fr").data.description).not.toContain("(s)");
  });
});

describe("names and axes", () => {
  it("puts a space before a bracket glued to a name, but keeps (s) marks", () => {
    expect(drawable("Anansi(Anansi Shadows)")).toBe("Anansi (Anansi Shadows)");
    expect(drawable("Anansi (Anansi)")).toBe("Anansi (Anansi)");
    expect(drawable("3 duel(s)")).toBe("3 duel(s)");
  });
  it("draws trend axes on round numbers", () => {
    for (const [lo, hi] of [[150, 163], [387, 387], [0, 7], [1203, 1790]] as const) {
      const axis = niceAxis(lo, hi);
      expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
      expect(axis.ticks.length).toBeLessThanOrEqual(8);
      for (const tick of axis.ticks) expect(Number.isInteger(tick)).toBe(true);
      expect(axis.lo).toBeLessThanOrEqual(lo);
      expect(axis.hi).toBeGreaterThanOrEqual(hi);
      expect(String(axis.step)).toMatch(/^[125]0*$/);
    }
  });
});

describe("rookie of the week card", () => {
  it("shows the name once, as the title, with short labels and no (s)", () => {
    const card = weeklyRookieCard("fr", { name: "El Pirata Qc (El Pirata)", points: 211, place: 4, ranked: 37, week: "2026-11-09" });
    expect(card.title).toBe("El Pirata Qc (El Pirata)");
    expect(JSON.stringify([card.subtitle, card.rows, card.footer, card.stats.map(s => s.label)])).not.toContain("El Pirata");
    expect(card.stats.map(s => s.label)).toEqual(["Points", "Rang"]);
    expect(card.stats.every(s => s.label.length <= 12)).toBe(true);
    expect(card.rows![0]!.name).toBe("Devant 33 membres");
  });
});

describe("dungeon season board", () => {
  it("labels the level bracket when one player has a row per bracket", () => {
    const card = dungeonSeasonCard([{ name: "Mister Haragot", points: 954, dungeons: 7, bracket: "30-44", key: "a" }, { name: "Mister Haragot", points: 923, dungeons: 6, bracket: "45-59", key: "b" }], "Season 1", "fr", true);
    expect(card.ladder!.boards[0]!.rows.map(r => r.sub)).toEqual(["Niv. 30-44", "Niv. 45-59"]);
  });
  it("adds no label on a single-bracket board", () => {
    const card = dungeonSeasonCard([{ name: "A", points: 9, dungeons: 1, bracket: "30-44" }, { name: "B", points: 8, dungeons: 1, bracket: "30-44" }], "Season 1", "en", true);
    expect(card.ladder!.boards[0]!.rows.every(r => r.sub === undefined)).toBe(true);
  });
});
