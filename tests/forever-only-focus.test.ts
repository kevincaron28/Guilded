import { describe, expect, it } from "vitest";
import { ACTIVE_GAMES, ACTIVE_TRACKING, GAME_ON_HOLD_NOTE, isGameActive, poeTrackingEnabled, poeTrackingOn } from "../companion/active-games.mjs";
import { keepPage, stripPoe, withoutPoe } from "../site/focus.mjs";
import { visibleLines } from "../src/commands/help.js";
import { commands } from "../src/commands/index.js";
import { defaultFaqEntries, looksLikePoe2Question } from "../src/services/faq-extras.js";
import { offeredCommunityGames } from "../src/services/community-rules.js";
import { ACHIEVEMENTS, achievementById } from "../src/services/achievements-catalogue.js";
import worker from "../worker/index.mjs";

// The PoE2 switches in companion/active-games.mjs (hidden is not deleted, flipping brings it back). The other WoW
// editions are removed, not switched off (docs/plans/FOREVER_ONLY_REMOVAL.md).
describe("Forever-only focus switches", () => {
  it("ships with the PoE2 Discord community and PoE2 tracking off", () => {
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

  it("site: pages of other WoW editions are never built; PoE2 tracking lines are stripped and flip back", () => {
    const hub = { gameEdition: "retail" }, forever = { gameEdition: "forever" }, poePage = { requiresGame: "poe2" };
    expect(keepPage(hub)).toBe(false);
    expect(keepPage(forever)).toBe(true);
    expect(keepPage(poePage)).toBe(true);
    expect(keepPage(poePage, ["wow"])).toBe(false);
    const md = "a\n- **PoE2:** journal <!--poe-->\nb <!--poe:et PoE2-->.";
    expect(stripPoe(md, false)).toBe("a\nb .");
    expect(stripPoe(md, true)).toBe("a\n- **PoE2:** journal <!--poe-->\nb et PoE2.");
    expect(withoutPoe({ description: "x", descriptionNoPoe: "y" }, false).description).toBe("y");
    expect(withoutPoe({ description: "x", descriptionNoPoe: "y" }, true).description).toBe("x");
  });

  it("Worker: the removed editions' old addresses redirect permanently to WoW Forever", async () => {
    const env = { ASSETS: { fetch: async () => new Response("asset") } };
    for (const [from, to] of [["/retail/leaderboards/?x=1", "/forever/leaderboards/?x=1"], ["/tbc/", "/forever/"], ["/editions/retail/", "/editions/forever/"]]) {
      const response = await worker.fetch(new Request(`https://guilded.kcaron.top${from}`), env as never);
      expect(response.status, from).toBe(301);
      expect(response.headers.get("location"), from).toBe(to);
    }
  });
});
