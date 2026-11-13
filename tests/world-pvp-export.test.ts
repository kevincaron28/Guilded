import { describe, expect, it } from "vitest";
import { exportWorldPvp } from "../companion/lua-export-content.mjs";

const week = { kills: 4, defends: 1, responded: 0, calls: 2, answered: 0 };

describe("companion export of world PvP deaths", () => {
  it("sends this week's death count, and nothing about where or who", () => {
    const out = exportWorldPvp({
      worldPvp: { weekKey: 2900, week: { ...week, deaths: 3 }, zones: { "Hillsbrad Foothills": 3 }, deathsRecent: [{ z: "Hillsbrad Foothills", at: 1_800_000_000 }] }
    }) as { worldPvp: Array<Record<string, unknown>> };
    expect(out.worldPvp).toHaveLength(1);
    expect(out.worldPvp[0]).toMatchObject({ weekKey: 2900, kills: 4, deaths: 3 });
    expect(JSON.stringify(out)).not.toContain("Hillsbrad");
  });

  it("sends a week with only deaths, and zero deaths for saved data from before deaths", () => {
    const only = exportWorldPvp({ worldPvp: { weekKey: 2900, week: { deaths: 2 } } }) as { worldPvp: Array<Record<string, unknown>> };
    expect(only.worldPvp[0]).toMatchObject({ kills: 0, deaths: 2 });
    const old = exportWorldPvp({ worldPvp: { weekKey: 2900, week } }) as { worldPvp: Array<Record<string, unknown>> };
    expect(old.worldPvp[0].deaths).toBe(0);
  });

  it("drops an invalid death count", () => {
    const out = exportWorldPvp({ worldPvp: { weekKey: 2900, week: { kills: 1, deaths: -5 } } }) as { worldPvp: Array<Record<string, unknown>> };
    expect(out.worldPvp[0].deaths).toBe(0);
  });
});
