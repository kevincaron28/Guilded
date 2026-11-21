import { provisionalSeasonRules } from "../../src/services/dungeon-bracket-season.js";

/**
 * A deterministic active all-level season with many characters and runs, in the shape the database mock returns:
 * linked players, bare first names next to full names for the same character, and guildmates nobody has linked yet.
 */
export function dungeonBoardFixture(chars = 40, nRuns = 220) {
  const { rules } = provisionalSeasonRules();
  const names = Array.from({ length: chars }, (_, i) => `Nom${i} Fam${i % 7}`);
  const routes = rules.routes.filter(r => r.dungeonKey && !r.dungeonKey.includes(":"));
  const runs: Record<string, unknown>[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const start = new Date("2026-11-10T00:00:00Z");
  for (let i = 0; i < nRuns; i++) {
    const route = routes[i % routes.length]!;
    const uniq = [...new Set(Array.from({ length: 5 }, () => Math.floor(rnd() * chars)))];
    const dur = 1200 + Math.floor(rnd() * 1800);
    const ended = new Date(start.getTime() + i * 360_000);
    // Every third run stores the bare first name for some players (an older addon), every seventh leaves a guildmate unlinked.
    const shown = (p: number, k: number) => (i + k) % 3 === 0 ? names[p]!.split(" ")[0]! : names[p]!;
    runs.push({
      runRef: `R${i}`, instanceId: route.instanceId, difficultyId: 0, durationSec: dur, completedBy: "final boss", dungeonName: "D",
      startedAt: new Date(ended.getTime() - dur * 1000), endedAt: ended, createdAt: ended,
      competitionData: { players: uniq.map((p, k) => ({ name: shown(p, k), level: 20 + (p % 4), minLevel: 20 + (p % 4) })), encounters: [] },
      players: uniq.map((p, k) => ({ character: shown(p, k), memberId: i % 7 === k ? null : `m${p}`, role: ["TANK", "HEALER", "DAMAGER"][k % 3],
        presentSec: dur, inGuild: true, member: i % 7 === k ? null : { displayName: `D${p}`, guildId: "g" } }))
    });
  }
  const season = { id: "s1", name: "S1", status: "ACTIVE", startsAt: new Date("2026-11-04T00:00:00Z"), endsAt: null, ratingRules: rules, finalStandings: null };
  const database = {
    dungeonSeason: { findFirst: async () => season, findMany: async () => [] },
    dungeonRun: { findMany: async () => runs },
    dungeonPointTransaction: { groupBy: async () => [] },
    member: { findMany: async () => names.map((_, i) => ({ id: `m${i}`, displayName: `D${i}` })) },
    character: { findMany: async () => names.map((n, i) => ({ memberId: `m${i}`, name: n.split(" ")[0], displayName: n })) },
    guildRosterEntry: { findMany: async () => names.map(n => ({ name: n, level: 21, wowId: null })) }
  };
  return { database, rules, runs, season };
}
