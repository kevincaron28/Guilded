// One command for a Microsoft Store update: npm run store:package
// Builds the Store MSIX for the current package.json version with the saved Store identity, then copies
// it to a Desktop folder with its SHA-256 and the Partner Center steps. Never uploads anything by itself.
// Identity: STORE_IDENTITY env var, else backups/store-identity.json (gitignored; name, publisher, publisherDisplayName).
import { spawnSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const identity = resolve(process.env.STORE_IDENTITY ?? join(root, "backups", "store-identity.json"));
if (!existsSync(identity)) {
  console.error(`No Store identity at ${identity}. Copy it from Partner Center (Product identity) into that file, or set STORE_IDENTITY.`);
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run("npm", ["run", "companion:build"], root);
run("node", ["build-msix.cjs", "--identity", identity], join(root, "companion-app"));

const name = `Guilded.Companion.${version}.x64.STORE-SUBMISSION.msix`;
const built = join(root, "dist", "msix-store", name);
if (!existsSync(built)) { console.error(`Build finished but ${built} is missing.`); process.exit(1); }
const out = join(homedir(), "Desktop", `guilded-store-${version}`);
mkdirSync(out, { recursive: true });
copyFileSync(built, join(out, name));
const sha = await new Promise((done, fail) => {
  const hash = createHash("sha256");
  createReadStream(built).on("data", (d) => hash.update(d)).on("end", () => done(hash.digest("hex"))).on("error", fail);
});
const storeVersion = `${version}.0`;
writeFileSync(join(out, "STORE-STEPS.txt"), [
  `Guilded Companion ${storeVersion} for the Microsoft Store`,
  `Package: ${name}`,
  `SHA-256: ${sha}`,
  "",
  "1. Partner Center > Apps and games > Guilded Companion. Only one submission can be in progress:",
  "   if an older one is still in certification, wait for it (or cancel it) first.",
  "2. Update > Packages > drag this .msix in > remove the older package row if it stays > Save.",
  "3. Store listings: paste the release notes (docs/V*_RELEASE_NOTES.md) into What's new, EN and FR > Save.",
  "4. Submit for certification (publish automatically on pass).",
  "Store versions must always increase; the package is already numbered from package.json.",
  ""
].join("\r\n"));
console.log(`\nStore package ready: ${join(out, name)}\nSHA-256 ${sha}\nSteps: ${join(out, "STORE-STEPS.txt")}`);
