import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { launchTimingRules, LAUNCH_TIMING_REVIEW } from "../src/services/dungeon-launch-timings.js";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
mkdirSync("dist/edition-rules", { recursive: true });
const artifacts: {edition:string;bytes:number;sha256:string}[] = [];
for (const edition of ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"] as const) {
  const { rules } = launchTimingRules(edition);
  if (!validBracketedRules(rules)) throw new Error(`Invalid ${edition} rules`);
  const json = JSON.stringify(rules, null, 2) + "\n";
  if (Buffer.byteLength(json) > 200_000) throw new Error("Rules exceed Discord attachment limit");
  writeFileSync(`dist/edition-rules/${edition}.json`, json);
  artifacts.push({edition,bytes:Buffer.byteLength(json),sha256:createHash("sha256").update(json).digest("hex")});
  console.log(`${edition}: ${rules.routes.length} routes, ${rules.brackets.length} brackets; provisional`);
}
writeFileSync("dist/edition-rules/manifest.json",JSON.stringify({
  sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  dirty:!!execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim(),
  timingReview: LAUNCH_TIMING_REVIEW, installation:"upcoming-season-only", benchmarks:"provisional",clientAcceptance:"pending",artifacts
},null,2)+"\n");
