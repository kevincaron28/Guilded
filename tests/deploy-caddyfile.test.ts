import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// No Caddy here to validate the file, so check the parts the server depends on: credential
// headers never reach the journal, and deploy/update.sh can still find and re-apply the file.
// Windows checkouts may have CRLF line endings; the server has LF.
const caddyfile = readFileSync(resolve("deploy/Caddyfile"), "utf8").replace(/\r\n/g, "\n");
const update = readFileSync(resolve("deploy/update.sh"), "utf8");
const SITE_LINE = /^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+ \{$/gm;

describe("deploy/Caddyfile", () => {
  it("drops credential headers from every log entry", () => {
    const global = caddyfile.match(/^\{\n([\s\S]*?)^\}$/m)?.[1] ?? "";
    expect(global).toMatch(/log default \{/);
    expect(global).toMatch(/format filter \{/);
    for (const header of ["X-Companion-Credential", "Authorization", "Cookie"]) {
      expect(global).toContain(`request>headers>${header} delete`);
    }
  });

  it("puts the global options before the site", () => {
    expect(caddyfile.indexOf("\n{\n")).toBeGreaterThan(-1);
    expect(caddyfile.indexOf("\n{\n")).toBeLessThan(caddyfile.indexOf("YOUR_HOSTNAME {"));
  });

  it("stays recognisable to deploy/update.sh once installed", () => {
    const marker = "installed by deploy/setup-server.sh";
    expect(caddyfile.split("\n")[0]).toContain(marker);
    expect(caddyfile.split(marker)).toHaveLength(2);
    expect(update).toContain(`grep -q '${marker}'`);
    const installed = caddyfile.replace(/YOUR_HOSTNAME/g, "guild.example.org");
    expect(installed.match(SITE_LINE)).toEqual(["guild.example.org {"]);
  });

  // 7.0.0 shipped with these routes in the Worker but not here, so every page was Caddy's 404.
  it("proxies every bot page the website Worker forwards", () => {
    for (const path of ["/auth/login", "/auth/callback", "/auth/logout", "/recruitment", "/recruitment/apply/x", "/me", "/me/", "/leaderboards", "/leaderboards/character/A-B", "/g/quebec-gold/", "/companion/", "/api/v1/standings", "/health"]) {
      const handled = [...caddyfile.matchAll(/^\thandle (\S+) \{\n\t\treverse_proxy 127\.0\.0\.1:8787$/gm)].map((m) => m[1]!)
        .some((pattern) => pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
      expect(handled, path).toBe(true);
    }
  });
});
