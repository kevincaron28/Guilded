import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { releaseSource } from "../scripts/release-source.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("guilded-release-source-")) throw new Error("Unsafe fixture path");
  rmSync(root, { recursive: true, force: true });
} });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "guilded-release-source-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init"); git("config", "core.autocrlf", "true"); git("config", "core.safecrlf", "false");
  git("config", "user.name", "Release test"); git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "copy.lua"), "return 1\r\n"); writeFileSync(join(root, ".gitignore"), "generated.log\r\n");
  git("add", "."); git("commit", "-m", "fixture");
  return { root, git };
}
describe("release source provenance", () => {
  it("accepts Git-equivalent LF copies after Windows CRLF checkout without rewriting the index", () => {
    const { root, git } = fixture(); const indexTree = git("write-tree");
    writeFileSync(join(root, "copy.lua"), "return 1\n");
    expect(releaseSource(root)).toMatchObject({ sourceCommit: git("rev-parse", "HEAD"), sourceDirty: false, changedPaths: [], untrackedPaths: [] });
    expect(git("write-tree")).toBe(indexTree);
  });
  it.each([false, true])("detects real changed content, staged=%s", staged => {
    const { root, git } = fixture(); writeFileSync(join(root, "copy.lua"), "return 2\n");
    if (staged) git("add", "copy.lua");
    expect(releaseSource(root)).toMatchObject({ sourceDirty: true, changedPaths: ["copy.lua"] });
  });
  it("retains untracked source detection while excluding ignored build output", () => {
    const { root } = fixture(); writeFileSync(join(root, "generated.log"), "build output");
    expect(releaseSource(root).sourceDirty).toBe(false);
    writeFileSync(join(root, "new.lua"), "return 3\n");
    expect(releaseSource(root)).toMatchObject({ sourceDirty: true, untrackedPaths: ["new.lua"] });
  });
});
