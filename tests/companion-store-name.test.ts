import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// 13 November 2026: only the Microsoft Store listing is renamed (policy 10.1.1.1 refused a name that
// contains another service's title). The MSIX gets the new display name; every identifier, the settings
// folders and the website installer's name stay as they were.
const require = createRequire(import.meta.url);
const { STORE_DISPLAY_NAME } = require("../companion-app/store-name.cjs");
const { storeConfig } = require("../companion-app/build-msix.cjs");
const identity = JSON.parse(readFileSync("docs/store-submission/publisher-identity.json", "utf8"));
const pkg = JSON.parse(readFileSync("companion-app/package.json", "utf8"));

describe("the Store display name", () => {
  it("is one constant with no other product's title", () => {
    expect(STORE_DISPLAY_NAME).toBe("Guild Sync Companion");
    for (const forbidden of [/guilded/i, /wow/i, /world of warcraft/i, /discord/i]) expect(STORE_DISPLAY_NAME).not.toMatch(forbidden);
  });

  it("is the MSIX display name while identity, publisher, application id and file name are unchanged", () => {
    const store = storeConfig(identity, false).appx;
    expect(store.displayName).toBe(STORE_DISPLAY_NAME);
    expect(storeConfig(identity, true).appx.displayName).toBe(`${STORE_DISPLAY_NAME} Local Preview`);
    expect(store).toMatchObject({ identityName: "Kcaron.GuildedCompanion", applicationId: "GuildedCompanion", publisherDisplayName: "Kcaron", artifactName: `Guilded.Companion.${pkg.version}.x64.STORE-SUBMISSION.msix` });
    expect(store.publisher).toBe(identity.publisher);
  });

  it("leaves the website build and the settings folders alone", () => {
    expect(pkg.productName).toBe("Guilded Companion");
    expect(pkg.build.productName).toBe("Guilded Companion");
    expect(pkg.build.nsis.shortcutName).toBe("Guilded Companion");
    expect(pkg.build.appId).toBe("com.guilded.companion");
    expect(readFileSync("companion-app/main.cjs", "utf8")).toContain('"Guilded Companion Store"');
    expect(readFileSync("companion-app/store-migrate.cjs", "utf8")).toContain('["Guilded Companion Store", "Guilded Companion"]');
    expect(readFileSync("companion-app/update-check.cjs", "utf8")).toContain("Guilded.Companion.Setup.exe");
  });

  it("is what the repo's Store listing and the member steps say to search for", () => {
    const listing = JSON.parse(readFileSync("docs/store-submission/listing.json", "utf8")) as { productName: string };
    expect(listing.productName).toBe(STORE_DISPLAY_NAME);
    for (const file of ["site/pages/companion.md", "site/pages/companion.fr.md", "src/commands/help.ts", "addon/Guilded/Util.lua", "addon/GuildedDungeons/Shared/Util.lua", "addon/GuildedDungeons/README.md"]) {
      expect(readFileSync(file, "utf8"), file).toContain(STORE_DISPLAY_NAME);
    }
  });
});
