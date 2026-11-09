import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner, 7 November 2026: "when we install the companion it uninstalls other versions, so people with
// the Windows Store or another version get it uninstalled before the new installation". The direct
// installer replaces a Microsoft Store install and keeps its settings; the download page says so.
const script = readFileSync("companion-app/replace-store.ps1", "utf8");
const nsis = readFileSync("companion-app/installer.nsh", "utf8");

describe("replace-store.ps1", () => {
  it("looks for this app's Store package only", () => {
    const identity = JSON.parse(readFileSync("docs/store-submission/publisher-identity.json", "utf8")) as { name: string };
    expect(script).toContain(`Get-AppxPackage -Name '${identity.name}'`);
    expect(script).toMatch(/if \(-not \$package\) \{ exit 0 \}/);
  });

  it("copies the settings out before removing the package, and never removes it if copying failed", () => {
    expect(script.indexOf("Copy-Item")).toBeGreaterThan(-1);
    expect(script.indexOf("Copy-Item")).toBeLessThan(script.indexOf("Remove-AppxPackage"));
    expect(script).toMatch(/\} catch \{\s*# Copying failed: do not remove the Store version[^\n]*\n\s*exit 20\s*\}/);
    // From the package's own copy of AppData first, then the plain folder.
    expect(script).toContain('"\\LocalCache\\Roaming\\Guilded Companion Store"');
    for (const name of ["config.secure", "Local State", "language.json"]) expect(script).toContain(`'${name}'`);
  });

  it("never overwrites settings this version already has: the Store ones go beside them", () => {
    expect(script).toMatch(/if \(-not \(Test-Path -LiteralPath \(Join-Path \$target 'config\.secure'\)\)\) \{[\s\S]*?\} else \{[\s\S]*?'store-settings-backup'[\s\S]*?\$result = 11/);
  });

  it("answers with the exit codes the installer words", () => {
    for (const code of ["exit 0", "exit 20", "exit $result"]) expect(script).toContain(code);
    expect(script).toContain("$result = 10");
  });
});

describe("the installer", () => {
  it("runs it after closing the companion, before copying files, and only when installing", () => {
    const check = nsis.slice(nsis.indexOf("!macro customCheckAppRunning"), nsis.indexOf("!macroend", nsis.indexOf("!macro customCheckAppRunning")));
    expect(check.trimEnd().endsWith("!insertmacro GUILDED_REPLACE_STORE")).toBe(true);
    const replace = nsis.slice(nsis.indexOf("!macro GUILDED_REPLACE_STORE"));
    expect(replace).toMatch(/!ifndef BUILD_UNINSTALLER[\s\S]*File "\/oname=\$PLUGINSDIR\\guilded-replace-store\.ps1" "\$\{PROJECT_DIR\}\\replace-store\.ps1"/);
    expect(replace).toContain('-ExecutionPolicy Bypass -File "$PLUGINSDIR\\guilded-replace-store.ps1"');
  });

  it("says plainly what happened, in English and French, without stopping a silent update", () => {
    const replace = nsis.slice(nsis.indexOf("!macro GUILDED_REPLACE_STORE"));
    expect(replace).toContain("The Microsoft Store version of Guilded Companion was replaced by this one, which updates itself. Your settings and Discord link are kept.");
    expect(replace).toContain("La version Microsoft Store de Guilded Companion a été remplacée par celle-ci");
    expect(replace).toContain("remove it in Windows Settings > Apps so only one is left.");
    for (const box of replace.match(/MessageBox [^\n]*/g) ?? []) expect(box, box).toContain("/SD IDOK");
    expect(replace).toContain("${if} $LANGUAGE == 1036");
  });

  it("is saved with a byte-order mark so NSIS reads the French accents right", () => {
    const bytes = readFileSync("companion-app/installer.nsh");
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("the download page", () => {
  const en = readFileSync("site/pages/companion.md", "utf8");
  const fr = readFileSync("site/pages/companion.fr.md", "utf8");

  it("leads with the plug-and-play download and three plain steps", () => {
    expect(en.indexOf("Download for Windows")).toBeLessThan(en.indexOf("apps.microsoft.com"));
    expect(en).toContain("## Sync with Discord in 3 steps");
    expect(en).toContain("There is nothing to choose: it installs and opens the companion by itself.");
    expect(en).toContain("The companion finds World of Warcraft on any drive, installs or updates the Guilded addon, and picks your guild's Discord server from your in-game guild");
    expect(fr).toContain("## Synchroniser avec Discord en 3 étapes");
    expect(fr).toContain("Il n’y a rien à choisir : il s’installe et ouvre le compagnon tout seul.");
  });

  it("says the installer replaces a Store install and keeps the settings", () => {
    expect(en).toContain("This installer replaces it and keeps your settings and Discord link, so you only have one.");
    expect(fr).toContain("Cet installateur le remplace en gardant vos réglages et votre liaison Discord");
  });
});
