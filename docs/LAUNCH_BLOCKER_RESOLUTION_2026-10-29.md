# Public origin reliability: 29 October 2026

The reproduced Cloudflare HTTP 530 / error 1016 blocker is resolved in the
observed production checks. This is point-in-time verification, not a guarantee
of future uptime or a claim that manual gameplay acceptance passed.

- Website reliability PR [#262](https://github.com/kevincaron28/Guilded/pull/262)
  merged at `8893f8b0567a9c34384d4da303f528449b8b6f18`.
- Audit PR [#263](https://github.com/kevincaron28/Guilded/pull/263) merged after
  PostgreSQL/restore, Windows packaging and Cloudflare preview checks passed on
  `1ddabaeca6c9b2814bbeb11028bafd38503d87de`.
- Main `a42b6e5778eee885d87dc739262f5c5d7e2e00eb` passed
  [quality CI](https://github.com/kevincaron28/Guilded/actions/runs/40867396013).
- Existing DNS-only A record `bot.kcaron.top` points to `168.138.70.194`.
  Caddy's reviewed shared routes and new hostname were installed, validated and
  reloaded, retaining the old Caddyfile for recovery. TLS validation succeeded.
- Production Worker variable `GUILDED_ORIGIN_URL=https://bot.kcaron.top` was
  added and deployed. The origin credential gate remains enabled.
  `keep_vars: true` preserves the setting through later Worker deployments.
- Fresh ledger preflight, PostgreSQL backup listing, application backup and
  authenticated decryption/checksums of the encrypted off-server copy passed.
- A concurrent standard server update held the deployment lock. This audit's
  updater refused to compete; the standard update completed and the refreshed
  backend is serving. All 487 compared tracked application files match main
  byte-for-byte; post-update ledger references remain unique.

## Live acceptance

Twenty consecutive rounds across six paths passed: **120/120 requests**.
Health, companion HTML, companion JavaScript, leaderboards and the guild
directory returned 200; Discord sign-in returned the expected 302.
Direct unauthenticated `https://bot.kcaron.top/health` returned 404. Public
health reports version 8.0.2, protocol 2 and `commands: ok`.

The initial script mistakenly used `/g/` as the guild directory and received
404 there. The actual directory is `/recruitment/guilds/?lang=en`; the corrected
full run passed. The initial result is retained.

Private evidence under `backups/launch-audit-2026-10-29/` includes
`origin-live-probes-initial.json`, `origin-live-probes.json`,
`origin-fix-main-ci.json`, `preflight-result.json`, `offsite-backup.json`,
`deployed-verification.json`, and `cloudflare-origin.png`.
No credentials or raw database backups are committed.

Published GitHub/CurseForge/Store 8.0.2 artifacts were not replaced. Gameplay
and tester acceptance remains pending/waived as recorded in the launch audit.
Feature work starts with the [loot-history preview foundation](LOOT_HISTORY_IMPORT.md).
