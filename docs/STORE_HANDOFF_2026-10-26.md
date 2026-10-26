# Microsoft Store preparation — 26 October 2026

The owner retained the existing license and authorized progressing toward Store
submission. Microsoft sign-in succeeded, but the portal remains at **Choose account
type**; identity verification, profile details and account setup are incomplete.
No developer enrollment, product reservation, upload or certification is complete.
The onboarding tab is left open for the owner. Do not handle identity documents in chat.

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
  The preview is explicitly under `preview-not-for-upload/`.

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

## Remaining submission steps

1. Owner completes Microsoft developer enrollment and identity verification.
2. Reserve the product and obtain its exact package name, publisher and publisher
   display name. Build the final package using that identity and the agreed release version.
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
