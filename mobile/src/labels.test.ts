import { describe, expect, it } from "vitest";
import { classLabel, shownEdition, specClassLabel } from "./i18n";

describe("classLabel", () => {
  it("reads the server's capitals and lower case as a class name, in the member's language", () => {
    expect(classLabel("PALADIN", "en")).toBe("Paladin");
    expect(classLabel("warlock", "fr")).toBe("Démoniste");
    expect(classLabel("Priest", "fr")).toBe("Prêtre");
    expect(classLabel("Death Knight", "en")).toBe("Death knight");
  });
  it("shows nothing for a missing class", () => {
    expect(classLabel(null, "en")).toBe("");
    expect(classLabel("", "fr")).toBe("");
  });
});

describe("shownEdition", () => {
  it("hides the only edition Guilded supports", () => {
    expect(shownEdition("forever")).toBeNull();
    expect(shownEdition("WoW Forever")).toBeNull();
    expect(shownEdition(null)).toBeNull();
  });
  it("keeps a real realm name", () => {
    expect(shownEdition("Silvermoon")).toBe("Silvermoon");
    expect(shownEdition("Forever Realm")).toBe("Forever Realm");
  });
});

describe("spec and class labels", () => {
  it("reads in each language's word order and passes an unknown spec through", () => {
    expect(specClassLabel("Restoration", "Shaman", "en")).toBe("Restoration Shaman");
    expect(specClassLabel("Restoration", "SHAMAN", "fr")).toBe("Chaman Restauration");
    expect(specClassLabel("Beast Mastery", "Hunter", "fr")).toBe("Chasseur Maîtrise des bêtes");
    expect(specClassLabel("Gladiator", "Warrior", "fr")).toBe("Guerrier Gladiator");
    expect(specClassLabel(null, "Mage", "fr")).toBe("Mage");
  });
});
