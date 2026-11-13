import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

// The site tests all read dist/site. Build it once, here, instead of every test file running
// scripts/build-site.mjs into the same folder at the same time (their writes raced).
export default function setup() {
  rmSync("dist/site", { recursive: true, force: true });
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
}
