import { describe, expect, it } from "vitest";
import { dungeonCommand } from "../src/commands/dungeon.js";
import { dungeonAdminCommand } from "../src/commands/dungeon-admin.js";
import { dungeonShare } from "../src/services/community-ingame.js";
import { t } from "../src/i18n.js";

type Opt = { name: string; description: string; choices?: { name: string; value: string }[]; options?: Opt[] };
const sub = (command: { toJSON(): unknown }, name: string) => ((command.toJSON() as { options: Opt[] }).options.find(o => o.name === name))!;

describe("community points wording", () => {
  it("no longer offers the dungeon-only ledger as 'Community points' on the dungeon leaderboard", () => {
    const metric = sub(dungeonCommand, "leaderboard").options!.find(o => o.name === "metric")!;
    expect(metric.choices!.map(c => c.value)).toEqual(["rating"]);
    expect(JSON.stringify(sub(dungeonCommand, "leaderboard"))).not.toContain("participation");
    expect(metric.description).toContain("/community leaderboard");
  });

  it("describes the officer award as dungeon points counted in community points", () => {
    expect(sub(dungeonAdminCommand, "award").description).toBe("Adjust dungeon points (count in community points)");
  });

  it("converts raw dungeon points to their community share with the weekly bound", () => {
    expect(dungeonShare(120)).toBe(24);
    expect(dungeonShare(100000)).toBe(100);
    expect(dungeonShare(-30)).toBe(0);
  });

  it("calls the weekly hero and the player line community points, in both languages", () => {
    expect(t("en", "weekly.hero", { name: "A", points: 24 })).toContain("24 community point(s) from dungeons");
    expect(t("fr", "weekly.hero", { name: "A", points: 24 })).toContain("point(s) de communauté");
    expect(t("en", "dungeon.player.points")).toBe("Community points");
    expect(t("fr", "dungeon.player.points")).toBe("Points de communauté");
    expect(t("en", "dungeon.player.pointsValue", { week: 3, total: 40, season: 9 })).toBe("This week: 3 from dungeons · Season: 40 (9 from dungeons)");
  });
});
