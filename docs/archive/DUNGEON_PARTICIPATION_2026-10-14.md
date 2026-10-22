# Dungeon participation fairness — 14 October 2026

Deployed to Oracle on 14 October 2026 at commit `2766436`; see
[DUNGEON_DEPLOYMENT_2026-10-14.md](../DUNGEON_DEPLOYMENT_2026-10-14.md) for final checks
and recovery evidence. Player announcement and real-client acceptance remain
pending. No version change, season reset or historical award rewrite.

## Future imports

- At least 50% recorded presence is required for participation points. Exactly
  50% qualifies. Weekly repeat reductions still apply.
- Each account receives at most one participation award per run, through its
  longest-present eligible character (name breaks ties). Competitive character
  scores remain separate. Itemized award amounts sum to one rounded total.
- Automatic final-boss completion, known route, known participant levels and
  matching level band/difficulty are required for bonuses and record eligibility.
  Manual completions, missing evidence, below-band groups and unknown routes
  receive completion points only when presence qualifies.
- Overlevel helpers receive completion points only when an in-band linked guild
  member has at least 50% presence. Without that member, helpers earn zero.
  In-band members of carry runs also receive completion only. Helper awards are
  identified in the transaction reason and Discord announcement.
- Scarlet Monastery wings have separate weekly counters, first-completion
  history, personal/guild records and under-target bonuses. Alts still share the
  account's participation history within each wing. Unknown or mixed routes
  never count as a known wing.
- Version 3 seasons use their frozen level bands and targets for participation
  eligibility and under-target bonuses. Older seasons use guild configuration.
- Existing carry/manual/unknown-level runs are excluded when choosing the
  record to beat; previous points and achievements are retained. Missing old
  evidence is never inferred from current character levels.
- `/dungeon records` and personal bests apply the same eligibility using the
  active season's bands (guild settings if there is no version 3 season), and
  show separate Scarlet Monastery wings. Historical run lists remain visible.
- Runs with insufficient presence and completion-only/helper participants do
  not receive new run achievements. Previously earned achievements stay intact.

Discord posts show a current run's unranked reason, including insufficient
competitive presence, instead of displaying a prior rating as that run's result.
The version 3 Discord leaderboard counts positive-score dungeons in its coverage
label. Stored details and dungeon counts retain the existing archive/companion
format, including zero-point entries.

## Competitive rules and follow-up

The rating remains the sum of best clears with `clamp(round(200*T/t), 50, 400)`.
No bands, required bosses, group-size checks, score curves or best-N limits were
changed. Boss telemetry must be checked on the actual client before full-route
requirements can be designed. Coverage choices need eligible-run data before
the next season. Archived rating snapshots remain readable without recalculation.

Uploads are sorted inside each batch. History queries now use only runs that
finished before the incoming run. Separate late uploads still cannot guarantee
order-independent award totals without reconciling awards already issued. This
change does not introduce automatic ledger adjustments. The combined award is
rounded once, with deterministic itemization.

## Review disposition before deployment

Implemented: participation presence and carry checks; frozen participation targets;
wing-specific counters, first completions and records; record filtering of existing
carries; explanatory English/French announcements; scored coverage display; one
award per account; single-total rounding; no competitive boss records without a
calibrated target. Existing archived boss records are preserved as saved.

Retained intentionally: the equal 50–400 dungeon scale, sum-of-best competition,
80% competitive presence, immutable archived seasons and per-character rating.
These are team clear results, not individual skill measurements.

Deferred with explicit reasons:

- Best-N, narrower bands, brackets and a logarithmic curve are alternative
  competition designs, not cumulative fixes. Choose from actual comparable runs
  for a new rules version/season; do not silently change the current season.
- Required-boss routes need verified encounter events for each custom dungeon.
  Participant history does not establish simultaneous group size. Both need
  real-client evidence before imposing rejection rules.
- Fast-run moderation should begin with officer inspection. Automatically
  withholding valid scores needs an agreed threshold and appeal workflow.
- Death-bonus weights and extra badges are product choices. The review's suggested
  15/10/5 weights do not themselves establish role fairness.
- Stable GUID identity needs verified client telemetry and an explicit identity
  migration. Renames/relinks are not guessed from names.
- Calibration requires comparable crews/builds and a next-season freeze. A target
  of median × 1.1 yields about 220 points for the median run, not 200. No invented
  live benchmarks or automatic mid-season closures are introduced.
- Across-batch late-upload reconciliation remains a separate ledger feature.
  Correcting it fully requires versioned award inputs, compensating transactions,
  invalidation handling and archive boundaries. This deployment preserves existing
  awards rather than silently rewriting their accounting. Upload promptly; officers
  can use the existing audited adjustment command for confirmed discrepancies.

## Prepared player notice (not sent)

Dungeon Rating keeps the same formula and your recorded best scores. Future
Guild Points require at least half-run presence. Manual or unverifiable runs
earn completion points only. Overlevel helpers earn completion points when
helping an eligible guild member, without speed or record bonuses. Scarlet
Monastery wings now have separate activity histories and records. Previous
awards are preserved.

Le score de donjon conserve sa formule et vos meilleurs scores enregistrés.
Les futurs points de guilde exigent une présence d'au moins la moitié du donjon.
Les parcours manuels ou non vérifiables donnent seulement les points de
complétion. Les personnages au-dessus du niveau maximal peuvent recevoir ces
points en aidant un membre admissible, sans bonus de vitesse ou de record.
Les ailes du Monastère écarlate ont maintenant des historiques et records
séparés. Les points déjà attribués sont conservés.

## Release validation

- Isolated candidate `14f8b5f`: full `npm run release:prepare` passed, including
  175 Vitest files / 1,465 tests, TypeScript, full ESLint, addon static validation,
  dependency audit gates, website build, addon ZIP and Windows installer verification.
- The first local attempt hit two slow-test timeouts; the complete unchanged suite
  passed on retry. No checks or timeouts were weakened.
- GitHub push and pull-request workflows passed both required jobs: PostgreSQL
  integration/restore checks and Windows package validation (runs 38596035175 and
  38596273366). Tests include presence boundaries, helpers, duplicate alts, rounding,
  historical carries, wing records, frozen targets, archive format and reupload safety.
- The release branch then incorporated the separately deployed `98c72b1` main
  baseline. Combined-source and final-main checks must pass before Oracle deployment.
- Ledger preflight passed. Verified database/application recovery files and an
  encrypted offsite copy were prepared. Refresh the backup if the live baseline changes.
- The extra Cloudflare branch-build check failed without a log accessible to the
  CLI credentials. Dashboard authentication is pending; this is not a passing check.
- No live dungeon upload/client acceptance or player announcement has been performed.
  The prepared notice above still needs an explicitly authorized sender.
