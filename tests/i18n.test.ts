import { describe, expect, it } from "vitest";
import { frenchTypography as fr } from "../src/fr-typography.js";
import { asLang, t } from "../src/i18n.js";
import { raidReportEmbed } from "../src/commands/raid-report.js";

describe("translations", () => {
  it("falls back to English and fills placeholders", () => {
    expect(asLang("fr")).toBe("fr");
    expect(asLang(null)).toBe("en");
    expect(t("fr", "reminder", { raid: "Onyxia", when: "dans 1 heure", mentions: "@Kev" }))
      .toBe(fr("⏰ **Onyxia** commence dans 1 heure. On vous attend : @Kev"));
    expect(t("en", "reply.waitlisted", { role: "Tank" })).toContain("Tank is full");
  });

  it("builds the raid report in French", () => {
    const embed = raidReportEmbed({
      title: "Onyxia", startedAt: null, endedAt: new Date(), durationMinutes: 75, raiders: 10, late: 1, absent: 0,
      bossesKilled: 1, bossesPlanned: 1, killedNames: ["Onyxia"], epAwarded: 150, epRecipients: 10, lootCount: 0, gpSpent: 0, topLoot: []
    }, "fr").toJSON();
    expect(embed.description).toBe("Raid terminé");
    expect(embed.fields?.map((field) => field.name)).toContain("🏆 Boss vaincus");
    expect(embed.fields?.find((field) => field.name === "👥 Raideurs")?.value).toBe("10 (1 en retard)");
  });
});
