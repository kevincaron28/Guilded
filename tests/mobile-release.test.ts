import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
afterEach(() => vi.unstubAllEnvs());

describe("mobile release links", () => {
  it("keeps release versions, runtime and packaging consistent", () => {
    const config = JSON.parse(readFileSync("mobile/app.json", "utf8")).expo;
    const pkg = JSON.parse(readFileSync("mobile/package.json", "utf8"));
    const eas = JSON.parse(readFileSync("mobile/eas.json", "utf8"));
    expect(config.version).toBe("0.6.0");
    expect(pkg.version).toBe(config.version);
    expect(config.android.versionCode).toBe(3);
    expect(config.ios.buildNumber).toBe("3");
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(config.updates.checkAutomatically).toBe("NEVER");
    expect(eas.build.production.android.buildType).toBe("app-bundle");
    expect(eas.build.preview.android.buildType).toBe("apk");
    // EAS keeps the Android versionCode (remote source) and raises it on every store build; app.json only seeds it.
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production.autoIncrement).toBe(true);
    // Play asks new apps for API level 36 (Android 16) since 31 August 2026; pinned so an SDK change cannot move it.
    expect(config.plugins).toContainEqual(["expo-build-properties", { android: { targetSdkVersion: 36 } }]);
    const workflow = readFileSync(".github/workflows/mobile-update.yml", "utf8");
    expect(workflow).toMatch(/npx eas-cli@\d+\.\d+\.\d+ update/);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(eas.build["production-no-push"]).toEqual({ extends: "production", env: { GUILDED_MOBILE_NO_PUSH: "1" } });
  });
  it("keeps Guilded Clash out of the app unless the build flag asks for it", () => {
    // The game is on hold (owner, 14 November 2026): hidden, not deleted. Only me/MeTab.tsx may reach it, through
    // clash/entry, which Metro swaps for an empty module unless the flag is set.
    const sources = readdirSync("mobile/src", { recursive: true, encoding: "utf8" }).map(file => file.replace(/\\/g, "/"))
      .filter(file => /\.tsx?$/.test(file) && !file.startsWith("clash/") && !file.endsWith(".test.ts"));
    for (const file of [...sources.map(file => `mobile/src/${file}`), "mobile/App.tsx"]) {
      const text = readFileSync(file, "utf8");
      expect(text.replace('import * as clashEntry from "../clash/entry";', ""), file).not.toMatch(/["'][^"']*\/clash\//);
    }
    const tab = readFileSync("mobile/src/me/MeTab.tsx", "utf8");
    expect(tab).toContain('process.env.EXPO_PUBLIC_GUILDED_CLASH === "1" && typeof clashEntry.ClashHome === "function" ? clashEntry : null');
    const metro = readFileSync("mobile/metro.config.js", "utf8");
    expect(metro).toContain("process.env.EXPO_PUBLIC_GUILDED_CLASH === '1'");
    expect(metro).toContain("return { type: 'empty' }");
    expect(readFileSync(".github/workflows/quality.yml", "utf8") + readFileSync(".github/workflows/mobile-update.yml", "utf8")).not.toContain("EXPO_PUBLIC_GUILDED_CLASH");
    expect(JSON.stringify(JSON.parse(readFileSync("mobile/eas.json", "utf8")))).not.toContain("EXPO_PUBLIC_GUILDED_CLASH");
    expect(existsSync("mobile/src/clash/ClashHome.tsx")).toBe(true);
  });
  it("opens no account page of the website except the sign-in approval page", () => {
    // The website retired its account pages (/me/...). The app keeps only /me/companion, the page a member approves
    // a sign-in on, and deletes data through the API. Guilded Clash is out of the build, so its files are not read.
    const sources = readdirSync("mobile/src", { recursive: true, encoding: "utf8" }).map(file => file.replace(/\\/g, "/"))
      .filter(file => /\.tsx?$/.test(file) && !file.startsWith("clash/") && !file.endsWith(".test.ts"));
    for (const file of [...sources.map(file => `mobile/src/${file}`), "mobile/App.tsx"]) {
      const text = readFileSync(file, "utf8").replaceAll("/me/companion", "");
      // A web path, not a folder of the app: "/me" that does not follow a letter or a dot (as in "./src/me/MeTab").
      expect(text, file).not.toMatch(/(?<![\w.])\/me(?:\/|["'`?])|%2Fme|\/auth\/login/);
    }
    expect(readFileSync("mobile/src/api.ts", "utf8")).toContain('"/api/v1/companion/delete-my-data"');
    expect(readFileSync("mobile/src/links.ts", "utf8")).toContain("DELETE_INFO_URL");
    // A sign-in the server no longer knows (401) clears the phone too, and a double tap sends one request.
    expect(readFileSync("mobile/src/useGuild.ts", "utf8")).toContain('if (outcome === "unavailable") return outcome;');
    const tab = readFileSync("mobile/src/me/MeTab.tsx", "utf8");
    expect(tab).toContain("if (sending.current) return;");
    expect(tab).toContain("sending.current = false;");
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
});
