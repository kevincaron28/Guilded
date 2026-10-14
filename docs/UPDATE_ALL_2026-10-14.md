# Combined Guilded update — 14 October 2026

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
  asserted. See V6_2_STANDALONE_AND_GAMES.md and GUILDED_GAMES_ALPHA.md.
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
