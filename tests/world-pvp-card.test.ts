import { describe, expect, it } from "vitest";
import { worldPvpRecapCard } from "../src/services/world-pvp-card.js";
import { recapText, type WeekRecap } from "../src/services/world-pvp-extras.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

const s = (name: string, kills: number, defends: number, helped: number) => ({ memberId: name, name, kills, defends, helped });
const recap: WeekRecap = { killer: s("Aldric", 12, 1, 0), defender: s("Brenna", 3, 7, 2), helper: s("Cedric", 0, 0, 5), quickest: { character: "Dara", zone: "Duskwood", seconds: 75 }, calls: 14 };

describe("world PvP recap card", () => {
  it("carries every line of the text recap", async () => {
    const card = worldPvpRecapCard(recap, "en");
    expect(card.rows?.map(r => `${r.name}|${r.sub ?? ""}|${r.right}`)).toEqual([
      "Top killer: Aldric||12", "Defender: Brenna||7 defends", "Most calls answered: Cedric||5", "Quickest all clear: Dara|Duskwood|75 s"]);
    for (const line of ["Aldric", "Brenna", "Cedric", "Dara"]) expect(recapText(recap, "en")).toContain(line);
    expect(card.backdrop).toEqual({ kind: "board", key: "world-pvp-recap", fallbackKey: "world-pvp" });
    expect(cardAltText(card)).toContain("World PvP");
    // The alt text reads names and right-hand values, so the categories must be in the names.
    for (const label of ["Top killer: Aldric", "Most calls answered: Cedric", "Quickest all clear: Dara"]) expect(cardAltText(card)).toContain(label);
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("leaves out categories nobody won, and speaks French", () => {
    const card = worldPvpRecapCard({ ...recap, defender: null, helper: null, quickest: null }, "fr");
    expect(card.rows).toHaveLength(1);
    expect(card.title).toBe("JcJ en monde ouvert, semaine dernière");
    expect(card.footer).toContain("guildedwow.com");
  });
});
