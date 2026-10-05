# Web companion and free website rollout

## Website

Website source is isolated on `codex/public-website` (initial commit `ff17fc0`).
It is pushed to `kevincaron28/Guilded`. This branch passed TypeScript, 149 test
files / 1,211 tests, ESLint, addon validation and `npm run site:build`.
The current working checkout includes additional companion/setup work and must
not be confused with this static-site-only branch.

Cloudflare Pages settings prepared on 5 October 2026:

| Setting | Value |
| --- | --- |
| Project name | `guilded-wow` (subject to availability) |
| Repository | `kevincaron28/Guilded` |
| Production branch | `codex/public-website` |
| Framework | None |
| Build command | `npm run site:build` |
| Output directory | `dist/site` |
| Node version | 24 if the platform default is older than 22 |
| Secrets | None |

Do not use the Workers form's default `npm run build`: that checks the bot and
does not produce this website. The intended free route is Pages static hosting.
Cloudflare browser access was blocked by a saved permission preference before
the settings were entered or deployment submitted. No public URL is confirmed.
The GitHub connector also returned 403 for PR creation; no PR was created.
The owner explicitly renewed permission twice, but the browser still reported
a saved block. Local preview access was also denied. Do not retry either through
another browser/tool; the saved permission needs to be changed in the app.

After deployment, check the public HTTPS URL in a signed-out browser: landing,
owner guide, all images, command copy, CurseForge/releases links, and the
guild-address link. Store the confirmed URL here. The website must link to
the guild bot's companion; it cannot serve the existing same-origin API itself.

## Enhanced companion

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
