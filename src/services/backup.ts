import { chmod, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { Prisma, type PrismaClient } from "@prisma/client";

// Daily safety copy of the whole database as gzipped JSON, one file per day
// (backups/quebec-gold-YYYY-MM-DD.json.gz), keeping the newest `keep`.
// Neon has its own point-in-time restore; this is the local copy you can
// open, search, or hand to someone if something goes badly wrong.

export const BACKUP_DIR = "backups";
const PREFIX = "quebec-gold-";

export function backupFileName(date: Date): string {
  return `${PREFIX}${date.toISOString().slice(0, 10)}.json.gz`;
}

// Oldest files beyond `keep`, given file names sorted any way.
export function backupsToDelete(files: string[], keep: number): string[] {
  const ours = files.filter((file) => file.startsWith(PREFIX) && file.endsWith(".json.gz")).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

export async function runBackup(database: PrismaClient, now = new Date(), dir = BACKUP_DIR, keep = 14): Promise<{ file: string; rows: number } | null> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const existing = await readdir(dir);
  const file = backupFileName(now);
  const target = join(dir, file);
  // Tighten old copies too. Existing partial/corrupt files must not suppress today's backup.
  for (const name of existing.filter(name => name.startsWith(PREFIX) && name.endsWith(".json.gz"))) await chmod(join(dir, name), 0o600);
  if (existing.includes(file)) {
    try {
      const previous = JSON.parse(gunzipSync(await readFile(target)).toString("utf8"));
      if (previous.createdAt && previous.tables && typeof previous.tables === "object") return null;
    } catch { /* replace an incomplete backup below */ }
  }

  // One database snapshot: concurrent imports cannot leave parent/child tables out of step.
  const { tables, rows } = await database.$transaction(async transaction => {
    const tables: Record<string, unknown[]> = {};
    let rows = 0;
    for (const model of Prisma.dmmf.datamodel.models) {
      const delegate = (transaction as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[delegateName(model.name)];
      if (!delegate?.findMany) continue;
      const data = await delegate.findMany();
      tables[model.name] = data;
      rows += data.length;
    }
    return { tables, rows };
  }, { isolationLevel: "RepeatableRead", timeout: 60_000, maxWait: 15_000 });
  const json = JSON.stringify({ createdAt: now.toISOString(), tables }, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  const temporary = join(dir, `.${file}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(gzipSync(json)); await handle.sync(); } finally { await handle.close(); }
    // Publish only a complete file; an interrupted write never appears as a finished backup.
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  for (const old of backupsToDelete([...new Set([...existing, file])], keep)) await rm(join(dir, old), { force: true });
  return { file, rows };
}
