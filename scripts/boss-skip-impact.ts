// Read-only: what the boss-skip rule (docs/plans/BOSS_SKIP_SCORING_2026-11-14.md) would change in Season 1.
// Writes nothing, rescoring nothing that is stored, opens no Discord session, prints no credentials and no Discord ids.
// Run on the owner's PC (needs .env.local):
//   npx tsx scripts/boss-skip-impact.ts [--season s1] [--top 20]
//
// Per dungeon: Season 1 runs, how many skipped bosses, how many have no boss list yet (and the boss ids those runs recorded, so the
// list can be filled in), then the top characters per bracket today and with the rule applied.
import { prisma } from "../src/database.js";
import { bossTally } from "../src/services/dungeon-boss-scoring.js";
import { routeBosses } from "../src/services/dungeon-bosses.js";
import { loadOfficialWindows } from "../src/services/official-seasons.js";
import { prismaLeaderboardStore } from "../src/services/public-leaderboard.js";
import { characterScores, periodRules, publicSeasons, scoreRun } from "../src/services/public-score.js";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const seasonId = arg("season", "s1");
const top = Math.max(1, Math.min(100, Number(arg("top", "20")) || 20));

try {
  const now = new Date();
  const period = publicSeasons(now, await loadOfficialWindows(prisma)).find((p) => p.id === seasonId);
  if (!period) throw new Error(`No started season "${seasonId}"`);
  const today = periodRules(period);
  const withRule = { ...today, bossScoring: { version: 1 as const } };
  const runs = await prismaLeaderboardStore(prisma).runs({ from: period.from, to: period.to });
  console.log(`# Boss-skip impact on ${period.label} (${runs.length} accepted public runs; rules as stored, rule ${today.bossScoring ? "already ON" : "off today"})\n`);

  interface Row { name: string; runs: number; rated: number; full: number; skipped: number; unreadable: number; noList: boolean; lost: number; ids: Map<number, string> }
  const perDungeon = new Map<number, Row>();
  for (const run of runs) {
    const row = perDungeon.get(run.instanceId) ?? { name: run.dungeonName, runs: 0, rated: 0, full: 0, skipped: 0, unreadable: 0, noList: !routeBosses(run.instanceId), lost: 0, ids: new Map() };
    row.runs++;
    const before = scoreRun(run, today);
    const after = scoreRun(run, withRule);
    if (before) row.rated++;
    if (!row.noList) {
      const tally = bossTally(run.instanceId, run.evidence?.encounters);
      if (!tally) row.unreadable++; else if (tally.killed < tally.total) row.skipped++; else row.full++;
      if (before && after && after.points < before.points) row.lost += before.points - after.points;
    } else for (const e of run.evidence?.encounters ?? []) {
      const event = e as { id?: unknown; name?: unknown; success?: unknown };
      if (event.success === true && typeof event.id === "number") row.ids.set(event.id, typeof event.name === "string" ? event.name : "?");
    }
    perDungeon.set(run.instanceId, row);
  }
  console.log("| Dungeon | Runs | Rated | Full clears | Skipped bosses | Unreadable | Points lost by skips |\n|---|---|---|---|---|---|---|");
  for (const [id, row] of [...perDungeon].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    console.log(row.noList ? `| ${row.name} (${id}) | ${row.runs} | ${row.rated} | no boss list yet | – | – | – |` : `| ${row.name} (${id}) | ${row.runs} | ${row.rated} | ${row.full} | ${row.skipped} | ${row.unreadable} | ${row.lost} |`);
  }
  const missing = [...perDungeon].filter(([, row]) => row.noList && row.ids.size);
  if (missing.length) {
    console.log("\nBoss ids seen in dungeons with no boss list yet (fill `src/services/dungeon-bosses.ts` from these, then the rule covers them):");
    for (const [id, row] of missing) console.log(`- ${row.name} (${id}): ${[...row.ids].map(([bossId, name]) => `${name} ${bossId}`).join(", ")}`);
  }

  const key = (row: { player: { character: string; realm: string }; bracket: string }) => `${row.player.character.toLowerCase()}\0${row.bracket}`;
  const before = characterScores(runs, today);
  const after = characterScores(runs, withRule);
  const afterRank = new Map(after.map((row, i) => [key(row), i + 1]));
  const afterPoints = new Map(after.map((row) => [key(row), row.points]));
  for (const bracket of [...new Set(before.map((row) => row.bracket))].sort()) {
    const rows = before.filter((row) => row.bracket === bracket).slice(0, top);
    console.log(`\n## Top ${top}, bracket ${bracket}\n| # | Character | Today | With rule | New # |\n|---|---|---|---|---|`);
    rows.forEach((row, i) => {
      const inBracket = after.filter((r) => r.bracket === bracket);
      const newRank = inBracket.findIndex((r) => key(r) === key(row)) + 1;
      console.log(`| ${i + 1} | ${row.player.character} | ${row.points} | ${afterPoints.get(key(row)) ?? 0} | ${newRank || "–"} |`);
    });
    void afterRank;
  }
  const changed = before.filter((row) => (afterPoints.get(key(row)) ?? 0) !== row.points).length;
  console.log(`\n${changed} of ${before.length} character rows would score differently. Nothing was written or rescored.`);
} catch (error) {
  console.error(`Boss-skip impact unavailable (${error instanceof Error ? error.message : "no database access?"}). Nothing was changed.`);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
