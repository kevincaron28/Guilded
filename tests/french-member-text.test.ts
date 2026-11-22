import { describe, expect, it } from "vitest";
import { FR_MEMBER_TEXT } from "../src/i18n-fr-member.js";
import { tx } from "../src/i18n.js";
import { LINK_NEXT_STEP, linkNextStep, pickOwnCharacter } from "../src/services/own-character.js";

const row = (name: string, isMain = false) => ({ name, realm: "Forever", isMain });

describe("member text in French (tu)", () => {
  it("answers the link errors in French for a French guild", () => {
    expect(() => pickOwnCharacter([], null, "fr")).toThrow(/Tu n'as encore aucun personnage lié/);
    expect(() => pickOwnCharacter([row("Sam"), row("Ray")], null, "fr")).toThrow(/plusieurs personnages/);
    expect(() => pickOwnCharacter([row("Sam")], "Ray", "fr")).toThrow(/n'est pas lié à ton profil/);
    expect(linkNextStep("fr")).toContain("Envoie");
  });

  it("keeps English as the default", () => {
    expect(linkNextStep()).toBe(LINK_NEXT_STEP);
    expect(() => pickOwnCharacter([], null)).toThrow(/You have no linked character yet/);
  });

  it("fills placeholders in the French wishlist and loot replies", () => {
    expect(tx("fr", "Wanted by {count}:", { count: 3 }).replace(/\s/g, " ")).toBe("Voulu par 3 :");
    expect(tx("fr", "Bid of **{amount} GP** placed.", { amount: 50 })).toBe("Mise de **50 GP** placée.");
    expect(tx("en", "Bid of **{amount} GP** placed.", { amount: 50 })).toBe("Bid of **50 GP** placed.");
  });

  it("keeps the placeholders of every entry and never uses vous", () => {
    for (const [english, french] of Object.entries(FR_MEMBER_TEXT)) {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
      expect(names(french), english).toBe(names(english));
      expect(french, english).not.toMatch(/\b(vous|votre|vos)\b/i);
    }
  });
});
