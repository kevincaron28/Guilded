# Web companion and free website rollout

## Unified address follow-up, 5 October 2026

The owner renamed the Cloudflare subdomain to `kcaron` and requested one address
for the website and companion. See [UNIFIED_SITE.md](UNIFIED_SITE.md) for the
Worker's fixed-origin proxy, same-origin API routes, session migration and
deployment checks. The current address is https://guilded-wow.kcaron.workers.dev/;
the Quebec Gold companion is `/companion/`. Historical URLs and static-only
descriptions below describe the earlier deployments.

## Access restored, 5 October 2026

The normal Codex in-app browser now successfully opens the authenticated
Cloudflare dashboard. This supersedes the earlier saved-permission hold below.
The existing assets-only Worker serves the public landing page at
https://guilded-wow.kevincaron28.workers.dev/.
Its dashboard confirms production branch `main`, build `npm run site:build`,
deploy `npx wrangler deploy`, and no runtime bindings. Do not change it back to
the earlier proposed website branch. The prepared Worker configuration from
`5599bdc` is integrated in the combined branch as `db6ff58`.

Predeployment recovery gates passed: Oracle ledger references are unique;
`/home/ubuntu/guilded-recovery/2026-10-05T14-53-08-925Z` contains the verified
custom-format database dump (235,593 bytes), application archive and prior
commit `7d8152c`. Files are mode 600 in a private recovery directory outside
the checkout. Encrypted offsite copies under the owner's local Guilded Recovery
directory passed authenticated-decryption and SHA-256 comparison. The signed-in
Neon project dashboard confirms the production project's six-hour history window.

Final deployment still requires green CI for the combined commit and the normal
main-only updater. Record the deployed commit and live health in the completion
report; the historical sections below are not current deployment evidence.
Real paired-browser/game and Windows acceptance remain separate from deployment.

## Earlier continuation evidence, 5 October 2026 (historical)

