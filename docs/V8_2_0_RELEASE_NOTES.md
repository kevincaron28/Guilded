# Guilded 8.2.0 Candidate

October 30, 2026. Protocol remains 2. Publication and final installed-client
acceptance are tracked separately in the [integration record](RELEASE_INTEGRATION_2026-10-30.md).
This includes the [8.1 improvements](V8_1_0_RELEASE_NOTES.md) and the additions below.

## For members

- My Guilded has private calendar export, a personal data centre and shortcuts
  for upcoming raids, sync and the private weekly recap (`/report stats personal:true`).
  Calendar export is a manually refreshed snapshot of raid signups and team responses;
  it includes cancellations and stable event identifiers, with UTC times for DST safety.
- Raid plans show approved playbooks, missed-raid catch-up notes and dated resources.
  Private officer notes are never copied into them. Resource dates are supplied by
  the author; Guilded does not fetch or independently verify the linked advice.
- Supply plans calculate targets from confirmed signups. Members can voluntarily
  pledge supplies and record deliveries, change their own pledge or withdraw it.
  Deliveries are self-reported, not verified inventory. A revised plan needs fresh pledges.
- Optional onboarding tracks professions and a first raid without restricting access.
- Targeted dungeon watch preferences and cooperative challenges reuse existing
  participation data. Challenges are cosmetic and do not award competitive points.

## For officers

- Preview and explicitly approve versioned raid playbooks, recaps and supply plans.
  Concurrent stale edits are rejected. Withdrawal and revision history support recovery.
- Explainable bench advice uses recorded benches, signup order and role capacity.
  Unknown history does not count against a member. Officers retain final selection;
  the advice never changes a roster or awards points.
- The private handover page collects recent audit activity, pending reviews, upcoming
  raids and delivery state. It links recovery procedures without claiming a backup was verified.
- Weekly community questions have preview, Post, Skip and Pause controls. Automatic
  recurring delivery remains disabled until audience, channel and cadence are approved.

## Reliability and polish

- Companion Activity distinguishes saved, uploaded and bot-received evidence for the
  same snapshot, with edition, character, selected source and the next step. Receipt
  does not imply officer approval. Diagnostic previews omit identities and paths.
- Stronger personal pairing, guild/realm/edition checks, browser revocation, stable
  update notices, retry delivery, diagnostic audience checks and character correction.
  Correcting a provisional character preserves its identity and dependent records.
- Test raids use disposable pools and exclude real members from simulated awards.
  Cleanup removes referenced bot-authored test signup posts; older orphan posts still
  require manual removal. Raid-edit confirmations now respect French guild language.
- Retail no longer displays the fallback Classic dungeon catalog without a season.
  Clearing a simulated result dismisses its card. Setup backgrounds, translated
  controls and save-button sizing are corrected in both addons.

## Availability and testing limits

All five recognized WoW editions retain separate packages and data scopes.
Retail testing does not establish Forever compatibility; Forever opens November 4.
Season 1 keeps its existing scoring lock. Guide timing estimates are not measured
samples or approval for new scoring targets, and historical runs are not rescored.
Battle.net discovery still requires the server owner's Blizzard application setup.
Unavailable multi-account, two-device and actual-game checks remain NOT RUN until
evidence is recorded. Provider submission, approval, download and installation are
separate steps; an uploaded package is not proof of publication.
