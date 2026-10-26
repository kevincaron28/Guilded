# Microsoft Store preparation — 26 October 2026

The owner retained the existing license and authorized progressing toward Store
submission. The owner completed developer access, and **Guilded Companion** is now
reserved as MSIX app **9N680XX3QFL9**. **Submission 1** (`1152921505702234586`) is a
draft, not submitted for certification. No package has uploaded yet.

Partner Center: https://partner.microsoft.com/en-us/dashboard/products/9N680XX3QFL9/overview

## Portal progress

- Pricing and availability: Complete; base price 0 (free), public worldwide markets.
- Properties: Complete; Utilities + tools, personal-information use disclosed,
  project website and Discord support link, full bilingual privacy notice provided
  as text directly in Partner Center. OneDrive data-backup declaration disabled
  because Store credentials use Windows-user protection.
- Packages: Incomplete; Windows desktop selected, future device-family expansion
  disabled. The in-app browser's browse-files link did not open a file picker
  after click and keyboard activation. No upload or package validation is claimed.
- English (US) and French (France): descriptions, short descriptions, initial
  feature, copyright, unchanged license link and developer name saved. Both remain
  incomplete pending genuine native screenshots and the package.
- Age rating: owner authorized publisher-name/developer-email disclosure. The
  questionnaire is filled and preview generated: ESRB Everyone, PEGI 3+, IARC 3+,
  USK 16+ (Increased Communication Risks), with Users Interact. Final Save requires
  an IARC Terms of Use acceptance and an age-of-majority declaration. Explicit
  action-time consent is pending; the checkbox has not been checked. Answers and
  rationale: `docs/store-submission/iarc-questionnaire.json`. These are preview
  ratings, not a completed submission or Microsoft certification.
- Private certification notes: saved and verified after reload. They explain
  `runFullTrust`, startup/update behavior, the review procedure and unfinished
  acceptance. No credentials were entered. Remove the preparation-status paragraph
  only after those checks and reviewer access are actually complete.

## Prepared locally

- English/French listing and reviewer instructions: `docs/store-submission/`.
- English/French privacy notice: `docs/PRIVACY.md`. The owner confirmed the existing
  Discord support community for private data/access/deletion requests.
- Site build includes `/docs/PRIVACY.html`; the companion Help section links to it.
  The public page is not deployed yet. Do not mark its listing flag published.
- Store configuration uses Electron's asynchronous Windows protected storage,
  with serialized atomic writes, no plaintext fallback, and a separate Store
  profile directory. Existing standalone profiles are not silently imported.
- The preview includes the unchanged project license. No certificate, Windows
  trust change, license change or public installer replacement was performed.
- Reproducible local kit: `node scripts/prepare-msix-submission-kit.mjs`.
  Output: `dist/msix-submission-kit/README-FIRST.md` and `readiness.json`.
  The preview is explicitly under `preview-not-for-upload/`; the actual Store
  identity candidate is separate. Public identity: `docs/store-submission/publisher-identity.json`.

## Verification

- 300 test files / 2,579 tests passed, 160.81 seconds.
  Log: `backups/store-submission-vitest.log`.
- TypeScript, ESLint, both addon validators and whitespace checks passed.
- An actual Electron 45 Windows protected-storage round trip passed with synthetic
  credentials. Log: `backups/store-crypto-review.log`. This is not an MSIX install test.
- Rebuilt preview manifest, assets, ASAR sources, engine/parser files and license
  match the source tree. Package: `dist/msix-preview/Guilded.Companion.7.4.0.x64.LOCAL-PREVIEW.msix`.
  Size: 165,359,964 bytes. SHA-256:
  `04fc54fe691dc3ef2ebdc972689ad277680f98d0a99e9f87611e09aa8c8dbc93`.
  Evidence: `backups/msix-preview-verification.json`.
- Site build passed with 12 public guides. No site deployment was performed.
- Standard standalone Windows build also passed ASAR/engine/license comparisons
  at `dist/store-work-standalone-review/win-unpacked`, without the Store package
  marker. This build was not launched or installed.
- Actual Store identity candidate built from `f9e1415` app sources:
  `dist/msix-store/Guilded.Companion.7.4.0.x64.STORE-SUBMISSION.msix`.
  165,359,987 bytes; SHA-256
  `f920bda682f50c3d75f1bd11cf35ce9a4cf82fe44eca9e425d1b068cece15439`.
  Manifest name, publisher and publisher display name match Partner Center exactly.
  Source/engine/assets/license verification passed. Not installed or certified.
- After adding exact Store-identity verification: all 300 files / 2,579 tests
  passed again (153.28 seconds), plus TypeScript, ESLint and both addon validators.
  Log: `backups/store-identity-vitest.log`.

## Remaining submission steps

1. Upload the verified Store candidate through Partner Center's Packages file
   picker and inspect its server-side validation. Do not upload LOCAL-PREVIEW.
2. Confirm the final combined release version/source before certification;
   rebuild the Store candidate if the companion sources change.
3. Publish and verify the privacy URL through the normal reviewed release path.
4. Perform real packaged install/upgrade/uninstall, startup, file-access, tray and
   sign-in checks, plus Windows App Certification Kit validation. Capture genuine
   final-app screenshots. Current preview was not installed or Microsoft certified.
5. Complete the actual product/age declarations and private reviewer access,
   upload, submit and verify the resulting Microsoft status. Do not claim it is
   awaiting approval before submission is confirmed.

## Coordination and release dependencies

Claude's raid preset work is PR #226 (`7aa2279`). The live `/setup testraid`
interaction timeout fix is now PR #227 (`7bcb71e`), owned by Claude as well.
Kevin handles their merges; include merged changes before combined release checks.
The current Codex branch is still local, with no version bump or live bot restart.
Both remote quality jobs, the final release version and coordinated deployment
remain required. Game acceptance and other release follow-up remain in
`RELEASE_GAP_WORK_2026-10-26.md`; this Store work does not clear those items.
