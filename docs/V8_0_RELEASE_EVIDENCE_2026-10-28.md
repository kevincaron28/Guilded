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

## Provider publication completed; manual acceptance waived

The [existing Microsoft Store listing](https://apps.microsoft.com/detail/9N680XX3QFL9)
is live. Submission 2 (`1152921505702255246`) published the validated 8.0.0.0
x64 MSIX and saved EN/FR 8.0 notes on 28 October. Partner Center confirms that the
latest product is available in Microsoft Store; read-only published package details
show 8.0.0.0. The previous package was replaced inside the draft by Partner Center's
version selection. Private publication screenshot: `backups/edition-site/store-8-published.png`.
This establishes provider publication, not a newly installed Store-client test.

MSIX: `Guilded.Companion.8.0.0.x64.STORE-SUBMISSION.msix`, 165,367,448 bytes,
SHA-256 `402649fccf903f004308566983309b55f323b832418be04c14604c32553b6c81`.
Microsoft certification completed. The standalone EXE remains unsigned.
All ten CurseForge 8.0 files are approved and set to publish automatically. Their
actual anonymous CDN downloads match the original GitHub SHA-256 hashes. Guilded
file IDs: Forever `9354501`, Era `9354575`, TBC `9354591`, Mists `9354616`, Retail
`9354622`. Guilded Dungeons: Forever `9354631`, Era `9354656`, TBC `9354662`, Mists
`9354667`, Retail `9354668`. Each carries only its matching game-version tag.
Private approval rows and hashes: `backups/edition-site/curseforge-*-8-uploads.json`
and `curseforge-public-downloads.json`. Seven initial incomplete upload entries were
recoverably archived; the valid replacements used verified real ZIP paths.

## Follow-up website and message-earning correction

[Dedicated WoW edition pages](WOW_EDITION_WEBSITE_2026-10-28.md) are live in EN/FR.
The bot-only [channel coverage fix](PARTICIPATION_CHANNEL_COVERAGE_2026-10-28.md)
deployed exact main `4e23dac` after PR CI `40732004968` and main CI `40732685873`
passed. The existing single service was replaced from a prepared application with
verified database/application and encrypted off-server backups. Ledger references
remain unique. Health reports 8.0.0 / protocol 2 / commands ok; the primary guild's
registered `/participation channels` and French description were read back through
Discord REST. Origin denial/public proxy checks passed again. No existing point
balances, cap settings, permissions, intents, client release bytes or frozen histories were changed.
Local follow-up checks: 338 files / 2,835 tests, TypeScript, lint and addon validators.
The final provider-link follow-up passed 338 files / 2,836 tests, TypeScript, lint
and addon validators; it records approved per-edition CurseForge links separately
from the published GitHub version. No unapproved provider file is advertised.

The owner explicitly waived remaining hands-on acceptance and requested bug reports
and fixes after release. Completed Retail observations are in
`RETAIL_ACCEPTANCE_2026-10-28.md`; Classic, full gameplay/two-PC/upgrade and remaining
native accessibility checks are follow-ups, not passes. Provisional scoring and
calibration limits remain visible. Aiven's maintenance-associated memory warning
investigation remains in `AIVEN_MEMORY_REVIEW_2026-10-28.md`; no capacity guarantee or
paid-plan change was made.
