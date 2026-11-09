import { chmod, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

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

// The hourly copy and the season-rotation copy both take a Repeatable Read snapshot
// of every table. Running them together holds two connections for up to a minute
// and was enough, with the other startup jobs, to stop new transactions from starting.
let backupQueue: Promise<unknown> = Promise.resolve();

export async function runBackup(database: PrismaClient, now = new Date(), dir = BACKUP_DIR, keep = 14): Promise<{ file: string; rows: number } | null> {
  const previous = backupQueue;
  let release!: () => void;
  backupQueue = new Promise<void>(resolve => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await writeBackup(database, now, dir, keep);
  } finally {
    release();
  }
}

async function writeBackup(database: PrismaClient, now: Date, dir: string, keep: number): Promise<{ file: string; rows: number } | null> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const existing = await readdir(dir);
  const file = backupFileName(now);
  const target = join(dir, file);
  // Tighten old copies too. Existing partial/corrupt files must not suppress today's backup.
  for (const name of existing.filter(name => name.startsWith(PREFIX) && name.endsWith(".json.gz"))) await chmod(join(dir, name), 0o600);
  // A finished backup is only ever published by the rename below, so today's file existing means it is
  // complete. 9.0.8 incident (9 Nov 2026): parsing the whole previous file, and building the whole
  // database as one JSON string, pushed the bot over its heap limit and crash-looped it every restart.
  if (existing.includes(file) && await isCompleteBackup(target)) return null;

  const temporary = join(dir, `.${file}.${randomUUID()}.tmp`);
  try {
    // Stream table by table into the gzip file: only one table is in memory at a time. Same file format
    // as before ({"createdAt":..., "tables": {Model: [rows], ...}}).
    const gzip = createGzip();
    const sink = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    const done = pipeline(gzip, sink);
    const write = (chunk: string) => new Promise<void>((resolve, reject) => {
      if (gzip.write(chunk, (error) => { if (error) reject(error); })) resolve(); else gzip.once("drain", resolve);
    });
    // One database snapshot: concurrent imports cannot leave parent/child tables out of step.
    const rows = await database.$transaction(async transaction => {
      let rows = 0, first = true;
      await write(`{"createdAt":${JSON.stringify(now.toISOString())},"tables":{`);
      // Every model in the schema (Prisma 7's generated client has no Prisma.dmmf).
      for (const model of Object.values(Prisma.ModelName)) {
        const delegate = (transaction as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[delegateName(model)];
        if (!delegate?.findMany) continue;
        const data = await delegate.findMany();
        rows += data.length;
        await write(`${first ? "" : ","}${JSON.stringify(model)}:${JSON.stringify(data, bigintSafe)}`);
        first = false;
      }
      await write("}}");
      return rows;
    }, { isolationLevel: "RepeatableRead", timeout: 60_000, maxWait: 15_000 });
    gzip.end();
    await done;
    // Publish only a complete file; an interrupted write never appears as a finished backup.
    await rename(temporary, target);
    for (const old of backupsToDelete([...new Set([...existing, file])], keep)) await rm(join(dir, old), { force: true });
    return { file, rows };
  } finally { await rm(temporary, { force: true }); }
}

const bigintSafe = (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value;

// A complete gzip file starts with the gzip header and decodes to our JSON prefix; checked on the first
// bytes only, never by reading the whole backup into memory.
async function isCompleteBackup(path: string): Promise<boolean> {
  try {
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      if (size < 20) return false;
      const head = Buffer.alloc(2);
      await handle.read(head, 0, 2, 0);
      return head[0] === 0x1f && head[1] === 0x8b;
    } finally { await handle.close(); }
  } catch { return false; }
}
