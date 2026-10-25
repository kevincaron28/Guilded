# Guilded 7.3.2 release decision — 25 October 2026

The owner explicitly requested release of the complete addon, bot and companion
on 25 October: "please release everything because we cannot check two pc test for
wow forever befaure launch". This supersedes the earlier publication hold in
CLAUDE.md, the launch-readiness runbook and the stacked PR descriptions.

Release the prepared 7.3.2 product for Forever, Classic Era/Hardcore, TBC
Anniversary, Mists Classic and Retail. Do not increment the version incidentally.
The prepared game/two-PC/French checks remain **pending post-release follow-up**,
not passed tests. Source-reviewed routes and design benchmarks remain provisional.
No compatibility certification or real-client evidence is implied by publication.

Retain automated quality gates, source/artifact verification, production ledger
preflight, verified database/application backup and health/command checks. Preserve
the dungeon reset boundary, season calendar, credentials, characters and EP/GP.
Publish exact matching assets and record actual provider availability separately.
CurseForge must use a flavor it supports; GitHub provides the separate edition ZIPs.

The release includes the prepared PR stack #214 → #215 → #216. Production rollout,
public asset hashes and provider outcomes are recorded in the release execution
record. The game follow-up remains in `V7_3_2_GAME_CHECKLIST.md` and
`DUNGEON_CATALOG_2026-10-25.md`.
