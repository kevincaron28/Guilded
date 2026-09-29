// Disposable local PostgreSQL only. Never reads .env or uses production DATABASE_URL.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("Set TEST_DATABASE_URL to a disposable local database named guilded_release_test.");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Refusing: only local guilded_release_test may be used.");
const env = { ...process.env, DATABASE_URL: value, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "guilded_release_test" };
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? "unavailable"}).`);
}
const temp = mkdtempSync(join(tmpdir(), "guilded-db-"));
try {
  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["prisma", "generate"]);
  run("node", ["--import", "tsx", "scripts/verify-postgres.ts"]);
  const backup = join(temp, "rehearsal.dump");
  run("pg_dump", ["--format=custom", "--no-owner", "--file", backup]);
  run("psql", ["-v", "ON_ERROR_STOP=1", "-c", 'UPDATE "EpgpTransaction" SET "epAmount" = 999 WHERE "createdBy" = \'release-test\';']);
  run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--exit-on-error", "--dbname", "guilded_release_test", backup]);
  run("node", ["--import", "tsx", "scripts/verify-postgres.ts", "--restored"]);
  console.log("PostgreSQL migrations, concurrent imports, pool routing, and backup/restore passed.");
} finally { rmSync(temp, { recursive: true, force: true }); }
