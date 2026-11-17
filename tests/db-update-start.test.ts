import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientFingerprint, migrationsFingerprint, recordClientStamp, startupPlan } from "../scripts/db-update-start.mjs";

// The service's start step (ExecStartPre): migrate only when the migration files changed, generate the Prisma client
// only when update.sh did not already prepare it. These keep the deploy's downtime short (16 Nov 2026 audit).
const dirs: string[] = [];
function tree(migrations: Record<string, string>, schema = "model A {}") {
  const root = mkdtempSync(join(tmpdir(), "dbstart-"));
  dirs.push(root);
  mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
  writeFileSync(join(root, "prisma", "schema.prisma"), schema);
  for (const [name, sql] of Object.entries(migrations)) { mkdirSync(join(root, "prisma", "migrations", name), { recursive: true }); writeFileSync(join(root, "prisma", "migrations", name, "migration.sql"), sql); }
  mkdirSync(join(root, "node_modules", "prisma"), { recursive: true });
  writeFileSync(join(root, "node_modules", "prisma", "package.json"), JSON.stringify({ version: "7.0.0" }));
  return root;
}
const addClient = (root: string) => { mkdirSync(join(root, "src", "generated", "prisma"), { recursive: true }); writeFileSync(join(root, "src", "generated", "prisma", "client.ts"), "x"); };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("scripts/db-update-start.mjs plan", () => {
  it("generates and migrates on a tree nobody prepared", () => {
    const root = tree({ "1_a": "select 1" });
    expect(startupPlan(root)).toMatchObject({ generate: true, migrate: true });
  });
  it("skips both once the client is stamped and the migrations were applied", () => {
    const root = tree({ "1_a": "select 1" });
    addClient(root);
    expect(recordClientStamp(root)).toBe(true);
    mkdirSync(join(root, "backups"));
    writeFileSync(join(root, "backups", ".migrations-applied"), migrationsFingerprint(root) + "\n");
    expect(startupPlan(root)).toMatchObject({ generate: false, migrate: false });
  });
  it("migrates again when a migration is added or edited", () => {
    const root = tree({ "1_a": "select 1" });
    const before = migrationsFingerprint(root);
    mkdirSync(join(root, "prisma", "migrations", "2_b"));
    writeFileSync(join(root, "prisma", "migrations", "2_b", "migration.sql"), "select 2");
    expect(migrationsFingerprint(root)).not.toBe(before);
    mkdirSync(join(root, "backups"));
    writeFileSync(join(root, "backups", ".migrations-applied"), before + "\n");
    expect(startupPlan(root).migrate).toBe(true);
  });
  it("generates again when the schema or the Prisma version changed since the stamp", () => {
    const root = tree({ "1_a": "select 1" });
    addClient(root);
    recordClientStamp(root);
    expect(startupPlan(root).generate).toBe(false);
    writeFileSync(join(root, "prisma", "schema.prisma"), "model B {}");
    expect(startupPlan(root).generate).toBe(true);
    recordClientStamp(root);
    writeFileSync(join(root, "node_modules", "prisma", "package.json"), JSON.stringify({ version: "7.1.0" }));
    expect(startupPlan(root).generate).toBe(true);
  });
  it("does not stamp a tree without a generated client", () => {
    const root = tree({});
    expect(recordClientStamp(root)).toBe(false);
    expect(clientFingerprint(root)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("deploy order (static)", () => {
  const read = (file: string) => readFileSync(resolve(file), "utf8").replace(/\r\n/g, "\n");
  const update = read("deploy/update.sh");
  const library = read("deploy/application-update.sh");
  const unit = read("deploy/guilded.service");
  it("prepares and stamps everything before the stop", () => {
    expect(update.indexOf("prepare_application")).toBeLessThan(update.indexOf("systemctl stop guilded"));
    expect(library).toContain('record_prisma_stamp "$source" "$owner"');
    expect(library.indexOf("prepare_companion_bundle \"$source\"")).toBeLessThan(library.indexOf("record_prisma_stamp \"$source\""));
  });
  it("starts through the smart start step, not an unconditional migrate and generate", () => {
    expect(unit).toMatch(/^ExecStartPre=\/usr\/bin\/npm run db:start$/m);
    expect(JSON.parse(read("package.json")).scripts["db:start"]).toBe("node scripts/db-update-start.mjs");
  });
  it("keeps the rollback copy and reports the downtime", () => {
    expect(update).toContain('cp -p /etc/systemd/system/guilded.service "$PREVIOUS_APP/.recovery-service"');
    expect(update).toContain("Downtime: about");
  });
});
