// Assemble local materials only. Does not authenticate, upload, sign or install.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const version = JSON.parse(readFileSync("companion-app/package.json", "utf8")).version;
const preview = resolve(`dist/msix-preview/Guilded.Companion.${version}.x64.LOCAL-PREVIEW.msix`);
const verification = JSON.parse(execFileSync(process.execPath, ["scripts/verify-msix.mjs", preview], { encoding: "utf8" }));
if (!verification.preview || !verification.manifestAndSourcesVerified) throw new Error("A verified LOCAL-PREVIEW is required.");
const folder = resolve("dist/msix-submission-kit");
mkdirSync(join(folder, "preview-not-for-upload"), { recursive: true });
rmSync(join(folder, "PRIVACY_DRAFT.md"), { force: true }); // Superseded by the owner-confirmed notice.
const files = [
  ["docs/store-submission/listing.json", "listing.json"],
  ["docs/store-submission/REVIEWER_NOTES.md", "REVIEWER_NOTES.md"],
  ["docs/PRIVACY.md", "PRIVACY.md"],
  ["docs/MICROSOFT_STORE_MSIX.md", "BUILD_AND_SUBMISSION.md"],
  ["LICENSE", "LICENSE.Guilded.txt"],
  [preview, `preview-not-for-upload/Guilded.Companion.${version}.x64.LOCAL-PREVIEW.msix`]
];
for (const [source, destination] of files) copyFileSync(source, join(folder, destination));
writeFileSync(join(folder, "publisher-identity.example.json"), JSON.stringify({ name: "", publisher: "", publisherDisplayName: "" }, null, 2) + "\n");
const pending = [
  "Owner developer enrollment/identity verification (Microsoft sign-in completed)",
  "Reserved product name and exact Partner Center publisher identity",
  "Final Store-identity build from the agreed release commit/version",
  "Publish and verify the prepared privacy-policy URL",
  "Genuine final-app screenshots and completed product/age declarations",
  "Packaged install/upgrade/uninstall and Windows App Certification Kit checks",
  "Upload and Microsoft certification (not submitted yet)"
];
writeFileSync(join(folder, "README-FIRST.md"), `# Guilded Companion submission preparation\n\nPrepared ${new Date().toISOString()} from local version ${version}.\n\n**Not submitted. Not waiting for Microsoft approval.** The included MSIX is a\nverified unsigned LOCAL-PREVIEW with a fictitious publisher identity. Do not\nupload it to Partner Center. No account, certificate or Windows trust was changed.\n\nStart at https://storedeveloper.microsoft.com/ and sign in to the intended\npublisher account. Complete Microsoft identity verification directly with Microsoft,\nnot in chat. After reserving Guilded Companion, copy the three exact product\nidentity fields into your own JSON file; use BUILD_AND_SUBMISSION.md to build\nand inspect the actual Store submission package. Never put passwords or IDs in it.\n\n## Prepared\n\n- Verified preview package, including manifest, source/engine bytes and license.\n- English/French draft listing, capability explanation and reviewer procedure.\n- Prepared bilingual privacy notice with owner-confirmed Discord support contact, and unchanged license.\n\n## Still required\n\n${pending.map(item => `- ${item}`).join("\n")}\n\nMicrosoft controls review timing. This kit cannot guarantee same-day approval.\n`);
const manifest = { createdAt: new Date().toISOString(), version, submitted: false, storeCertified: false, previewVerification: verification, pending,
  files: files.map(([, name]) => { const data = readFileSync(join(folder, name)); return { name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }; }) };
writeFileSync(join(folder, "readiness.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ folder, verifiedPreview: true, submitted: false, pending }, null, 2));
