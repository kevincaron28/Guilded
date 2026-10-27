# Dungeon integrity: first implementation tranche

Base: `3a0fc3a` (live badge release). This tranche is a draft change, not deployed
or a new public addon release. Product version remains 7.5.0, protocol 2.
Kevin requested launch improvements and matching full/standalone behavior.

## Implemented contract

Run roles use `TANK`, `HEALER`, `DPS`; `DAMAGER` is an accepted native/legacy alias.
The shared companion/server normalizer is `companion/dungeon-role.mjs`; Lua's
equivalent is `ns.util.dungeonRole`. Both addons share the generated Lua source.
Unknown roles count only in overall results. Guild, public website and personal
addon role filters compare canonical values. Historical rows are read through
the normalizer, not rewritten. Agreement checks treat DPS/DAMAGER as equivalent,
but a known tank/healer/damage disagreement remains a conflict.

Protocol-2 score snapshots deliberately retain the `DAMAGER` wire bucket so
already-installed score panels still work. New panels accept either spelling.
The companion accepts either spelling and serializes the old compatible bucket.
Overall score is still best per route, best N; never the sum of role totals.
Frozen guild results remain frozen, including historical empty role buckets.
Any historical correction requires a separate, explicit decision.

New official snapshots carry `evidencePolicy: "current-v1"` inside their frozen
version-6 rules. This versioned eligibility flag leaves the formula unchanged.
Public evidence-null records cannot earn official credit; they remain stored and
visible as legacy history. Current evidence still checks automatic final-boss
completion, route requirements, party min/max levels, difficulty, and each
credited character's 80% recorded presence. Guild scoring enforces the same
current evidence shape/completion gate. Both surfaces retain their existing
ingestion checks, identity/access rules and `DUNGEON_RUNS_NOT_BEFORE` boundary.

Older frozen snapshots without the flag retain their old policy. Reading them
does not upgrade their rules. Beta and all-time compatibility history retain
their weaker historical policy and are labeled accordingly; they are not official
current-evidence standings. A not-yet-frozen official period also fails closed
for evidence-null runs; weekly and per-run official views use that policy.
New route additions preserve the existing snapshot's evidence flag.

This does not make client reports server-authoritative. `current-v1` describes
stored evidence completeness, not an anti-cheat guarantee. One uploader is not
independent corroboration. Existing duplicate locking, sticky disputes and
whole-observation evidence upgrades are retained.

EN/FR score explanations now distinguish the pre-penalty 50–400 range, second
rounding after the penalty, and the possible 35-point result with a 30% penalty.
Allowed-overlevel runs stay in their route's bracket. Presence is described as
an observer report, not proof of contribution. The reciprocal curve, penalties,
targets, best-N, tie rules and participation rewards are unchanged.

## Read-only live audit

At 2026-10-27 10:11 UTC the production aggregate query found zero public run
rows. Forever Season 1 starts `2026-11-04T23:00:00Z`; its rules were not frozen.
No live rows, seasons, settings or scores were changed. This observation is
time-bounded, not a permanent assertion about the database. Private evidence
is in the ignored `backups/dungeon-evidence-audit.json`.

## Next contract: proposals requiring a policy decision

The following is a coherent proposed **current-v2** contract, not implemented
or activated by this tranche. Keep the board provisional and defer final
competitive awards until these choices and real-game acceptance are complete.

