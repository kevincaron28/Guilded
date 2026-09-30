import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { backupFileName, runBackup } from "../src/services/backup.js";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(fail = false) {
  const dir = await mkdtemp(join(tmpdir(), "guilded-backup-")); dirs.push(dir);
  const findMany = vi.fn(async () => { if (fail) throw new Error("database unavailable"); return [{ id: "guild", amount: 12n }]; });
  const transaction = vi.fn(async work => work({ guild: { findMany } }));
  return { dir, database: { $transaction: transaction }, transaction };
}
describe("daily backup integrity", () => {
  it("publishes a readable private snapshot and skips a valid existing copy", async () => {
    const { dir, database, transaction } = await fixture(); const now = new Date("2026-09-30T12:00:00Z");
    const result = await runBackup(database as never, now, dir);
    expect(result).toEqual({ file: backupFileName(now), rows: 1 });
    expect(JSON.parse(gunzipSync(await readFile(join(dir, result!.file))).toString())).toMatchObject({ tables: { Guild: [{ id: "guild", amount: "12" }] } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
    if (process.platform !== "win32") {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(dir, result!.file))).mode & 0o777).toBe(0o600);
    }
    expect(await runBackup(database as never, now, dir)).toBeNull();
    expect(transaction).toHaveBeenCalledOnce();
    expect(await readdir(dir)).toEqual([result!.file]);
  });
  it("replaces a corrupt daily copy instead of considering it finished", async () => {
    const { dir, database } = await fixture(); const now = new Date("2026-09-30T12:00:00Z");
    await writeFile(join(dir, backupFileName(now)), "interrupted write");
    expect(await runBackup(database as never, now, dir)).not.toBeNull();
    expect(JSON.parse(gunzipSync(await readFile(join(dir, backupFileName(now)))).toString()).tables.Guild).toHaveLength(1);
  });
  it("does not publish a finished backup when database reads fail", async () => {
    const { dir, database } = await fixture(true);
    await expect(runBackup(database as never, new Date(), dir)).rejects.toThrow("database unavailable");
    expect(await readdir(dir)).toEqual([]);
  });
});