The earlier owner/setup work is now committed in `22f6710`, merged with the
owner's latest main in `95d540f`, and configuration duplicates resolved in
`01f0ef7`. All are pushed on `codex/web-companion-folders`, covered by existing
[PR #41](https://github.com/kevincaron28/Guilded/pull/41).
[CI for 01f0ef7](https://github.com/kevincaron28/Guilded/actions/runs/37326957507)
passed both checks (including PostgreSQL migration/restore) and Windows packaging.
Local checks passed 152 files / 1,226 tests, TypeScript, lint, addon validation
and both audits with zero vulnerabilities.

Read-only Oracle inspection confirmed deployed commit
`7d8152c6bf2f75c7e4c19c0dbe6d21dbf8517b63`, active service and healthy
5.0.0 / protocol 2. The live ledger preflight found unique event references.
No migration, backup or restart was performed in this continuation; a fresh
verified backup and provider recovery check are still required before deployment.

GitHub reports a successful `Workers Builds: guilded-wow` check on main commit
`ad5b461`, with Worker version `197ee6b2-875c-4710-89b7-ee38e52703b0`.
This is build-integration evidence, not a verified public website URL or content
check. Main is connected to Cloudflare, so merging PR #41 may trigger deployment.
The owner confirmed the saved Cloudflare permission block is still unresolved.
Hold the merge and the Worker-configuration push until that restriction is removed;
the prescribed Oracle updater also waits because it requires clean, published main.
The GitHub connector still returns 403 for PR metadata writes; Git shell push works.

## Earlier website preparation (historical; settings above supersede this)

Website source is isolated on `codex/public-website` (initial commit `ff17fc0`).
It is pushed to `kevincaron28/Guilded`. This branch passed TypeScript, 149 test
files / 1,211 tests, ESLint, addon validation and `npm run site:build`.
The current working checkout includes additional companion/setup work and must
not be confused with this static-site-only branch.

The owner selected a Cloudflare **Worker** on 5 October 2026, superseding
the earlier Pages plan. Worker configuration is committed locally as `5599bdc`
in the isolated website checkout; its 23-file deployment dry run passed.
It has not been pushed or deployed. Intended Git build settings:

| Setting | Value |
| --- | --- |
| Project name | `guilded-wow` (subject to availability) |
| Repository | `kevincaron28/Guilded` |
| Production branch | `codex/public-website` |
| Build command | `npm run site:build` |
| Deploy command | `npx wrangler deploy` |
| Assets directory | `dist/site` (configured in `wrangler.jsonc`) |
| Node version | 24 |
| Secrets | None |

Do not use the Workers form's default `npm run build`: that checks the bot and
does not produce this website. The Worker serves static assets only.
Cloudflare browser access was blocked by a saved permission preference before
the settings were entered or deployment submitted. No public URL is confirmed.
The GitHub connector also returned 403 for PR creation; no PR was created.
The owner explicitly renewed permission twice, but the browser still reported
a saved block. Local preview access was also denied. Do not retry either through
another browser/tool; the saved permission needs to be changed in the app.
The owner reconfirmed in the continuation session that the block is still active
or unresolved. Do not push the Worker branch or otherwise trigger Cloudflare
deployment until that restriction is removed. Website source `ff17fc0` was
separately merged by the owner in PR #42 (`ad5b461`); this does not establish
website deployment.

After deployment, check the public HTTPS URL in a signed-out browser: landing,
owner guide, all images, command copy, CurseForge/releases links, and the
guild-address link. Store the confirmed URL here. The website must link to
the guild bot's companion; it cannot serve the existing same-origin API itself.

## Enhanced companion

Source is pushed on `codex/web-companion-folders` (initial implementation
`532ed71`). The full local checkout passed `npm run release:prepare`: 152 test
files / 1,226 tests, TypeScript, ESLint, addon validation, both audits with zero
vulnerabilities, and addon/browser/Windows/site builds. The checkout also contains
earlier setup improvements; this is not final-commit CI for either branch.
The live bot and companion were not deployed. Installer and addon checksums in
`dist/Guilded-v6.0.0-SHA256SUMS.txt` were refreshed.

The local enhanced build uses user-selected folders on browsers supporting
`showDirectoryPicker`. Input access is read-only to the account's SavedVariables;
output access is limited by application logic to `Standings.lua` in a folder
containing `Guilded.toc`. It rereads by filename to handle WoW replacing the file.
User approval is required by the browser. Credentials remain in session storage;
folder handles are stored locally in IndexedDB and can be forgotten.

Sync remains manual. There is no background daemon, no guarantee that a closed
or suspended page syncs, and no change to server authorization. Other browsers
retain manual file upload/download. Keep the desktop companion available.

Before deployment acceptance: use real Chrome and Edge on Windows with synthetic
folders first, then a separate paired test member. Test reload/reopen, permission
denial/revocation, file replacement, wrong folder, disk-write failure, wrong guild,
logout/clear, upload deduplication, and returned in-game standings. Offline mocks
do not certify browser permission dialogs or real WoW round trips. Use the normal
CI/backup/deployment gates; never start a second bot with the production token.

The existing manifest already offers an app-style display where supported. No
background-sync claim or service-worker file watcher has been added.

## Shared bot pilot

The next owner experience should be Invite → Setup → Addon → Web companion.
Do not advertise a public shared service until a separate test guild has passed:

- Guild A credentials cannot read or write Guild B, including manage/standings,
  imports, PoE endpoints and scheduled messages.
- Membership/role revocation takes effect and cannot leak officer data.
- Guild B onboarding creates only its intended channels/roles and preserves A.
- Database backup/restore, guild removal/retention, per-guild limits and support
  procedures are documented and verified.
- Hosting/database capacity is measured; a free tier is not an uptime promise.

The code has multi-guild hooks; that alone is not pilot acceptance. No additional
guild has been invited or modified during this work. A separate real test guild
and participating test member remain required for the pilot.
Existing offline coverage includes cross-guild credential rejection in
`tests/poe-api.test.ts` and cross-guild core/player rejection in
`tests/companion-manage.test.ts`; these are useful checks, not a complete
tenant-isolation or production capacity certification.
