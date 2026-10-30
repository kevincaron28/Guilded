# Guilded 8.4.0 — Private battleground records and launch fixes

This candidate adds opt-in, own-character battleground capture for the Forever
adapter, private history, withdrawal corrections and scoped participation
statistics. Reports remain provisional: no verified match totals, rankings or
automatic awards are inferred. The client adapter is capability gated and still
requires live Forever acceptance.

Discord `/bg privacy`, `/bg history`, `/bg result`, `/bg correct` and `/bg stats`
keep personal reports private and require separate consent for guild statistics.
Replays are idempotent, conflicting reports retain the original with an explanation,
and consent revocation excludes reports from corroboration and shared statistics.

Leaderboards now keep advanced filters collapsed until needed, show only the
selected edition's classes, simplify date formatting and explain a counted-score
example. Help menus fit narrow viewports. Companion connection tests explain
missing setup and refresh actions no longer imply successful sync when unconfigured.

Existing published8.3 artifacts remain unchanged. Actual acceptance and provider
availability are tracked separately in [the release acceptance checklist](V8_4_0_RELEASE_ACCEPTANCE.md).
