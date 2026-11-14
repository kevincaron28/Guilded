import { describe, expect, it } from "vitest";
import { exportPvpEvents, exportWorldPvp, PVP_EVENTS_FEATURE, PVP_EVENTS_MAX } from "../companion/lua-export-content.mjs";
import { pruneAcknowledged } from "../companion/delta.mjs";

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
    expect(old.worldPvp[0]?.["deaths"]).toBe(0);
  });

  it("drops an invalid death count", () => {
    const out = exportWorldPvp({ worldPvp: { weekKey: 2900, week: { kills: 1, deaths: -5 } } }) as { worldPvp: Array<Record<string, unknown>> };
    expect(out.worldPvp[0]?.["deaths"]).toBe(0);
  });
});

describe("companion export of kill and death places", () => {
  const T = 1_800_000_000;
  it("sends { k, t, m, x, y } with no enemy name, approximate flag or zone text, x and y left out when unknown", () => {
    const rows = exportPvpEvents([
      { k: "kill", t: T, z: "Hillsbrad", m: 1424, x: 0.45678, y: 0.5, a: 1 },
      { k: "death", t: T + 5, m: 1424 },
      { k: "kill", t: T + 6, m: 1424, x: 1.5, y: 0.2 }
    ]);
    expect(rows).toEqual([{ k: "kill", t: T, m: 1424, x: 0.4568, y: 0.5 }, { k: "death", t: T + 5, m: 1424 }, { k: "kill", t: T + 6, m: 1424 }]);
    expect(JSON.stringify(rows)).not.toContain("Hillsbrad");
  });

  it("drops invalid rows and keeps only the newest ones", () => {
    expect(exportPvpEvents(null)).toEqual([]);
    expect(exportPvpEvents([{ k: "dance", t: T, m: 1 }, { k: "kill", t: 5, m: 1 }, { k: "kill", t: T }, { k: "kill", t: T, m: -2 }])).toEqual([]);
    const many = Array.from({ length: PVP_EVENTS_MAX + 20 }, (_, i) => ({ k: "kill", t: T + i, m: 7 }));
    const out = exportPvpEvents(many);
    expect(out).toHaveLength(PVP_EVENTS_MAX);
    expect(out[out.length - 1]?.t).toBe(T + PVP_EVENTS_MAX + 19);
  });

  it("puts the events in the export beside the weekly block", () => {
    const out = exportWorldPvp({ worldPvp: { weekKey: 2900, week: { kills: 1 }, events: [{ k: "kill", t: T, m: 1424, x: 0.1, y: 0.2 }] } }) as Record<string, unknown>;
    expect(out["pvpEvents"]).toEqual([{ k: "kill", t: T, m: 1424, x: 0.1, y: 0.2 }]);
    expect(exportWorldPvp({ worldPvp: { weekKey: 2900, week: { kills: 1 } } })).not.toHaveProperty("pvpEvents");
  });

  it("sends them only to a bot that announced pvp-events", () => {
    const full = { worldPvp: [{ weekKey: 1 }], pvpEvents: [{ k: "kill", t: T, m: 1 }] };
    expect(PVP_EVENTS_FEATURE).toBe("pvp-events");
    const old = pruneAcknowledged(full, null, new Set(["ledger-delta", "loot-delta"])).exported as Record<string, unknown>;
    expect(old).not.toHaveProperty("pvpEvents");
    expect(old["worldPvp"]).toEqual(full.worldPvp);
    expect(full).toHaveProperty("pvpEvents");
    const next = pruneAcknowledged(full, null, new Set(["pvp-events"])).exported as Record<string, unknown>;
    expect(next["pvpEvents"]).toEqual(full.pvpEvents);
  });
});
