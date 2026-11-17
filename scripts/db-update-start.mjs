// Runs before every start of the bot (ExecStartPre in deploy/guilded.service), instead of `npm run db:update`
// (prisma migrate deploy + prisma generate, 20-40 s on the 1 GB server, every start).
//  - Prisma client: deploy/update.sh generates it (or copies the live one) while the old bot still runs and
//    records a stamp of what it was generated from. Same stamp here = nothing to do. No stamp, or a different
//    one (a tree that was not prepared by update.sh, a Prisma upgrade) = generate, as before.
//  - Migrations: skipped when the migration files are the ones already applied here (stamp in backups/, written
//    only after a successful `migrate deploy`). Anything else runs `migrate deploy`, which is itself safe to repeat.
// Delete backups/.migrations-applied to force a migrate on the next start (e.g. after restoring the database).
// `--stamp-client` only records the client stamp (used by update.sh in the staged tree).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIGRATION_STAMP = join("backups", ".migrations-applied");
const CLIENT_STAMP = join("src", "generated", ".generated-from");

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** Hash of every file under prisma/migrations (names and contents). */
export function migrationsFingerprint(root) {
  const base = join(root, "prisma", "migrations");
  const hash = createHash("sha256");
  for (const file of filesUnder(base).map((path) => relative(base, path).split("\\").join("/")).sort()) {
    hash.update(file + "\0").update(readFileSync(join(base, file))).update("\0");
  }
  return hash.digest("hex");
}

/** Hash of what the generated Prisma client depends on: the schema, the Prisma config and the installed Prisma version. */
export function clientFingerprint(root) {
  const hash = createHash("sha256");
  for (const name of ["prisma/schema.prisma", "prisma.config.ts"]) {
    const path = join(root, name);
    hash.update(name + "\0").update(existsSync(path) ? readFileSync(path) : "").update("\0");
  }
  for (const name of ["prisma", "@prisma/client"]) {
    const path = join(root, "node_modules", name, "package.json");
    let version = "none";
    try { version = JSON.parse(readFileSync(path, "utf8")).version ?? "none"; } catch { /* not installed */ }
    hash.update(`${name}@${version}\0`);
  }
  return hash.digest("hex");
}

const readStamp = (path) => { try { return readFileSync(path, "utf8").trim(); } catch { return ""; } };

/** What this start has to do. Pure: reads files only. */
export function startupPlan(root) {
  const clientOk = existsSync(join(root, "src", "generated", "prisma", "client.ts"))
    && readStamp(join(root, CLIENT_STAMP)) === clientFingerprint(root);
  const migrations = migrationsFingerprint(root);
  const migrate = readStamp(join(root, MIGRATION_STAMP)) !== migrations;
  return { generate: !clientOk, migrate, migrations };
}

export function recordClientStamp(root) {
  const path = join(root, CLIENT_STAMP);
  if (!existsSync(join(root, "src", "generated", "prisma", "client.ts"))) return false;
  writeFileSync(path, clientFingerprint(root) + "\n");
  return true;
}

function recordMigrationStamp(root, value) {
  const path = join(root, MIGRATION_STAMP);
  mkdirSync(join(root, "backups"), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, value + "\n", { mode: 0o600 });
  renameSync(temp, path);
}

function prisma(root, args) {
  const result = spawnSync("node", ["scripts/with-env.mjs", "prisma", ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = process.cwd();
  if (process.argv.includes("--stamp-client")) {
    console.log(recordClientStamp(root) ? "Recorded the Prisma client stamp." : "No generated client to stamp.");
    process.exit(0);
  }
  const plan = startupPlan(root);
  if (plan.migrate) {
    console.log("Applying database migrations.");
    prisma(root, ["migrate", "deploy"]);
    recordMigrationStamp(root, plan.migrations);
  } else console.log("Database migrations unchanged since the last start: not checking.");
  if (plan.generate) {
    console.log("Generating the Prisma client.");
    prisma(root, ["generate"]);
    recordClientStamp(root);
  } else console.log("Prisma client already generated for this schema.");
}
