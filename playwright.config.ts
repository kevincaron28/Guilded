import { defineConfig } from "@playwright/test";

// Visual regression for the static website (docs/plans/VISUAL_REGRESSION.md, R2.7). Not part of `npm test`: it needs a
// browser and a built site, and baselines are made on the Linux CI runner so fonts and anti-aliasing match.
// Run: npm run site:build && npm run visual   |   refresh baselines: npm run visual:update (see docs/VISUAL_REGRESSION.md)
export default defineConfig({
  testDir: "visual",
  testMatch: "**/*.visual.ts",
  outputDir: "visual/results",
  // One baseline per project (viewport) and screenshot name, the same on every OS; only Linux baselines are committed.
  snapshotPathTemplate: "{testDir}/baselines/{projectName}/{arg}{ext}",
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 2,
  reporter: process.env["CI"] ? [["list"], ["html", { outputFolder: "visual/report", open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // `threshold` is the per-pixel colour distance (0-1) below which a pixel counts as equal: it absorbs anti-aliasing.
      // `maxDiffPixelRatio` is how many differing pixels the whole page may have: a changed heading or section is above
      // it, font smoothing noise is below it.
      threshold: 0.2,
      maxDiffPixelRatio: 0.002
    }
  },
  use: { baseURL: "http://127.0.0.1:8800", locale: "en-CA", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", deviceScaleFactor: 1 },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } }
  ],
  webServer: { command: "node scripts/preview-site.mjs", url: "http://127.0.0.1:8800/", reuseExistingServer: !process.env["CI"], timeout: 30_000 }
});
