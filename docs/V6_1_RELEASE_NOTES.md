# Guilded 6.1.0 — Dungeon seasons and guild sharing

Combined release candidate, 13 October 2026. Publication and the fresh beta
season launch remain pending until the release gates in V6_1_RELEASE_HANDOFF.md.

- Dungeon Group Finder score overview with guild-only rankings, current and past
  per-dungeon results, and separate boss records.
- New seasonal rating: 200 points at the target time, bounded to 50–400. Only
  your best eligible result per dungeon or wing counts; linked alts share it.
- The October beta preset offers 16 dungeon/wing targets, explicitly provisional
  and frozen through October 22. All party members must meet the level band;
  overlevel carries and runs without level evidence are unranked. Past results
  stay archived; the new season starts at zero when launched.
- Live boss timer with a saved visibility toggle and encounter fight times in
  dungeon results. Boss kill records do not add extra seasonal rating points.
- Officer bridge enabled by default with companion data; explicit off is kept.
  Guild-home matching supports Forever's PvP/PvP 2 server labels. Members can
  receive core/calendar data and personal seasonal breakdowns from an officer.
- Automatic Discord raid-readiness summaries are limited to one per guild day;
  `/readiness raid` returns the current full report privately.

Install matching addon and companion versions. SavedVariables, pairing and old
season history are preserved. Older clients keep their legacy data but cannot
provide all new level evidence and seasonal detail fields. Product protocol
remains 2; additive data and a separate versioned rating format carry the update.

Confirmed two-PC bridge checks include reception, core data surviving reload
with the sender offline, matching core/loot methods and EP/GP, and calendar
comparison. New Dungeon Group Finder layout and two-PC seasonal-detail delivery
still need real-client verification. Final-boss detection across all 16 targets
is not claimed as tested. The Windows installer remains unsigned.
