# Microsoft Store preparation — 26 October 2026

## Current follow-up: restricted reviewer connection and French polish

The deployed synthetic reviewer endpoint is
https://guilded-store-review.kcaron.workers.dev . Its public `review-kit.zip`
includes English/French instructions and disposable sample files. Nine HTTPS
checks passed through actual companion code: download, pairing, connection,
engine import, standings file, duplicate handling, modified-export rejection,
cross-guild denial and logout revocation. No production data or Discord access.
The private code is local and in the Worker secret, awaiting permission to save
in Microsoft Partner Center Credentials. It expires 25 November 2026 UTC.

French profile labels are fixed; user-authored names are preserved. The rebuilt
Store package is 165,360,608 bytes, SHA-256
`41492af383bc9364871ec30faf22402197192d0725bd5eb138ed3d87f594b8e9`.
Manifest and all packaged sources verify. The portal still has the previous
package until explicitly replaced; the old French settings screenshot also
needs replacement/removal. WACK evidence below applies to the prior preview.

Claude merged #231 and #229 into main 09125e6. His updated owner decision brings
the launch-week addon tools into 7.5.0, declines the guild-wide web heatmap, and
authorizes publication after #232 and final gates. Coordination remains in the
shared backup file; notify before Oracle restart. Store remains a draft.

The privacy URL returned HTTP 200 with the policy and Discord support contact
after the main deployment on 26 October. That blocker is cleared. #232 is merged
as 490d6db. The new Store upload initially hit a duplicate package-name validation
error while the old package was still pending removal; resolve and verify before
claiming the new bytes are accepted.

## Previous checkpoint — after WACK and combined integration

- Store package 7.5.0 is uploaded and Validated. Pricing, Properties, IARC and
  Submission options are Complete. The app is still **In draft**, not certified.
- Eight genuine installed-preview screenshots captured with the explicitly
  approved diagnostic command. Four English and four French screenshots uploaded
  and saved. All six portal sections are **Complete**; Submit for certification
  is enabled. Chrome recovered through a fresh signed-in tab after losing control.
  Private reviewer notes now disclose the WACK findings and unfinished access.
- WACK finished: **overall WARNING**, 22 PASS, one optional blocked-executables
  FAIL, one DPI inspector WARNING. Detailed analysis and evidence are in
  `store-submission/LOCAL_VALIDATION_2026-10-26.md`. Do not call this a clean pass.
- Preview installation, packaged launch/protected configuration and uninstall
  succeeded. **Cleanup complete:** preview, TrustedPeople trust entry and private
  preview certificate/key are absent; cleanup reported no errors.
- Claude #228/#230 merged on main c75c083 and integrated into #229. The combined
  tree passed 309 test files / 2,627 tests, TypeScript, ESLint and both addon
  validators. Disposable local PostgreSQL migration/integration/backup/restore
  passed and the temporary database server stopped. Production is unchanged.
- Four additive migrations and all Claude additions are now in the release
  notes/acceptance list. Kevin handles #229 merge; coordinate the live restart.
- Pending: reviewer access, public privacy URL, Store-signed
  upgrade and connected/tray/startup checks, French connection-profile labels,
  final remote CI/merge and coordinated release. Game checks remain pending.

The remaining sections are historical checkpoints; this section and the local
validation record supersede their installation, screenshot and WACK status.

## Historical checkpoint before WACK retry

## Latest combined candidate: 7.5.0

Kevin chose 7.5.0 through the shared Claude coordination notes. Claude's merged
PRs #226 and #227 are integrated from main 66a6306. The combined release preparation
passed: 302 test files / 2,588 tests (253.98 seconds), TypeScript, ESLint, dependency
audits, addon packaging, website build and standalone Windows installer/source
verification. Evidence: `backups/release-7.5.0-prepare.log`. Production is still 7.4.0.

Use this Store upload candidate, superseding the historical 7.4.0 package below:
`dist/msix-store/Guilded.Companion.7.5.0.x64.STORE-SUBMISSION.msix`.
Size 165,359,991 bytes; SHA-256
`3b64addd5f139e90537d0cd99c430677a80778e590c35e0ad01058859f9ca708`.
Exact reserved identity, manifest, sources, engine, assets and license verified.
Evidence: `backups/msix-7.5.0-store-verification.json`.

The 7.5.0 LOCAL-PREVIEW also verified, SHA-256
`a41322d523627110ab3432013d24e66153109176a4e18cf0c3b006694331913b`.
It must not be uploaded to Partner Center.

Both EN-US and FR-FR listings now contain all seven prepared features, verified
after reopening each saved listing. Screenshots and package upload remain pending.
The in-app browser is signed in but its upload picker does not open. The separate
Chrome window still displayed "That code didn't work" at verification; Kevin has
been asked to finish that Chrome verification directly. No auth code was handled.

Microsoft's signed SDK 10.0.26100.9457 installer was downloaded from Microsoft's
official SDK page. It is paused at its license agreement; optional telemetry was
declined. Accepting the SDK agreement is awaiting explicit owner confirmation.
No SDK installation or WACK pass is claimed.

A seven-day local test certificate (CN=Guilded LocalPreview, thumbprint
809F9DADFB71BE4B665530AE32199CDDEDE9F9F1) was created in CurrentUser/My and its
public certificate exported under ignored `backups/msix-install-review/`.
It is not trusted or a public signing certificate. Local installation/trust and
genuine Store-profile screenshots remain pending. No production credentials were
copied into a review profile. The submission remains a draft, not in certification.
The separate `backups/msix-install-review/Guilded.Companion.7.5.0.x64.SIGNED-LOCAL-TEST.msix`
was signed successfully by SignTool, SHA-256
`10ed471a586903ea7e03f1819f66b074bb3c940810a4a59db998327ecaf69079`.
Windows does not currently trust that signature. Temporary trust, installation and
cleanup were requested from Kevin; no trust import or package installation yet.

All ten edition addon archives also built and verified. An additional Windows
catalog check exposed CRLF-only false drift; normalized comparison fixes that and
the dungeon/buff catalog checks now pass. Targeted packaging/version tests pass
(12 tests); no app runtime source changed after the full suite/MSIX builds.

## Earlier preparation evidence

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
- English (US) and French (France): descriptions, short descriptions, all seven
  features, copyright, unchanged license link and developer name saved. Both remain
  incomplete pending genuine native screenshots and the package.
- Age rating: **Complete**, verified on the submission overview after Save.
  Owner authorized publisher-name/developer-email disclosure, then explicitly
  accepted IARC terms, confirmed age of majority and authorized Save. Saved
  ratings: ESRB Everyone, PEGI 3+, IARC 3+, USK 16+ (Increased Communication Risks),
  with Users Interact. Current Rating ID displayed Pending; no certificate ID is
  claimed. Answers and rationale: `docs/store-submission/iarc-questionnaire.json`.
  The overall app submission remains a draft, not Microsoft certified.
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

Claude's raid preset PR #226 and `/setup testraid` timeout PR #227 were merged by
Claude at Kevin's request. Both are integrated into the 7.5.0 Codex candidate.
Codex opens the combined PR; Kevin handles its merge. Both remote quality jobs
and coordinated deployment remain required; no live bot restart has occurred.
Game acceptance and other release follow-up remain in
`RELEASE_GAP_WORK_2026-10-26.md`; this Store work does not clear those items.
