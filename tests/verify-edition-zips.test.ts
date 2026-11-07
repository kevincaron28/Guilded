import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { verifyEditionZip } from "../scripts/verify-edition-zips.mjs";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function zip(name: string, edition: string, api: number, stamped = edition) {
  const dir = mkdtempSync(join(tmpdir(), "guilded-zip-")); dirs.push(dir);
  const enc = (text: string) => new TextEncoder().encode(text);
  const file = join(dir, name);
  writeFileSync(file, zipSync({
    "Guilded/Guilded.toc": enc(`## Interface: ${api}\n## X-Guilded-Edition: ${edition}\n## Version: 8.4.2\n`),
    "Guilded/EDITION.txt": enc(`Guilded 8.4.2\nEdition: ${stamped}\nInterface: ${api}\n`)
  }));
  return file;
}

describe("verifyEditionZip", () => {
  it("accepts a package whose contents match its name", () => {
    expect(verifyEditionZip(zip("Guilded-v8.4.2-forever.zip", "forever", 16001))).toEqual([]);
  });

  it("catches the TBC build uploaded in the Forever slot", () => {
    const problems = verifyEditionZip(zip("Guilded-v8.4.2-forever.zip", "classic-tbc", 20506));
    expect(problems.join("\n")).toContain("not a single forever interface");
    expect(problems.join("\n")).toContain("X-Guilded-Edition is classic-tbc, expected forever");
  });

  it("catches a stale stamp and an unknown package name", () => {
    expect(verifyEditionZip(zip("Guilded-v8.4.2-forever.zip", "forever", 16001, "retail")).join("\n")).toContain("EDITION.txt does not say Edition: forever");
    // Guilded publishes WoW Forever only: another edition's package name is not a Guilded package.
    expect(verifyEditionZip(zip("Guilded-v8.4.2-retail.zip", "retail", 120105))[0]).toContain("not an edition package name");
    expect(verifyEditionZip(zip("Guilded.zip", "forever", 16001))[0]).toContain("not an edition package name");
  });
});
