import { describe, expect, it } from "vitest";
import { dungeonPosts, DUNGEON_TIMELINE_PREFIX } from "../src/services/dungeon-announce.js";
import { deathPointsOf, dungeonRunCard, dungeonTheme, finalBoss } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { scoreCardPng } from "../src/services/score-card.js";

const result = (overrides: Partial<DungeonImportResult>): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1300, points: 0,
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: ["Kev", "Bob"], deaths: 0, unlinked: [], achievements: [], ...overrides
});
const summary = (...results: DungeonImportResult[]) => ({ results, duplicates: 0, malformed: 0 });
const text = (run: DungeonImportResult, lang: "en" | "fr" = "en") => dungeonPosts(summary(run), lang)[0]!.embed.toJSON().description!;

describe("dungeonPosts", () => {
  it("sends one post, with its own card, per completed run", () => {
    const posts = dungeonPosts(summary(
      result({ runRef: "A", dungeonName: "Wailing Caverns" }), result({ runRef: "B", dungeonName: "Wailing Caverns" }),
      result({ runRef: "C", dungeonName: "Ragefire Chasm" }), result({ runRef: "D", state: "ABANDONED" }), result({ runRef: "E", valid: false })), "fr");
    expect(posts.map((post) => post.runRef)).toEqual(["A", "B", "C"]);
    expect(posts.map((post) => post.card.title)).toEqual(["Wailing Caverns", "Wailing Caverns", "Ragefire Chasm"]);
    for (const post of posts) expect(post.embed.toJSON().description!.length).toBeLessThan(1500);
  });
  it("keeps the embed short: no repeated speed-rating line, no per-player blocks", () => {
    const run = result({ ratingEnabled: true, ratingVersion: 5, points: 0, playerDetails: [
      { character: "Kev", deaths: 0, presentSec: 1300, points: 0, ratingTotal: 400, ratingGain: 0 }, { character: "Bob", deaths: 1, presentSec: 1300, points: 0 }] });
    const en = text(run), fr = text(run, "fr");
    for (const body of [en, fr]) {
      expect(body).not.toMatch(/calibrat/i);
      expect(body).not.toContain("Score de vitesse");
      expect(body).not.toContain("0 pts");
      expect(body).not.toContain("participation points");
    }
    expect(en.split("\n").length).toBeLessThanOrEqual(3);
  });
  it("shows the points line only above zero", () => {
    expect(text(result({ ratingEnabled: true, points: 75 }))).toContain("75 participation points");
    expect(text(result({ ratingEnabled: true, points: 75 }), "fr")).toContain("75 points de participation");
    expect(text(result({ points: 58 }))).toContain("58 total points awarded");
  });
  it("sums unranked members into ONE line with the distinct reasons", () => {
    const player = (character: string, unrankedReason: string) => ({ character, deaths: 0, presentSec: 1000, points: 0, unrankedReason });
    const run = result({ players: ["A B", "C D", "E F"], playerDetails: [player("A B", "Target not calibrated"), player("C D", "Target not calibrated"), player("E F", "Overlevel carry")] });
    expect(text(run).match(/Unranked/g)).toHaveLength(1);
    expect(text(run)).toContain("Unranked ×3: Target not calibrated · Overlevel carry");
    expect(text(run, "fr")).toContain("Non classé ×3: Cible non calibrée · Aide au-dessus du niveau maximal");
  });
  it("tags linked guildmates and never prints '(0 lié(s))' when members are tagged", () => {
    const run = result({ players: ["Kev", "Ann"], unlinked: ["Ann"], inGuildPlayers: ["Kev", "Ann"], mentions: { Kev: "1234", Ann: "5678" } });
    const fr = text(run, "fr");
    // The character name comes first, the member's tag after it: never the tag alone.
    expect(fr).toContain("**Kev** (<@1234>)");
    expect(fr).toContain("**Ann** (<@5678>)");
    expect(fr).not.toContain("lié");
    // Flagged but nobody linked: no confusing "(0 linked)" either.
    const none = result({ players: ["A", "B"], unlinked: ["A", "B"], inGuildPlayers: ["A", "B"] });
    expect(text(none)).toContain("2 guild members:");
    expect(text(none)).not.toContain("linked");
    // Partly linked keeps the useful note.
    const some = result({ players: ["Kev", "Ann", "Bo"], unlinked: ["Ann", "Bo"], inGuildPlayers: ["Kev", "Ann", "Bo"], mentions: { Kev: "1234" } });
    expect(text(some, "fr")).toContain("3 membres de la guilde (1 lié) :");
    const solo = result({ players: ["Kev"], inGuildPlayers: ["Kev"] });
    expect(text(solo)).toContain("1 guild member:");
    expect(text(solo, "fr")).toContain("1 membre de la guilde :");
  });
  it("localizes roles for outsiders (no raw HEALER/TANK) and uses full names", () => {
    const run = result({ players: ["Kev", "Pug One", "Pug Two"], unlinked: ["Pug One", "Pug Two"], inGuildPlayers: ["Kev"], fullNames: { "Pug One": "Pug One Healerson" },
      playerDetails: [{ character: "Kev", class: "MAGE", role: "DAMAGER", deaths: 0, presentSec: 1, points: 0 }, { character: "Pug One", class: "PRIEST", role: "HEALER", deaths: 0, presentSec: 1, points: 0 },
        { character: "Pug Two", class: "WARRIOR", role: "TANK", deaths: 0, presentSec: 1, points: 0 }] });
    const fr = text(run, "fr");
    expect(fr).toContain("Hors guilde (2)");
    expect(fr).toContain("Pug One Healerson (Prêtre, Soigneur)");
    expect(fr).toContain("(Guerrier, Tank)");
    expect(fr).not.toMatch(/HEALER|TANK/);
    expect(text(run)).toContain("(Priest, Healer)");
    const card = dungeonPosts(summary(run), "fr")[0]!.card.dungeon!;
    expect(card.party.map((member) => [member.name, member.guild, member.roleLabel])).toEqual([["Kev", true, "DPS"], ["Pug One Healerson", false, "Soigneur"], ["Pug Two", false, "Tank"]]);
  });
  it("posts nothing for abandoned runs, rejected runs or runs without guildmates", () => {
    expect(dungeonPosts(summary(result({ state: "ABANDONED" }), result({ valid: false, invalidReason: "too short" })), "en")).toEqual([]);
    expect(dungeonPosts(summary(result({ unlinked: ["Kev", "Bob"] })), "en")).toEqual([]);
    expect(dungeonPosts(summary(result({ players: ["A", "B"], unlinked: ["A", "B"], inGuildPlayers: [] })), "en")).toEqual([]);
  });
  it("puts the boss chronology behind a button, not in the post", () => {
    const run = result({ runId: "run123", startedAt: 1000, endedAt: 1600, encounters: [{ id: 1, name: "Boss", startedAt: 1500, at: 1600, success: true }] });
    const [post] = dungeonPosts(summary(run), "fr");
    expect(JSON.stringify(post!.embed.toJSON())).not.toContain("Chronologie");
    const button = post!.components[0]!.toJSON().components[0] as { custom_id: string; label: string };
    expect(button).toMatchObject({ custom_id: `${DUNGEON_TIMELINE_PREFIX}run123`, label: "Chronologie" });
    expect(dungeonPosts(summary(result({ startedAt: 1000, endedAt: 1600, encounters: run.encounters })), "en")[0]!.components).toEqual([]);
    expect(dungeonPosts(summary(result({})), "en")[0]!.components).toEqual([]);
  });
  it("lists the records a run set and marks test runs", () => {
    const run = result({ runRef: "SIM-1790000000-abcde", guildRecord: true, previousGuildBest: 1500, personalRecords: [{ character: "Kev", previous: 1500, now: 1300 }, { character: "Bob", previous: 1, now: 0 }], unlinked: ["Bob"] });
    const embed = dungeonPosts(summary(run), "fr")[0]!.embed.toJSON();
    expect(embed.title).toBe("✅ [TEST] Deadmines (Normal)");
    expect(embed.description).toContain("Nouveau record de guilde dans **[TEST] Deadmines (Normal)** : 25:00 → **21:40**");
    expect(embed.description).toContain("Record personnel dans [TEST] Deadmines (Normal) : Kev");
    expect(embed.description).not.toContain("Record personnel dans [TEST] Deadmines (Normal) : Kev, Bob");
  });
});

