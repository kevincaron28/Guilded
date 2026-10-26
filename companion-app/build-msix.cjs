// Store packaging is separate from the public NSIS release. No upload/signing.
const fs = require("node:fs");
const path = require("node:path");
const metadata = require("./package.json");
const xml = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function storeConfig(identity, preview = false) {
  if (!identity || !/^[A-Za-z0-9.-]{3,50}$/.test(identity.name ?? "") || typeof identity.publisher !== "string" || !identity.publisher.startsWith("CN=")
    || identity.publisher.length > 250 || /[\r\n\x00]/.test(identity.publisher) || typeof identity.publisherDisplayName !== "string" || !identity.publisherDisplayName.trim()
    || identity.publisherDisplayName.length > 100 || /[\r\n\x00]/.test(identity.publisherDisplayName)) throw new Error("Provide the exact Store name, publisher (CN=...) and publisherDisplayName in the identity JSON.");
  if (!preview && (identity.name.includes("LocalPreview") || identity.publisher.includes("LocalPreview"))) throw new Error("Preview identity cannot be used for a Store submission build.");
  // electron-builder loads package.json itself. Repeating extraResources here
  // concatenates duplicate copy operations and races on the license/engine files.
  return {
    directories: { ...metadata.build.directories, output: preview ? "../dist/msix-preview" : "../dist/msix-store" },
    extraMetadata: { guildedDistribution: "microsoft-store", guildedStorePreview: preview },
    win: { ...metadata.build.win, target: ["appx"], signExecutable: false },
    appx: { identityName: identity.name, publisher: xml(identity.publisher), publisherDisplayName: xml(identity.publisherDisplayName),
      applicationId: "GuildedCompanion", displayName: preview ? "Guilded Companion Local Preview" : "Guilded Companion",
      languages: ["en-US", "fr-FR"], minVersion: "10.0.19041.0", maxVersionTested: "10.0.22621.0",
      capabilities: ["runFullTrust"], addAutoLaunchExtension: false, customExtensionsPath: "build/store-startup.xml",
      artifactName: `Guilded.Companion.${metadata.version}.x64.${preview ? "LOCAL-PREVIEW" : "STORE-SUBMISSION"}.msix` }
  };
}
async function main() {
  const { build, Platform, Arch } = require("electron-builder");
  const args = process.argv.slice(2), preview = args.includes("--preview"), identityIndex = args.indexOf("--identity");
  if (preview && identityIndex >= 0) throw new Error("Choose either --preview or --identity, not both.");
  if (!preview && (identityIndex < 0 || !args[identityIndex + 1])) throw new Error("Use --preview for a local unsigned review build, or --identity path/to/store-identity.json for Partner Center.");
  const identity = preview ? { name: "Guilded.Companion.LocalPreview", publisher: "CN=Guilded LocalPreview", publisherDisplayName: "Guilded Local Preview" }
    : JSON.parse(fs.readFileSync(path.resolve(args[identityIndex + 1]), "utf8"));
  const artifacts = await build({ projectDir: __dirname, targets: Platform.WINDOWS.createTarget(["appx"], Arch.x64), config: storeConfig(identity, preview), publish: "never" });
  console.log(preview ? "Unsigned local review package only; not a Store identity or public installer." : "Unsigned submission package prepared. Partner Center certification and signing remain required.");
  console.log(artifacts.join("\n"));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { storeConfig };
