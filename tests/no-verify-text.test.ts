import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// November 2026 (owner decision): /guilded verify and verify codes are gone for members. A link made
// from a DM name, the invite channel or a companion is confirmed by sync only. Comments may still
// explain the history (the bot accepts already-issued codes for one release); text members read may not.
const FILES = [
  "src/i18n.ts", "src/i18n-fr.ts", "src/commands/help.ts", "src/commands/character.ts",
  "src/services/faq-extras.ts", "src/services/guild-health.ts", "src/services/roster-gaps.ts", "src/services/me-characters.ts",
  "src/services/setup-status.ts", "src/services/invite-prelink.ts", "src/services/guilded-reference.ts",
  "src/services/character-link-prompt.ts", "src/services/dungeon-board-diagnosis.ts", "src/services/dungeon-held-credit.ts",
  "src/services/character-verify.ts", "src/services/character-trust.ts",
  "mobile/src/i18n.ts", "mobile/src/me/MyCharacters.tsx", "mobile/src/me/PromotionCard.tsx", "companion-app/locales/fr.json",
  "addon/Guilded/Locale.lua", "addon/Guilded/Modules/Minimap.lua", "addon/Guilded/Core.lua",
  ...readdirSync("site/pages").filter((name) => /\.(md|json)$/.test(name)).map((name) => `site/pages/${name}`),
  "site/pages.json"
];

describe("no member-facing /guilded verify text", () => {
  for (const file of FILES) {
    it(file, () => {
      const lines = readFileSync(join(process.cwd(), file), "utf8").split(/\r?\n/);
      const offenders = lines.filter((line) => /guilded verify/i.test(line) && !/^\s*(\/\/|--|\*|\/\*)/.test(line));
      // Core.lua keeps the retired handler only, with its one-line "No longer needed" answer (code, not text).
      expect(offenders.map((line) => line.trim().slice(0, 100))).toEqual([]);
    });
  }
});
