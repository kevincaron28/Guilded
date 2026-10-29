import { execFileSync } from "node:child_process";

// Windows can report a copied LF file as modified even when its Git-normalized
// content equals HEAD. Compare content, while retaining staged and untracked edits.
export function releaseSource(root = ".") {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const paths = output => output.split("\0").filter(Boolean);
  const changedPaths = paths(git("diff", "--name-only", "-z", "HEAD", "--"));
  const untrackedPaths = paths(git("ls-files", "--others", "--exclude-standard", "-z"));
  return { sourceCommit: git("rev-parse", "HEAD").trim(), sourceDirty: Boolean(changedPaths.length || untrackedPaths.length), changedPaths, untrackedPaths };
}
