#!/usr/bin/env node
// Encrypted off-tenancy database backups to Cloudflare R2 (runbook: docs/OFFSITE_BACKUPS.md).
//
//   node scripts/offsite-backup.mjs backup        nightly: pg_dump, encrypt, upload, prune (14 daily + 6 monthly)
//   node scripts/offsite-backup.mjs restore-test  monthly: restore the newest dump into a scratch database, compare row counts
//   node scripts/offsite-backup.mjs list          what is stored in the bucket
//   node scripts/offsite-backup.mjs keygen <dir>  (owner PC) make the recovery and restore-test key pairs
//   node scripts/offsite-backup.mjs decrypt <file.enc> <out.dump> <private-key.pem>   (owner PC) decrypt one dump
//
// Configuration comes from the environment (systemd EnvironmentFile), never from arguments, and no secret is printed.
// It only reads the database (pg_dump, count queries) and writes to the bucket; the one exception is the restore test,
// which creates and drops the scratch database named below. It never starts or contacts the bot's Discord gateway.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ObjectStore, dailyKey, decryptFile, encryptFile, keyId, manifestKeyFor, monthlyKey, retentionDeletes, sha256File } from "./offsite-backup-lib.mjs";

/** Tables counted in every manifest and compared after a restore. Names are Prisma model names (no @@map). */
export const COUNTED_TABLES = ["Guild", "Member", "Character", "GuildSettings", "DungeonRun", "DungeonRunPlayer", "DungeonPointTransaction", "DuelResult", "AuditLog"];
export const SCRATCH_DATABASE = "guilded_restore_test";
// Only these URL parameters mean something to libpq; Prisma-only ones (connection_limit, pool_timeout, schema...) are dropped.
const PARAM_ENV = { sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", connect_timeout: "PGCONNECT_TIMEOUT", application_name: "PGAPPNAME" };

/** Pure: libpq environment variables for a postgres:// URL (Prisma-only query parameters are dropped; the password never appears in argv). */
export function pgEnvFromUrl(url, database) {
  const parsed = new URL(url);
  const env = {
    PGHOST: parsed.hostname, PGPORT: parsed.port || "5432", PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database ?? decodeURIComponent(parsed.pathname.slice(1))
  };
  for (const [name, value] of parsed.searchParams) if (PARAM_ENV[name]) env[PARAM_ENV[name]] = value;
  return env;
}

/** Pure: do restored counts agree with the counts around the dump? The live database moves while pg_dump runs, so a table passes inside [min-slack, max+slack]. */
export function compareCounts(manifest, restored) {
  const problems = [];
  for (const table of COUNTED_TABLES) {
    const before = manifest.countsBefore?.[table], after = manifest.countsAfter?.[table], got = restored[table];
    if (before === undefined || after === undefined) { problems.push(`${table}: not in the manifest`); continue; }
    if (got === undefined) { problems.push(`${table}: missing after the restore`); continue; }
    const low = Math.min(before, after), high = Math.max(before, after), slack = Math.max(5, Math.ceil(high * 0.01));
    if (got < low - slack || got > high + slack) problems.push(`${table}: restored ${got}, expected ${low}-${high}`);
  }
  return problems;
}

const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is not set.`); return value; };
const optional = (name) => process.env[name] || undefined;

function store() {
  return new ObjectStore({ endpoint: required("BACKUP_R2_ENDPOINT"), bucket: required("BACKUP_R2_BUCKET"), accessKeyId: required("BACKUP_R2_ACCESS_KEY_ID"), secretAccessKey: required("BACKUP_R2_SECRET_ACCESS_KEY") });
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}): ${(result.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);
  return result.stdout;
}

function countTables(env) {
  const counts = {};
  for (const table of COUNTED_TABLES) counts[table] = Number(run("psql", ["--no-psqlrc", "-At", "-c", `SELECT count(*) FROM "${table}"`], env).trim());
  return counts;
}

/** One line to the error-log channel through Discord's REST API (no gateway session, so it never competes with the bot). */
async function report(text) {
  const token = optional("DISCORD_TOKEN"), channel = optional("ERROR_LOG_CHANNEL_ID");
  if (!token || !channel) { console.error("(no DISCORD_TOKEN / ERROR_LOG_CHANNEL_ID: not reported to Discord)"); return; }
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
      method: "POST", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } })
    });
    if (!response.ok) console.error(`Discord report failed: HTTP ${response.status}`);
  } catch (error) { console.error(`Discord report failed: ${error.message}`); }
}

const workdir = () => mkdtempSync(join(optional("BACKUP_WORKDIR") ?? tmpdir(), "guilded-backup-"));
const pem = (path) => readFileSync(path, "utf8");

export async function backup(now = new Date()) {
  const dir = workdir();
  try {
    const databaseUrl = required("DATABASE_URL"), env = pgEnvFromUrl(databaseUrl);
    const recipients = [{ pem: pem(required("BACKUP_RECOVERY_PUBLIC_KEY_FILE")) }];
    if (optional("BACKUP_RESTORE_TEST_PUBLIC_KEY_FILE")) recipients.push({ pem: pem(optional("BACKUP_RESTORE_TEST_PUBLIC_KEY_FILE")) });
    const r2 = store();
    const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
    const dump = join(dir, "database.dump"), encrypted = join(dir, "database.dump.enc");
    const countsBefore = countTables(env);
    run("pg_dump", ["--format=custom", "--no-owner", "--file", dump], env);
    const countsAfter = countTables(env);
    const sealed = await encryptFile(dump, encrypted, recipients);
    rmSync(dump, { force: true });
    const key = dailyKey(day);
    await r2.putFile(key, encrypted);
    const manifest = { createdAt: now.toISOString(), key, plainBytes: sealed.plainBytes, encryptedBytes: statSync(encrypted).size, sha256: sealed.sha256, keyIds: sealed.keyIds, countsBefore, countsAfter, tool: run("pg_dump", ["--version"], env).trim() };
    await r2.putText(manifestKeyFor(key), JSON.stringify(manifest, null, 2));
    if (!(await r2.exists(monthlyKey(month)))) { await r2.copy(key, monthlyKey(month)); await r2.copy(manifestKeyFor(key), manifestKeyFor(monthlyKey(month))); }
    const doomed = retentionDeletes(await r2.list(""));
    for (const old of doomed) await r2.delete(old);
    console.log(JSON.stringify({ stored: key, encryptedBytes: manifest.encryptedBytes, recipients: sealed.keyIds.length, pruned: doomed.length }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function restoreTest() {
  const dir = workdir();
  try {
    const r2 = store();
    const keys = (await r2.list("daily/")).filter((key) => key.endsWith(".dump.enc")).sort();
    const latest = keys.at(-1);
    if (!latest) throw new Error("The bucket has no daily dump to test.");
    const manifest = JSON.parse(await r2.getText(manifestKeyFor(latest)));
    const encrypted = join(dir, "database.dump.enc");
    await r2.getFile(latest, encrypted);
    if ((await sha256File(encrypted)) !== manifest.sha256) throw new Error(`${latest}: the stored file does not match its checksum.`);
    const privateKeyFile = optional("BACKUP_RESTORE_TEST_PRIVATE_KEY_FILE");
    if (!privateKeyFile || !existsSync(privateKeyFile)) {
      await report(`🟡 Backup restore test: ${latest} downloaded and its checksum matches, but no restore-test key is installed on this server, so it was not restored (see docs/OFFSITE_BACKUPS.md).`);
      return { restored: false };
    }
    const databaseUrl = required("DATABASE_URL"), live = pgEnvFromUrl(databaseUrl);
    if (live.PGDATABASE === SCRATCH_DATABASE) throw new Error("DATABASE_URL points at the scratch database name; refusing.");
    const admin = pgEnvFromUrl(optional("RESTORE_TEST_ADMIN_URL") ?? databaseUrl, optional("RESTORE_TEST_ADMIN_URL") ? undefined : "postgres");
    const scratch = { ...admin, PGDATABASE: SCRATCH_DATABASE };
    const dump = join(dir, "database.dump");
    await decryptFile(encrypted, dump, pem(privateKeyFile));
    rmSync(encrypted, { force: true });
    try {
      run("psql", ["--no-psqlrc", "-c", `DROP DATABASE IF EXISTS ${SCRATCH_DATABASE}`], admin);
      run("psql", ["--no-psqlrc", "-c", `CREATE DATABASE ${SCRATCH_DATABASE}`], admin);
      run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", SCRATCH_DATABASE, dump], scratch);
      const restored = countTables(scratch);
      const problems = compareCounts(manifest, restored);
      if (problems.length) throw new Error(`row counts differ: ${problems.join("; ")}`);
      await report(`🟢 Backup restore test passed: ${latest} (${(manifest.encryptedBytes / 1048576).toFixed(1)} MB encrypted) restored into a scratch database and ${COUNTED_TABLES.length} tables match their row counts (${COUNTED_TABLES.map((t) => `${t} ${restored[t]}`).join(", ")}).`);
      return { restored: true, restoredCounts: restored };
    } finally {
      try { run("psql", ["--no-psqlrc", "-c", `DROP DATABASE IF EXISTS ${SCRATCH_DATABASE}`], admin); } catch { /* the next run drops it first */ }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function keygen(directory) {
  if (!directory) throw new Error("Usage: keygen <directory on this PC, not on the server>");
  mkdirSync(directory, { recursive: true });
  for (const name of ["recovery", "restore-test"]) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    writeFileSync(join(directory, `${name}.public.pem`), publicKey, { flag: "wx" });
    writeFileSync(join(directory, `${name}.private.pem`), privateKey, { flag: "wx", mode: 0o600 });
    console.log(`${name}: key id ${keyId(publicKey)}`);
  }
  console.log("Copy ONLY the *.public.pem files to the server. Keep recovery.private.pem offline (password manager or a USB stick). Never commit any .pem file.");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "backup") await backup();
    else if (command === "restore-test") { try { await restoreTest(); } catch (error) { await report(`🔴 Backup restore test FAILED: ${String(error.message).slice(0, 900)}`); throw error; } }
    else if (command === "list") console.log((await store().list("")).join("\n"));
    else if (command === "keygen") keygen(args[0]);
    else if (command === "decrypt") { if (args.length !== 3) throw new Error("Usage: decrypt <file.enc> <out.dump> <private-key.pem>"); await decryptFile(args[0], args[1], pem(args[2])); console.log("Decrypted and authenticated."); }
    else throw new Error("Usage: offsite-backup.mjs backup | restore-test | list | keygen <dir> | decrypt <file.enc> <out> <private.pem>");
  } catch (error) {
    if (command === "backup") await report(`🔴 Nightly off-site backup FAILED: ${String(error.message).slice(0, 900)}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("offsite-backup.mjs")) await main();
