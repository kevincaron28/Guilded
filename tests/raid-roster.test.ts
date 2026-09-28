import { describe, expect, it, vi } from "vitest";
import { nextRaidRoster } from "../src/services/raid-roster.js";
import { standingsToLua } from "../companion/standings.mjs";

const member = (names: string[]) => ({ characters: names.map((name) => ({ name })) });

describe("next raid roster for the addon", () => {
  const now = new Date("2026-10-01T18:00:00Z");

  it("lists signed-up players by main character and the maybes separately", async () => {
    const findFirst = vi.fn(async () => ({
      id: "r1", title: "Molten Core", scheduledAt: new Date("2026-10-01T23:00:00Z"), coreId: "c1", core: { name: "Tuesday" },
      signups: [
        { status: "SIGNED_UP", role: "TANK", member: member(["Amy"]) },
        { status: "MAYBE", role: "DPS", member: member(["Bob"]) },
        { status: "SIGNED_UP", role: "DPS", member: member([]) },          // no linked character: cannot be invited
        { status: "SIGNED_UP", role: "HEALER", member: member(["Cy", "CyAlt"]) }
      ]
    }));
    const result = await nextRaidRoster({ raid: { findFirst } } as never, "g", now);
    expect(result).toEqual({
      id: "r1", title: "Molten Core", scheduledAt: "2026-10-01T23:00:00.000Z", core: "Tuesday", coreId: "c1",
      players: [{ name: "Amy", role: "TANK" }, { name: "Cy", role: "HEALER" }], maybe: ["Bob"]
    });
    const where = (findFirst.mock.calls[0] as unknown as [{ where: { scheduledAt: { gte: Date; lte: Date } } }])[0].where;
    expect(where.scheduledAt.gte.getTime()).toBe(now.getTime() - 3 * 3_600_000);
    expect(where.scheduledAt.lte.getTime()).toBe(now.getTime() + 36 * 3_600_000);
  });

  it("is null when no raid is coming up", async () => {
    expect(await nextRaidRoster({ raid: { findFirst: async () => null } } as never, "g", now)).toBeNull();
  });

  it("the companion writes it into Standings.lua, and writes nil without one", () => {
    const base = { updatedAt: "t", baseGp: 0, standings: [], acceptedRunRefs: [], dungeonBoard: null };
    const lua = standingsToLua({ ...base, nextRaid: { id: "r1", title: 'MC "night"', scheduledAt: "2026-10-01T23:00:00.000Z", core: null, coreId: null, players: [{ name: "Amy", role: "TANK" }], maybe: ["Bob"] } });
    expect(lua).toContain('GuildedNextRaid = { id = "r1", title = "MC \\"night\\"", at = "2026-10-01T23:00:00.000Z", core = "", coreId = "", players = {');
    expect(lua).toContain('{ name = "Amy", role = "TANK" },');
    expect(lua).toContain('"Bob",');
    expect(standingsToLua({ ...base, nextRaid: null })).toContain("GuildedNextRaid = nil");
  });
});
