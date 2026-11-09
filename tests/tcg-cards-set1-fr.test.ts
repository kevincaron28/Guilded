import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_BY_ID } from "../src/services/tcg-cards-set1.js";
import { CARDS_SET1_FR, KEYWORDS_FR } from "../src/services/tcg-cards-set1-fr.js";

const KEYWORD_EN: Record<string, keyof typeof KEYWORDS_FR> = { Guard: "guard", Swift: "swift", Shield: "shield", Shadow: "shadow", Venom: "venom", Drain: "drain", "Twin Strike": "twin" };
const numbers = (text: string) => (text.match(/\d+/g) ?? []).join(",");

describe("Guilded Clash set 1 French", () => {
  it("has a French entry for every card and token, and none for unknown ids", () => {
    for (const id of CARD_BY_ID.keys()) expect(CARDS_SET1_FR[id], `${id} needs a French entry`).toBeDefined();
    for (const id of Object.keys(CARDS_SET1_FR)) expect(CARD_BY_ID.has(id), `${id} is not a card`).toBe(true);
  });

  it("fills a name for every card, and text and flavour wherever English has them", () => {
    for (const [id, card] of CARD_BY_ID) {
      const fr = CARDS_SET1_FR[id]!;
      expect(fr.name.trim(), `${id} name`).not.toBe("");
      expect(fr.text === "", `${id} text`).toBe(card.text === "");
      expect(fr.flavour === "", `${id} flavour`).toBe(card.flavour === "");
    }
  });

  it("keeps every number, and the keyword list that opens the rules text, in line with English", () => {
    for (const [id, card] of CARD_BY_ID) {
      const fr = CARDS_SET1_FR[id]!;
      expect(numbers(fr.text), `${id} ${card.name}: numbers`).toBe(numbers(card.text));
      // The phone strips the keyword list (shown on its own line) from the rules box: the French must start with the same words.
      const label = (card.kw ?? []).map((k) => KEYWORDS_FR[k]).join(", ");
      if (label) expect(fr.text.startsWith(label), `${id} ${card.name} should start with "${label}"`).toBe(true);
    }
    expect(Object.keys(KEYWORD_EN).length).toBe(Object.keys(KEYWORDS_FR).length);
  });

  it("keeps flavour lines short in both languages", () => {
    for (const [id, card] of CARD_BY_ID) {
      expect(card.flavour.length, `${id} English flavour`).toBeLessThanOrEqual(60);
      expect(CARDS_SET1_FR[id]!.flavour.length, `${id} French flavour`).toBeLessThanOrEqual(60);
    }
  });

  it("matches the keyword words the phone draws and its generated file", () => {
    const frame = readFileSync(new URL("../mobile/src/clash/CardFrame.tsx", import.meta.url), "utf8");
    for (const word of Object.values(KEYWORDS_FR)) expect(frame, word).toContain(`"${word}"`);
    const generated = readFileSync(new URL("../mobile/src/clash/set1-fr.ts", import.meta.url), "utf8");
    for (const [id, fr] of Object.entries(CARDS_SET1_FR)) expect(generated, `${id} in set1-fr.ts (run mobile/scripts/gen-clash-cards.ts)`).toContain(`${JSON.stringify(id)}: ${JSON.stringify(fr)}`);
  });
});
