import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// pg_advisory_xact_lock returns void. Prisma's $queryRaw reads rows and fails on a void column (P2010), which only a real
// database shows: fakes accept anything. Every advisory lock must go through $executeRaw.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "generated") return [];
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("advisory locks", () => {
  it("are never taken with $queryRaw", () => {
    const bad = files("src").filter((path) => /\$queryRaw(?:Unsafe)?\s*[`(][^;]*pg_advisory/s.test(readFileSync(path, "utf8")));
    expect(bad).toEqual([]);
  });
});
