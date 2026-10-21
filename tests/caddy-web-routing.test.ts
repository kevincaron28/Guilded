import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isWebPath } from "../src/services/web-app.js";

// The Worker and Node router can both support a page while the origin proxy
// still returns 404. Check the actual deployed Caddy handle contract as well.
const config = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
const handles = [...config.matchAll(/handle (\/\S+) \{\s*reverse_proxy 127\.0\.0\.1:8787/g)].map(match => match[1]!);
const reachesBot = (path: string) => handles.some(handle => handle.endsWith("*") ? path.startsWith(handle.slice(0, -1)) : path === handle);

describe("origin proxy contract for bot-rendered website pages", () => {
  it.each(["/players", "/players/", "/players/c111111111111111111111111", "/recruitment", "/recruitment/", "/recruitment/apply/fixture", "/me/", "/me/profile", "/me/companion", "/auth/login", "/auth/callback", "/auth/logout", "/leaderboards", "/leaderboards/", "/leaderboards/character/Fixture-Realm"])("forwards supported %s to the bot", path => {
    expect(isWebPath(path)).toBe(true);
    expect(reachesBot(path)).toBe(true);
  });
  it.each(["/owner/private", "/unknown", "/players-private"])("preserves the origin fallback for %s", path => {
    expect(reachesBot(path)).toBe(false);
  });
});
