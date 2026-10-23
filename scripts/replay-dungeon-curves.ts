// node --import tsx scripts/replay-dungeon-curves.ts input.json output.json
// Input: { season, startsAt, endsAt, gameBuild, rules: frozen BracketedRules, runs: addon run payloads[] }.
// Use a local, anonymized export. This program never connects to a database or changes scores.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";
import { summarize } from "../src/services/public-runs.js";
import { replayCurves } from "../src/services/dungeon-curve-replay.js";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Give local input.json and output.json paths.");
const data = JSON.parse(readFileSync(input, "utf8"));
const from = new Date(data.startsAt), to = new Date(data.endsAt);
if (typeof data.season !== "string" || !data.season || typeof data.gameBuild !== "string" || !data.gameBuild
  || typeof data.startsAt !== "string" || typeof data.endsAt !== "string" || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to
  || !validBracketedRules(data.rules) || !Array.isArray(data.runs)) throw new Error("Expected season, startsAt/endsAt, gameBuild, frozen rules and runs[].");
let excludedMetadata = 0;
const runs = data.runs.flatMap((raw: unknown) => {
  const parsed = dungeonRunSchema.safeParse(raw);
  if (!parsed.success || !validateRun(parsed.data).ok || parsed.data.state !== "COMPLETED"
    || parsed.data.gameBuild !== data.gameBuild || parsed.data.startTrigger !== "first combat"
    || !parsed.data.startedAt || !parsed.data.endedAt || parsed.data.startedAt * 1000 < from.getTime() || parsed.data.endedAt * 1000 >= to.getTime()) { excludedMetadata++; return []; }
  const summary = summarize(parsed.data);
  return [{ ...summary, runId: summary.runKey, confirmations: 1, evidence: { startedAt: summary.startedAt, completedBy: summary.completedBy, encounters: summary.encounters } }];
});
const result = { season: data.season, startsAt: from.toISOString(), endsAt: to.toISOString(), gameBuild: data.gameBuild, startTrigger: "first combat", excludedMetadata,
  rulesSha256: createHash("sha256").update(JSON.stringify(data.rules)).digest("hex"), ...replayCurves(runs, data.rules) };
writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(`Wrote offline comparison: ${result.eligibleRuns} eligible runs, ${excludedMetadata + result.excludedRuns} excluded. No live changes.`);
