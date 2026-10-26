import { readFileSync, writeFileSync } from "node:fs";
import { dungeonCatalog } from "../companion/dungeon-catalog.mjs";

// A single reviewed manifest drives bot rules, addon endpoints and NPC checkpoints.
const quote = value => JSON.stringify(value);
const identity = b => `{ids={${b.ids.join(",")}},npcIds={${(b.npcIds ?? []).join(",")}},names={}}`;
const generated = dungeonCatalog.routes.map(r => `  {edition=${quote(r.edition)},instanceId=${r.instanceId},participationBand={difficultyId=${r.difficultyId}},completion=${identity(r.completion)},requiredEncounters={${r.requiredEncounters.map(identity).join(",")}}},`).join("\n");
const path = "addon/Guilded/DungeonRoutes.lua";
const before = readFileSync(path, "utf8");
const block = `-- BEGIN GENERATED SOURCE CATALOG\n-- ${dungeonCatalog.source}\n-- Source reviewed; client acceptance and benchmark calibration are pending.\nroutes.sourced = {\n${generated}\n}\n-- END GENERATED SOURCE CATALOG`;
const after = before.includes("-- BEGIN GENERATED SOURCE CATALOG")
  ? before.replace(/-- BEGIN GENERATED SOURCE CATALOG[\s\S]*?-- END GENERATED SOURCE CATALOG/, block)
  : before.replace("ns.dungeonRoutes = routes", `ns.dungeonRoutes = routes\n\n${block}`);
if (process.argv.includes("--check")) {
  // Git's Windows checkout can use CRLF while the generated block uses LF.
  if (after.replaceAll("\r\n", "\n") !== before.replaceAll("\r\n", "\n")) throw new Error("Dungeon endpoint catalog drift: run node scripts/sync-dungeon-catalog.mjs and npm run dungeons:sync");
} else writeFileSync(path, after);
