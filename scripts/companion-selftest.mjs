// Launches the BUILT companion (win-unpacked) with --self-test and fails unless it reports ok.
// Run after `npm run dist --prefix companion-app` (and, for the Store package, `npm --prefix companion-app run msix:store`).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const candidates = ["dist/companion/win-unpacked/Guilded Companion.exe", "dist/msix-store/win-unpacked/Guilded Companion.exe", "dist/msix-preview/win-unpacked/Guilded Companion.exe"].map((p) => resolve(p));
const found = candidates.filter((p) => existsSync(p));
if (!found.length) { console.error(`No built companion found. Build it first (npm run dist --prefix companion-app). Looked for:\n${candidates.join("\n")}`); process.exit(1); }

let failed = false;
for (const exe of found) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(exe, ["--self-test"], { env, encoding: "utf8", timeout: 60_000, windowsHide: true });
  const line = String(run.stdout ?? "").split(/\r?\n/).find((l) => l.includes('"selfTest"'));
  let ok = false;
  try { ok = run.status === 0 && JSON.parse(line ?? "").selfTest === "ok"; } catch { /* not ok */ }
  if (ok) console.log(`PASS ${exe}\n  ${line}`);
  else {
    failed = true;
    console.error(`FAIL ${exe} (exit ${run.status}${run.error ? `, ${run.error.message}` : ""})\n${run.stdout ?? ""}${run.stderr ?? ""}`);
  }
}
process.exit(failed ? 1 : 0);
