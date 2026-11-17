// Full git history for the site build's sitemap lastmod. Cloudflare Workers Builds clones shallowly (no file
// history), so every page would fall back to the build date. Deepening is best effort: a failed fetch (no network,
// refused unshallow) keeps the build date fallback and never fails the build.
import { execFileSync as realExec } from "node:child_process";

const FETCH_TIMEOUT_MS = 180_000;

export function isShallowClone(exec = realExec) {
  try { return exec("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true"; }
  catch { return false; }
}

// Returns "not-shallow", "unshallowed", "deepened" or "failed". Never throws.
export function deepenShallowClone(exec = realExec) {
  if (!isShallowClone(exec)) return "not-shallow";
  const options = { stdio: ["ignore", "ignore", "ignore"], timeout: FETCH_TIMEOUT_MS };
  try { exec("git", ["fetch", "--unshallow", "--filter=blob:none"], options); return "unshallowed"; } catch { /* refused: try a bounded deepen */ }
  try { exec("git", ["fetch", "--deepen=500"], options); return "deepened"; } catch { return "failed"; }
}
