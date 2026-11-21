import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertCardRules, CardCanvas } from "../src/services/card-kit.js";
import { renderBannerCard } from "../src/services/card-layouts-next.js";
import { renderNextCard } from "../src/services/card-next.js";
import { duelResultCard } from "../src/services/duel-card.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { battlegroundEndCard } from "../src/services/end-cards.js";
import { scoreCardPng } from "../src/services/score-card.js";

const art = readFileSync(new URL("../site/dungeon-art/wailing-caverns.jpg", import.meta.url));

describe("card title font (Pirata One)", () => {
  it("ships with its licence and draws French accents", async () => {
    expect(readFileSync(new URL("../site/fonts/pirata-one-OFL.txt", import.meta.url), "utf8")).toContain("SIL OPEN FONT LICENSE");
    const c = new CardCanvas();
    const t = await c.text("Monastère Écarlate : Armurerie çà", 10, 10, { size: 51, face: "title" });
    expect(t.w).toBeGreaterThan(200);
    const plain = await c.text("Monastere Ecarlate : Armurerie ca", 10, 10, { size: 51, face: "title" });
    expect(Math.abs(t.w - plain.w)).toBeLessThan(40); // accents did not fall back to another face
  });
});

describe("ladder banner (16 Nov 2026)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: `Aurélien Tremblay ${i}`, color: "#abd473", score: String(1000 - i), record: `${30 - i}-${i} · ${90 - i}%` }));
  it("shows long names whole, names its columns and counts the rows it does not draw", async () => {
    const { report } = await renderBannerCard({ type: "duel", emblem: "bars", label: "JCJ", title: "Duels de la guilde", hero: "214 duels", ladder: rows(14), heads: { score: "Cote", record: "V-D · % vict." }, moreWord: "autres", strip: "Mis à jour", art });
    assertCardRules(report);
    const texts = report.map((r) => r.text);
    expect(texts).toContain("Aurélien Tremblay 0"); // an 18-character name is not cut at 14
    expect(texts).toContain("V-D · % vict.");
    expect(texts).toContain("Cote");
    expect(texts).toContain("+2 autres");
  });
  it("drops the extra (bracket) before cutting the name", async () => {
    const { report } = await renderBannerCard({ type: "dungeon", emblem: "gate", label: "DONJONS", title: "Score", hero: "x", ladder: rows(3).map((r) => ({ ...r, extra: "Tranche 20-29 très longue" })), art });
    expect(report.map((r) => r.text)).toContain("Aurélien Tremblay 0");
  });
});

describe("duel and battleground results (16 Nov 2026)", () => {
  const duel = { reportKey: "k", winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: null, loserLevel: null, reason: "retreat", endedAt: new Date(1794000000000), points: 10, winnerScore: 50, winnerStreak: 0, winnerBest: 1 } as never;
  it("draws a retreat or unknown-level duel in the duel layout, never the generic one", async () => {
    const card = duelResultCard(duel, "fr", new Map(), emptyNameBook);
    expect(await renderNextCard(card)).not.toBeNull();
    const png = await scoreCardPng(card);
    expect(png).not.toBeNull();
  }, 60_000);
  it("lists the guild's players with class colours and says provisional result", async () => {
    const bg = { reportId: "r", mode: "10v10", mapId: 489, bracket: "60", endedAt: new Date(1794000000000), durationSeconds: 1210, outcome: "win", presence: "complete", status: "PROVISIONAL", corroborated: false,
      party: [{ name: "Aldric Stormvale", className: "Warrior" }, { name: "Brenna Ironwood", className: "Mage" }] } as never;
    for (const lang of ["en", "fr"] as const) {
      const card = battlegroundEndCard(bg, [], lang);
      expect(card.rows?.map((r) => r.name)).toEqual(["Aldric Stormvale", "Brenna Ironwood"]);
      expect(card.rows?.[0]?.color).toBe("#c79c6e");
      expect(card.badges?.[0]?.text).toBe(lang === "fr" ? "Résultat provisoire" : "Provisional result");
      expect(await renderNextCard(card)).not.toBeNull();
    }
  }, 60_000);
});
