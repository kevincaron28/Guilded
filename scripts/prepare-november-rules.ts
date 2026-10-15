// Offline compiler only. Never loads credentials or changes a season.
import { readFileSync, writeFileSync } from "node:fs";
import { createNovemberDungeonRules } from "../src/services/dungeon-november-rules.js";
import { novemberDungeonCatalog } from "../src/services/dungeon-november-catalog.js";

const args = process.argv.slice(2);
if (args.length === 2 && args[0] === "--template") {
  writeFileSync(args[1]!, JSON.stringify({ kind: "november-evidence-draft", active: false,
    routes: novemberDungeonCatalog().routes.map(r => ({ catalogId: r.id, family: r.family, name: r.name,
      dungeonKey: null, instanceId: null, completion: { ids: [], names: [] }, requiredEncounters: [],
      routeStandard: null, participationBand: null, targetSec: null, verification: { build: null, runRef: null } }))
  }, null, 2) + "\n", { flag: "wx" });
  console.log("Prepared evidence template. All routes disabled; no season changed.");
} else if (args.length === 4 && args[0] === "--input" && args[2] === "--output") {
  const input = JSON.parse(readFileSync(args[1]!, "utf8")) as { routes?: unknown };
  const rules = createNovemberDungeonRules(input.routes);
  writeFileSync(args[3]!, JSON.stringify(rules, null, 2) + "\n", { flag: "wx" });
  console.log("Prepared version-5 level-60 rules. Review and freeze in a NEW season; nothing activated.");
} else {
  throw new Error("Use --template NEW_FILE or --input EVIDENCE_JSON --output NEW_RULES_FILE. No activation supported.");
}
