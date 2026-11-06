import { describe, expect, it } from "vitest";
import { displayCharacterName } from "../src/services/character-display.js";
import { calculateDungeonRating, competitionReason, dungeonRating, type RatingRun } from "../src/services/dungeon-rating.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { dungeonAnnouncement } from "../src/services/dungeon-announce.js";
import { withFullDisplayNames, type LeaderRun } from "../src/services/public-leaderboard.js";

// Credit people even without the addon; an unknown level drops one player, never the run; full names everywhere.
const rules = provisionalSeasonRules().rules;
const start = new Date("2026-11-10T20:00:00Z");
const band = rules.levelBands["389"]!;

type P = { character: string; memberId: string | null; presentSec: number; member: { displayName: string } | null; inGuild?: boolean };
const linked = (character: string): P => ({ character, memberId: `m-${character}`, presentSec: 1200, member: { displayName: character }, inGuild: true });
const guildmate = (character: string): P => ({ character, memberId: null, presentSec: 1200, member: null, inGuild: true });
const outsider = (character: string): P => ({ character, memberId: null, presentSec: 1200, member: null, inGuild: false });
function run(players: P[], levels: Record<string, number | null>, extra: Partial<RatingRun> = {}): RatingRun {
  return { instanceId: 389, difficultyId: band.difficultyId, durationSec: 1200, completedBy: "final boss", startedAt: start,
    endedAt: new Date(start.getTime() + 1_200_000), createdAt: start, runRef: "QG-1", dungeonName: "Ragefire Chasm",
    competitionData: { players: players.flatMap(p => levels[p.character] === null ? [] : [{ name: p.character, level: levels[p.character] ?? 16, minLevel: levels[p.character] ?? 16 }]), encounters: [] },
    players, ...extra };
}

describe("rating board credits guildmates without the addon", () => {
  it("rates an unlinked guildmate by character, never an outsider", () => {
    const rows = calculateDungeonRating([run([linked("Kev Caron"), guildmate("El Pirata"), outsider("Pug Stranger")], {})], rules);
    expect(rows.map(r => r.name).sort()).toEqual(["El Pirata", "Kev Caron"]);
    const el = rows.find(r => r.name === "El Pirata")!;
    expect(el).toMatchObject({ memberId: "", unlinked: true });
    expect(el.points).toBeGreaterThan(0);
    expect(rows.find(r => r.name === "Kev Caron")!.unlinked).toBeUndefined();
  });
  it("moves the row to the member once the same character is linked", () => {
    const after = calculateDungeonRating([run([linked("Kev Caron"), linked("El Pirata")], {})], rules);
    expect(after.find(r => r.name === "El Pirata")).toMatchObject({ memberId: "m-El Pirata" });
    expect(after.some(r => r.unlinked)).toBe(false);
  });
});

describe("party levels unknown", () => {
  it("leaves out only the player with no level, not the run", () => {
    const players = [linked("Kev Caron"), linked("Bob Smith")];
    const data = run(players, { "Bob Smith": null });
    expect(competitionReason(data, band, 3)).toBeUndefined();
    const rows = calculateDungeonRating([data], rules);
    expect(rows.map(r => r.name)).toEqual(["Kev Caron"]);
    expect(rows[0]!.points).toBeGreaterThan(0);
  });
  it("still fails a run where nobody's level is known", () => {
    expect(competitionReason(run([linked("Kev Caron")], { "Kev Caron": null }), band, 3)).toBe("Party levels unknown");
  });
  it("keeps the overlevel rule for the players whose level is known", () => {
    expect(competitionReason(run([linked("Kev Caron"), linked("Big Carry")], { "Big Carry": band.max + 8 }), band, 3)).toBe("Overlevel carry");
  });
  it("fills a missing level from the guild roster while it is still inside the route's band", () => {
    const players = [linked("Kev Caron"), linked("Bob Smith")];
    const filled = calculateDungeonRating([run(players, { "Bob Smith": null }, { rosterLevels: { "bob smith": band.min + 1 } })], rules);
    expect(filled.map(r => r.name).sort()).toEqual(["Bob Smith", "Kev Caron"]);
    // A roster level read later that is now above the band cannot qualify them.
    const tooHigh = calculateDungeonRating([run(players, { "Bob Smith": null }, { rosterLevels: { "bob smith": band.max + 20 } })], rules);
    expect(tooHigh.map(r => r.name)).toEqual(["Kev Caron"]);
  });
});

describe("full character names", () => {
  it("shows El as El Pirata from the first tier that knows the full name", () => {
    expect(displayCharacterName("El", ["El Pirata"])).toBe("El Pirata");
    expect(displayCharacterName("El", [null, "Other"], ["El Pirata"])).toBe("El Pirata");
    expect(displayCharacterName("el", ["El Pirata"])).toBe("El Pirata");
  });
  it("keeps the stored name when nothing better is known or the first name is ambiguous", () => {
    expect(displayCharacterName("El", [])).toBe("El");
    expect(displayCharacterName("El", ["El Pirata", "El Bandido"])).toBe("El");
    expect(displayCharacterName("El Pirata", ["El Bandido"])).toBe("El Pirata");
  });
  it("names the rated row by its full name on the guild board", async () => {
    const stored = run([linked("El")], {});
    const database = {
      dungeonRun: { findMany: async () => [{ ...stored, players: stored.players.map(p => ({ ...p, member: { displayName: "El", guildId: "g1" } })) }] },
      character: { findMany: async () => [{ name: "El", displayName: "El Pirata" }] },
      guildRosterEntry: { findMany: async () => [] }
    };
    const rows = await dungeonRating(database as never, "g1", { id: "s1", startsAt: new Date("2026-11-04T23:00:00Z"), status: "ACTIVE", ratingRules: rules });
    expect(rows.map(r => r.name)).toEqual(["El Pirata"]);
    expect(rows[0]!.character).toBe("El Pirata");
  });
  it("shows the full name in the run post", () => {
    const summary = { results: [{ valid: true, state: "COMPLETED", durationSec: 1200, runRef: "QG-1", dungeonName: "Ragefire Chasm", difficultyId: 0, players: ["El"], unlinked: [], inGuildPlayers: ["El"],
      fullNames: { El: "El Pirata" }, playerDetails: [{ character: "El", points: 100, deaths: 0 }], personalRecords: [], achievements: [], mentions: {} }] } as never;
    const text = dungeonAnnouncement(summary, "en")?.data.description ?? "";
    expect(text).toContain("**El Pirata**");
    expect(text).not.toContain("**El**");
  });
  it("shows the full name on public pages when the same runs know it", () => {
    const player = (character: string, displayName: string | null) => ({ character, displayName, realm: "", className: null, role: null, level: 16, minLevel: 16 });
    const runs = [{ players: [player("El", null)] }, { players: [player("El Pirata", "El Pirata")] }] as unknown as LeaderRun[];
    const [bare] = withFullDisplayNames(runs);
    expect(bare!.players[0]).toMatchObject({ character: "El", displayName: "El Pirata" });
  });
});
