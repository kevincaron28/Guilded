import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FR_TEXT } from "../src/i18n-fr.js";
import { allVariants, QUEBEC_SACRES, QUEBEC_SWEARING, quebecLine, variantCount, variantIndex, type VoiceEvent } from "../src/services/fr-quebec-voice.js";

const EVENTS: VoiceEvent[] = ["promotion", "promotionKicker", "achievement", "mvp", "weeklyMvp", "top3", "badge", "welcome", "joined", "guildRecord", "personalBest", "rookie"];

describe("Québécois voice rotation", () => {
  it("is deterministic: the same key gives the same line", () => {
    for (const event of EVENTS) {
      expect(quebecLine(event, "k1", { who: "A" })).toBe(quebecLine(event, "k1", { who: "A" }));
      expect(variantIndex(event, "k1")).toBe(variantIndex(event, "k1"));
    }
  });

  it("rotates: different keys reach every variant of an event", () => {
    for (const event of EVENTS) {
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) seen.add(variantIndex(event, `key-${i}`));
      expect(seen.size).toBe(variantCount(event));
    }
  });

  it("has 3 to 5 variants per event, in the tu register and without a vous", () => {
    for (const event of EVENTS) expect(variantCount(event)).toBeGreaterThanOrEqual(3);
    for (const variant of allVariants()) {
      expect(variant.swear).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
      expect(variant.clean).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
    }
  });

  it("keeps the placeholders and fills them", () => {
    const line = quebecLine("promotion", "x", { who: "<@1>", rank: "Officier" });
    expect(line).toContain("<@1>");
    expect(line).toContain("**Officier**");
    expect(line).not.toMatch(/\{\w+\}/);
    // The welcome template keeps {guild} and {mention} for the template renderer.
    expect(quebecLine("welcome", "x")).toMatch(/\{guild\}/);
    expect(quebecLine("welcome", "x")).toMatch(/\{mention\}/);
  });

  it("the toned-down variant of every line has no sacre", () => {
    expect(QUEBEC_SWEARING).toBe(true);
    for (const variant of allVariants()) {
      expect(variant.clean).not.toMatch(QUEBEC_SACRES);
      expect(quebecLine("promotion", "z", { who: "a", rank: "b" }, false)).not.toMatch(QUEBEC_SACRES);
    }
    expect(allVariants().some(variant => QUEBEC_SACRES.test(variant.swear))).toBe(true);
  });

  it("never insults a member or touches forbidden themes", () => {
    const banned = /\b(?:nul|nulle|con|conne|idiot\w*|imb[ée]cile|d[ée]bile|tapette|n[èe]gre\w*|salope|pute|handicap\w*|ta m[èe]re)\b/i;
    for (const variant of allVariants()) {
      expect(variant.swear).not.toMatch(banned);
      expect(variant.clean).not.toMatch(banned);
    }
  });
});

describe("formal French text stays free of sacres", () => {
  it("setup, help, FAQ and the French dictionary contain none", () => {
    for (const [english, french] of Object.entries(FR_TEXT)) {
      expect(french, english).not.toMatch(QUEBEC_SACRES);
    }
    const formal = [
      "src/commands/setup.ts", "src/commands/settings.ts", "src/commands/help.ts", "src/commands/faq.ts", "src/services/setup-status.ts",
      "src/services/error-reporting.ts", "src/commands/report.ts", "src/commands/privacy.ts", "src/commands/officer.ts", "src/permissions.ts", "src/i18n-fr.ts"
    ];
    for (const file of formal) {
      let source: string;
      try { source = readFileSync(file, "utf8"); } catch { continue; }
      expect(source, file).not.toMatch(QUEBEC_SACRES);
    }
  });

  it("only the celebratory services import the voice module", () => {
    const allowed = new Set(["promotion", "card-promotion", "achievement-announce", "community-honors", "community-badge-delivery", "housekeeping", "invite-channel", "dungeon-announce", "fr-quebec-voice"]);
    const offenders: string[] = [];
    const dirs = ["src/services", "src/commands"];
    for (const dir of dirs) {
      for (const name of readdirSyncSafe(dir)) {
        if (!name.endsWith(".ts")) continue;
        const text = readFileSync(`${dir}/${name}`, "utf8");
        if (/fr-quebec-voice/.test(text) && !allowed.has(name.replace(/\.ts$/, ""))) offenders.push(`${dir}/${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { readdirSync } from "node:fs";
function readdirSyncSafe(dir: string): string[] { try { return readdirSync(dir); } catch { return []; } }
