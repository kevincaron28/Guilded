type Row = Record<string, unknown>;
type Snapshot = { tables: Record<string, Row[]> };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validate(value: unknown): asserts value is Snapshot {
  if (!isObject(value) || !isObject(value["tables"]) || !Object.keys(value["tables"]).length
    || Object.values(value["tables"]).some(rows => !Array.isArray(rows) || rows.some(row => !isObject(row)))) {
    throw new Error("Invalid snapshot: expected a non-empty tables object containing arrays of rows.");
  }
}

// Object property order is not data; array order and duplicate rows are.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Diagnostics contain table names and counts only, never member IDs or field values.
export function compareSnapshots(a: unknown, b: unknown): string[] {
  validate(a);
  validate(b);
  const differences: string[] = [];
  for (const table of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
    if (!Object.hasOwn(a.tables, table) || !Object.hasOwn(b.tables, table)) {
      differences.push(`${table}: missing from ${Object.hasOwn(a.tables, table) ? "second" : "first"} snapshot.`);
      continue;
    }
    const rowsA = a.tables[table]!.map(row => JSON.stringify(canonical(row))).sort();
    const rowsB = b.tables[table]!.map(row => JSON.stringify(canonical(row))).sort();
    if (rowsA.length !== rowsB.length || rowsA.some((row, index) => row !== rowsB[index])) {
      differences.push(`${table}: ${rowsA.length} vs ${rowsB.length} rows; contents differ.`);
    }
  }
  return differences;
}
