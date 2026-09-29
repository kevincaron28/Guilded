// Builds and checks only; never starts a bot or touches production.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
for (const file of ["companion-app/package.json", "package-lock.json", "companion-app/package-lock.json"]) {
  if (JSON.parse(readFileSync(file, "utf8")).version !== version) throw new Error(`Version mismatch: ${file}`);
}
if (!readFileSync("addon/Guilded/Guilded.toc", "utf8").includes(`## Version: ${version}`)) throw new Error("Addon version mismatch.");
const env = { ...process.env, DISCORD_TOKEN: "placeholder", DISCORD_CLIENT_ID: "123", DISCORD_GUILD_ID: "456", DATABASE_URL: "postgresql://u:p@localhost:5432/guilded_release_test" };
function run(command, args) {
  const r = spawnSync(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
  if (r.error || r.status !== 0) process.exit(r.status || 1);
}
run("npm", ["run", "prisma:generate"]);
for (const task of ["build", "test", "lint"]) run("npm", ["run", task]);
run("node", ["addon/Guilded/validate-addon.mjs"]);
run("npm", ["audit", "--audit-level=high"]);
run("npm", ["audit", "--prefix", "companion-app", "--audit-level=high"]);
run("npm", ["run", "addon:zip"]);
if (process.platform === "win32") run("npm", ["run", "dist", "--prefix", "companion-app"]);
else console.log("Windows installer: build with npm run release:prepare on Windows, or download the CI artifact.");
console.log("Build checks complete. Real-client tests and deployment remain: docs/V5_0_RELEASE_HANDOFF.md");
