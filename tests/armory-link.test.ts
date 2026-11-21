import { describe, expect, it } from "vitest";
import { armoryCharacterUrl, armoryGuildUrl, armoryMarkdown, armoryUrl } from "../src/services/armory-link.js";

const BASE = "https://worldofwarcraft.blizzard.com/en-us/forever";

describe("armoryUrl", () => {
  it("links a full First Last name to the character page", () => {
    expect(armoryUrl({ name: "Lebowski Holyroller", gameEdition: "forever" })).toBe(`${BASE}/us/armory/character/lebowski-holyroller`);
    expect(armoryUrl({ name: "  Lebowski   Holyroller " })).toBe(`${BASE}/us/armory/character/lebowski-holyroller`);
  });
  it("completes an old first-name row from its display name", () => {
    expect(armoryUrl({ name: "Halidor", displayName: "Halidor Galemorne" })).toBe(`${BASE}/us/armory/character/halidor-galemorne`);
  });
  it("falls back to the armory search for one word, accents and apostrophes", () => {
    expect(armoryUrl({ name: "Halidor" })).toBe(`${BASE}/us/armory?q=Halidor`);
    expect(armoryUrl({ name: "Élodie Vaillant" })).toBe(`${BASE}/us/armory?q=%C3%89lodie+Vaillant`);
    expect(armoryUrl({ name: "Ka'zad Stonefist" })).toBe(`${BASE}/us/armory?q=Ka'zad+Stonefist`);
  });
  it("accepts the four regions and defaults to us", () => {
    expect(armoryUrl({ name: "Lebowski Holyroller" }, "EU")).toContain("/forever/eu/armory/");
    expect(armoryUrl({ name: "Lebowski Holyroller" }, "xx")).toContain("/forever/us/armory/");
  });
  it("gives other editions and empty names no link", () => {
    expect(armoryUrl({ name: "Lebowski Holyroller", gameEdition: "era" })).toBeNull();
    expect(armoryUrl({ name: "  " })).toBeNull();
    expect(armoryMarkdown({ name: "Lebowski Holyroller", gameEdition: "era" })).toBe("");
  });
  it("renders a masked Discord link", () => {
    expect(armoryMarkdown({ name: "Lebowski Holyroller" })).toBe(`[Armory](<${BASE}/us/armory/character/lebowski-holyroller>)`);
  });
});

describe("profile links by language", () => {
  it("lowercases, hyphenates spaces and percent-encodes accents, with the French locale on French pages", () => {
    expect(armoryCharacterUrl("Banished Zakarum")).toBe(`${BASE}/us/armory/character/banished-zakarum`);
    expect(armoryCharacterUrl("Banished Zakarum", "fr")).toBe("https://worldofwarcraft.blizzard.com/fr-fr/forever/us/armory/character/banished-zakarum");
    expect(armoryCharacterUrl("Éloïse Brûlé")).toBe(`${BASE}/us/armory/character/%C3%A9lo%C3%AFse-br%C3%BBl%C3%A9`);
    expect(armoryGuildUrl("Québec Gold")).toBe(`${BASE}/us/armory/guild/qu%C3%A9bec-gold`);
    expect(armoryGuildUrl("   ")).toBeNull();
  });
});
