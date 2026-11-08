import { describe, expect, it } from "vitest";
import { isOwnBoard } from "../src/services/board-identity.js";
import { withoutHiddenGames } from "../src/services/community-leaderboard.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { seasonBestRuns } from "../src/services/dungeon-best-runs.js";
import { dungeonSeasonCard, seasonHeader } from "../src/services/dungeon-leaderboard.js";
import { ratingEmbed } from "../src/services/dungeon-rating.js";
import { activityCard, activityEmbed, type ActivityData } from "../src/services/guild-activity.js";
import { seasonLabel } from "../src/services/season-label.js";

// Owner request, 8 November 2026: the board channels must be accurate and easy to read.

describe("boards are still found without the marker in their footer", () => {
  const titles = ["🏁 Race to 60", "🏁 Course au niveau 60"];
  it("recognises a new post by its title and an old post by its footer, only from this bot", () => {
    expect(isOwnBoard({ author: { id: "bot" }, embeds: [{ title: "🏁 Course au niveau 60", footer: { text: "/character race near…" } }] } as never, "bot", "Guilded race board", titles)).toBe(true);
    expect(isOwnBoard({ author: { id: "bot" }, embeds: [{ title: "x", footer: { text: "Guilded race board • g1 • old" } }] } as never, "bot", "Guilded race board", titles)).toBe(true);
    expect(isOwnBoard({ author: { id: "bot" }, embeds: [{ title: "Something else" }] } as never, "bot", "Guilded race board", titles)).toBe(false);
    expect(isOwnBoard({ author: { id: "member" }, embeds: [{ title: "🏁 Course au niveau 60" }] } as never, "bot", "Guilded race board", titles)).toBe(false);
  });
});

describe("full names on the best-runs board", () => {
  const run = { instanceId: 389, dungeonName: "Ragefire Chasm", difficultyId: 0, durationSec: 1621, endedAt: null };
  const db = (players: { character: string; memberId: string | null }[], extra: object = {}) => ({
    dungeonRun: { groupBy: async () => [{ instanceId: 389, difficultyId: 0, _min: { durationSec: 1621 } }], findFirst: async () => ({ ...run, players }) },
    character: { findMany: async ({ where }: { where: { memberId?: { in: string[] } } }) => where.memberId
      ? [{ memberId: "m-el", name: "El Pirata", displayName: null }, { memberId: "m-el", name: "Other Alt", displayName: null }]
      : [] },
    unclaimedCharacter: { findMany: async () => [] }, guildRosterEntry: { findMany: async () => [] }, ...extra
  });
  it("completes a linked player's first name from their own characters when the guild tables have no full name", async () => {
    const rows = await seasonBestRuns(db([{ character: "El", memberId: "m-el" }]) as never, "g1", "s1");
    expect(rows[0]!.players).toEqual(["El Pirata"]);
  });
  it("completes an unlinked first name from the public runs, looked up for that very name", async () => {
    let asked: string[] = [];
    const publicRunPlayer = { findMany: async ({ where }: { where: { character: { in: string[] } } }) => { asked = where.character.in; return [{ character: "Crashing", displayName: "Crashing Pally" }]; } };
    const rows = await seasonBestRuns(db([{ character: "Crashing", memberId: null }], { publicRunPlayer }) as never, "g1", "s1");
    expect(asked).toContain("Crashing");
    expect(rows[0]!.players).toEqual(["Crashing Pally"]);
  });
});

describe("French season names", () => {
  it("reads Saison on French boards and keeps the stored name otherwise", () => {
    expect(seasonLabel("Season 1", "fr")).toBe("Saison 1");
    expect(seasonLabel("Season 2 — November 2026", "fr")).toBe("Saison 2 — novembre 2026");
    expect(seasonLabel("Season 1", "en")).toBe("Season 1");
    expect(seasonLabel("Hiver des braves", "fr")).toBe("Hiver des braves");
  });
  it("uses it on the Exploration board, the season header, the dungeon card and the activity board", () => {
    const { rules } = provisionalSeasonRules();
    expect(ratingEmbed([], "Season 1", "fr", rules).toJSON().title).toBe("🏅 Exploration · Saison 1 · provisoire");
    expect(seasonHeader({ name: "Season 1", startsAt: new Date(0) }, "fr")).toContain("**Saison 1**");
    expect(dungeonSeasonCard([{ name: "Kev Caron", points: 10 }], "Season 1", "fr", true).ladder!.meta).toContain("Saison 1");
    const season: ActivityData = { view: "season", label: "Season 1", since: new Date(0), rows: [{ memberId: "a", name: "Kev Caron", dungeons: 10, duels: 0, battlegrounds: 0, total: 10 }] };
    expect(activityCard(season, "fr").subtitle).toContain("Saison 1");
  });
});

describe("activity board", () => {
  const row = (memberId: string, total: number) => ({ memberId, name: memberId, dungeons: total, duels: 0, battlegrounds: 0, total });
  const week: ActivityData = { view: "week", label: "Cette semaine", since: new Date(0), rows: [row("a", 250), row("b", 100)] };
  it("shows one field when the week and the season are the same, two when they differ", () => {
    const same = activityEmbed(week, { ...week, view: "season", label: "Season 1" }, "fr").toJSON();
    expect(same.fields).toHaveLength(1);
    expect(same.fields![0]!.name).toBe("Saison 1 · cette semaine aussi");
    const differ = activityEmbed(week, { ...week, view: "season", label: "Season 1", rows: [row("a", 400), row("b", 100)] }, "fr").toJSON();
    expect(differ.fields!.map(f => f.name)).toEqual(["Cette semaine", "Saison 1"]);
  });
});

describe("plain dungeon explainer", () => {
  it("leads with how to score and leaves the formula to /dungeon rules", () => {
    const { rules } = provisionalSeasonRules();
    for (const lang of ["fr", "en"] as const) {
      const text = ratingEmbed([], "Season 1", lang, rules).toJSON().description!;
      expect(text).not.toMatch(/Arrondi\(|Round\(/);
      expect(text).toContain("/dungeon rules");
    }
    const fr = ratingEmbed([], "Season 1", "fr", rules).toJSON().description!;
    // The provisional warning stays first; the plain sentence comes right after it.
    expect(fr.split("\n\n")[1]).toMatch(/^\*\*Pour marquer :\*\* termine le donjon le plus vite possible, tue le boss final/);
  });
});

describe("hidden games in pinned community text", () => {
  it("drops PoE 2 from the seasons sentence while PoE 2 tracking is off", () => {
    const old = "Les saisons Discord, WoW et PoE 2 restent séparées. Les points communautaires ne modifient pas l’EP/GP ni les points de donjons.";
    expect(withoutHiddenGames(old, false)).toBe("Les saisons Discord et WoW restent séparées. Les points communautaires ne modifient pas l’EP/GP ni les points de donjons.");
    expect(withoutHiddenGames(old, true)).toBe(old);
  });
});
