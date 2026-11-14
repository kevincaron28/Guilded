import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";
import { writeMobileAssociations } from "../scripts/mobile-associations.mjs";
const require = createRequire(import.meta.url);
afterEach(() => vi.unstubAllEnvs());

describe("mobile release links", () => {
  it("keeps release versions, runtime and packaging consistent", () => {
    const config = JSON.parse(readFileSync("mobile/app.json", "utf8")).expo;
    const pkg = JSON.parse(readFileSync("mobile/package.json", "utf8"));
    const eas = JSON.parse(readFileSync("mobile/eas.json", "utf8"));
    expect(config.version).toBe("0.3.0");
    expect(pkg.version).toBe(config.version);
    expect(config.android.versionCode).toBe(3);
    expect(config.ios.buildNumber).toBe("3");
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(config.updates.checkAutomatically).toBe("NEVER");
    expect(eas.build.production.android.buildType).toBe("app-bundle");
    expect(eas.build.preview.android.buildType).toBe("apk");
    expect(eas.build["production-no-push"]).toEqual({ extends: "production", env: { GUILDED_MOBILE_NO_PUSH: "1" } });
  });
  it("keeps Guilded Clash out of the app unless the build flag asks for it", () => {
    // The game is on hold (owner, 14 November 2026): hidden, not deleted. Only me/MeTab.tsx may reach it,
    // through a require guarded by the flag, so a store bundle carries neither its code nor its card art.
    const sources = readdirSync("mobile/src", { recursive: true, encoding: "utf8" }).map(file => file.replace(/\\/g, "/"))
      .filter(file => /\.tsx?$/.test(file) && !file.startsWith("clash/") && !file.endsWith(".test.ts"));
    for (const file of [...sources.map(file => `mobile/src/${file}`), "mobile/App.tsx"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*\/clash\//);
      if (!file.endsWith("me/MeTab.tsx")) expect(text, file).not.toMatch(/require\(["'][^"']*clash/);
    }
    const tab = readFileSync("mobile/src/me/MeTab.tsx", "utf8");
    expect(tab).toContain('process.env.EXPO_PUBLIC_GUILDED_CLASH === "1" ? (require("../clash/entry")');
    expect(JSON.stringify(JSON.parse(readFileSync("mobile/eas.json", "utf8")))).not.toContain("EXPO_PUBLIC_GUILDED_CLASH");
    expect(existsSync("mobile/src/clash/ClashHome.tsx")).toBe(true);
  });
  it("opens app links from the current site and the older address", () => {
    const config = JSON.parse(readFileSync("mobile/app.json", "utf8")).expo;
    expect(config.android.intentFilters[0].data.map((row: { host: string }) => row.host)).toEqual(["guildedwow.com", "guilded.kcaron.top"]);
    expect(config.ios.associatedDomains).toEqual(["applinks:guildedwow.com", "applinks:guilded.kcaron.top"]);
  });
  it("fails closed for native builds without verified project or Android Firebase file", () => {
    const configure = require("../mobile/app.config.js");
    const config = { ...JSON.parse(readFileSync("mobile/app.json", "utf8")).expo, extra: undefined };
    vi.stubEnv("EAS_PROJECT_ID", "");
    vi.stubEnv("GOOGLE_SERVICES_JSON", "");
    vi.stubEnv("EAS_BUILD", "");
    expect(configure({ config }).updates.enabled).toBe(false);
    vi.stubEnv("EAS_BUILD", "true");
    expect(() => configure({ config })).toThrow("EAS_PROJECT_ID");
    vi.stubEnv("EAS_PROJECT_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("EAS_BUILD_PLATFORM", "android");
    vi.stubEnv("EAS_BUILD_PROFILE", "production");
    expect(() => configure({ config })).toThrow("GOOGLE_SERVICES_JSON");
    vi.stubEnv("GUILDED_MOBILE_NO_PUSH", "1");
    expect(configure({ config }).android.googleServicesFile).toBeUndefined();
    vi.stubEnv("GUILDED_MOBILE_NO_PUSH", "");
    vi.stubEnv("EAS_BUILD_PLATFORM", "ios");
    expect(configure({ config }).updates.url).toBe("https://u.expo.dev/11111111-1111-4111-8111-111111111111");
  });
  it("never invents association identities and removes stale output", () => {
    const out = mkdtempSync(join(tmpdir(), "guilded-associations-"));
    try {
      expect(writeMobileAssociations(out, {})).toEqual({ android: false, ios: false });
      expect(existsSync(join(out, ".well-known/assetlinks.json"))).toBe(false);
      const fingerprint = Array(32).fill("AB").join(":");
      writeMobileAssociations(out, { MOBILE_ANDROID_SHA256_FINGERPRINTS: fingerprint, MOBILE_APPLE_TEAM_ID: "TESTTEAM01" });
      const android = JSON.parse(readFileSync(join(out, ".well-known/assetlinks.json"), "utf8"));
      expect(android[0].target.sha256_cert_fingerprints).toEqual([fingerprint]);
      const ios = JSON.parse(readFileSync(join(out, ".well-known/apple-app-site-association"), "utf8"));
      expect(ios.applinks.details[0]).toEqual({ appID: "TESTTEAM01.top.kcaron.guilded", paths: ["/app/*"] });
      expect(() => writeMobileAssociations(out, { MOBILE_APPLE_TEAM_ID: "invalid" })).toThrow();
      writeMobileAssociations(out, {});
      expect(existsSync(join(out, ".well-known/assetlinks.json"))).toBe(false);
      expect(existsSync(join(out, ".well-known/apple-app-site-association"))).toBe(false);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it("serves exact JSON associations and rejects asset redirects", async () => {
    for (const path of ["assetlinks.json", "apple-app-site-association"]) {
      const url = `https://guilded.kcaron.top/.well-known/${path}`;
      const env = { ASSETS: { fetch: async () => Response.json({ verified: true }) } };
      const response = await worker.fetch(new Request(url), env);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual({ verified: true });
      expect(await (await worker.fetch(new Request(url, { method: "HEAD" }), env)).text()).toBe("");
      expect((await worker.fetch(new Request(url, { method: "POST" }), env)).status).toBe(405);
      const redirect = { ASSETS: { fetch: async () => Response.redirect(url + "/", 301) } };
      expect((await worker.fetch(new Request(url), redirect)).status).toBe(404);
    }
  });

  it("offers browser fallbacks without accepting arbitrary redirect URLs", async () => {
    const env = { ASSETS: { fetch: async () => new Response("unused") } };
    const response = await worker.fetch(new Request("https://guilded.kcaron.top/app/raids?lang=fr&return=https://evil.example"), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/me/calendar?lang=fr");
    const unknown = await worker.fetch(new Request("https://guilded.kcaron.top/app/https://evil.example"), env);
    expect(unknown.headers.get("location")).toBe("/me/");
  });
});
