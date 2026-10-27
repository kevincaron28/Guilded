# Dungeon launch work through November 4

Updated October 27, 2026. This is a work/acceptance plan, not a release approval
or a promise that every defect will be fixed within 48 hours. Production remains
7.5.0 with current-v1 scoring. The experimental current-v2 branch is local only.
The scoring curve is unchanged. Parent coordination owns scheduled follow-ups;
this document does not create a monitor or send invitations.

## Four foundations and current evidence

Kevin clarified the priority on October 27: **native boss events are the
foundation**. Use successful ENCOUNTER_END, ENCOUNTER_START and BOSS_KILL with
validated edition/build-specific route catalogs. DBM, BigWigs and external data
are optional supporting evidence, never required dependencies or substitutes.
Derived callbacks and sync echoes are not independent witnesses and cannot
override contradictory native events. Supported native-positive runs must not
require another addon or external service.

| Foundation | Implemented or established | Still required |
| --- | --- | --- |
| Encounter tracking | Shared full/standalone capture; Forever native encounter declarations inspected at build 70532; mocked native-API positive capture through Companion and PostgreSQL | Runtime route/checkpoint catalog, capability record per build/difficulty; prove all required checkpoints on a real route before saying full-observed |
| Persistent attempts | SavedVariables history; reload preserves clock and records unknown gaps in local candidate | Bounded attempt journal with entry/start/reset-intent/reset-result/gap/end semantics; restart and partial-run recovery acceptance |
| Observer reconciliation | Source-aware intervals and original reports; safe same-source peer upgrades; legacy/native and same-uploader revisions; no relay confirmation inflation; newly eligible participation awards reconciled under lock | Independent exact-head review; real two-client and acknowledgement/reload acceptance; cross-observer peer data must remain separately sourced |
| Scoring explanations | Existing EN/FR eligibility and penalty guidance; candidate aligns role filters across web/guidance/standalone | Coverage/confidence/participation labels and reason codes; distinguish unknown evidence, partial coverage and genuine contradiction; explain grace/deadlines consistently |

Recommended contract: coverage (partial / all required checkpoints observed),
confidence (single observer / independently corroborated), and participation
(roster / self-observed / locally observed) are separate. Freshness may remain
unknown. Never label raw client reports authoritative or anti-cheat evidence.
Unknown new observations do not silently invalidate compatible current-v1 runs.

The original strict freshness prototype has been replaced locally by a
native-observed contract with honest unknown freshness; it remains inactive.
See [the four-blocker review matrix](DUNGEON_FOUR_BLOCKER_REVIEW_2026-10-27.md)
for code and regression evidence. Atomic calendar writes, shared reader locks,
stale-rotation checks and both finalizer/import lock orderings have disposable
PostgreSQL coverage. Independent review and real-client acceptance remain gates. The
[feasibility record](DUNGEON_V2_FEASIBILITY_2026-10-27.md) preserves the API research.

## Dated targets and exit criteria

| Date (UTC) | Target | Evidence needed to close |
| --- | --- | --- |
| Oct 27 | Preserve candidate, API research, role parity, acceptance plan | Local commit, full suite, source pins, honest open-blocker list |
| Oct 28 | Observer lineage and safe peer upgrades; calendar lock contract | Independent versus relayed reports; conflicting/overlapping observations; atomic calendar/import/finalization tests in disposable PostgreSQL |
| Oct 29 | Attempt journal and bounded diagnostics; clear EN/FR explanations | Restart/reset/reload/partial cases; previewed consent-based diagnostic export; token/private-data redaction tests |
| Oct 30–31 | Consenting test groups on available editions; compatibility | Exact edition/build/difficulty, route and package hash; full/standalone/both-installed; old/new clients; real capture-to-site evidence |
| Nov 1 | Select feasible 7.5.1 scope and build candidate | Reconcile current main's badge patch; coordinated versions; ten edition packages and Companion; no unpublished prototype assets reused |
| Nov 2 | Independent review and exact-commit checks | No unresolved release blockers; migration and backup/restore rehearsal; regression results and explicit real-game limits |
| Nov 3 | Owner release decision and rollout preparation | Exact PR/commit/assets/channel scope approved; backup/rollback ready; no automatic publication implied by this plan |
| Nov 4 | Forever launch capture and feedback | Consenting players, actual launch build and routes; preserve raw observations and provisional results; verify configured official start before ranked imports |
| Nov 5–6 | First two days of triage and measured corrections | Prioritized reproducible issues, regression tests, reviewed fixes; representative real runs kept by edition/crew/day; no silent frozen-score recalculation |

