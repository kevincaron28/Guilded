import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { scoreCardPng } from "../src/services/score-card.js";

type Details = NonNullable<DungeonImportResult["playerDetails"]>;
const base = (playerDetails: Details, extra: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Ragefire Chasm", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1105, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: playerDetails.map((d) => d.character), deaths: 0, unlinked: [],
  inGuildPlayers: playerDetails.map((d) => d.character), achievements: [], endedAt: 1794000000, playerDetails, ...extra
});
const d = (character: string, extra: Partial<Details[number]> = {}): Details[number] => ({ character, class: "WARRIOR", deaths: 0, presentSec: 1100, points: 0, ...extra });
const stat = (run: DungeonImportResult, lang: "en" | "fr") => dungeonRunCard(run, lang).stats[3]!;

describe("the run card's dungeon score", () => {
  it("shows what a rated run added with the best season score under it (EN/FR)", () => {
    const run = base([d("A", { ratingTotal: 142.4, ratingGain: 18 }), d("B", { ratingTotal: 120, ratingGain: 12 }), d("C", { ratingTotal: 90.2, ratingGain: 0 })], { ratingEnabled: true });
    expect(stat(run, "en")).toMatchObject({ label: "Dungeon score", value: "+18", note: "Best season score 142" });
    expect(stat(run, "fr")).toMatchObject({ label: "Score de donjon", value: "+18", note: "Meilleur score saison 142" });
  });
  it("counts a first run's whole score as the gain", () => {
    const run = base([d("A", { ratingTotal: 96, ratingGain: 96 })], { ratingEnabled: true });
    expect(stat(run, "en")).toMatchObject({ value: "+96", note: "Best season score 96" });
  });
  it("says so when a rated run improved nobody, never +0", () => {
    const run = base([d("A", { ratingTotal: 142, ratingGain: 0 })], { ratingEnabled: true });
    expect(stat(run, "en")).toMatchObject({ value: "—", note: "Already counted · best 142" });
    expect(stat(run, "fr").note).toBe("Déjà comptée · meilleur 142");
  });
  it("gives a short reason for an unrated run, never 0 or NaN", () => {
    const sim = base([d("A", { unrankedReason: "Simulation run" }), d("B", { unrankedReason: "Simulation run" })], { ratingEnabled: true });
    expect(stat(sim, "en")).toMatchObject({ value: "—", note: "Simulation run" });
    expect(stat(sim, "fr").note).toBe("Simulation");
    const small = base([d("A", { unrankedReason: "Target not calibrated", ratingTotal: Number.NaN, ratingGain: Number.NaN })]);
    expect(stat(small, "fr").note).toBe("Cible non calibrée");
    expect(stat(base([d("A")]), "en")).toMatchObject({ value: "—", note: "Not rated" });
    expect(stat(base([d("A")]), "fr").note).toBe("Non classée");
    for (const run of [sim, small]) expect(JSON.stringify(dungeonRunCard(run, "en").stats)).not.toMatch(/NaN|\+0\b/);
  });
  it("falls back to participation points in a season without ratings", () => {
    expect(stat(base([d("A", { points: 50 })]), "en")).toMatchObject({ label: "Points earned", value: "+50" });
  });
  it("renders a rated, an unrated and a first-run card to PNG, with the score area drawn", async () => {
    const cards = [base([d("A", { ratingTotal: 142, ratingGain: 18 })], { ratingEnabled: true }), base([d("A", { unrankedReason: "Simulation run" })]), base([d("A", { ratingTotal: 96, ratingGain: 96 })], { ratingEnabled: true })];
    const pngs: (Buffer | null)[] = [];
    for (const c of cards) pngs.push(await scoreCardPng(dungeonRunCard(c, "fr")));
    const lit = async (png: Buffer) => {
      const { data } = await sharp(png).extract({ left: 380, top: 215, width: 170, height: 160 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let bright = 0; for (let i = 0; i < data.length; i += 3) if (data[i]! + data[i + 1]! + data[i + 2]! > 450) bright++;
      return bright;
    };
    for (const png of pngs) { expect(png).toBeInstanceOf(Buffer); expect(await lit(png!)).toBeGreaterThan(50); }
  });
});
