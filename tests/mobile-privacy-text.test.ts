import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { privacyModule } from "../mobile/scripts/gen-privacy.mjs";

// Phone app 0.7.0 shows the privacy policy inside the app. It must be the published one: regenerate with
// `node mobile/scripts/gen-privacy.mjs` after editing docs/PRIVACY.md.
describe("the phone app's privacy policy", () => {
  it("matches docs/PRIVACY.md", () => {
    const expected = (privacyModule as (markdown: string) => string)(readFileSync("docs/PRIVACY.md", "utf8"));
    expect(readFileSync("mobile/src/privacyText.ts", "utf8").replace(/\r\n/g, "\n")).toBe(expected);
  });
});
