import { missedTargets, runMatrix } from "../src/services/tcg-sim.js";
import type { AiLevel } from "../src/services/tcg-ai.js";

// Guilded Clash self-play: `npm run clash:selfplay -- --games 200 --level normal --seed 1`
// --games is per ordered class pair (72 pairs). The design's full matrix is 20000. Prints the balance report (docs/plans/APP_TCG_GAME.md section 7).
const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] ?? fallback : fallback; };
const level = arg("level", "normal") as AiLevel;
const started = Date.now();
const report = runMatrix({ gamesPerPair: Number(arg("games", "20")), levels: [level, level], seed: Number(arg("seed", "1")) });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`Games ${report.games}, draws ${report.draws}, stuck ${report.stuck}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`First player wins ${pct(report.firstPlayerWins / Math.max(1, report.games - report.draws))}; median rounds ${report.medianRounds}; Exhaustion ${pct(report.exhaustionShare)}`);
console.log("Class win rates:");
for (const [cls, row] of Object.entries(report.byClass)) console.log(`  ${cls.padEnd(8)} ${pct(row.rate)} (${row.games} games)`);
const top = Object.entries(report.cards).filter(([, r]) => r.played >= 50).sort((a, b) => b[1].rate - a[1].rate);
console.log("Highest win rate when played:", top.slice(0, 8).map(([id, r]) => `${id} ${pct(r.rate)}`).join(", "));
console.log("Lowest:", top.slice(-8).map(([id, r]) => `${id} ${pct(r.rate)}`).join(", "));
const missed = missedTargets(report);
console.log(missed.length ? `Missed targets:\n  ${missed.join("\n  ")}` : "All targets met.");