Dates are targets. An unmet acceptance criterion stays visibly open; it is not
waived because a calendar date arrived. Do not add speculative features that
displace correctness, compatibility or acceptance work.

## Real-client evidence matrix

| Edition | What can be prepared now | Current limit |
| --- | --- | --- |
| Forever | Source-inspected 1.60.1/70532 capability matrix; existing mocked adapter path | November 4 runtime/build and consenting party required; no current real full-route proof |
| Era | Separate package/catalog and recorder checks | Test account, group and actual supported build not supplied by the game being online |
| TBC | Separate package/catalog and recorder checks | Same consent/access requirement; do not borrow Era observations |
| Mists | Separate package/catalog and recorder checks | Same consent/access requirement; distinguish native challenge support from normal dungeons |
| Retail | Separate package; native Mythic+ contract already distinct | Actual client validation required; restricted values stay unknown; no Retail timings applied to Forever |

For each capture record edition, interface/full build, language, addon/Companion
versions and hashes, route/difficulty, capture source, run reference, observed
start/end/gaps, required checkpoint results, participant observation basis,
upload result and displayed score/reason. Source declarations, mocked fixtures,
real single-client and real two-PC results must be separate statuses.

The smallest useful user test is two consenting players in one normal supported
dungeon: full Guilded on one PC, standalone on the other, matching reviewed
candidate, separate Companions and accounts. Enter before first combat, complete
every required boss, save normally and upload both selected reports twice.
Compare run identity, duration, checkpoints, role/participant credit and site
results. Then repeat targeted reload/distance/disconnect/role-switch checks.
Both-installed duplicate capture needs a separate short check. Start with an
available edition; repeat on the actual Forever launch build. Do not install
over a running game or assume the user has approved a client replacement.

Use [the existing two-PC checklist](V7_3_2_GAME_CHECKLIST.md) for test mechanics,
but record the actual selected candidate version/hash rather than copying its
historical 7.3.2 version instructions. No real-game pass is recorded by this plan.

## Feedback, diagnostics and monitoring readiness

Existing source-backed entry points:

- Member submission: Discord `/report bug`, implemented in
  [bugreport.ts](../src/commands/bugreport.ts). Keep the returned short reference.
  The local diagnostics candidate previews sanitized text and the developer
  destination before Send/Cancel; it removes screenshot input and duplicate
  officer forwarding. This candidate is not deployed yet.
- Operator inbox: `npm run bugs -- --days 2` writes private `bug-inbox.md` using
  [scripts/bugs.ts](../scripts/bugs.ts). It reads unresolved reports, with a bounded
  1,000-row query; it is not a complete unbounded log archive.
- Error service: [error-report.ts](../src/services/error-report.ts) stores errors
  and can notify the configured `ERROR_LOG_CHANNEL_ID`, deduplicating repeated
  notifications. The live channel's identity/access must be checked before a
  scheduled monitor uses it; no channel permission change is requested here.
- Public build results: [Guilded Actions](https://github.com/kevincaron28/Guilded/actions).
  Public scoring smoke check: [leaderboards](https://guilded.kcaron.top/leaderboards/).
  Neither page replaces the private diagnostic inbox or actual game acceptance.

Privacy readiness remains a review/deployment gate: the local candidate minimizes
automatic exceptions and redacts confirmed member text, with recipient checks.
Do not enable broader automatic capture on that basis. New diagnostics
should contain bounded build/capability/route/event/reason IDs; no tokens, pairing
credentials, account paths, DMs, private chat, audio or unrestricted screenshots.
Provide a preview and explicit selection/consent for diagnostic or SavedVariables
exports. Store only the selected relevant report, with a documented retention
limit. External combat-log uploads and new credentials are outside this plan.
See [diagnostic privacy and actual-client prerequisites](DIAGNOSTIC_PRIVACY_AND_CLIENT_ACCEPTANCE.md)
for the implemented boundary, tests, installed-state observations and smallest
real-game capture needed. No game evidence has been gathered by this candidate.

On Nov 4–6, group reports by version/edition/reason and prioritize data loss,
privacy leaks, duplicate awards, crashes and blocked capture before layout or
new features. Preserve run references and redacted reproduction steps. Mark a
report resolved only after the relevant regression and deployed/client version
are verified. Keep a separate calibration sample set; do not claim representative
benchmarks from a few fast runs or alter frozen targets without a reviewed policy.
