import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildComposition } from "../src/services/guild-health.js";
import { buildRosterVisual, rosterVisualCard, rosterVisualSvg } from "../src/services/roster-visual.js";
import { scoreCardPng } from "../src/services/score-card.js";

const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ className: CLASSES[i % CLASSES.length]!, race: "Human", level: i % 7 === 0 ? null : 1 + ((i * 7) % 60) }));

describe("roster visual", () => {
  it("has the same class and level numbers as /report guild", () => {
    const characters = roster(150);
    const visual = buildRosterVisual(characters, [], 90);
    const health = buildComposition(characters, 0);
    expect(visual.classes.map((c) => [c.name, c.total])).toEqual(health.byClass);
    health.levels.forEach((band, index) => expect(visual.classes.reduce((sum, c) => sum + c.byBand[index]!, 0)).toBe(band.count));
    expect(visual.unknownLevel).toBe(characters.filter((c) => c.level === null).length);
  });
  it("builds the profession grid with gaps, crafters and top skill", () => {
    const visual = buildRosterVisual([], [{ profession: "Mining", skillLevel: 150, characterId: "a" }, { profession: "mining", skillLevel: 225, characterId: "b" }, { profession: "Mining", skillLevel: 10, characterId: "a" }], 2);
    expect(visual.professions.find((p) => p.name === "Mining")).toEqual({ name: "Mining", crafters: 2, maxSkill: 225 });
    expect(visual.professions.find((p) => p.name === "Alchemy")).toEqual({ name: "Alchemy", crafters: 0, maxSkill: 0 });
  });
  it.each([0, 1, 150])("renders a 1200x630 card for %i characters", async (n) => {
    const skills = n ? roster(n).map((_, i) => ({ profession: ["Mining", "Alchemy", "Tailoring"][i % 3]!, skillLevel: 50 + (i % 250), characterId: String(i) })) : [];
    const png = await scoreCardPng(rosterVisualCard(buildRosterVisual(roster(n), skills, Math.ceil(n / 2)), "fr", "Québec Gold"));
    expect(png).not.toBeNull();
    expect(await sharp(png!).metadata()).toMatchObject({ width: 1200, height: 630, format: "png" });
  });
  it("draws SVG charts in both languages, escaping text, for an empty and a full roster", () => {
    expect(rosterVisualSvg(buildRosterVisual([], [], 0), "en")).toContain("No characters");
    const html = rosterVisualSvg(buildRosterVisual(roster(150), [], 50), "fr");
    expect(html).toContain("Classes par tranche de niveau");
    expect(html).toContain("<svg");
    expect(html).not.toContain("<script");
  });
});
