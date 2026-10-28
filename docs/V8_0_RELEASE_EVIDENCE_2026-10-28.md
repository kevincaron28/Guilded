# Guilded 8.0 release evidence — 28 October 2026

## Published and deployed

- [GitHub 8.0.0](https://github.com/kevincaron28/Guilded/releases/tag/v8.0.0)
  is public, stable and latest: 21 assets. Every public download was fetched
  anonymously and its SHA-256 matched the verified upload. The tag resolves to
  `0daa31d1f40259c7296282c797f85e608a28eec2`.
- The single Oracle bot and online companion run 8.0.0, protocol 2. Public health
  reports `commands: ok`; Discord accepted commands in every server. The feature
  deployment used `01314c7`; the configuration-only routing update used `0daa31d`
  without a second bot restart. Those five changed files are configuration,
  operator verification, tests and documentation; runtime feature code is identical.
- The website Worker was deployed with native write/pairing throttles, security
  headers, server-rendered French and the private upstream credential.
- Direct origin health, companion and API requests reject caller headers with 404.
  Public health and companion return 200. The first rollout check caught Caddy's
  ordering behavior and restored the preceding config; the corrected ordered
  handler chain passed compiled-config and live wire verification before publication.
- Fifteen public checks passed: website/guides, French metadata/canonical/language,
  public directories/leaderboards, health and companion. The public browser bundle
  matches the local verified build byte for byte.
- Final Retail addon code is installed locally. Previous addon folders and the
  temporary diagnostic probe are archived privately. SavedVariables and generated
  standings/accepted data are preserved. New code takes effect on reload/restart;
  no additional hands-on game acceptance is claimed.

## Release checks and recovery

Full local verification: **336 files / 2,814 tests passed**, TypeScript, ESLint,
both addon validators, both dependency audits (zero vulnerabilities), website and
browser builds, ten edition ZIPs, Windows installer/source verification and the
Store MSIX manifest/source verification. Main CI run `40692175036` passed Linux
quality/PostgreSQL integration and restore plus Windows installer/MSIX packaging.

Production ledger preflight and the post-deploy check both found unique source
references. Database/application backups were verified before deployment; encrypted
off-server copies passed authenticated decryption and checksum comparison. Private
recovery manifests and logs are retained under `backups/release-8.0.0/` and the
restricted Windows recovery folders. Do not restore a database over newer writes.

Ten actual HTTPS checks against the separate synthetic Store review service passed
using the 8.0 companion engine, including re-pair and logout revocation. No production
records or game data were used in that sandbox.

## Still pending: external publication and waived manual checks

The [existing Microsoft Store listing](https://apps.microsoft.com/detail/9N680XX3QFL9)
is live. Submission 2 (`1152921505702255246`) is a draft with saved EN/FR 8.0 notes.
The verified 8.0.0.0 MSIX is prepared, but its upload is pending Chrome file-upload
access. Windows Computer Use stopped the fallback because it could not verify the
browser URL. No successful 8.0 Store upload or certification is claimed.

MSIX: `Guilded.Companion.8.0.0.x64.STORE-SUBMISSION.msix`, 165,367,448 bytes,
SHA-256 `402649fccf903f004308566983309b55f323b832418be04c14604c32553b6c81`.
Microsoft controls certification after submission. The standalone EXE is unsigned.
CurseForge 8.0 uploads are also pending file-upload access. The matching addon ZIPs
are already available on GitHub; existing provider downloads remain separate.

The owner explicitly waived remaining hands-on acceptance and requested bug reports
and fixes after release. Completed Retail observations are in
`RETAIL_ACCEPTANCE_2026-10-28.md`; Classic, full gameplay/two-PC/upgrade and remaining
native accessibility checks are follow-ups, not passes. Provisional scoring and
calibration limits remain visible. Aiven's maintenance-associated memory warning
investigation remains in `AIVEN_MEMORY_REVIEW_2026-10-28.md`; no capacity guarantee or
paid-plan change was made.
