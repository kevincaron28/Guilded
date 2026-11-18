// Owner-only: add every dungeon route Season 2 brought (The Drowned City, levels 45-59, level 60: dungeon-endgame-routes.ts) to the RUNNING
// season (Season 1), as the owner decided on 17 November 2026 ("add all dungeons to season 1").
//
//   npx tsx scripts/season1-add-routes.ts            dry run (default): the routes and brackets it would add, and how many stored runs become ranked
//   npx tsx scripts/season1-add-routes.ts --apply    writes the official season's rules and every active guild season's rules (one transaction; idempotent)
//   option: --top 20 (rows shown per bracket in the dry run)
//
// Existing routes, targets, level bands, best-N, the over-level penalty and the evidence policy (current-v1) are never touched. Stored runs
// are never altered: scores are computed from the runs and the rules whenever they are read, so adding the routes is the whole re-score
// (the website follows within its cache time, the Discord boards at their next refresh). Back up the database before --apply (docs/DEPLOY_ORACLE.md).
import { prisma } from "../src/database.js";
import { loadOfficialWindows } from "../src/services/official-seasons.js";
import { prismaLeaderboardStore } from "../src/services/public-leaderboard.js";
import { periodRules, publicSeasons, scoreRun } from "../src/services/public-score.js";
import { impactLines, rulesImpact } from "../src/services/season-rules-impact.js";
import { AllDungeonsError, applyAllDungeons, planAllDungeons } from "../src/services/season-all-dungeons.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const known = new Set(["apply", "top"]);
for (const a of args) if (a.startsWith("--") && !known.has(a.slice(2))) throw new Error(`Unknown option ${a}`);
const topIndex = args.indexOf("--top");
const top = Math.max(1, Math.min(100, Number(topIndex >= 0 ? args[topIndex + 1] : "20") || 20));
const NL = String.fromCharCode(10);

try {
  const now = new Date();
  const plan = await planAllDungeons(prisma, now);
  console.log(`${flag("apply") ? "APPLY" : "DRY RUN"}: ${plan.season.name} (running since ${plan.season.start.toISOString()}), ${plan.guildSeasons.length} guild seasons follow it`);
  if (!plan.after) {
    console.log("Nothing to change: the season already has every route (or runs on the current-v2 policy, which cannot gain routes).");
  } else {
    console.log(`Routes to add (${plan.routes.length}): ${plan.routes.join(", ")}`);
    console.log(`Brackets to add (${plan.brackets.length}): ${plan.brackets.join(", ") || "none"}`);
    console.log(`Evidence policy stays ${plan.before.evidencePolicy ?? "current-v1"}; existing targets, bands, best-N and penalty are unchanged.${NL}`);
    const period = publicSeasons(now, await loadOfficialWindows(prisma)).find((p) => p.id === `s${plan.season.number}`);
    const runs = await prismaLeaderboardStore(prisma).runs({ from: period?.from ?? plan.season.start, to: period?.to ?? null });
    const oldRules = period ? periodRules(period) : plan.before;
    const newRules = { ...oldRules, routes: plan.after.routes, brackets: plan.after.brackets, targets: plan.after.targets, levelBands: plan.after.levelBands,
      participationLevelBands: plan.after.participationLevelBands, routeBracket: plan.after.routeBracket, catalog: plan.after.catalog };
    const becoming = runs.filter((r) => !scoreRun(r, oldRules) && scoreRun(r, newRules));
    console.log(`Public runs of the season read: ${runs.length}. Stored runs that become ranked: ${becoming.length} (not ranked today, ranked after).`);
    const per = new Map<string, number>();
    for (const r of becoming) per.set(r.dungeonName, (per.get(r.dungeonName) ?? 0) + 1);
    for (const [name, count] of [...per].sort()) console.log(`  ${name}: ${count}`);
    console.log(NL + impactLines(rulesImpact(runs, oldRules, newRules, top), top).join(NL));
    if (!flag("apply")) console.log(`${NL}Nothing was written. To apply: npx tsx scripts/season1-add-routes.ts --apply`);
    else {
      const done = await applyAllDungeons(prisma, now);
      console.log(done ? `${NL}Applied. ${done.plan.routes.length} routes added; ${done.guilds} guild seasons updated.` : `${NL}Nothing to change.`);
    }
  }
} catch (error) {
  console.error(error instanceof AllDungeonsError ? error.message : `Season 1 route addition unavailable (${error instanceof Error ? error.message : "no database access?"}). Nothing was changed.`);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
