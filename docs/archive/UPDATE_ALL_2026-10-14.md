# Combined Guilded update — 14 October 2026

Later follow-ups: PR #72 made addon-only the default member setup path and was
deployed at `5929360`; final main CI 38621117961 passed PostgreSQL restore and
Windows packaging. Local evidence is
`backups/addon-first-onboarding-deployment-evidence.json`. The standalone setup
follow-up now requires positive companion evidence before selecting Connected,
so cached in-game officer standings do not hide local tools. See
[the setup notes](archive/IN_GAME_SETUP_2026-10-14.md) for existing-choice recovery.
Diablo has also launched after owner approval; see
[the current Discord audit](archive/DISCORD_AUDIT_2026-10-14.md).
The combined-update record below describes the earlier delivery. Published
clients remain 6.1.2, and the expanded standalone client still needs its
documented real-game checks before stable publication.

The owner asked to finish Claude's work and both active Codex chats, update the
product together and push all completed changes. All three implementation turns
have explicit completion evidence. This follow-up preserves the published
6.1.2 clients and protocol 2; no incidental version announcement is triggered.

## Included work

- Character linking/onboarding: PR #69, `98c72b1`, already deployed and pins
  refreshed. Actual private button replies still need the owner's check.
- Dungeon fairness: PR #70, `2766436`, already deployed with PostgreSQL restore,
  Windows and Cloudflare checks. See DUNGEON_DEPLOYMENT_2026-10-14.md. Live dungeon
  acceptance and the prepared player notice remain pending.
- Claude's Diablo/community work: Diablo II labels, readable game choices,
  legacy channel-name reuse and dry-run maintenance scripts. Approved role-ping,
  typo and empty-topic changes were applied. Diablo rooms remain private to the
  owner/bot, subject to Discord's unavoidable Administrator visibility. Opening
  them to game roles still requires the owner's explicit approval.
- Recruitment website: owner-approved public pages, core schedules, curated
  game information, sitemap and guide links. Existing published 6.1.2 downloads
  remain the stable installation path.
- Next-version addon candidate: local cores/rosters, local accounting backup
  handover and separate Guilded Games 0.1.0, retaining soft-reserve rolls in
  Guilded. Source and preview artifacts are included; stable acceptance is not
  asserted. Games was already published separately as a GitHub Alpha prerelease
  and submitted to CurseForge project 1744752 by its completed chat; no duplicate
  submission is made. See V6_2_STANDALONE_AND_GAMES.md and GUILDED_GAMES_ALPHA.md.
- Officer bridge regression coverage for arbitrary realm segment labels;
  simulated cases do not establish additional real-client acceptance.

## Review and delivery gates

Integration uses an isolated checkout based on main `2766436`, keeping the
original shared checkout and ignored credentials, SavedVariables and existing
published artifacts safe. Local permissions, restoration boundaries, game/loot
session exclusion, legacy channel reuse and the public website data boundary
were reviewed. No blocking issue was found in that review; real-client limits
remain as documented by the contributing chats.

TypeScript, the full Vitest suite, ESLint, addon validation, release preparation,
Guilded Games packaging, site/Worker build and final-commit PostgreSQL/Windows CI
must pass before merging/deploying. Concrete results, commit, preview hashes and
backup/deployment evidence will be appended when observed.

## Observed finalization evidence

- [PR #71](https://github.com/kevincaron28/Guilded/pull/71) contains the combined
  source, documentation and CI preview packaging. Initial source commit
  `7647066` passed both quality jobs in
  [run 38601267310](https://github.com/kevincaron28/Guilded/actions/runs/38601267310),
  including PostgreSQL integration/restore and Windows packaging. A documentation
  evidence commit follows; require its current checks before merge.
- Full local `release:prepare` passed: 178 files / 1,505 tests, TypeScript,
  ESLint, Guilded validator, addon/browser/site builds, Windows installer and
  artifact verification. Explicit `tsc --noEmit -p .` also passed.
- Both preview ZIPs passed Lua/package checks; all local links/assets across
  15 generated HTML pages resolve. Worker dry-run build passed.
- High-severity audit gates passed. Two existing moderate advisories remain in
  test-only Fengari/sprintf-js, with no available fixed version reported;
  the companion audit reported zero vulnerabilities.
- Fresh production backup baseline: `2766436`,
  `/home/ubuntu/guilded-recovery/2026-10-14T16-50-41-654Z`. Ledger references were
  unique, `pg_restore --list` read the dump, and the application archive was saved.
  Authenticated encrypted offsite copies and hashes verified in
  `C:/Users/Kev/AppData/Local/Guilded Recovery/2026-10-14T16-50-41-654Z`.
- Production health at this pre-deployment check: ok=true, 6.1.2 / protocol 2,
  service active/running, NRestarts=0. The unified Workers endpoint also returned
  healthy; the earlier website-chat DNS incident is historical.

Preview packages (not replacement stable downloads):

| Package | SHA-256 |
| --- | --- |
| Guilded-next-preview.zip | f512d8ebc29473ffb8018f23d5273097b1a5e348646736aef3a9258d0de83e47 |
| GuildedGames-v0.1.0-preview.zip | 322a2c96f4bb6c59f6d312e99cae1f40d145aa3154129f6971bb2de9f69bf30e |

Local build, backup, final deployed commit and endpoint evidence are retained
under `backups/finalize-oct14-*`; those files are intentionally not public source.
The published GitHub v6.1.2 addon/installer assets were independently checked
before finalization and are not replaced by these candidate builds.
The installed companion executable is already 6.1.2.0. Its source is unchanged
by this integration, so no reinstall or pairing change is needed.

Production is Aiven PostgreSQL. The older Neon recovery settings are historical.
Deployment requires a unique-ledger preflight, a readable custom database dump,
application archive and authenticated encrypted offsite verification. Never
start a second bot or reset an active season. No new Discord player announcement,
Diablo publication or stable addon upload is authorized by this finalization.

## Remaining real-client follow-up

Keep onboarding button checks, dungeon upload acceptance, fresh addon-only guild
setup, real raid totals, two-PC record-keeper handover/undo, non-officer access,
Games chat/roll delivery and both-addon combat/reload checks pending. Existing
owner-confirmed 6.1 acceptance is retained; these candidate checks are separate.
Discord audit recommendations beyond the applied polish are also still pending.
