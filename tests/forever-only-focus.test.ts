import { describe, expect, it } from "vitest";
import { ACTIVE_GAMES, ACTIVE_TRACKING, GAME_ON_HOLD_NOTE, isGameActive, poeTrackingEnabled, poeTrackingOn } from "../companion/active-games.mjs";
import { ACTIVE_EDITIONS } from "../companion/active-editions.mjs";
import { keepPage, stripPoe, withoutPoe } from "../site/focus.mjs";
import { editionsToBuild } from "../scripts/build-addon-editions.mjs";
import { visibleLines } from "../src/commands/help.js";
import { commands } from "../src/commands/index.js";
import { defaultFaqEntries, looksLikePoe2Question } from "../src/services/faq-extras.js";
import { offeredCommunityGames } from "../src/services/community-rules.js";
import { ACHIEVEMENTS, achievementById } from "../src/services/achievements-catalogue.js";
import worker from "../worker/index.mjs";

// The Forever-only focus: switches in companion/active-editions.mjs and companion/active-games.mjs.
// Hidden is not deleted, and flipping a switch brings every surface back.
describe("Forever-only focus switches", () => {
  it("ships with Forever, the PoE2 Discord community, and PoE2 tracking off", () => {
    expect([...ACTIVE_EDITIONS]).toEqual(["forever"]);
    expect([...ACTIVE_GAMES]).toEqual(["wow", "poe2"]);
    expect([...ACTIVE_TRACKING]).toEqual([]);
    expect(isGameActive("poe2")).toBe(true);
    expect(GAME_ON_HOLD_NOTE[0]).toMatch(/tracking/);
  });

  it("Discord: /poe is not registered, the PoE2 community stays, other editions are not offered", () => {
    const names = commands.map(command => command.name);
    expect(names).not.toContain("poe");
    expect(names).not.toContain("events");
    expect(offeredCommunityGames()).toContain("POE2");
  });

  it("help and the FAQ drop PoE2 tracking lines and answers", () => {
    const lines = ["`/raid progress`", "`/poe status` · `/poe pair`"];
    expect(visibleLines(lines)).toEqual(["`/raid progress`"]);
    expect(visibleLines(lines, true)).toEqual(lines);
    expect(looksLikePoe2Question("poe2 companion not uploading")).toBe(false);
    expect(defaultFaqEntries("en").some(entry => /Path of Exile 2 companion/.test(entry.answer))).toBe(false);
  });

  it("no PoE2 achievement exists while tracking is off, so none can unlock, announce or show", () => {
    expect(ACHIEVEMENTS.some(def => def.game === "poe2")).toBe(false);
    expect(achievementById("poe2-level-75")).toBeUndefined();
    expect(ACHIEVEMENTS.some(def => def.game === "wow")).toBe(true);
  });

  it("companion: PoE2 tracking needs both the switch and the member's setting", () => {
    expect(poeTrackingOn({ poeEnabled: true })).toBe(false);
    expect(poeTrackingOn({ poeEnabled: true }, true)).toBe(true);
    expect(poeTrackingOn({ poeEnabled: false }, true)).toBe(false);
    expect(poeTrackingEnabled(["poe2"])).toBe(true);
  });

  it("site: pages of held editions are not built, PoE2 tracking lines are stripped, both flip back", () => {
    const hub = { gameEdition: "retail" }, forever = { gameEdition: "forever" }, poePage = { requiresGame: "poe2" };
    expect(keepPage(hub)).toBe(false);
    expect(keepPage(forever)).toBe(true);
    expect(keepPage(hub, ["forever", "retail"])).toBe(true);
    expect(keepPage(poePage)).toBe(true);
    expect(keepPage(poePage, ACTIVE_EDITIONS, ["wow"])).toBe(false);
    const md = "a\n- **PoE2:** journal <!--poe-->\nb <!--poe:et PoE2-->.";
    expect(stripPoe(md, false)).toBe("a\nb .");
    expect(stripPoe(md, true)).toBe("a\n- **PoE2:** journal <!--poe-->\nb et PoE2.");
    expect(withoutPoe({ description: "x", descriptionNoPoe: "y" }, false).description).toBe("y");
    expect(withoutPoe({ description: "x", descriptionNoPoe: "y" }, true).description).toBe("x");
  });

  it("releases build only active editions unless told otherwise", () => {
    expect(editionsToBuild([])).toEqual(["forever"]);
    expect(editionsToBuild(["--all-editions"])).toHaveLength(5);
  });

  it("Worker: old held-edition addresses redirect to Forever", async () => {
    const env = { ASSETS: { fetch: async () => new Response("asset") } };
    for (const [from, to] of [["/retail/leaderboards/?x=1", "/forever/leaderboards/?x=1"], ["/tbc/", "/forever/"], ["/editions/retail/", "/editions/"]]) {
      const response = await worker.fetch(new Request(`https://guilded.kcaron.top${from}`), env as never);
      expect(response.status, from).toBe(302);
      expect(response.headers.get("location"), from).toBe(to);
    }
  });
});
