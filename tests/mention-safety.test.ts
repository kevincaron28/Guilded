import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("global mention safety", () => {
  it("the Discord client only parses user mentions by default and never pings on replies", () => {
    expect(source("src/main.ts")).toMatch(/allowedMentions:\s*\{\s*parse:\s*\["users"\],\s*repliedUser:\s*false\s*\}/);
  });

  it("the places that ping a role opt in with explicit role ids", () => {
    expect(source("src/commands/dungeon-group.ts")).toMatch(/allowedMentions:\s*\{\s*roles:\s*ping\s*\?\s*\[ping\]\s*:\s*\[\]/);
    expect(source("src/services/invite-notify.ts")).toMatch(/allowedMentions:\s*\{\s*parse:\s*\[\],\s*roles:\s*\[role\.id\]/);
  });
});
