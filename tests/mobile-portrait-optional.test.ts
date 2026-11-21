import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { markPortraitOptional } = require("../mobile/plugins/with-optional-portrait.js") as {
  markPortraitOptional: (m: { manifest: Record<string, unknown> }) => { manifest: { "uses-feature": { $: Record<string, string> }[] } };
};
const appConfig = require("../mobile/app.config.js") as (arg: { config: Record<string, unknown> }) => { plugins: unknown[] };

describe("mobile portrait feature (Play device reach)", () => {
  it("adds the portrait feature as optional", () => {
    const out = markPortraitOptional({ manifest: {} });
    expect(out.manifest["uses-feature"]).toEqual([{ $: { "android:name": "android.hardware.screen.portrait", "android:required": "false" } }]);
  });

  it("turns an existing required portrait feature into an optional one", () => {
    const out = markPortraitOptional({ manifest: { "uses-feature": [{ $: { "android:name": "android.hardware.screen.portrait", "android:required": "true" } }] } });
    expect(out.manifest["uses-feature"]).toHaveLength(1);
    expect(out.manifest["uses-feature"][0]?.$["android:required"]).toBe("false");
  });

  it("is wired into the app config", () => {
    expect(appConfig({ config: { plugins: ["expo-secure-store"] } }).plugins).toContain("./plugins/with-optional-portrait");
  });
});
