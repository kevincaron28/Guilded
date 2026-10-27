import { describe, expect, it } from "vitest";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { summarize } from "../src/services/public-runs.js";
import { createLeaderboardPages, leaderRun, rankCharacters } from "../src/services/public-leaderboard.js";
import { characterScores, publicRules, rateRun, snapshotRules } from "../src/services/public-score.js";
import { roleScores } from "../src/services/public-guidance.js";
import { publicAddonBoard } from "../src/services/public-addon-board.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

describe("experimental role-policy parity", () => {
  it.each(["mixed", "unknown", "locked", "low-presence"] as const)("keeps %s evidence consistent across website and standalone views", async kind => {
    const row = leaderRun({ ...summarize(dungeonRoleFixture(false, "DAMAGER", { nativeApi: true }).run), id: "role-policy", confirmations: 1 } as never);
    const began = row.evidence!.startedAt!;
    const from = new Date(began.getTime() - 60_000), to = new Date(row.endedAt.getTime() + 86_400_000);
    const rules = { ...publicRules(), evidencePolicy: "current-v2" as const,
      seasonWindow: { from: from.toISOString(), to: to.toISOString() },
      routes: publicRules().routes.map(r => ({ ...r, verification: { ...r.verification, fullRoute: true as const } })) };
    // Real capture adapter with mocked game APIs; preserve its honest unknown freshness.
    row.evidence = { ...row.evidence!, receivedAt: row.endedAt };
    const player = row.players[0]!;
    player.role = "TANK"; // End-role disagrees with the locked role on purpose.
    player.integrity = { knownSec: kind === "low-presence" ? 0 : row.durationSec, unknownSec: kind === "low-presence" ? row.durationSec : 0,
      knownIntervals: kind === "low-presence" ? [] : [[began.getTime()/1000,row.endedAt.getTime()/1000]],
      ...(kind === "unknown" ? {} : { lockedRole: "DPS" }), mixedRole: kind === "mixed" };
    const periods = [{ id: "s1", label: "Season 1", labelFr: "Saison 1", from, to, rules }];
    const teamPoints = rateRun(row, rules).score!.points;
    expect(teamPoints).toBeGreaterThan(0);
    const overall = characterScores([row], rules)[0]?.points ?? 0;
    expect(overall).toBe(kind === "low-presence" ? 0 : teamPoints);
    const expected = kind === "locked" ? overall : 0;
    const filters = { className: null, role: "DAMAGER", confirmed: false };
    expect(rankCharacters([row], filters, 100, rules)).toHaveLength(kind === "locked" ? 1 : 0);
    expect(rankCharacters([row], { ...filters, role: null }, 100, rules)).toHaveLength(kind === "low-presence" ? 0 : 1);
    expect(rankCharacters([row], { ...filters, role: "TANK" }, 100, rules)).toEqual([]);
    expect(roleScores([row], rules, player).roles.find(r => r.role === "DPS")!.rows[0]?.points ?? 0).toBe(expected);
    const profile = publicAddonBoard([row], player, periods, row.endedAt)!.profiles.find(p => p.bracket === "15-29")!;
    expect(profile.points).toBe(overall);
    expect(profile.roles.find(r => r.role === "DAMAGER")!.points).toBe(expected);

    const pages = createLeaderboardPages({ personal: null, now: () => row.endedAt,
      calendar: async () => [{ number: 1, start: from, end: to, name: "Season 1", rules: { ...snapshotRules(publicRules(), from), rules } }],
      store: { runs: async () => [row], characterRuns: async () => [row], guilds: async () => [], guildRuns: async () => [], guildRoster: async () => [] } });
    const app = createWebApp({ store: memoryWebStore().store,
      auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) },
      allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => row.endedAt });
    for (const lang of ["en", "fr"]) {
      const response = await app.respond({ method: "GET", path: "/leaderboards/", query: new URLSearchParams({ role: "DAMAGER", lang }), headers: {} });
      expect(response!.status).toBe(200);
      expect(response!.body.includes('class="num score">' + teamPoints + '</td>')).toBe(kind === "locked");
    }
    // Existing current-v1 archives still use their original reported role.
    const legacyRules = { ...rules, evidencePolicy: "current-v1" as const };
    expect(rankCharacters([row], { ...filters, role: "TANK" }, 100, legacyRules)).toHaveLength(1);
  });
});
