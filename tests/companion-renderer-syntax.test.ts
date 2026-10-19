import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

// The renderer scripts are plain browser files that no other check compiles: a stray quote
// stops the whole companion page. Parsing them here (not running them) catches that.
describe("companion renderer scripts", () => {
  it.each(["companion-app/renderer/app.js", "companion-app/renderer/manage.js", "companion-app/main.cjs", "companion-app/preload.cjs"])("%s parses", (file) => {
    expect(() => new Script(readFileSync(file, "utf8"), { filename: file })).not.toThrow();
  });
});
