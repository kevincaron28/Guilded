# 8.4.0 acceptance — 30 October 2026

Status: source candidate; not deployed, packaged or published yet.

Checkpoint a41011b: PR293 workflow41075850865 passed all jobs, including
PostgreSQL race/migration/restore and Windows packaging. Local full run had3185
passing tests and8 catalogue/documentation failures; all8 were corrected and19
affected tests passed on rerun. TypeScript and lint passed. These results precede
the reusable setup module below, which requires fresh integrated checks.

## Remaining reusable bot setup

Owner's existing request to finish BG and bot setup includes an optional reusable
BG setup module. Assigned to the existing bg_discord lane; root owns integration.
Current deployed8.3 and candidate `/bg setup` only provide instructions; the
Québec Gold layout alone does not complete reusable setup.

- [x] Source: optional wizard action with persisted guild-scoped category/channel/panel IDs.
- [x] Source: reuse/create/adopt and repair localized guides without duplicates or changing
  existing history/overwrites; missing-permission/manual-channel fallback.
- [ ] Upgrade, idempotency, scope and permission tests; integrated CI/migration.
- [ ] Deploy wizard, then adopt existing Québec Gold IDs and verify readback.
  No other-guild rollout is authorized or planned.

Québec Gold existing category1565740141643964497; groups1552246570714402827,
hub1565730945766527019; stats1565740142977880104/guide1565740363321442386;
results1565740144299081798/guide1565740366987005953. Preserve these IDs.
Automatic result posts/awards remain off. No8.4 artifacts are frozen yet, so this
work remains in8.4; previous published8.3 artifacts remain immutable.

Root integrated setup/routing/UI/wizard run passed67 tests across4 files before
the last readonly inheritance regression was added. Final lane run passed59
focused tests (22 service tests), TypeScript and ESLint. Independent final review
confirmed scope ownership and readonly/bot permission fixes; no remaining blocker
found in reviewed source. New integrated CI and actual deployment remain pending.

EQSCTS66 triage: deployed signup-character.ts19 rejects missing/ambiguous owned
characters as intended. The bilingual response exceeded the reporter's200-character
heuristic and was incorrectly filed as an automatic error. Explicit member-answer
classification now covers these responses while preserving database/programming
failure reporting. Seven tests in two files and targeted ESLint passed; source fix
is not deployed and the production report has not been marked resolved.

Addon polish and explicit next-capture premade codes:35 focused tests passed,
plus both addon validators. Codes remain optional, session-local, consumed once
and cleared on disable/reload; they do not establish verified match identity.

- Integrated Companion/BG focused run:63 tests in5 files passed.
- Backend review: atomic staging consent, revoked-peer exclusion, distinct
  reporter identity and bounded conflict explanations verified by independent review.
- Capture/help and Discord bracket terminology aligned; raw API identifier is
  not represented as a verified level range.
- Full TypeScript/lint/test suite, PostgreSQL race/restore rehearsal, Windows
  packaging and exact-source CI remain pending.
- Fresh recovery backup and deployment verification remain pending.
- Next-build installed Retail/native/Discord QA remains pending; Claude8.3 and
  Retail8.2 results are historical evidence only.
- Forever postmatch and two-client corroboration: NOT RUN; do not claim verified
  adapters or verified matches. Server verified-adapter list remains empty.

## Existing live release

8.3 source2602e67 remains deployed. GitHub23 assets hash-verified. Store
Submission6 is now published; actual installed8.3 verification pending.
Québec Gold organization hub reuses the existing PvP channel without changing
permissions: https://discord.com/channels/1323321076478119967/1552246570714402827/1565730945766527019
Only deployed8.3 organization buttons are present. Add new private-record
buttons by updating that same message after8.4 deployment.

All available testing is authorized now. Preserve real data, existing encrypted
profiles, selected calendars and disabled recurring delivery unless configured.
