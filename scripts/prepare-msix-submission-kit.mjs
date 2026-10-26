// Assemble local materials only. Does not authenticate, upload, sign or install.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const version = JSON.parse(readFileSync("companion-app/package.json", "utf8")).version;
const preview = resolve(`dist/msix-preview/Guilded.Companion.${version}.x64.LOCAL-PREVIEW.msix`);
const verification = JSON.parse(execFileSync(process.execPath, ["scripts/verify-msix.mjs", preview], { encoding: "utf8" }));
if (!verification.preview || !verification.manifestAndSourcesVerified) throw new Error("A verified LOCAL-PREVIEW is required.");
const storePackage = resolve(`dist/msix-store/Guilded.Companion.${version}.x64.STORE-SUBMISSION.msix`);
const storeVerification = existsSync(storePackage) ? JSON.parse(execFileSync(process.execPath, ["scripts/verify-msix.mjs", storePackage], { encoding: "utf8" })) : null;
if (storeVerification && (storeVerification.preview || !storeVerification.manifestAndSourcesVerified)) throw new Error("Store package verification failed.");
const folder = resolve("dist/msix-submission-kit");
mkdirSync(join(folder, "preview-not-for-upload"), { recursive: true });
rmSync(join(folder, "PRIVACY_DRAFT.md"), { force: true }); // Superseded by the owner-confirmed notice.
const files = [
  ["docs/store-submission/listing.json", "listing.json"],
  ["docs/store-submission/iarc-questionnaire.json", "iarc-questionnaire.json"],
  ["docs/store-submission/REVIEWER_NOTES.md", "REVIEWER_NOTES.md"],
  ["docs/store-submission/LOCAL_VALIDATION_2026-10-26.md", "LOCAL_VALIDATION_2026-10-26.md"],
  ["store-review/README.md", "SYNTHETIC_REVIEW_README.md"],
  ["store-review/review-kit.zip", "Guilded-Store-Review.zip"],
  ["docs/PRIVACY.md", "PRIVACY.md"],
  ["docs/MICROSOFT_STORE_MSIX.md", "BUILD_AND_SUBMISSION.md"],
  ["LICENSE", "LICENSE.Guilded.txt"],
  [preview, `preview-not-for-upload/Guilded.Companion.${version}.x64.LOCAL-PREVIEW.msix`]
];
files.push(["docs/store-submission/publisher-identity.json", "publisher-identity.json"], ["docs/STORE_HANDOFF_2026-10-26.md", "CURRENT_STATUS.md"]);
if (storeVerification) files.push([storePackage, `Guilded.Companion.${version}.x64.STORE-SUBMISSION.msix`]);
for (const [source, destination] of files) copyFileSync(source, join(folder, destination));
writeFileSync(join(folder, "publisher-identity.example.json"), JSON.stringify({ name: "", publisher: "", publisherDisplayName: "" }, null, 2) + "\n");
const pending = [
  "Final release-main CI and coordinated publication",
  "Save the verified synthetic reviewer code in Partner Center after owner approval (rebuilt package and current listings are saved)",
  "Store-signed upgrade and connected acceptance; disclose WACK warnings from LOCAL_VALIDATION_2026-10-26.md",
  "Microsoft certification (not submitted yet; see CURRENT_STATUS.md for upload status)"
];
writeFileSync(join(folder, "README-FIRST.md"), `# Guilded Companion submission preparation

Prepared ${new Date().toISOString()} from local version ${version}.

**Not submitted for certification.** Guilded Companion is reserved in Partner Center
as Store ID 9N680XX3QFL9. Submission 1 is a draft. Read CURRENT_STATUS.md for the
observed portal state and remaining blockers.

The unsigned LOCAL-PREVIEW is separately marked **not for upload**.
${storeVerification ? `Upload candidate: Guilded.Companion.${version}.x64.STORE-SUBMISSION.msix. It uses the actual reserved identity and passed source/manifest checks. It has not been installed or certified. Older version files are not this submission candidate.` : "Build the actual Store-identity candidate before uploading; no submission package is included yet."}
The upload candidate is unsigned for Microsoft Store processing. Local preview
installation, temporary certificate trust and cleanup state are documented in
CURRENT_STATUS.md. The project license is unchanged.

## Prepared

- Verified preview, and a verified Store candidate when present.
- English/French listing, capability explanation and reviewer procedure.
- Bilingual privacy notice with owner-confirmed Discord support contact.
- Actual public publisher identity and current handoff.

## Still required

${pending.map(item => `- ${item}`).join("\n")}

Microsoft controls review timing. This kit cannot guarantee same-day approval.
`);
const manifest = { createdAt: new Date().toISOString(), version, submitted: false, storeCertified: false, previewVerification: verification, storeVerification, pending,
  files: files.map(([, name]) => { const data = readFileSync(join(folder, name)); return { name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }; }) };
writeFileSync(join(folder, "readiness.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ folder, verifiedPreview: true, submitted: false, pending }, null, 2));
