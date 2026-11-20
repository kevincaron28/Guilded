import { describe, expect, it } from "vitest";
import { frenchTypography as fr } from "../src/fr-typography.js";
import { notifications } from "../src/services/notify.js";

describe("notification lines", () => {
  it("formats EPGP changes with signs and skips the zero side", () => {
    expect(notifications.epgpChanged("Kev", 10, 0, "Raid")("en")).toBe("💰 Kev: +10 EP (Raid)");
    expect(notifications.epgpChanged("Kev", 0, 25, "Sword")("en")).toBe("💰 Kev: +25 GP (Sword)");
    expect(notifications.epgpChanged("Kev", -10, -5, "fix")("en")).toBe("💰 Kev: -10 EP, -5 GP (fix)");
  });

  it("summarizes an import in one line", () => {
    expect(notifications.importApplied(1, 0)("en")).toBe("📥 Addon import applied: 1 EPGP entry");
    expect(notifications.importApplied(12, 2)("en")).toBe("📥 Addon import applied: 12 EPGP entries, attendance for 2 raid(s)");
  });

  it("speaks French when the guild does", () => {
    expect(notifications.raidStarted("Cœur du Magma")("fr")).toBe(fr("⚔️ Raid commencé : **Cœur du Magma**"));
    expect(notifications.importApplied(3, 1)("fr")).toBe(fr("📥 Import de l'addon appliqué : 3 entrée(s) EPGP, présences pour 1 raid(s)"));
  });
});
