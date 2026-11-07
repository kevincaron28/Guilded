// Read-only: reads every accepted public dungeon run and prints the analysis in docs/plans/DUNGEON_SCORING_V2.md.
// Writes nothing, opens no Discord session, prints no credentials. Run on the owner's PC (needs .env.local):
//   npx tsx scripts/analyze-dungeon-runs.ts [--json]
import { prisma } from "../src/database.js";
import { analysisReport, analyzeRuns } from "../src/services/dungeon-analysis.js";
import { prismaLeaderboardStore } from "../src/services/public-leaderboard.js";
import { publicRules } from "../src/services/public-score.js";

try {
  const runs = await prismaLeaderboardStore(prisma).runs({ from: null, to: null });
  const analysis = analyzeRuns(runs, publicRules());
  console.log(process.argv.includes("--json") ? JSON.stringify(analysis, null, 2) : analysisReport(analysis));
} catch {
  console.error("Dungeon analysis unavailable (no database access?). Nothing was changed.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
