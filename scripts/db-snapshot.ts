import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

// Read-only check for database-layer upgrades (docs/PRISMA_7_UPGRADE.md): read the same database
// copy with the old and the new code, then compare. Run with scripts/with-env.mjs.
//   tsx scripts/db-snapshot.ts snapshot <empty dir>  every table, in the daily backup's format
//   tsx scripts/db-snapshot.ts compare <a.json.gz> <b.json.gz>
// The comparison names tables and fields only; values (Discord IDs, messages) are never printed.
const [mode, first, second] = process.argv.slice(2);

type Snapshot = { tables: Record<string, Record<string, unknown>[]> };
const load = async (file: string) => JSON.parse(gunzipSync(await readFile(file)).toString("utf8")) as Snapshot;

if (mode === "snapshot" && first) {
  const { runBackup } = await import("../src/services/backup.js");
  const { disconnectDatabase, prisma } = await import("../src/database.js");
  try {
    const result = await runBackup(prisma, new Date(), first, 1000);
    console.log(result ? `${result.rows} rows written to ${first}/${result.file}` : `${first} already holds today's snapshot: use an empty folder.`);
  } finally { await disconnectDatabase(); }
} else if (mode === "compare" && first && second) {
  const [a, b] = [await load(first), await load(second)];
  let differences = 0;
  for (const table of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
    const rowsA = (a.tables[table] ?? []).map(row => JSON.stringify(row)).sort();
    const rowsB = (b.tables[table] ?? []).map(row => JSON.stringify(row)).sort();
    if (rowsA.length === rowsB.length && rowsA.every((row, index) => row === rowsB[index])) continue;
    differences++;
    const onlyA = rowsA.filter(row => !rowsB.includes(row)).map(row => JSON.parse(row) as Record<string, unknown>);
    const onlyB = rowsB.filter(row => !rowsA.includes(row)).map(row => JSON.parse(row) as Record<string, unknown>);
    const fields = new Set<string>();
    for (const [index, row] of onlyA.entries()) {
      const other = onlyB[index];
      for (const key of new Set([...Object.keys(row), ...Object.keys(other ?? {})])) if (JSON.stringify(row[key]) !== JSON.stringify(other?.[key])) fields.add(key);
    }
    console.log(`${table}: ${rowsA.length} vs ${rowsB.length} rows, ${onlyA.length} differ; fields: ${[...fields].join(", ") || "(row counts only)"}`);
  }
  console.log(differences ? `${differences} table(s) differ.` : "Identical: every table has the same rows and values.");
  if (differences) process.exitCode = 1;
} else {
  console.error("Usage: tsx scripts/db-snapshot.ts snapshot <empty dir> | compare <a.json.gz> <b.json.gz>");
  process.exitCode = 1;
}