| Area | Current behavior | Recommended next contract / alternative |
| --- | --- | --- |
| Timer | First observed combat, with manual/encounter fallbacks; observer may start late. | Rank first-combat starts only when a fresh-instance/route-start witness is available. Unknown, manual or late starts remain activity. Alternative: separate explicitly provisional timing class. |
| Route | Frozen route-specific completion/checkpoints; some provisional routes trust addon final-boss detection alone. | Publish required checkpoints from verified encounter IDs per edition. Partial lockouts or missing start/checkpoint evidence remain activity. Do not invent universal boss IDs or claim a certified full clear. |
| Reset/reload | Current run retains clock/history; duplicate and near-duplicate checks exist. | Persist attempt identity and original clock across reload/reconnect; validated reset creates a new identity. Partial reset/observer disagreement requires review. No automatic clock restart. |
| Presence | Online group members accrue time while the recorder is active and inside. | Record per-member same-instance supported observations plus known/unknown intervals. Count only known in-instance seconds toward 80%; unknown stays unranked. If an edition cannot establish location, retain a clearly provisional observer-presence class. Never infer skill or AFK contribution; no audio/camera collection. |
| Role changes | Latest known role recorded; unknown counts overall only. | Lock first known role at first combat; a later different known role marks mixed and counts overall only. Alternative: publish a majority-duration policy, requiring timed role evidence and explicit tie handling. Do not infer historical roles. |
| Season attribution | Public uses end time; guild assigns active season at ingestion and requires start within it. | Use one event-time window on both: end selects season, but start must also be in that window. Boundary-crossing runs stay activity. Alternative: assign by start time, requiring a published cross-boundary finish rule. |
| Delayed uploads/finality | Public accepts up to 30 days; finalized guild ratings are frozen. | Propose a 72-hour upload grace before finalization, scoped to the original event-time season. Alternative: retain a longer published grace. Never silently reopen finalized awards; corrections are separately authorized and audited. |
| Route additions | Active snapshots may add missing routes; earlier records can thereby become newly scoreable. | Prefer a fixed official pool until the next season. Alternative: publish `effectiveAt` per addition and require run start at/after it, retaining old unrated status before it. Do not retrofit effective dates onto historical additions. |

These are linked decisions: a stricter start/presence rule needs a new evidence
payload, both addons, companion ingestion, validators and explanatory UI. A new
season/finality policy needs explicit archive handling and boundary tests.
They must not be slipped into an existing frozen ruleset as a bug fix.

## Verification and remaining launch checks

Automated coverage in this tranche:

- Actual shipped Lua capture in full and standalone addons, then actual
  SavedVariables export/import, native DAMAGER → DPS and old DAMAGER input.
- The same capture through actual PostgreSQL guild import/public ingestion,
  persisted fields, guild/web/standalone role totals, retry deduplication,
  legacy official exclusion and unchanged frozen archives.
- Old/new damage selectors in the standalone panel; unknown roles, genuine
  role disagreement, both saved files, EN/FR guidance, realm/character privacy.
- New official snapshot versus old snapshot/Beta, missing min-level, manual
  completion, and 79/80/81% presence. Existing suite retains edition, reset,
  ownership, public/private API, duplicate-capture and archive regressions.
- Both addon sources must pass validation/synchronization and both packages
  must build; the companion browser build must include the new shared module.

Still required in real game, on both PCs and relevant editions: late enable,
manual/fallback start, partial lockout, actual reset, wipe, reload, disconnect,
outside-instance member, replacements, role switch, EN/FR boss detection,
mixed installed client versions and both addons installed. No synthetic test
is a substitute for those passes. No installed addon or SavedVariables was
overwritten, and no game acceptance was claimed.

Replay tools for current/linear/damped curves remain offline and unchanged.
No representative holdout data was available in this tranche; there is no
empirical claim about cap saturation or fairness and no curve recommendation
adopted. Preserve crew/day calibration and best-N coverage. Before any curve
decision, collect held-out crews/time, route/level/party-size strata, exclusion
rates, cap/floor/ties, and target sensitivity at ±10%/±20%.

## Review and release boundary

Draft PR only. The explicit protected-main merge/deployment approval applied
to badge PR #238, not this tranche. Exact dungeon PR/head approval and passing
final CI are required before merge or publication. No database migration is
needed for the JSON policy flag or read-time role normalization. Do not run
badge activation or resend its completed recap.

The Library report `Guilded-Scoring-Before-Competitive-Launch.docx`
(`libfile_50cddbeaba448191bea1315519932ecd`) was read completely via Library.
Its Windows local materialization failed because the required helper calls
unsupported `os.setxattr`; no local-copy success is claimed. Findings were
revalidated against the current source, beyond its older `2d48d56` audit pin.
