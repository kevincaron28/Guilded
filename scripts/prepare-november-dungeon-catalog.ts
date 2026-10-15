// Offline only: no environment, database, Discord or season activation imports.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { novemberDungeonCatalog, novemberCatalogMarkdown } from "../src/services/dungeon-november-catalog.js";

if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Only --check is supported; this tool cannot activate a season.");
const check = process.argv.includes("--check");
const outputs = [
  ["docs/NOVEMBER_DUNGEON_CATALOG.md", novemberCatalogMarkdown("en")],
  ["docs/NOVEMBER_DUNGEON_CATALOG_FR.md", novemberCatalogMarkdown("fr")],
  ["docs/data/november-dungeon-catalog.json", JSON.stringify(novemberDungeonCatalog(), null, 2) + "\n"]
] as const;
if (!check) mkdirSync("docs/data", { recursive: true });
for (const [path, content] of outputs) {
  if (check) {
    if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error(`Stale catalog: ${path}`);
  } else writeFileSync(path, content);
}
console.log(`${check ? "Verified" : "Prepared"} 35 catalog entries; 10 proposed rating candidates; 0 activated. No database or Discord changes.`);
