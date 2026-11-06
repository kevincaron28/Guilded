import { describe, expect, it } from "vitest";
import { dedupeRunPlayers } from "../src/services/dungeon-import.js";

describe("dedupeRunPlayers", () => {
  it("keeps one row per character when observers repeat a player or disagree on the realm", () => {
    const players = [
      { character: "Hulke", realm: "-", presentSec: 1600, deaths: null, inGuild: false },
      { character: "Hulke", realm: "Forever", presentSec: 1630, deaths: 0, class: "DRUID", inGuild: true },
      { character: "xaldin", realm: "-", presentSec: 1630, deaths: null, inGuild: true },
      { character: "Xaldin", realm: "-", presentSec: 1500, deaths: 1, inGuild: false },
      { character: "Mister", realm: "-", presentSec: 1630, deaths: 0, inGuild: true }
    ] as never[];
    const result = dedupeRunPlayers(players) as unknown as { character: string; deaths: number | null; inGuild: boolean; class?: string; presentSec: number }[];
    expect(result.map((p) => p.character)).toEqual(["Hulke", "xaldin", "Mister"]);
    expect(result[0]).toMatchObject({ presentSec: 1630, deaths: 0, class: "DRUID", inGuild: true });
    expect(result[1]).toMatchObject({ presentSec: 1630, deaths: 1, inGuild: true });
  });
});
