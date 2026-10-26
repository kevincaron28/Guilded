import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { storeConfig } = require("../companion-app/build-msix.cjs");
const identity = { name: "Example.Guilded", publisher: "CN=01234567-0123-0123-0123-012345678901", publisherDisplayName: "Example Publisher" };
it("separates Store and preview outputs from NSIS without changing the license or default installer", () => {
  const config = storeConfig(identity);
  expect(config.directories.output).toBe("../dist/msix-store");
  expect(config).not.toHaveProperty("extraResources"); // inherited once, never concurrent duplicate copies
  expect(config.appx).toMatchObject({ identityName: identity.name, publisher: identity.publisher, publisherDisplayName: identity.publisherDisplayName, languages: ["en-US", "fr-FR"], capabilities: ["runFullTrust"], addAutoLaunchExtension: false });
  expect(config.appx.artifactName).toMatch(/STORE-SUBMISSION\.msix$/);
  expect(storeConfig(identity, true).appx.artifactName).toMatch(/LOCAL-PREVIEW\.msix$/);
  const current = JSON.parse(readFileSync("companion-app/package.json", "utf8"));
  expect(current.build.win.target).toBe("nsis");
  expect(readFileSync("LICENSE", "utf8")).toContain("PolyForm Noncommercial License");
  expect(readFileSync("companion-app/build/store-startup.xml", "utf8")).toContain('Enabled="false"');
});
it("rejects missing identity and prevents a local preview identity being mistaken for a submission", () => {
  for (const input of [null, {}, { ...identity, name: "Bad Name" }, { ...identity, publisher: "" }, { ...identity, publisherDisplayName: "" }, { ...identity, name: "Guilded.Companion.LocalPreview" }]) expect(() => storeConfig(input)).toThrow();
  expect(storeConfig({ ...identity, publisherDisplayName: "A & B <studio>" }).appx.publisherDisplayName).toBe("A &amp; B &lt;studio&gt;");
});
