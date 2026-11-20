import { describe, expect, it } from "vitest";
import { frenchTypography } from "../src/fr-typography.js";
import { t, tx } from "../src/i18n.js";

const N = " ";

describe("French typography", () => {
  it("puts a non-breaking space before : ; ! ?", () => {
    expect(frenchTypography("Statut : prêt")).toBe(`Statut${N}: prêt`);
    expect(frenchTypography("Vous êtes prêt ? Oui !")).toBe(`Vous êtes prêt${N}? Oui${N}!`);
    expect(frenchTypography("un ; deux")).toBe(`un${N}; deux`);
  });

  it("adds the missing space when a word is glued to ? or !", () => {
    expect(frenchTypography("Bravo!")).toBe(`Bravo${N}!`);
    expect(frenchTypography("Prêt? Allons-y!")).toBe(`Prêt${N}? Allons-y${N}!`);
  });

  it("leaves URLs, times, shortcodes and query strings alone", () => {
    expect(frenchTypography("https://guildedwow.com/a?x=1")).toBe("https://guildedwow.com/a?x=1");
    expect(frenchTypography("à 10:05 demain")).toBe("à 10:05 demain");
    expect(frenchTypography("/raid roster")).toBe("/raid roster");
  });

  it("keeps « quotes » with their text", () => {
    expect(frenchTypography("Appuyez sur « Créer ceux qui manquent » : fini")).toBe(`Appuyez sur «${N}Créer ceux qui manquent${N}»${N}: fini`);
  });

  it("is idempotent and does not touch English", () => {
    const once = frenchTypography("Prêt ? Oui !");
    expect(frenchTypography(once)).toBe(once);
    expect(tx("en", "Ready? Yes!")).toBe("Ready? Yes!");
  });

  it("applies to French templates only, never to the values put into them", () => {
    expect(t("fr", "signup.openSpots")).toContain(`libres${N}:`);
    expect(t("en", "signup.openSpots")).toContain("spots: ");
    expect(tx("fr", "Preview sent{where}. Try the buttons!", { where: " :x" })).toBe(`Aperçu envoyé :x. Essayez les boutons${N}!`);
  });
});
