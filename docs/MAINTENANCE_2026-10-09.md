# Companion and Oracle maintenance — 9 October 2026

Completed at approximately 18:50 America/Toronto. Product version remains
6.0.0 Release, protocol 2; next planned version is 6.1.0. The deployed
application commit is `d4d34e5b87f393778202a714d9a4c12fc78b53f7`.

## Completed

- Updated the owner's installed desktop companion from 5.0.0 to the published
  6.0.0 Windows release. Installer SHA-256 matched GitHub's asset digest:
  `e32a32c5093340f124ea9a554b50241a13319ac6b9855930f3e1a04f46fad914`.
  The app is running; settings, personal pairing and game SavedVariables were
  preserved. The local addon matches public 6.0.0, excluding generated standings.
  Private OfficerBridge development files were not installed.
- Created a PostgreSQL custom-format backup and verified its archive listing.
  Archived application and host configuration, then verified authenticated
  decryption and matching hashes of encrypted recovery copies on the owner's
  PC. Recovery details and keys remain outside Git. No database restore was run.
- Updated Oracle's eligible system packages, including Caddy 2.11.7, then
  rebooted into kernel `7.0.0-1013-oracle`. Caddy configuration validation and
  the package consistency audit passed; no failed services or reboot pending.
  Previous kernels were retained for recovery.
- Explicitly installed `open-iscsi` and `libopeniscsiusr` version
  `2.1.9-3ubuntu5.5` after checking for active iSCSI sessions and previewing the
  change. No active sessions or package removals were reported. Ubuntu's global
  phased-update policy was not changed. Final upgrade preview reports zero
  pending upgrades.

## Caddy package-source follow-up

Cloudsmith's official Caddy repository returned HTTP 402. Caddy 2.11.7 was
installed from the official GitHub Debian package with its SHA-256 verified
against release asset metadata. This is the project's documented
[fallback for repository outages](https://github.com/caddyserver/dist/issues/114).

The unavailable `deb` and `deb-src` entries in
`/etc/apt/sources.list.d/caddy-stable.list` are commented out, with the reason
and update path recorded in that file. The original is preserved in the private
maintenance recovery directory. Normal `apt-get update` now succeeds.

**Caddy updates currently require official GitHub release packages.** Restore
the signed Cloudsmith source when it becomes available again. The upstream
outage itself is not repaired. No unsigned source, third-party mirror,
downgrade or blanket package hold was introduced.

## Verification

- Bot and Caddy returned automatically after reboot. Discord login succeeded;
  the new service invocation has zero automatic restarts.
- Oracle and the public website health endpoints report `ok: true`, 6.0.0,
  protocol 2. Existing companion credentials read standings successfully
  through both origins after the reboot.
- All 24 commands match source in both joined Discord servers. Quebec Gold's
  14 configured channels exist and pass the checked bot permissions.
- All 72 source migrations applied, zero unfinished migrations, 40 delivery
  jobs DONE and no duplicate EPGP/DKP source references.
- TypeScript, ESLint, addon validation and all 1,351 tests across 165 files pass.
  The deployed source's PostgreSQL and Windows jobs passed in
  [CI run 37971879731](https://github.com/kevincaron28/Guilded/actions/runs/37971879731).

## Remaining acceptance

The second Discord server still needs its announcement, raid signup and officer
log channels configured if it is intended for active use. The other PC was not
updated or independently verified in this session. An authenticated standings
read does not establish a real-game upload/return round trip. Existing
[post-release acceptance checks](V6_0_FINALIZATION_CHECKLIST.md) remain pending
where no separate evidence has been recorded.