describe("dungeonRunCard", () => {
  const run = result({ dungeonName: "Wailing Caverns", durationSec: 1105, completedBy: "final boss", endedAt: 1791901866, players: ["Kev Mage", "Ann Heal", "Pug Tank"],
    unlinked: ["Pug Tank"], inGuildPlayers: ["Kev Mage", "Ann Heal"], deaths: 3, startedAt: 1791900000,
    encounters: [{ id: 1, name: "Lady Anacondra", success: true, at: 1791900400 }, { id: 2, name: "Mutanus the Devourer", success: true, at: 1791901800 }],
    playerDetails: [{ character: "Pug Tank", class: "WARRIOR", role: "TANK", deaths: 1, presentSec: 1, points: 0 },
      { character: "Kev Mage", class: "MAGE", role: "DAMAGER", deaths: 2, presentSec: 1, points: 0 }, { character: "Ann Heal", class: "PRIEST", role: "HEALER", deaths: 0, presentSec: 1, points: 0 }] });

  it("shows time, final boss, deaths and the whole party with guild first", () => {
    const card = dungeonRunCard(run, "fr");
    expect(finalBoss(run)).toBe("Mutanus the Devourer");
    expect(card.stats.map((stat) => [stat.label, stat.value])).toEqual([["Temps", "18:25"], ["Boss final", "Mutanus the Devourer"], ["Morts", "3"], ["Score de donjon", "—"]]);
    expect(card.dungeon!.party.map((member) => [member.name, member.guild])).toEqual([["Kev Mage", true], ["Ann Heal", true], ["Pug Tank", false]]);
    expect(card.dungeon!.party[0]).toMatchObject({ role: "DPS", color: "#69ccf0" });
    expect(card.dungeon!.deathPoints).toBeUndefined();
    expect(card.dungeon!.outsiderLabel).toBe("Hors guilde");
  });
  it("is plain data that survives being queued as JSON", () => {
    const card = dungeonRunCard(run, "en", { deathPoints: [{ x: 0.2, y: 0.5 }] });
    expect(JSON.parse(JSON.stringify(card))).toEqual(card);
  });
  it("gives each dungeon its own stable generated theme", () => {
    expect(dungeonTheme("Ragefire Chasm")).toMatchObject({ motif: "fire" });
    expect(dungeonTheme("Wailing Caverns")).toMatchObject({ motif: "cave" });
    expect(dungeonTheme("Some New Place")).toEqual(dungeonTheme("Some New Place"));
    expect(dungeonTheme("Some New Place").a).not.toEqual(dungeonTheme("Another Place").a);
  });
  it("renders a PNG with and without the death map", async () => {
    for (const card of [dungeonRunCard(run, "fr"), dungeonRunCard(run, "en", { deathPoints: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] }),
      dungeonRunCard(result({ dungeonName: "Ragefire Chasm", players: Array.from({ length: 10 }, (_, i) => `Player ${i}`), inGuildPlayers: ["Player 0"], unlinked: [] }), "en")]) {
      const png = await scoreCardPng(card);
      expect(png?.subarray(0, 4).toString("hex")).toBe("89504e47");
      expect(png!.length).toBeGreaterThan(5000);
    }
  }, 60_000);
});

describe("death positions on the card", () => {
  const base = result({ dungeonName: "Wailing Caverns" });
  it("draws the map with the most deaths, and none when the run recorded none", () => {
    expect(dungeonRunCard(base, "en").dungeon!.deathPoints).toBeUndefined();
    const run = { ...base, deathPoints: [{ x: 0.1, y: 0.2, map: 1 }, { x: 0.3, y: 0.4, map: 2 }, { x: 0.5, y: 0.6, map: 2 }] };
    expect(deathPointsOf(run)).toEqual([{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }]);
    expect(dungeonRunCard(run, "fr").dungeon!.deathPoints).toEqual([{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }]);
    expect(dungeonRunCard(run, "fr").dungeon!.deathMapLabel).toBe("Où le groupe est tombé");
  });
  it("renders a PNG with recorded positions", async () => {
    const png = await scoreCardPng(dungeonRunCard({ ...base, deathPoints: Array.from({ length: 12 }, (_, i) => ({ x: (i % 6) / 6 + 0.05, y: 0.2 + (i % 3) * 0.25, map: 9 })) }, "en"));
    expect(png?.subarray(0, 4).toString("hex")).toBe("89504e47");
  }, 60_000);
});
