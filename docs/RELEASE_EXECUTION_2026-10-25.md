# Guilded 7.3.2 publication — 25 October 2026

The owner authorized publication before unavailable game/two-PC acceptance.
See [the release decision](RELEASE_DECISION_2026-10-25.md). Pending tests remain
follow-up, not passed tests.

## Published and deployed

- PRs #214, #215 and #216 merged. Release source:
  `2c5907955630d4d1e6feedbdbb229600c61f556d`.
- [GitHub 7.3.2](https://github.com/kevincaron28/Guilded/releases/tag/v7.3.2)
  published with 21 assets: both default Forever addon ZIPs, ten edition ZIPs,
  the Windows companion installer, release notes, two manifests, four edition
  rules files and SHA-256 checksums. Every public download was fetched without
  authentication and matched its published checksum and size.
- Full local suite: 279 files / 2,357 tests passed. TypeScript, lint, addon
  validation and artifact/source matching passed. Both exact-main CI jobs
  passed in [run 40197385708](https://github.com/kevincaron28/Guilded/actions/runs/40197385708),
  including PostgreSQL migration/restore tests and Windows packaging.
- Oracle deployed that release commit using the staged official updater.
  `/health` reports 7.3.2, protocol 2 and `commands: ok`; systemd is active.
  All seven `20261125` migrations completed. Ledger references remain unique.
- A fresh database/application backup was verified before deployment, then
  encrypted off-server with authenticated decryption/checksum verification.
  The previous application is retained for code recovery. Private backup
  locations and verification records are in the local ignored release folder.

## Distribution follow-up

CurseForge edition files are submitted as Release with automatic publication
after approval. Guilded 7.3.2 Forever, Era, Mists and Retail were approved;
TBC and standalone submissions continue through review. Provider approval is
separate from upload completion. GitHub downloads are available for every edition.
The website now advertises the verified 7.3.2 release on both providers and links
directly to every GitHub edition package.

Choose the matching edition ZIP: `forever`, `classic-era`, `classic-tbc`,
`classic-mists` or `retail`. Unsuffixed addon ZIPs are Forever. The one Windows
installer supports all editions. Existing private 7.3.2 candidate users should
run the published installer once because its numeric version is unchanged.

Real-client acceptance, the Forever two-PC scenario and benchmark calibration
remain pending in [the game checklist](V7_3_2_GAME_CHECKLIST.md). Classic/Retail
interface declarations are compatibility baselines; clients may require
**Load out of date AddOns**. Guilded rating is provisional and not an official
Raider.IO or Blizzard rating.
