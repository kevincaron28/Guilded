// Owner-only: change the RUNNING season's scoring rules (today: switch the boss-skip rule on or off), with a dry run first.
//
//   npx tsx scripts/season-rules-change.ts                         dry run: per dungeon and for the top 20 of each bracket, old -> new score and rank moves
//   npx tsx scripts/season-rules-change.ts --apply --by "name"     applies it (one transaction); the previous rules are kept on the season
//   npx tsx scripts/season-rules-change.ts --restore               dry run of the undo of the latest change
//   npx tsx scripts/season-rules-change.ts --restore --by "name"   undoes the latest change
//   npx tsx scripts/season-rules-change.ts --history               prints every recorded change of the running season
//   npx tsx scripts/season-rules-change.ts --kill-shares          read-only: per dungeon, each boss id with the share of completed runs that killed it
//   options: --off (switch the boss rule off instead of on) --top 20 --note "why"
//
// Stored runs are never altered. Scores, ranks and boards are computed from the runs and the season's rules when they are read, so the
// website follows within its cache time and the Discord boards at their next refresh. Past seasons are never changed. Back up the
// database before --apply (docs/DEPLOY_ORACLE.md); the exact previous rules are also stored with the change, so --restore is exact.
import { prisma } from "../src/database.js";
import { BOSS_SCORING_V1 } from "../src/services/dungeon-boss-scoring.js";
import type { ScoringPatch } from "../src/services/dungeon-november-rules.js";
import { loadOfficialWindows } from "../src/services/official-seasons.js";
import { prismaLeaderboardStore } from "../src/services/public-leaderboard.js";
import { periodRules, publicSeasons } from "../src/services/public-score.js";
import { applyRulesChange, describeRules, planRulesChange, restoreLastChange, revisionsOf, RulesChangeError } from "../src/services/season-rules-change.js";
import { impactLines, killShareLines, rulesImpact } from "../src/services/season-rules-impact.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback = "") => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback; };
const top = Math.max(1, Math.min(100, Number(value("top", "20")) || 20));
const known = new Set(["apply", "restore", "history", "off", "top", "by", "note", "kill-shares"]);
for (const a of args) if (a.startsWith("--") && !known.has(a.slice(2))) throw new Error(`Unknown option ${a}`);
const NL = String.fromCharCode(10);

try {
  const now = new Date();
  if (flag("history")) {
    const rows = (await prisma.officialSeason.findMany({ where: { gameEdition: "forever" }, orderBy: { startsAt: "asc" } })).filter((r) => r.startsAt <= now);
    const revisions = revisionsOf(rows[rows.length - 1]?.rules);
    console.log(revisions.length ? revisions.map((r) => `${r.at}  ${r.action}  by ${r.by}: ${r.from} -> ${r.to} (${r.guilds} guild seasons)${r.note ? `  "${r.note}"` : ""}`).join(NL) : "No rules change was recorded for the running season.");
  } else if (flag("kill-shares")) {
    const plan = await planRulesChange(prisma, { bossScoring: { ...BOSS_SCORING_V1, since: now.toISOString() } }, now);
    const period = publicSeasons(now, await loadOfficialWindows(prisma)).find((p) => p.id === `s${plan.season.number}`);
    const runs = await prismaLeaderboardStore(prisma).runs({ from: period?.from ?? plan.season.start, to: period?.to ?? null });
    console.log(`Boss kill shares, ${plan.season.name}: ${runs.length} public runs read. Nothing is written.`);
    console.log(killShareLines(runs).join(NL));
  } else {
    const by = value("by");
    const restore = flag("restore");
    const apply = flag("apply") || (restore && !!by);
    if (flag("apply") && !by) throw new Error('--apply needs --by "who is applying it" (kept in the history)');
    const onPatch: ScoringPatch = flag("off") ? { bossScoring: null } : { bossScoring: { ...BOSS_SCORING_V1, since: now.toISOString() } };
    const probe = await planRulesChange(prisma, onPatch, now);
    const stored = revisionsOf((await prisma.officialSeason.findUnique({ where: { id: probe.season.id } }))?.rules);
    // A restore undoes the latest change that no restore has undone yet; its patch is that change's inverse.
    const changes = stored.filter((r) => r.action === "change");
    const last = restore ? changes.slice(0, changes.length - stored.filter((r) => r.action === "restore").length).pop() : undefined;
    if (restore && !last) throw new RulesChangeError("There is no change to undo in the running season.");
    const patch = last ? last.inverse : onPatch;
    const plan = last ? await planRulesChange(prisma, patch, now) : probe;
    console.log(`${apply ? "APPLY" : "DRY RUN"}${restore ? " (restore)" : ""}: ${plan.season.name} (running since ${plan.season.start.toISOString()}), ${plan.guildSeasons.length} guild seasons follow it`);
    console.log(`Rules: ${describeRules(plan.before)} -> ${describeRules(plan.after)}${plan.unchanged ? "  (already in force: nothing to change)" : ""}${NL}`);
    const period = publicSeasons(now, await loadOfficialWindows(prisma)).find((p) => p.id === `s${plan.season.number}`);
    const runs = await prismaLeaderboardStore(prisma).runs({ from: period?.from ?? plan.season.start, to: period?.to ?? null });
    console.log(`Public runs of the season read: ${runs.length} (stored runs are never altered)${NL}`);
    const oldRules = period ? periodRules(period) : plan.before;
    const newRules = { ...oldRules };
    if (patch.bossScoring) newRules.bossScoring = patch.bossScoring; else delete newRules.bossScoring;
    console.log(impactLines(rulesImpact(runs, oldRules, newRules, top), top).join(NL));
    if (!apply) console.log(`${NL}Nothing was written. To apply: npx tsx scripts/season-rules-change.ts ${restore ? "--restore" : "--apply"} --by "name"${flag("off") ? " --off" : ""}`);
    else if (plan.unchanged) console.log(`${NL}Nothing to change.`);
    else if (restore) {
      const done = await restoreLastChange(prisma, { by, now, note: value("note") });
      console.log(done ? `${NL}Restored. ${done.revision.guilds} guild seasons updated. Rules are now: ${done.revision.to}.` : `${NL}Nothing to change.`);
    } else {
      const done = await applyRulesChange(prisma, patch, { by, note: value("note"), now });
      console.log(done ? `${NL}Applied. ${done.revision.guilds} guild seasons updated. Rules are now: ${done.revision.to}. Undo with --restore --by "name".` : `${NL}Nothing to change.`);
    }
  }
} catch (error) {
  console.error(error instanceof RulesChangeError ? error.message : `Rules change unavailable (${error instanceof Error ? error.message : "no database access?"}). Nothing was changed.`);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
