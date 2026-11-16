import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, ACTIVE_ACHIEVEMENTS, achievementById, isHiddenSecret, maskedText, secretCountLabel, visibleText } from "../src/services/achievements-catalogue.js";
import { emptyFacts, evaluateAchievements, secretsOf } from "../src/services/achievements.js";
import { albumCards } from "../src/services/companion-album.js";
import { achievementUnlockedCard, achievementsCard } from "../src/services/end-cards.js";
import { milestoneSchema } from "../src/services/duels.js";
import { CARDS } from "../src/services/tcg-catalogue.js";

// Secret achievements: hidden until earned, normal (and tagged "Secret") afterwards. First one: killed by the Son of Arugal.
const ID = "secret-01";
const def = achievementById(ID)!;
const NOW = new Date("2026-11-16T12:00:00Z");

describe("secret achievements", () => {
  it("has a secret row with English and French text and a hint", () => {
    expect(def.secret).toBe(true);
    expect(def.secretRef).toBe("killed-arugal");
    expect(def.en.name).toBe("Silverpine Welcome Committee");
    expect(def.fr.name).toBe("Comité d'accueil des Pins-Argentés");
    expect(def.en.description).toContain("Son of Arugal");
    expect(def.fr.description).toContain("Fils d'Arugal");
  });

  it("is earned only from the addon's secret milestone", () => {
    const none = evaluateAchievements(emptyFacts(), NOW).find(row => row.def.id === ID)!;
    expect(none.earned).toBe(false);
    const at = new Date("2026-11-10T00:00:00Z");
    const facts = { ...emptyFacts(), secrets: secretsOf([{ ref: "secret:killed-arugal", reachedAt: new Date("2026-11-12T00:00:00Z") }, { ref: "secret:killed-arugal", reachedAt: at }, { ref: "secret:nonsense!", reachedAt: at }]) };
    const got = evaluateAchievements(facts, NOW).find(row => row.def.id === ID)!;
    expect(got.earned).toBe(true);
    expect(got.earnedAt).toEqual(at);
  });

  it("accepts the addon's secret milestone upload", () => {
    expect(milestoneSchema.safeParse({ character: "Kev", realm: "R", kind: "secret", ref: "secret:killed-arugal", value: 1, at: 1800000000 }).success).toBe(true);
  });

  it("masks the text while unearned and reveals it once earned", () => {
    expect(isHiddenSecret(def, false)).toBe(true);
    expect(isHiddenSecret(def, true)).toBe(false);
    expect(maskedText(def, "en")).toEqual({ name: "???", description: "Some forests bite back." });
    expect(maskedText(def, "fr").name).toBe("???");
    expect(visibleText(def, "en", false).name).toBe("???");
    expect(visibleText(def, "en", true).name).toBe("Silverpine Welcome Committee");
    expect(secretCountLabel(0)).toBe("");
    expect(secretCountLabel(1)).toBe("+1 secret");
    expect(secretCountLabel(2)).toBe("+2 secrets");
  });

  it("album: a mystery card before, the real card with a Secret tag after, and totals leave hidden secrets out", () => {
    const before = albumCards(new Map(), "en");
    const hidden = before.find(card => card.id === ID)!;
    expect(hidden).toMatchObject({ name: "???", tierLabel: "Secret", emblem: null, secret: true, earnedAt: null });
    expect(JSON.stringify(hidden)).not.toMatch(/silverpine|arugal|worgen/i);
    // The whole unearned album (ids, sets, emblems, everything) never mentions the secret.
    expect(JSON.stringify(before.filter(card => card.secret))).not.toMatch(/silverpine|arugal|worgen/i);
    expect(ID).toMatch(/^secret-\d+$/);
    const after = albumCards(new Map([[ID, new Date("2026-11-10T00:00:00Z")]]), "fr").find(card => card.id === ID)!;
    expect(after).toMatchObject({ name: "Comité d'accueil des Pins-Argentés", secret: true, earnedAt: "2026-11-10T00:00:00.000Z" });
    expect(after.tierLabel).toContain("Secret");
  });

  it("card: unearned secrets are not listed, only counted as +N secret", () => {
    const items = ACTIVE_ACHIEVEMENTS.map(row => ({ id: row.id, earnedAt: null, value: 0 }));
    const card = achievementsCard("Kev", items, "en");
    expect(JSON.stringify(card)).not.toMatch(/silverpine|arugal|worgen|secret-0/i);
    expect(card.stats[0]!.value).toMatch(/ \+1 secret$/);
    const earned = achievementsCard("Kev", items.map(item => item.id === ID ? { ...item, earnedAt: NOW } : item), "en");
    expect(JSON.stringify(earned)).toContain("Silverpine Welcome Committee");
    expect(earned.stats[0]!.value).not.toContain("secret");
  });

  it("unlock card: a special 'Secret achievement unlocked!' moment, in both languages", () => {
    expect(achievementUnlockedCard("Kev", [ID], 5, "en").eyebrow).toContain("Secret achievement unlocked!");
    expect(achievementUnlockedCard("Kev", [ID], 5, "fr").eyebrow).toContain("Succès secret débloqué !");
    expect(achievementUnlockedCard("Kev", ["dungeon-runs-1"], 5, "en").eyebrow).not.toContain("Secret");
  });

  it("never becomes a Guilded Clash card (its name would leak)", () => {
    expect(CARDS.some(card => card.achievementId === ID)).toBe(false);
    expect(ACHIEVEMENTS.some(row => row.id === ID)).toBe(true);
  });
});
